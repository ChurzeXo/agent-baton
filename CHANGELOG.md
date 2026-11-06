# Handoff Hub 契约变更历史

> 记录交接契约（[`README.md`](README.md)）的版本演进与踩坑留痕。
> **当前契约与唯一真相源仍是 [`README.md`](README.md)**；行为规范只以 README 为准，本文件仅供追溯。
> 条目逐字保留原始变更记录（含被后续版本推翻的历史留痕），不做回改。

---

> **v2.16.3 变更（2026-11-06 · 金蝉脱壳后台守护 --daemon + 出单提示词全场景解禁 + 强闭环引导）**：动因——用户反馈外部 Agent 容易遗漏 `--wait` 专属后台标志导致终端挂起，或因误解下一步指引导致监听漏跑，且同仓模式下出站接单提示词曾被静默。**① 金蝉脱壳后台守护（`--daemon` / `-d`）**：`baton forward` 与 `baton wait` 正式支持 `--daemon`，利用 Node.js `spawn`（`detached: true`）+ `unref()` 自行将监听进程派入独立进程树脱钩，主命令在 <0.1 秒内安全退出，免除对外部平台工具必须声明 `run_in_background` 的严苛约束，日志落盘至 `.handoffs/logs/wait-<id>.log`；**② macOS 桌面通知**：守护进程在回执就绪唤醒退出前自动触发系统级桌面通知；**③ 全场景出站提示词解禁**：彻底移除 `cmdForward` 内部对 `same` 的输出抑制，无论仓内还是跨仓一律打印标准交接提示词；**④ `cmdNew` 强动作闭环指引**：明确指引发单后必须执行 `baton forward <id> --daemon`（或 `--wait`）。

> **v2.16.2 变更（2026-11-05 · 双语自适应 i18n 引擎 + 交接提示词格式规范化）**：动因——用户反馈开源项目需要国际化，审查代码中所有涉及中文的内容（包含交接提示词、骨架、CLI 提示等），按合理方式处理国际化；同时规范交接提示词文案，将标题/描述与具体的接单指令置于独立代码块中，方便人类一键复制。**① 双语自适应引擎（Dual-Language Locale Sensing）**：默认英语（`en`），自动侦测 `BATON_LANG`、`.handoff-hub.json` 的 `locale`/`lang`/中文角色名或系统中文环境自适应中文（`zh`）；**② 交接提示词（Baton Pass Prompt）格式规范**：统一出站标题为 `## 交接提示词` / `## Baton Pass Prompt`，标题与描述说明与具体提示词严格隔离，提示词置于独立的 \`\`\`text 代码块中；执行方回执入站因发起方已启动 `baton forward --wait` 后台探针自动唤醒，无需再产出回执交付行让用户人工搬运；**③ 接入桩双语双认（Bilingual Stubs & Verification）**：新增 `STUB_BODY_EN` 与 `STUB_BODY_ZH`，`checkStubCarrier` 同时校验中英文接入桩，`baton install` 支持 `--lang <en|zh>`；**④ 门禁规则双语包容**：`checkReceiptBody`、`extractConclusion`、`cmdAccept`、`cmdReject`、`checkReceiptPrompt` 全面支持中英双语锚节与关键词；**⑤ CLI 帮助与 Status 输出全面双语化**：`baton` CLI 帮助、`baton status` 摘要及下一步建议均实现中英双语自适应输出。

> **v2.16.1 变更（2026-11-05 · 健全转递提示词全场景双轨闭环 · 消除多会话流转断崖）**：动因——用户及外部使用者安装使用时反馈，同仓/同工作区场景下 Agent 丢失了末尾转递提示词输出，导致跨会话/多窗口手工协同严重受阻。排查确认为 v2.15.0 推行后台自动唤醒时的过度减负导致。**① 双轨兼备**：保留后台监听自动唤醒（`--wait`）的同时，全面恢复自然语言转递提示词输出；**② `cmdPrompt` & `cmdForward` 统一出单输出**：同仓（`same`）不再静默，一律标准打印 `请【<目标角色>】接单：<路径>（<标题>）`；**③ `printReceiptDeliveryLine` 统一回执输出**：仓内提交回执时，标准打印 `请【<发起角色>】查收【<本方角色>】回执：<路径>（<结论> · 是否需改动：<是/否>）`；**④ 回执规范单源对齐**：`RESPONSE-TEMPLATE.md` 恢复 `## 转递提示词` 骨架节；**⑤ 接入桩收尾规约**：`STUB_BODY` 统一规定无论出站还是入站，会话回复最末块均固定输出 `## 转递提示词`，确保人类一键复制与后台监听双轨闭环。

> **v2.16.0 变更（2026-11-05 · 开源产品化基础 · 纯配置驱动 + 双盲审计防伪门禁 + 拓扑可视化）**：动因——面向开源发布标准，根除硬编码业务名，强化 Agent 角色身份隔离与防自签作弊。**① 纯配置驱动（Zero-Hardcode）**：彻底解耦硬编码 target，新增 `units/handoffs/.handoff-hub.json` 作为事实源，`handoff.mjs` 与 `handoff-status.mjs` 动态加载，支持用户自定义 targets；**② 跨仓脚手架 `handoff init --cross`**：一键生成独立中枢 Hub 目录与骨架配置；**③ 双盲审计与防伪挑战令牌（Audit Nonce）**：`to_lane=audit` 派单自动签发高熵一次性 Nonce，`handoff receipt` 必须带 `--audit-nonce` 核验通过方可盖章，根除本地同一会话伪造 `HANDOFF_LANE` 自签回执漏洞；**④ 双盲脱敏（`--blind`）**：`handoff forward --blind` 自动物理净化大模型主观思维链（`<thinking>` 等）与辩护小节，仅向审计方传递客观契约与 Diff；**⑤ 拓扑可视化（`--mermaid`）**：`handoff status --mermaid` 一键生成任务在各仓/各 Lane 间的实时 Mermaid 关系流向图。

> **v2.15.1 变更（2026-11-04 · 性能与发热根治 · 能耗优化 · 事件驱动与自适应退避）**：动因——用户反馈长程后台监听导致笔记本卡顿与发热，排查发现 `handoff wait` 采用固定高频轮询且无条件执行全量文件读取与正则解析，严重打断 CPU 深度休眠 (C-states)。**① `fs.watch` 事件驱动**：接入 OS 内核级文件系统事件监听，回执生成或状态翻转时毫秒级唤醒，等待期间 0 CPU 开销；**② `mtime` 守卫**：对交接与回执文件增加轻量级修改时间守卫，未检测到变动时不执行 `readFileSync` 与正则计算，消除重复 I/O；**③ 自适应动态退避（Adaptive Backoff）**：定时器防丢事件保底采用自适应退避（2s → 4s → 8s → 15s），唤醒频次直降 80% 以上；**④ `handoff-status.mjs` 读盘去重**：缓存第一次扫描的 frontmatter 结果，彻底消灭规范性校验阶段的二次全量磁盘读取。

> **v2.15.0 变更（2026-11-04 · 仓内回执免转递减负 · 盲肠仪式退火 · 载体支持 GEMINI.md · 复合原子命令 forward --wait）**：动因——底层引入 `handoff wait` 状态机后台监听与响应式自动唤醒后，仓内回执再输出转递提示词已无实际意义。**① 仓内回执免写「## 转递提示词」**：`checkReceiptPrompt` 与落盘门禁全面豁免仓内同工作区回执对该节的检查，回执聚焦修复状态、结论与 evidence；**② 对话收尾免末块提示词限制**：仓内同工作区执行方提交回执后，无需在对话末尾追加转递块，直接结束回合；**③ 复合原子命令 `forward --wait`**：一条命令完成标记转递、输出提示词与切入后台监听，彻底杜绝发单后漏跑监听；**④ GEMINI.md 列为一等载体**：`checkStubCarrier` 与 `cmdInstall` 自动识别并刷新项目中的 `GEMINI.md`。动 `STUB_BODY` ⇒ 各载体须重跑 `handoff install`。

> **v2.14.0 变更（2026-11-04 · 新增 `handoff wait` 后台监听 · 跨仓与同仓多窗口异步协同）**：动因——多 Agent / 多窗口工作流中，交接发起方停滞等待回执依赖人工在窗口间复制提示词，割裂感强且缺乏事件驱动机制。**① `handoff wait <id> [--timeout <dur>] [--interval <dur>]`**：专职后台监听子命令，配合 Agent `run_in_background` / 异步执行机制挂起，0 Token 待机。**② 状态与原子性判定**：轮询交接单与回执单状态流转，回执合规落地且状态翻为 `received`/`closed` 后自动打印结构化回执摘要并 **Exit 0 退出**，借由宿主系统的 Reactive Wakeup 机制自动唤醒发起方/审计方。**③ 防死锁超时保护**：内置可配置 TTL（默认 30m，支持 10m/1h/30s 等），超时安全退出（Exit 124）并提示人工排查。**④ 防偷工减料硬门禁注入**：唤醒输出中强化注入审计纪律（**严禁仅静态读码或自报采信**，必须在终端独立运行验收命令后闭环）。**⑤ 同仓多窗口与跨仓全覆盖**：仓内自动读取 Lane 身份与自然角色，跨仓自动识别回执落地。动 `STUB_BODY` ⇒ 各载体须重跑 `handoff install`。

