# 公共交接目录（Handoff Hub / Agent Baton）

> **跨仓/同仓 Agent 间任务交割像调 API 一样无损直达**  
> 拒绝人肉传话与上下文衰减。一条命令穿透仓库边界，接口与协作契约严密对齐，独立窗口双盲审计，事件驱动无感闭环。  
> 本地中立的交接枢纽，被 **iggle / Swoop / Prospero / Tappy / 一期一卉花** 与**自动化运营**共用。
> 不属于任何代码仓库；交接不出 iggle 仓库、回执不进 iggle 仓库（仍守 `AGENTS.md` 协作边界：依赖 agent 绝不改 iggle 文件）。
> **契约版本 v2.24.0（2026-11-11）**：本文件是交接契约的**唯一真相源**——所有行为规则、命名规范、状态机只以这里为准；各仓库 AGENTS.md / 记忆文件只允许放指针桩，禁止复制细则（防漂移）。修改契约必须改本文件并升版本号。
> **v2.24.0 变更（2026-11-11 · 对外话术去公文化与扁平化重构 · 严禁将自检三要素机械打为 Markdown 标题 · 收尾汇报重构为「我方状态 + 后续接手」两行自然短汇报 · 禁用浮夸邀功修辞 · 动 STUB_BODY ⇒ 各载体须重跑 baton install）**：动因——用户反馈收尾话术被 Agent 僵化执行，机械输出「对方是谁 / 对方要做什么 / 我这边是否还有待办」表单标题逐项填空，且充斥「100% 圆满完成」「经受极端变异考验」等浮夸邀功套话，导致信息严重倒错冗余、人类阅读体验极差。①**严禁机械打卡**：严禁把「对方是谁 / 对方要做什么 / 我这边是否还有待办」直接作为标题或加粗字段原样输出；②**扁平化结构（我方状态 + 后续接手）**：进度与收尾说明强制压至 3 句以内，直呈「①我方状态（完成项 + 我方是否还有待办）；②后续接手（接手方角色 + 动作 + 人类是否需干预）」两行自然人话；③**公文套话与邀功修辞硬拦截**：禁止「100% 圆满完成」「经受住考验」等宣传辞藻，讲事实、附单号；④**典型正反例写入契约**：将真实踩坑案例固化入 `### 对外话术：通俗与简洁（v2.24.0）` 节；⑤**接入桩同步升级**：更新 `STUB_BODY_ZH` 与 `STUB_BODY_EN` 接入桩话术守则。
> **v2.23.0 变更（2026-11-09 · 外部客户端与跨终端监听防跳过强化 · 严禁以「外部客户端等不到回执」为由跳过 wait · 提示词与回执显式携带 [<ID>] 防混淆 · CLI 运行时防呆与体检联动 · 动 STUB_BODY ⇒ 各载体须重跑 baton install）**：动因——①用户与 WorkBuddy/Cursor 跨终端交接时，Agent 产生典型合理化认知误区（“执行方是外部客户端，baton 的 wait 等不到它的回执，挂了也只是空耗 240 分钟”），擅自跳过后台监听导致自动化闭环断裂、工单沦为无监听孤儿；②同一会话内多工单并行流转时，缺乏工单 ID 的提示词极易引发人类与 Agent 的认知混乱与张冠李戴。①**文件系统总线认知硬化（Filesystem Bus Invariant）**：明确 Baton 底层依托本地文件系统内核事件（`fs.watch`），无论执行方是同窗口子 Agent、外部客户端（Cursor/WorkBuddy/Antigravity 等）、独立终端还是人工，一旦执行方 `deliver` 立即毫秒级触发平息唤醒；②**接入桩反借口硬门禁**：在早拦 Preflight 与出站最小序列中明文注入**严禁借口**条款，彻底封堵「执行方是外部客户端/等不到回执/会空耗超时」的偷懒辩解；③**提示词与回执显式携单号（Prompt Explicit Ticket ID）**：无论是出站交接提示词（`请【<角色>】接单 [<ID>]：<路径>`）还是入站回执交付行（`请【<发起方>】查收【<本方>】回执 [<ID>]：<路径>`），一律在角色后显式绑定 `[<ID>]`，消除同对话多交接的理解歧义；④**CLI 运行时防呆（Agent Environment Guard）**：`cmdForward` 检测到 Agent 托管环境且裸调未带 `--wait`/`--daemon` 时，输出高亮安全警示，明确提醒文件系统感知事实，指引立即后台运行 `baton wait <id>`；⑤**体检门禁联动**：`cmdCheck` 与 `cmdCheckIntra` 新增 `reportUnwatchedPending` 诊断，发现当前仓库有 `forwarded` 且无存活 wait 探针的工单时，在 `check` 中显式标明 `[⚠️ 无监听]` 并指导挂起。
> **v2.22.0 变更（2026-11-09 · 对外话术通俗化：术语分层 · 禁用「无需转递」类无主语缩写 · 监听可验证性与 --daemon 假成功根治 D1–D5 全量 · 动 STUB_BODY ⇒ 各载体须重跑 baton install）**：动因——用户反馈「无需转递」这句收尾话术**无法判断谁来接手**，被误读成「Agent 自己兜了后续工作」；同时 Tappy 跨仓反馈 Agent 环境下 `--daemon` 假成功与监听状态不可见。①**术语分层**：区分**机器层**（`## 转递提示词` 节名、`forward`/`deliver` 子命令、五态状态机——`check` 硬校验的锚点，**保持不变**，改名会击穿存量回执与门禁）与**面向人层**（Agent 对人类的进度与收尾话术——**必须通俗**）；②**收尾三要素（硬纪律）**：任何交代进度或收尾的回复，必须让人只读该段即可判断「谁在做、我这边还动不动」——即**对方是谁 + 对方要做什么 + 我这边是否还有待办**；③**禁用清单**：「无需转递」「已闭环」等只描述内部机制、不含责任主体的缩写**禁止单独作为结论输出**，须替换为通俗表述；④**正例固化**：「我这边做完了：N 条检查命令都真跑过，全部成功，报告已交出去。接下来由**实现方**复查并收单——系统会自动通知它，你不用转告。我这边没有要做的事了。」；⑤**监听可验证性与宿主环境模型（D1–D5）**：D1 Agent 环境下 `--daemon` 显式拦截并 `exit 3`（含 `后台任务` 提示，无假成功文案），文档化 `BATON_MANAGED_MODE=0` 脱钩后门；D2 落地 `.watch/<id>.json` 注册表与信号清理，`status` 实时显式输出 `监听: pid x (ym)` / `⚠️ 无监听`；D3 `received` 超 10 分钟未 deliver 显式空转告警，`receipt` 提示需 `deliver` 唤醒；D4 `baton link --check` / `baton doctor` 判定 `桩版本 == 引擎版本`，漂移自动重生成；D5 驳回不回弹：`cmdReject` 同步清空回执 `delivered_at` 并记录工单 `rejected_at`，`wait` 探针引入 `rejected_at` 交付时效下界校验且首轮 snapshot 实际 mtime 消除启动即回弹；附带修复 `init` / `new` 的 lane 与 TARGET 撞名校验。
> **v2.21.0 变更（2026-11-09 · 原生支持 Workspace Driver 钩子与 `workspace: worktree` 物理隔离 · 微内核解耦驱动挂载 · ADR-0003）**：动因——多 Agent 在同项目并发修改容易造成主工作区 Git 冲突、撤销污染与上下文幻觉；同时为保证 Handoff 独立开源轻量中立性，采用微内核 + 可插拔 Workspace Driver 架构。①**工单原生支持 `workspace: worktree`**：`baton new` 支持 `--workspace worktree`（或 `.handoff-hub.json` 配置 `workspace_default: "worktree"`）；②**Workspace Driver 抽象与生命周期钩子**：`baton forward` 自动探测驱动并调用分配（`allocate`）专属物理工作树与依赖缓存共享；`baton close` 支持 `--prune-worktree` 安全清理与分支回收；③**提示词环境隔离感知**：`baton prompt` 自适应生成指引执行方在隔离工作树接单的标准提示词；④**零依赖优雅降级**：独立开源用户在未安装驱动时，安全提示降级为常规分支操作，核心保持 0 生产依赖与跨平台兼容。
> **v2.20.0 变更（2026-11-08 · 多工单聚合等待与轻量级 Pub/Sub 监听 · 支持 baton wait <id1> [id2 ...] [--any|--all] · 解决多实例并行交接阻塞失配 · 动 STUB_BODY ⇒ 各载体须重跑 baton install）**：动因——用户与多 Agent 并行协作反馈：当发起方拆解或派发多份并发交接任务（如多 Lane 协同、多模块并行实现或实现+审计双流派发）时，若为每个 ID 派生独立 wait 进程，不仅竞争系统资源并产生多进程争抢，更会导致外层 AI 宿主（如 Antigravity / Claude Code / Cursor）的任务调度器面临“哪个先退出、哪个先唤醒”的失配难题；若引入常驻 Pub/Sub Daemon，又会导致进程孤儿化与基础设施过度重量化。①**轻量级进程内聚合等待（In-Process Lightweight Pub/Sub）**：`cmdWait` 原生支持一次性传入多个工单 ID（`baton wait <id1> <id2> ...`），在单一 Node.js 进程内复用 OS 文件系统内核级事件流（`fs.watch`），实现 0 额外守护、0 复杂中介、毫秒级感知的多路复用监听；②**双模聚合判定（Race vs. Join）**：默认 `--all`（Join 模式），等待全部目标工单全量交付后再统一启动平息缓冲并 Exit 0 唤醒发起方；支持 `--any`（Race 模式），任意一个目标工单完成交付即刻平息并唤醒；③**会话平息与聚合状态诊断**：平息缓冲期（Settle Window）动态覆盖全部关联工单，超时时打印矩阵式全景诊断状态（各 ID 交付进度一目了然）；④**向下无缝兼容**：单 ID 行为、环境变量及超时配置与 v2.19.0 完全等价；Backlog 落地见 `docs/backlogs/03-baton-wait-multi-id-lightweight-pubsub.md`。
> **v2.19.0 变更（2026-11-08 · 引入执行方交付平息缓冲期 Settle Window · 解决长任务状态快照超时与回执待交付死等 · 默认等待超时提升至 60m · 彻底杜绝会话未完抢跑闭环 · 动 STUB_BODY ⇒ 各载体须重跑 baton install）**：动因——下游实测反馈两项核心痛点：①执行方刚打上 `delivered` 戳，发起方探针毫秒级唤醒并抢跑闭环，导致执行方 Agent 对话尚未收尾、后置清理或总结未完即被抢先锁定事实；②复杂任务执行超过 30m 或执行方仅登记回执草稿（`received`）未跑 `deliver` 时，发起方探针死等直至 30m 报超时 Exit 124，误导人类与发起方。①**会话平息缓冲期（Settle Window）**：`cmdWait` 检测到终态交付（`delivered`）信号后，默认静默等待 10s（`--settle` / `BATON_SETTLE_DELAY` 可配）平息缓冲，期间若检测到文件写入活动自动顺延重置，确保执行方 Agent 会话彻底结束退出后再 Exit 0 唤醒发起方，彻底杜绝毫秒级抢跑竞态；②**等待超时与保活机制升级**：`baton wait` 默认超时由 30m 提升至 **60m**（支持 `BATON_WAIT_TIMEOUT` 全局配置），每 5 分钟输出微量保活心跳防止 Agent 管道误杀；③**回执超时精准诊断**：若超时退出时回执已存在（status: received），探针输出清晰诊断与救砖建议，指明系执行方漏跑 `deliver` 所致，杜绝假超时困惑；④**状态快照宽容自动续期**：执行方收尾执行 `receipt`/`deliver` 时，若 60m status 快照已过期但此前曾查验过，自动续期快照时间戳，避免长任务收尾被粗暴打断；⑤**入站操作序列纠偏**：明确规范「回执登记 `receipt` → 校验自检 `check` → 终态交付 `deliver`」，确保交付是执行方会话的最末动作。
> **v2.18.0 变更（2026-11-07 · 引入执行方终态交付机制 baton deliver · 彻底根治跨仓与多会话抢跑闭环竞态 · 状态机五态升级 · 动 STUB_BODY ⇒ 各载体须重跑 baton install）**：动因——Tappy 跨仓交接实证（2026-11-07）暴露核心时序竞态：执行方仅生成回执文件草稿尚未完成自检或收尾，`cmdWait` 探针仅据「mtime 变动 + 文件存在」即擅自翻 `received` 并提前唤醒发起方；发起方随之抢跑 `accept` 闭环并提前改写主线 Backlog，导致执行方会话尚未结束、事实却已被锁定的时序失控。①**显式终态交付（Explicit Final Delivery）**：引入全新子命令 `baton deliver <id>`（及原子复合选项 `baton receipt <id> --deliver`），由执行方在自检全过、会话收尾时显式提交终态交付，烙印 `delivered_at` 时间戳与 `delivered` 状态；②**探针抢跑彻底根治（Anti-Premature Wakeup）**：`cmdWait` 跨仓探针移除「回执变动自动翻 `received`」的脆弱逻辑，仅在检测到执行方显式交付（`delivered`/`closed`）后方 Exit 0 唤醒发起方；③**闭环硬门禁强化（Anti-Race Accept Gate）**：`cmdAccept` 增设 `delivered_at` 硬门禁，无显式交付声明一律拒绝闭环（Exit 1）；防提前闭环从仓内扩展至跨仓双向校验；闭环时写入 `accepted_at` 与 `delivered_at`，达成全生命周期审计链闭环；④**五态确定性状态机（5-State Lifecycle）**：`draft → forwarded → received → delivered → closed`，`handoff-status.mjs` 与 Mermaid 全面支持；⑤**存量无缝向前兼容（Legacy Exemption）**：自动豁免 2026-11-08 前的历史存量工单，保证现有 120 份交接 0 报错平滑升级；⑥**契约硬约束**：明确发起方在收到执行方显式交付前，严禁将未定稿回执写入主线规划或 Backlog。
> **v2.17.0 变更（2026-11-06 · 解耦 --wait 与 --daemon · 构建全 AI 客户端与人类终端统一状态监听与唤醒模型 · 动 STUB_BODY ⇒ 各载体须重跑 baton install）**：动因——v2.16.6 将 `forward --wait` 强行合流为 `spawnDaemonWait` 脱钩后台，在人类终端免阻塞表现良好，但在托管式 AI 客户端（如 Google Antigravity、Claude Code、Cursor 等）中，因进程秒退导致宿主任务管理器无法接管后台任务，且孤儿 Node 退出时无法触发宿主 Reactive Wakeup 机制，导致长任务挂起与自动唤醒完全失效。①**语义解耦（Semantic Separation）**：还原 `--wait` 为标准托管阻塞等待（Managed process-tree waiting，保持进程树存活，依托 `fs.watch` + 自适应退避 0-Token 挂起，回执落地时 Exit 0 唤醒宿主）；还原 `--daemon` 为人类终端专用的 OS 孤儿脱钩（Detached OS daemon，秒退后台）；②**环境自适应感知（Smart Environment Auto-Detection）**：内置 `isAgentEnvironment()` 探针，感知 Antigravity、Claude Code、Cursor 等典型 Agent 宿主环境；在托管环境下，即便误传 `--daemon` 亦智能回退为托管阻塞等待，彻底杜绝唤醒丢失；③**统一规范接入桩（Agent Stub）**：出站最小操作序列指引升级为 `baton forward <ID> --wait`（AI 客户端宿主进程树托管；人类终端可选 `--daemon`）。
> **v2.16.6 变更（2026-11-06 · forward --wait 统一为自脱钩后台守护 · 消除管道误杀面）**：动因——`baton forward <id> --wait` 原走进程内阻塞等待，在经由管道截断（如 `| head -6`）或外部工具超时包装时易遭 SIGPIPE/SIGTERM 误杀导致监听未挂起。①**forward --wait 统一为自脱钩守护**：`baton forward <id> --wait` 与 `--daemon` 彻底统一复用 `spawnDaemonWait`，父命令 <0.1s 退出、守护常驻后台并在回执到达时 Exit 0 唤醒；②**引导语与帮助文案纠正**：修复 `cmdNew` / `cmdNewIntra` 引导语中「置于后台运行」的脆弱描述，统一为自动脱钩后台守护安全指引，CLI 帮助同步更新；③**参数透明透传**：`wait` 与 `forward` 对 `--timeout` 等参数透传与独立 `baton wait` 行为完全保持一致。
> **v2.16.5 变更（2026-11-06 · 守护监听路径纠偏 + 严防抢跑回执 + 出站守护探针规约 · 动 STUB_BODY ⇒ 各载体须重跑 baton install）**：动因——下游消费方实测反馈同仓协作时因混淆旧文档遗漏后台监听，且执行方中途受阻时抢跑提交 Verified 伪回执；同时修复 `spawnDaemonWait` 在同仓模式下日志路径嵌套 Bug。①**守护日志路径纠正**：修复 `spawnDaemonWait` 内 `ROOT` 叠加导致的 `.handoffs/.handoffs/logs` 嵌套目录；②**同仓免监听混淆消除**：移除历史模板「免转递」字样，明晰无论同仓还是跨仓，均必须启动后台监听探针以达成事件唤醒闭环；③**接入桩强化反抢跑回执**：早拦 Preflight 与入站序列明确要求「验收判据全部实测通过方可提交回执，中途受阻仅记录 reviews/，严禁提交抢跑回执」；④**出站优先推荐 `--daemon`**：一条命令完成转递、打印交接提示词与脱钩后台守护。
> **v2.16.0 变更（2026-11-05 · 开源产品化基础 · 纯配置驱动 + 双盲审计防伪门禁 + 拓扑可视化）**：动因——面向开源发布标准，根除硬编码业务名，强化 Agent 角色身份隔离与防自签作弊。①**纯配置驱动（Zero-Hardcode）**：彻底解耦硬编码 target，新增 `units/handoffs/.handoff-hub.json` 作为事实源，`handoff.mjs` 与 `handoff-status.mjs` 动态加载，支持用户自定义 targets；②**跨仓脚手架 `handoff init --cross`**：一键生成独立中枢 Hub 目录与骨架配置；③**双盲审计与防伪挑战令牌（Audit Nonce）**：`to_lane=audit` 派单自动签发高熵一次性 Nonce，`handoff receipt` 必须带 `--audit-nonce` 核验通过方可盖章，根除本地同一会话伪造 `HANDOFF_LANE` 自签回执漏洞；④**双盲脱敏（`--blind`）**：`handoff forward --blind` 自动物理净化大模型主观思维链（`<thinking>` 等）与辩护小节，仅向审计方传递客观契约与 Diff；⑤**拓扑可视化（`--mermaid`）**：`handoff status --mermaid` 一键生成任务在各仓/各 Lane 间的实时 Mermaid 关系流向图。
> **v2.15.1 变更（2026-11-04 · 能效深度优化 · 根除长程后台监听发热与卡顿）**：动因——`handoff wait` 后台监听在长程挂起时高频轮询打断 CPU 深度休眠。①**`fs.watch` 事件驱动**：接入 OS 内核级文件系统事件通知，文件写入瞬间毫秒级唤醒，等待期间 0 CPU 占用；②**`mtime` 守卫**：未变动时跳过 `readFileSync` 与正则解析；③**自适应动态退避**：兜底定时器动态自适应退避（2s→4s→8s→15s），唤醒降低 80%+；④**`handoff-status.mjs` 读盘去重**：消除重复 I/O。
> **v2.15.0 变更（2026-11-04 · 仓内回执免转递减负 · 盲肠仪式退火 · 动 `STUB_BODY` ⇒ 各载体须重跑 `handoff install`）**：动因——随着 v2.14.0 引入 `handoff wait` / `handoff forward --wait` 后台监听机制，发起方已被系统级 Reactive Wakeup 自动唤醒，仓内回执继续强制输出「回执交付行」及回执内硬塞「## 转递提示词」节已成为冗余盲肠。①**仓内回执免转递提示词**：仓内同工作区回执免写「## 转递提示词」节，`checkReceiptPrompt` 与落盘门禁全面豁免；②**免回复末块提示词限制**：仓内执行方写完回执直接结束回合，无需在回复末块死板追加提示词；③**全渠道载体支持扩展**：`handoff install` 与 `checkStubCarrier` 正式将 `GEMINI.md` 纳为一等载体，与 `AGENTS.md` / `CLAUDE.md` 协同刷新；④**`forward --wait` 复合原子命令**：一条命令完成标记转递、输出提示词与挂起后台监听。
> **v2.14.0 变更（2026-11-04 · 新增 `handoff wait` 后台监听 · 跨仓与同仓多窗口异步协同）**：动因——多 Agent / 多窗口工作流中，交接发起方停滞等待回执依赖人工在窗口间复制提示词，割裂感强且缺乏事件驱动机制。①**`handoff wait <id> [--timeout <dur>] [--interval <dur>]`**：专职后台监听子命令，配合 Agent `run_in_background` / 异步执行机制挂起，0 Token 待机；②**状态与原子性判定**：轮询交接单与回执单状态流转，回执合规落地且状态翻为 `received`/`closed` 后自动打印结构化回执摘要并 **Exit 0 退出**，借由宿主系统的 Reactive Wakeup 机制自动唤醒发起方/审计方；③**防死锁超时保护**：内置可配置 TTL（默认 30m，支持 10m/1h/30s 等），超时安全退出（Exit 124）并提示人工排查；④**防偷工减料硬门禁注入**：唤醒输出中强化注入审计纪律（**严禁仅静态读码或自报采信**，必须在终端独立运行验收命令后闭环）；⑤**同仓多窗口与跨仓全覆盖**：仓内自动读取 Lane 身份与自然角色，跨仓自动识别回执落地。
> **v2.10 变更**：①**回执规范单一来源收口**——删除 `handoff.mjs` 内嵌的竞争骨架 `R_BODY`，回执正文一律以 `RESPONSE-TEMPLATE.md` 为准，CLI 缺文件时只落**指针桩**（锚节 `修复状态`/`结论`）；`receipt -n "<回执正文>"` 现在真正落盘（旧实现静默丢弃）；②`check` 对契约生效日（2026-10-13）起的回执**硬校验正文锚节**；③写动作（`receipt`/`accept`/`reject`）前加**「先查状态」门禁**（窗口内须跑过 `handoff status`）。跨仓 `--json` v1 schema **不变**。
> **v2.10 补记**：**接入桩「早拦 Preflight」化，marker 升 `handoff-stub:v2.1`**（取代 v2.9「marker 冻结」；报废由 `STUB_MARKERS` 多 marker 幂等替换消解）。桩正文 = 早拦 Preflight + 最小操作序列（仓内）+ 指向 `AGENT-GUIDE.md`；三处（`handoff.mjs` `STUB_BLOCK` / 本文件 §接入桩 / hub `AGENTS.md`）逐字一致。各仓重跑 `handoff install` 即由 v2.0 桩自动迁移。
> **v2.11 变更**：①**「转递提示词」节随锚节升为 `check` 硬校验**——阈值 `RECEIPT_PROMPT_SINCE=2026-10-13` 起的新回执缺失该节即 exit≠0，存量豁免；同工作区（`COREML-*` / 仓内 `workspace=same`）免转递豁免（**v2.12.4 已解耦**：仓内 `same` 的**回执交付行**不豁免）。②三处接入桩 + `AGENT-GUIDE.md` 回执模板由「列举要素」改为**指针指向 `RESPONSE-TEMPLATE.md`**（含「## 转递提示词」节），消灭与唯一源冲突的第二份竞争模板（v2.10 去骨架化后「要求写在骨架外 = 没有」的条件重演）。③桩「最小操作序列」补**出站方向**（`new` → `forward` → `prompt`）。跨仓 `--json` v1 schema **不变**。
> **v2.11.1 变更（同日小修）**：**转递提示词在对话回复中升为固定末块**——Agent 回复的**最末块固定为** `## 转递提示词`，其下仅一行，其后不再有任何正文/结束语。此前该行只写「对话回复结尾再附同一行」（散文），agent 常把它塞进正文中段，用户翻找困难；现改为**位置（末块）+ 词面（`## 转递提示词`）双锚**，滚到底或搜索均命中。仅跨仓 / 仓内 `workspace=separate` 产出；属回复排版纪律，`check` 不可校验。
> **v2.12 变更（2026-10-14 · 接入桩「真·单一源 + 生成件完整性」· 修复 v2.11.1 回归）**：①**修复 v2.11.1 引入的回归**——`STUB_BLOCK` 曾误去掉 `handoff-stub:v2.1` marker 包裹（改以 `<!-- generated — do not edit -->` / `<!-- stub:sha256:... -->` 头替代），致 `findStubBlock` 对新块恒返回 `null`：`install` 不再刷新任何载体（全部「手写指针」告警跳过）、`checkStubCarrier` 形同虚设，且载体已出现**重复桩**（各 2 份）。②**marker 包裹恢复**（生成注置于 marker 之内）；`install` 改为按「桩区块」正则（兼容历史无 marker 块）**先去重再整块替换**，并把 `README.md` §接入桩 纳入目标（`--no-readme` 可关）。③`stub:sha256` 改为**实算 `sha256(STUB_BODY)`**，`check` 新增：载体含 >1 份桩、或正文与 `STUB_BLOCK` 不一致 → exit≠0 并点名文件。
> **v2.12.1 变更（2026-10-14 · 审计修复 F1–F8）**：独立审计（`AUDIT-REPORT-2026-10-14-INDEP01.md`）在 v2.12 上实测出 10 项问题，本轮修其中代码项 **F1–F8**：①**F1（P0）**`STUB_REGION_RE` 单条 alternation 因更早匹配点「抢跑」，正文含 `### Handoff 接入桩（…` 时 `install` 会把用户正文整段**静默删除**（且 `check` 仍 exit 0）→ 拆为 marker 块 / heading 块两条正则，**marker 优先**（`scanStub`/`stripStub`），heading 分支加「强制守卫 · 细则以」特征串约束；②**F2（P1）**`install` 遇 `~/.claude` 等目录缺失 → ENOENT 崩溃 + 部分写入（README 轮不到）→ 写前 `mkdirSync(recursive)` + 逐目标 try/catch（`safeWrite`），失败跳过不中断；③F3 `--global` 不再写 cwd `README.md`；④F4 去重只在桩接缝处规范化空行，**不再重排用户排版**；⑤F5 删除死代码 `findStubBlock`（0 调用点），文档叙事改为「统一走桩区块正则」；⑥F6 `check` 新增「载体缺标准 marker」检测（原检不出 marker 丢失）；⑦F7 `--no-readme` 补进用法表；⑧F8 `STUB_CANON` 先 CRLF→LF，消除 Windows 改写误判「漂移」。marker 不变（`handoff-stub:v2.1`）；桩正文版本串 v2.12 → **v2.12.1**，各载体重跑 `handoff install` 即刷新。
> **v2.12.2 变更（2026-10-14 · 目标注册 Tappy / 一期一卉花）**：生态第 5、6 个仓库 **Tappy**（Android 自动化工厂）与 **一期一卉花**（花店小程序，slug `yiqiyihuihua`）登记为跨仓一等 target——`TARGETS` / `TARGET_LABELS` 扩容，README 命名规范、正则与路由表同步。桩正文版本串 v2.12.1 → **v2.12.2**，各载体重跑 `handoff install` 即刷新。marker 不变（`handoff-stub:v2.1`）。
> **v2.12.3 变更（2026-10-14 · 回执「内容完整性」门禁 · P0-a/P0-b/P0-c）**：动因——2026-10-13 一期一卉花 `goods-stores-20261013-01-task-resp` **伪回执**（frontmatter + 「## 转递提示词」齐全、`check` 能过，但声称新增的目录/提交均不存在）穿过所有自动门禁，仅在人工 reject 阶段才识破。①**P0-a**：`accept`/`reject` 前置对该回执跑内容门禁（锚节 + 转递提示词 + evidence），不过即拒闭环；②**P0-b**：`receipt -n` 落盘前即校验，缺项拒收、不落盘、不翻状态；③**P0-c**：回执新增 **`evidence` 字段**（`evidence_paths` / `evidence_commits` / `evidence_repo` / `evidence_note`），`receipt`/`accept`/`check` 三处机器校验——仓内新回执（阈值 `EVIDENCE_SINCE=2026-10-14` 起）**必须**声明，声称路径须 `fs.existsSync` 真实存在、提交须 `git cat-file -e` 可查；跨仓目标仓不可达时降级 warn（可用 `HANDOFF_REPO_ROOTS=key=path,...` 启用硬核）。④**P1-b**：`handoff prompt` 仓内 `workspace=separate` 分支补可复制提示词行（对齐 v2.11 契约）。存量（阈值日前）豁免，不回改历史。设计见 `PROPOSAL-2026-10-14-receipt-content-integrity.md`。
> **v2.12.5 变更（2026-10-21 · 接入桩「状态语义」纠错 + `draft` 可直达回执 + 仓内状态标签分区 · 动 `STUB_BODY` ⇒ 各载体须重跑 `handoff install`）**：动因——`PROBLEM-2026-10-21-draft-forwarded-blacklisted-in-stub.md` 实测：接入桩早拦条写「只认进行中：`closed/accepted/rejected/draft/forwarded` 一律不处理」，与本契约 v2.7（`draft`+`forwarded` 都入 pending、**严禁据此判不处理**）逐字相悖，且同仓 `workspace=same` 新单天生停在 `draft` ⇒ 桩把每个新单拉黑——执行方收单「只读不执行」的机器根因（同族实证：`SWOOP-20260904-02`）。①**桩纠错**：删除该拉黑条，改为**状态语义唯一定义**（「进行中」= 未闭环且归属当前方；**待办 = `draft` + `forwarded`**，含驳回退回的返工单；`received` = 执行方跳过、发起方审计；`closed` 不处理；`accepted`/`rejected` 为废止状态、不存在），出/入站序列同步（入站第一步改 `status --for <本方 lane|target>` 直取本方待办；`forward` 标注可选）。②**`receipt` 放开 `draft`**：`draft → received` 直接登记——旧硬拒「尚未 forward，不能回执」把 v2.7 明文场景「用户直接递文档、不跑 `forward`」的执行方挡在最后一步、被迫替发起方跑 `forward`（假章），且 `sync` 一直放行 draft、两路径互相矛盾。③**仓内状态标签分区**：`status` 中央视图 / `--for` 视图下仓内 `draft`/`forwarded` 渲染**「待执行」**（原「待转递 / 已转递」是跨仓口吻，读作『已发出去、有人接手了』，误导执行 lane 不动工），中央视图两态合并一桶防同名双标题、每项下一步带「读→写」动作；**跨仓标签与 `--json` 全部逐字节不变**。④**`brief` 纳入 `forwarded`**（原仅收 `draft`：按 new→forward→brief 顺序跑会拿到空收件箱；驳回退回的返工单也不再从收件箱消失）。⑤`check` 新增**待执行滞留提示**（非阻断：`draft`/`forwarded` ≥7 天未推进逐条列出，跨仓 + 仓内）。⑥README / 接入桩 / `AGENT-GUIDE.md` 三处「进行中」给同一定义（原三处三个集合：status 表头 = 全部未闭环、本文 v2.7 pending = draft+forwarded、桩 = 仅 received）。
> **v2.9 变更**：①「仓内模式（intra-repo）」升为一等模式；②「Agent Consumption Contract」补**执行方工作单唯一性**条款；③接入桩升 **v2.1**（模式感知，marker 不变）。
> **v2.13.0 变更（2026-10-26 · 仓内角色映射 + 同仓提示词重构 + 防提前闭环 + 审计动作契约 · 动 `STUB_BODY` ⇒ 各载体须重跑 `handoff install`）**：动因——Tappy 仓内交接 `audit-20261026-01-task` 暴露三类体验 / 安全缺陷：①提示词把项目名 / lane slug 当沟通角色（「请 Tappy 收交接」「请 impl lane 收交接」「请收 Tappy 回执」）；②发起方建交接后立即自填审计回执并闭环（`status: closed`），破坏独立审计制衡；③审计 Agent 仅静态读码即宣称通过，未独立执行验收判据。①**仓内角色映射（Lane Identifier → Engineer Role）**：`handoff.mjs` 新增默认映射 `impl→实现方` / `audit→审计方` / `arch·design→架构设计方`，`.handoff-hub.json` 的 `lane_labels` 可显式覆盖、缺省回退默认映射；②**同仓提示词重构**：严禁出现项目名，出站 = `请【<目标角色>】接单：<路径>（<主题>）`、入站回执交付 = `请【<发起角色>】查收【<本方角色>】回执：<路径>（<结论> · 是否需改动：<是/否>）`，`printReceiptDeliveryLine` 仓内模式**弃用 `detectRepo`**、改读回执 frontmatter 的 `from_lane`/`to_lane` 拼角色；③**防提前闭环门禁（Anti-Self-Closing）**：`receipt` 据当前窗口 `HANDOFF_LANE` 硬拒发起方自填 / 越界写回执，并在回执落 `author_lane`，`accept`/`check` 双侧核验回执确由接收方撰写、非发起方自填；④**审计动作契约**：`to_lane=audit` 时，在接入桩 + `handoff prompt` 输出 + 交接文档「给执行方」节**强制注入**「审计方**严禁仅静态读码**——必须在终端**独立执行**交接文档「验收判据」中的**所有测试与校验命令**，以实测输出为唯一准绳，**严禁采信自报**」。
> **变更历史（v2.3 → v2.9，含回退留痕）见 [`CHANGELOG.md`](CHANGELOG.md)**——本 README 只保留当前契约。

