import { invoke } from "../tauri";
import type { ActivityItem } from "../App";
import PrGroupRow, { groupByPr } from "../components/PrGroupRow";

interface Props {
  config: {
    github_pat: string;
    watched_repos: string[];
    selected_model: string;
    poll_interval_secs: number;
    is_polling_active: boolean;
  } | null;
  status: {
    lm_studio_online: boolean;
    github_connected: boolean;
    github_user: string | null;
    polling_active: boolean;
    watched_repos_count: number;
    rate_limit_remaining: number | null;
    rate_limit_total: number | null;
    rate_limit_reset: number | null;
  };
  activity: ActivityItem[];
  onRefresh: () => void;
  onConfigChange: () => void;
}

function formatResetTime(resetUnix: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = resetUnix - now;
  if (diff <= 0) return "resetting now";
  if (diff < 60) return `resets in ${diff}s`;
  const mins = Math.ceil(diff / 60);
  return `resets in ${mins}m`;
}

function Dashboard({ config, status, activity, onRefresh, onConfigChange }: Props) {
  const handleTogglePolling = async () => {
    if (!config) return;
    try {
      await invoke("toggle_polling", { active: !config.is_polling_active });
      onConfigChange();
      onRefresh();
    } catch (e) {
      console.error(e);
    }
  };

  const allGroups = groupByPr(activity);
  // Only show open/reopened PRs in Live Session (same logic as Activity page)
  const liveGroups = allGroups.filter((g) => !g.prState || g.prState === "reopened");

  return (
    <div>
      <div className="page-header">
        <h2>Dashboard</h2>
        <p>Overview of your local AI code review system</p>
      </div>

      <div className="status-grid">
        <div className="status-card">
          <span className="label">LM Studio</span>
          <span className="value">
            <span
              className={`status-dot ${status.lm_studio_online ? "online" : "offline"}`}
            />
            {status.lm_studio_online ? "Online" : "Offline"}
          </span>
        </div>
        <div className="status-card">
          <span className="label">GitHub</span>
          <span className="value">
            <span
              className={`status-dot ${status.github_connected ? "online" : "offline"}`}
            />
            {status.github_connected
              ? status.github_user || "Connected"
              : "Not connected"}
          </span>
        </div>
        <div className="status-card">
          <span className="label">Watched Repos</span>
          <span className="value">{status.watched_repos_count}</span>
        </div>
        <div className="status-card">
          <span className="label">API Rate Limit (per hour)</span>
          <span className="value">
            {status.rate_limit_remaining !== null
              ? `${status.rate_limit_remaining} / ${status.rate_limit_total ?? 5000}`
              : "N/A"}
          </span>
          {status.rate_limit_reset !== null && (
            <span className="label" style={{ marginTop: "2px" }}>
              {formatResetTime(status.rate_limit_reset)}
            </span>
          )}
        </div>
        <div className="status-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="label">Polling</span>
            <label className="toggle">
              <input
                type="checkbox"
                checked={config?.is_polling_active ?? false}
                onChange={handleTogglePolling}
              />
              <span className="toggle-slider" />
            </label>
          </div>
          <span className="value" style={{ fontSize: "14px" }}>
            {config?.is_polling_active
              ? `Every ${config.poll_interval_secs}s`
              : "Paused"}
          </span>
          {config?.is_polling_active && config.selected_model && (
            <span className="label" style={{ marginTop: "2px" }}>
              {config.selected_model}
            </span>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Live Session</h2>
          <span
            className="badge badge-success"
            style={{ fontSize: "11px" }}
          >
            {liveGroups.length}
          </span>
        </div>
        {liveGroups.length === 0 ? (
          <div className="empty-state">
            <div className="icon">{"\u23F3"}</div>
            <p>
              No activity yet. Enable polling and add repositories to start
              monitoring PRs.
            </p>
          </div>
        ) : (
          <div className="activity-feed">
            {liveGroups.map((group) => (
              <PrGroupRow group={group} key={group.key} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default Dashboard;
