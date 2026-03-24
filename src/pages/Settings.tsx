import { useState } from "react";
import { invoke } from "../tauri";

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
  };
  onConfigChange: () => void;
}

const INTERVALS = [5, 10, 30, 60];

function Settings({ config, status, onConfigChange }: Props) {
  const [pat, setPat] = useState("");
  const [patStatus, setPatStatus] = useState<
    "idle" | "validating" | "success" | "error"
  >("idle");
  const [patMessage, setPatMessage] = useState("");

  const handleSavePat = async () => {
    if (!pat.trim()) return;
    setPatStatus("validating");
    try {
      const user = await invoke<string>("validate_github_pat", { pat });
      await invoke("save_github_pat", { pat });
      setPatStatus("success");
      setPatMessage(`Connected as ${user}`);
      setPat("");
      onConfigChange();
    } catch (e) {
      setPatStatus("error");
      setPatMessage(String(e));
    }
  };

  const handleSetInterval = async (secs: number) => {
    try {
      await invoke("set_poll_interval", { seconds: secs });
      onConfigChange();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Settings</h2>
        <p>Configure your GitHub connection and polling preferences</p>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>GitHub Personal Access Token</h2>
          <span
            className={`badge ${status.github_connected ? "badge-success" : "badge-error"}`}
          >
            {status.github_connected
              ? `Connected (${status.github_user})`
              : "Not connected"}
          </span>
        </div>
        <p
          style={{
            fontSize: "13px",
            color: "var(--text-secondary)",
            marginBottom: "12px",
          }}
        >
          Create a fine-grained token at github.com/settings/tokens with
          pull_requests (read/write) and contents (read) permissions.
        </p>
        <div className="form-group">
          <label>Personal Access Token</label>
          <div className="form-row">
            <input
              type="password"
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              value={pat}
              onChange={(e) => {
                setPat(e.target.value);
                setPatStatus("idle");
              }}
            />
            <button
              className="btn btn-primary"
              onClick={handleSavePat}
              disabled={!pat.trim() || patStatus === "validating"}
            >
              {patStatus === "validating" ? "Validating..." : "Save & Validate"}
            </button>
          </div>
          {patStatus === "success" && (
            <p style={{ color: "var(--success)", fontSize: "12px", marginTop: "6px" }}>
              {patMessage}
            </p>
          )}
          {patStatus === "error" && (
            <p style={{ color: "var(--error)", fontSize: "12px", marginTop: "6px" }}>
              {patMessage}
            </p>
          )}
        </div>
        {config?.github_pat && (
          <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            Token stored securely in local database. Starts with{" "}
            {config.github_pat.substring(0, 8)}...
          </p>
        )}
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Polling Interval</h2>
        </div>
        <p
          style={{
            fontSize: "13px",
            color: "var(--text-secondary)",
            marginBottom: "12px",
          }}
        >
          How often to check for new pull requests. Lower values use more API
          rate limit.
        </p>
        <div className="interval-options">
          {INTERVALS.map((secs) => (
            <div
              key={secs}
              className={`interval-option ${config?.poll_interval_secs === secs ? "selected" : ""}`}
              onClick={() => handleSetInterval(secs)}
            >
              {secs < 60 ? `${secs}s` : `${secs / 60}m`}
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>LM Studio</h2>
          <span
            className={`badge ${status.lm_studio_online ? "badge-success" : "badge-error"}`}
          >
            {status.lm_studio_online ? "Online" : "Offline"}
          </span>
        </div>
        <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
          {status.lm_studio_online
            ? "LM Studio is running and reachable at localhost:1234"
            : "LM Studio is not running. Start it and load a model to enable AI reviews."}
        </p>
      </div>
    </div>
  );
}

export default Settings;