## 布局
```
units/handoffs/                    ← 契约 + 引擎层（版本化，稳定）
├── README.md            本契约（唯一真相源）
├── CHANGELOG.md         契约变更历史（README 的版本演进与踩坑留痕）
├── DESIGN.md            设计机制说明书（面向复用；行为规范仍以本契约为准）
├── RESPONSE-TEMPLATE.md 回执规范（依赖方 agent 写回执的唯一依据，prompt 命令引用它）
├── COMMANDS.md          命令手册（CLI 子命令全集 + 生命周期速查；/ 命令已废弃）
├── COREML-CONVENTION.md **说明文档，非契约** —— COREML 同工作区侧的背景与理由
├── handoff.mjs          引擎入口（`handoff <op>` = PATH shim → 本文件；兜底 `node handoff.mjs <op>` · 无 / 命令 · 散文触发）
├── handoff-status.mjs   状态巡检（扫目录生成报告，支持 --json）
│
│   ── 以下为运行态数据层（高频变更，不应随契约一起版本化）──
├── handoffs/            交接（双向：iggle → Swoop/Prospero，或 Swoop → iggle 反向发现）
├── receipts/            回执（双向：<交接ID>-resp.md，谁接收交接谁写回执）
├── inbox/               收件箱快照（brief 生成，非权威、可能过期）
└── legacy/              归档（旧脚本 / 历史台账 / 引擎旧备份）
```

