# Handoff Agent Guide（早拦 Preflight 权威版）

> 本文件是给**执行 handoff 的 Agent**用的思考守卫。不是给人类操作说明，而是强制自检清单。

## 核心原则：早拦 > 晚拦
CLI 已有 60 分钟新鲜度门禁（receipt/accept/reject 时拦）和 check 硬校验（回执结构拦）。但要根治“忘了先查状态”，必须在**决策前**就强制拦住。

**铁律：在调用任何 handoff 工具前，先确认你刚跑过 `handoff status` 且基于「进行中」清单做判断。**

> **「进行中 / 待办 / 生命周期」唯一定义（v2.18.0 · README / 接入桩 / 本文件三处同义）**
> - 「进行中」= 未闭环（`status ≠ closed`）且归属当前方。
> - **待办 = `draft` + `forwarded`**——落我归属即该我动工，**含驳回退回的返工单**；`forward` 只是发起方可选的事后标记，**严禁**用「`draft`/`forwarded` 不处理」判退。
> - `received` = 回执草稿已登记（执行方可能仍在自检中，尚未交付）。
> - `delivered` = 执行方已完成终态交付（`delivered_at` 已烙印，触发发起方后台探针唤醒与独立验收）。
> - `closed` 不处理。`accepted`/`rejected` 为废止状态、不存在。
> - 因此执行方冷启动 = `handoff status --for <本方 lane|target>` 直取本方待办。

## Preflight（强制自检）
每次准备调用以下工具前，都必须先走本自检：
> 待调用：`show`、`receipt`、`accept`、`reject`、`check`

自检清单：
- [ ] 本轮次我**已执行过** `handoff status`（执行方冷启动用 `handoff status --for <本方 lane|target>`，同样算），且完整输出仍在当前上下文中。
- [ ] 如果用户指定了 `<ID>`，该 `<ID>` **必须**出现在「待办（`draft`/`forwarded`，见上唯一定义）」清单内。
- [ ] 落手判定成立：仓内 → `to_lane == 当前 lane` 且为待办（draft/forwarded）；跨仓 → 落在目标收件箱且未闭环。
- [ ] 当前动作符合强制操作序列（见下）。
- [ ] 若要 `receipt`，status 快照距今 **< 60 分钟**。超时必须重跑。
- [ ] 若要 `receipt`，预见 `-n` 能满足 check 要求（非空正文 + 含 `##` 节 + 含「状态 / 结论」锚节；仓内必附 `--evidence-paths` / `--evidence-commits` / `--evidence-note`）。
- [ ] 若本轮有发起交接（出站）：**回复最末块固定为交接提示词（由本地 AI 根据用户当前语言自适应呈现：中文用 `## 交接提示词`，英文用 `## Baton Pass Prompt`）**。标题、描述说明与具体的接单指令必须严格分离，提示词置于独立代码块（```text）中，方便人类一键复制（其后无任何正文）。执行方提交回执（入站）时，因发起方已挂起后台探针自动唤醒，无需再写回执提示词。

**任意否定 → 禁止调用工具。先跑 `baton status`（或 `handoff status`），再按结果决定下一步。**

## 强制操作序列（入站 = 接单/回执/交付 · 仓内）
1. `baton status --for <本方 lane>`（冷启动直取本方待办；全量 `baton status` 供发起方巡检）
2. 从「待办」（`draft`/`forwarded`）筛选 `to_lane == 当前 lane`。确认目标 ID（如多条且未指定 → 列出并请用户点名，不擅自选）
3. `baton show <ID>`
4. 按边界最小改动（仅该 lane 应改文件）
5. 写回执与交付：**照抄 `$(lab path handoffs)/RESPONSE-TEMPLATE.md`「回执模板（可直接复制）」骨架** →
   优先使用一步直达：`baton receipt <ID> --deliver -n "<正文>" --evidence-paths "真实文件,..." --evidence-commits "<sha>"`
   （或分步执行 `baton receipt`，在自检全过收尾时执行 `baton deliver <ID>`）。（若 `to_lane=audit` 须附 `--audit-nonce "<nonce>"`；无改动用 `--evidence-note`；严禁提前抢跑）
6. `baton check`（exit 0）
7. **自动唤醒闭环**：执行方 deliver 登记后，发起方后台监听探针将自动 Exit 0 唤醒进行独立验收，无需人工回传回执。

## 防抢跑与终态交付纪律（v2.18.0 强制）
- **落盘不等于交付**：回执文件物理落盘不代表执行方会话结束。执行方必须通过 `baton deliver <ID>`（或 `baton receipt --deliver`）显式标记终态交付；
- **发起方禁止抢跑**：在未收到 `delivered` 信号前，发起方 wait 探针不会唤醒、accept 硬性拦截；**严禁发起方在收到终态交付信号前提前修改 Backlog 或规划文档**。

## 强制操作序列（出站 = 建/发交接 · 强制闭环）
1. `baton new <target|lane> <type> "<标题>"` 并填写正文
2. **转递并挂起后台监听（必须执行）**：
   执行 `baton forward <ID> --wait`（AI 客户端推荐：由宿主进程树托管后台任务，回执到达 Exit 0 自动唤醒；人类终端可用 `--daemon` 脱钩；需双盲脱敏加 `--blind`）
   ——一条命令完成标记转递、打印接单提示词与挂起后台监听；回执到达后 Exit 0 自动唤醒本会话进行独立验收闭环。
3. **输出交接提示词（末块规范）**：本地 AI 根据用户本地语言自适应输出，标题、描述与独立代码块分离（其后无任何正文）：
   ## 交接提示词
   > 直接复制下方提示词，发送给接收方 Agent 接单：
   ```text
   请【<目标角色>】接单：<交接路径>（<主题>）
   ```

## 审计动作契约（v2.13 · to_lane=audit 强制）
> 审计方（接收方 `to_lane=audit`）**严禁仅静态读码**——必须在终端**独立执行**交接文档「验收判据」中的**所有测试与校验命令**，以实测输出为唯一准绳，**严禁采信自报**（执行方回执里的「已通过」一律视为待验证声明，不采信）。
> 同仓提示词 / 回执交付行**一律用自然角色**（实现方 / 审计方 / 架构设计方，或 `.handoff-hub.json` 的 `lane_labels`），**严禁把项目名 / lane slug 当沟通角色**（如「请 Tappy 收交接」「请 impl lane 收交接」）。`handoff prompt` 对 `to_lane=audit` 的交接会自动附此契约，交接文档「给执行方」节也内置该约束。

## 跨仓变体
- 先用 `handoff status --for <target>`（**勿**把 inbox/<target>.md 当权威）
- 后续同思路：show → 按职责最小改动 → receipt → check

## 反模式（一律禁止）
- 跳过 `status` 直接 `show <ID>`
- 用“上次处理的就是它”“用户提过 ID”替代查状态
- 用 `draft/forwarded` 判定要不要开工
- 用 mtime 推断归属（仓内用 frontmatter `workspace`）
- 执行方调用 `accept/reject`
- 同仓提示词 / 回执交付行出现**项目名 / lane slug 当角色**（如「请 Tappy 收交接」「请 impl lane 收交接」「请收 Tappy 回执」）——一律用自然角色（实现方 / 审计方 / 架构设计方或 `lane_labels`，v2.13）
- 发起方**自填回执 / 未收到接收方真实回执前预填**（Anti-Self-Closing，v2.13）：窗口声明 `HANDOFF_LANE=<本方 lane>` 后，引擎据身份硬拒越界 / 自填；接收方 `to_lane` 才写得回执，发起方 `from_lane` 只收不写
- receipt 只写「已处理」「done」「ok」等无要素描述
- 把转递提示词写在正文中段或夹在结束语之后（必须为**回复最末块** `## 转递提示词`，其后无正文）
- 未跑 `check` 就宣称“任务结束”“已完成”

