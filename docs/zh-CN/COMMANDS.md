# Agent Baton CLI 命令手册

> `agent-baton` (`baton`) 完整命令行与生命周期速查手册。
> 向后兼容别名：`handoff <command>`。

---

## 1. 核心状态机生命周期

Baton 的生命周期严格经历以下 4 个确定性状态：

```
[draft] ──(baton forward)──> [forwarded] ──(baton receipt)──> [received] ──(baton accept)──> [closed]
                                 │                                 │
                                 └──(0-Token 挂起)                 └──(baton reject)──> [forwarded]
```

---

## 2. CLI 常用命令一览

### `baton init`
初始化交接 Hub。
```bash
# 仓内模式（默认，在当前代码库下创建 .handoffs/ 目录与配置）
baton init [--lanes <lane1,lane2>] [--root <dir>]

# 跨仓模式（创建一个中立的独立中心调度 Hub）
baton init --cross [--targets <target1,target2>] [--root <dir>]
```

### `baton status`
巡检当前中枢内的交接状态与待办事项。
```bash
# 全局未闭环任务大盘
baton status

# 直取本方待办（按角色或目标仓过滤）
baton status --for <lane|target>

# 渲染实时 Mermaid 关系流向拓扑图
baton status --mermaid

# 机器可读的 JSON 结构化输出
baton status --json
```

### `baton new`
创建一份新的结构化交接单。
```bash
# 语法: baton new <target|lane> <type> "<标题>"
baton new audit task "重构用户认证鉴权模块"
baton new api feature "实现接口限流中间件"
```
*支持的类型*: `task`, `bug`, `feature`, `question`, `continuation`。

### `baton forward`
标记转递给接收方，支持双盲脱敏与后台自动挂起等待。
```bash
# 转递并切入 0-Token 后台等待（带双盲脱敏）
baton forward <id> --blind --wait

# 常用参数:
#   --blind    物理清洗交接单中的 <thinking> 思维链与主观辩解
#   --wait     进入后台事件监听，回执到达后自动唤醒会话（Exit 0）
#   --timeout  等待超时时限（如 30m, 1h；默认 30m）
```

### `baton wait`
专职后台 0-Token 事件监听命令（基于 OS `fs.watch`）。
```bash
baton wait <id> [--timeout 30m]
```

### `baton prompt`
生成标准可复制的接单提示词，供人类用户在多会话/多窗口间一键流转。
```bash
baton prompt <id>
```

### `baton receipt`
登记执行回执并将状态推进至 `received`。
```bash
baton receipt <id> \
  --evidence-paths "<file1,file2>" \
  --evidence-commits "<commit-sha>" \
  [--audit-nonce "<nonce>"] \
  [-n "<回执正文 Markdown>"]
```
*门禁防线*:
- `--evidence-paths`: 必须在本地硬盘真实存在；
- `--evidence-commits`: 必须在 Git 历史中真实存在（`git cat-file -e` 校验）；
- `--audit-nonce`: 当交接接收方为 `audit` 时必须提供，防同一窗口自签。

### `baton accept`
验收回执，核验证据无误后闭环（`status: closed`）。
```bash
baton accept <id> -n "<验收结论>"
```

### `baton reject`
驳回回执，将状态退回 `forwarded` 要求执行方继续修改。
```bash
baton reject <id> -n "<驳回理由>"
```

### `baton check`
全库合规体检，核验所有状态机、evidence 凭证与正文规范。
```bash
baton check
```

### `baton install`
幂等写入/刷新项目中指令文件（`AGENTS.md`、`CLAUDE.md`、`GEMINI.md`、`README.md`）中的早拦接入桩。
```bash
baton install [--project] [--global]
```

### `baton link`
自愈命令，确保 `baton`、`agent-baton` 和 `handoff` 正确软链至系统 PATH（`~/.local/bin/`）。
```bash
baton link [--remove]
```

### `baton throttle`
使用三级中断节流管道包装后台执行命令，阻断日志刷屏对人类与主控上下文的注意力劫持。
```bash
baton throttle <id> [--quiet] [--timeout <ms>] -- <command>
```
*三级中断机制*：
- 🟢 **绿灯流（常规输出）**：直接静默落盘至 `.handoffs/logs/<id>.throttle.log`。
- 🟡 **黄灯流（告警重试）**：抑制刷屏，保留轻量聚合计数器。
- 🔴 **红灯流（致命崩溃）**：突破静默屏障，即时中断并向主控 Agent 发送高优先级告警。