## 文件名规范（机器可解析 · 便于 agent 识别）

**交接文件** `handoffs/<ID>.md`：
```
<ID> = <TARGET>-<YYYYMMDD>-<NN>-<TYPE>
```
- `<TARGET>`：`SWOOP` / `PROSPERO` / `IGGLE` / `COREML` / `TAPPY` / `YIQIYIHUIHUA`（大写，**标识交接的「接收方」**——谁接收谁写回执）
- `<YYYYMMDD>`：8 位日期（如 `20260816`，**不用 2 位年**，避免歧义）
- `<NN>`：同日序号，从 `01` 起递增
- `<TYPE>`：`bug` / `feature` / `breaking` / `question`（直接体现在文件名，agent 可 `ls | grep bug` 筛选）

**回执文件** `receipts/<ID>-resp.md`：文件名 = 对应交接 `<ID>` 追加 `-resp`，frontmatter 首行含 `handoff_id: <ID>`。

**关联规则**：回执文件名去掉 `-resp.md` 即等于交接 `<ID>`；脚本同时以 frontmatter `handoff_id` 为权威键双重校验，两者任一能匹配即关联成功。

**agent 可直接用的正则**：
- 交接：`/^(SWOOP|PROSPERO|IGGLE|COREML|TAPPY|YIQIYIHUIHUA)-(\d{8})-(\d{2})-(bug|feature|breaking|question)\.md$/`
- 回执：`/^(SWOOP|PROSPERO|IGGLE|COREML|TAPPY|YIQIYIHUIHUA)-(\d{8})-(\d{2})-(bug|feature|breaking|question)-resp\.md$/`

