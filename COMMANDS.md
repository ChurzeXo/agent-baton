# Handoff Hub 命令手册

> 契约 **v2.15.0** 配套文档（支持后台监听 `handoff wait` · 复合原子命令 `forward --wait` · 仓内免转递提示词减负 · 跨仓与同仓多窗口协同）。所有涉及**交接、回执、验收**的命令全收录于此；**命令行为以 `handoff -h` 与引擎为准**，本文件为速查。
> 细则以 `README.md` 为准（跨仓 + **仓内模式**）；本文件只管「怎么敲命令」。

---

## 一、斜杠命令（**已废弃** · 2026-09-10）

旧 `/handoff` `/outbox` `/inbox` `/receipt` `/sync` 别名已废除：`handoff install` 不再安装它们（脚本不再写 / 命令触发文件），历史已装触发文件已删除。**不建议新用**——一律改「散文触发 + Path 定向」。所有能力收敛到 `handoff` CLI（`handoff <子命令>`，PATH shim → 中央引擎，由 `handoff link` 幂等管理）+ `handoff` 技能。

| 旧 / 别名 | 新用法（散文） |
|-----------|----------------|
| `/inbox` | 你说「请 <方> 收交接 / 处理交接 `handoffs/<ID>.md`」→ Agent 跑 `handoff status --for <target>` + 读交接收执（请收交接=新式 v2.8.3） |
| `/sync` | 你说「请收 <方> 回执 / 登记回执 / 收回执 `receipts/<ID>-resp.md`」→ `handoff sync` + `handoff status` |
| `/receipt` | 执行方写 `receipts/<ID>-resp.md` 后把路径交回发送方登记 |
| `/outbox` | 你说「建交接 <target> <type> <标题>」→ `handoff new` + 填正文 |
| `/handoff` | 直接跑下方 CLI op，或问 Agent |

> **发现待办一律 `status --for <target>`**，不读 inbox 快照、不扫描 `handoffs/`（inbox 是可能过期的快照）。

---

## 二、CLI 子命令全集

统一入口：`handoff <子命令>`（PATH shim → 中央引擎 `~/Documents/lab/handoffs/handoff.mjs`，由 `handoff link` 幂等管理；兜底/自愈全路径 `node ~/Documents/lab/handoffs/handoff.mjs <子命令>`）
参数约定：target = `swoop` | `prospero` | `iggle` | `coreml` | `tappy` | `yiqiyihuihua`；type = `bug` | `feature` | `breaking` | `question`。
> 前缀 = 接收方 = 回执撰写方：`swoop`/`prospero`/`coreml`/`tappy`/`yiqiyihuihua` = iggle 发出的交接（依赖方写回执）；`iggle` = Swoop→iggle 反向发现（iggle 为接收方、写回执）。详见 `README.md` 路由规则。

### iggle 侧（写交接 → 转递 → 验收闭环）

