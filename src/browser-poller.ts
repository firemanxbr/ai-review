const REVIEWED_KEY = "ai-review-reviewed";
const TRACKED_KEY = "ai-review-tracked-prs";

interface TrackedPr {
  repo: string;
  number: number;
  lastState: "open" | "closed" | "merged";
  html_url: string;
}

interface PullRequest {
  number: number;
  title: string;
  state: string;
  merged_at: string | null;
  head: { sha: string; ref: string };
  user: { login: string };
  html_url: string;
}

interface ReviewSummary {
  critical: number;
  high: number;
  moderate: number;
  low: number;
  suggestion: number;
}

type ActivityHandler = (event: {
  event_type: string;
  repo: string;
  pr_number: number | null;
  message: string;
  html_url?: string;
  pr_state?: "closed" | "merged" | "reopened";
  tokens_used?: number;
  review_summary?: ReviewSummary;
  diff_size?: number;
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

function getTrackedPrs(): Map<string, TrackedPr> {
  try {
    const stored = localStorage.getItem(TRACKED_KEY);
    if (!stored) return new Map();
    const arr: TrackedPr[] = JSON.parse(stored);
    return new Map(arr.map((p) => [`${p.repo}:${p.number}`, p]));
  } catch {
    return new Map();
  }
}

function saveTrackedPrs(tracked: Map<string, TrackedPr>): void {
  try {
    localStorage.setItem(TRACKED_KEY, JSON.stringify([...tracked.values()]));
  } catch {
    // localStorage unavailable
  }
}

function trackPr(repo: string, number: number, state: "open" | "closed" | "merged", html_url: string): void {
  const tracked = getTrackedPrs();
  tracked.set(`${repo}:${number}`, { repo, number, lastState: state, html_url });
  saveTrackedPrs(tracked);
}

async function fetchPrState(
  repo: string,
  prNumber: number,
  pat: string
): Promise<{ state: string; merged: boolean; html_url: string; title: string } | null> {
  try {
    const resp = await fetch(
      `https://api.github.com/repos/${repo}/pulls/${prNumber}`,
      {
        headers: {
          Authorization: `Bearer ${pat}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "AI-Review/0.1.0",
        },
      }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    return {
      state: data.state,
      merged: !!data.merged_at,
      html_url: data.html_url,
      title: data.title,
    };
  } catch {
    return null;
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
): Promise<{ content: string; tokens_used: number }> {
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
- 🔴 Critical — must fix before merge, security vulnerabilities, data loss risks
- 🟠 High — significant issues that should be fixed, logic errors, performance problems
- 🟡 Moderate — should address, code quality concerns, maintainability issues
- 🔵 Low — minor issues, style inconsistencies, small improvements
- 🟢 Suggestion — nice to have, optional enhancements

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
  const content = data.choices?.[0]?.message?.content || "No response from model";
  const tokens_used = data.usage?.total_tokens ?? 0;
  return { content, tokens_used };
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
  htmlUrl?: string,
  extras?: {
    pr_state?: "closed" | "merged" | "reopened";
    tokens_used?: number;
    review_summary?: ReviewSummary;
    diff_size?: number;
  }
) {
  onActivity?.({
    event_type: eventType,
    repo,
    pr_number: prNumber,
    message,
    html_url: htmlUrl,
    ...extras,
  });
}

function parseReviewSeverity(review: string): ReviewSummary {
  const critical = (review.match(/🔴/g) || []).length;
  const high = (review.match(/🟠/g) || []).length;
  const moderate = (review.match(/🟡/g) || []).length;
  const low = (review.match(/🔵/g) || []).length;
  const suggestion = (review.match(/🟢/g) || []).length;
  return { critical, high, moderate, low, suggestion };
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
  const tracked = getTrackedPrs();

  // Check state changes on all tracked PRs
  for (const [key, tp] of tracked) {
    const prInfo = await fetchPrState(tp.repo, tp.number, pat);
    if (!prInfo) continue;

    const currentState: "open" | "closed" | "merged" =
      prInfo.merged ? "merged" : prInfo.state === "closed" ? "closed" : "open";

    if (currentState !== tp.lastState) {
      if (currentState === "merged") {
        emit(
          "pr_merged",
          tp.repo,
          tp.number,
          `PR #${tp.number} has been merged`,
          tp.html_url,
          { pr_state: "merged" }
        );
      } else if (currentState === "closed") {
        emit(
          "pr_closed",
          tp.repo,
          tp.number,
          `PR #${tp.number} has been closed`,
          tp.html_url,
          { pr_state: "closed" }
        );
      } else if (currentState === "open" && (tp.lastState === "closed" || tp.lastState === "merged")) {
        emit(
          "pr_reopened",
          tp.repo,
          tp.number,
          `PR #${tp.number} has been reopened`,
          tp.html_url,
          { pr_state: "reopened" }
        );
      }

      tp.lastState = currentState;
      tracked.set(key, tp);
    }
  }
  saveTrackedPrs(tracked);

  for (const repo of repos) {
    try {
      const prs = await fetchOpenPRs(repo, pat);
      for (const pr of prs) {
        // Track every open PR we see
        trackPr(repo, pr.number, "open", pr.html_url);

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

        const diffSize = diff.length;

        // Review with LM Studio
        let reviewResult: { content: string; tokens_used: number };
        try {
          reviewResult = await reviewWithLmStudio(model, pr.title, diff);
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

        const severity = parseReviewSeverity(reviewResult.content);

        // Post review to GitHub
        const reviewBody = `## 🤖 AI Review (Local — powered by LM Studio)\n\n${reviewResult.content}\n\n---\n*Reviewed by [AI Review](https://github.com/firemanxbr/ai-review) using model \`${model}\`*`;

        try {
          await postReview(repo, pr.number, reviewBody, pat);
          markReviewed(dedupKey);
          emit(
            "review_posted",
            repo,
            pr.number,
            `Review posted for PR #${pr.number}`,
            pr.html_url,
            {
              tokens_used: reviewResult.tokens_used,
              review_summary: severity,
              diff_size: diffSize,
            }
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

function seedTrackedPrsFromActivity(): void {
  try {
    const stored = localStorage.getItem("ai-review-activity");
    if (!stored) return;
    const items: { event_type: string; repo: string; pr_number: number | null; html_url?: string; pr_state?: string }[] = JSON.parse(stored);
    const tracked = getTrackedPrs();

    // First pass: find PRs not yet tracked
    // Second pass: determine their latest known state from activity
    const prLatestState = new Map<string, "open" | "closed" | "merged">();
    for (const item of items) {
      if (!item.pr_number || !item.repo) continue;
      const key = `${item.repo}:${item.pr_number}`;
      // Activity is newest-first, so first match wins
      if (!prLatestState.has(key)) {
        if (item.event_type === "pr_merged") {
          prLatestState.set(key, "merged");
        } else if (item.event_type === "pr_closed") {
          prLatestState.set(key, "closed");
        } else if (item.event_type === "pr_reopened") {
          prLatestState.set(key, "open");
        } else {
          prLatestState.set(key, "open");
        }
      }
    }

    for (const item of items) {
      if (!item.pr_number || !item.repo) continue;
      const key = `${item.repo}:${item.pr_number}`;
      if (!tracked.has(key)) {
        tracked.set(key, {
          repo: item.repo,
          number: item.pr_number,
          lastState: prLatestState.get(key) ?? "open",
          html_url: item.html_url || `https://github.com/${item.repo}/pull/${item.pr_number}`,
        });
      }
    }
    saveTrackedPrs(tracked);
  } catch {
    // ignore
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

  // Seed tracked PRs from existing activity so state changes are detected
  seedTrackedPrsFromActivity();

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

export async function fetchClosedPRs(
  repo: string,
  pat: string
): Promise<{ number: number; title: string; state: string; merged_at: string | null; html_url: string }[]> {
  const resp = await fetch(
    `https://api.github.com/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=30`,
    {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "AI-Review/0.1.0",
      },
    }
  );
  if (!resp.ok) return [];
  return resp.json();
}