### 接收方即前缀（路由规则 · v2.1 新增）

**前缀 = 交接的「接收方」 = 回执的「撰写方」**。一眼即可判断「这份归谁处理」，两个 agent 不必记两套规则：

**发送方不限定 iggle**（v2.12.4 热修批次七 · 2026-10-18）：`IGGLE-*` 历史上是「Swoop → iggle 反向发现」，但 Handoff Hub 维护方可直接以自己为发起方建交接（2026-10-18 的 `TAPPY-*` / `IGGLE-*` / `SWOOP-*` `-01-bug` 系列即由 hub 发起，用于派发文档清理任务）。发送方以交接 frontmatter / 用户转递话术为准；**引擎输出不默认任何一方仓名**（批次七修：`new` 标题方向标签、回执标题 authorLabel、brief intro、receipt 状态行、回执指针桩五处原写死 iggle，另 `RESPONSE-TEMPLATE.md` 整篇泛化为全方向）。

- `SWOOP-*` 交接 → 接收方是 Swoop（iggle → Swoop）→ 回执由 **Swoop 写** → `SWOOP-*-resp.md`
- `PROSPERO-*` 交接 → 接收方是 Prospero → 回执由 **Prospero 写** → `PROSPERO-*-resp.md`
- `COREML-*` 交接 → 接收方是 iggle-coreml（iggle → iggle-coreml）→ 回执由 **iggle-coreml 写** → `COREML-*-resp.md`
- `TAPPY-*` 交接 → 接收方是 Tappy（iggle → Tappy）→ 回执由 **Tappy 写** → `TAPPY-*-resp.md`
- `YIQIYIHUIHUA-*` 交接 → 接收方是 一期一卉花（iggle → 一期一卉花）→ 回执由 **一期一卉花 写** → `YIQIYIHUIHUA-*-resp.md`
- `IGGLE-*` 交接 → 接收方是 iggle（Swoop → iggle 反向发现）→ 回执由 **iggle 写** → `IGGLE-*-resp.md`

回执文件名永远 = `<交接ID>-resp`，自动继承前缀，**无需额外记忆**。因此：dependencies（Swoop/Prospero/iggle-coreml/Tappy/一期一卉花）只处理前缀指向自己接收的交接并写回执；iggle 处理 `IGGLE-*` 交接并写其回执。

### 迁移（仅前向生效）

- v2.1 起新交接按上述前缀规则；**存量 `SWOOP-*`/`PROSPERO-*` 不动**（Hub 本就允许 legacy 格式不强制）。
- 反向发现（Swoop→iggle）在 v2.1 前被强行标成 `SWOOP-*`，方向拧巴；v2.1 后一律用 `IGGLE-*`，方向自明。
- v2.2 起新增 `COREML-*`：生态第 4 仓库 iggle-coreml（模型能力提供方）成为一等 target，iggle → iggle-coreml 前向交接用 `COREML-*`（不再拿 `CONSUL` 前缀凑合）。

## 交接文件 frontmatter（机器可读）
```yaml
---
handoff_id: SWOOP-20260816-01-bug
target: swoop            # swoop | prospero | iggle | coreml | tappy | yiqiyihuihua（接收方；iggle = Swoop→iggle 反向发现）
type: bug                # bug | feature | breaking | question
status: draft            # draft → forwarded → received → delivered → closed
needs_iggle_change: false
common_version: v2.5     # ZSpec ④ 跨平台共享版本；变更触发全员失效回流（handoff drift --common）
platform_versions: ''    # ZSpec ④ 平台专属版本，形如 `swoop=6aad880;prospero=v2.3`；某平台变更仅该平台下游失效回流
created: 2026-08-16
closed: 2026-08-17       # 闭环时填
---
```

## 回执文件 frontmatter
```yaml
---
handoff_id: SWOOP-20260816-01-bug          # 必填（首行）
needs_iggle_change: true                  # 必填：决定 iggle 侧是否要升依赖 / 改调用
from_repo: swoop                           # 撰写方（谁写回执）
to_repo: iggle                        # 接收方（谁验收）
date: 2026-08-16                           # 用 date，不要用 created
evidence_paths: cloudfunctions/stores/index.js,miniprogram/modules/admin/stores/pages/list/index.js   # v2.12.3 仓内新回执必填：声称新增/修改的真实文件（逗号分隔，相对仓根；machine-checked 存在性）
evidence_commits: 5aa64ed7                  # v2.12.3 声称基于/引入的提交哈希（git cat-file -e 须可查）
                                            # v2.12.4 起：commits 与 paths 同时声明时，每个 path 须被**任一**声明提交实际改动（相关性硬校验；RELEVANCE_SINCE=2026-10-15 起，存量只 warn）
evidence_repo: swoop                        # 可选：证据所在仓（仓内缺省=cwd 可硬核；跨仓须配 HANDOFF_REPO_ROOTS 后才硬核，未声明则降级 warn 不硬拦）
evidence_note: 无文件改动，仅配置            # 确无文件改动时用此替代 paths，说明原因
---
```
> 四个字段请写全：只写 `handoff_id` 时，读者得靠文件名猜方向——`IGGLE-*` 与 `COREML-*` 的方向是反的。

> **evidence（v2.12.3 · 内容完整性门禁）**：仓内模式新回执（`EVIDENCE_SINCE=2026-10-14` 起）**必须**声明 `evidence_paths` / `evidence_commits` / `evidence_note` 之一——声称的路径须真实存在、提交须可查，否则 `receipt` / `accept` / `check` 三处拒收（**只声明不改 = 伪回执**，2026-10-13 goods-stores 事故教训）。仓内回执 frontmatter 另按 intra schema（`mode` / `from_lane` / `to_lane` / `needs_change`），方向字段不同但 evidence 要求一致。跨仓目标仓本地不可达时 evidence 校验降级为 warn（不阻断），可用 `HANDOFF_REPO_ROOTS=key=path,...` 提供本地仓根启用硬核。存量（阈值日前）回执豁免，不回改。设计见 `PROPOSAL-2026-10-14-receipt-content-integrity.md`。

> 回执正文必含「部署提示（含钉值协同）」节；写回执的 agent 须另输出一段「转递话术」给用户——细则与话术三要素见 `RESPONSE-TEMPLATE.md`。

## 状态机
`draft`（已写，待转递）→ `forwarded`（已转递，待回执）→ `received`（已写回执，待终态交付）→ `delivered`（已交付，等发起方验收）→ `closed`（已闭环）

