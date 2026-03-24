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
  onConfigChange: () => void;
}

function Repos({ config, onConfigChange }: Props) {
  const [newRepo, setNewRepo] = useState("");
  const [error, setError] = useState("");

  const handleAddRepo = async () => {
    const repo = newRepo.trim();
    if (!repo) return;

    // Validate format: owner/repo
    if (!repo.match(/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/)) {
      setError("Format must be owner/repo (e.g. facebook/react)");
      return;
    }

    try {
      await invoke("add_watched_repo", { repo });
      setNewRepo("");
      setError("");
      onConfigChange();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleRemoveRepo = async (repo: string) => {
    try {
      await invoke("remove_watched_repo", { repo });
      onConfigChange();
    } catch (e) {
      console.error(e);
    }
  };

  const repos = config?.watched_repos ?? [];

  return (
    <div>
      <div className="page-header">
        <h2>Repositories</h2>
        <p>Manage which repositories are monitored for open pull requests</p>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Add Repository</h2>
        </div>
        {!config?.github_pat && (
          <p
            style={{
              fontSize: "13px",
              color: "var(--warning)",
              marginBottom: "12px",
            }}
          >
            Configure your GitHub PAT in Settings first to monitor repositories.
          </p>
        )}
        <div className="form-group">
          <label>Repository (owner/name)</label>
          <div className="form-row">
            <input
              type="text"
              placeholder="owner/repo"
              value={newRepo}
              onChange={(e) => {
                setNewRepo(e.target.value);
                setError("");
              }}
              onKeyDown={(e) => e.key === "Enter" && handleAddRepo()}
            />
            <button
              className="btn btn-primary"
              onClick={handleAddRepo}
              disabled={!newRepo.trim()}
            >
              Add
            </button>
          </div>
          {error && (
            <p
              style={{
                color: "var(--error)",
                fontSize: "12px",
                marginTop: "6px",
              }}
            >
              {error}
            </p>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Watched Repositories</h2>
          <span
            className="badge badge-success"
            style={{ fontSize: "11px" }}
          >
            {repos.length} repos
          </span>
        </div>
        {repos.length === 0 ? (
          <div className="empty-state">
            <div className="icon">{"\uD83D\uDCC1"}</div>
            <p>
              No repositories added yet. Add a repository above to start
              monitoring its pull requests.
            </p>
          </div>
        ) : (
          <ul className="repo-list">
            {repos.map((repo) => (
              <li className="repo-item" key={repo}>
                <span className="repo-name">{repo}</span>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => handleRemoveRepo(repo)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default Repos;
