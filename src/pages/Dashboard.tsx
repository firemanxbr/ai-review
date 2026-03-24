import { invoke } from "../tauri";
import type { ActivityItem } from "../App";

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
  };
  activity: ActivityItem[];
  onRefresh: () => void;
  onConfigChange: () => void;
}

function eventIcon(eventType: string): string {
  switch (eventType) {
    case "pr_found":
      return "\uD83D\uDD0D";
    case "reviewing":
      return "\uD83E\uDD16";
    case "review_posted":
      return "\u2705";
    case "error":
      return "\u274C";
    case "warning":
      return "\u26A0\uFE0F";
    default:
      return "\u2139\uFE0F";
  }
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
          <span className="label">API Rate Limit</span>
          <span className="value">
            {status.rate_limit_remaining !== null
              ? `${status.rate_limit_remaining} / 5000`
              : "N/A"}
          </span>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Polling Control</h2>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span
              className={`badge ${config?.is_polling_active ? "badge-success" : "badge-warning"}`}
            >
              {config?.is_polling_active ? "Active" : "Paused"}
            </span>
            <label className="toggle">
              <input
                type="checkbox"
                checked={config?.is_polling_active ?? false}
                onChange={handleTogglePolling}
              />
              <span className="toggle-slider" />
            </label>
          </div>
        </div>
        <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
          {config?.is_polling_active
            ? `Checking ${config.watched_repos.length} repo(s) every ${config.poll_interval_secs}s using model "${config.selected_model || "none selected"}"`
            : "Enable polling to start monitoring PRs for code review"}
        </p>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Live Activity</h2>
          <span
            className="badge badge-success"
            style={{ fontSize: "11px" }}
          >
            {activity.length} events
          </span>
        </div>
        {activity.length === 0 ? (
          <div className="empty-state">
            <div className="icon">{"\u23F3"}</div>
            <p>
              No activity yet. Enable polling and add repositories to start
              monitoring PRs.
            </p>
          </div>
        ) : (
          <div className="activity-feed">
            {activity.slice(0, 20).map((item, i) => (
              <div className="activity-item" key={i}>
                <span className="event-icon">{eventIcon(item.event_type)}</span>
                <span className="message">{item.message}</span>
                {item.repo && <span className="repo-tag">{item.repo}</span>}
                <span className="timestamp">
                  {new Date(item.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default Dashboard;