> **`forward` 是可选的事后标记（v2.12.5 澄清）**：`draft` 下执行方即可 `handoff receipt` 登记（**`draft → received` 直达合法**，与 `sync` 行为一致）；`received → forwarded`（`reject` 退回）后执行方照旧按待办返工。**不得**因状态是 `draft`/`forwarded` 拒收 / 拒回执 / 判「不归我管」——见下方 v2.7 条与「进行中」唯一定义。

> **`forwarded` 的语义分两档**（v2.4）：
> - 真跨仓（Swoop / Prospero）：= 用户已把交接发给依赖方 agent。
> - 同工作区（COREML）：= 规格已定稿、可开工。**不表示"发出去"**——同工作区无需转递，见下节。
>
> 状态机与脚本行为两档一致，只有"人要不要在中间传话"不同。

> **`draft` 对依赖方一律 = 待处理**（v2.7 撤销 v2.6 的按 target 区分）：`draft` + `forwarded` 都入 pending，`received` 不算。见「Agent Consumption Contract」节。
> **严禁用 draft / forwarded 判断「该不该开工」** —— 判据只有「target 是否 = 当前工作区」+「交接是否落到我手上」（2026-09-04 事故根因，详见文首 v2.7 变更）。
>
> **「进行中 / 待办」唯一定义（v2.12.5 · README / 接入桩 / `AGENT-GUIDE.md` 三处同义，旧文冲突以此为准）**：「进行中」= 未闭环（`status ≠ closed`）且归属当前方；**待办 = `draft` + `forwarded`**（落我归属即该我动工，**含驳回退回的返工单**）；`received` = 已回执：执行方跳过、发起方审计；`closed` 不处理；`accepted`/`rejected` 为废止状态、不存在。status 表头「进行中 N 项」= 全部未闭环（发起方巡检口径），执行方认领用 `status --for <本方>`。

## 同工作区侧（COREML）

**判断依据只有一条：两侧是否在同一工作区。**

`crates/iggle-coreml` 是 iggle 的 Cargo workspace member，**同一台机、同一个目录树**。
它与 Swoop / Prospero 不是一回事——那边人是唯一通道，这边转递是纯仪式。

| | 真跨仓（Swoop / Prospero） | **同工作区（COREML）** |
|---|---|---|
| 转递 | 用户手工复制粘贴 | **不需要**，同会话切角色执行 |
| 交接文档的作用 | 需求说明 + 转递载体 | **规格 + 验收判据** |
| 用户何时介入 | 转递 + 收回执 | 只在**验收判定**处 |

**三条规则：**

1. **不经用户人工转递。** 写完交接即可切到 coreml 角色执行，写完回执切回验收。不必等用户搬运。
2. **执行方不 `accept`/`reject`。** 只交回执 `handoff receipt <ID>`；审计闭环/退回由发起方（验收方）执行。落我手中的那条 handoff **就是唯一工作单**（见「工作单唯一性」，v2.9）——不另建交接、不把散落文档当工作单。
3. **验收方必须独立实测，不采信自报。** 自备夹具做端到端断言——复用对方给的夹具数据等于让他自己出题自己判卷。

背景、实证与反面清单见 `COREML-CONVENTION.md`（说明文档，不是契约；与本节冲突时**以本节为准**）。

## Source of Truth

- 生命周期状态的**唯一真相源**是交接文件 frontmatter 的 `status` 字段：`draft → forwarded → received → closed`（`forwarded` 可跳过——`forward` 为可选事后标记，`draft` 经 `receipt`/`sync` 直达 `received` 合法，v2.12.5）。
- `handoff status --for <target>` 是该状态的**权威 operational 视图**：实时扫 `handoffs/`+`receipts/` 的 frontmatter，**不依赖**可能过期的 `inbox/` 快照。
- `inbox/<target>.md` 是**可选轻量快照**（供人类 / UI / 不支持 CLI 的工具快速看），**非权威、可能过期**，Agent 不得用它发现待办任务。

## 仓内模式（intra-repo · v2.9 升一等）

> **同一条 `handoff.mjs`、同一套状态机 / 骨架 / check / 桩**——模式由**作用域根**推断，不另立 CLI。
> 层级（按跨越的边界嵌套）：**同工作区 ⊂ 仓内 ⊂ 跨仓**；「同工作区（COREML）」是仓内 `workspace=same` 的成例，不是并列模式。

**根解析（引擎内置，优先级）**：`--root <dir>` → `HANDOFF_ROOT` → cwd 逐级上溯找 `.handoff-hub.json` → 都不命中则回退 lab Hub（= 跨仓模式，行为同今天）。命中 `.handoffs/` 即**仓内模式**。

**子 Hub**（`<repo>/.handoffs/`，**提交进 git**，随代码版本化）：`.handoff-hub.json`（`mode` / `lanes` / `types` / `workspace_default` / `close_policy`）+ `handoffs/` + `receipts/` + `STATUS.md`（生成物，非权威快照）。

**路由键 = lane**（接收通道 = 回执撰写方 = 交接文件名前缀，同跨仓「前缀 = 接收方」同构）。
ID：`<TO_LANE>-<YYYYMMDD>-<NN>-<TYPE>`；`type`：`task|bug|feature|question|continuation`。
**lane 名不得与跨仓 `TARGET` 撞名**（`new`/`init` 硬拒绝，防串味）。

**仓内 frontmatter（新增字段）**：`mode: intra-repo` / `from_lane`（发起）/ `to_lane`（= 前缀，∈ `lanes`）/ `workspace`（`same|separate`，默认取配置）/ `timing`（`sequential|concurrent`，可选）。回执用 `needs_change`（泛化自 `needs_iggle_change`）+ `from_lane`/`to_lane`。

**正交属性**：`workspace=same` ⇒ **免转递**（指**任务转递**免搬工作树；**回执交付行另论**——见 §转递提示词。共享工作树；改前只按 frontmatter / 文件内容定归属，**严禁用 `mtime` 推断**）；`separate` ⇒ 先经 git 同步工作树。状态机与跨仓**同一套**：`draft → forwarded → received → closed`。

**新窗口冷启动协议**（治「新窗口失忆」）：
1. 进项目**第一跑 `handoff status`**（全项目未闭环）→ `handoff status --for <lane>` 认领 → `handoff show <ID>` 看摘要后只 Read 命中项（**MUST NOT 扫描 `handoffs/`**）。
2. 判「该不该开工」只看 `to_lane = 本窗口职责` + 交接是否落我手上，**不看 `draft`/`forwarded`**。**lane 是可分饰的标签，不是「另一个 Agent」**——同仓 `workspace=same` 下单子落我 lane 即我动工，不得把活外推给「另一个主体」（v2.12.5）。同仓提示词与回执交付行**一律用自然角色**（实现方 / 审计方 / 架构设计方，或 `.handoff-hub.json` 的 `lane_labels`）表达，**严禁把项目名 / lane slug 当沟通角色**（v2.13：杜绝「请 Tappy 收交接」「请 impl lane 收交接」「请收 Tappy 回执」）。
3. **执行方不 `accept`/`reject`**；发起 lane 收回执 = 审计，**独立实测**（自备夹具）后 `accept <ID> -n "<验收结论>"` 通过 / `reject <ID> -n "<驳回理由>"` 退回。**其中 `to_lane=audit` 的交接触发审计动作契约（v2.13）**：审计方**严禁仅静态读码**——必须在终端**独立执行**交接文档「验收判据」中的**所有测试与校验命令**，以实测输出为唯一准绳，**严禁采信自报**（执行方回执里的「已通过」一律视为待验证声明）。
4. `close_policy=self` 的 `continuation` 由**后继会话**闭环：`accept <ID> -n "<结论>" --by <to_lane>`（硬校验，缺/错即拒）；默认 `sender` 由发起 lane 闭环。

**check 门禁**（换根同检 + 仓内项，硬阻断）：文件名合规、frontmatter 存在、`to_lane ∈ lanes` 枚举合法；`received`/`closed` 必带回执；`closed` 必有 `closed` 日期 + 「验收记录」节；孤儿回执；契约生效日（2026-10-13）起的回执正文**锚节校验**（非空 + `##` 节 + 状态/结论）；lane 与任何 `TARGET` 撞名告警。非阻断：体积超限、同工作区免转递提示。

> 设计论证与迁移路径见 [`PROPOSAL-2026-10-09-intra-repo-mode.md`](PROPOSAL-2026-10-09-intra-repo-mode.md)；同工作区纪律见 [`COREML-CONVENTION.md`](COREML-CONVENTION.md)。

## Agent Consumption Contract（MUST NOT scan handoffs/）

Agent 发现待处理任务的规范行为：

> 先通过 Task Discovery（`handoff status --for <target>`）得到候选任务（ID + path），**再**读取候选交接的正文；
> 而不是 `ls handoffs/` 后逐个读取自行判断。

- ❌ **MUST NOT** 扫描 / 读取 `handoffs/` 全部文件来发现任务（Token 浪费 + 易误判 stale inbox）。
- ✅ **SHOULD** 先跑 `handoff status --for <target>`，只读取返回的 pending 交接。
- 执行完写回执（`handoff receipt <ID>`），**不 accept/reject**（发起方收回执=审计，通过才闭环，不过则 reject 退回）。
- **工作单唯一性（执行方 · v2.9）**：`handoff status --for <我lane>`（跨仓 `--for <target>`）落我手中的那条 handoff **就是唯一工作单**——直接按它的「验收判据」动工 + 写回执。**绝不另 `handoff new` 一条来处理已被交接的工作**（那等于否认已持有的 handoff）；`evidence/`（或任意非 `.handoffs/handoffs/`）里散落的参考/草稿文档**不是工作单**，只在需要细节时读，不得当作「开新交接 / 建回执」的理由。看到未登记文档时按护栏拒读为 handoff，也**不要替它建交接**，除非用户**显式**要求。

### `draft` 一律算待处理（v2.7）

`status --for <target>` 的 **pending = `draft` + `forwarded`**，不再按 target 区分（v2.6 的按角色区分已撤销）：

| 状态 | 是否入 pending | 依赖方该怎么对待 |
|--------|----------------|------|
| `draft` | ✅ | 待处理。发送方可能没跑 `forward`，但文档已到你手上 |
| `forwarded` | ✅ | 待处理 |
| `received` | ❌ | 已回执，跳过，等验收方独立实测后闭环 |
| `closed` | ❌ | 不列出 |

> **历史教训（2026-09-04 事故）**：v2.6 让 `swoop`/`prospero`/`iggle` 的 `draft` 不进 pending，理由是「`draft` = 用户尚未 forward」。
> 但 `forward` 只是发送方可选的事后标记——用户普遍直接把交接文档递给依赖方而不跑它，结果 `draft` 项对依赖方**完全不可见**，
> `SWOOP-20260904-02` 因此被接收方 agent 误判「不属于本轮范围」而漏处理。
>
> **「该不该开工」的判据只有两条**：① target 是否 = 当前工作区；② 交接是否落到我手上（用户直接给了文档，或它出现在 `status --for <target>` 输出里）。
> **严禁用 draft / forwarded 判断。**

