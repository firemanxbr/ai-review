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

function summaryIcon(events: ActivityItem[]): string {
  const types = events.map((e) => e.event_type);
  if (types.includes("error")) return "\u274C";
  if (types.includes("review_posted")) return "\u2705";
  if (types.includes("reviewing")) return "\uD83E\uDD16";
  return "\uD83D\uDD0D";
}

function summaryMessage(events: ActivityItem[]): string {
  const latest = events[0];
  if (!latest) return "";
  if (latest.event_type === "review_posted")
    return `PR #${latest.pr_number} — Review posted`;
  if (latest.event_type === "reviewing")
    return `PR #${latest.pr_number} — Reviewing...`;
  if (latest.event_type === "error")
    return `PR #${latest.pr_number} — Error`;
  return `PR #${latest.pr_number} — Found`;
}

interface PrGroup {
  key: string;
  repo: string;
  prNumber: number;
  htmlUrl?: string;
  events: ActivityItem[];
}

function groupByPr(items: ActivityItem[]): PrGroup[] {
  const groups = new Map<string, PrGroup>();
  for (const item of items) {
    if (!item.pr_number) continue;
    const key = `${item.repo}:${item.pr_number}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        repo: item.repo,
        prNumber: item.pr_number,
        htmlUrl: item.html_url,
        events: [],
      });
    }
    const group = groups.get(key)!;
    group.events.push(item);
    if (item.html_url && !group.htmlUrl) {
      group.htmlUrl = item.html_url;
    }
  }
  // Items without pr_number as individual groups
  const standalone: PrGroup[] = items
    .filter((i) => !i.pr_number)
    .map((i, idx) => ({
      key: `standalone-${idx}`,
      repo: i.repo,
      prNumber: 0,
      events: [i],
    }));
  return [...groups.values(), ...standalone];
}

function PrGroupRow({ group }: { group: PrGroup }) {
  const [expanded, setExpanded] = useState(false);
  const latest = group.events[0];

  if (group.prNumber === 0) {
    // Standalone event (no PR number, e.g. warnings)
    return (
      <div className="activity-item">
        <span className="event-icon">{eventIcon(latest.event_type)}</span>
        <span className="message">{latest.message}</span>
        {latest.repo && <span className="repo-tag">{latest.repo}</span>}
        <span className="timestamp">
          {new Date(latest.timestamp).toLocaleTimeString()}
        </span>
      </div>
    );
  }

  return (
    <div className="pr-group">
      <div
        className="pr-group-summary"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="event-icon">{summaryIcon(group.events)}</span>
        <span className="message">
          {group.htmlUrl ? (
            <a
              href={group.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="pr-link"
              onClick={(e) => e.stopPropagation()}
            >
              PR #{group.prNumber}
            </a>
          ) : (
            `PR #${group.prNumber}`
          )}
          {" — "}
          {summaryMessage(group.events).split(" — ")[1]}
        </span>
        <span className="repo-tag">{group.repo}</span>
        <span className="timestamp">
          {new Date(latest.timestamp).toLocaleTimeString()}
        </span>
        <span className={`chevron ${expanded ? "expanded" : ""}`}>
          {"\u25B6"}
        </span>
      </div>
      {expanded && (
        <div className="pr-group-details">
          {group.events.map((item, i) => (
            <div className="activity-item detail-item" key={i}>
              <span className="event-icon">{eventIcon(item.event_type)}</span>
              <span className="message">{item.message}</span>
              <span className="timestamp">
                {new Date(item.timestamp).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DbGroupRow({ group }: { group: { key: string; prNumber: number; repo: string; events: DbActivity[] } }) {
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

function groupDbByPr(items: DbActivity[]): { key: string; prNumber: number; repo: string; events: DbActivity[] }[] {
  const groups = new Map<string, { key: string; prNumber: number; repo: string; events: DbActivity[] }>();
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

  return (
    <div>
      <div className="page-header">
        <h2>Activity Log</h2>
        <p>Real-time and historical activity from PR monitoring</p>
      </div>

      {liveGroups.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2>Live Session</h2>
            <span className="badge badge-success">
              {liveGroups.length} PR(s)
            </span>
          </div>
          <div className="activity-feed">
            {liveGroups.map((group) => (
              <PrGroupRow group={group} key={group.key} />
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <h2>Merged & Completed</h2>
          <span className="badge badge-success">
            {dbGroups.length} reviews
          </span>
        </div>
        {dbGroups.length === 0 ? (
          <div className="empty-state">
            <div className="icon">{"\uD83D\uDCDC"}</div>
            <p>
              No completed reviews yet. Reviews will appear here once PRs are
              merged.
            </p>
          </div>
        ) : (
          <div className="activity-feed">
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