> **v2.13.0 变更（2026-10-26 · 仓内角色映射 + 同仓提示词重构 + 防提前闭环 + 审计动作契约）**：动因——Tappy 仓内交接 `audit-20261026-01-task` 暴露三类缺陷：①提示词把项目名 / lane slug 当沟通角色；②发起方自填审计回执并提前闭环；③审计 Agent 仅静态读码即宣称通过。**① 仓内角色映射（Lane Identifier → Engineer Role）**：`handoff.mjs` 新增默认映射 `impl→实现方` / `audit→审计方` / `arch·design→架构设计方`，`.handoff-hub.json` 的 `lane_labels` 可显式覆盖、缺省回退默认。**② 同仓提示词重构**：严禁项目名；出站 `请【<目标角色>】接单：<路径>（<主题>）`、入站 `请【<发起角色>】查收【<本方角色>】回执：<路径>（<结论> · 是否需改动：<是/否>）`；`printReceiptDeliveryLine` 仓内模式弃用 `detectRepo`、改读回执 frontmatter `from_lane`/`to_lane` 拼角色。**③ 防提前闭环（Anti-Self-Closing）**：`receipt` 据 `HANDOFF_LANE` 硬拒发起方自填 / 越界写回执，落 `author_lane`，`accept`/`check` 双侧核验回执确由接收方撰写。**④ 审计动作契约**：`to_lane=audit` 时在接入桩 + `handoff prompt` 输出 + 交接文档「给执行方」节强制注入「审计方严禁仅静态读码，独立执行验收判据中所有测试与校验命令，以实测输出为准绳，严禁采信自报」。动 `STUB_BODY` ⇒ 各载体须重跑 `handoff install`。

> v2.3 变更：回执必附「部署提示（含钉值协同）+ 转递话术」——细则见 `RESPONSE-TEMPLATE.md`；钉值更新判据（消费方何时必须改 `REQUIRED_SWEEP_COMMIT`）见 Swoop `AGENTS.md §8`「版本钉死协同」。
> **v2.4 变更**：
> 1. 新增 **§同工作区侧（COREML）** —— `crates/iggle-coreml` 与 iggle 同一工作区，转递规则与真跨仓不同（见该节）。背景说明见 `COREML-CONVENTION.md`（**说明文档，非契约**）。
> 2. 新增 **§体积预算（Token 纪律）** —— 交接 ≤60 行 / 回执 ≤50 行；论证归 `reviews/`，交接只放规格 + 判据 + 外链。骨架已同步精简（v2.3 起的旧骨架会把长篇论证吸进正文，实测长到 240 行 / 14KB）。
> 3. `handoff.mjs` 的 `todayISO()` 改为**当地日期**（原用 UTC，UTC+8 的 00:00–08:00 操作被记成前一天）。
> 4. `handoff check` 增加**体积提示**（非阻断，只报 2026-08-31 起的文档）。
>
> **v2.5 变更（2026-09-02）**：
> 1. 新增 **转递提示词写法（用户侧）** —— 人需手写转递上下文（如把提示词贴 `/命令` 后转给下一 Agent）时，**只写 /命令输出里没有的专有信息**（`<ID> + 本次重点 + 回执方式`），**不复述「请收交接」等 /命令固定话术已涵盖的通用请求**（如 `handoff brief` 已输出「处理你的收件箱：<path>」，无需重复）；单条交接优先用 `handoff prompt <ID>` 直接生成完整转递词。COREML 同工作区侧不转递，不适用本条（见 §同工作区侧）。
>
> **v2.6 变更（2026-09-04 · 契约收敛，不引入新工作流）**：
> 1. **`draft` 是依赖方角色语义，不是全局语义**：`swoop`/`prospero`/`iggle` 仅 `forwarded` 入 pending；`coreml`（同工作区）`draft`+`forwarded` 都入 pending。扁平排除 draft 会回退 COREML 工作流。
> 2. **Agent Consumption Contract**：Agent **MUST NOT** 扫描 `handoffs/` 自行发现任务；必须先 `handoff status --for <target>` 得到候选 ID+path，再读指定交接正文。
> 3. **JSON 双层**：默认 `--json`（v1，schema 不变，自动化轮询消费）保持兼容；新增 `handoff status --for <target> --json=v2` 输出 target 感知的 `pending` + `counts`。**禁止替换 v1**。
> 4. **状态转换合法性内联**到 `forward`/`receipt`/`close` 命令自身；`handoff check` 只做快照一致性（不推断历史，因 frontmatter 无历史）。
> 5. **Source of Truth** 钉死：`frontmatter.status` 是生命周期唯一真相；`inbox/<target>.md` 是可选轻量快照，非权威、可能过期。
> 6. **`brief` 转递话术收敛**：`handoff brief` 输出的固定转递话术不再指向 `inbox/<target>.md`（快照非权威），改为指向 `handoff status --for <target>` 实时待办；v2.5 变更记录中的旧话术示例随本次失效。
>
> **v2.7 变更（2026-09-09 · 修 draft 语义错位 + 命令面语义化）**：
> 1. **`draft` 对依赖方一律 = 待处理**（撤销 v2.6 第 1 条的按 target 区分）。`isPendingFor()` 改为：`draft` + `forwarded` 都入 pending；`received` 不算；`closed` 不列出。
>    **理由（2026-09-04 真实事故）**：用户常把交接文档直接递给依赖方而不跑 `forward`，导致 `draft` 项对依赖方完全不可见，`SWOOP-20260904-02` 因此被误判「不属于本轮范围」而漏处理。`forward` 只是发送方可选的事后标记，**不是「已送达」的可靠信号**。
>    **「该不该开工」的判据只有两条**：① target 是否 = 当前工作区；② 交接是否落到我手上（用户直接给了文档，或它出现在 `status --for <target>` 输出里）。**严禁用 draft / forwarded 判断**。
> 2. **命令面语义化**：斜杠命令改为意图型（命令只带意图，target / type / 标题从对话取，不拼长命令行），按**动作**而非仓库拆分：
>    `/outbox` 发（建交接 + 转出，iggle 侧）· `/inbox` 收（任何接收方，实时 `status --for`）· `/receipt` 回（执行方写回执）· `/sync` 收回执（iggle 侧）· `/handoff` 兜底（close / open / check / install / prompt + 规则载体）。
>    **不按仓库拆命令名**（如 `/inbox-swoop`）——命令是全局安装、跨工作区共享的，身份由工作区决定；按仓库拆会引入「命令名 vs 工作区」两个信息源打架。
> 3. **`/inbox` 收敛为纯「收」**：移除原先 iggle 侧「跑 brief 转出」分支（归 `/outbox`）与「都不是 → 提示用户」分支。iggle 作为 `IGGLE-*` 的接收方同样用 `/inbox`（`status --for iggle`）。
> 4. **删除文档中不存在的 `--all` 标志**（Swoop / Prospero `AGENTS.md` 曾引用 `status --for <target> --all`，脚本从未实现）。
> 5. **结尾提示词必须带 `/inbox` / `/sync`（v2.7 补充 · 2026-09-09）**：此条已被下方「v2.8 修订（2026-09-10 · 移除 / 命令）」第 42 行起整体推翻——v2.8 起移除全部 / 别名，转递/回执提示词改散文触发（如 `处理交接：<路径>`、`登记回执：<路径>`），细则以 `RESPONSE-TEMPLATE.md`「交付与闭环」现行版为准。COREML 同工作区侧免转递。
>
> **v2.8 变更（2026-09-09 · 转递提示词极简指针化）**：
> 1. `handoff prompt <ID>` 生成的转递提示词从 ~24 行砍到 3 行：交接路径（含 target）+ `RESPONSE-TEMPLATE.md` 指针 + 回执落点。处理步骤 / 禁止项 / 结尾话术不再内联模板，**单一来源 = `RESPONSE-TEMPLATE.md`**（其「处理步骤」节即原模板 4 步，并修掉对 v2.4 前旧节名「最小复现」「UI 展示耦合」的漂移引用）。
> 2. 动因：CLI 模板与 `RESPONSE-TEMPLATE.md` 内联提示词双份维护，同一段「四节」指引两处一起漂移；单一来源化根治，与体积纪律（交接≤60 行 / 回执≤50 行）同理适用于提示词本体。
> 3. 断链修正：v2.7 第 5 条所引「文末『结尾提示词格式』节」实不存在，结尾话术细则真正落点是 `RESPONSE-TEMPLATE.md`「交付与闭环」（本条已同步改指）。
> 4. `handoff prompt` 输出尾部新增「发送方注」（COREML 免转递 / 无需转递时明说），该行**不复制给依赖方**。
> 5. **一行命令版（v2.8 修订 · 同日用户再简化，但当日即被「移除 / 命令」推翻）**：本条描述的「`/inbox 交接：...` / `/sync 回执已写：...` 命令开头」形态，已被同次 v2.8 修订第 45 条「转递提示词散文化、不再以命令开头」推翻，最终以散文触发（如 `处理交接：<路径>`、`登记回执：<路径>`）为准。本条仅作历史留痕，不可作为当前规范。
>
> **v2.8 修订（2026-09-10 · 移除 / 命令，改散文触发 + Path 定向 + 单一模版源；P1–P4 设计见 PROPOSAL-2026-09-10-handoff-triage.md）**：
> 1. **新增 `handoff show <ID>`**：triage 视图 = frontmatter + 各节标题 + 首行，**不 dump 全文**；支持 `handoffs/<ID>.md` 与 `receipts/<ID>-resp.md`（按 `<ID>-resp` 判定）。
> 2. **移除全部 / 命令别名**（`/handoff` `/inbox` `/outbox` `/receipt` `/sync`）：`handoff.mjs` 不再写任何 command shim，已装触发文件作废删除；所有交互经自然语言「处理交接 <路径>」「登记回执 <路径>」「收回执」等触发，LLM 加载 `handoff` 技能按 Path + 意图路由 op。
> 3. **转递提示词散文化**：`handoff prompt <ID>` 输出不再以命令开头，改 3 行散文（交接路径 + `RESPONSE-TEMPLATE.md` 指针 + 回执落点）；`handoff brief` 转递话术同理。
> 4. **`handoff install` 只装 prose 接入桩**（不再写 / 别名）；`swoop-handoff-compliance` 降级为内部参考，不再作为命令注册。
> 5. **契约版本号维持 v2.8**：升版本会在无法触碰的 iggle / Swoop / Prospero 接入桩（指针「以 v2.8 为准」）中制造版本不一致，留待下次契约变更时一并升。

