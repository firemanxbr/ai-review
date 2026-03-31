# AI Review

> **Privacy-first, local AI code review platform for macOS.**

Monitors GitHub repositories for open pull requests and automatically generates code reviews using LM Studio — entirely on your machine.

## How It Works

1. **Pull** — Polls GitHub for new/updated PRs on watched repositories
2. **Work** — Sends PR diffs to a local LM Studio model for analysis
3. **Push** — Posts structured review comments back to the GitHub PR

No cloud services, no subscriptions, no data leaving your machine.

## Prerequisites

- **macOS** (uses native WebKit via Tauri)
- **[LM Studio](https://lmstudio.ai)** — installed and running with a loaded model
- **GitHub Personal Access Token** — fine-grained, with `pull_requests: read/write` and `contents: read`
- **Rust** (1.77+) and **Node.js** (18+) for building from source

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Shell | Tauri 2.0 |
| Frontend | React + TypeScript |
| Backend | Rust (tokio async) |
| Database | SQLite (via rusqlite) |
| AI | LM Studio (OpenAI-compatible API) |

## Getting Started

```bash
# Clone
git clone https://github.com/firemanxbr/ai-review.git
cd ai-review

# Install frontend dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

## Dashboard Features

- **Setup Wizard** — GitHub PAT validation, LM Studio health check, repo configuration
- **Live Activity Feed** — Real-time events from PR polling and review submission
- **Model Picker** — Select from any model loaded in LM Studio
- **Repository Management** — Add/remove watched repositories
- **Polling Control** — Start/stop monitoring, configurable interval (5s/10s/30s/60s)
- **Rate Limit Display** — GitHub API usage tracking

## Architecture

```
┌──────────────────────────────────────┐
│          Tauri macOS App             │
│  ┌─────────────────────────────────┐ │
│  │   React Dashboard (WebView)     │ │
│  │   - Settings / GitHub PAT       │ │
│  │   - Repo monitor list           │ │
│  │   - Activity feed               │ │
│  │   - LM Studio model picker      │ │
│  └─────────┬───────────────────────┘ │
│            │ Tauri IPC                │
│  ┌─────────▼───────────────────────┐ │
│  │   Rust Backend (src-tauri)      │ │
│  │   - PR polling loop (tokio)     │ │
│  │   - GitHub API client           │ │
│  │   - LM Studio HTTP client       │ │
│  │   - SQLite dedup tracking       │ │
│  └─────────────────────────────────┘ │
└──────────────────────────────────────┘
        │                    │
   GitHub API          LM Studio
   (via PAT)         localhost:1234
```

## Review Coverage

The AI reviewer checks for:
- Code quality & best practices
- Logic & bug detection
- Security vulnerabilities
- Style & formatting consistency

Reviews are posted as non-blocking PR comments with severity ratings.

## License

ISC