## 体积预算（Token 纪律）

交接与回执是**要被执行方和验收方通读**的文档。正文每多 100 行，每个会话就多吞几千 token——而这些 token 里大半是"为什么这么做"的论证，不是"要做什么"的规格。

| 文档 | 预算 |
|---|---|
| 交接正文 | **≤60 行 / ≤4KB** |
| 回执正文 | **≤50 行 / ≤3KB** |

**外链纪律（超限的唯一正当解法）：**

- 背景、根因论证、完整验证输出 → 写 `reviews/`，交接里只放**路径 + 一句结论**。
- 契约细节、字段语义 → 写设计文档，交接里只放**路径 + 判据**。
- **不再单独写 `<ID>-PROMPT.md` 这类衍生件**——"回执时机 + 写法"压缩进交接正文的「给执行方」节（≤8 行），通用转递话术用 `handoff prompt <ID>` 生成。

`handoff new` / `handoff receipt` 生成的骨架已按此预算精简；`handoff check` 会对 2026-08-31 起的文档报超限（**非阻断**，只提示）。存量文档是历史证据，不为体积回改。

### 转递提示词必进骨架（v2.8.1 · 2026-09-10；**v2.8.2 同日改一行式**；**v2.11 升 check 硬校验**）

**回执末尾必须有「## 转递提示词（必含 · 供用户原样复制）」节**，内容为一行（对话回复结尾再附同一行）：

`请收 <写回执仓> 回执：<回执路径>（<行数 / 字节> · 需发起方改动：<是/否> · <特殊说明，可选>）`

一行自含收方所需关键信息（谁写的回执 / 体积 / 要不要发起方跟进），**路径只出现这一次**——对话收尾勿再写带路径的摘要行（2026-09-10 用户反馈的重复点）。旧式 `登记回执：<路径>` 仍为合法触发。`handoff check` 对 2026-10-13 起（`RECEIPT_PROMPT_SINCE`）的回执**硬校验**「## 转递提示词」节，缺失即 exit≠0（**v2.11 起**；此前 2026-09-10 起的回执仅**非阻断**提示）。均排除 `COREML-*`（同工作区侧免转递）；仓内 `workspace=same` 不豁免——回执交付行须含「## 转递提示词」节（仅任务转递免搬工作树）；存量（阈值日前）豁免。
**v2.12.4 起不止验节名、还验内容**：该节内须有**一行**可复制交付行（新式「请收 <写回执仓> 回执：…」或旧式「登记回执：…」二选一）——只放空节或只写说明文字均判不合规（空壳节曾让「有节无行」的回执照过）。标题允许带后缀（如「## 转递提示词（必含 · 供用户原样复制）」）。

**回复收尾成固定末块（v2.11.1 · 2026-10-13）**：凡产出转递提示词，Agent 的**对话回复最末块固定为** `## 转递提示词`，其下**仅一行**（= `handoff prompt <ID>` 的输出，或回执那一行），**其后不再有任何正文或结束语**——把「滚到底」与「搜索 `## 转递提示词`」两种找法都变成确定动作（用户不再翻正文找）。**分两类**：①**出站任务转递提示词**（= `handoff prompt <ID>` 输出）仅跨仓 / 仓内 `workspace=separate` 产出，`workspace=same` 免（共享工作树，不搬）；②**回执交付行**（= `请收 <本仓> 回执：<路径>（…）`）**仓内 `workspace=same` 也要写**（仅 `COREML-*` 免；v2.12.4 解耦）。此属**回复排版纪律**，`check` 无法校验（回复不入库），靠接入桩 / `AGENT-GUIDE.md` 纪律落地。

> **铁律（2026-09-10 事故换来的）**：凡是要求 agent 产出某段固定文本，**必须把该文本放进「可直接复制」的骨架里**，只写在散文说明中等于没有。此前该要求只写在 `RESPONSE-TEMPLATE.md` 骨架之外的散文里，导致 43 份回执中 31 份照抄骨架者 **100% 漏写**。骨架已内置该节，勿删。

### 对外话术：通俗与简洁（v2.24.0 · 拒绝机械填空与浮夸修辞）

> 动因（2026-11-11 用户反馈）：旧版提出「收尾三要素」后，Agent 容易走向另一个极端——把自检思考清单当成输出模板，直接打出「对方是谁 / 对方要做什么 / 我这边是否还有待办」三级标题机械填空，并夹杂「100% 圆满完成」「经受极端并发与变异考验」等浮夸公文修辞，信息严重倒错冗余且阅读体验差。

**术语分层（先分清哪层能改）**

| 层 | 内容 | 规则 |
|---|---|---|
| 机器层 | `## 转递提示词` 节名、`forward` / `deliver` 子命令、五态状态机、`check` 锚节 | **不变**。它们是校验锚点，改名会击穿存量回执与门禁 |
| 面向人层 | Agent 对人类的进度说明、收尾话术、状态解释 | **必须通俗且简洁**。禁止内部术语直出，禁止公文套话 |

**对外汇报核心纪律（两行自然人话 · ≤3 句话）**：
向人类交代进度或收尾时，**严禁将「对方是谁 / 对方要做什么 / 我这边是否还有待办」原样作为小标题机械填空**。必须采用平实、自然的语言，扁平化归纳为两点：

1. **我方状态**：讲清完成项与单号，并明确我方**是否还有待办**（已就绪/待命/无待办）。
2. **后续接手**：讲清接盘**角色**与动作，并明确告知**人类是否需要干预**（如「系统会自动流转，你无需手动转告」）。

**禁用清单**：
- **纯机制缩写**：「无需转递」·「已闭环」·「等探针唤醒」·「状态 delivered」（禁止单独作为结论输出，必须讲清责任主体）。
- **机械填空题头**：「对方是谁：... 对方要做什么：... 我这边是否还有待办：...」（严禁直接输出作为标题或加粗字段）。
- **浮夸邀功修辞**：「100% 圆满完成」·「出具最终详证报告」·「经受住极端并发与变异考验」等宣传辞藻（只讲客观事实、文件路径与实测结果）。

**正例（简洁清晰 · 一读即懂）**
> **协同状态与收尾**：
> 1. **我方状态**：Tappy 仓审计已验收归档（`audit-20261110-11-task`），所有测试跑通，**我方无剩余待办**。
> 2. **后续接手**：全局防线升级工单已转交 **Lab Agent**，由其在独立终端接单推进，系统会自动流转，**你无需手动操作**。

**反例 1（机械填空 + 浮夸公文套话 · 典型负面）**
> 三、当前协同状态与收尾汇报（通俗三要素）
> 对方是谁：WorkBuddy：发布终审任务已 100% 圆满完成，出具最终详证报告；Lab Agent：工单已安全落盘挂号...
> 对方要做什么：WorkBuddy 侧无需后续动作；Lab 侧后续有时间可在独立终端推进...
> 我这边是否还有待办：Tappy 仓已全部闭环；代码库目前处于主干清晰、标签确凿、经受过极端并发与变异考验的高可用状态！
>
> （问题：把思考维度直接打成标题机械填空；前后两部分信息来回倒错重复；充斥浮夸公文套话，完全丢失了简洁人话的核心初衷。）

**反例 2（内部机制黑话 · 让人摸不着头脑）**
> 交付已完成，引擎已自动唤醒 impl 发起方。剩余动作在 impl 侧：验收 → close。audit 侧无待办。
>
> （问题：`impl` / `close` / `唤醒` 是内部词；且「audit 侧无待办」与「impl 侧验收」并列，读者容易以为剩余工作与己无关却不知找谁。）

**自检口诀**：人读完这段，能在 3 秒内清楚「你停没停、谁接手、要不要我插手」吗？不能或全是套话就是不合格。

**作用域**：仅约束面向人类的自然语言输出，**不新增 CLI 参数、不改任何校验逻辑**（对话不入库，`check` 无法校验，靠接入桩 / `AGENT-GUIDE.md` 纪律落地）。

## 操作（散文触发 · Path 定向）

**没有 / 命令。** 一切交接/回执操作通过 `handoff` CLI（引擎）完成：你在对话里用**自然语言**说要做什么，并把**单份文档路径**交给对应 Agent；Agent 加载 `handoff` 技能，按 Path + 意图路由到 `handoff <op>`（PATH shim → 中央引擎；兜底 `node handoff.mjs <op>`，shim 缺失时 `handoff link` 自愈）。

| 你说 | Agent 跑 | 谁 |
|------|----------|----|
| 「请 <方> 收交接 / 处理交接 `handoffs/<ID>.md`」 | `handoff status --for <target>` 确认状态（draft/forwarded 均可开工）→ Read 该交接 → 执行 → 写 `receipts/<ID>-resp.md` | 接收方（请收交接=新式 v2.8.3；处理交接=旧式仍识别） |
| 「请收 <方> 回执 / 登记回执 `receipts/<ID>-resp.md`」 | 读回执 frontmatter 四要素 → `handoff receipt <ID> [-n "<回执正文>"] [--needs-change]` | 发送方 / iggle（请收=新式 v2.8.2；登记回执=旧式仍识别） |
| 「收回执」 | `handoff sync` + `handoff status` | iggle 中心侧 |
| 「看这个交接/回执讲什么」 | `handoff show <ID>`（frontmatter + 节标题 + 首行，不 dump 全文） | 任意 |
| 「建交接 <target> <type> <标题>」 | `handoff new <target> <type> "<标题>"` → 按骨架填正文 | 发送方 |
| 「闭环 <ID>」 | 审计通过后 `handoff accept <ID> -n "<验收结论>"`（close 为同义别名） | 发起方（执行方不 accept/reject） |
| 「看未闭环」 | `handoff status` | 发起方 |

> **P2 Path 定向**：每次交互带单份文档 Path，LLM 只读那一份，**绝不扫描 `handoffs/`**。交接与回执的发现入口永远是 `handoff status --for <target>`（实时扫 frontmatter），不是目录遍历。

### op 参考（脚本子命令 · 能力全集，只是不靠 / 触发）

