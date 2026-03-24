import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";
import Repos from "./pages/Repos";
import Activity from "./pages/Activity";
import Models from "./pages/Models";

interface AppConfig {
  github_pat: string;
  watched_repos: string[];
  selected_model: string;
  poll_interval_secs: number;
  is_polling_active: boolean;
  lm_studio_url: string;
}

interface Status {
  lm_studio_online: boolean;
  github_connected: boolean;
  github_user: string | null;
  polling_active: boolean;
  watched_repos_count: number;
  rate_limit_remaining: number | null;
}

export interface ActivityItem {
  event_type: string;
  repo: string;
  pr_number: number | null;
  message: string;
  timestamp: string;
}

const defaultStatus: Status = {
  lm_studio_online: false,
  github_connected: false,
  github_user: null,
  polling_active: false,
  watched_repos_count: 0,
  rate_limit_remaining: null,
};

type Page = "dashboard" | "repos" | "models" | "activity" | "settings";

const NAV_ITEMS: { id: Page; label: string; icon: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: "\u25A3" },
  { id: "repos", label: "Repositories", icon: "\u2691" },
  { id: "models", label: "Models", icon: "\u2699" },
  { id: "activity", label: "Activity", icon: "\u2261" },
  { id: "settings", label: "Settings", icon: "\u2638" },
];

function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [status, setStatus] = useState<Status>(defaultStatus);
  const [liveActivity, setLiveActivity] = useState<ActivityItem[]>([]);

  const refreshConfig = useCallback(async () => {
    try {
      const cfg = await invoke<AppConfig>("get_config");
      setConfig(cfg);
    } catch (e) {
      console.error("Failed to load config:", e);
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await invoke<Status>("get_status");
      setStatus(s);
    } catch (e) {
      console.error("Failed to load status:", e);
    }
  }, []);

  useEffect(() => {
    refreshConfig();
    refreshStatus();
    const interval = setInterval(refreshStatus, 5000);
    return () => clearInterval(interval);
  }, [refreshConfig, refreshStatus]);

  useEffect(() => {
    const unlisten = listen<ActivityItem>("activity", (event) => {
      setLiveActivity((prev) => [event.payload, ...prev].slice(0, 100));
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const renderPage = () => {
    switch (page) {
      case "dashboard":
        return (
          <Dashboard
            config={config}
            status={status}
            activity={liveActivity}
            onRefresh={refreshStatus}
          />
        );
      case "repos":
        return <Repos config={config} onConfigChange={refreshConfig} />;
      case "models":
        return (
          <Models
            config={config}
            status={status}
            onConfigChange={refreshConfig}
          />
        );
      case "activity":
        return <Activity liveActivity={liveActivity} />;
      case "settings":
        return (
          <Settings
            config={config}
            status={status}
            onConfigChange={refreshConfig}
          />
        );
    }
  };

  return (
    <div className="app-layout">
      <nav className="sidebar">
        <div className="sidebar-header">
          <h1>
            AI Review <span className="version">v0.1</span>
          </h1>
        </div>
        {NAV_ITEMS.map((item) => (
          <div
            key={item.id}
            className={`nav-item ${page === item.id ? "active" : ""}`}
            onClick={() => setPage(item.id)}
          >
            <span className="icon">{item.icon}</span>
            {item.label}
          </div>
        ))}
        <div className="sidebar-status">
          <div className="status-row">
            <span
              className={`status-dot ${status.lm_studio_online ? "online" : "offline"}`}
            />
            LM Studio
          </div>
          <div className="status-row">
            <span
              className={`status-dot ${status.github_connected ? "online" : "offline"}`}
            />
            GitHub
            {status.github_user && (
              <span style={{ color: "var(--text-muted)" }}>
                ({status.github_user})
              </span>
            )}
          </div>
          <div className="status-row">
            <span
              className={`status-dot ${status.polling_active ? "online" : "warning"}`}
            />
            {status.polling_active ? "Polling active" : "Polling paused"}
          </div>
        </div>
      </nav>
      <main className="main-content">{renderPage()}</main>
    </div>
  );
}

export default App;