| 子命令 | 用法示例 | 作用 | 时机 |
|--------|----------|------|------|
| `new` | `new swoop bug 创作者中心 profile 缺失` | 创建交接：自动生成 `<ID>` + frontmatter + 骨架正文，状态 `draft` | 发现需依赖方改动时 |
| `forward` | `forward SWOOP-20260822-02-bug [--wait]` | 标记已转递（带 `--wait` 直接切入后台监听，一条命令完成转递+输出提示词+挂起待机） | 填写正文后转出并待机 |
| `brief` | `brief` 或 `brief swoop` | 生成各依赖方收件箱 `inbox/<target>.md`（轻量快照 + 转递话术，供人工 / 不支持 CLI 的工具用） | 转递前 |
| `prompt` | `prompt <ID>` | 输出单份详版转递提示词（复制给依赖方 Agent） | 需要单份详版时 |
| `wait` | `wait <ID> [--timeout 30m]` | **后台监听回执**：挂起等待回执生成，收到回执自动 Exit 0 唤醒发起方/审计方进入实测闭环（支持跨仓与同仓多窗口协同） | 产出提示词后挂起等待 |
| `sync` | `sync` | 扫 `receipts/` 自动登记回执（draft/forwarded → received，含 needs_iggle_change），iggle 侧收回执主入口 | 回执到达后 |
| `close` | `close <ID> -n "已核实源码+tsc零错"` | **验收闭环**（received → closed）：结论写入交接「验收记录」节；无 `-n` 拒绝执行 | 核实通过后 |
| `check` | `check` | 全库合规体检：命名/frontmatter/状态机/孤儿回执/验收记录。exit 0 = 通过 | **任务收尾硬门禁** |
| `status` | `status [--for <target>] [--json\|--json=v2]` | 未闭环摘要；依赖方用 `status --for <target>` 实时发现待办（**勿读 inbox**、**勿扫描 handoffs/**） | 随时 |
| `show` | `show <ID>` | **triage 摘要**：frontmatter + 节标题 + 首行，不 dump 全文；支持 handoffs/ 与 receipts/-resp | 处理前先看一眼 |
| `open` | `open <ID>` | 编辑器打开交接文档 | 查看 |
| `install` | `install`（`--global` / `--project` / `--no-readme`） | 只装 prose 接入桩进各工具指令文件（幂等；不再写 / 别名；`--no-readme` 不写 cwd README） | 新工具接入 / 契约升版后 |
| `link` | `link`（`--remove`） | 把中央引擎以 `handoff` 之名接入 PATH（幂等；报 `command not found: handoff` 时跑它自愈） | 新机器 / shim 丢失 / 指向错乱时 |
| `receipt` | `receipt <ID> [--needs-change]` | 手动登记单份回执（draft/forwarded 均可登记，v2.12.5 起 draft 直达 received；日常被 `sync` 取代，保留兜底） | sync 异常时 |

### Swoop / Prospero 侧（收交接 → 写回执）

依赖方 Agent **不跑任何变更命令**（只读 + 写回执），标准动作：

| 动作 | 方式 |
|------|------|
| 看待办（实时） | `handoff status --for <target>`（shim 即中央引擎，只读；等效 `node ~/Documents/lab/handoffs/handoff-status.mjs --for <target>`）——**勿读 `inbox/<target>.md`**（可能过期）或扫描 `handoffs/` |
| 读交接 | 只读上一步返回的 pending 交接：`Read ~/Documents/lab/handoffs/handoffs/<ID>.md` |
| 写回执 | 按 `~/Documents/lab/handoffs/RESPONSE-TEMPLATE.md` 写到 `~/Documents/lab/handoffs/receipts/<ID>-resp.md` |
| 查状态（只读） | `node ~/Documents/lab/handoffs/handoff-status.mjs --for <target>` |

**红线**：不翻状态、不做验收、不动交接 frontmatter——登记与闭环是 iggle 侧职责。

### 仓内模式（intra-repo · 项目内 `.handoffs/`）

引擎自动从 cwd 上溯 `.handoffs/.handoff-hub.json` 切模式；命令形状不变，**target 换成 lane**。

| 子命令 | 用法示例 | 作用 |
|--------|----------|------|
| `init` | `init`（在项目根） | 建 `.handoffs/` 子 Hub + `.handoff-hub.json`（lanes / types / workspace_default / close_policy） |
| `status` | `status` / `status --for <lane>` | 裸 `status` = 全项目未闭环（**新窗口冷启动第一跑**）；`--for` = 某 lane 待办；`draft`/`forwarded` 显示「待执行」（v2.12.5，跨仓才叫「待转递/已转递」） |
| `new` | `new audit task "<标题>"` | 建仓内交接 `<TO_LANE>-<YYYYMMDD>-<NN>-<TYPE>`；type ∈ `task\|bug\|feature\|question\|continuation` |
| `import` | `import` | （迁移用）把旧仓内交接导入为子 Hub 可见项 |

> 仓内 frontmatter 用 `from_lane`/`to_lane`/`workspace`；`workspace=same` 免**任务转递**（不搬工作树；但**回执交付行仍须写**，见 README §转递提示词）（定归属只读 frontmatter，禁 mtime 推断）。lane 名不得与跨仓 TARGET 撞名。

---

## 三、生命周期速查（谁在何时敲什么）

```
【iggle】                    【用户】                        【Swoop/Prospero】
发现需依赖方改动
  └─ new swoop bug <标题>
填写正文（只 Edit 正文，
  frontmatter 不碰）
                                   ┌─ brief ──→ 收件箱+话术 ─┐
                                   │  复制话术发给对方 Agent  │
                                   ▼                         ▼
                             forward <ID>              status --for <target>
                                                             │ 读返回的 pending
                                                             ▼ 修复
回执到达 ◄──────────────────── 用户带回执路径 ──── 写 receipts/<ID>-resp.md
  └─ sync          （自动翻 received）
核实源码改动 + 本仓适配
  └─ close <ID> -n "<验收结论>"   （自动写「验收记录」节）
  └─ check   ← exit 0 = 任务完成
```

## 四、常见场景配方

| 场景 | 命令序列 |
|------|----------|
| 提交一个新问题给 Swoop | `new swoop bug <标题>` → 填正文 → `brief` → 把话术粘给 Swoop → `forward <ID>` |
| 依赖方发现自己的待办 | `status --for swoop`（实时，勿读 inbox） |
| 收回执并闭环 | `sync` → 核实 → `close <ID> -n "<结论>"` → `check` |
| 让依赖方处理积压 | `brief` → 分别把两条固定转递话术（交接收件路径）粘给 Swoop / Prospero |
| 不知道现在有什么没闭环（iggle 视角） | `status` |
| 换新 AI 工具接入 | `install`（幂等，只装 prose 接入桩） |
| 处理前先看单份交接讲什么 | `show <ID>`（摘要，不 dump 全文） |
| 怀疑账本坏了 | `check`，按输出逐项修复 |

---

*契约版本 v2.12.5（2026-10-21：接入桩「状态语义」纠错——待办 = draft+forwarded；`receipt` 放开 draft 直达 received；仓内状态标签分区「待执行」；`brief` 收 draft+forwarded；`check` 增待执行滞留提示。2026-10-19 热修批次八：`handoff link` 接入 PATH，文档/桩统一裸命令写法，check 增 CLI 可达性门禁；v2.8 起 / 命令废弃，改散文触发 + Path 定向）· 改命令先改 `handoff.mjs`，再同步本文件与 `README.md`*