| op | 作用 |
|----|------|
| `handoff init [--root <dir>] [--lanes a,b] [--types t1,t2] [--project <name>]` | 在项目根初始化仓内子 Hub（`.handoffs/` + `.handoff-hub.json`） |
| `handoff import --from <dir>` | 扫旧 handoffs 目录生成只读 `STATUS.md` 快照（默认 draft-only；仅仓内模式） |
| `handoff new <target> <type> <标题...>` | 新建交接（自动生成 `<ID>` + frontmatter + 骨架；仓内模式自动改认 lane） |
| `handoff status [--for <target>] [--json\|--json=v2]` | 未闭环摘要；`--for <target>` 是依赖方待办入口（执行方冷启动用它直取本方待办），`--json=v2` 输出 target 感知的 pending + counts；仓内 `draft`/`forwarded` 显示「待执行」（v2.12.5），跨仓标签不变 |
| `handoff show <ID>` | triage 视图：frontmatter + 节标题 + 首行（不 dump 全文；支持 `handoffs/<ID>.md` 与 `receipts/<ID>-resp.md`） |
| `handoff accept <ID> -n "<验收结论>"` | 审计闭环：收回执=审计，**前置内容门禁**（该回执须过锚节 + 转递提示词 + evidence，否则拒闭环），通过即 `closed`（close 为同义别名；须附结论写入「验收记录」节） |
| `handoff reject <ID> -n "<驳回理由>"` | 审计驳回：`received → forwarded` 退回执行方继续改 |
| `handoff receipt <ID> [-n "<回执正文>"] [--deliver] [--needs-change] [--evidence-paths "a,b"] [--evidence-commits "<sha>"] [--evidence-repo key] [--evidence-note "..."]` | 登记回执并翻 `received`（可选 `--deliver` 一步直达终态交付；`-n` 以该文本为回执正文落盘；落盘前过内容门禁：锚节 + 转递提示词 + evidence） |
| `handoff deliver <ID> [-n "<交付补充说明>"]` | 执行方终态交付并翻 `delivered`（烙印 `delivered_at`；唤醒发起方后台 `wait` 探针进行独立实测与闭环） |
| `handoff forward <ID>` | 标记已转递（**可选的事后标记**：跨仓留痕用；仓内 `workspace=same` 无转递事件可跳过——执行方照旧按待办动工） |
| `handoff open <ID>` | 在编辑器打开交接文件 |
| `handoff prompt <ID>` | 生成转递提示词（跨仓 v2.8.3 一行式：`请 <TARGET> 收交接 [<ID>]：<交接路径>`；**仓内 v2.13/v2.23 用自然角色 + 显式 ID**：`请【<目标角色>】接单 [<ID>]：<交接路径>（<主题>）`，`to_lane=audit` 时附审计动作契约；回执交付亦带 `[<ID>]`，防止同会话多工单混淆） |
| `handoff check` | 全库合规体检（exit 0 = 合规；任何 agent 任务收尾的硬门禁） |
| `handoff install [--global\|--project] [--no-readme]` | 只装 **prose 接入桩**进各工具指令文件（幂等；不再写 / 别名；`--no-readme` 不写 cwd README） |
| `handoff link [--remove]` | 把中央引擎以 `handoff` 之名接入 PATH（幂等；报 `command not found: handoff` 时跑它自愈） |
| `handoff brief [target]` | 生成收件箱快照 `inbox/<target>.md`（供人类 / 不支持 CLI 的工具；非权威、可能过期）+ 固定转递话术；收 `draft` + `forwarded` 全部待办（v2.12.5，原仅 `draft` 会漏 forward 后与驳回退回项） |
| `handoff sync` | 扫 `receipts/` 自动登记回执（draft/forwarded → received，含 needs_iggle_change） |
| `handoff drift --common \| --platform <p>` | **ZSpec ④ 版本失效回流**：共享版本变更（`--common`）→ 全员未闭环交接标 `needs_iggle_change`；某平台专属版本变更 → 仅该平台下游标 |

本地直接跑：`handoff <子命令>`（PATH shim → 中央引擎；若缺失跑 `handoff link` 自愈）。

> **「先查状态」门禁（契约 v2.10）**：`handoff status` 跑过即落时间戳（存系统临时目录，按 hub 根哈希分文件）；`receipt` / `accept` / `reject` 动手前校验窗口内（默认 60 分钟）跑过 status，否则拒绝——「先查状态再动手」从提示词纪律变成机器门禁。豁免 `HANDOFF_STATUS_GATE=off`；调窗口 `HANDOFF_STATUS_WINDOW_MIN=<分钟>`。
> **回执正文（契约 v2.10）**：回执规范唯一源 = `RESPONSE-TEMPLATE.md`（CLI/桩不再内嵌竞争骨架）；`receipt -n "<回执正文>"` 即以其为正文落盘；缺文件时 CLI 只落**指针桩**（锚节 `修复状态`/`结论`）；`check` 对契约生效日（2026-10-13）起的回执**硬校验**「非空正文 + 含 `##` 节 + 状态/结论锚节 + **「## 转递提示词」节**（v2.11）」，缺失即 exit≠0（存量豁免；仅同工作区 `COREML-*` 免转递豁免，仓内 `workspace=same` 回执仍须含该节——回执交付不豁免）。

### 斜杠命令（**已废弃** · 2026-09-10）

旧 `/handoff` `/inbox` `/outbox` `/receipt` `/sync` 别名已废除：`handoff install` 不再安装它们（脚本不再写 / 命令触发文件），历史已装触发文件已删除。**不建议新用**——一律改散文触发（上方表）。所有能力已收敛到 `handoff` 技能 + 如上 op 表；`handoff` 命令本体（PATH shim）由 `handoff link` 管理。

## 人类用法（Path 定向 · 单一模版源）
1. 写交接：`handoff new <target> <type> <标题>`（自动按命名规范生成 `<ID>.md` + frontmatter，`status: draft`）；或手动在 `handoffs/` 新建符合命名规范的文件。
2. 转递（**人是唯一通道，但只需一句话**）：跑 `handoff brief` 生成各依赖方收件箱 `inbox/<target>.md`（轻量快照）拿转递话术，或 `handoff prompt <ID>` 出单份一行式——把提示词行发给对应 Agent（对方按「处理交接」路由执行）；发完跑 `handoff forward <ID>`。回执回来后 iggle 侧开工先跑 `handoff sync` 自动登记。
> **转递提示词写法（用户侧）**：人需手写转递上下文（如把提示词贴给下一 Agent）时，**只写专有信息**（`<TARGET> + 交接路径`），不复述泛化请求。单条交接优先用 `handoff prompt <ID>` 直接生成完整转递词（一行式：`请 <TARGET> 收交接：<路径>`），连手贴都省。COREML 同工作区侧不转递，不适用本条。
3. 收到回执：`handoff receipt <ID> [-n "<回执正文>"] [--needs-change]`；或手动把回执放 `receipts/<ID>-resp.md` 并更新原交接 `status: received` + `needs_iggle_change`。
4. iggle 侧动作完成后 `handoff accept <ID> -n "<验收结论>"` 闭环（审计通过；不过则 `handoff reject <ID> -n "<驳回理由>"` 退回）：**验收责任在 iggle 侧（消费回执的一方）**——核实依赖方源码真已改动 → 本仓适配落地 → 验证通过，结论随 `-n` 写入交接文档「验收记录」节；无验收结论 CLI 拒绝闭环。
5. 随时问我「还有哪些没闭环」→ 跑 `handoff status` 看摘要；或给我单份交接/回执路径，我用 `handoff show <ID>` 先给摘要（frontmatter + 节标题 + 首行）再决定怎么处理。

## 机器可读输出（JSON）

`handoff status` 与 `handoff status --for <target>` 都支持 `--json`，分两档：

- **v1（默认 `--json`，schema 不变）**：
  - 裸 `status --json` → `{ root, total, open, warnings, rows }`：**自动化轮询消费此格式，禁止更改字段**。
  - `status --for <target> --json` → `{ root, for, total, open, warnings, rows }`（`rows` = 该 target 未闭环交接；legacy 视图，保留兼容）。
- **v2（`--json=v2`，仅 `--for` 时有效，新增）**：
  ```json
  {
    "target": "swoop",
    "pending": [
      { "handoff_id": "SWOOP-20260904-02-feature", "status": "forwarded", "path": "handoffs/SWOOP-20260904-02-feature.md" }
    ],
    "counts": { "pending": 1, "received": 0, "closed": 12, "draft": 0 }
  }
  ```
  `pending` = `draft` + `forwarded`（v2.7 起不再按 target 区分，见 Agent Consumption Contract 节）；`counts.draft` 单独给出便于审计。

> **禁止替换 v1 JSON** —— 已有自动化契约依赖其字段；改为新增 v2 而非破坏 v1。

## 自动化运营用法
- 直接往 `handoffs/` 写带 frontmatter 的交接（文件名符合命名规范，无需经人）。
- 轮询 `receipts/` 看回执是否到位；读交接 frontmatter 的 `status` / `needs_iggle_change` 决定下一步。
- 调用 `handoff status --json` 取结构化状态（`total` / `open` / `rows` / `warnings`）—— 此为 iggle 中心视角 v1，字段禁止改。
- 依赖方 Agent 发现自己的任务请改用 `handoff status --for <target>`（或 `--json=v2`），不要扫描 `handoffs/`。

## 监听可验证性与宿主环境模型（v2.22.0 · D1–D4）

### 1. Agent 宿主环境感知与 `--daemon` 假成功根治（D1）
- **现象与动因**：在非 TTY 管道或 Agent 托管环境中（如 Google Antigravity、Claude Code、Cursor、Windsurf 等），`--daemon` 脱钩会导致长任务脱离宿主进程树管理，宿主误判任务结束；若前台执行可能打印“已启动”后随即被宿主 SIGTERM 强杀（假成功）。
- **根治机制**：Agent 宿主环境下，显式指定 `--daemon` 时探针直接向 `stderr` 打印告警并 `exit 3`，指引「以宿主后台任务（如 background task / run_command async）方式运行 `baton wait <id>`」；绝不打印「已启动」等误导性假成功文案。
- **脱钩后门**：若人类终端或特定环境确需在 Agent 环境变量下强制脱钩，可配置 `BATON_MANAGED_MODE=0` 显式允许脱钩；`BATON_MANAGED_MODE=1` 强制启用托管模式。

### 2. 监听注册表与状态可见性（D2）
- **注册表落盘**：`baton wait` 启动时立即向 `.handoffs/.watch/<id>.json` 写入监听事实（包含 `pid`、`started_at`、`timeout_ms`、`interval_ms`、`host_env`）。
- **生命周期安全清理**：探针正常唤醒退出、等待超时、捕获信号（`SIGINT`/`SIGTERM`/`SIGHUP`）或工单审计闭环（`baton accept`/`close`）时，自动清理注册表文件，杜绝孤儿文件。
- **状态可见性**：`baton status` 与 `baton status --for <lane>` 每行实时展示监听状态：
  - 存在存活探针：`[监听: pid 12345 (12m)]`
  - 无监听或进程已死：`[⚠️ 无监听]`（口径：注册表与实际进程存活双重核验，冲突时以进程存活为准）。

### 3. `received` 空转防死等告警（D3）
- **空转告警**：唤醒必须依靠执行方显式终态交付 `baton deliver <id>`；若工单在 `received` 状态停留超过 10 分钟且未 `deliver`，`status` 输出显式告警 `⚠️ [空转告警: received 超 10m 未 deliver]`，提示执行方尽快交付以唤醒发起方。
- **交付提醒**：执行方运行 `baton receipt` 登记回执（非 `--deliver`）时，输出明确提示「注意：还需 `baton deliver <ID>` 才会唤醒发起方」。