> **v2.8.3 变更（2026-09-10 · 交接提示词改「请收交接」一行式）**：
> 1. 动因：v2.8 散文版四行提示词有三处瑕疵——①「把以上三行交给 X」是发送方操作指导泄漏进接收方载荷（自指困惑）；② 头部指导语「附交接文档路径一起发」诱发路径双贴；③ 交接骨架「给执行方」节与技能路由已含回执规范/落点，提示词三行实为三重冗余。
> 2. 新格式：`请 <TARGET> 收交接：~/Documents/lab/handoffs/handoffs/<ID>.md`——一行自含接收方名 + 动作 + 路径；点名列强于旧「（target: X）」括注（错投时接收方第一眼即见「不是给我的」，对 reverse 交接同样成立）。回执规范/落点不在行内，单一来源 = 交接骨架「给执行方」节 + `RESPONSE-TEMPLATE.md`。
> 3. 兼容：旧式「处理交接 <路径>」仍为合法触发（技能路由双认），各仓记忆旧例句不致错，待下次实质交接顺带刷新；回执方向 v2.8.2「请收 <方> 回执」不变。
> 4. 同步面：`handoff.mjs` PROMPT_TEMPLATE + cmdPrompt 头部/发送方注；SKILL.md 与本 README 路由表；COMMANDS.md `/inbox` 映射；用户级 + iggle 工作区记忆例句。

> **v2.8.2 变更（2026-09-10 · 回执提示词改「请收」一行式）**：
> 1. 动因：用户反馈收尾消息路径重复两遍（摘要行 + 提示词行各自带一次路径），且提示词不含写方名、收方要靠路径前缀反推。
> 2. 新格式：`请收 <写回执仓> 回执：<回执路径>（<行数/字节> · <是否需 iggle 改动> · <特殊说明，可选>）`——一行自含收方关键信息，路径只出现一次；`RESPONSE-TEMPLATE.md` 骨架与「交付与闭环」、`handoff` 技能路由表/结尾话术同步更新。
> 3. 兼容：旧式「登记回执：<路径>」仍为合法触发（技能路由与 `handoff check` 正则均双认），存量回执与各仓记忆例句不回改；Swoop / prospero 记忆里的旧例句待下次实质交接时顺带刷新。

> **v2.8.3 补记 · 2026-10-11（tooling · 契约版本号不升）**：
> 1. `handoff install` 对「含 `handoffs/README.md` 但无 `handoff-stub` 标记」的**手写指针**不再**静默跳过**，改为**告警**并指向 `README.md`「接入桩」段的对齐方法。
> 2. 动因：Swoop / Prospero 的「跨仓库交接」段是手写（无标记），每次契约升版被 `install` 跳过、只能人工手改版本号，语义已落后——其段仍写「验收闭环 `close -n`」，而现行契约是 `accept` / `reject` 审计闭环。静默跳过让这类漂移不可见。
> 3. 契约版本号不升：桩文本（`STUB_BLOCK`，含「契约 v2.8.3」）未变，不制造各仓接入桩的版本不一致（同 v2.8 修订「维持版本号」先例）。

> **v2.9 变更（2026-10-13 · 仓内模式升一等 + 执行方工作单唯一性 + 接入桩 v2.1 模式感知）**：
> 1. **「仓内模式（intra-repo）」升为一等契约模式**：引擎（`handoff.mjs` 的 `init/new/status/check/import/accept/reject` + 根解析）早在 2026-10-10 落地，但 README 一直无该节——本次补「仓内模式」节，把散落在 `PROPOSAL-2026-10-09-intra-repo-mode.md` / `playbook/docs/10-handoff.md` 的规则收归唯一真相源。层级：**同工作区 ⊂ 仓内 ⊂ 跨仓**；路由键 `lane`；ID `<TO_LANE>-<YYYYMMDD>-<NN>-<TYPE>`；`workspace=same|separate` 定性转递。
> 2. **新增「执行方工作单唯一性」条款**（README「Agent Consumption Contract」）：落我手中的那条 handoff 即唯一工作单，**禁止**为已交接的工作另建交接，`evidence/` 等散落参考文档**不是工作单**。
> 3. **接入桩升 v2.1（模式感知）**：`STUB_BLOCK` 从「跨仓库交接」单模式桩改为「先判模式（`.handoffs/.handoff-hub.json`）→ 仓内/跨仓分路」。**`handoff-stub:v2.0` marker 保持不变**（改 marker 会破坏对存量桩的幂等替换——2026-09-05 审计结论）。
> 4. **跨仓行为零变更**：`--json` v1 schema 逐字不动；本版是**新增模式 + 补条款**，非替换。各仓需重跑 `handoff install` 刷桩（旧桩「跨仓库交接」段为手写指针者，`install` 只告警不刷——见 v2.8.3 补记）。
> 5. 动因与验收判据见 `PROBLEM-2026-10-12-handoff-executor-role.md`。
> 6. 补记（同日）：README「Agent 接入桩」展示块初稿与机读 `STUB_BLOCK` 常量**措辞漂移**（行 2/3/4 与子项结构不同），已对齐为**逐字一致**。发现方 = Prospero 回执（`PROSPERO-20261013-01-feature`），hub 侧修。

> **v2.10 变更（2026-10-13 · 回执去骨架化 + 三部机器门禁）**：
> 1. **回执规范单一来源收口**：声明「回执规范唯一源 = `RESPONSE-TEMPLATE.md`」（DESIGN.md:27/43）却与 CLI 内嵌的 `R_BODY` 竞争骨架节名不一致（`状态` vs `修复状态`、`改动` vs `实际改动`），同一份「回执长什么样」两处维护 → 必然漂移（同 v2.8「提示词双份维护」病根）。**删除 CLI 内嵌 `R_BODY` / 仓内骨架**；`receipt` 仅在回执文件缺失时落**指针桩**（引 `RESPONSE-TEMPLATE.md`，只留机器锚节 `修复状态` / `结论`）。`R_BODY` 旧节还硬编「需 iggle 改动」，非 iggle 发起方串味，一并消除。
> 2. **`receipt -n "<回执正文>"` 落盘**：旧实现 `cmdReceipt` 从不解析 `-n`，命令 exit 0 但正文被**静默丢弃**——「写回执不规范」的头号机器成因。现带 `-n` 即以其为回执正文（文件已存在则覆盖 body、合并 frontmatter）。
> 3. **仓内回执不再空 body**：旧 `writeFM(rFile, rFm, '')` 连骨架都不给；现缺文件落指针桩。
> 4. **`check` 校验回执正文锚节**：对契约生效日（`RECEIPT_BODY_SINCE=2026-10-13`）起的回执硬校验「非空正文 + 含 `##` 节 + 含状态/结论锚节」，缺失即 exit≠0。存量回执（含当日前的）豁免，避免历史证据被打成不合规（同 `reportSize` / `reportMissingReceiptPrompt` 的阈值日期只查增量原则）。
> 5. **「先查状态」前置门禁**：提示词写了「动手前必先 `handoff status`」却无机制。`status` 跑过即落时间戳（存 `os.tmpdir()`，按 ROOT 哈希分文件，不污染仓库）；`receipt` / `accept` / `reject` 前校验戳在窗口内（默认 60 分钟），否则拒绝。豁免 `HANDOFF_STATUS_GATE=off`；窗口 `HANDOFF_STATUS_WINDOW_MIN=<分钟>`。
> 6. 兼容与影响面：跨仓 `--json` v1 schema 不动；`check` 因存量豁免仍 exit 0。新增回执创建时补 `date` 字段（用于生效日判定），但不覆盖既有回执自查的 `date`。
> 7. 同步面：`handoff.mjs`（骨架→指针桩、`cmdReceipt`、`cmdAccept`/`cmdReject`、`cmdStatus`、`cmdCheck`/`cmdCheckIntra`、help/头注释）；`DESIGN.md` 骨架段与演进表。
> 8. 事故留痕（hub 侧自查）：验证阶段误以为「`cp -R` 到临时目录」可隔离跨仓测试——**跨仓模式 `ROOT` 恒等于脚本所在目录（`SCRIPT_ROOT`）**，`cd` 副本无效，测试实打真实 hub，误改 `SWOOP-20260920-04-bug`（forwarded→received）+ 多落一份回执，已还原。**教训：跨仓测试必须复制整个 hub 并运行副本脚本，或用 `--root`/仓内子 Hub**。

> **v2.10 补记（2026-10-13 · 接入桩早拦化 + marker 升 v2.1 · 取代 v2.9「marker 冻结」）**：
> 1. **接入桩改为「早拦 Preflight」版**：桩正文从「先判模式 → 仓内/跨仓分路」7 条指针，换为「早拦 Preflight（强制）+ 最小操作序列（仓内）+ 指向 `AGENT-GUIDE.md`」——把「决策前先跑 `handoff status`、只认进行中、指定 ID 须在进行中且归属当前方、多条未指定不擅自选」从提示词纪律前置到桩。
> 2. **marker 由 `handoff-stub:v2.0` 升为 `handoff-stub:v2.1`**，**取代 v2.9 的「marker 保持不变」冻结决定**（原冻结理由 = 改 marker 会破坏对存量 v2.0 桩的幂等替换）。冻结由实现消解：`handoff.mjs` 的 `STUB_MARKERS` 列出全部历史 marker，`cmdInstall` 对**任一**已知 marker 做整块幂等替换，故 v2.0→v2.1 迁移不再破坏幂等。
> 3. **单一真相源对齐**：`handoff.mjs` 的 `STUB_BLOCK`、`README.md` §接入桩 展示块、hub `AGENTS.md` 三处逐字一致；`AGENT-GUIDE.md` 为完整版 Preflight（桩只留精简版 + 指针）。
> 4. 同步面：`handoff.mjs`（`STUB_MARKERS`/`findStubBlock`/`STUB_BLOCK`、`cmdInstall` 匹配逻辑）；`README.md` §接入桩；`AGENTS.md`；新增 `AGENT-GUIDE.md`。各仓重跑 `handoff install` 即可由 v2.0 桩自动迁移到 v2.1。

