# v2.22.0 下游消费方升级执行包（D1–D5 监听可观测性 / 防抢跑）

> 上游 lab 侧产出 · 2026-11-09 · 引用：`$(lab path handoffs)/docs/consumer-upgrade-v2.22.0.md`
> 本文是 6 份 `*-20261109-01-breaking.md` 迁移交接的取证附件，**不替代交接、不改变其 5 条判据**。

## 0. 一句话结论

**下游零文件改动，升级已收口（见 §7）。** 引擎已发布，接入桩 sha 仍 `1d843498`；逐仓 `baton install --project` 幂等返回「已是最新」，无需重刷、无需下游写回执、无需等待监听。

## 1. 发布事实

| 项 | 值 |
|---|---|
| 引擎版本 | v2.22.0 |
| 提交 | `506e77e`（D1–D4）/ `413a65b`（D5） |
| 推送 | `ba23ea5..413a65b`（D1–D5 发布）、`413a65b..e179ee4`（执行包与运行态忽略）；origin/main 已同步 |
| 独立双盲审计 | `audit-20261109-02-task` 7/7 判据通过，回执已 `baton deliver` |
| 桩 sha | `1d843498`（本轮未动 `STUB_BODY`） |

## 2. 判据 2 / 3 的精确化（防下游误改桩）

**判据 2**：全仓检索 `--daemon` 必然命中接入桩的固定说明行：

    执行 `baton forward <ID> --wait`（…；AI 客户端宿主进程树托管；人类终端可用 `--daemon` 脱钩；…）

该行属 `STUB_BODY`，**严禁修改**。理由：① D1 拦的是 Agent 宿主下的非 TTY 环境（RC=3 + stderr「后台任务」），`人类终端可用 --daemon` 在真实 TTY 下依旧成立，措辞没有过时；② 改它会让桩 sha 漂移，触发 6 仓 × 3 载体全量重刷，与「无需重刷」自相矛盾。

真正要找的是**脚本 / 自动化里实际调用 `--daemon`** 的位置，实测 6 仓均为 0 处（§3）。若确有调用，改走宿主后台任务 `baton wait <id>`，或显式 `BATON_MANAGED_MODE=0` 脱钩。

**判据 3**：Tappy 侧「`reject` 前手工清回执 `delivered_at`」是 verdict-r2 §五 记载的**人工绕行动作**，不是落地脚本或文档。全仓检索 `delivered_at` 为 0 命中 → 该判据标 **N/A**，附上检索命令与 0 命中输出即可，**不要为「删除」而凭空造文件**。D5 起由引擎 `cmdReject` 自动清印并落 `rejected_at`，工单稳态保持 `forwarded`。

## 3. 逐仓只读实测（上游发起方，2026-11-09）

| 仓 | `baton link --check` | AGENTS 桩 sha | 桩外 `--daemon` | `delivered_at` |
|---|---|---|---|---|
| iggle | RC=0 · == v2.22.0 | `1d843498` | 0 | 0 |
| Swoop | RC=0 · == v2.22.0 | `1d843498` | 0 | 0 |
| Prospero | RC=0 · == v2.22.0 | `1d843498` | 0 | 0 |
| WarmTag | RC=0 · == v2.22.0 | `1d843498` | 0 | 0 |
| OWSEL | RC=0 · == v2.22.0 | `1d843498` | 0 | 0 |
| AutoOperations | RC=0 · == v2.22.0 | `1d843498` | 0 | 0 |
| TappyOperations | RC=0（无桩，跳过桩版本判定） | — | 0 | 0 |

- 三载体 `AGENTS.md` / `CLAUDE.md` / `README.md` 逐仓同一 sha；全局载体 `~/.claude/CLAUDE.md`、`~/.config/opencode/AGENTS.md` 此前已核验。
- 7 仓根目录均未发现 `.handoff-hub.json` / `.handoffs/.handoff-hub.json`；收件统一命中上游跨仓 Hub（`units/handoffs`）。因此交接「残留风险 1」（v2.22.0 起 intra-repo 默认 `TARGETS` 为空）对这 7 仓**不成立**——它们不是 intra-repo 子 Hub，无需补 `targets`。
- **无需人工转递的实证**：在 Swoop 仓内跑 `baton status --for swoop`，`SWOOP-20261109-01-breaking` 直接列在「待 swoop 处理」；`git status --porcelain` 前后均为 0，下游仓零写入。

## 4. 一键自检脚本（下游在本仓根目录执行 · 纯只读）