## receipt 强制模板（v2.11）
> **回执正文规范唯一源 = `~/Documents/lab/handoffs/RESPONSE-TEMPLATE.md`「回执模板（可直接复制）」——照抄该骨架，勿另起格式。** 本节只列机器硬校验锚（不复制骨架，杜绝第二份竞争模板）。
- 机器硬校验锚（`check` · 阈值 2026-10-13 起，存量豁免）：**非空正文 + 至少一个 `##` 节 + 「修复状态 / 状态 / 结论」锚节 + 「## 转递提示词」节**。
- 免转递豁免：仅 `COREML-*`（同工作区）不产出「## 转递提示词」；仓内 `workspace=same` 回执仍须含该节（回执交付行不豁免）。
- 回执落点：`receipts/<ID>-resp.md`；跨仓 frontmatter `handoff_id`，仓内 `handoff_id / mode / from_lane / to_lane / needs_change`。

## 失败兜底
- **`handoff: command not found`**：shim 缺失/被摘。先跑 `node ~/Documents/lab/handoffs/handoff.mjs link` 一次性自愈（幂等）；本次也可先用全路径 `node ~/Documents/lab/handoffs/handoff.mjs <子命令>` 兜底，不要放弃流程、不要手改目录。
- **待办（draft/forwarded）为空**：立即停下，明确回复「当前无待办 handoff」，不要臆测。
- **ID 不在待办**：立即停下，说明「<ID> 不在待办（状态：<实际状态>；`received`=已回执仅待发起方审计、`closed`=已闭环），不予处理」，建议先查 status。
- **多条待办且未指定 ID**：列出清单并请用户点名，不擅自选择。
- **超边界**：放弃越界改动，仅在 receipt 中如实说明“超出<lane>职责范围，未做越界修改”。
- **status 超过 60 分钟**：重跑 `handoff status` 再继续。
