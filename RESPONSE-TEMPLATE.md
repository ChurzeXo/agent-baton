# Handoff Receipt Specification (RESPONSE-TEMPLATE.md)

> This document is the **Single Source of Truth** for writing execution receipts in the Agent Baton protocol.
> Any agent receiving a baton handoff MUST follow this template strictly.

---

## 1. Golden Rules of Receipt Writing

1. **No Code = No Pass (Evidence-First)**:
   Receipts MUST include verifiable proofs in frontmatter:
   - `evidence_paths`: Comma-separated list of modified files (must exist on disk).
   - `evidence_commits`: The Git commit SHA containing the changes (must be verified via `git cat-file -e`).
   - If no code changes were required (e.g. documentation or audit pass), you MUST provide `evidence_note: "<Detailed explanation>"`.
2. **Anti-Self-Closing Guarantee**:
   The receipt MUST be written by the receiving party (`to_lane`), NOT the author (`from_lane`).
   If the task targets `to_lane: audit`, the receipt command MUST include the cryptographic challenge token:
   `baton receipt <id> --audit-nonce "<nonce>"`.
3. **Copy the Skeleton Verbatim**:
   Do not invent custom markdown structures. Missing required anchors or sections will cause `baton check` and `baton receipt` to fail closed.

---

## 2. Receipt Template (Copy Directly)

```markdown
---
handoff_id: <ID>
mode: intra-repo
from_lane: <receiving-lane>
to_lane: <author-lane>
needs_change: false
evidence_paths: "path/to/file1.ts,path/to/file2.ts"
evidence_commits: "<git-commit-sha>"
date: YYYY-MM-DD
---

# Receipt: <ID>

## 结论 (Verdict)
<Accepted / Rejected / Verified> — One concise sentence summarizing the outcome.

## 修复状态 (Status & Implementation)
- What was done: <1-3 bullet points outlining actual modifications>
- Impact boundary: <list of touched modules or components>

## 验收证据 (Evidence & Verification)
- Commits: `<git-commit-sha>`
- Modified Paths: `path/to/file1.ts`, `path/to/file2.ts`
- Verification Commands Executed:
  \`\`\`bash
  <exact command used to verify, e.g. npm test or pnpm check>
  \`\`\`
- Result Output: <All tests passed, 0 failures, 0 regressions>

## 遗留与建议 (Notes & Follow-ups)
<Optional notes for downstream maintainers or next steps>

## 转递提示词 (Baton Pass Prompt)
> 复制下方提示词转告发起方（同对话多工单精准路由对齐）：
```text
请【<author-lane-role>】查收【<receiving-lane-role>】回执 [<ID>]：receipts/<ID>-resp.md（<Verdict> · 需发起方改动：<是/否>）
```
```

---

## 3. How to Submit the Receipt

Use the official CLI command to submit and advance the state machine from `forwarded` to `received`:

```bash
baton receipt <ID> \
  --evidence-paths "src/index.ts,tests/index.test.ts" \
  --evidence-commits "<sha>" \
  --audit-nonce "<nonce-if-audit-lane>" \
  -n "## 结论\nVerified and all invariant tests pass."
```
