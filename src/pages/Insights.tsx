import type { ActivityItem } from "../App";

interface Props {
  activity: ActivityItem[];
}

function Insights({ activity }: Props) {
  // Aggregate metrics from activity data
  const reviewEvents = activity.filter((a) => a.event_type === "review_posted");
  const allPrs = new Set(
    activity
      .filter((a) => a.pr_number)
      .map((a) => `${a.repo}:${a.pr_number}`)
  );

  const totalReviewed = reviewEvents.length;
  const totalTokens = reviewEvents.reduce((sum, a) => sum + (a.tokens_used ?? 0), 0);

  const totalCritical = reviewEvents.reduce(
    (sum, a) => sum + (a.review_summary?.critical ?? 0),
    0
  );
  const totalWarnings = reviewEvents.reduce(
    (sum, a) => sum + (a.review_summary?.warning ?? 0),
    0
  );
  const totalSuggestions = reviewEvents.reduce(
    (sum, a) => sum + (a.review_summary?.suggestion ?? 0),
    0
  );
  const totalFindings = totalCritical + totalWarnings + totalSuggestions;

  const totalDiffSize = reviewEvents.reduce(
    (sum, a) => sum + (a.diff_size ?? 0),
    0
  );

  // PR states
  const mergedPrs = new Set(
    activity
      .filter((a) => a.pr_state === "merged" && a.pr_number)
      .map((a) => `${a.repo}:${a.pr_number}`)
  );
  const closedPrs = new Set(
    activity
      .filter((a) => a.pr_state === "closed" && a.pr_number)
      .map((a) => `${a.repo}:${a.pr_number}`)
  );
  const openPrs = new Set(
    [...allPrs].filter((k) => !mergedPrs.has(k) && !closedPrs.has(k))
  );

  // Activity timeline (last 7 days)
  const now = new Date();
  const days: { label: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dayStr = d.toISOString().split("T")[0];
    const label = d.toLocaleDateString("en", { weekday: "short" });
    const count = reviewEvents.filter(
      (a) => a.timestamp.split("T")[0] === dayStr
    ).length;
    days.push({ label, count });
  }
  const maxDayCount = Math.max(...days.map((d) => d.count), 1);

  // Top repositories
  const repoMap = new Map<string, number>();
  for (const ev of reviewEvents) {
    if (ev.repo) {
      repoMap.set(ev.repo, (repoMap.get(ev.repo) ?? 0) + 1);
    }
  }
  const topRepos = [...repoMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const maxRepoCount = Math.max(...topRepos.map((r) => r[1]), 1);

  // Severity chart max
  const maxSeverity = Math.max(totalCritical, totalWarnings, totalSuggestions, 1);

  // PR status max
  const maxPrStatus = Math.max(openPrs.size, closedPrs.size, mergedPrs.size, 1);

  return (
    <div>
      <div className="page-header">
        <h2>Insights</h2>
        <p>Analytics and metrics from AI-powered code reviews</p>
      </div>

      {/* Metric cards */}
      <div className="status-grid">
        <div className="status-card">
          <span className="label">Total PRs Reviewed</span>
          <span className="value">{totalReviewed}</span>
        </div>
        <div className="status-card">
          <span className="label">Total Tokens Used</span>
          <span className="value">
            {totalTokens > 1000
              ? `${(totalTokens / 1000).toFixed(1)}k`
              : totalTokens}
          </span>
        </div>
        <div className="status-card">
          <span className="label">Critical Issues Found</span>
          <span className="value" style={{ color: totalCritical > 0 ? "var(--error)" : undefined }}>
            {totalCritical}
          </span>
        </div>
        <div className="status-card">
          <span className="label">Total Findings</span>
          <span className="value">{totalFindings}</span>
        </div>
      </div>

      {/* Secondary metrics */}
      <div className="status-grid">
        <div className="status-card">
          <span className="label">PRs Tracked</span>
          <span className="value">{allPrs.size}</span>
        </div>
        <div className="status-card">
          <span className="label">Diff Reviewed</span>
          <span className="value">
            {totalDiffSize > 1000
              ? `${(totalDiffSize / 1000).toFixed(1)}k chars`
              : `${totalDiffSize} chars`}
          </span>
        </div>
        <div className="status-card">
          <span className="label">Warnings</span>
          <span className="value" style={{ color: totalWarnings > 0 ? "var(--warning)" : undefined }}>
            {totalWarnings}
          </span>
        </div>
        <div className="status-card">
          <span className="label">Suggestions</span>
          <span className="value" style={{ color: totalSuggestions > 0 ? "var(--success)" : undefined }}>
            {totalSuggestions}
          </span>
        </div>
      </div>

      {/* Charts row */}
      <div className="insights-charts-grid">
        {/* PR Status Breakdown */}
        <div className="card">
          <div className="card-header">
            <h2>PR Status Breakdown</h2>
          </div>
          <div className="chart-horizontal-bars">
            <div className="chart-bar-row">
              <span className="chart-bar-label">Open</span>
              <div className="chart-bar-track">
                <div
                  className="chart-bar-fill chart-bar-open"
                  style={{ width: `${(openPrs.size / maxPrStatus) * 100}%` }}
                />
              </div>
              <span className="chart-bar-value">{openPrs.size}</span>
            </div>
            <div className="chart-bar-row">
              <span className="chart-bar-label">Closed</span>
              <div className="chart-bar-track">
                <div
                  className="chart-bar-fill chart-bar-closed"
                  style={{ width: `${(closedPrs.size / maxPrStatus) * 100}%` }}
                />
              </div>
              <span className="chart-bar-value">{closedPrs.size}</span>
            </div>
            <div className="chart-bar-row">
              <span className="chart-bar-label">Merged</span>
              <div className="chart-bar-track">
                <div
                  className="chart-bar-fill chart-bar-merged"
                  style={{ width: `${(mergedPrs.size / maxPrStatus) * 100}%` }}
                />
              </div>
              <span className="chart-bar-value">{mergedPrs.size}</span>
            </div>
          </div>
        </div>

        {/* Review Severity Distribution */}
        <div className="card">
          <div className="card-header">
            <h2>Review Severity</h2>
          </div>
          <div className="chart-horizontal-bars">
            <div className="chart-bar-row">
              <span className="chart-bar-label">Critical</span>
              <div className="chart-bar-track">
                <div
                  className="chart-bar-fill chart-bar-critical"
                  style={{ width: `${(totalCritical / maxSeverity) * 100}%` }}
                />
              </div>
              <span className="chart-bar-value">{totalCritical}</span>
            </div>
            <div className="chart-bar-row">
              <span className="chart-bar-label">Warning</span>
              <div className="chart-bar-track">
                <div
                  className="chart-bar-fill chart-bar-warning"
                  style={{ width: `${(totalWarnings / maxSeverity) * 100}%` }}
                />
              </div>
              <span className="chart-bar-value">{totalWarnings}</span>
            </div>
            <div className="chart-bar-row">
              <span className="chart-bar-label">Suggestion</span>
              <div className="chart-bar-track">
                <div
                  className="chart-bar-fill chart-bar-suggestion"
                  style={{ width: `${(totalSuggestions / maxSeverity) * 100}%` }}
                />
              </div>
              <span className="chart-bar-value">{totalSuggestions}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Activity Timeline */}
      <div className="card">
        <div className="card-header">
          <h2>Activity Timeline (Last 7 Days)</h2>
        </div>
        <div className="chart-timeline">
          {days.map((day, i) => (
            <div className="chart-timeline-bar" key={i}>
              <div className="chart-timeline-bar-track">
                <div
                  className="chart-timeline-bar-fill"
                  style={{ height: `${(day.count / maxDayCount) * 100}%` }}
                />
              </div>
              <span className="chart-timeline-count">{day.count}</span>
              <span className="chart-timeline-label">{day.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Top Repositories */}
      <div className="card">
        <div className="card-header">
          <h2>Top Repositories</h2>
        </div>
        {topRepos.length === 0 ? (
          <div className="empty-state">
            <p>No repository data yet.</p>
          </div>
        ) : (
          <div className="chart-horizontal-bars">
            {topRepos.map(([repo, count]) => (
              <div className="chart-bar-row" key={repo}>
                <span className="chart-bar-label chart-bar-label-repo">
                  {repo}
                </span>
                <div className="chart-bar-track">
                  <div
                    className="chart-bar-fill chart-bar-accent"
                    style={{ width: `${(count / maxRepoCount) * 100}%` }}
                  />
                </div>
                <span className="chart-bar-value">{count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default Insights;