> **v2.11 变更（2026-10-13 · 转递提示词升硬校验 + 消灭竞争回执模板 + 桩补出站序列）**：
> 1. **动因（Hub 自身缺陷 · 载体自相矛盾）**：契约声明「回执规范唯一源 = `RESPONSE-TEMPLATE.md`」（DESIGN.md:27/43），但 Hub 自己发布的可复制载体里有两份互相竞争的回执模板，且 agent 实际照抄的那份（`STUB_BLOCK` / `AGENT-GUIDE.md`）恰好**漏掉「转递提示词」节**——实测 ≥2026-09-10 的 58 份回执中 2 份缺该节（IGGLE-20260929-01、SWOOP-20260922-02），合规靠 agent 额外自觉读 `RESPONSE-TEMPLATE.md`，而非机制。v2.10 去骨架化把唯一携带该节的可复制载体（CLI 骨架）删成指针桩，重演 DESIGN.md:181「要求写在骨架外 = 没有」的事故条件。
> 2. **三处接入桩 + `AGENT-GUIDE.md` 回执模板改「指针」**：由「列举 7 项【】要素」（与 `RESPONSE-TEMPLATE.md` 节名不一致的竞争模板）改为**照抄 `RESPONSE-TEMPLATE.md`「回执模板（可直接复制）」骨架**（含「## 转递提示词」节）——单一源、无第二份竞争模板。`STUB_BLOCK` / `README.md` §接入桩 / hub `AGENTS.md` 三处逐字一致（marker 不变，仍 `handoff-stub:v2.1`）。
> 3. **「转递提示词」节升 `check` 硬校验**：新增 `RECEIPT_PROMPT_SINCE=2026-10-13`，`checkReceiptPrompt()` 对阈值日起的回执缺失「## 转递提示词」节即 exit≠0；存量（阈值日前）豁免（同 `RECEIPT_BODY_SINCE` / `reportSize` 原则）。**免转递豁免**：跨仓 `COREML-*` 与仓内 `workspace=same` 不产出该节，不得误伤。`reportMissingReceiptPrompt`（软提示）保留为补充。
> 4. **桩「最小操作序列」补出站方向**：由单一「（仓内）」序列扩为「出站（`new` → `forward` → `prompt`）+ 入站（`status` → `show` → 改动 → `receipt` → `check`）」；`handoff prompt <ID>` 生成一行转递词（仓内 `workspace=same` 免转递，跳过）——此前桩完全没提出站提示词。
> 5. **同步面**：`handoff.mjs`（`RECEIPT_PROMPT_SINCE` / `checkReceiptPrompt` / `cmdCheck` / `cmdCheckIntra` / `STUB_BLOCK`）；`README.md`（头 + §转递提示词 + 回执正文注 + §接入桩）；`AGENTS.md`；`AGENT-GUIDE.md`；`DESIGN.md`（骨架段 + 演进表）。跨仓 `--json` v1 schema **不变**。
> 6. **验收**：三处桩逐字一致；全库 `handoff check` exit 0（存量豁免不破）；阈值日起造无「## 转递提示词」节回执 → exit≠0，补该节 → exit 0；`handoff install --project` 幂等且 v2.10 桩→v2.11 桩迁移。

> **v2.11.1 变更（2026-10-13 · 同日小修 · 转递提示词升「回复固定末块」）**：
> 1. **动因（用户反馈）**：应用方的交接/回执转递提示词目前「写到回复中」——只由 v2.8.2 一句散文「对话回复结尾再附同一行」约束，agent 常把它塞进正文中段（甚至夹在工具调用/结束语之间），用户翻找困难。
> 2. **治法**：把「回复里写提示词」升为**固定末块**——Agent 回复的**最末块固定为** `## 转递提示词`，其下**仅一行**（= `handoff prompt <ID>` 输出，或回执那一行），**其后不再有任何正文/结束语**。位置（末块）+ 词面（`## 转递提示词`）双锚：滚到底或搜索均命中。与回执**文档**里的同名节对称，全系统一个词。
> 3. **范围**：仅跨仓 / 仓内 `workspace=separate` 产出；`COREML-*` / 仓内 `workspace=same` 免转递，不写该块。此属**回复排版纪律**，`check` 无法校验（回复不入库），靠接入桩 / `AGENT-GUIDE.md` 纪律落地。
> 4. **同步面**：`handoff.mjs`（`STUB_BLOCK`：Preflight 加「回复收尾」条、出站第 3 步与入站新增第 7 步）；`README.md`（头 v2.11.1 + §转递提示词）；`AGENTS.md`；`AGENT-GUIDE.md`（Preflight 清单 + 出站/入站序列）；`RESPONSE-TEMPLATE.md`（结尾话术②）；`DESIGN.md`。marker 不变（`handoff-stub:v2.1`），各载体重跑 `handoff install` 即迁移到 v2.11.1 桩。

> **v2.12 变更（2026-10-14 · 接入桩「真·单一源 + 生成件完整性」· 修复 v2.11.1 回归）**：
> 1. **动因（v2.11.1 引入的回归 · 审计发现）**：v2.11.1 改 `STUB_BLOCK` 时误把 `<!-- handoff-stub:v2.1 begin/end -->` marker 包裹替换为 `<!-- generated — do not edit -->` / `<!-- stub:sha256:1316b0a0 -->` 头。`findStubBlock()` 只认 v2.0/v2.1 marker → 对新块恒返回 `null`：①`install` 对 5 载体全部走「手写指针，无标准桩标记」**告警跳过**，契约更新不再传播（install 由「幂等整块替换」退化为「跳过」）；②`checkStubCarrier()` 因 `findStubBlock` 恒 null 而对每个目标 `continue` → **漂移检测形同虚设**（实测篡改载体一字节后 `handoff check` 仍 exit 0、零告警）；③载体被写成**两份**（AGENTS.md/CLAUDE.md/两处全局桩各 2 份），install 无法修复。
> 2. **marker 包裹恢复**：`STUB_BLOCK` 重新以 `STUB_BEGIN`/`STUB_END` 包裹，生成注（`<!-- generated -->` / `<!-- stub:sha256 -->`）置于 marker **之内**；契约版本号 v2.11.1 → **v2.12**。
> 3. **`install` 去重 + 修复**：新增 `STUB_REGION_RE`（匹配规范 marker 块 **或** 历史无 marker 块，按 `### Handoff 接入桩（` + 尾句「获取完整版 Preflight。」锚定）。`cmdInstall` 改为「剥掉全部桩区块 → 只落一份规范桩」，**实测可把各载体 2 份重复收敛为 1 份**；不再依赖 marker-only 的 `findStubBlock`。
> 4. **README §接入桩 纳入 install 目标**（默认含，`--no-readme` 可关）——它是此前唯一的「无 marker 手工副本」，现由生成器维护。
> 5. **`sha` 实算 + 由 check 校验**：`STUB_SHA = sha256(STUB_BODY).slice(0,8)`（旧硬编 `1316b0a0` 与任何内容都对不上、且从不被校验）；`checkStubCarrier()` 重写为：载体含 **>1 份**桩 → 报「应恰 1 份」；正文与 `STUB_BLOCK` **逐字节不一致** → 报「漂移/被手工改」；均 exit≠0 并点名文件。
> 6. **同步面**：`handoff.mjs`（`STUB_BODY`/`STUB_SHA`/`STUB_BLOCK`、`STUB_REGION_RE`/`STUB_CANON`、`checkStubCarrier`、`cmdInstall`）；`README.md`（头 + §接入桩）；`AGENTS.md`/`CLAUDE.md` + 两处全局桩；`DESIGN.md`；本文件。跨仓 `--json` v1 schema **不变**。
> 7. **验收**：`handoff install` 幂等（复跑「全部无需变更」）；5 载体各恰 1 份且逐字一致；`handoff check` exit 0（101/98）；临时副本篡改载体一字节 → `check` exit≠0 点名；`node --check handoff.mjs` OK。

> **v2.12.1 变更（2026-10-14 · 审计修复 F1–F8 · 修 v2.12 的缺陷）**：
> 1. **动因（独立审计）**：`AUDIT-REPORT-2026-10-14-INDEP01.md`（审计员 INDEP01，沙箱 `HOME` + 完整副本，未触碰真实 hub）在 v2.12 上实测出 10 项问题；本轮修其中**代码项 F1–F8**（F9/F10 为文档·卫生，另处理）。
> 2. **F1（P0 · 静默数据损毁）**：`STUB_REGION_RE` 把「marker 块」与「heading 块」写成**单条 alternation**，正则自左向右扫描时更早出现的 heading 起始点会「抢跑」，正文里一旦有 `### Handoff 接入桩（…` 且其后存在「获取完整版 Preflight。」，`install` 便把该用户正文整段**静默删除**，且事后 `check` 仍 exit 0（完全无告警）。**治法**：拆为 `STUB_MARKER_RE` / `STUB_HEADING_RE` 两条正则，新增 `scanStub()`/`stripStub()` 做 **marker 优先**（有 marker 只认/只剥 marker），heading 分支加特征串「强制守卫 · 细则以」约束。
> 3. **F2（P1 · 崩溃 + 部分写入）**：`cmdInstall` 的 `fs.writeFileSync` 无父目录创建、无 try/catch；新机器（无 `~/.claude`/`~/.config/opencode`）跑 `install` 会抛 ENOENT 栈回溯并中止，导致其后的 cwd `README.md` 永远轮不到写入。**治法**：新增 `safeWrite()`（写前 `mkdirSync(dirname,{recursive:true})`，单目标失败只告警不中断其余）。
> 4. **F3/F4/F5/F6/F7/F8（P2）**：③`--global` 不再写 cwd `README.md`；④去重改为「按桩区块切分、只在接缝处规范化空行」，**不再重排用户其它排版**；⑤删除死代码 `findStubBlock`（0 调用点，`escapeRe` 随之移除），`STUB_MARKERS` 保留供 `STUB_BEGIN/END` 使用，文档叙事由「等 findStubBlock 修好」改为「统一走桩区块正则」；⑥`checkStubCarrier` 新增「载体缺标准 marker（应含 `STUB_BEGIN`）」检测（原 `STUB_CANON` 会剥掉 marker，故 marker 丢失检不出）；⑦`--no-readme` 补进 README / `COMMANDS.md` / 内建 usage 三处用法表；⑧`STUB_CANON` 先 `\r\n → \n`，消除 Windows 工具改写导致的「漂移」假阳性。
> 5. **版本**：桩正文版本串 v2.12 → **v2.12.1**（桩正文仅此一处改，故 `STUB_SHA` 随之变化 → 各载体需重跑 `handoff install` 刷新）；marker 不变（`handoff-stub:v2.1`）。
> 6. **未修（F9/F10）**：F9「完整 hub 副本不足以隔离全局载体（`install`/`check` 取 `process.env.HOME`）」→ 已写入审计需求文档 §6 与开发规范（破坏性测试须**同时**重定向 `HOME`）；F10 数据目录混放的非 `.md` 文件（`*.md.bak`、`*.report.json`、`*.weak_labels.jsonl`）移入 `legacy/`。
> 7. **验收**：`node --check` OK；沙箱实测 F1（用户标题/正文保留）、F2（不崩溃 + README 写入 + 递归建目录）、F3、F4（用户空行保留）、F6（marker 丢失报错）、F8（CRLF 不报）、自愈（v2.11.1 回归态 install 可修复）、幂等/去重/篡改检测全 PASS；真实 hub `handoff install` 刷新 + `handoff check` exit 0（101/98）。

