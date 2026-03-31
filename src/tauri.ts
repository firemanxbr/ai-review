import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const STORAGE_KEY = "ai-review-config";

interface BrowserConfig {
  github_pat: string;
  watched_repos: string[];
  selected_model: string;
  poll_interval_secs: number;
  is_polling_active: boolean;
  lm_studio_url: string;
}

function loadConfig(): BrowserConfig {
  const defaults: BrowserConfig = {
    github_pat: "",
    watched_repos: [],
    selected_model: "",
    poll_interval_secs: 10,
    is_polling_active: false,
    lm_studio_url: "http://localhost:1234",
  };
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...defaults, ...JSON.parse(stored) };
    }
  } catch {
    // localStorage not available or corrupt
  }
  return defaults;
}

function saveConfig(config: BrowserConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // localStorage not available
  }
}

let browserConfig = loadConfig();

async function validatePatDirect(pat: string): Promise<string> {
  const resp = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github.v3+json",
    },
  });
  if (!resp.ok) throw new Error(`Invalid token: HTTP ${resp.status}`);
  const user = await resp.json();
  return user.login;
}

async function getStatusDirect(): Promise<{
  lm_studio_online: boolean;
  github_connected: boolean;
  github_user: string | null;
  polling_active: boolean;
  watched_repos_count: number;
  rate_limit_remaining: number | null;
  rate_limit_total: number | null;
  rate_limit_reset: number | null;
}> {
  let lmOnline = false;
  try {
    const resp = await fetch("/lmstudio/v1/models");
    lmOnline = resp.ok;
  } catch {
    // LM Studio not reachable
  }

  let ghConnected = false;
  let ghUser: string | null = null;
  let rateRemaining: number | null = null;
  let rateTotal: number | null = null;
  let rateReset: number | null = null;

  if (browserConfig.github_pat) {
    try {
      ghUser = await validatePatDirect(browserConfig.github_pat);
      ghConnected = true;
      const rateResp = await fetch("https://api.github.com/rate_limit", {
        headers: {
          Authorization: `Bearer ${browserConfig.github_pat}`,
          Accept: "application/vnd.github.v3+json",
        },
      });
      if (rateResp.ok) {
        const data = await rateResp.json();
        rateRemaining = data.resources?.core?.remaining ?? null;
        rateTotal = data.resources?.core?.limit ?? null;
        rateReset = data.resources?.core?.reset ?? null;
      }
    } catch {
      // Token invalid
    }
  }

  return {
    lm_studio_online: lmOnline,
    github_connected: ghConnected,
    github_user: ghUser,
    polling_active: browserConfig.is_polling_active,
    watched_repos_count: browserConfig.watched_repos.length,
    rate_limit_remaining: rateRemaining,
    rate_limit_total: rateTotal,
    rate_limit_reset: rateReset,
  };
}

// Browser-mode command handlers
const browserHandlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  get_config: () => ({ ...browserConfig }),
  save_github_pat: (args) => {
    browserConfig.github_pat = args.pat as string;
    saveConfig(browserConfig);
  },
  validate_github_pat: async (args) => {
    return await validatePatDirect(args.pat as string);
  },
  set_watched_repos: (args) => {
    browserConfig.watched_repos = args.repos as string[];
    saveConfig(browserConfig);
  },
  add_watched_repo: (args) => {
    const repo = args.repo as string;
    if (!browserConfig.watched_repos.includes(repo)) {
      browserConfig.watched_repos.push(repo);
    }
    saveConfig(browserConfig);
  },
  remove_watched_repo: (args) => {
    browserConfig.watched_repos = browserConfig.watched_repos.filter(
      (r) => r !== (args.repo as string)
    );
    saveConfig(browserConfig);
  },
  set_selected_model: (args) => {
    browserConfig.selected_model = args.model as string;
    saveConfig(browserConfig);
  },
  set_poll_interval: (args) => {
    browserConfig.poll_interval_secs = args.seconds as number;
    saveConfig(browserConfig);
  },
  toggle_polling: (args) => {
    browserConfig.is_polling_active = args.active as boolean;
    saveConfig(browserConfig);
  },
  get_status: async () => {
    return await getStatusDirect();
  },
  check_lmstudio: async () => {
    try {
      const resp = await fetch("/lmstudio/v1/models");
      return resp.ok;
    } catch {
      return false;
    }
  },
  list_models: async () => {
    const resp = await fetch("/lmstudio/v1/models");
    const data = await resp.json();
    return (data.data || []).map((m: { id: string }) => m.id);
  },
  get_activity: () => [],
  get_db_info: () => ({ path: "browser-mode (localStorage)", size_bytes: 0 }),
  reset_database: () => {
    localStorage.removeItem("ai-review-activity");
    localStorage.removeItem("ai-review-tracked-prs");
    localStorage.removeItem("ai-review-reviewed");
  },
  set_polling_on_startup: (args) => {
    const cfg = { ...browserConfig, polling_on_startup: args.enabled as boolean };
    saveConfig(cfg);
  },
  re_review_pr: async (args) => {
    const { reReviewPr } = await import("./browser-poller");
    return reReviewPr(
      args.repo as string,
      args.pr_number as number,
      browserConfig.github_pat,
      browserConfig.selected_model,
    );
  },
};

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri) {
    return tauriInvoke<T>(cmd, args);
  }
  const handler = browserHandlers[cmd];
  if (!handler) {
    throw new Error(`No browser handler for command: ${cmd}`);
  }
  return (await handler(args || {})) as T;
}

export async function openUrl(url: string): Promise<void> {
  if (isTauri) {
    await tauriOpenUrl(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export async function listen<T>(
  event: string,
  handler: (event: { payload: T }) => void
): Promise<() => void> {
  if (isTauri) {
    return tauriListen<T>(event, handler);
  }
  // No-op in browser mode — no real-time events without Tauri
  return () => {};
}
