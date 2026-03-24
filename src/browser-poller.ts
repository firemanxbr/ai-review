const REVIEWED_KEY = "ai-review-reviewed";

interface PullRequest {
  number: number;
  title: string;
  head: { sha: string; ref: string };
  user: { login: string };
  html_url: string;
}

type ActivityHandler = (event: {
  event_type: string;
  repo: string;
  pr_number: number | null;
  message: string;
  html_url?: string;
}) => void;

function getReviewed(): Set<string> {
  try {
    const stored = localStorage.getItem(REVIEWED_KEY);
    return new Set(stored ? JSON.parse(stored) : []);
  } catch {
    return new Set();
  }
}

function markReviewed(key: string): void {
  const reviewed = getReviewed();
  reviewed.add(key);
  try {
    localStorage.setItem(REVIEWED_KEY, JSON.stringify([...reviewed]));
  } catch {
    // localStorage unavailable
  }
}

async function fetchOpenPRs(
  repo: string,
  pat: string
): Promise<PullRequest[]> {
  const resp = await fetch(`https://api.github.com/repos/${repo}/pulls?state=open`, {
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "AI-Review/0.1.0",
    },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

async function fetchDiff(
  repo: string,
  prNumber: number,
  pat: string
): Promise<string> {
  const resp = await fetch(
    `https://api.github.com/repos/${repo}/pulls/${prNumber}`,
    {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github.v3.diff",
        "User-Agent": "AI-Review/0.1.0",
      },
    }
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.text();
}

async function reviewWithLmStudio(
  model: string,
  prTitle: string,
  diff: string
): Promise<string> {
  const MAX_DIFF = 12000;
  const truncatedDiff =
    diff.length > MAX_DIFF
      ? `${diff.slice(0, MAX_DIFF)}\n\n... (diff truncated at ${MAX_DIFF} chars, ${diff.length} total)`
      : diff;

  const resp = await fetch("/lmstudio/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: `You are a senior code reviewer. Analyze the PR diff provided and give a thorough review covering:

1. **Code Quality & Best Practices** — naming, structure, readability, DRY principle
2. **Logic & Bug Detection** — potential bugs, edge cases, off-by-one errors
3. **Security Issues** — injection risks, auth problems, data exposure
4. **Style & Formatting** — consistency, conventions

Format your review as markdown with severity ratings:
- 🔴 Critical — must fix before merge
- 🟡 Warning — should address
- 🟢 Suggestion — nice to have

End with a brief summary and an overall recommendation (approve / request changes / comment only).

Keep the review concise and actionable. Focus on the most impactful findings.`,
        },
        {
          role: "user",
          content: `PR Title: ${prTitle}\n\nDiff:\n\`\`\`\n${truncatedDiff}\n\`\`\``,
        },
      ],
      temperature: 0.3,
      max_tokens: 4096,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`LM Studio HTTP ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || "No response from model";
}

async function postReview(
  repo: string,
  prNumber: number,
  body: string,
  pat: string
): Promise<void> {
  const resp = await fetch(
    `https://api.github.com/repos/${repo}/pulls/${prNumber}/reviews`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        "User-Agent": "AI-Review/0.1.0",
      },
      body: JSON.stringify({ body, event: "COMMENT" }),
    }
  );
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text}`);
  }
}

let pollingTimer: ReturnType<typeof setTimeout> | null = null;
let onActivity: ActivityHandler | null = null;

function emit(
  eventType: string,
  repo: string,
  prNumber: number | null,
  message: string,
  htmlUrl?: string
) {
  onActivity?.({ event_type: eventType, repo, pr_number: prNumber, message, html_url: htmlUrl });
}

async function pollOnce(
  pat: string,
  repos: string[],
  model: string
): Promise<void> {
  // Check LM Studio health
  try {
    const health = await fetch("/lmstudio/v1/models");
    if (!health.ok) {
      emit("warning", "", null, "LM Studio is not running");
      return;
    }
  } catch {
    emit("warning", "", null, "LM Studio is not reachable");
    return;
  }

  const reviewed = getReviewed();

  for (const repo of repos) {
    try {
      const prs = await fetchOpenPRs(repo, pat);
      for (const pr of prs) {
        const dedupKey = `${repo}:${pr.number}:${pr.head.sha}`;
        if (reviewed.has(dedupKey)) continue;

        emit(
          "pr_found",
          repo,
          pr.number,
          `Found PR #${pr.number}: ${pr.title}`,
          pr.html_url
        );

        // Fetch diff
        let diff: string;
        try {
          diff = await fetchDiff(repo, pr.number, pat);
        } catch (e) {
          emit(
            "error",
            repo,
            pr.number,
            `Failed to fetch diff: ${e instanceof Error ? e.message : e}`,
            pr.html_url
          );
          continue;
        }

        emit(
          "reviewing",
          repo,
          pr.number,
          `Reviewing PR #${pr.number} with model ${model}...`,
          pr.html_url
        );

        // Review with LM Studio
        let review: string;
        try {
          review = await reviewWithLmStudio(model, pr.title, diff);
        } catch (e) {
          emit(
            "error",
            repo,
            pr.number,
            `Review failed: ${e instanceof Error ? e.message : e}`,
            pr.html_url
          );
          continue;
        }

        // Post review to GitHub
        const reviewBody = `## 🤖 AI Review (Local — powered by LM Studio)\n\n${review}\n\n---\n*Reviewed by [AI Review](https://github.com/firemanxbr/ai-review) using model \`${model}\`*`;

        try {
          await postReview(repo, pr.number, reviewBody, pat);
          markReviewed(dedupKey);
          emit(
            "review_posted",
            repo,
            pr.number,
            `Review posted for PR #${pr.number}`,
            pr.html_url
          );
        } catch (e) {
          emit(
            "error",
            repo,
            pr.number,
            `Failed to post review: ${e instanceof Error ? e.message : e}`,
            pr.html_url
          );
        }
      }
    } catch (e) {
      emit(
        "error",
        repo,
        null,
        `Failed to fetch PRs: ${e instanceof Error ? e.message : e}`
      );
    }
  }
}

export function startPolling(
  pat: string,
  repos: string[],
  model: string,
  intervalSecs: number,
  activityHandler: ActivityHandler
): void {
  stopPolling();
  onActivity = activityHandler;

  const run = async () => {
    await pollOnce(pat, repos, model);
    pollingTimer = setTimeout(run, intervalSecs * 1000);
  };

  // Start immediately
  run();
}

export function stopPolling(): void {
  if (pollingTimer) {
    clearTimeout(pollingTimer);
    pollingTimer = null;
  }
  onActivity = null;
}

export function isPollingRunning(): boolean {
  return pollingTimer !== null;
}
