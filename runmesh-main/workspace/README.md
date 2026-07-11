# Continuumm

**A developer-first cloud filesystem and execution layer.**

Your workspace — your project files, your dev environment, your agents — all connected, all accessible from any device, all orchestrated from one tool.

---

## The Problem

Developers work across multiple devices — laptop, desktop, phone, remote servers. There is no clean way to have your development environment feel the same everywhere. You either:

- Manually sync files with rsync or scp
- Commit and push to git just to move code between machines
- Shell into a remote machine and deal with latency
- Give up and only work on one machine

Existing solutions fall into two camps, neither of which solves the actual problem:

| Solution | Approach | Problem |
|----------|----------|---------|
| Git / GitHub | Version control | Designed for history and collaboration, not live workspace sync. Requires explicit commits, pushes, pulls. |
| Dropbox / Google Drive | Generic file sync | No concept of development environments. Syncs `node_modules`, `.git`, build artifacts. No CLI, no dev-aware features. |
| Codespaces / Gitpod | Full browser IDE | Locks you into their editor and workflow. You live inside the browser. Not composable with your existing tools. |
| Syncthing | P2P file sync | No cloud hub, no lazy loading, no dev awareness. Great for privacy, not for the agentic era. |

**Nobody has built the right primitive for the agentic era.**

---

## The Vision: Three Layers, Three Timescales

The key insight that makes Continuumm different:

**Your files, your environment, and your execution are all the same thing — at different timescales.**

```
────────────────────────────────────────────────────
  LAYER        | WHAT                  | TIMESCALE
────────────────────────────────────────────────────
  Storage      | Project files in the  │ Forever
               │ cloud, local on any   │
               │ device                │
               │ (rclone + R2/S3)      │
────────────────────────────────────────────────────
  Environment  | Persistent cloud      │ Your session
               │ workspace tied to     │
               │ your project —        │
               │ containers, runtime,  │
               │ tools, always warm    │
               │ (devpod)              │
────────────────────────────────────────────────────
  Execution    | Ephemeral sandboxes   │ One task
               │ for agents — spin up, │
               │ read/write project    │
               │ files, run tests, die │
               │ (E2B / Daytona)       │
────────────────────────────────────────────────────
```

Each layer builds on the one below it. Together they form a single concept: **your workspace, everywhere, at every timescale.**

---

### Storage Layer (Current — Building)

Your project files live in an S3-compatible bucket (Cloudflare R2) and feel local on any device.

- One bucket per developer, projects as prefixes (`bucket/midday/`, `bucket/continuumm/`)
- `.devignore` keeps build artifacts, `node_modules`, cache, and platform-specific junk out of sync
- Auto-sync daemon watches for local changes and pushes to cloud; polls cloud and pulls down remote changes
- Credentials stored globally (`~/.continuumm/config.json`), not per-project
- Projects are linked to cloud prefixes (`continuumm link <prefix>`) — the bucket is a global setting

### Environment Layer (Planned)

A persistent cloud workspace (via devpod or similar) tied to your project. Your containers, runtime, and tools follow you between devices. Reconnect to a warm workspace from any machine — your dev server is still running, your terminal session is still there.

### Execution Layer (Planned)

Ephemeral sandboxes for AI agents and automated tasks. Spin up fast, read/write your actual project files from the storage layer, run tests, make changes, write output back, die. Agents get a safe, isolated place to work against your real codebase without touching your live environment.

---

## Why Now?

Every piece of this was technically possible before — but the tooling to compose them cleanly didn't exist:

- **rclone** — mature Go library for cloud storage. Handles S3, R2, GCS, and 40+ providers with a unified filesystem interface.
- **devpod** — headless dev environments that persist in the cloud.
- **E2B / Daytona** — sandbox APIs for ephemeral code execution.
- **Go** — single language, single binary, cross-platform, excellent for CLI tooling.

The gap is the **orchestration layer**. That's what Continuumm builds.

