import { useState } from "react";
import type { ActivityItem } from "../App";
import { invoke, openUrl } from "../tauri";

export function eventIcon(eventType: string): string {
  switch (eventType) {
    case "pr_found":
      return "\uD83D\uDD0D";
    case "reviewing":
      return "\uD83E\uDD16";
    case "review_posted":
      return "\u2705";
    case "pr_merged":
      return "\uD83D\uDFE3";
    case "pr_closed":
      return "\uD83D\uDD34";
    case "pr_reopened":
      return "\uD83D\uDD04";
    case "error":
      return "\u274C";
    case "warning":
      return "\u26A0\uFE0F";
    default:
      return "\u2139\uFE0F";
  }
}

function summaryIcon(events: ActivityItem[]): string {
  const latest = events[0];
  if (!latest) return "\uD83D\uDD0D";
  return eventIcon(latest.event_type);
}

function summaryStatus(events: ActivityItem[]): string {
  const latest = events[0];
  if (!latest) return "";
  if (latest.event_type === "pr_merged") return "Merged";
  if (latest.event_type === "pr_closed") return "Closed";
  if (latest.event_type === "pr_reopened") return "Reopened";
  if (latest.event_type === "review_posted") return "Review posted";
  if (latest.event_type === "reviewing") return "Reviewing...";
  if (latest.event_type === "error") return "Error";
  return "Found";
}

export interface PrGroup {
  key: string;
  repo: string;
  prNumber: number;
  htmlUrl?: string;
  events: ActivityItem[];
  prState?: "closed" | "merged" | "reopened";
}

export function groupByPr(items: ActivityItem[]): PrGroup[] {
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
    // Use the latest (most recent) pr_state — activity is newest-first
    if (item.pr_state && !group.prState) {
      group.prState = item.pr_state;
    }
  }
  // Sort events newest-first so events[0] is always the latest
  for (const group of groups.values()) {
    group.events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }
  return [...groups.values()];
}

interface Props {
  group: PrGroup;
  showState?: boolean;
}

export default function PrGroupRow({ group, showState }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const latest = group.events[0];

  const handleReReview = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (reviewing) return;
    setReviewing(true);
    try {
      await invoke("re_review_pr", { repo: group.repo, prNumber: group.prNumber });
    } catch (err) {
      console.error("Re-review failed:", err);
    } finally {
      setReviewing(false);
    }
  };

  return (
    <div className="pr-group">
      <div
        className="pr-group-summary"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="event-icon">{summaryIcon(group.events)}</span>
        <span className="message">
          <a
            className="pr-link"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              const url = group.htmlUrl || `https://github.com/${group.repo}/pull/${group.prNumber}`;
              openUrl(url);
            }}
            href={group.htmlUrl || `https://github.com/${group.repo}/pull/${group.prNumber}`}
          >
            PR #{group.prNumber}
          </a>
          {" — "}
          {summaryStatus(group.events)}
        </span>
        {showState && group.prState && (
          <span
            className={`badge ${
              group.prState === "merged"
                ? "badge-merged"
                : group.prState === "reopened"
                  ? "badge-reopened"
                  : "badge-closed"
            }`}
          >
            {group.prState}
          </span>
        )}
        <span className="repo-tag">{group.repo}</span>
        <button
          className="btn-icon"
          title="Re-review PR"
          aria-label="Re-review PR"
          onClick={handleReReview}
          disabled={reviewing}
        >
          {reviewing ? "\u23F3" : "\u21BB"}
        </button>
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
