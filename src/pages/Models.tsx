import { useState, useEffect } from "react";
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
  };
  onConfigChange: () => void;
}

function Models({ config, status, onConfigChange }: Props) {
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchModels = async () => {
    setLoading(true);
    setError("");
    try {
      const list = await invoke<string[]>("list_models");
      setModels(list);
    } catch (e) {
      setError(String(e));
      setModels([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (status.lm_studio_online) {
      fetchModels();
    }
  }, [status.lm_studio_online]);

  const handleSelectModel = async (model: string) => {
    try {
      await invoke("set_selected_model", { model });
      onConfigChange();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Models</h2>
        <p>Select which LM Studio model to use for code reviews</p>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Available Models</h2>
          <button
            className="btn btn-secondary btn-sm"
            onClick={fetchModels}
            disabled={loading || !status.lm_studio_online}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {!status.lm_studio_online ? (
          <div className="empty-state">
            <div className="icon">{"\u26A0\uFE0F"}</div>
            <p>
              LM Studio is not running. Start LM Studio and load a model to see
              available options.
            </p>
          </div>
        ) : error ? (
          <div className="empty-state">
            <div className="icon">{"\u274C"}</div>
            <p>{error}</p>
          </div>
        ) : models.length === 0 ? (
          <div className="empty-state">
            <div className="icon">{"\uD83E\uDD16"}</div>
            <p>
              No models loaded in LM Studio. Load a model in LM Studio to use it
              for code reviews.
            </p>
          </div>
        ) : (
          <div className="model-grid">
            {models.map((model) => (
              <div
                key={model}
                className={`model-item ${config?.selected_model === model ? "selected" : ""}`}
                onClick={() => handleSelectModel(model)}
              >
                <div className="radio" />
                <span className="model-name">{model}</span>
              </div>
            ))}
          </div>
        )}

        {config?.selected_model && (
          <p
            style={{
              fontSize: "12px",
              color: "var(--text-muted)",
              marginTop: "12px",
            }}
          >
            Currently selected: <strong>{config.selected_model}</strong>
          </p>
        )}
      </div>
    </div>
  );
}

export default Models;