And the agentic use case — agents that need real dev environments with real project files to work in, not toy sandboxes — is brand new and completely underserved.

---

## Architecture

```
~/.continuumm/config.json     # Global: credentials + default bucket
  project/
    .devignore                  # Ignore patterns (gitignore syntax)
    .continuumm/config.json     # Project: cloud prefix mapping
```

### Config Model

| Config | Location | Contents |
|--------|----------|----------|
| Global | `~/.continuumm/config.json` | Provider, endpoint, access key, secret key, region, default bucket |
| Project | `project/.continuumm/config.json` | Cloud prefix (e.g. `"midday"`) |

This split means credentials are never in your project directory. The project only stores which cloud prefix it maps to. The bucket is a global setting — all projects live under one bucket.

### How Sync Works

**Push (local → cloud):**
1. fsnotify watches the project directory recursively
2. Changed files are collected and debounced (500ms window)
3. rclone's `CopyDir` copies changed files from local to the S3 prefix
4. `.devignore` patterns are applied as rclone filters

**Pull (cloud → local):**
1. Every 8 seconds, rclone's `CopyDir` runs in reverse (cloud → local)
2. Only files that differ between cloud and local are transferred
3. New directories created by the pull are automatically added to the fsnotify watcher

**Why `CopyDir` instead of individual file operations?**
- `CopyDir` checks hashes and sizes — it only transfers what's actually changed
- It handles the full directory tree comparison efficiently
- No need to track individual file states or manage pending queues
- The bidirectional loop (pull triggers push triggers pull) is a no-op because identical files are skipped

### Why S3-Compatible Storage?

