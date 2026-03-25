import { useState, useEffect } from "react";
import { invoke } from "../tauri";
import type { ActivityItem } from "../App";
import PrGroupRow, { groupByPr, eventIcon } from "../components/PrGroupRow";

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

function DbGroupRow({ group }: { group: { key: string; prNumber: number; repo: string; prState?: "closed" | "merged"; events: DbActivity[] } }) {
  const [expanded, setExpanded] = useState(false);
  const latest = group.events[0];

  if (group.prNumber === 0) {
    return (
      <div className="activity-item">
        <span className="event-icon">{eventIcon(latest.event_type)}</span>
        <span className="message">{latest.message}</span>
        {latest.repo && <span className="repo-tag">{latest.repo}</span>}
        <span className="timestamp">
          {new Date(latest.created_at).toLocaleString()}
        </span>
      </div>
    );
  }

  const types = group.events.map((e) => e.event_type);
  const icon = types.includes("error") ? "\u274C" : types.includes("review_posted") ? "\u2705" : types.includes("reviewing") ? "\uD83E\uDD16" : "\uD83D\uDD0D";
  const statusText = types.includes("error") ? "Error" : types.includes("review_posted") ? "Review posted" : types.includes("reviewing") ? "Reviewing..." : "Found";
  const prUrl = `https://github.com/${group.repo}/pull/${group.prNumber}`;

  return (
    <div className="pr-group">
      <div className="pr-group-summary" onClick={() => setExpanded(!expanded)}>
        <span className="event-icon">{icon}</span>
        <span className="message">
          <a href={prUrl} target="_blank" rel="noopener noreferrer" className="pr-link" onClick={(e) => e.stopPropagation()}>
            PR #{group.prNumber}
          </a>
          {" — "}{statusText}
        </span>
        {group.prState && (
          <span className={`badge ${group.prState === "merged" ? "badge-merged" : "badge-closed"}`}>
            {group.prState}
          </span>
        )}
        <span className="repo-tag">{group.repo}</span>
        <span className="timestamp">{new Date(latest.created_at).toLocaleString()}</span>
        <span className={`chevron ${expanded ? "expanded" : ""}`}>{"\u25B6"}</span>
      </div>
      {expanded && (
        <div className="pr-group-details">
          {group.events.map((item) => (
            <div className="activity-item detail-item" key={item.id}>
              <span className="event-icon">{eventIcon(item.event_type)}</span>
              <span className="message">{item.message}</span>
              <span className="timestamp">{new Date(item.created_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function groupDbByPr(items: DbActivity[]): { key: string; prNumber: number; repo: string; prState?: "closed" | "merged"; events: DbActivity[] }[] {
  const groups = new Map<string, { key: string; prNumber: number; repo: string; prState?: "closed" | "merged"; events: DbActivity[] }>();
  for (const item of items) {
    const pr = item.pr_number ?? 0;
    const key = pr ? `${item.repo}:${pr}` : `standalone-${item.id}`;
    if (!groups.has(key)) {
      groups.set(key, { key, prNumber: pr, repo: item.repo, events: [] });
    }
    groups.get(key)!.events.push(item);
  }
  return [...groups.values()];
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

  const liveGroups = groupByPr(liveActivity);
  const dbGroups = groupDbByPr(dbActivity);

  // Separate live groups: PRs with pr_state (closed/merged) go to history
  const activeLiveGroups = liveGroups.filter((g) => !g.prState);
  const closedLiveGroups = liveGroups.filter((g) => !!g.prState);

  return (
    <div>
      <div className="page-header">
        <h2>Activity Log</h2>
        <p>Real-time and historical activity from PR monitoring</p>
      </div>

      {activeLiveGroups.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2>Live Session</h2>
            <span className="badge badge-success">
              {activeLiveGroups.length} PR(s)
            </span>
          </div>
          <div className="activity-feed">
            {activeLiveGroups.map((group) => (
              <PrGroupRow group={group} key={group.key} />
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <h2>History</h2>
          <span className="badge badge-success">
            {closedLiveGroups.length + dbGroups.length} reviews
          </span>
        </div>
        {closedLiveGroups.length === 0 && dbGroups.length === 0 ? (
          <div className="empty-state">
            <div className="icon">{"\uD83D\uDCDC"}</div>
            <p>
              No history yet. Closed and merged PRs will appear here.
            </p>
          </div>
        ) : (
          <div className="activity-feed">
            {closedLiveGroups.map((group) => (
              <PrGroupRow group={group} showState key={group.key} />
            ))}
            {dbGroups.map((group) => (
              <DbGroupRow group={group} key={group.key} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default Activity;