```bash
echo "[1/5] 引擎与桩版本"
baton link --check; echo "  link_rc=$?"

echo "[2/5] 桩外 --daemon 实际调用（应无输出）"
grep -rn --include='*.md' --include='*.sh' --include='*.mjs' \
  --include='*.js' --include='*.ts' -- '--daemon' . \
  --exclude-dir=.git --exclude-dir=node_modules \
  --exclude-dir=dist --exclude-dir=target 2>/dev/null \
  | grep -v 'baton forward <ID> --wait' || echo "  0 处 → 判据 2 N/A"

echo "[3/5] reject 前清 delivered_at 的绕行（应无输出）"
grep -rn --include='*.md' --include='*.sh' --include='*.mjs' \
  'delivered_at' . --exclude-dir=.git --exclude-dir=node_modules 2>/dev/null \
  || echo "  0 处 → 判据 3 N/A"

echo "[4/5] 本方收件状态"
T=swoop   # ← 改成你的 target：tappy / swoop / prospero / iggle / coreml / yiqiyihuihua
baton status --for "$T" | head -12

echo "[5/5] 合规自检"
baton check; echo "  check_rc=$?"
```

`--include` 限流是必要的：无限制全仓 grep 在含 `node_modules` / 构建产物的仓里会被系统资源限制中断（本次实测 SIGTERM）。

## 5. 三个非 target 消费方知会（WarmTag / OWSEL / AutoOperations）

这三仓**不在跨仓 Hub 的 6 个 target 中**，`baton status --for <target>` 看不到本批交接，因此不产出系统交接（不造系统看不见的假交接）。升级状态同 §0：桩已最新 v2.22.0 / `1d843498`，`link --check` RC=0，**本轮零文件改动**。

行为变更同样适用：Agent 宿主非 TTY 下 `--daemon` 硬拦 RC=3；`reject` 前手工清 `delivered_at` 的绕行作废；`status` 新增监听列与空转告警；**Audit Nonce 门禁勿依赖（F1）**。若希望纳入回执通道，需由上游在 `units/handoffs/.handoff-hub.json` 注册 target（属上游动作）。

可直接贴给三仓 Agent 的知会行：

```text
请收 WarmTag 升级知会：~/Documents/lab/units/handoffs/docs/consumer-upgrade-v2.22.0.md（v2.22.0 已发布，本仓零文件改动，跑 §4 自检即可）
请收 OWSEL 升级知会：~/Documents/lab/units/handoffs/docs/consumer-upgrade-v2.22.0.md（v2.22.0 已发布，本仓零文件改动，跑 §4 自检即可）
请收 AutoOperations 升级知会：~/Documents/lab/units/handoffs/docs/consumer-upgrade-v2.22.0.md（v2.22.0 已发布，本仓零文件改动，跑 §4 自检即可）
```

## 6. 口径与不变式

- **F1（如实告知 · 待发起方裁决 · 不阻塞发布）**：契约与接入桩宣传的「Audit Nonce 防自签」在 v2.22.0 引擎**未实现**——`forward --blind` 不签发 challenge，不带或带伪造 `--audit-nonce` 提交回执均 RC=0，`cmdReceipt` 不解析该参数。**勿在自动化里依赖该门禁**；实际生效的防自签是 `HANDOFF_LANE` 身份核验（未声明时仅 warn 不阻断）。属既存契约虚设，非 D1–D5 引入的倒退。
- 不变式：消费方经 `$(lab path handoffs)` 动态引用引擎，行为变更不需改桩；**桩 sha 不变即证明无载体漂移**。
- 残留风险（不阻塞）：`reject` / `deliver` 门禁失败仍 RC=0（自动化勿只看退出码，须显式核验状态变化）；`cmdReject` 驳回记录可能追加到文件尾部（纯排版）。

## 7. 收口状态（2026-11-09 20:01 · 用户指示关闭监听并授权上游直接收口）

| 项 | 状态 |
|---|---|
| 引擎发布 | v2.22.0 已推送 `origin/main`（`506e77e` / `413a65b` / `e179ee4`），工作树 clean |
| 下游桩 | 6 仓逐仓 `baton install --project` RC=0「已是最新」；三载体 sha 均 `1d843498`；`link --check` 全 RC=0 |
| 下游文件 | **零改动**：4 个 git 仓 `git status --porcelain` 前后均 0 行；桩固定说明行仍准确，改它反而触发 sha 漂移 |
| 无桩仓 | TappyOperations 本就未接入桩，不新建文件（避免无谓改动） |
| Swoop | 已交付回执，发起方自备夹具独立验收通过 → `status: closed` + `accepted_at`；取证见 `reviews/SWOOP-20261109-01-breaking-acceptance.md` |
| 其余 5 份交接 | 保持 `forwarded`、无回执；按用户授权**不再等待**，保留为审计轨迹，不产生任何后续动作（原因见 §8） |
| 三非 target 仓 | 桩已最新、零改动；知会见 §5，不进回执通道 |
| 监听 | 聚合探针已停止，`.watch` 运行态清空；`status` 显示 `[⚠️ 无监听]` 属预期，非故障 |