- S3 is the industry standard for object storage. Every cloud provider implements it.
- Cloudflare R2 has zero egress fees — cost-effective for multi-device sync.
- rclone provides a unified filesystem interface over any S3-compatible backend.
- Object storage is ideal for the "cloud as canonical source" model — files are immutable objects with metadata, not a mountable filesystem (that's a future FUSE layer).

---

## Current Status

### ✅ Built

| Feature | Status | Details |
|---------|--------|---------|
| `config set` | Done | Stores credentials globally in `~/.continuumm/` |
| `link` | Done | Links a local directory to a cloud prefix |
| `up` | Done | Full sync from local → cloud |
| `down` | Done | Full sync from cloud → local |
| `list` | Done | Lists all files stored in the cloud prefix |
| `status` | Done | Shows local vs remote file diff |
| `watch` | Done | Bidirectional auto-sync daemon (push on change, pull every 8s) |
| `.devignore` | Done | Gitignore-syntax patterns to exclude files from sync |
| Single-bucket namespace | Done | All projects under one bucket, projects as prefixes |
| Global credentials | Done | Credentials never stored in project directory |
| `no_check_bucket` | Done | Skips bucket existence checks for R2 compatibility |
| `force_path_style` | Done | Path-style URLs for S3-compatible backends |

### 🚧 In Progress

| Feature | Status | Details |
|---------|--------|---------|
| Lazy loading | Planned | Only fetch files on access (FUSE mount or on-demand download) |
| Watch mode improvements | Planned | Handle renames properly, reduce edge-case noise |
| Root command UX | Planned | `continuumm` without args should show meaningful state |

### 📋 Planned

| Feature | Layer | Details |
|---------|-------|---------|
| Project registry (`continuumm projects`) | Storage | List all linked projects and their sync status |
| `continuumm clone <prefix>` | Storage | Pull an existing cloud project to a fresh local machine |
| Sync multiple projects at once | Storage | Watch daemon that handles all linked projects |
| Per-machine `.devignore` overrides | Storage | Ignore different things on different devices |
| File history / versioning | Storage | Dropbox-style version history for synced files |
| FUSE mount | Storage | Mount the cloud bucket as a local filesystem with on-demand loading |
| Conflict resolution | Storage | Handle simultaneous edits on two devices |
| `devpod` integration | Environment | Auto-start/attach a devpod workspace when entering a project |
| Cloud workspace management | Environment | List, start, stop, reconnect persistent workspaces |
| Env var sync | Environment | `~/.envrc`-style env sync across devices |
| `E2B` / `Daytona` integration | Execution | Ephemeral sandboxes with project files mounted |
| Agent API | Execution | `continuumm run <task>` — spin sandbox, run task, return diff |
| Web dashboard | UX | View sync status, manage projects, trigger syncs from browser |
| Mobile app | UX | `continuumm` on iOS/Android (at least file access) |
| Encrypted secrets | Storage | Sync `.env` files with encryption |
| Team sharing | Storage | Share prefixes with other developers |

---

## Installation

```bash
# Install via Go
go install github.com/daviduche03/Continuumm/cmd/continuumm@latest

# Or build from source
git clone https://github.com/daviduche03/Continuumm
cd Continuumm
go install ./cmd/continuumm/
```

Requires Go 1.25+.

---

## Usage

### 1. Configure credentials (once)

```bash
continuumm config set \
  --bucket matriq \
  --endpoint https://<account_id>.r2.cloudflarestorage.com \
  --access-key <your_access_key> \
  --secret-key <your_secret_key>
```

Credentials are stored in `~/.continuumm/config.json` with `0600` permissions. The bucket is global — all projects live under this bucket as prefixes.

Supported providers: `Cloudflare` (R2), `AWS` (S3), `Minio`, `Wasabi`, and any S3-compatible storage.

### 2. Link a project

```bash
cd ~/code/my-project
continuumm link my-project
```

This creates `.continuumm/config.json` and a default `.devignore`. Your local directory is now mapped to `bucket/my-project/` in the cloud.

### 3. Sync

```bash
# One-time syncs
continuumm up       # Push local changes to cloud
continuumm down     # Pull cloud changes to local

# Auto-sync daemon (bidirectional)
continuumm watch    # Push on change, pull every 8s
```

### 4. Inspect

```bash
continuumm list     # List files in cloud
continuumm status   # Show local vs remote diff
```

---

## `.devignore`

A `.devignore` file in your project root tells Continuumm which files and directories to exclude from sync. It uses standard gitignore syntax.

Default `.devignore`:

```
.git/
node_modules/
build/
dist/
target/
.cache/
__pycache__/
*.pyc
.next/
.venv/
.env
vendor/
.idea/
*.swp
*.swo
.DS_Store
Thumbs.db
```

---

## How It's Different

### Vs. Git

Git is a version control system. It solves **time** — history, branches, collaboration. Moving files between machines is a side effect, not the purpose.

Continuumm solves **space** — your workspace, live, on every device, right now. No commits, no push/pull dance, no stale copies. The cloud *is* your working directory.

They're complementary. You still use Git inside a Continuumm-synced project for history and collaboration. Continuumm just makes sure `git status` sees the same files on every machine.

### Vs. Dropbox

Dropbox is a general-purpose file sync tool. It has no concept of:
- What a development environment is
- Which files are build artifacts that shouldn't be synced
- How to handle `node_modules`, `.git`, or compiled binaries
- How to interact with agents or automated tooling
- What lazy loading means for a monorepo

Continuumm is purpose-built for developers. It understands `.devignore`, it integrates with your CLI, and it's designed for the agentic era.

### Vs. Codespaces / Gitpod

Full browser IDEs lock you into their editor, their terminal, their workflow. You `ssh` into a remote machine or you live inside a web app. They solve "remote development" by replacing your local setup.

Continuumm takes the opposite approach: your local tools stay your local tools. The cloud is just storage and compute that feels local. You use your own editor, your own terminal, your own workflow — on any device.

---

## Design Decisions

### Why Go?

- Single binary, no runtime dependencies
- Cross-platform (macOS, Linux, Windows)
- Excellent CLI tooling (cobra/pflag)
- rclone is written in Go — direct library integration, no subprocess calls
- Strong standard library for filesystem, networking, and concurrency

### Why rclone as a library, not a CLI subprocess?

- Direct access to rclone's filesystem, filter, and sync packages
- No parsing CLI output or managing subprocess lifecycle
- Type-safe config via `configmap.Simple` instead of connection strings
- Provider quirks (like R2's force_path_style) applied automatically via `fs.ConfigMap`

### Why programmatic config instead of connection strings?

Rclone connection strings use `:` as a separator (`:backend,key=val:/path`). Endpoint URLs contain `://` (e.g., `https://account.r2.cloudflarestorage.com`), which breaks the parser.

Using `fs.ConfigMap` with `configmap.Simple` avoids this entirely — values are passed as typed config, not serialized into a string.

### Why Cloudflare R2?

- S3-compatible API
- Zero egress fees — cost-effective for multi-device sync
- Global edge network for low-latency access from anywhere
- Generous free tier

But any S3-compatible backend works. Swap `--provider AWS` and point to any S3 endpoint.

### Why "cloud is canonical"?

In the current implementation, local is the primary source and cloud is a mirror. This is pragmatic for v0 — developers edit files locally, and changes flow to the cloud.

The long-term model is the reverse: the cloud bucket is the source of truth, and local machines maintain a synced cache. This enables:
- Lazy loading (only pull files you access)
- Trivial onboarding (`continuumm clone` on a new machine)
- Agent execution (sandboxes read/write the canonical copy)

### Why `CopyDir` for watch instead of per-file operations?

Individual file operations (`Put` / `Remove` per path) require tracking file state, handling renames, managing a pending queue, and recovering from partial failures. `CopyDir` handles all of this internally — it compares directory trees, transfers only what changed, and handles edge cases (deletions, renames, new files) correctly.

The tradeoff: `CopyDir` does a full directory listing on each call. For the push direction (debounced to 500ms), this is negligible. For the pull direction (every 8 seconds), it's a small overhead that ensures correctness.

---

## Project Structure

```
cmd/continuumm/main.go       # CLI entry point — commands, flags, usage
internal/
  config/config.go            # Global + project config management, S3 filesystem construction
  ignore/ignore.go            # .devignore parser, gitignore matcher, rclone filter builder
  ignore/ignore_test.go       # Tests for ignore parsing
  sync/sync.go                # Sync engine — up, down, list, status, watch
go.mod                        # Go module definition (rclone, fsnotify, go-gitignore)
go.sum                        # Dependency checksums
```

---

## Development

```bash
# Build
go build ./cmd/continuumm/

# Install to GOPATH/bin
go install ./cmd/continuumm/

# Test
go test ./...

# Vet
go vet ./...
```

---

## Roadmap

### Phase 1: Storage Layer (Current)
- [x] Global credential management
- [x] Project linking with `.devignore`
- [x] One-directional sync (up / down)
- [x] File listing and status inspection
- [x] Bidirectional auto-sync daemon
- [ ] Lazy loading / on-demand fetch
- [ ] FUSE mount for local filesystem feel
- [ ] Per-machine `.devignore` overrides
- [ ] File conflict resolution
- [ ] `continuumm clone` for new devices
- [ ] Encrypted secrets sync

### Phase 2: Environment Layer
- [ ] devpod integration — auto-create workspace per project
- [ ] Persistent cloud workspace management
- [ ] Warm reconnect — reattach to running workspace from any device
- [ ] Env var and tooling sync across devices
- [ ] Multiple workspace templates per project

### Phase 3: Execution Layer
- [ ] E2B / Daytona sandbox integration
- [ ] `continuumm run <task>` — ephemeral agent execution
- [ ] Sandbox has read/write access to project files from storage layer
- [ ] Diff review — what did the agent change?
- [ ] Parallel sandbox execution for CI-like workflows

### Phase 4: Ecosystem
- [ ] Web dashboard
- [ ] Mobile app (file access, sync status, trigger syncs)
- [ ] Team sharing and permissions
- [ ] Plugin API for custom sync filters and hooks
- [ ] VSCode extension (sync status in editor)