> **v2.12.2 变更（2026-10-14 · 目标注册 Tappy / 一期一卉花）**：
> 1. **动因**：契约传播至下游时发现 **Tappy**（`~/Documents/Developer/Tappy`，Android 自动化工厂）与 **一期一卉花**（`~/Documents/Developer/一期一卉花`，花店小程序，slug 取自 `package.json` 的 `yiqiyihuihua`）两仓已装有 Hub 接入桩（v2.11 载体），却不在 `TARGETS` 内——无法作为跨仓交接的接收方，`handoff new tappy …` 被 target 校验拒绝。二者皆为 Hub 消费方，本轮登记为跨仓一等 target。
> 2. **改动**：`handoff.mjs` `TARGETS` 增 `tappy`/`yiqiyihuihua`、`TARGET_LABELS` 增 `Tappy`/`一期一卉花`；`README.md` 头（共用方 + 版本）、命名规范 `<TARGET>` 枚举、agent 正则、接收方即前缀路由表、frontmatter `target` 枚举同步。
> 3. **版本**：桩正文版本串 v2.12.1 → **v2.12.2**（桩正文仅此一处改，故 `STUB_SHA` 随之变化 → 各载体需重跑 `handoff install` 刷新）；marker 不变（`handoff-stub:v2.1`）。
> 4. **验收**：`node --check` OK；真实 hub `handoff install` 刷新 5 载体 + `handoff check` exit 0；`handoff new tappy/yiqiyihuihua` 通过 target 校验。

> **v2.12.3 变更（2026-10-14 · 回执「内容完整性」门禁 · P0-a/P0-b/P0-c/P1-b）**：
> 1. **动因**：2026-10-13 一期一卉花 `goods-stores-20261013-01-task-resp` **伪回执**——frontmatter + 「## 转递提示词」齐全、`handoff check` 能过，但声称新增的 `cloudfunctions/stores/**`、`miniprogram/modules/admin/stores/**`、`docs/接口契约.md §9` 均不存在，所引短哈希 `5aa64ed` 经 `git show` 仅改 `.handoffs/` 三文档、零业务代码；全程无引擎步骤拦截，仅在人工 reject 阶段识破。根因：`accept` 不跑 check、`check` 只查节名不查内容、`receipt` 落盘零校验。
> 2. **P0-a**：`cmdAccept`/`cmdReject` 前置**内容门禁**——对该回执跑「锚节 + 转递提示词 + evidence」校验（复用 check 的阈值/豁免逻辑），`accept` 不过即拒闭环（`reject` 仅打印发现辅助审计，不阻断）。scoped 到该回执本身，不跑全库 check。
> 3. **P0-b**：`cmdReceipt` 落盘前对 `-n` 正文跑同一门禁，缺项即 exit 1、不落盘、不翻 `received`。
> 4. **P0-c**：回执新增 **`evidence` frontmatter 字段**（`evidence_paths` / `evidence_commits` / `evidence_repo` / `evidence_note`）；`receipt`/`accept`/`check` 三处机器校验——阈值 `EVIDENCE_SINCE=2026-10-14` 起的**仓内**新回执**必须**声明，声称路径 `fs.existsSync` 真实存在、提交 `git cat-file -e` 可查；跨仓目标仓不可达时降级 warn（`HANDOFF_REPO_ROOTS=key=path,...` 启用硬核）。CLI 增 `--evidence-paths/-commits/-repo/-note`。存量豁免，不回改历史。
> 5. **P1-b**：`cmdPrompt` 仓内 `workspace=separate` 分支补可复制提示词行（`请 <to_lane> 收交接：<handoff路径>`），对齐 v2.11 契约 `README:223`。
> 6. **文档**：`README.md` §回执 frontmatter 加 evidence、op 表/accept 说明补门禁；`RESPONSE-TEMPLATE.md` 骨架加 frontmatter evidence 块 + evidence 正文章节 + 「逐字复制」纪律；桩正文版本串 v2.12.2 → **v2.12.3** 并在回执步骤补 evidence 硬门禁。设计见 `PROPOSAL-2026-10-14-receipt-content-integrity.md`。
> 7. **版本**：桩正文版本串 v2.12.2 → **v2.12.3**（桩正文改「回执步骤补 evidence 硬门禁」一处 ⇒ `STUB_SHA` 变化 ⇒ 各载体需重跑 `handoff install`）；marker 不变（`handoff-stub:v2.1`）。（AR-F10：原条目漏显式「版本」段，2026-10-15 补。）
> 8. **边界**：不改状态机 / 命名 / `--json` v1 schema；不动交接正文规范；**存量（`EVIDENCE_SINCE=2026-10-14` 前）豁免、不回改历史**；跨仓目标仓不可达 ⇒ 降级 warn 不硬拦（需硬核则配 `HANDOFF_REPO_ROOTS`）；仓内模式强制声明 evidence，跨仓不强制。回执规范唯一源仍为 `RESPONSE-TEMPLATE.md`。（AR-F10 补。）
> 9. **验收**：`node --check` OK；临时 intra-repo 子 Hub 受控实测 A–J 全 PASS（伪回执无 evidence / 假路径 / 假提交均在 `receipt` 落盘前被拒且不翻状态；`accept` 伪回执被 P0-a 阻断；合规回执放行并持久化 evidence；separate 缺「转递提示词」节被拒；`check` 对伪回执 exit≠0、合规 exit 0）；真实 lab Hub `check` 仍 exit 0（109/106，存量豁免）；`handoff install` 刷新 5 载体 + `check` exit 0。