### 4. 接入桩版本一致性与体检（D4）
- **一致性诊断**：运行 `baton link --check`（或 `baton doctor`）自动比对当前工作区接入桩版本与中央引擎版本。一致时输出 `✅ [桩版本一致] 桩版本 == 引擎版本` 并 `exit 0`；存在版本漂移时报错并 `exit 1`。
- **自愈重生成**：运行 `baton link` 时若检测到当前工作区桩版本漂移，自动调用 `baton install --project` 刷新同步。

## 注意
- 依赖 agent 仍**不得修改 iggle 任何文件**；本目录是中性落点，不是 iggle 仓库。
- 旧 45 份历史交接仍在 iggle `docs/`（legacy，暂不处理），本枢纽只管往后新的交接（新命名规范从今日起生效，legacy 旧格式 `SWOOP-260811-06` 不强制）。
- 台账不常驻成文件：每次由 `handoff-status.mjs` 扫目录临时生成，目录里只有 `handoffs/` 与 `receipts/`。

<!-- handoff-stub:v2.1 begin -->
<!-- generated — do not edit -->
<!-- stub:sha256:e39e8e0c -->
### Agent Baton (Handoff) 接入桩（强制守卫 · 细则以 $(lab path handoffs)/README.md 契约 v2.24.0 为准）

**早拦 Preflight（强制）**
- **命令形态**：一律 `baton <op>` 或 `handoff <op>`（PATH shim → 中央引擎；幂等自愈 `baton link`）。若报 command not found：运行 `baton link`（或 `handoff link`）自愈（或通过 lab-agent-toolkit 重新 `npm link`）。
- 调用 `show/receipt/deliver/accept/reject/check` 前，**必须先跑** `baton status`（或 `handoff status`，执行方冷启动用 `baton status --for <本方 lane|target>` 直取本方待办）且其输出在上下文中。
- **状态语义（v2.20.0 · 五态生命周期）**：「进行中」= 未闭环（`status ≠ closed`）且归属当前方。**待办 = `draft` + `forwarded`**——落我归属即该我动工；`received` = 回执草稿已登记（待执行方交付）；`delivered` = 执行方已完成终态交付（等待发起方验收）；`closed` = 审计闭环完成。
- **终态交付与平息机制（v2.20.0 · 防抢跑竞态与会话平息）**：回执文件落盘不等于会话结束。执行方必须通过 `baton deliver <ID>`（或 `baton receipt <ID> --deliver`）显式标记终态交付；探针检测到交付信号后启动平息缓冲（Settle Window），等待执行方会话彻底收尾退出后方 Exit 0 唤醒发起方。未 deliver 之前发起方 wait 探针不唤醒、accept 硬拒闭环。发起方严禁在收到显式交付信号前提前修改 Backlog 或规划文档。
- **物理工作树隔离（v2.21.0 · workspace: worktree）**：支持 `workspace: worktree`，自动在 `.worktrees/<id>` 下创建轻量沙箱并软链共享构建缓存（`node_modules`、`target`、`.venv`），主仓库零污染且构建零损耗。工单闭环时使用 `baton close <ID> --prune-worktree` 自动安全回收。
- **注意力节流管道（v2.21.0 · baton throttle）**：执行方在后台长任务运行时，推荐使用 `baton throttle <ID> -- <cmd>` 包装运行。三级中断过滤机制阻断日志刷屏对人类与主控上下文的注意力劫持（仅致命错误红灯突破，常规流直接静默落盘）。
- **无污染双盲重跑（v2.21.0 · clean-runner / baton-audit-runner）**：审计方验收时，推荐使用 `baton-audit-runner <ID>` 在干净上下文独立重跑验收判据命令，自动校验真实 Exit Code 并固化 `--evidence-commits` 与 `--evidence-paths`。
- **监听必须性与反借口（v2.23.0 · 严禁擅跳监听）**：无论执行方是同窗口子 Agent、外部客户端（Cursor/WorkBuddy/Antigravity 等）、独立终端还是人工，`baton` 是底层文件系统事件总线（`fs.watch`），外部任何终端执行 `baton deliver` 会直接写入工单，探针能瞬间感知并唤醒。**严禁以「执行方是外部客户端/等不到回执/会空耗超时」为由擅自跳过后台监听**；发起方转递后必须挂起 `baton forward <ID> --wait`（或由宿主作为后台任务挂起 `baton wait <ID>`）。
- 指定 ID 必须在「进行中」且归属当前方（仓内：`to_lane == 当前 lane`；跨仓：落在目标收件箱且未闭环）。找不到→停下并说明。
- 未指定 ID 却有多条归属当前方的待办（draft/forwarded）→ 列出清单请用户点名，不擅自选。
- receipt 前确保 status 快照 **< 60 分钟**（超时重跑；长任务收尾时 deliver 自动宽容续期）。
- 仓内优先读 frontmatter `workspace`（same/separate/worktree），禁用 mtime 推断。
- 执行方**只写 receipt / deliver**，**不做 accept/reject**。
- **严禁抢跑/虚假回执**：验收判据**全部实测通过**方可提交回执与交付。执行中途遇阻、环境/多实例冲突或需讨论的中间状态，**仅记录于 reviews/ 或对话说明，严禁提交包含「已通过」的抢跑回执**。
- 回执正文唯一源 = `$(lab path handoffs)/RESPONSE-TEMPLATE.md`：**照抄其「回执模板（可直接复制）」骨架**（含 evidence 字段），勿另起格式、勿凭记忆重建（骨架外 = 没有）。
- **evidence 硬门禁（v2.12.3）**：仓内新回执（2026-10-14 起）**必须**附可核验证据 `--evidence-paths "真实文件,..."` / `--evidence-commits "<sha>"`（无文件改动用 `--evidence-note "<原因>"`）；声称的路径须真实存在、提交须 `git cat-file -e` 可查，否则 receipt / deliver / accept / check 拒收。**只声明不改 = 伪回执**（2026-10-13 goods-stores 事故教训）。
- 收尾必须 `baton check`（或 `handoff check`）exit 0（2026-10-13 起回执须「非空正文 + 含 ## 节 + 含『状态 / 结论』锚节」；存量豁免）。
- **回复收尾（交接提示词规范）**：发起交接（出站）时，回复最末块**必须固定为交接提示词（由本地 AI 根据用户本地语言自适应呈现：中文使用 `## 交接提示词`，英文使用 `## Baton Pass Prompt`）**。标题、描述说明与具体的接单指令必须严格分离，提示词置于独立代码块（```text）中，方便人类一键复制发给接收方 Agent（其后无任何正文）。执行方交付（入站）后，因发起方已挂起后台探针自动唤醒，无需再写回执提示词。
- **对外话术（v2.24.0 · 简洁通俗 · 强制）**：跟用户交代进度与收尾时，让人只读该段即知「谁在做、我这边还动不动」——**禁止机械罗列三要素题头填空**，精简为两行自然人话：①**我方状态**（完成项 + 我方是否还有待办）；②**后续接手**（接手角色 + 后续动作 + 人类是否需介入，如「系统会自动通知，你不用转告」）。**严禁浮夸邀功修辞与「无需转递/已闭环」纯机制缩写**。机器锚点（`## 转递提示词` 节名、`forward`/`deliver` 子命令）不变，勿改名。
- **审计动作契约（v2.13 · to_lane=audit 强制）**：审计方（接收方 to_lane=audit）**严禁仅静态读码**——必须在终端**独立执行**交接文档「验收判据」中的**所有测试与校验命令**，以实测输出为唯一准绳，**严禁采信自报**（执行方回执里的「已通过」一律视为待验证声明，不采信）。其余 lane 亦建议独立实测，但审计 lane 为硬纪律。
- **仓内提示词用自然角色（v2.13）**：同仓提示词**严禁出现项目名 / lane slug 当角色**（如「请 Tappy 收交接」「请 impl lane 收交接」）。出站 = `请【<目标角色>】接单 [<ID>]：<交接路径>（<主题>）`。角色由 lane 映射（impl→实现方 / audit→审计方 / arch·design→架构设计方；`.handoff-hub.json` 的 `lane_labels` 可覆盖）。
- **防提前闭环与双盲审计防伪（v2.16.0）**：回执**必须由接收方 to_lane 独立撰写**——发起方（from_lane）禁止自填回执；`to_lane=audit` 派发时自动签发一次性 `Audit Nonce`，审计回执必须携带 `--audit-nonce "<nonce>"`，硬性拦截同一会话自签；支持 `baton forward --blind` 物理脱敏主观思维链与自辩借口。

**最小操作序列（出站 = 建/发交接 · 强制闭环）**
1. `baton new <target|lane> <type> "<标题>"`（或 `handoff new ...`）并填写正文
2. **转递并挂起后台监听（必须执行）**：
   执行 `baton forward <ID> --wait`（多工单并发聚合监听可执行 `baton wait <id1> [id2 ...] [--any|--all]`；AI 客户端宿主进程树托管；人类终端可用 `--daemon` 脱钩；需双盲脱敏加 `--blind`）
   ——无论同工作区还是跨工作区、内部还是外部客户端，必须启动监听探针（严禁以等不到为由跳过）；交付完成并平息后探针唤醒进行独立验收闭环。
3. **输出交接提示词（末块规范）**：本地 AI 根据用户本地语言自适应输出，标题、描述与独立代码块分离（其后无任何正文）：
   ## 交接提示词
   > 直接复制下方提示词，发送给接收方 Agent 接单：
   ```text
   请【<目标角色>】接单 [<ID>]：<交接路径>（<主题>）
   ```

**最小操作序列（入站 = 接单/回执/交付）**
1. `baton status --for <本方 lane|target>`（冷启动直取本方待办；全量 `baton status` 供发起方巡检）
2. 从「待办」（draft/forwarded）筛选归属当前方（仓内 `to_lane == 当前 lane`；跨仓 = 落在目标收件箱）→ 确认目标 ID
3. `baton show <ID>`
4. 按边界最小改动（仅该 lane 应改文件）
5. 实测全过方写回执：**照抄 `$(lab path handoffs)/RESPONSE-TEMPLATE.md` 骨架** → 运行 `baton receipt <ID> -n "<正文>" --evidence-paths "真实文件,..." --evidence-commits "<sha>"`（或原子复合命令 `baton receipt <ID> --deliver ...` 直达交付）。（若 `to_lane=audit` 须附 `--audit-nonce "<nonce>"`；仓内必附 evidence；无文件改动用 `--evidence-note`；中途受阻仅写 reviews/ 严禁提回执）
6. `baton check`（核验证据与锚节合规，exit 0）
7. **终态交付与会话收尾**：运行 `baton deliver <ID>`（烙印 delivered 并触发平息缓冲后自动唤醒发起方；会话彻底收工结束）。

详见 `$(lab path handoffs)/AGENT-GUIDE.md` 获取完整版 Preflight。
<!-- handoff-stub:v2.1 end -->
