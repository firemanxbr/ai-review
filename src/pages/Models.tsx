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

interface ModelDetail {
  id: string;
  state: string;
  quantization: string;
  max_context_length: number;
  type: string;
}

function formatCtx(n: number): string {
  if (n >= 1048576) return `${(n / 1048576).toFixed(0)}M`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)}K`;
  return `${n}`;
}

function Models({ config, status, onConfigChange }: Props) {
  const [models, setModels] = useState<ModelDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionId, setActionId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [downloadMsg, setDownloadMsg] = useState("");

  const fetchModels = async () => {
    setLoading(true);
    setError("");
    try {
      const list = await invoke<ModelDetail[]>("list_models_detailed");
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
      const interval = setInterval(fetchModels, 10000);
      return () => clearInterval(interval);
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

  const handleLoadModel = async (modelId: string) => {
    setActionId(modelId);
    try {
      await invoke("load_model", { modelId });
      await fetchModels();
    } catch (e) {
      console.error("Load failed:", e);
    } finally {
      setActionId(null);
    }
  };

  const handleUnloadModel = async (modelId: string) => {
    setActionId(modelId);
    try {
      await invoke("unload_model", { modelId });
      await fetchModels();
    } catch (e) {
      console.error("Unload failed:", e);
    } finally {
      setActionId(null);
    }
  };

  const handleDownload = async () => {
    if (!searchQuery.trim()) return;
    setDownloading(true);
    setDownloadMsg("");
    try {
      const result = await invoke<string>("download_model", { modelId: searchQuery.trim() });
      setDownloadMsg(result || "Download complete");
      setSearchQuery("");
      await fetchModels();
    } catch (e) {
      setDownloadMsg(`Error: ${e}`);
    } finally {
      setDownloading(false);
    }
  };

  const loadedModels = models.filter((m) => m.state === "loaded");
  const downloadedModels = models.filter((m) => m.state !== "loaded");

  return (
    <div>
      <div className="page-header">
        <h2>Models</h2>
        <p>Manage LM Studio models for code reviews</p>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Search & Download</h2>
        </div>
        <p
          style={{
            fontSize: "13px",
            color: "var(--text-secondary)",
            marginBottom: "12px",
          }}
        >
          Download a model from the LM Studio catalog. Use names like{" "}
          <code style={{ color: "var(--accent)" }}>qwen3.5-27b</code>,{" "}
          <code style={{ color: "var(--accent)" }}>devstral-small</code>, or{" "}
          <code style={{ color: "var(--accent)" }}>gemma-3-12b</code>.
        </p>
        <div className="form-row">
          <input
            type="text"
            placeholder="Model name (e.g. qwen3.5-27b)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleDownload()}
          />
          <button
            className="btn btn-primary"
            onClick={handleDownload}
            disabled={!searchQuery.trim() || downloading || !status.lm_studio_online}
          >
            {downloading ? "Downloading..." : "Download"}
          </button>
        </div>
        {downloadMsg && (
          <p
            style={{
              fontSize: "12px",
              color: downloadMsg.startsWith("Error") ? "var(--error)" : "var(--success)",
              marginTop: "8px",
              whiteSpace: "pre-wrap",
            }}
          >
            {downloadMsg}
          </p>
        )}
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Loaded Models</h2>
          <span className="badge badge-success">{loadedModels.length}</span>
        </div>
        {!status.lm_studio_online ? (
          <div className="empty-state">
            <div className="icon">{"\u26A0\uFE0F"}</div>
            <p>LM Studio is not running.</p>
          </div>
        ) : loadedModels.length === 0 ? (
          <div className="empty-state">
            <div className="icon">{"\uD83E\uDD16"}</div>
            <p>No models loaded. Load a model from the list below.</p>
          </div>
        ) : (
          <div className="model-grid">
            {loadedModels.map((model) => (
              <div
                key={model.id}
                className={`model-item ${config?.selected_model === model.id ? "selected" : ""}`}
                onClick={() => handleSelectModel(model.id)}
              >
                <div className="radio" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span className="model-name">{model.id}</span>
                  <div className="model-meta">
                    {model.quantization} · {formatCtx(model.max_context_length)} ctx
                  </div>
                </div>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleUnloadModel(model.id);
                  }}
                  disabled={actionId === model.id}
                >
                  {actionId === model.id ? "..." : "Eject"}
                </button>
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
            Selected for reviews: <strong>{config.selected_model}</strong>
          </p>
        )}
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Downloaded Models</h2>
          <button
            className="btn btn-secondary btn-sm"
            onClick={fetchModels}
            disabled={loading || !status.lm_studio_online}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
        {error ? (
          <div className="empty-state">
            <div className="icon">{"\u274C"}</div>
            <p>{error}</p>
          </div>
        ) : downloadedModels.length === 0 ? (
          <div className="empty-state">
            <div className="icon">{"\uD83D\uDCE6"}</div>
            <p>All models are loaded, or none downloaded yet.</p>
          </div>
        ) : (
          <div className="model-grid">
            {downloadedModels.map((model) => (
              <div
                key={model.id}
                className="model-item"
                style={{ cursor: "default" }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span className="model-name">{model.id}</span>
                  <div className="model-meta">
                    {model.quantization} · {formatCtx(model.max_context_length)} ctx
                  </div>
                </div>
                <button
                  className="btn btn-success btn-sm"
                  onClick={() => handleLoadModel(model.id)}
                  disabled={actionId === model.id}
                >
                  {actionId === model.id ? "Loading..." : "Load"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default Models;