> **v2.12.4 变更（2026-10-14 · 回执「转递提示词」同工作区解耦）**：
> 1. **动因**：`PROBLEM-2026-10-14-receipt-prompt-on-same-workspace.md`——回执「## 转递提示词」交付行被 `workspace=same` 与任务转递一并豁免，导致仓内 intra-repo 回执无标准行可贴、发起方只能回查 `handoff status`，违反 `DESIGN.md §1`（agent 间无直连、复制粘贴是唯一通道）与 `RESPONSE-TEMPLATE.md:112`（不靠消费方回查回执）。与 v2.12.3 P1-b 已修的 separate 分支同源（same 分支漏修）。
> 2. **改动（根因解耦）**：`handoff.mjs` `checkReceiptPrompt` **删除 `if (workspace === 'same') return;`**——仓内 `workspace=same` 回执仍须含「## 转递提示词」节（仅任务转递免搬工作树，回执交付行不豁免）；保留 `COREML-*` 历史豁免（同工作区侧免转递，COREML 专属）。同步 `README.md` §转递提示词/§回执正文、`RESPONSE-TEMPLATE.md:109`、`AGENT-GUIDE.md` 措辞与桩正文（STUB_BODY）。
> 3. **版本**：桩正文版本串 v2.12.3 → **v2.12.4**（仅措辞 + 豁免口径，无 schema 变更；`STUB_SHA` 随之变化 → 各载体需重跑 `handoff install` 刷新）；marker 不变（`handoff-stub:v2.1`）。
> 4. **边界**：不改状态机 / evidence / `--json` schema；不动交接正文规范；单一源仍为 `RESPONSE-TEMPLATE.md`。`COREML-*` 是否一并解禁交维护方后续评估（本报告不强制）。
> 5. **验收**：`node --check` OK；lab Hub `handoff check` 仍 exit 0（无 intra-repo same 回执受影响）；待各载体 `handoff install` 刷新 + 一期一卉花存量占位回执可选回填。
> 6. **热修（同日 · 引擎 bugfix · 无版本/桩变更）**：`evidenceProblems` 对**跨仓**回执**未声明 `evidence_repo`** 时，原先 `resolveRepoRoot(undefined)` 回退 `process.cwd()`=Hub（常为非 git 仓）→ 拿 Hub 的 git 硬核验执行方提交，误红合规回执（实证：`SWOOP-20261014-03` 引 `aff2ad8`——本为 Swoop 真实提交，仅漏声明所属仓）。改为**降级 warn、不硬拦**，对齐 v2.12.3 既定边界「跨仓目标仓不可达 ⇒ 降级 warn」与 README:99「跨仓配 `HANDOFF_REPO_ROOTS` 后才硬核」；**仓内（intra-repo）硬门禁不变**（cwd=执行方仓）。属实现回归到既有契约、非契约变更，故不 bump 版本、不动 `STUB_BODY`/`STUB_SHA`、无下游桩漂移。修后 lab `handoff check` 回绿。
> 7. **热修批次二（2026-10-15 · 独立审计 `AR-2026-10-15-01` 收口 · 无版本/桩变更）**：审计给出**否定意见**（P0×1 / P1×3 / P2×6），维护方独立复现后逐条修复：
>     - **AR-F1（P0 · 根因）门禁豁免键去自证**：`checkReceiptBody` / `checkReceiptPrompt` / `evidenceProblems` 三处原以**回执自声明 `date`** 判存量豁免——`date` 属待校验工件自身字段，执行方不写 `date`（或写早于阈值的日期）即令整组门禁豁免，伪回执可穿 `accept` 与 `check`（实证：`date: 2026-01-01` + 不存在路径 → `check` exit 0、`accept` 直接闭环；`date` 缺失 + 空正文 → full bypass）。**这正是 v2.12.3 立门禁要拦的 2026-10-13 伪回执同类行为。** 治法：新增 `handoffCreated()` / `gateDate()` / `exemptBy()`——豁免键改 `max(交接 created, 回执 date)`（交接由发起方创建，非执行方自证；取 max 防「新回执借旧交接洗白」），**两者皆无或非规范 ISO ⇒ 不豁免（fail-closed）**。**误伤评估**：111 份回执「豁免→受检」= **0**（10 份缺 `date` 者均属旧交接），下游 5 仓 `check` 实测全绿。
>     - **AR-F2（P1）**：`receiptStubIntra` 自产骨架补「## 转递提示词」节 + 改掉「same 免转递」矛盾措辞（此前引擎自产骨架落盘即被自家 `check` 判红）。
>     - **AR-F3（P1）**：`AGENT-GUIDE.md:20`、`README.md:230` 旧措辞清零，并**区分两种语义**——出站任务转递（`prompt`，same 免）vs 回执交付行（same 不豁免）；`README:8/163` 加辨义注（`README:37/341` 等讲出站的保持原样，未误改）。
>     - **AR-F4（P1）**：`resolveRepoRoot` 对 `HANDOFF_REPO_ROOTS` 命中项也做 `existsSync`，不可达 ⇒ 返回 `null` ⇒ 降级 warn（原直接返回配置值 ⇒ 硬拦，违背契约）。可达路径仍硬核（对照实测）。
>     - **F5–F10（P2）**：evidence 路径 confine 仓根（堵深 `../` 逃逸）、删 `checkReceiptPrompt` 死参 `workspace`、`git show` 屏蔽 stderr、顶层 usage 补 `--evidence-*`、`DESIGN.md` 补 v2.12.4 行并更正契约基线 v2.9 → v2.12.4、`COMMANDS.md` 版本更正、CHANGELOG v2.12.3 补「版本 / 边界」段。
> 8. **为何不 bump v2.12.5**：本批不动 `STUB_BODY` ⇒ `STUB_SHA` 不变 ⇒ 20 载体无需重刷、下游 5 仓无需再跑 `install`（省一轮 5 仓转递）。桩文内规则对 agent 仍准确（「声明真实 evidence」本就是既有要求），故维持契约版本 **v2.12.4**，以热修批次记录于本条。
> 9. **验收（本批）**：`node --check` OK；沙箱 intra 子 Hub 逐条复验 PASS——F1-a 伪回执 `accept` 拒（exit 1、状态留 `received`）、F1-b 缺 `date` 空正文 `check` 拦、F1-c 真存量仍豁免、F2 骨架含节且 `check` 不报、F4 不可达 root 降级 warn（可达仍硬拦）、F5 `../` 逃逸报「越出仓根」、F7 stderr 无 `fatal:`；**真实 lab Hub `check` exit 0（114/111）**；**下游 5 仓 `check` 全绿**（iggle/Swoop/Prospero 114/111、Tappy 7/7、一期一卉花 8/8）。
> 10. **热修批次三（2026-10-15 · 审计遗留 3 项收口 · 无版本/桩变更）**：把审计刻意留口的 3 项全部收掉。
>     - **① evidence 相关性硬校验**（原为 warn，且审计判定为设计边界）。**先修两个引擎缺陷，否则只会假阳性**：（a）原只看 `ev.commits[0]`——多提交回执（如桩提交与回执提交分两次入库）必然误报；（b）未加 `-c core.quotePath=false`——中文路径被 git 转成八进制（`"docs/\346\216\245..."`），与回执里 UTF-8 字面量永不相等 ⇒ 中文路径恒误报。修后**遍历全部声明提交**，且路径须被**任一**声明提交实际改动；新增 `RELEVANCE_SINCE=2026-10-15`，此前存量仍只 warn（与既有三个 SINCE 同款存量豁免）。**误伤实测**：三仓受 evidence 门禁 13 份中，修正判据后真实命中 **1 份**（`YIQIYIHUIHUA-20261014-02` 声明的 4 个 receipt 路径中有 1 个不在其声明提交内）；另 4 条历史 warn 查明为上述两缺陷的假阳性（含 `stores-20261014-01` 的 `docs/接口契约.md`），修后自动消失。
>     - **② 提示词节「只验节名」→ 验内容**。实情报废了原判断：该文件并非「没有交付行」，而是**两个节并存**——一个空壳 `## 转递提示词`、另一个 `## 转递提示词（必含 · 供用户原样复制）` 里写着旧式行。故规则定为「**至少一个**同名节内有一行可复制交付行（新式「请收 <写回执仓> 回执：…」或旧式「登记回执：…」）」，`check` 不再被空壳节蒙混。实现弃用正则前瞻，改**逐行切分**（`receiptSections()`）——JS 无 `\Z`（那是 Python），照搬 Python 验证过的正则会在 JS 里退化成字面 `Z` 而匹配失败。同时回填 `YIQIYIHUIHUA-20261014-01`：删空壳节、统一为标准格式（`请收 一期一卉花 回执：<绝对路径>（75 行 · 否 · …）`）。
>     - **③ `SWOOP-20261014-03` 补 `evidence_repo: /Users/churze/Documents/Swoop`**——使其从「跨仓未声明 ⇒ 跳过核验」进入**硬核验**路径（`aff2ad8` 经查确为 Swoop 真实提交，且改动 AGENTS/CLAUDE/README，证据属实）。**失效注入验证**：改 `aff2ad8`→`0000000` ⇒ `check` exit 1 报「提交不存在（root=…/Swoop）」；删掉 `evidence_repo` ⇒ 退回 warn；两次注入后均还原，`check` 回 exit 0。
>     - **验收（本批）**：`node --check` OK；沙箱 **8/8 PASS**——①-a 无关提交被拦、①-b 中文路径放行（quotePath 已修）、①-c 多提交遍历放行（原会误报）、①-d 存量仅 warn 不硬拦、②-a 空壳节被拦、②-b 带后缀标题的行被识别、②-c 旧式行放行、③ 失效注入两项；**真实 lab Hub `check` exit 0（114/111）**，Tappy 7/7、一期一卉花 8/8 全绿。
> 11. **仍维持 v2.12.4、仍不 bump**：本批依旧不动 `STUB_BODY` ⇒ `STUB_SHA` 仍 `1b465062` ⇒ 20 载体不重刷、**下游 5 仓无需 `install`、无需转递**。理由：①②都是**既有义务的收紧执行**（「声明可核验证据」「提示词节放一行交付行」本就是契约既有要求），未新增 agent 书写义务。
> 12. **遗留（1 项，已明知且按存量豁免原则接受，非待办）**：`YIQIYIHUIHUA-20261014-02-feature-resp.md` 声明的 `.handoffs/receipts/stores-20261014-01-task-resp.md` 不在其声明提交内（该文件实由 `548d74a`/`1efbb36` 引入，属另一份交接的工作）。因其门禁日 2026-10-14 早于 `RELEVANCE_SINCE`，按存量豁免只 warn 不拦——**未回改历史、未代改执行方回执**（改他人回执会破坏审计链）。若日后要让记录完全精确，应由一期一卉花侧重发该回执（非必需）。
> 13. **热修批次四（2026-10-15 · P1 落地 · 无版本/桩变更）**：`PROBLEM-2026-10-14-receipt-prompt-on-same-workspace.md §4` 的 **P1（引擎生成可复制回执行）** 补上——此前仅 separate 分支由 v2.12.3 P1-b 在 `cmdPrompt` 打印交接提示词，`cmdReceipt` 成功后只报「已登记 + 状态翻 received」、要 agent 自己手工拼交付行（`RESPONSE-TEMPLATE.md:109` 要求）。现新增 `printReceiptDeliveryLine(rFile, needsChange)`，在 `cmdReceipt` **两个分支（仓内 / 跨仓，含「已 received 跳过翻状态」重跑路径）** 落盘后均打印：`请收 <本仓> 回执：<路径>（<行数> 行 / <字节> 字节 · 需发起方改动：<是/否>）`，与 `cmdPrompt` 对 separate 的交接提示词对称。`<本仓>` 取运行仓 `detectRepo→TARGET_LABELS`（取不到回退目录名）；行数/字节按落盘文件实测。纯引擎行为、**未改 `STUB_BODY` ⇒ `STUB_SHA` 仍 `1b465062` ⇒ 20 载体不重刷、下游 5 仓无需 `install`、无需转递**。实测：跨仓（swoop cwd）/ 仓内（Tappy cwd + `--needs-change`）/ 重跑三场景均正确出列。

> 14. **热修批次五（2026-10-18 · status 输出仓名硬编码 · 无版本/桩变更）**：`handoff-status.mjs` `--for` 视图输出文案硬编码 iggle 且缺 MODE 守卫，intra-repo 模式同样命中——
>     - **病根（用户报「Tappy 同仓交接读到其它仓的内容」）**：`--for <lane>`（仓内）与 `--for <target>`（跨仓）共用 FOR 分支，「已回执」分组标题恒印 `已回执待 iggle 实测`。Tappy 仓内 `status=received` 项（实证：`impl-20261013-01-bug`）被烙错章，agent 转述进回复，使用者误判串仓。与 `handoff.mjs:709` 已修的「验收记录节标题写死 iggle」同类（非 iggle 发起方会烙错章），status 脚本是漏网处；同一输出内逐条「下一步」有 MODE 守卫（文案正确）而标题没有——自相矛盾即定位线索。另修中央视图 `receiptButStale` 提示「升依赖版本 / 改调用」在 intra-repo 下的跨仓口吻（改 lane 口吻：发起 lane 跑 `handoff receipt <id>` 登记）。
>     - **修法**：两处均按 MODE 分支——intra-repo 印 `已回执待发起 lane 实测`（与既有 `等发起 lane 独立实测后 close` 措辞对齐），跨仓逐字不变。
>     - **为何不 bump**：纯展示文案，未动 `STUB_BODY` ⇒ `STUB_SHA` 仍 `1b465062` ⇒ 20 载体不重刷、下游 5 仓无需 `install`、无需转递。
>     - **验收**：`node --check` OK；Tappy 仓根 `status --for impl/audit` 标题已无 iggle；跨仓 `status --for swoop/tappy/iggle` + 中央视图改动前后**逐字节一致**；沙箱 intra 子 Hub 复现 stale-receipt 新提示；lab Hub `check` exit 0（115/112）。
>     - **已知与本批无关的存量红（Tappy 侧自纠，非引擎问题）**：Tappy 仓 `check` exit 1——`audit-20261018-02-task.md` 被手改 frontmatter 置 `closed`（未走 `handoff accept`），缺 canonical「## 验收记录（闭环依据）」节。收口路径：frontmatter 挪回 `received` 后跑 `handoff accept audit-20261018-02-task -n "<结论>"`，或手工补该节（结论内容已在「impl 侧闭环」节内）。

