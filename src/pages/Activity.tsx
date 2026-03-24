import { useState, useEffect } from "react";
import { invoke } from "../tauri";
import type { ActivityItem } from "../App";

interface DbActivity {
  id: number;
  event_type: string;
  repo: string;
  pr_number: number | null;
  message: string;
  created_at: string;
}

interface Props {
  liveActivity: ActivityItem[];
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

function Activity({ liveActivity }: Props) {
  const [dbActivity, setDbActivity] = useState<DbActivity[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const items = await invoke<DbActivity[]>("get_activity", {
          limit: 100,
        });
        setDbActivity(items);
      } catch (e) {
        console.error(e);
      }
    };
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      <div className="page-header">
        <h2>Activity Log</h2>
        <p>Real-time and historical activity from PR monitoring</p>
      </div>

      {liveActivity.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2>Live Session</h2>
            <span className="badge badge-success">
              {liveActivity.length} events
            </span>
          </div>
          <div className="activity-feed">
            {liveActivity.map((item, i) => (
              <div className="activity-item" key={`live-${i}`}>
                <span className="event-icon">
                  {eventIcon(item.event_type)}
                </span>
                <span className="message">{item.message}</span>
                {item.repo && <span className="repo-tag">{item.repo}</span>}
                <span className="timestamp">
                  {new Date(item.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <h2>History</h2>
          <span className="badge badge-success">
            {dbActivity.length} records
          </span>
        </div>
        {dbActivity.length === 0 ? (
          <div className="empty-state">
            <div className="icon">{"\uD83D\uDCDC"}</div>
            <p>
              No historical activity yet. Reviews will appear here once PRs are
              processed.
            </p>
          </div>
        ) : (
          <div className="activity-feed">
            {dbActivity.map((item) => (
              <div className="activity-item" key={`db-${item.id}`}>
                <span className="event-icon">
                  {eventIcon(item.event_type)}
                </span>
                <span className="message">{item.message}</span>
                {item.repo && <span className="repo-tag">{item.repo}</span>}
                <span className="timestamp">
                  {new Date(item.created_at).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default Activity;
