# Agent Baton CLI Command Manual

> Complete command-line manual and lifecycle reference for `agent-baton` (`baton`).
> Backward-compatible alias: `handoff <command>`.

---

## 1. Lifecycle Overview

The Baton lifecycle strictly advances through 5 deterministic states:

```
[draft] ──(baton forward)──> [forwarded] ──(baton receipt)──> [received] ──(baton deliver)──> [delivered] ──(baton accept)──> [closed]
                                 │                                                                  │
                                 └──(0-token wait)──────────────────────────────────────────────────┴──(baton reject)──> [forwarded]
```
*(Tip: `baton receipt <id> --deliver` advances directly from `forwarded` to `delivered` in a single step).*

---

## 2. Core CLI Commands

### `baton init`
Initialize a Baton Hub.
```bash
# Intra-repo mode (inside an existing project; creates .handoffs/ and .handoff-hub.json)
baton init [--lanes <lane1,lane2>] [--root <dir>]

# Cross-repo mode (creates a standalone neutral coordination hub)
baton init --cross [--targets <target1,target2>] [--root <dir>]
```

### `baton status`
Inspect the central coordination state and discover pending tasks.
```bash
# Global overview of all pending/received tickets
baton status

# Filter pending tasks assigned specifically to your lane or repository
baton status --for <lane|target>

# Render real-time multi-agent topology flowchart (Mermaid)
baton status --mermaid

# Machine-readable JSON output for automated agent loops
baton status --json
```

### `baton new`
Create a new structured handoff ticket.
```bash
# Syntax: baton new <target|lane> <type> "<title>"
baton new audit task "Refactor User Authentication"
baton new api feature "Implement Rate Limiting Middleware"
```
*Types supported*: `task`, `bug`, `feature`, `question`, `continuation`.

### `baton forward`
Mark a ticket as forwarded to the receiving lane, optionally stripping cognitive biases and sleeping until a receipt arrives.
```bash
# Transfer ticket with double-blind cognitive sanitization & background sleep
baton forward <id> --blind --wait

# Options:
#   --daemon   Detach daemon process instantly (<0.1s) using Node.js unref()
#   --blind    Physically sanitize <thinking> tags and subjective excuses
#   --wait     Sleep at 0-Token until delivery lands, waking automatically after settle window
#   --timeout  Timeout duration (e.g. 60m, 2h; default: 60m)
#   --settle   Settle window buffer before waking (default: 10s)
```

### `baton wait`
Standalone 0-Token event-driven watcher & lightweight pub/sub aggregator (powered by OS `fs.watch`).
```bash
# Single handoff wait
baton wait <id> [--timeout 60m] [--settle 10s] [--daemon]

# Multi-handoff lightweight pub/sub aggregation (Join mode, waits for all to be delivered)
baton wait <id1> <id2> [--all] [--timeout 60m] [--settle 10s]

# Multi-handoff race mode (wakes upon the first delivered handoff)
baton wait <id1> <id2> --any [--timeout 60m] [--settle 10s]
```
*Note*: Exits with code `0` when final delivery lands (`delivered`/`closed`) and the settle buffer has fully elapsed. Automatically wakes up your coding agent session. Exits with `124` on timeout with structured matrix diagnostic report.

### `baton prompt`
Generate the standard, copy-pasteable baton pass prompt for manual cross-session/window relay.
```bash
baton prompt <id>
```

### `baton receipt`
Register an execution receipt and transition ticket to `received` (or directly to `delivered` with `--deliver`).
```bash
baton receipt <id> \
  [--deliver] \
  --evidence-paths "<file1,file2>" \
  --evidence-commits "<commit-sha>" \
  [--audit-nonce "<nonce>"] \
  [-n "<receipt-markdown-body>"]
```
*Guards*:
- `--evidence-paths`: Verified on disk via `fs.existsSync`.
- `--evidence-commits`: Verified in Git history via `git cat-file -e`.
- `--audit-nonce`: Mandatory when `to_lane=audit` to prevent self-signing.
- `--deliver`: Atomically executes final delivery (`delivered`), immediately notifying initiator.

### `baton deliver`
Explicitly finalize task completion and transition ticket from `received` to `delivered`.
```bash
baton deliver <id> [-n "<delivery note>"]
```
*Guards*:
- Verifies receipt exists and passes all content/evidence gates.
- Anti-self-closing: Initiators are blocked from delivering on behalf of executors.
- Stamps `delivered_at` timestamp and wakes up initiator's background probe for independent verification.

### `baton accept`
Accept the receipt, verify invariants, and formally close the handoff.
```bash
baton accept <id> -n "<acceptance summary>" [--legacy-exempt]
```
*Guards*:
- Requires ticket to be in `delivered` state (or historical ticket with `--legacy-exempt`).
- Hard-fails if executor has not explicitly marked final delivery.

### `baton reject`
Reject the receipt due to failed tests or unmet invariants, returning it to `forwarded` for rework.
```bash
baton reject <id> -n "<rejection reason>"
```

### `baton check`
Preflight and integrity validation gate. Ensures no corrupted receipts or unauthorized states.
```bash
baton check
```
*Convention*: Must exit with code `0` before committing work.

### `baton install`
Idempotently inject or refresh Agent instruction stubs into project directive files.
```bash
baton install [--project] [--global]
```
*Targets*: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `README.md`.

### `baton link`
Self-healing command to ensure `baton`, `agent-baton`, and `handoff` shims exist in your user PATH (`~/.local/bin/`).
```bash
baton link [--remove]
```

### `baton throttle`
Run background execution tasks with a three-tier noise-filtering pipeline to protect agent and human attention.
```bash
baton throttle <id> [--quiet] [--timeout <ms>] -- <command>
```
*Tiers*:
- Green: Regular output stream quietly written to `.handoffs/logs/<id>.throttle.log`.
- Yellow: Warnings, rate limits and retries tracked with summary counters.
- Red: Fatal runtime crashes immediately breach the filter and alert the parent agent.