> 15. **热修批次六（2026-10-18 · 同类病根全量排查收口 · 无版本/桩变更）**：应用户「再仔细排查是否还有其它类似或相关问题」的要求，对「跨仓专属措辞 / 动作在 intra-repo 模式漏守卫」做全量扫描（`handoff.mjs` 全部命令 + `handoff-status.mjs` + 桩文案 + 四份文档逐行过），修 4 处 + 顺带暴露的 1 处缺陷：
>     - **F1 `cmdAccept` 状态错误提示**（`handoff.mjs`）：仓内 agent 对 draft/forwarded 交接跑 accept，提示带「（或 handoff sync 登记回执）」——`sync` 是跨仓专属命令（`cmdSync` 对 intra 直接返回「仓内模式无 sync」），仓内照做即撞墙。按 MODE 分支，仓内只提示 `handoff receipt <id>`。
>     - **F2 `cmdAccept` 用法错误的门禁文案**：硬编码「核实依赖方改动 + 本仓适配」——仓内双方是同仓 lane，无「依赖方 / 本仓适配」概念。按 MODE 分支为「核实接收 lane 的改动 + 验证结论」。
>     - **F3 `status --for <lane>` lane 校验缺失**（`handoff-status.mjs`）：跨仓 `--for` 有 `VALID_TARGETS` 硬校验，仓内 `--for` 零校验——lane 拼错 ⇒ `mine` 为空 ⇒ 输出「✅ 没有待 X 处理的交接」，**假阴性**，agent 会据此判定「本轮无事可做」而跳过真待办（与 2026-09-04 draft 语义事故同类：可见性缺失）。修法：intra 模式读 `ROOT/.handoff-hub.json` 的 `lanes` 校验，不过即 exit 2 并列合法 lanes；配置不可读 ⇒ fail-open 不误伤。
>     - **F4 `cmdStatus` 错误路径炸栈**（F3 顺带暴露）：`execFileSync` 调 status 子进程，子进程非零退出即抛异常连 Node 栈转储——干净消息后跟一坨栈（跨仓非法 target 早已如此）。修法：try/catch 透出 stderr + 按子进程码退出；`stdio` 显式全 pipe（execFileSync 默认会把子进程 stderr 透传一次，与 catch 的输出重复）。
>     - **F5 交付行格式规格与引擎输出漂移**：`README.md` / `RESPONSE-TEMPLATE.md` 的「请收 … 回执」一行式规格写 `（<行数 / 字节> · <是否需 iggle 改动> · …）`，引擎 `printReceiptDeliveryLine`（v2.12.4 热修批次四起）实际印 `需发起方改动：<是/否>`——文档追引擎，并去掉规格里的 iggle 硬编码（该格式跨仓 / 仓内通用）。`reportMissingReceiptPrompt` 补法提示同步改为新旧两式并列。
>     - **为何不 bump**：全部为提示文案 / 校验 / 错误路径，未动 `STUB_BODY` ⇒ `STUB_SHA` 仍 `1b465062` ⇒ 20 载体不重刷、下游 5 仓无需 `install`、无需转递。
>     - **排查覆盖（未再发现同类漏网）**：`cmdNew`（lane 校验 + TARGET 撞名守卫 ✓）、`cmdPrompt`（same/separate 双分支 ✓）、`cmdReceipt`（仓内五字段 + receiptStubIntra ✓）、`cmdCheck`（intra/cross 双门禁 ✓）、`cmdShow`（mode 感知字段表 ✓）、`cmdBrief/sync/drift`（intra 守卫 ✓）、`assertCloseDirection`（intra-only + lane 驱动 ✓）、`STUB_BODY`（全篇模式感知 ✓）、`AGENT-GUIDE.md`（✓）。已知接受项：跨仓 `receiptStub` 锚节含「是否需 iggle 改动」——跨仓 schema 字段，intra 不可达，保留。
>     - **验收**：`node --check` OK；跨仓 `status --for swoop/tappy/iggle` + 中央视图 + `--json` / `--json=v2` 改动前后逐字节一致（JSON 可解析）；仓内 `--for impl/audit` 结构正确（含新增 draft 项与 received 项混排）；沙箱 intra 子 Hub 实测：拼错 lane → exit 2 并列合法 lanes、大小写不敏感、accept 对 draft 提示无 sync、accept 用法错误无「依赖方」措辞、错误消息只出现一次；lab Hub `check` exit 0（115/112）；Tappy 仓 `check` 仍为**既存** exit 1（`audit-20261018-02-task` 缺验收记录节，与本批无关，待 Tappy 侧自纠）。
>
> 16. **热修批次七（2026-10-18 · 方向标签写死 iggle 全链收口 · 无版本/桩变更）**：实证推翻批次六「已知接受项」的判定——hub 维护方作为发起方直接建跨仓交接（`TAPPY-*` / `IGGLE-*` / `SWOOP-*` `-01-bug` 派发系列）后，执行方照 `RESPONSE-TEMPLATE.md` 写回执**全部方向误标**（Swoop 回执印「(swoop → iggle)」、iggle 回执印「(iggle → swoop)」，字段写「是否需 iggle 改动」）。逐层定位到机器根源并修 5 处 + 文档 2 处：
>     - **G1 `cmdNew` 标题方向标签**（`handoff.mjs` `dirLabel`）：写死 `t === 'iggle' ? 'Swoop → iggle' : 'iggle → X'`——hub 发起的交接标题即烙错。改为「接收方 X」中立标签，不猜发送方。
>     - **G2 回执标题 authorLabel**（`cmdReceipt`）：`hTarget === 'iggle' ? 'iggle → swoop' : 'X → iggle'`——**两份误标回执的直接印源**。改为「X 侧回执」。
>     - **G3 `receiptStub` 指针桩字段**（跨仓回执可达）：锚节「是否需 iggle 改动」→「是否需发起方改动」（frontmatter 字段名 `needs_iggle_change` 为 `--json` v1 schema 固定名，保留并在模板注明语义 = 是否需要发起方改动）。
>     - **G4 `cmdReceipt` 状态行**：「（需 iggle 改动）」→「（需发起方改动）」。
>     - **G5 `cmdBrief` intro**：「由依赖方发起，需你方（iggle）适配」/「由 iggle 发起」二选一均写死 iggle 枢纽——hub 发起的 `IGGLE-*` 被误印「由依赖方发起」。改为按 target 只述接收方动作，发送方以 frontmatter / 转递话术为准；brief 处理要求「禁止修改 iggle 仓库」泛化为「禁止修改对方仓任何文件」。
>     - **G6 `RESPONSE-TEMPLATE.md` 整篇泛化**（34 处）：标题 / 引言 / 骨架标题 / 字段 / 要求详解表 / 禁止项 / 转递话术的 iggle 单方向口吻 → 全方向通用；新增「方向判定」规则（发送方以 frontmatter `from_repo`/`to_repo` 或 `from_lane`/`to_lane` 为准，不默认任何一方仓名）；iggle 方向专属内容（钉值 `REQUIRED_SWEEP_COMMIT` / SDK 重链接 / daemon 重启）就地标注保留。残留 8 处 iggle 全部为方向标注 / schema 字段名 / 实证引用语境。
>     - **G7 `README.md` 前缀规则节**：补「发送方不限定 iggle」说明（hub 可直接发起），堵住旧心智模型的文档源头。
>     - **为何不 bump**：未动 `STUB_BODY` ⇒ `STUB_SHA` 仍 `1b465062` ⇒ 20 载体不重刷、下游无需 `install`、无需转递。存量回执 / 存量 inbox 快照不回改（v2.6 第 5 条：inbox 非权威、可能过期，`brief` 重建即刷新）。
>     - **验收**：`node --check` OK；沙箱实测（`HANDOFF_ROOT` 仅支持 intra-repo 模式——需 `.handoff-hub.json`，跨仓沙箱搭法记录在案）：`new swoop bug` 标题印「(接收方 Swoop)」、`receipt` 指针桩标题「(Swoop 侧回执)」+ 锚节「是否需发起方改动」、`brief` 重建 inbox intro 为「等待你方处理（发送方以 … 为准）」、反向 `IGGLE-*` intro 不再误印「依赖方发起」；测试产物已清理，lab Hub `check` exit 0、`status` 无残留。