**不再有接手方**：下游无需任何操作，用户无需转递任何提示词，上游不再等待回执。F1（Nonce 门禁虚设）仍待发起方裁决，不阻塞本次发布。

## 8. 为什么 5 份工单不闭环

`baton accept` 的状态机只允许 `delivered → closed`，并强制校验回执存在、`delivered_at` 已落、内容门禁、非自填回执（`handoff.mjs` §cmdAccept）。这 5 份既无回执也无终态交付声明，**任何单方面 close 都会绕过 D5 防抢跑机制**——而本次双盲审计刚刚验过该机制。因此保留 `forwarded` 作为审计轨迹，而不是伪造交付。若日后要清理状态，只能由对应下游 Agent 自行交回执后闭环；当前 CLI 无撤回 / 归档命令。

外链：审计全记录 `lab/.handoffs/reviews/audit-20261109-02-task-evidence.md`；审计回执 `lab/.handoffs/receipts/audit-20261109-02-task-resp.md`；第 2 轮判定 `lab/.handoffs/reviews/impl-20261109-01-task-verdict-r2.md`；Swoop 验收 `units/handoffs/reviews/SWOOP-20261109-01-breaking-acceptance.md`；契约唯一事实源 `$(lab path handoffs)/README.md` v2.22.0 + `CHANGELOG.md`。

## 9. 消费方如何「引用 lab 仓」（2026-11-09 20:2x 盘点 · 澄清「更新引用」的确切对象）

本机是**单一 lab 仓 + 软链 / 动态指针**模型，没有 submodule、npm 版本依赖或 commit 钉值。因此 lab 仓 `push` 后引用自动指向最新，**不存在需要逐仓 bump 的版本号**。

| 引用形态 | 本机落点 | 本轮动作 |
|---|---|---|
| 全局 npm 包 | `lab-agent-toolkit -> ../../../../../../../Documents/lab`（npm link 软链） | 重跑 `npm link` RC=0，复核目标仍指向 lab 仓 |
| `baton` CLI | `~/.local/bin/baton -> lab/units/handoffs/handoff.mjs`（软链） | 复核，自动最新 |
| 顶层模块路径 | `lab/{handoffs,adr,backlog,preflight,playbook,review-gate} -> units/<同名>`（软链） | 复核，旧式 `~/Documents/lab/handoffs/...` 仍可解析 |
| 动态指针 | `$(lab path <unit>)/...`，各仓 AGENTS/CLAUDE/README 主用 | 六模块 `README.md` 全部可达；`lab doctor` 绿灯 |
| 硬编码旧路径 | `~/Documents/lab/...` | 活跃载体仅 `OWSEL/Owsel/AGENTS.md:28` 一处 → 已改 `$(lab path backlog)/README.md`（契约场景三断言 A）。历史日志 / `reviews/` 属档案，不动 |
| 模板副本 | iggle / Swoop / Prospero 的 `review-gate/scan.sh`、`scripts/preflight.sh` | 与 lab 源模板有差异，**全是项目定制**（RULESETS、EXCLUDE_RULES、校准值），且副本已用动态指针 → **禁止用源模板覆盖**，不更新 |
| git submodule / npm 依赖 / commit 钉值 / tag / worktree | **均不存在**（7 仓无 `.gitmodules`、无 `package.json` 依赖、无 worktree；lab 无 tag） | 无需更新；`package.json` 仍 `1.0.0`，若要跨机器按版本分发需 `npm version` + `npm publish`（公开动作，另行授权） |
| 全局载体 | `~/.claude/CLAUDE.md`、`~/.config/opencode/AGENTS.md` | 桩已 `1d843498` == 引擎 v2.22.0 |

复核：7 仓 `baton link --check` 全 RC=0、cross `baton check` RC=0、4 个 git 仓 `git status --porcelain` 0 行、lab 仓工作树 clean、本批 6 份交接状态未扰动。

> ⚠️ **工具坑（本轮踩）**：`lab migrate --help` **不是只读帮助**，会立即执行单向有损替换（`~/Documents/lab/...` → `$(lab path ...)`）。在 lab 仓根执行会改坏安装说明、CLI 帮助文本与大量历史票据。查用法请读 `bin/lab.mjs`，预览只能用 `lab migrate <dir> --dry-run`。另：macOS 无 `timeout` 命令，带 `timeout` 的 grep 会静默返回 0 命中（假阴性）。