> 17. **热修批次八（2026-10-19 · 裸 `handoff` 命令不存在 · 调用方式与文档不一致的根修 · 动 STUB_BODY ⇒ 载体须重跑 install）**：
>     - **病根（用户报「消费方执行过程中说 handoff 不在 PATH」）**：v2.8 废除 / 别名时把 command shim 一并拆除，但文档与接入桩**大量使用裸 `handoff <op>` 写法**（桩 Preflight 节「必须先跑 `handoff status`」、`AGENTS.md` 收尾「`handoff check`」、`COMMANDS.md`「或 `handoff status --for swoop`」）——而本机无任何 shim（`/usr/local/bin`、`/opt/homebrew/bin`、`~/.local/bin`、`~/bin` 均无，`~/.zshrc` 无 alias）。消费方照文档敲裸命令 ⇒ `command not found: handoff`。与批次五/六/七同族：**设计决策（拆 shim）改了，依赖它的文档没改**，不一致本身没有机器信号。
>     - **修法（根修 = 让裸命令真实存在，而非把文档改回全路径迁就）**：
>         - **H1 新增 `handoff link` 子命令**（`cmdLink`）：把中央引擎以**符号链接**形式接入 PATH（落点优先 `~/.local/bin`——在 PATH 且用户可写、无 sudo；避开 `/Applications`、`/System`、`/Library`、`/usr/local/bin` 与 `.workbuddy/.nvm/.cargo` 等受管运行时；目标位置原为普通文件则备份后重建），`chmod +x` 引擎并实跑验证；幂等（已是最新则 `↩️`）；`--remove` 摘除。**symlink 而非副本** ⇒ 引擎热修零传播、零版本漂移，与「无全局 bin、全部按路径调中央引擎」的 2026-10-18 审计结论兼容。
>         - **H2 `check` 增 CLI 可达性门禁**（`checkCliReachable`，跨仓/仓内双路径同拦）：裸 `handoff` 不在 PATH 或指向非中央引擎 ⇒ exit 1 并印自愈命令；shim 存在但当前 PATH 解析不到（某工具未 source profile）⇒ 降级 `⚠️` 提示加 PATH、不阻断收尾。把「文档写的命令不存在」变成收尾硬门禁里的机器信号。
>         - **H3 `STUB_BODY` 统一为裸写法 + 自愈行**：操作序列全改 `handoff <op>`（原全路径），Preflight 新增「命令形态」条——报 `command not found` 时先用 `node ~/Documents/lab/handoffs/handoff.mjs <op>` 兜底、再跑一次 `link` 自愈。**⇒ `STUB_SHA` `1b465062` → `3dc5e83a`，20 载体需重跑 `handoff install`（hub 侧 5 载体已刷新；下游 5 仓由用户在各仓根执行）。**
>         - **H4 文档统一**：`COMMANDS.md`（统一入口 / 依赖方待办行 / op 表补 `link` / 版本脚注）、`AGENT-GUIDE.md`（两条操作序列改裸写法 + 失败兜底补 `command not found` 自愈条）、`README.md`（目录树 / 操作节 / op 表补 `link` / 本地直接跑 / 斜杠命令节 shim 说明）。桩漂移提示补「→ 跑 handoff install 更新」。
>     - **为何动桩**：桩是消费方冷启动唯一必读物（装在各仓 AGENTS.md/CLAUDE.md），它的混合写法正是这次误报的直接来源；只修 hub 文档不修桩，消费方继续撞墙。
>     - **边界**：不改状态机 / 命名 / `--json` schema / evidence 门禁；`install`（prose 桩，按仓）与 `link`（PATH shim，按机器）职责分离，`install` 不越权写机器级 PATH；历史证据（`handoffs/`、`receipts/`、`reviews/`、`AUDIT-*`、`PROPOSAL-*`）里的全路径写法按纪律不回改。
>     - **验收**：`node --check` OK；`handoff link` 建成 `~/.local/bin/handoff` → 中央引擎并实跑验证通过；裸 `handoff status` 在 hub 根 / 消费方仓（Prospero，跨仓回退）/ 中立目录（/tmp）全部可用；`link` 重跑幂等（`↩️ 已是最新`）；**失效注入**：`link --remove` 后 `check` exit 1 报 `[CLI] 裸 handoff 命令不在 PATH … → 自愈: node …/handoff.mjs link`，恢复后回绿；hub 5 载体 `install` 刷新 + 新 sha 落位；lab Hub `check` 唯一失败项为**存量**孤儿回执 `audit-20261018-03-task-resp.md`（Tappy 仓内回执误落 lab Hub，2026-10-18 21:55 早于本批，待 Tappy 侧自纠，与本批无关）。

> 18. **v2.12.5 变更（2026-10-21 · 接入桩「状态语义」纠错 + `draft` 可直达回执 + 仓内状态标签分区 · 动 STUB_BODY ⇒ 载体须重跑 install）**：
>     - **动因（`PROBLEM-2026-10-21-draft-forwarded-blacklisted-in-stub.md`，已逐行核实）**：接入桩早拦条「只认「进行中」：`closed/accepted/rejected/draft/forwarded` 一律不处理」与 README v2.7（`draft`+`forwarded` 都入 pending、**严禁据此判不处理**）**逐字相悖**；同仓 `workspace=same` 新单天生停在 `draft`（`cmdNewIntra` 写死、same 免 `forward`）⇒ 桩把**每个新单拉黑**——Tappy 审计单「执行方只读不执行」的机器根因（B 窗口把「该我做」外推给「另一个 lane 主体」，而同仓 lane 只是可分饰标签）。同族实证 `SWOOP-20260904-02`（用户直接递文档不跑 forward 被误判不归我管）。另：「进行中」三处三个集合（status 表头=全部未闭环 / README pending=draft+forwarded / 桩=仅 received）。
>     - **P0 桩纠错（`STUB_BODY`）**：删拉黑条 → 改写**状态语义唯一定义**（「进行中」= 未闭环且归属当前方；**待办 = `draft` + `forwarded`**，含驳回退回的返工单；`received` = 执行方跳过、发起方审计；`closed` 不处理；**`accepted`/`rejected` 为废止状态、删幽灵词**——现行状态机只有 draft/forwarded/received/closed）；出站 `forward` 步标注「可选事后标记，仓内 same 可跳过」；入站第 1 步改 `handoff status --for <本方 lane|target>`、第 2 步改「从待办（draft/forwarded）筛选」；preflight status 行加 `--for` 认领入口。**⇒ `STUB_SHA` `3dc5e83a` → `f7ee154b`，20 载体须重跑 `handoff install`（hub 侧 5 载体已刷新；下游 5 仓由用户在各仓根执行）。**
>     - **P0 `cmdReceipt` 放开 `draft`**：旧无条件拒（「尚未 forward，不能回执」exit 1）把 v2.7 明文场景「用户直接递文档、不跑 forward」的执行方挡在最后一步、被迫替发起方跑 forward（假章），且与 `cmdSync` 一直放行 `draft → received` 互相矛盾；现 draft/forwarded → received，draft 分支打 ℹ️「发起方未跑可选标记 forward → 直接登记回执」。
>     - **P1 `cmdReject` draft 文案**：由「尚未 forward，不能驳回」改为「尚无登记回执（received），不能驳回」（检测到回执文件时附「先 `handoff receipt` 登记」指引）——驳回的前置本就是「已有回执可审计」，与 forward 无关。
>     - **P1-b 仓内状态标签分区（`handoff-status.mjs`）**：`STATUS_LABEL` 按 MODE 分档——仓内 `draft`/`forwarded` 渲染**「待执行」**（原「待转递 / 已转递」是跨仓口吻，读作『已发出去、有人接手了』，误导执行 lane 不动工）；仓内中央视图两态**合并一桶**（防连出两个同名标题）且每项「下一步」带 `读 handoffs/<id>.md 开工 → 写 receipts/<id>-resp.md` 动作；**跨仓标签、中央分桶、`--json` v1/v2 全部逐字节不变**（改动前后 5 视图 diff 实测 IDENTICAL）。
>     - **P1 `cmdBrief` 收 `draft`+`forwarded`**：原仅 `draft`——按 new→forward→brief 顺序跑会拿到空收件箱、驳回退回（forwarded）的返工单从收件箱消失；空态文案同步「status=draft/forwarded」。
>     - **P1 `check` 待执行滞留提示（`reportStalePending`，跨仓 + 仓内、非阻断）**：`draft`/`forwarded` 且 `created` 距今 ≥7 天逐条列出（`created` 取发起方时间戳）——给「只读不执行零红灯」补可见性信号；阈值与呈现对齐 `reportSize` / `reportMissingReceiptPrompt` 既有非阻断纪律（存量历史 draft 不会把 check 打红）。
>     - **文档**：README（头部版本 + v2.12.5 变更段 + 状态机「forward 可选」注 + 「进行中/待办」唯一定义引块 + Source of Truth 链注 + 冷启动协议补「**lane 是可分饰标签，不是另一个 Agent**」+ op 表 status/receipt/forward/brief 四行）、`AGENT-GUIDE.md`（铁律下加唯一定义引块；preflight / 入站 / 出站 / 失败兜底「进行中」→「待办」措辞并列明 received/closed 处置）、`COMMANDS.md`（版本 + forward/receipt/status 三行 + 脚注）、`DESIGN.md`（基线 + 版本表行）。**桩拉黑条措辞仅存于 README v2.12.5 变更段的历史描述里，活规则处零残留（grep 实测）。**
>     - **边界**：不改状态机（仍 draft/forwarded/received/closed）、不改命名、`--json` schema 不动、evidence / 回执内容门禁不动；`forward` 命令本身不改（仍写 forwarded，仅标注可选）；跨仓行为除 receipt-draft / reject 文案 / brief 收集范围外逐字保留；存量交接与回执不回改；`accepted`/`rejected` 仅从桩与文档措辞删除（代码中本就不存在）；滞留提示只打印不改 exit code。
>     - **验收**：`node --check` 两文件 OK。**沙箱 intra**（`init` → `new` → status 出「待执行」桶 + 动作化 nextStep → `--for audit` → **draft 直收 receipt exit 0（ℹ️ + draft→received）** → `reject` 返工后回「待执行」桶 → draft 直接 `reject` 出新文案 exit 1 → backdate 后 `check` exit 0 + ⏳ 1 项）全 PASS；**沙箱 cross**（复制引擎到临时目录：`new` → `brief` 收 draft → `forward` 后 `brief` 仍收 → **draft 直收 receipt exit 0** → `-n` 合规回执 `check` exit 0 + ⏳ 1 项 → draft `reject` 新文案 → status 标签仍「待转递/已转递」）全 PASS。**真实 lab Hub**：`install` 刷新 5 载体（`STUB_SHA f7ee154b`、v2.12.5 落位、拉黑条清除）+ **`check` exit 0（118/115；⏳ 滞留真实命中 3 项：`SWOOP-20260922-01-bug` 29 天 draft、`COREML-20261012-01-question` 与 `IGGLE-20261012-01-feature` 9 天，非阻断）** + 跨仓 status 5 视图（status / --for swoop / --for tappy / --json / --json=v2）与改动前基线**逐字节 IDENTICAL**。


