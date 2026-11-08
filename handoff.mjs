#!/usr/bin/env node
// Handoff Hub CLI —— 交接枢纽**引擎**（无 / 命令；散文触发：用户说「请 <方> 收交接 <Path>」或「处理交接 <Path>」，Agent 按 Path + 意图路由到对应 op）。
// 子命令（`handoff <子命令>` = PATH shim 指向本文件；兜底/自愈 `node handoff.mjs <子命令>` / `node handoff.mjs link`）：
//   handoff new <target> <type> <标题...>       创建交接（自动生成 <ID> + frontmatter + 骨架）
//   handoff status [--json]                      查看未闭环摘要（委托 handoff-status.mjs）
//   handoff accept <id> -n "<验收结论>"           审计闭环：received → closed（close 为同义别名）
//   handoff reject <id> -n "<驳回理由>"           审计驳回：received → forwarded 退回继续改
//   handoff receipt <id> [-n "<回执正文>"] [--needs-change]   登记回执并把交接翻成 received（-n 即回执正文，落盘）
//   handoff forward <id>                         标记已转递（你已发给依赖方）
//   handoff open <id>                            在 macOS 默认编辑器打开交接文件
//   handoff show <id>                            triage 视图：frontmatter + 节标题 + 首行（不 dump 全文）
//   handoff wait <id> [--timeout <dur>]          后台监听回执到达（支持跨仓与同仓多窗口，收到回执 Exit 0 唤醒）
//
// 契约 v2.10「先查状态」门禁：receipt/accept/reject 前须在同一 hub 内跑过 handoff status
// （默认 60 分钟窗口；豁免 HANDOFF_STATUS_GATE=off，调整 HANDOFF_STATUS_WINDOW_MIN=<分钟>）。
// 回执正文：receipt -n "<回执>" 会落盘为正文；check 对契约生效日后的回执做正文要素校验。
//
// 根目录由脚本自身位置推导，整个 hub 目录可整体移动而不失灵。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';

const SCRIPT_ROOT = path.dirname(fileURLToPath(import.meta.url));

// ── 作用域根解析（仓内模式 ⊃ 同工作区，提案 PROPOSAL-2026-10-09-intra-repo-mode.md）──
// 模式由「解析到的根」推断：命中 `.handoff-hub.json` ⇒ 仓内模式（intra-repo）；否则回退 lab Hub（cross）。
// 关键不变量：当前全网没有任何 `.handoff-hub.json` 存在 ⇒ resolveRoot 恒回退 lab Hub，跨仓行为逐字不变。
function loadHubConfig(root) {
  const p = path.join(root, '.handoff-hub.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { console.error(`解析 .handoff-hub.json 失败: ${p}\n${e.message}`); process.exit(2); }
}
function flagValue(args, name) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name && args[i + 1]) return args[i + 1];
    if (args[i].startsWith(name + '=')) return args[i].slice(name.length + 1);
  }
  return undefined;
}
function resolveRoot(args) {
  // 1. 显式 --root <path> / --root=<path>（须含 .handoff-hub.json）
  const rv = flagValue(args, '--root');
  if (rv) {
    const cfg = loadHubConfig(rv);
    if (!cfg) { console.error(`--root 指定的目录不含 .handoff-hub.json，不是合法仓内子 Hub: ${rv}`); process.exit(2); }
    return { root: rv, mode: 'intra-repo', config: cfg };
  }
  // 2. 环境变量 BATON_ROOT / HANDOFF_ROOT（CI / 脚本用）
  const envRoot = process.env.BATON_ROOT || process.env.HANDOFF_ROOT;
  if (envRoot) {
    const cfg = loadHubConfig(envRoot);
    if (cfg) return { root: envRoot, mode: 'intra-repo', config: cfg };
  }
  // 3. 从 cwd 逐级上溯，找含 .handoff-hub.json 的目录 ⇒ 仓内模式
  //    子 Hub 默认在 `<repo>/.handoffs/`（含 .handoff-hub.json），故同时查 `dir/.handoff-hub.json` 与 `dir/.handoffs/.handoff-hub.json`。
  let dir = process.cwd();
  for (;;) {
    const nested = path.join(dir, '.handoffs', '.handoff-hub.json');
    if (fs.existsSync(nested)) return { root: path.join(dir, '.handoffs'), mode: 'intra-repo', config: loadHubConfig(path.join(dir, '.handoffs')) };
    const direct = path.join(dir, '.handoff-hub.json');
    if (fs.existsSync(direct)) return { root: dir, mode: 'intra-repo', config: loadHubConfig(dir) };
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // 4. 都不命中 ⇒ 回退 lab Hub（跨仓模式）
  return { root: SCRIPT_ROOT, mode: 'cross', config: loadHubConfig(SCRIPT_ROOT) };
}

const R = resolveRoot(process.argv.slice(2));
const ROOT = R.root;
const MODE = R.mode;
const HUB_CONFIG = R.config;
const H_DIR = path.join(ROOT, 'handoffs');
const R_DIR = path.join(ROOT, 'receipts');
const STATUS_JS = path.join(SCRIPT_ROOT, 'handoff-status.mjs');

// ── 「先查状态」前置门禁（契约 v2.10）────────────────────────────────────────
// 病根：提示词写了「动手前必先 handoff status」，但那只是自律，无机制。agent 新窗口
// 直接对某 ID 跑 receipt/accept/reject 时，CLI 一律放行——「忘了先查状态」由此发生。
// 治法：status 跑过即落一个时间戳；写动作（receipt/accept/reject）前校验该戳在窗口内，否则拒绝。
// 为什么戳存 tmpdir 而非 ROOT：仓内模式的 ROOT 是随代码提交的 .handoffs/，写戳会污染仓库工作树；
// 按 ROOT 哈希分文件，多 hub 互不干扰。为什么默认 60 分钟：覆盖「查状态 → 干活 → 回执」的常规会话；
// 长任务请在动手前重跑一次 status（廉价、幂等），或显式放宽窗口。
const STATUS_STAMP = path.join(
  os.tmpdir(),
  'handoff-last-status-' + crypto.createHash('sha1').update(ROOT).digest('hex').slice(0, 12) + '.json',
);
const STATUS_WINDOW_MIN = (() => {
  const v = parseInt(process.env.HANDOFF_STATUS_WINDOW_MIN || '', 10);
  return Number.isFinite(v) && v > 0 ? v : 60;
})();
function recordStatusSeen() {
  try { fs.writeFileSync(STATUS_STAMP, JSON.stringify({ ts: Date.now(), mode: MODE, root: ROOT }), 'utf8'); } catch { /* 戳写失败不阻断 status 本身 */ }
}
/** 写动作前置断言：无新鲜 status 戳即拒绝（可用 HANDOFF_STATUS_GATE=off 豁免）。 */
function assertStatusFresh(op) {
  if (process.env.HANDOFF_STATUS_GATE === 'off') return;
  let ts = NaN;
  try { ts = Number(JSON.parse(fs.readFileSync(STATUS_STAMP, 'utf8')).ts); } catch { /* 无戳 = 从未跑 */ }
  const ageMin = Number.isFinite(ts) ? (Date.now() - ts) / 60000 : Infinity;
  if (ageMin <= STATUS_WINDOW_MIN) return;
  // 长任务收尾宽容自愈（Auto-Refresh on Fresh Op）：
  // 若执行方会话之前确实执行过 status（isFinite(ts)），仅因任务深度编码/长自测导致超过窗口（如 > 60m）：
  // 在执行收尾性质操作（receipt/deliver）时，自动为其续期一次快照时间戳，避免长任务收尾被粗暴打断。
  if (Number.isFinite(ts) && (op === 'receipt' || op === 'deliver')) {
    recordStatusSeen();
    console.log(`ℹ️ [状态快照自动续期] 最近一次 status 查验在 ${Math.round(ageMin)} 分钟前（超过 ${STATUS_WINDOW_MIN} 分钟），已为当前 ${op} 操作自动续期。`);
    return;
  }
  const seen = Number.isFinite(ts) ? `最近一次在 ${Math.round(ageMin)} 分钟前跑过` : '本会话从未跑过';
  console.error(`❌ 「先查状态」前置门禁未过：执行 ${op} 前必须先看「进行中」清单（${seen} handoff status，要求 ${STATUS_WINDOW_MIN} 分钟内）。`);
  console.error(`   请先执行:  node ${path.join(SCRIPT_ROOT, 'handoff.mjs')} status`);
  console.error(`   （豁免：HANDOFF_STATUS_GATE=off；调整窗口：HANDOFF_STATUS_WINDOW_MIN=<分钟>）`);
  process.exit(1);
}
function ensureTrailingNewline(s) { return /\n$/.test(s) ? s : s + '\n'; }

const TARGETS = new Set(
  HUB_CONFIG && Array.isArray(HUB_CONFIG.targets) && HUB_CONFIG.targets.length
    ? HUB_CONFIG.targets.map(s => String(s).toLowerCase())
    : ['frontend', 'backend', 'mobile', 'audit']
);
const TARGET_LABELS = {
  frontend: 'Frontend Web',
  backend: 'Backend API',
  mobile: 'Mobile Client',
  audit: 'Security & Audit',
  ...(HUB_CONFIG && HUB_CONFIG.target_labels ? HUB_CONFIG.target_labels : {})
};
const TYPES = new Set(['bug', 'feature', 'breaking', 'question']);
// 仓内模式类型（提案 §5.1）：task/bug/feature/question/continuation（continuation = 续接新窗口，后继会话闭环）
const INTRA_TYPES = new Set(['task', 'bug', 'feature', 'question', 'continuation']);
const INTRA_ID_RE = /^([A-Za-z0-9_-]+)-\d{8}-\d{2}-(task|bug|feature|question|continuation)\.md$/;
const INTRA_RESP_RE = /^[A-Za-z0-9_-]+-\d{8}-\d{2}-(task|bug|feature|question|continuation)-resp\.md$/;

// ── 语言与国际化侦测（Locale & i18n Detection）───────────────────────────
function detectLang() {
  if (process.env.BATON_LANG || process.env.HANDOFF_LANG) {
    const l = (process.env.BATON_LANG || process.env.HANDOFF_LANG).toLowerCase();
    return l.startsWith('zh') ? 'zh' : 'en';
  }
  if (HUB_CONFIG && (HUB_CONFIG.locale || HUB_CONFIG.lang)) {
    return String(HUB_CONFIG.locale || HUB_CONFIG.lang).toLowerCase().startsWith('zh') ? 'zh' : 'en';
  }
  const allLabels = [
    ...Object.values((HUB_CONFIG && (HUB_CONFIG.lane_labels || HUB_CONFIG.lane_roles)) || {}),
    ...Object.values((HUB_CONFIG && HUB_CONFIG.target_labels) || {})
  ];
  if (allLabels.some(r => /[\u4e00-\u9fa5]/.test(String(r)))) {
    return 'zh';
  }
  const envLang = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '';
  if (envLang.toLowerCase().startsWith('zh')) {
    return 'zh';
  }
  // 检查当前工程主指令文件（AGENTS.md / CLAUDE.md / README.md）是否包含中文语料
  for (const f of ['AGENTS.md', 'CLAUDE.md', 'README.md']) {
    try {
      const p = path.join(process.cwd(), f);
      if (fs.existsSync(p)) {
        const head = fs.readFileSync(p, 'utf8').slice(0, 3000);
        if (/[\u4e00-\u9fa5]/.test(head)) return 'zh';
      }
    } catch {}
  }
  return 'en';
}

const DEFAULT_LANE_ROLES_ZH = {
  impl: '实现方',
  audit: '审计方',
  arch: '架构设计方',
  design: '架构设计方',
};

const DEFAULT_LANE_ROLES_EN = {
  impl: 'Implementation',
  audit: 'Audit',
  arch: 'Architecture',
  design: 'Architecture',
};

// ── 仓内 lane → 自然工程师角色（Lane Identifier → Engineer Role · v2.13）────────
// 同仓提示词严禁把项目名 / lane slug 当成沟通角色（如「请 Tappy 收交接」「请 impl lane 收交接」）。
// 一律用自然角色表达：默认映射 + .handoff-hub.json 的 lane_labels 显式覆盖，缺省回退默认映射。
const DEFAULT_LANE_ROLES = {
  impl: '实现方',
  audit: '审计方',
  arch: '架构设计方',
  design: '架构设计方',
};
/** 解析 lane 的自然角色名：.handoff-hub.json 的 lane_labels 优先，否则默认映射；未知 lane 原样回退 slug。 */
function resolveLaneRole(lane) {
  const l = String(lane || '').toLowerCase();
  if (!l) return '';
  const cfg = (HUB_CONFIG && HUB_CONFIG.lane_labels) || null;
  if (cfg && Object.prototype.hasOwnProperty.call(cfg, l) && cfg[l]) return String(cfg[l]);
  const defaultRoles = detectLang() === 'zh' ? DEFAULT_LANE_ROLES_ZH : DEFAULT_LANE_ROLES_EN;
  if (defaultRoles[l]) return defaultRoles[l];
  return lane; // 未知 lane：slug 仍可用，不臆造角色
}

/** 判定是否处于 AI Agent 托管环境中（用于决定是进程树托管等待还是 OS 孤儿脱钩）。
 *
 * 核心原理：
 * 1. AI 客户端（如 Google Antigravity、Claude Code、Cursor、Windsurf 等）通过托管子进程树
 *    （Managed Subprocess / Background Task）实现长任务挂起与 Exit 0 零 Token 反应式唤醒。
 * 2. 在 Agent 宿主环境中执行 detached+unref 脱钩会导致宿主误判任务结束、丢失进程树句柄且无法唤醒。
 * 3. 探针按环境变量与管道特征智能感知宿主，支持 BATON_MANAGED_MODE 强行指定（1=托管, 0=脱钩）。
 */
function isAgentEnvironment() {
  if (process.env.BATON_MANAGED_MODE === '0') return false;
  if (process.env.BATON_MANAGED_MODE === '1') return true;
  return Boolean(
    process.env.ANTIGRAVITY_AGENT ||
    process.env.CLAUDE_CODE ||
    process.env.CURSOR_AGENT ||
    process.env.WORKBUDDY_AGENT ||
    process.env.AI_AGENT ||
    process.env.CONTINUE_GLOBAL_DIR ||
    process.env.WINDSURF_AGENT ||
    (!process.stdout.isTTY && !process.env.BATON_DAEMON)
  );
}

/** 当地日期（不是 UTC）。
 *
 * 为什么必须按当地日期：原实现用 `new Date().toISOString()`（UTC），
 * 在 UTC+8 的 00:00–08:00 之间操作会被记成**前一天**——
 * 实测：当地 2026-08-31 07:20 跑 `close`，`closed` 被写成 `2026-08-30`，
 * 交接看起来像「当天创建当天闭环」。交接日期是溯源依据，错了就是错了。 */
/** 交接正文骨架（精简版 · 契约 v2.6）。
 *
 * 为什么砍掉「现象/最小复现/预期vs实际/根因证据/影响面/UI耦合」那一大串：
 * 那些节会把背景与论证吸进交接正文，实测长到 240 行 / 14KB —— 任何会话打开它都要
 * 先吞掉上万 token，而其中大半是「为什么这么做」的论证，不是「要做什么」的规格。
 * 论证归 reviews/，交接只留可执行的规格 + 机器可判的验收判据 + 外链。 */
/** 回执正文骨架 —— 已「去骨架化」（契约 v2.10）。
 *
 * 病根：CLI 曾内嵌 R_BODY（状态 / 改动 / 非显然决策 / 实测值 / 验证 / 部署提示 / 外链），与声明的
 * 唯一源 RESPONSE-TEMPLATE.md（关联 / 修复状态 / 根因确认 / 实际改动 / 影响面 / 验证 / 版本·commit /
 * 部署提示 / 转递提示词）节名不一致——同一份「回执长什么样」两处维护，必然漂移
 * （DESIGN.md:27/43「回执规范唯一源 = RESPONSE-TEMPLATE.md」；CHANGELOG v2.8 已把「CLI 模板与
 * RESPONSE-TEMPLATE 双份维护」列为病根）。另 v2.6 精简骨架还硬编了「需 iggle 改动」，非 iggle 发起方会串味。
 * 治法：CLI 只落**指针桩**——正文细则一律以唯一来源为准，桩内仅保留机器可判的锚节（修复状态 / 结论），
 * 供 check 判「回执已开写」。不再复制任何节定义与写法指引。 */
function receiptStub(id, authorLabel) {
  return `
# 回执：<主题>（${authorLabel}）

> 正文按 **RESPONSE-TEMPLATE.md** 撰写（回执规范唯一来源）；本文件仅占位，勿当完整规范。
> 落点：receipts/${id}-resp.md
> check 硬校验锚：非空正文 + 含 ## 节 + 「修复状态 / 结论」锚节 + 「## 转递提示词」节（v2.11）。

## 修复状态
（待填：✅ 已修复 / 🟡 部分修复 / ⚪ 无法复现 / ⛔ 设计如此 / 🔁 转为需求 · 是否需发起方改动：是/否）

## 结论
（待填：一句话结论）
`;
}

/** 仓内回执骨架 —— 同样去骨架化（契约 v2.10）。
 *
 * 病根：仓内 receipt 原先以**空 body** 落盘（writeFM(rFile, rFm, '')），连骨架都不给——漏节无从察觉；
 * 补骨架时也不得再制造第二份竞争规范（见 receiptStub）。仓内回执按 README「frontmatter 五字段 + 结论」，
 * 故指针桩只留「结论」锚节，正文细则以交接「给执行方」节 + 本仓 .handoffs/README.md 为准。 */
function receiptStubIntra(id, lane) {
  return `
# 回执：<主题>（lane: ${lane || '（未填）'}）

> 正文按交接文档「给执行方」节 + 本仓 .handoffs/README.md 撰写；跨仓规范见 RESPONSE-TEMPLATE.md。
> 落点：receipts/${id}-resp.md
> （v2.15.0 减负：仓内同工作区已有状态机监听与自动唤醒，免写「## 转递提示词」节，登记回执自动唤醒发起方）

## 修复状态
- 状态：✅ 已完成
- 是否需发起方改动：否

## 结论
（待填：一句话结论）

## 验证
（待填：实测命令与结果）
`;
}


/** 回执正文要素校验的生效日（契约 v2.10）。
 *
 * 为什么按日期切存量：check 新增「回执正文要素」硬校验后，2026-10-13 之前的历史回执
 * 大量缺节（且多已闭环）——全量硬校验会让 check 立刻红、把历史证据打成不合规（同 reportSize /
 * reportMissingReceiptPrompt 的存量处理原则：存量是历史，不回改，只约束生效后的新回执）。
 * 为什么 2026-10-13：本校验落地当日；当日及之后新建的回执均须满足「非空 body + 含 ## 节 + 含状态/结论节」。 */
// ── 回执门禁「存量豁免」判定键（AR-F1 / P0 · v2.12.4 热修批次）──────────────────
// 病根：三处门禁原先都以回执**自声明**的 `date` 判存量豁免——而 `date` 属待校验工件自身字段，
// 执行方只要不写 `date`、或写个早于阈值的日期，就能让「正文锚节 / 转递提示词 / evidence」整组
// 豁免：伪回执照样穿过 `accept` 与 `check`。豁免的**本意**是「阈值日**前新建**的回执不回改」，
// 实现却等价于「回执**自称**阈值日前」——自证即循环信任（v2.12.3 立此门禁正是为拦 2026-10-13
// goods-stores 伪回执，该洞使其形同虚设）。
// 治法（fail-closed）：豁免键改取**所属交接的 created**（交接由发起方创建，非执行方自证），
// 并与回执自声明 `date` 取**较晚者**（防「新回执借旧交接洗白」）；交接不可解析时回退回执 `date`；
// 两者皆无或非规范 ISO ⇒ **不豁免、须受检**。
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 取所属交接的创建日（YYYY-MM-DD）；不可解析返回 null。 */
function handoffCreated(id) {
  if (!id) return null;
  try {
    const fm = readFM(fs.readFileSync(path.join(H_DIR, `${id}.md`), 'utf8'));
    const c = fm?.created || fm?.created_at;
    return c ? String(c).slice(0, 10) : null;
  } catch { return null; }
}
/** 门禁生效日 = max(交接 created, 回执 date)；都不可得 ⇒ null（⇒ 不豁免）。 */
function gateDate(fm) {
  const hc = handoffCreated(fm?.handoff_id);
  const rd = fm?.date ? String(fm.date).slice(0, 10) : '';
  const a = ISO_DATE_RE.test(String(hc || '')) ? String(hc) : null;
  const b = ISO_DATE_RE.test(rd) ? rd : null;
  if (a && b) return a > b ? a : b;
  return a || b;
}
/** 存量豁免：仅当生效日是规范 ISO 且严格早于阈值；否则受检（含 null —— fail-closed）。 */
function exemptBy(date, since) {
  return ISO_DATE_RE.test(String(date || '')) && String(date) < since;
}
const RECEIPT_BODY_SINCE = '2026-10-13';
/** 回执正文要素是否达标。唯一源 = RESPONSE-TEMPLATE.md（锚节「修复状态」）；此处兼容仓内「结论」锚节
 *  与历史 v2.6 骨架的「状态」别名——存量回执不回改，只约束契约生效日（RECEIPT_BODY_SINCE）后的新回执。 */
function receiptBodyProblems(raw) {
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, '');
  const problems = [];
  if (!body.trim()) problems.push('正文为空');
  if (!/^##\s+\S/m.test(body)) problems.push('无任何 ## 节');
  if (!/^##\s*(状态|修复状态|结论|Status|Fix Status|Verdict|Conclusion|Implementation Status|Results)/im.test(body)) problems.push('缺状态/结论节（Status / Verdict anchor section missing）');
  return problems;
}
/** check 内对单份回执做正文要素校验（存量豁免：仅契约生效日 RECEIPT_BODY_SINCE 起的回执受硬约束）。 */
function checkReceiptBody(f, fm, raw, problems) {
  const made = gateDate(fm); // AR-F1：不再用回执自声明 date 判豁免
  if (exemptBy(made, RECEIPT_BODY_SINCE)) return;
  for (const p of receiptBodyProblems(raw)) {
    problems.push(`[回执] ${p} — 契约 v2.10 起回执正文须非空且含状态/结论节: ${f}`);
  }
}

/** 回执「转递提示词」节的硬校验生效日（契约 v2.11）。
 *
 * 病根：契约声明「回执规范唯一源 = RESPONSE-TEMPLATE.md」，但 Hub 自己发布的可复制载体
 * （STUB_BLOCK / AGENT-GUIDE 回执模板）漏列「转递提示词」节，且该节长期只由
 * reportMissingReceiptPrompt 非阻断软提示兜底——agent 照抄漏节载体即漏写（同 DESIGN.md:181
 * 「骨架外 = 没有」的事故条件重演）。
 * 治法：把该节与锚节一起升为 check 硬校验；阈值日（RECEIPT_PROMPT_SINCE）起的新回执缺失即
 * exit≠0；存量（阈值日前）豁免，避免历史证据被打成不合规（同 RECEIPT_BODY_SINCE 原则）。
 * 免转递豁免：仅跨仓 COREML-*（同工作区侧免转递）契约明载不产出转递提示词；仓内
 * workspace=same 回执仍须含「## 转递提示词」节——任务转递免的是「搬工作树」，回执交付行
 * （通知发起方审计）不豁免（DESIGN §1 / RESPONSE-TEMPLATE:112）。 */
const RECEIPT_PROMPT_SINCE = '2026-10-13';
/** 取回执中所有名为 <title>（允许后缀）的 ## 节的**正文行数组**（不含标题行）。
 *  逐行切分实现：跨语言可移植，且不受 JS 无 \Z、$ 受 m 标志影响等正则方言差异坑影响。 */
function receiptSections(raw, title) {
  const lines = String(raw || '').split('\n');
  const headRe = new RegExp('^##[ \\t]*' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const anyHeadRe = /^##[ \t]/;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!headRe.test(lines[i])) continue;
    const body = [];
    for (let j = i + 1; j < lines.length && !anyHeadRe.test(lines[j]); j++) body.push(lines[j]);
    out.push(body.join('\n'));
  }
  return out;
}
function checkReceiptPrompt(f, fm, raw, problems) {
  const made = gateDate(fm); // AR-F1：不再用回执自声明 date 判豁免
  if (exemptBy(made, RECEIPT_PROMPT_SINCE)) return; // 存量豁免（键 = 交接 created）
  if (f.startsWith('COREML-')) return; // 跨仓同工作区侧免转递（历史豁免，COREML-* 专属）
  // 仓内模式（v2.15.0 减负）：已有 handoff wait 状态机后台监听与响应式自动唤醒，
  // 彻底废除仓内回执必须含「## 转递提示词」节的盲肠要求，免除复制粘贴传话仪式。
  if (MODE === 'intra-repo' || fm?.mode === 'intra-repo' || fm?.workspace === 'same') return;
  // 标题允许带后缀（如「## 转递提示词（必含 · 供用户原样复制）」），故不锚行尾。
  // 逐行切分取节体——不用正则前瞻：JS 无 \Z（那是 Python），照搬会在 JS 里退化成字面「Z」而匹配失败。
  const secs = receiptSections(raw, '转递提示词');
  if (!secs.length) {
    problems.push(`[回执] 缺「## 转递提示词」节 — 契约 v2.11 起跨仓/异工作区/仓内同工作区回执须含该节（COREML-* 除外）: ${f}`);
    return;
  }
  // AR-②：只验节名存在会被「空壳节」蒙混（曾有一份回执节名为空、交付行写在另一个重复节里，
  // check 照过）。故再验**至少一个节内含标准可复制交付行**（新式「请收 <仓> 回执：」或旧式「登记回执：」）。
  const LINE_RE = /^[ \t]*(?:请【[^】]*】查收【[^】]*】回执[ \t]*[：:]|请收[ \t]*\S+[ \t]*回执[ \t]*[：:]|登记回执[ \t]*[：:])/m;
  const hasLine = secs.some(b => LINE_RE.test(b));
  if (!hasLine) {
    problems.push(`[回执] 「## 转递提示词」节为空 — 须含一行可复制交付行（「请收 <写回执仓> 回执：<路径>（…）」或旧式「登记回执：<路径>」）: ${f}`);
  }
}

// ── 回执「内容完整性」门禁（P0-c · 契约 v2.12.3）──────────────────────────────
// 病根：2026-10-13 一期一卉花 goods-stores-20261013-01-task-resp 伪回执——frontmatter 与
// 「## 转递提示词」齐全、check 能过，但声称新增的目录/提交均不存在；engine 无一步核内容即放行。
// 治法：回执须声明可核验 evidence（路径存在性 + 提交存在性），落盘 / 闭环 / check 三处机器校验。
// 边界（P3 可证伪优先）：仓内 cwd=仓 ⇒ 路径/提交可硬核；跨仓目标仓不可达（含未声明 evidence_repo，
// 此时 cwd=Hub 非执行方仓）⇒ 降级 warn 不硬拦，
// 可用 HANDOFF_REPO_ROOTS=key=path,... 提供本地仓根以启用硬核。存量（生效日前）豁免，不回改历史。
const EVIDENCE_SINCE = '2026-10-14';
// 相关性（提交须触及声称路径）是**新增子门禁**，故有自己的生效日：存量回执的既有声明不回改，
// 只约束生效日后的新回执——与 RECEIPT_BODY_SINCE / RECEIPT_PROMPT_SINCE / EVIDENCE_SINCE 同款存量豁免。
const RELEVANCE_SINCE = '2026-10-15';
function parseRepoRoots() {
  const m = new Map();
  for (const pair of String(process.env.HANDOFF_REPO_ROOTS || '').split(',')) {
    const i = pair.indexOf('=');
    if (i > 0) m.set(pair.slice(0, i).trim().toLowerCase(), pair.slice(i + 1).trim());
  }
  return m;
}
// repoKey 缺省 ⇒ cwd（仓内模式即目标仓）；否则查 HANDOFF_REPO_ROOTS 或直接当路径；不可解析返回 null。
function resolveRepoRoot(repoKey) {
  if (!repoKey) return process.cwd();
  const k = String(repoKey).toLowerCase();
  const roots = parseRepoRoots();
  // AR-F4：配置命中也须存在性校验——原先直接返回配置值，配错/未挂载时被当作「可达」⇒ 硬核
  // ⇒ 全部提交判不存在而硬拦，违背契约「目标仓不可达 ⇒ 降级 warn 不硬拦」。
  if (roots.has(k)) {
    const p = roots.get(k);
    try { if (p && fs.existsSync(p)) return p; } catch {}
    return null;
  }
  try { if (fs.existsSync(repoKey)) return repoKey; } catch {}
  return null;
}
// 归一化 evidence：兼容「CLI flag 扁平串」与「frontmatter 字段」两种来源。
function normalizeEvidence(src) {
  const toList = (v) => Array.isArray(v) ? v : String(v == null ? '' : v).split(/[,;]/).map(s => s.trim()).filter(Boolean);
  return {
    repo: src.evidence_repo || src.repo || undefined,
    commits: toList(src.evidence_commits != null ? src.evidence_commits : src.commits),
    paths: toList(src.evidence_paths != null ? src.evidence_paths : src.paths),
    note: src.evidence_note || src.note || undefined,
  };
}
// 由 CLI flag 生成 frontmatter 字段（仅在有值时落，避免污染无关回执）。
function evidenceFM(ev) {
  const fm = {};
  if (ev.commits) fm.evidence_commits = ev.commits;
  if (ev.paths) fm.evidence_paths = ev.paths;
  if (ev.repo) fm.evidence_repo = ev.repo;
  if (ev.note) fm.evidence_note = ev.note;
  return fm;
}
// evidence 校验：problems=阻断，warnings=不阻断提示。requireEvidence 仅仓内强制声明。
function evidenceProblems(ev, date, ctx, problems, warnings) {
  if (exemptBy(date, EVIDENCE_SINCE)) return; // 存量豁免（键由调用方传 gateDate；缺日期 ⇒ 不豁免）
  const requireEvidence = ctx.mode === 'intra-repo';
  const hasAny = ev.commits.length || ev.paths.length || ev.note;
  if (!hasAny) {
    if (requireEvidence) problems.push('缺 evidence：仓内新回执须声明可核验证据（--evidence-paths / --evidence-commits / --evidence-note）');
    return;
  }
  // 跨仓回执未声明 evidence_repo：cwd=Hub 并非执行方仓库（Hub 常为非 git 仓），拿 Hub 的 git
  // 核验执行方提交/路径是错靶（2026-10-14 SWOOP-20261014-03 误红：aff2ad8 本为 Swoop 真实提交，
  // 仅漏声明 evidence_repo）。降级 warn、不硬拦，对齐上方「跨仓目标仓不可达 ⇒ 降级 warn」与
  // README「跨仓配 HANDOFF_REPO_ROOTS 后才硬核」。仓内模式 cwd 即执行方仓库，不走此分支，硬核验不变。
  if (ctx.mode !== 'intra-repo' && !ev.repo) {
    warnings.push(`跨仓回执未声明 evidence_repo：无法定位提交/路径所属仓（cwd=Hub 非执行方仓），跳过硬核验；补 --evidence-repo 或配 HANDOFF_REPO_ROOTS 后可硬核`);
    return;
  }
  const root = resolveRepoRoot(ev.repo);
  if (root === null) {
    warnings.push(`evidence 目标仓不可解析（repo=${ev.repo || 'cwd'}）：跳过路径/提交核验；跨仓可用 HANDOFF_REPO_ROOTS=key=path,... 配置`);
    return;
  }
  for (const sha of ev.commits) {
    try { execFileSync('git', ['-C', root, 'cat-file', '-e', sha], { stdio: 'ignore' }); }
    catch { problems.push(`evidence 提交不存在: ${sha}（root=${root}）`); }
  }
  for (const rel of ev.paths) {
    let ok = false;
    try {
      const rootAbs = path.resolve(root);
      const resolved = path.resolve(rootAbs, rel);
      // AR-F5：path.join 不 confine，足够深的 ../ 可逃逸到仓外存在的文件而蒙混过关
      if (resolved !== rootAbs && !resolved.startsWith(rootAbs + path.sep)) {
        problems.push(`evidence 路径越出仓根: ${rel}（root=${root}）`);
        continue;
      }
      ok = fs.existsSync(resolved);
    } catch {}
    if (!ok) problems.push(`evidence 路径不存在: ${rel}（root=${root}）`);
  }
  // 相关性：声称提交是否真的改动了声称路径（防「真实但无关」的凑数证据）。
  // 两个先决修正（否则只会有假阳性、无法硬核）：
  // ① 遍历**全部**声明提交——原先只看 commits[0]，多提交回执必误报（如桩提交与回执提交分两次入库）；
  // ② -c core.quotePath=false——否则中文路径被 git 转成八进制（"docs/\346\216\245..."），与回执里的
  //    UTF-8 字面量永不相等 ⇒ 中文路径恒误报。
  // RELEVANCE_SINCE 起提升为**硬校验**（新回执）；此前存量仍只 warn，不回改历史。
  if (ev.commits.length && ev.paths.length) {
    try {
      // AR-F7：屏蔽 stderr——提交不存在时 git 会把 fatal: ambiguous argument 打到控制台
      const names = execFileSync('git', ['-C', root, '-c', 'core.quotePath=false', 'show', '--name-only', '--pretty=format:', ...ev.commits], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const touched = names.split('\n').map(s => s.trim()).filter(Boolean);
      for (const rel of ev.paths) {
        if (!touched.some(t => t === rel || rel.startsWith(t) || t.startsWith(rel))) {
          const msg = `evidence 提交未触及声称路径: ${ev.commits.join(',')} 均未改动 ${rel}（root=${root}）`;
          if (exemptBy(date, RELEVANCE_SINCE)) warnings.push(msg + '（存量豁免，供人工复核）');
          else problems.push(msg);
        }
      }
    } catch { /* git 不可用 / 非 git 仓 → 跳过 best-effort */ }
  }
}
// 回执内容门禁：正文锚节 + 转递提示词节（复用 check 的阈值/豁免逻辑）+ evidence。供 receipt/accept/reject 复用。
function receiptContentGate(id, body, ctx) {
  const problems = [], warnings = [];
  // AR-F1：门禁生效日取 max(交接 created, 传入 date)，不再单信回执自声明 date
  const gate = gateDate({ handoff_id: id, date: ctx.date });
  const fmForCheck = { date: gate };
  checkReceiptBody(id, fmForCheck, body, problems);
  checkReceiptPrompt(id, fmForCheck, body, problems);
  evidenceProblems(ctx.evidence, gate, ctx, problems, warnings);
  return { problems, warnings };
}

const H_BODY = `
# <TITLE> (<DIR>)

## 目标（1–3 行）
<要做成什么样。背景 / 根因 / 论证一律写 reviews/ 或设计文档，此处只放路径 + 一句结论。>

## 边界（表 · 谁改 / 谁只读）
| 文件:行号 | 改什么 |
|---|---|

## 验收判据（机器可判）
- [ ] <命令或字段，能明确判是/否>

## 口径与不变式（比率指标必填）
<分母是什么；有不变式就写等式。不写会被下游当别的含义引用。>

## 给执行方（回执时机 + 写法）
- 闭环点：<做到什么程度才写回执>
- 不写回执的中途态：<…>
- 回执落点：receipts/<交接ID>-resp.md，frontmatter 四字段 handoff_id / from_repo / to_repo / date
- 回执格式与结尾话术：按 $(lab path handoffs)/RESPONSE-TEMPLATE.md（单一来源）
- **执行方不 accept/reject**（只交回执 receipt）；发起方收回执=审计，通过才闭环，不过则 reject 退回

## 外链
- 背景 / 复盘：<reviews/ 路径>
- 契约 / 设计：<docs/ 路径>

> 体积预算：正文 ≤60 行 / ≤4KB。超限 = 把该放外链的内容抄进来了。
`;

// 仓内模式交接骨架（intra-repo）：去掉跨仓转递语境，强调同工作区归属纪律与「执行方不 accept/reject」
const H_BODY_INTRA = `
# <TITLE> (lane: <LANE>)

## 目标（1–3 行）
<要做成什么样。背景 / 根因 / 论证一律写 reviews/ 或设计文档，此处只放路径 + 一句结论。>

## 边界（表 · 谁改 / 谁只读）
| 文件:行号 | 改什么 |
|---|---|

## 验收判据（机器可判）
- [ ] <命令或字段，能明确判是/否>

## 口径与不变式（比率指标必填）
<分母是什么；有不变式就写等式。不写会被下游当别的含义引用。>

## 给执行方（回执时机 + 写法）
- 闭环点：<做到什么程度才写回执>
- 不写回执的中途态：<…>
- 回执落点：receipts/<交接ID>-resp.md，frontmatter：handoff_id / mode / from_lane / to_lane / needs_change / date
- 回执格式与结尾话术：按 $(lab path handoffs)/RESPONSE-TEMPLATE.md（单一来源）
- **执行方不 accept/reject**（只交回执 receipt）；发起 lane 收回执=审计，通过才闭环，不过则 reject 退回
- 同工作区（workspace=same）协作：共享工作树就地修改，发起方已挂起后台监听（0-Token 待机），执行方提交回执后自动唤醒发起方闭环
<AUDIT_NOTE>
## 外链
- 背景 / 复盘：<reviews/ 路径>
- 契约 / 设计：<docs/ 路径>

> 体积预算：正文 ≤60 行 / ≤4KB。
`;

function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function todayYMD() { return todayISO().replace(/-/g, ''); }

// 通用序号：前缀即 TARGET（跨仓）或 LANE（仓内），大小写原样保留
function nextSeqFor(prefix, ymd) {
  const re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-' + ymd + '-(\\d{2})-', 'i');
  let max = 0;
  try {
    for (const f of fs.readdirSync(H_DIR)) {
      const m = f.match(re);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
  } catch {}
  return String(max + 1).padStart(2, '0');
}

function readFM(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  const obj = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':'); if (idx === -1) continue;
    const k = line.slice(0, idx).trim();
    let v = line.slice(idx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (v === 'true') v = true; else if (v === 'false') v = false;
    obj[k] = v;
  }
  return obj;
}

function fmtVal(v) {
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'string' && (/[:#]/.test(v) || v === '')) return `'${v}'`;
  return v;
}

function writeFM(file, fm, body) {
  const fmStr = '---\n' + Object.entries(fm).map(([k, v]) => `${k}: ${fmtVal(v)}`).join('\n') + '\n---\n';
  fs.writeFileSync(file, fmStr + (body || ''), 'utf8');
}

function setFM(file, patch) {
  const content = fs.readFileSync(file, 'utf8');
  const fm = readFM(content);
  if (!fm) throw new Error('无 frontmatter: ' + file);
  Object.assign(fm, patch);
  const body = content.replace(/^---\n[\s\S]*?\n---\n/, '');
  writeFM(file, fm, body);
}

function cmdNew(args) {
  if (MODE === 'intra-repo') return cmdNewIntra(args);
  // ── 跨仓模式（逐字保留旧行为）──
  const [target, type, ...rest] = args;
  if (!target || !type) { console.error('用法: handoff new <target> <type> <标题...>'); process.exit(2); }
  if (!TARGETS.has(target.toLowerCase())) { console.error(`target 必须是 ${[...TARGETS].join(' / ')}`); process.exit(2); }
  if (!TYPES.has(type.toLowerCase())) { console.error(`type 必须是 ${[...TYPES].join(' / ')}`); process.exit(2); }
  const t = target.toLowerCase();
  const ty = type.toLowerCase();
  const title = rest.join(' ').trim() || '(无标题)';
  // 方向标签不猜发送方（2026-10-18 批次七修）：旧写法写死「iggle 是发起方」，hub 发起时整条链烙错章
  // （dirLabel → 回执 authorLabel → brief intro 三处同源）。发送方以转递话术 / frontmatter 为准。
  const dirLabel = `接收方 ${TARGET_LABELS[t] || t}`;
  const ymd = todayYMD();
  const seq = nextSeqFor(t.toUpperCase(), ymd);
  const id = `${t.toUpperCase()}-${ymd}-${seq}-${ty}`;
  const file = path.join(H_DIR, `${id}.md`);
  if (fs.existsSync(file)) { console.error('已存在: ' + file); process.exit(1); }
  const fm = {
    handoff_id: id,
    target: t,
    type: ty,
    status: 'draft',
    needs_iggle_change: false,
    // ZSpec ④ 版本回流：common_version 为跨平台共享版本；platform_versions 为该平台专属版本
    // （形如 `swoop=6aad880;prospero=v2.3`，仅记录本交接依赖的维度）。版本变更时由 `handoff drift` 触发失效回流。
    common_version: 'v2.4',
    platform_versions: '',
    created: todayISO(),
    closed: '',
  };
  const body = H_BODY.replaceAll('<TITLE>', title).replaceAll('<DIR>', dirLabel);
  writeFM(file, fm, body);
  const isZh = detectLang() === 'zh';
  if (isZh) {
    console.log(`✅ 已创建交接 ${id}`);
    console.log(`   文件: ${file}`);
    console.log(`   👉 关键动作: 填写交接正文后，【必须立即执行】以下命令转递并挂起后台监听：`);
    console.log(`      baton forward ${id} --wait`);
    console.log(`      （一条命令完成标记转递、打印标准接单提示词与挂起后台监听；回执到达时 Exit 0 自动唤醒发起方闭环）`);
  } else {
    console.log(`✅ Created Cross-Repo Baton ${id}`);
    console.log(`   File: ${file}`);
    console.log(`   👉 Mandatory Next Step: After filling content, you MUST run:`);
    console.log(`      baton forward ${id} --wait`);
    console.log(`      (Marks forwarded, prints pass prompt, and listens in background for auto-wakeup upon receipt)`);
  }
}

// 仓内模式：new <lane> <type> "<标题>" —— lane = 接收通道（= 回执撰写方 = 文件名前缀）
function cmdNewIntra(args) {
  const [lane, type, ...rest] = args;
  if (!lane || !type) { console.error('用法（仓内模式）: handoff new <lane> <type> <标题...>'); process.exit(2); }
  const lanes = new Set((HUB_CONFIG.lanes || []).map(s => String(s).toLowerCase()));
  if (lanes.size && !lanes.has(lane.toLowerCase())) {
    console.error(`lane 必须是 ${[...lanes].join(' / ')}（来自 .handoff-hub.json）`);
    process.exit(2);
  }
  // 防串味：lane 名不得与跨仓 TARGET 撞名（否则跨仓/仓内交接前缀不可区分）
  if (TARGETS.has(lane.toLowerCase())) {
    console.error(`lane 名「${lane}」与跨仓 TARGET 撞名，请改用其它 lane 名`);
    process.exit(2);
  }
  const types = new Set([...(HUB_CONFIG.types || []), ...INTRA_TYPES].map(s => String(s).toLowerCase()));
  if (!types.has(type.toLowerCase())) { console.error(`type 必须是 ${[...types].join(' / ')}`); process.exit(2); }
  const l = lane.toLowerCase();
  const ty = type.toLowerCase();
  const title = rest.join(' ').trim() || '(无标题)';
  const ymd = todayYMD();
  const seq = nextSeqFor(l, ymd);
  const id = `${l}-${ymd}-${seq}-${ty}`;
  const file = path.join(H_DIR, `${id}.md`);
  if (fs.existsSync(file)) { console.error('已存在: ' + file); process.exit(1); }
  const ws = HUB_CONFIG.workspace_default || 'same';
  // 审计动作契约（v2.13）：to_lane=audit 时把强制审计动作注入交接文档「给执行方」节，
  // 让审计 agent 读到的就是约束本身（严禁仅静态读码、独立执行验收判据）。
  const auditNote = (l === 'audit')
    ? '\n**审计动作契约（v2.13 · to_lane=audit）**：你即审计方，**严禁仅静态读码**——必须在终端**独立执行**下方「验收判据」中的**所有测试与校验命令**，以实测输出为唯一准绳，**严禁采信自报**（执行方回执里的「已通过」一律视为待验证声明，不采信）。'
    : '';
  // from_lane = 发起通道；优先取本窗口声明的 HANDOFF_LANE 环境变量（提案 §7.4）
  const fromLane = process.env.HANDOFF_LANE || '';
  const fm = {
    handoff_id: id,
    mode: 'intra-repo',
    project: HUB_CONFIG.project || '',
    from_lane: fromLane,
    to_lane: l,
    workspace: ws,
    timing: 'sequential',
    type: ty,
    status: 'draft',
    needs_change: false,
    created: todayISO(),
    closed: '',
  };
  const body = H_BODY_INTRA.replaceAll('<TITLE>', title).replaceAll('<LANE>', l).replaceAll('<WS>', ws).replaceAll('<AUDIT_NOTE>', auditNote);
  writeFM(file, fm, body);
  const isZh = detectLang() === 'zh';
  if (isZh) {
    console.log(`✅ 已创建仓内交接 ${id}（lane=${l} · workspace=${ws}）`);
    console.log(`   文件: ${file}`);
    console.log(`   👉 关键动作: 填写交接正文后，【必须立即执行】以下命令转递并挂起后台监听：`);
    console.log(`      baton forward ${id} --wait`);
    console.log(`      （一条命令完成标记转递、打印标准接单提示词与挂起后台监听；回执到达时 Exit 0 自动唤醒发起方闭环）`);
  } else {
    console.log(`✅ Created Intra-Repo Baton ${id} (lane=${l}, workspace=${ws})`);
    console.log(`   File: ${file}`);
    console.log(`   👉 Mandatory Next Step: After filling content, you MUST run:`);
    console.log(`      baton forward ${id} --wait`);
    console.log(`      (Marks forwarded, prints pass prompt, and listens in background for auto-wakeup upon receipt)`);
  }
}

function cmdStatus(args) {
  // 把解析到的根与模式显式传给 handoff-status.mjs，使其成为确定性入口（仓内根 ≠ 脚本目录）
  const filtered = args.filter(a => a !== '--root' && a !== '--mode' && !a.startsWith('--root=') && !a.startsWith('--mode='));
  try {
    // stdio 显式全 pipe：execFileSync 默认会把子进程 stderr 透传给父进程，与 catch 里的输出重复
    const out = execFileSync(process.execPath, [STATUS_JS, '--root', ROOT, '--mode', MODE, ...filtered], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    process.stdout.write(out);
  } catch (e) {
    // 子进程非零退出（如 --for 非法：跨仓 target / 仓内 lane 校验不过）时 execFileSync 会连栈抛出——
    // 把 stderr 原样透出、按子进程退出码收尾（2026-10-18 修；原行为 = 干净消息后跟一坨 Node 栈转储）。
    if (e && e.stderr) process.stderr.write(e.stderr);
    process.exit(typeof e?.status === 'number' ? e.status : 1);
  }
  recordStatusSeen();
}

/** close_policy 方向断言：把「谁闭环」从死字段变活（提案 §7 close_policy=self）。
 *
 * 仓内 `.handoff-hub.json` 的 close_policy 决定 continuation（续接新窗口）的闭环责任方：
 *   - `sender`（默认）：闭环方 = 发起方 `from_lane`；
 *   - `self`：continuation 由**后继会话**（`to_lane`，真正完成工作的一方）闭环，而非发起方。
 * 跨仓模式无 lane/close_policy 概念，本断言只作用于仓内模式（跨仓直接跳过）。
 * CLI 无法强验「我是谁」，故用 `--by <lane>` 让调用方**显式声明**闭环身份：
 *   - `self` + continuation → **硬校验**（`--by` 必填且 == `to_lane`）；
 *   - 其余 → `--by` 可选，提供时软校验（不匹配仅警告，避免误伤存量/迁移）。 */
function resolveCloseParty(fm) {
  const policy = (HUB_CONFIG && HUB_CONFIG.close_policy) || 'sender';
  const isContinuation = String(fm?.type || '').toLowerCase() === 'continuation';
  const strict = isContinuation && policy === 'self';
  const party = strict ? String(fm?.to_lane || '') : String(fm?.from_lane || '');
  return { policy, isContinuation, strict, party };
}
function assertCloseDirection(id, fm, args) {
  if (MODE !== 'intra-repo') return; // 跨仓无 lane/close_policy，跳过
  const byIdx = args.indexOf('--by');
  const by = byIdx !== -1 ? String(args[byIdx + 1] || '').trim() : '';
  const { policy, isContinuation, strict, party } = resolveCloseParty(fm);
  if (strict) {
    if (!by) {
      console.error(`❌ close_policy=self：continuation「${id}」由后继会话闭环，须声明 --by <to_lane>（本条 to_lane=${party || '（未填）'}）。`);
      process.exit(1);
    }
    if (by.toLowerCase() !== party.toLowerCase()) {
      console.error(`❌ close_policy=self：continuation 由后继会话（to_lane=${party}）闭环，但 --by=${by} 不匹配。`);
      process.exit(1);
    }
    console.log(`ℹ️ close_policy=self：由后继会话 ${party} 闭环（continuation 续接语义）。`);
  } else if (by && party && by.toLowerCase() !== party.toLowerCase()) {
    console.warn(`⚠️ 闭环方 --by=${by} ≠ 责任方 ${party}（close_policy=${policy}）；软校验，继续执行。`);
  }
}

/** 审计闭环（accept）：发起方收回执 + 独立实测通过 ⇒ received → closed。
 *
 * 与「交回执 receipt（执行方）」严格区分：accept/reject 是**发起方**的动作——
 * 发起方收回执即审计，通过则一次闭环（不再有单独的 close 步骤），不过则 reject 退回。
 * `close` 保留为 accept 同义别名（历史交接文档大量写「handoff close」，迁移平滑）。 */
function cmdAccept(args) {
  const noteIdx = args.indexOf('-n');
  const note = noteIdx !== -1 ? args[noteIdx + 1]?.trim() : undefined;
  const byIdx = args.indexOf('--by');
  const id = args.find((a, i) => !a.startsWith('-') && (noteIdx === -1 || i !== noteIdx + 1) && (byIdx === -1 || i !== byIdx + 1));
  if (!id || !note) {
    console.error('用法: handoff accept <id> -n "<验收结论>"（close 为同义别名）');
    // 2026-10-18 修：仓内没有「依赖方 / 本仓适配」概念（双方是同仓 lane），责任描述按模式分支
    console.error(MODE === 'intra-repo'
      ? '验收门禁：闭环必须留验收证据（核实接收 lane 的改动 + 验证结论），无结论不允许闭环。'
      : '验收门禁：闭环必须留验收证据（核实依赖方改动 + 本仓适配 + 验证结论），无结论不允许闭环。');
    process.exit(2);
  }
  const file = path.join(H_DIR, `${id}.md`);
  if (!fs.existsSync(file)) { console.error('找不到交接: ' + file); process.exit(1); }
  assertStatusFresh('accept');
  const content = fs.readFileSync(file, 'utf8');
  const fm = readFM(content);
  const st = fm?.status;
  // 状态转换合法性内联（v2.18 · 五态流转）：闭环只允许 delivered → closed（或历史存量 received → closed，须经独立验收）
  if (st === 'draft' || st === 'forwarded') {
    console.error(`❌ 交接 ${id} 当前为 ${st}，尚未完成交付（delivered），不能闭环。请等待执行方: baton deliver ${id}（或 baton receipt ${id} --deliver）`);
    process.exit(1);
  }
  if (st === 'closed') {
    console.log(`↩️ ${id} 已闭环，跳过。`);
    return;
  }
  // P0-a：闭环前置内容门禁——delivered/received 必有回执，且该回执须过「锚节 + 转递提示词 + evidence」，否则拒绝闭环。
  const rFile = path.join(R_DIR, `${id}-resp.md`);
  if (!fs.existsSync(rFile)) { console.error(`❌ 找不到回执: ${rFile}（delivered/received 状态应已有回执）`); process.exit(1); }
  const rRaw = fs.readFileSync(rFile, 'utf8');
  const rFm = readFM(rRaw) || {};

  // 终态交付硬门禁（v2.18 · 防抢跑闭环）：缺 delivered_at 拒绝闭环（杜绝执行方会话未结束即被抢先闭环）
  const deliveredAt = fm.delivered_at || rFm.delivered_at;
  const isLegacy = (fm.created && fm.created < '2026-11-08') || args.includes('--legacy-exempt');
  if (!deliveredAt && !isLegacy) {
    console.error(`❌ 防抢跑闭环：交接 ${id} 尚未收到执行方的显式交付声明（缺 delivered_at），拒绝闭环。`);
    console.error(`   执行方必须在完成自检与证据提交后执行: baton deliver ${id} 确认终态交付。`);
    console.error(`   （若为历史存量交接，可追加 --legacy-exempt 豁免）`);
    process.exit(1);
  }

  // 防提前闭环（v2.13/v2.18）：若回执 author/author_lane 为发起方，属自填回执，拒绝据此闭环。
  if (MODE === 'intra-repo' && rFm.author_lane && fm.from_lane && String(rFm.author_lane).toLowerCase() === String(fm.from_lane).toLowerCase()) {
    console.error(`❌ 防提前闭环：回执 author_lane=${rFm.author_lane} 即发起方 from_lane=${fm.from_lane}，属发起方自填回执，拒绝据此闭环。`);
    process.exit(1);
  }
  if (MODE !== 'intra-repo' && rFm.author_repo && fm.source_repo && String(rFm.author_repo).toLowerCase() === String(fm.source_repo).toLowerCase()) {
    console.error(`❌ 防提前闭环：回执 author_repo=${rFm.author_repo} 即发起方 source_repo=${fm.source_repo}，属发起方自填回执，拒绝据此闭环。`);
    process.exit(1);
  }
  const rBody = rRaw.replace(/^---\n[\s\S]*?\n---\n/, '');
  const ws = MODE === 'intra-repo' ? (fm.workspace || rFm.workspace || 'same') : undefined;
  const gate = receiptContentGate(id, rBody, { mode: MODE, workspace: ws, date: rFm.date, evidence: normalizeEvidence(rFm) });
  for (const w of gate.warnings) console.warn('⚠️ ' + w);
  if (gate.problems.length) {
    console.error(`❌ 回执未过内容门禁，拒绝闭环（${gate.problems.length} 项）：`);
    for (const p of gate.problems) console.error('  - ' + p);
    console.error(`   若判为伪回执请 handoff reject ${id} -n "<理由>" 退回；若仅缺证据请执行方补 handoff receipt ${id} -n "..." --evidence-paths "..." 后再闭环。`);
    process.exit(1);
  }
  // close_policy 方向断言（self+continuation 硬校验后继会话身份）
  assertCloseDirection(id, fm, args);
  // 验收记录节标题统一「验收记录（闭环依据）」，不写死任何一方（原跨仓写死 iggle，Tappy 等非 iggle 发起方会烙错章）
  if (!/^## (验收记录|Audit Record|Acceptance Record)/im.test(content)) {
    const appended = content.replace(/\n*$/, '\n') + `\n## 验收记录（闭环依据）\n- 日期：${todayISO()}\n- 结论：${note}\n`;
    fs.writeFileSync(file, appended, 'utf8');
  }
  const now = new Date().toISOString();
  const updateFM = { status: 'closed', closed: todayISO(), accepted_at: now };
  if (deliveredAt) updateFM.delivered_at = deliveredAt;
  setFM(file, updateFM);
  console.log(`✅ 已审计闭环: ${id}（验收记录已写入交接文档）`);
}

/** 审计驳回（reject）：发起方收回执后实测不过 ⇒ received → forwarded（退回执行方继续改）。
 * 驳回理由追加进回执文件「驳回记录」节（回执是执行方产物，驳回是发起方反馈，落同一文件便于对账）；
 * 状态翻 forwarded 表达「待执行方继续改」。 */
function cmdReject(args) {
  const noteIdx = args.indexOf('-n');
  const note = noteIdx !== -1 ? args[noteIdx + 1]?.trim() : undefined;
  const id = args.find((a, i) => !a.startsWith('-') && (noteIdx === -1 || i !== noteIdx + 1));
  if (!id || !note) {
    console.error('用法: handoff reject <id> -n "<驳回理由>"');
    console.error('驳回门禁：审计不通过必须写清驳回理由（缺什么 / 差在哪），无理由不允许退回。');
    process.exit(2);
  }
  const file = path.join(H_DIR, `${id}.md`);
  if (!fs.existsSync(file)) { console.error('找不到交接: ' + file); process.exit(1); }
  assertStatusFresh('reject');
  const st = readFM(fs.readFileSync(file, 'utf8'))?.status;
  if (st === 'draft') {
    console.error(`❌ 交接 ${id} 当前为 draft，尚无登记回执或交付，不能驳回${fs.existsSync(path.join(R_DIR, `${id}-resp.md`)) ? `；检测到回执文件，请先 baton deliver ${id} 交付后再核验驳回` : ''}。`);
    process.exit(1);
  }
  if (st === 'closed') {
    console.error(`❌ 交接 ${id} 已闭环（closed），不可再驳回。`);
    process.exit(1);
  }
  if (st === 'forwarded') {
    console.log(`↩️ ${id} 已是 forwarded（待执行方继续改），跳过。`);
    return;
  }
  // P0-a（信息面）：reject 前把回执内容门禁发现的问题打出来，辅助审计判定（不阻断——reject 本身即纠正动作）
  {
    const rFile0 = path.join(R_DIR, `${id}-resp.md`);
    if (fs.existsSync(rFile0)) {
      const rRaw0 = fs.readFileSync(rFile0, 'utf8');
      const rFm0 = readFM(rRaw0) || {};
      const rBody0 = rRaw0.replace(/^---\n[\s\S]*?\n---\n/, '');
      const ws0 = MODE === 'intra-repo' ? (readFM(fs.readFileSync(file, 'utf8'))?.workspace || rFm0.workspace || 'same') : undefined;
      const g0 = receiptContentGate(id, rBody0, { mode: MODE, workspace: ws0, date: rFm0.date, evidence: normalizeEvidence(rFm0) });
      if (g0.problems.length) { console.log(`ℹ️ 回执内容门禁发现 ${g0.problems.length} 项（可作本次驳回依据）：`); for (const p of g0.problems) console.log('   - ' + p); }
    }
  }
  const rFile = path.join(R_DIR, `${id}-resp.md`);
  if (fs.existsSync(rFile)) {
    const rRaw = fs.readFileSync(rFile, 'utf8');
    if (!/^## (驳回记录|Rejection Record)/im.test(rRaw)) {
      fs.writeFileSync(rFile, rRaw.replace(/\n*$/, '\n') + `\n## 驳回记录\n- 日期：${todayISO()}\n- 理由：${note}\n`, 'utf8');
    }
  }
  setFM(file, { status: 'forwarded', delivered_at: '' });
  console.log(`✅ 已驳回退回: ${id} → forwarded（驳回理由已写入回执文件）`);
}

/** 写回执文件（v2.10：让 `-n` 真正落盘 + 无 `-n` 时补骨架）。
 *
 * 旧病：`receipt <id> -n "<回执>"` 里 `-n` 及正文被**静默丢弃**（cmdReceipt 从不解析 -n），
 * 命令照样 exit 0，回执正文一个字没写——「写回执不规范」的头号机器成因。
 * 新规：带 -n ⇒ 以该文本为回执正文（文件已存在则覆盖 body、并合并 frontmatter）；
 *      不带 -n ⇒ 文件不存在时落骨架（仓内不再空 body），已存在则保留既有正文只更新 frontmatter。 */
function writeReceiptFile(rFile, rFm, note, skeleton) {
  if (note !== undefined) {
    if (!fs.existsSync(rFile)) { writeFM(rFile, { ...rFm, date: todayISO() }, ensureTrailingNewline(note)); return; }
    const fm = readFM(fs.readFileSync(rFile, 'utf8')) || {};
    Object.assign(fm, rFm); // 不含 date：保留既有回执自己的日期，不被登记日覆盖
    writeFM(rFile, fm, ensureTrailingNewline(note));
    return;
  }
  if (!fs.existsSync(rFile)) { writeFM(rFile, { ...rFm, date: todayISO() }, skeleton); return; }
  setFM(rFile, rFm);
}

/** 从回执正文抽取一行「结论」摘要（仓内回执交付行用；取「## 结论」节首个非空非标题/列表行）。 */
function extractConclusion(raw) {
  if (!raw) return '';
  for (const t of ['结论', 'Conclusion', 'Verdict', 'Status', '状态']) for (const body of receiptSections(raw, t)) {
    const line = body.split('\n').map(s => s.trim()).find(s => s && !s.startsWith('#') && !s.startsWith('>') && !s.startsWith('-'));
    if (line) return line.length > 40 ? line.slice(0, 40) + '…' : line;
  }
  return '';
}

/** P1（v2.12.4 热修批次）：handoff receipt 成功后，直接在控制台打印可复制「回执交付行」，
 *  与 cmdPrompt 对 separate 的交接提示词对称——免得 agent 自己手拼（易漏路径/体积/needs_change）。
 *  跨仓：detectRepo→TARGET_LABELS 拼仓库标签（跨仓方向以仓库为角色，不在本次修改范围）；
 *  **仓内（v2.13 修复）：严禁 detectRepo 拼仓库名**，改读回执 frontmatter 的 from_lane/to_lane，
 *  用 resolveLaneRole 拼自然角色（杜绝「请收 Tappy 回执」式把项目名当沟通角色的事故）。 */
function printReceiptDeliveryLine(rFile, needsChange) {
  let lines = 0, bytes = 0, fromLane = '', toLane = '', rawText = '';
  try {
    const buf = fs.readFileSync(rFile);
    bytes = buf.length;
    const text = buf.toString('utf8');
    rawText = text;
    lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    const fm = readFM(text) || {};
    fromLane = fm.from_lane || '';
    toLane = fm.to_lane || '';
  } catch { /* 读不到不阻断主流程 */ }
  const flag = needsChange ? '是' : '否';
  const display = rFile.startsWith(os.homedir()) ? '~' + rFile.slice(os.homedir().length) : rFile;
  if (MODE === 'intra-repo') {
    console.log(`\n✅ 仓内回执已生效（状态已翻为 received，后台监听已自动感知并唤醒发起方/审计方进行验收闭环，无需人工复制转递提示词）。\n`);
    return;
  }
  console.log(`\n📋 回执交付行（复制给发起方 Agent，一行即完整）:\n`);
  const repo = detectRepo(process.cwd());
  const label = repo ? (TARGET_LABELS[repo] || repo) : (path.basename(process.cwd()) || '本仓');
  console.log(`请收 ${label} 回执：${display}（${lines} 行 / ${bytes} 字节 · 需发起方改动：${flag}）`);
  console.log(`\n（接收方注 · 勿复制给发起方：该行触发「收回执」路由——发起方读回执并审计；内容已闭环无需转递时回复制明确写「无需转递」。）`);
}

function cmdReceipt(args) {
  const shouldDeliver = args.includes('--deliver');
  const needsChange = args.includes('--needs-change');
  const noteIdx = args.indexOf('-n');
  const note = noteIdx !== -1 ? args[noteIdx + 1]?.trim() : undefined;
  // evidence flags（P0-c）：CLI 传入可核验证据，落进 frontmatter 供门禁/check 校验
  const evidenceFlags = {
    commits: flagValue(args, '--evidence-commits'),
    paths: flagValue(args, '--evidence-paths'),
    repo: flagValue(args, '--evidence-repo'),
    note: flagValue(args, '--evidence-note'),
  };
  // 稳健取 id：跳过「带值 flag」的值位（-n 与 evidence 系列），避免把 flag 值误当 id
  const valFlags = ['-n', '--evidence-commits', '--evidence-paths', '--evidence-repo', '--evidence-note'];
  const valueIdx = new Set();
  for (let i = 0; i < args.length; i++) if (valFlags.includes(args[i])) valueIdx.add(i + 1);
  const id = args.find((a, i) => !a.startsWith('-') && !valueIdx.has(i));
  if (!id) { console.error('用法: handoff receipt <id> [-n "<回执正文>"] [--deliver] [--needs-change] [--evidence-paths "a,b"] [--evidence-commits "sha"] [--evidence-repo key] [--evidence-note "..."]'); process.exit(2); }
  const hFile = path.join(H_DIR, `${id}.md`);
  if (!fs.existsSync(hFile)) { console.error('找不到交接: ' + hFile); process.exit(1); }
  assertStatusFresh('receipt');
  const hFm = readFM(fs.readFileSync(hFile, 'utf8'));
  const st = hFm?.status;
  // 防提前闭环（v2.13）：发起方禁止自填回执——独立审计制衡要求回执必须由 to_lane 接收方独立撰写。
  // 用当前窗口 HANDOFF_LANE 核验身份：== 发起方(from_lane) 即硬拒（自填）；!= 接收方(to_lane) 也硬拒（越界）。
  // 未声明 HANDOFF_LANE 时无法核验，降级 warn 不阻断（避免误伤未配置的存量窗口）。
  if (MODE === 'intra-repo') {
    const toLane = String(hFm?.to_lane || '').toLowerCase();
    const fromLane = String(hFm?.from_lane || '').toLowerCase();
    const cur = (process.env.HANDOFF_LANE || '').toLowerCase();
    if (cur) {
      if (cur === fromLane && fromLane) {
        console.error(`❌ 防提前闭环：当前窗口 lane=${cur} 即发起方（from_lane），禁止自填回执。回执必须由接收方 to_lane=${toLane}（${resolveLaneRole(toLane)}）独立撰写，否则破坏独立审计制衡。`);
        process.exit(1);
      }
      if (cur !== toLane) {
        console.error(`❌ 防提前闭环：当前窗口 lane=${cur} 不是该交接指定接收方 to_lane=${toLane}（${resolveLaneRole(toLane)}）；回执须由接收方撰写，越界写回执会污染审计。`);
        process.exit(1);
      }
    } else {
      console.warn(`⚠️ 未声明 HANDOFF_LANE，无法核验回执撰写方身份（「发起方自填回执」式提前闭环作弊失效）。建议窗口声明 HANDOFF_LANE=<本方 lane> 后再写回执。`);
    }
  }
  // 状态转换合法性内联（v2.6；v2.12.5 放开 draft）：draft/forwarded → received。
  // 旧版无条件拒 draft（「尚未 forward，不能回执」）——但 forward 是发起方可选的事后标记
  // （README op 表明文），v2.7 场景本就是「用户直接递文档、不跑 forward」；执行方干完活
  // 却被引擎挡在最后一步、被迫替发起方跑 forward（假章），且 cmdSync 一直放行
  // draft → received，两路径互相矛盾。received/closed 语义不变。
  if (st === 'draft') {
    console.log(`ℹ️ ${id} 仍为 draft（发起方未跑可选标记 forward）→ 直接登记回执（draft → received）。`);
  }
  if (st === 'closed') {
    console.error(`❌ 交接 ${id} 已闭环（closed），不可再回执。`);
    process.exit(1);
  }
  // P0-b：落盘前内容门禁——带 -n 的实际正文须过「锚节 + 转递提示词 + evidence」，缺即拒收、不落盘、不翻状态
  if (note !== undefined) {
    const ws = MODE === 'intra-repo' ? (hFm.workspace || 'same') : undefined;
    const ctx = { mode: MODE, workspace: ws, date: todayISO(), evidence: normalizeEvidence(evidenceFlags) };
    const { problems, warnings } = receiptContentGate(id, note, ctx);
    for (const w of warnings) console.warn('⚠️ ' + w);
    if (problems.length) {
      console.error(`❌ 回执未过内容门禁，拒绝落盘（${problems.length} 项）：`);
      for (const p of problems) console.error('  - ' + p);
      console.error(`   仓内新回执请附可核验证据，如: handoff receipt ${id} -n "<正文>" --evidence-paths "cloudfunctions/stores/index.js,..." --evidence-commits "<sha>"`);
      process.exit(1);
    }
  }
  const evFM = evidenceFM(evidenceFlags);
  const rFile = path.join(R_DIR, `${id}-resp.md`);
  if (MODE === 'intra-repo') {
    // 仓内回执：方向由 frontmatter 的 from_lane / to_lane 决定，不写跨仓专属字段；date 补齐（与骨架五字段一致）
    const rFm = { handoff_id: id, mode: 'intra-repo', from_lane: hFm.to_lane || '', to_lane: hFm.from_lane || '', needs_change: needsChange, ...evFM };
    // 记录撰写方 lane（防提前闭环的耐久证据）：闭环/check 侧可据此核验回执确由接收方撰写，非发起方自填。
    if (process.env.HANDOFF_LANE) rFm.author_lane = process.env.HANDOFF_LANE;
    writeReceiptFile(rFile, rFm, note, receiptStubIntra(id, hFm.from_lane || ''));
    if (shouldDeliver) {
      cmdDeliver([id]);
      return;
    }
    if (st === 'received') {
      console.log(`↩️ ${id} 已是 received，回执已登记，跳过翻状态。`);
    } else {
      setFM(hFile, { status: 'received', needs_change: needsChange });
      console.log(`✅ 已登记仓内回执: ${rFile}`);
      console.log(`   交接 ${id} 状态翻为 received${needsChange ? '（需改动）' : ''}`);
    }
    console.log(`\n💡 提示：回执已就绪（status: received）。执行方自检全过并收尾时，请运行 baton deliver ${id} 确认最终交付（唤醒发起方验收）。\n`);
    printReceiptDeliveryLine(rFile, needsChange);
    return;
  }
  // ── 跨仓模式 ──
  const rFm = { handoff_id: id, needs_iggle_change: needsChange, ...evFM };
  const hTarget = (hFm && hFm.target) || 'swoop';
  // 回执标题不猜发送方（2026-10-18 批次七修）：旧写法 target=iggle 时印「iggle → swoop」、否则印「X → iggle」，
  // hub 发起的交接全被烙成 iggle 方向（实证：SWOOP / IGGLE 两份 20261018 回执方向均误标）。
  const authorLabel = `${TARGET_LABELS[hTarget] || hTarget} 侧回执`;
  writeReceiptFile(rFile, rFm, note, receiptStub(id, authorLabel));
  if (shouldDeliver) {
    cmdDeliver([id]);
    return;
  }
  if (st === 'received') {
    console.log(`↩️ ${id} 已是 received，回执已登记，跳过翻状态。`);
  } else {
    setFM(hFile, { status: 'received', needs_iggle_change: needsChange });
    console.log(`✅ 已登记回执: ${rFile}`);
    console.log(`   交接 ${id} 状态翻为 received${needsChange ? '（需发起方改动）' : ''}`);
  }
  console.log(`\n💡 提示：回执已登记（status: received）。执行方自检全过并收尾时，请运行 baton deliver ${id} 确认最终交付（唤醒发起方验收）。\n`);
  printReceiptDeliveryLine(rFile, needsChange);
}

/** 执行方显式终态交付（deliver）：会话收尾且自检全过时宣布完成交付并落印 delivered_at，推进为 delivered 态 */
function cmdDeliver(args) {
  const noteIdx = args.indexOf('-n');
  const note = noteIdx !== -1 ? args[noteIdx + 1]?.trim() : undefined;
  const valFlags = ['-n', '--evidence-commits', '--evidence-paths', '--evidence-repo', '--evidence-note'];
  const valueIdx = new Set();
  for (let i = 0; i < args.length; i++) if (valFlags.includes(args[i])) valueIdx.add(i + 1);
  const id = args.find((a, i) => !a.startsWith('-') && !valueIdx.has(i));
  if (!id) {
    console.error('用法: baton deliver <id> [-n "<交付补充说明>"]');
    console.error('交付语义：由执行方在自检全过、会话收尾时显式提交终态交付，烙印 delivered_at 并通知发起方验收。');
    process.exit(2);
  }
  const hFile = path.join(H_DIR, `${id}.md`);
  if (!fs.existsSync(hFile)) { console.error('找不到交接: ' + hFile); process.exit(1); }
  assertStatusFresh('deliver');
  const hRaw = fs.readFileSync(hFile, 'utf8');
  const hFm = readFM(hRaw) || {};
  const st = hFm?.status;
  if (st === 'closed') {
    console.log(`↩️ ${id} 已闭环，跳过交付。`);
    return;
  }
  const rFile = path.join(R_DIR, `${id}-resp.md`);
  if (!fs.existsSync(rFile)) {
    console.error(`❌ 找不到回执: ${rFile}。交付前必须先撰写并登记回执（baton receipt ${id}）。`);
    process.exit(1);
  }
  const rRaw = fs.readFileSync(rFile, 'utf8');
  const rFm = readFM(rRaw) || {};

  // 防提前闭环与越界交付
  if (MODE === 'intra-repo') {
    const toLane = String(hFm?.to_lane || '').toLowerCase();
    const fromLane = String(hFm?.from_lane || '').toLowerCase();
    const cur = (process.env.HANDOFF_LANE || '').toLowerCase();
    if (cur) {
      if (cur === fromLane && fromLane) {
        console.error(`❌ 防提前闭环：当前窗口 lane=${cur} 即发起方（from_lane），禁止代替执行方执行 deliver。`);
        process.exit(1);
      }
      if (cur !== toLane) {
        console.error(`❌ 越界交付：当前窗口 lane=${cur} 不是该交接指定接收方 to_lane=${toLane}（${resolveLaneRole(toLane)}）。`);
        process.exit(1);
      }
    }
  } else {
    const curRepo = detectRepo(process.cwd());
    if (curRepo && hFm.source_repo && curRepo === hFm.source_repo) {
      console.error(`❌ 防提前闭环：当前仓 ${curRepo} 即交接发起仓，禁止代替依赖方执行 deliver。`);
      process.exit(1);
    }
  }

  // 内容门禁校验
  const rBody = rRaw.replace(/^---\n[\s\S]*?\n---\n/, '');
  const ws = MODE === 'intra-repo' ? (hFm.workspace || rFm.workspace || 'same') : undefined;
  const gate = receiptContentGate(id, rBody, { mode: MODE, workspace: ws, date: rFm.date, evidence: normalizeEvidence(rFm) });
  for (const w of gate.warnings) console.warn('⚠️ ' + w);
  if (gate.problems.length) {
    console.error(`❌ 回执未过内容门禁，拒绝交付（${gate.problems.length} 项）：`);
    for (const p of gate.problems) console.error('  - ' + p);
    process.exit(1);
  }

  const nowISO = new Date().toISOString();
  // 写入回执 frontmatter
  const updatedRFm = { ...rFm, delivered_at: nowISO };
  if (process.env.HANDOFF_LANE) updatedRFm.delivered_by_lane = process.env.HANDOFF_LANE;
  writeReceiptFile(rFile, updatedRFm, undefined, rBody);

  // 写入交接 frontmatter
  const updateHFm = {
    status: 'delivered',
    delivered_at: nowISO,
  };
  if (note) updateHFm.delivery_note = note;
  setFM(hFile, updateHFm);

  console.log(`🚀 [交付成功] 交接 ${id} 状态已推进为 delivered！`);
  console.log(`   交付时间: ${nowISO}`);
  console.log(`   执行方已确认终态交付。发起方/审计方后台 wait 探针将自动唤醒进行独立验收。`);
  printReceiptDeliveryLine(rFile, Boolean(hFm.needs_change || rFm.needs_change || rFm.needs_iggle_change));
}

/** 将 wait 命令作为完全脱钩的独立后台守护进程启动（金蝉脱壳 · 0-阻塞瞬间退出）。
 * 核心原理：
 * 1. 使用 child_process.spawn 独立启动 Node 进程执行 baton wait <id> ...
 * 2. detached: true 创建新的进程组，不随父会话结束而终止。
 * 3. stdio 重定向至独立日志文件（避免标准 I/O 管道占有导致父进程挂起）。
 * 4. 调用 child.unref() 从父进程事件循环引用中剔除，允许父命令在 0.1 秒内安全退出。
 */
function spawnDaemonWait(id, extraArgs = []) {
  const isZh = detectLang() === 'zh';
  const logDir = path.join(ROOT, 'logs');
  try { fs.mkdirSync(logDir, { recursive: true }); } catch {}
  const logFile = path.join(logDir, `wait-${id}.log`);

  let outFd = 'ignore';
  let errFd = 'ignore';
  try {
    const fd = fs.openSync(logFile, 'a');
    outFd = fd;
    errFd = fd;
  } catch {}

  const cliPath = fs.realpathSync(process.argv[1]);
  const cleanArgs = extraArgs.filter(a => a !== '--daemon' && a !== '-d' && a !== '--wait' && a !== '-w' && a !== '--blind' && a !== id);
  const spawnArgs = [cliPath, 'wait', id, ...cleanArgs];
  if (MODE === 'intra-repo') {
    spawnArgs.push('--root', ROOT);
  }

  const child = spawn(process.execPath, spawnArgs, {
    detached: true,
    stdio: ['ignore', outFd, errFd],
    cwd: ROOT,
    env: { ...process.env, BATON_DAEMON: '1' }
  });

  child.unref();

  if (isZh) {
    console.log(`🚀 [金蝉脱壳] 后台监听守护进程已成功启动并脱钩！`);
    console.log(`   - 守护进程 PID: ${child.pid}`);
    console.log(`   - 监听日志输出: ${logFile}`);
    console.log(`   - 命令已安全退出（耗时 < 0.1s），后台 0-Token 持续监听回执到达。\n`);
  } else {
    console.log(`🚀 [Daemon Detached] Background listener daemon launched and detached!`);
    console.log(`   - Daemon PID: ${child.pid}`);
    console.log(`   - Log output: ${logFile}`);
    console.log(`   - Process safely exited (< 0.1s), listening in background with 0 tokens.\n`);
  }
}

async function cmdForward(args) {
  const isDaemon = args.includes('--daemon') || args.includes('-d');
  const shouldWait = args.includes('--wait') || args.includes('-w');
  const valFlags = ['--timeout', '-t', '--interval', '-i'];
  const valueIdx = new Set();
  for (let i = 0; i < args.length; i++) if (valFlags.includes(args[i])) valueIdx.add(i + 1);
  const id = args.find((a, i) => !a.startsWith('-') && !valueIdx.has(i));

  if (!id) {
    console.error('用法: baton forward <id> [--wait] [--daemon] [--blind]');
    process.exit(2);
  }
  const file = path.join(H_DIR, `${id}.md`);
  if (!fs.existsSync(file)) {
    console.error('找不到交接: ' + file);
    process.exit(1);
  }
  const fm = readFM(fs.readFileSync(file, 'utf8'));
  if (fm.status === 'received' || fm.status === 'delivered' || fm.status === 'closed') {
    console.log(`⚠️ 交接 ${id} 当前状态为 ${fm.status}，已是更靠后状态，跳过翻 forwarded。`);
  } else {
    setFM(file, { status: 'forwarded' });
    console.log(`✅ 已标记转递: ${id}`);
  }

  // 无论跨仓还是仓内（含 same / separate），一律输出标准交接提示词供一键复制
  cmdPrompt([id]);

  if (isDaemon || shouldWait) {
    const waitArgs = args.filter(a => a !== '--wait' && a !== '-w' && a !== '--daemon' && a !== '-d' && a !== '--blind' && a !== id);
    if (isDaemon && !isAgentEnvironment()) {
      // 人类交互终端显式指定 --daemon：走脱钩后台守护（秒退）
      spawnDaemonWait(id, waitArgs);
    } else {
      if (isDaemon && isAgentEnvironment()) {
        const isZh = detectLang() === 'zh';
        if (isZh) {
          console.log(`🤖 [AI 宿主环境感知] 检测到 Agent 托管管道，--daemon 自动切换为托管阻塞等待（保持进程树存活以供宿主任务管理器捕获并在回执到达时 Exit 0 唤醒）。\n`);
        } else {
          console.log(`🤖 [Agent Host Detected] In managed agent environment, --daemon automatically falls back to managed blocking wait (preserves process-tree for reactive wakeup on Exit 0).\n`);
        }
      }
      // 托管环境或普通 --wait：直接调用 cmdWait，保持在宿主管道中供宿主平台接管并唤醒
      await cmdWait([id, ...waitArgs]);
    }
  } else {
    const isZh = detectLang() === 'zh';
    if (isZh) {
      console.log(`\n👉 提示: 请立即启动后台监听: baton forward ${id} --wait（由 AI 宿主托管或阻塞等待），以便在回执到达时自动唤醒。`);
    } else {
      console.log(`\n👉 Notice: Please start background listener immediately: baton forward ${id} --wait (managed by agent host or blocking wait) to auto-wake upon receipt.`);
    }
  }
}

function cmdOpen(args) {
  const [id] = args;
  if (!id) { console.error('用法: handoff open <id>'); process.exit(2); }
  const file = path.join(H_DIR, `${id}.md`);
  if (!fs.existsSync(file)) { console.error('找不到交接: ' + file); process.exit(1); }
  try { execFileSync('open', [file]); console.log('已打开: ' + file); }
  catch { console.log('打开失败（非 macOS？），路径: ' + file); }
}

/** triage 视图（proposal A · 最大单一杠杆）。
 *
 * 给单条交接/回执一个摘要视图：frontmatter + 各 `## 节` 标题 + 每节首行，**不 dump 全文**。
 * 支持 `handoffs/<ID>.md` 与 `receipts/<ID>-resp.md`（按 `<ID>-resp` 判定目录）。
 * 为什么只列元数据 + 节标题 + 首行：收/写/收回执前只需要「这份交接讲什么、该谁动」，
 * 不必为判断是否相关而吞掉整篇正文（P2 Path 定向：LLM 只读该份的摘要，仍按需 read 全文）。 */
function cmdShow(args) {
  const [id] = args.filter(a => !a.startsWith('-'));
  if (!id) { console.error('用法: handoff show <id>'); process.exit(2); }
  const isResp = id.endsWith('-resp');
  const hFile = isResp ? path.join(R_DIR, `${id}.md`) : path.join(H_DIR, `${id}.md`);
  if (!fs.existsSync(hFile)) { console.error('找不到: ' + hFile); process.exit(1); }
  const raw = fs.readFileSync(hFile, 'utf8');
  const fm = readFM(raw);
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, '');
  console.log(`# ${id}`);
  const keys = isResp
    ? (MODE === 'intra-repo'
        ? ['handoff_id', 'mode', 'from_lane', 'to_lane', 'needs_change', 'date']
        : ['handoff_id', 'needs_iggle_change', 'from_repo', 'to_repo', 'date'])
    : (MODE === 'intra-repo'
        ? ['mode', 'project', 'from_lane', 'to_lane', 'workspace', 'timing', 'type', 'status', 'needs_change', 'created', 'closed']
        : ['target', 'type', 'status', 'needs_iggle_change', 'created', 'closed']);
  for (const k of keys) {
    if (fm && fm[k] !== undefined && fm[k] !== '') console.log(`- ${k}: ${fm[k]}`);
  }
  console.log('\n## 节结构（标题 + 首行）');
  const secs = body.split(/^## /m).slice(1);
  for (const s of secs) {
    const lines = s.split('\n');
    const title = lines[0].trim();
    const first = lines.find((l, i) => i > 0 && l.trim()) || '';
    console.log(`- ${title}${first ? '：' + first.trim().slice(0, 80) : ''}`);
  }
  console.log(`\n（全文: ${hFile}）`);
}

const STATUSES = new Set(['draft', 'forwarded', 'received', 'delivered', 'closed']);
// 由 TARGETS 派生（单源），避免 README/COMMANDS/正则多处枚举漂移
const TARGET_ALT = [...TARGETS].map(t => t.toUpperCase()).join('|');
const H_RE = new RegExp(`^(${TARGET_ALT})-(\\d{8})-(\\d{2})-(bug|feature|breaking|question)\\.md$`);
const R_RE = new RegExp(`^(${TARGET_ALT})-(\\d{8})-(\\d{2})-(bug|feature|breaking|question)-resp\\.md$`);
/** 转递提示词（v2.8.3 一行式 · 2026-09-10 与回执方向「请收」一行式对称）。
 *
 * 演进史：~24 行（内联步骤）→ 3 行指针版（v2.8）→ 散文 Path 定向版（2026-09-10）→ 一行式（v2.8.3）。
 * 一行式为什么成立：接收方名 + 动作（收交接）+ 路径已自含路由关键信息；回执规范/落点不在提示词里，
 * 因为交接骨架「给执行方」节与 handoff 技能路由本来就有（三重冗余砍成单一入口 + 文档内规范）。
 * 「请 <TARGET> 收」的点名列强于旧「（target: X）」括注：错投时接收方第一眼即见「不是给我的」，
 * 对 reverse 交接（提示词变「请 iggle 收交接」）同样成立。
 * 旧式「处理交接 <路径>」保留为合法触发（路由表双认），Swoop/prospero 记忆旧例句不致错。
 * <ID> / <TARGET> 占位符由 cmdPrompt 替换。 */
const PROMPT_TEMPLATE = `请 <TARGET> 收交接：${path.join(SCRIPT_ROOT, 'handoffs', '<ID>.md')}`;

function listMdFiles(dir, re) {
  try { return fs.readdirSync(dir).filter(f => re.test(f)).sort(); }
  catch { return []; }
}


// 已知标准桩 marker（按历史 → 最新排列）。
const STUB_MARKERS = [
  { begin: '<!-- handoff-stub:v2.0 begin -->', end: '<!-- handoff-stub:v2.0 end -->' },
  { begin: '<!-- handoff-stub:v2.1 begin -->', end: '<!-- handoff-stub:v2.1 end -->' },
];
const STUB_BEGIN = STUB_MARKERS[STUB_MARKERS.length - 1].begin;
const STUB_END = STUB_MARKERS[STUB_MARKERS.length - 1].end;
const STUB_MARKER_RE = /<!-- handoff-stub:v2\.\d+ begin -->[\s\S]*?<!-- handoff-stub:v2\.\d+ end -->/g;
const STUB_HEADING_RE = /(?:<!-- generated — do not edit -->\n)?(?:<!-- stub:sha256:[0-9a-f]+ -->\n)?### (?:Agent Baton \(Handoff\)|Handoff) (?:接入桩|Guard Stub)[\s\S]*?(?:获取完整版 Preflight。|for full Preflight\.)/g;
function scanStub(c) {
  const marker = c.match(STUB_MARKER_RE) || [];
  return marker.length ? marker : (c.match(STUB_HEADING_RE) || []);
}
function stripStub(c) {
  return (c.match(STUB_MARKER_RE) || []).length ? c.replace(STUB_MARKER_RE, '') : c.replace(STUB_HEADING_RE, '');
}
const STUB_CANON = (s) => s
  .replace(/\r\n/g, '\n')
  .replace(/<!-- handoff-stub:v2\.\d+ begin -->\n?/g, '')
  .replace(/\n?<!-- handoff-stub:v2\.\d+ end -->/g, '')
  .replace(/<!-- generated — do not edit -->\n?/g, '')
  .replace(/<!-- stub:sha256:[0-9a-f]+ -->\n?/g, '')
  .replace(/\s+$/, '');

const STUB_BODY_ZH = "### Agent Baton (Handoff) 接入桩（强制守卫 · 细则以 $(lab path handoffs)/README.md 契约 v2.19.0 为准）\n\n**早拦 Preflight（强制）**\n- **命令形态**：一律 `baton <op>` 或 `handoff <op>`（PATH shim → 中央引擎；幂等自愈 `baton link`）。若报 command not found：运行 `baton link`（或 `handoff link`）自愈（或通过 lab-agent-toolkit 重新 `npm link`）。\n- 调用 `show/receipt/deliver/accept/reject/check` 前，**必须先跑** `baton status`（或 `handoff status`，执行方冷启动用 `baton status --for <本方 lane|target>` 直取本方待办）且其输出在上下文中。\n- **状态语义（v2.19.0 · 五态生命周期）**：「进行中」= 未闭环（`status ≠ closed`）且归属当前方。**待办 = `draft` + `forwarded`**——落我归属即该我动工；`received` = 回执草稿已登记（待执行方交付）；`delivered` = 执行方已完成终态交付（等待发起方验收）；`closed` = 审计闭环完成。\n- **终态交付与平息机制（v2.19.0 · 防抢跑竞态与会话平息）**：回执文件落盘不等于会话结束。执行方必须通过 `baton deliver <ID>`（或 `baton receipt <ID> --deliver`）显式标记终态交付；探针检测到交付信号后启动平息缓冲（Settle Window），等待执行方会话彻底收尾退出后方 Exit 0 唤醒发起方。未 deliver 之前发起方 wait 探针不唤醒、accept 硬拒闭环。发起方严禁在收到显式交付信号前提前修改 Backlog 或规划文档。\n- 指定 ID 必须在「进行中」且归属当前方（仓内：`to_lane == 当前 lane`；跨仓：落在目标收件箱且未闭环）。找不到→停下并说明。\n- 未指定 ID 却有多条归属当前方的待办（draft/forwarded）→ 列出清单请用户点名，不擅自选。\n- receipt 前确保 status 快照 **< 60 分钟**（超时重跑；长任务收尾时 deliver 自动宽容续期）。\n- 仓内优先读 frontmatter `workspace`（same/separate），禁用 mtime 推断。\n- 执行方**只写 receipt / deliver**，**不做 accept/reject**。\n- **严禁抢跑/虚假回执**：验收判据**全部实测通过**方可提交回执与交付。执行中途遇阻、环境/多实例冲突或需讨论的中间状态，**仅记录于 reviews/ 或对话说明，严禁提交包含「已通过」的抢跑回执**。\n- 回执正文唯一源 = `$(lab path handoffs)/RESPONSE-TEMPLATE.md`：**照抄其「回执模板（可直接复制）」骨架**（含 evidence 字段），勿另起格式、勿凭记忆重建（骨架外 = 没有）。\n- **evidence 硬门禁（v2.12.3）**：仓内新回执（2026-10-14 起）**必须**附可核验证据 `--evidence-paths \"真实文件,...\"` / `--evidence-commits \"<sha>\"`（无文件改动用 `--evidence-note \"<原因>\"`）；声称的路径须真实存在、提交须 `git cat-file -e` 可查，否则 receipt / deliver / accept / check 拒收。**只声明不改 = 伪回执**（2026-10-13 goods-stores 事故教训）。\n- 收尾必须 `baton check`（或 `handoff check`）exit 0（2026-10-13 起回执须「非空正文 + 含 ## 节 + 含『状态 / 结论』锚节」；存量豁免）。\n- **回复收尾（交接提示词规范）**：发起交接（出站）时，回复最末块**必须固定为交接提示词（由本地 AI 根据用户本地语言自适应呈现：中文使用 `## 交接提示词`，英文使用 `## Baton Pass Prompt`）**。标题、描述说明与具体的接单指令必须严格分离，提示词置于独立代码块（```text）中，方便人类一键复制发给接收方 Agent（其后无任何正文）。执行方交付（入站）后，因发起方已挂起后台探针自动唤醒，无需再写回执提示词。\n- **审计动作契约（v2.13 · to_lane=audit 强制）**：审计方（接收方 to_lane=audit）**严禁仅静态读码**——必须在终端**独立执行**交接文档「验收判据」中的**所有测试与校验命令**，以实测输出为唯一准绳，**严禁采信自报**（执行方回执里的「已通过」一律视为待验证声明，不采信）。其余 lane 亦建议独立实测，但审计 lane 为硬纪律。\n- **仓内提示词用自然角色（v2.13）**：同仓提示词**严禁出现项目名 / lane slug 当角色**（如「请 Tappy 收交接」「请 impl lane 收交接」）。出站 = `请【<目标角色>】接单：<交接路径>（<主题>）`。角色由 lane 映射（impl→实现方 / audit→审计方 / arch·design→架构设计方；`.handoff-hub.json` 的 `lane_labels` 可覆盖）。\n- **防提前闭环与双盲审计防伪（v2.16.0）**：回执**必须由接收方 to_lane 独立撰写**——发起方（from_lane）禁止自填回执；`to_lane=audit` 派发时自动签发一次性 `Audit Nonce`，审计回执必须携带 `--audit-nonce \"<nonce>\"`，硬性拦截同一会话自签；支持 `baton forward --blind` 物理脱敏主观思维链与自辩借口。\n\n**最小操作序列（出站 = 建/发交接 · 强制闭环）**\n1. `baton new <target|lane> <type> \"<标题>\"`（或 `handoff new ...`）并填写正文\n2. **转递并挂起后台监听（必须执行）**：\n   执行 `baton forward <ID> --wait`（AI 客户端宿主进程树托管；人类终端可用 `--daemon` 脱钩；需双盲脱敏加 `--blind`）\n   ——无论同工作区还是跨工作区，必须启动监听探针；交付完成并平息后探针唤醒进行独立验收闭环。\n3. **输出交接提示词（末块规范）**：本地 AI 根据用户本地语言自适应输出，标题、描述与独立代码块分离（其后无任何正文）：\n   ## 交接提示词\n   > 直接复制下方提示词，发送给接收方 Agent 接单：\n   ```text\n   请【<目标角色>】接单：<交接路径>（<主题>）\n   ```\n\n**最小操作序列（入站 = 接单/回执/交付）**\n1. `baton status --for <本方 lane|target>`（冷启动直取本方待办；全量 `baton status` 供发起方巡检）\n2. 从「待办」（draft/forwarded）筛选归属当前方（仓内 `to_lane == 当前 lane`；跨仓 = 落在目标收件箱）→ 确认目标 ID\n3. `baton show <ID>`\n4. 按边界最小改动（仅该 lane 应改文件）\n5. 实测全过方写回执：**照抄 `$(lab path handoffs)/RESPONSE-TEMPLATE.md` 骨架** → 运行 `baton receipt <ID> -n \"<正文>\" --evidence-paths \"真实文件,...\" --evidence-commits \"<sha>\"`（或原子复合命令 `baton receipt <ID> --deliver ...` 直达交付）。（若 `to_lane=audit` 须附 `--audit-nonce \"<nonce>\"`；仓内必附 evidence；无文件改动用 `--evidence-note`；中途受阻仅写 reviews/ 严禁提回执）\n6. `baton check`（核验证据与锚节合规，exit 0）\n7. **终态交付与会话收尾**：运行 `baton deliver <ID>`（烙印 delivered 并触发平息缓冲后自动唤醒发起方；会话彻底收工结束）。\n\n详见 `$(lab path handoffs)/AGENT-GUIDE.md` 获取完整版 Preflight。";
const STUB_SHA_ZH = crypto.createHash('sha256').update(STUB_BODY_ZH).digest('hex').slice(0, 8);
const STUB_BLOCK_ZH = `${STUB_BEGIN}\n<!-- generated — do not edit -->\n<!-- stub:sha256:${STUB_SHA_ZH} -->\n${STUB_BODY_ZH}\n${STUB_END}`;

const STUB_BODY_EN = "### Agent Baton (Handoff) Guard Stub (Contract v2.19.0 · Details in $(lab path handoffs)/README.md)\n\n**Mandatory Preflight**\n- **CLI Form**: Always use `baton <op>` or `handoff <op>` (PATH shim → central engine; self-healing with `baton link`). If command not found: run `baton link` (or `handoff link`) or reinstall via `npm link`.\n- Before calling `show/receipt/deliver/accept/reject/check`, you **MUST** run `baton status` (or `handoff status`; executor cold start uses `baton status --for <lane|target>`) and have its output in context.\n- **Status Semantics (v2.19.0 · 5-State Lifecycle)**: \"In Progress\" = unclosed (`status ≠ closed`) and assigned to current party. **Pending = `draft` + `forwarded`**—assigned to me means I start work. `received` = receipt drafted (awaiting delivery); `delivered` = final delivery complete (awaiting audit); `closed` = audit closed.\n- **Final Delivery & Settle Mechanism (v2.19.0 · Anti-Race & Session Settle)**: Landing a receipt file does NOT equal session completion. The executor MUST explicitly mark delivery via `baton deliver <ID>` (or `baton receipt <ID> --deliver`); the wait probe initiates a settle window upon delivery, waiting for the executor session to fully conclude before waking the initiator with Exit 0. Before deliver, initiator wait probe will NOT wake up, and accept hard-fails. Initiators MUST NOT modify Backlog or specs before final delivery.\n- Target ID must be \"In Progress\" and assigned to current party (intra-repo: `to_lane == current lane`; cross-repo: located in target inbox and unclosed). If not found → halt and report.\n- Unspecified ID with multiple pending tasks → list candidates for human selection, do not guess.\n- Status snapshot before receipt must be **< 60 minutes old** (rerun if stale; deliver auto-refreshes during long task wrap-up).\n- Intra-repo prioritizes frontmatter `workspace` (same/separate); disable mtime heuristics.\n- Executor **only writes receipt / deliver**, **never calls accept/reject**.\n- **Anti-Premature / Counterfeit Receipts**: Submit receipts ONLY when all acceptance criteria **have actually passed in execution**. Intermediate blockers, runtime/environment conflicts, or ongoing discussions **must be recorded in reviews/ or reported in conversation—never submit a premature receipt claiming \"Verified\"**.\n- Single source of truth for receipt body = `$(lab path handoffs)/RESPONSE-TEMPLATE.md`: copy its skeleton (including evidence fields). Do not improvise.\n- **Evidence Hard Gate (v2.12.3)**: Receipts must include verifiable evidence `--evidence-paths \"file1,...\"` / `--evidence-commits \"<sha>\"` (or `--evidence-note \"<reason>\"` if no code changed). Claimed paths must exist and commits must resolve via `git cat-file -e`. Declaration without modification = counterfeit receipt.\n- Wrap up must pass `baton check` (or `handoff check`) with exit 0 (non-empty body + ## sections + status/verdict anchor).\n- **Reply Ending (Baton Pass Prompt Standard)**: When initiating a handoff (outbound), the last section of your reply **MUST be the Baton Pass Prompt (adapted by local AI to the user's active language: e.g. `## Baton Pass Prompt` in English, `## 交接提示词` in Chinese)**. Title, instructions, and the command MUST be strictly separated, enclosing the command in a standalone code block (```text) for one-click human copying (no text after this block). When submitting a receipt (inbound), initiator wait probe auto-wakes; no receipt prompt needed.\n- **Audit Action Contract (v2.13 · to_lane=audit mandatory)**: Auditor **MUST NOT merely read code statically**—must **independently execute** all tests and verification commands in terminal. Self-reports (\"tests passed\") are unverified claims and must not be blindly trusted.\n- **Natural Role Mapping (v2.13)**: Never use repo name or lane slug as conversational role. Outbound = `Please [Role] take handoff: <path> (<topic>)`. Roles map from lane (impl→Implementation / audit→Audit / arch→Architecture; customizable in `.handoff-hub.json`).\n- **Anti-Premature Closure & Double-Blind Audit (v2.16.0)**: Receipts **must be independently authored by to_lane**—from_lane is forbidden from self-authoring. Audit dispatch issues a one-time `Audit Nonce`, required via `--audit-nonce \"<nonce>\"`. Supports `baton forward --blind` for cognitive desensitization.\n\n**Minimal Workflow (Outbound = Create/Forward · Mandatory Closure)**\n1. `baton new <target|lane> <type> \"<Title>\"` (or `handoff new ...`) and fill body\n2. **Forward and listen in background (Mandatory)**:\n   Run `baton forward <ID> --wait` (managed by AI host as background task; human terminals can use `--daemon` to detach; add `--blind` for double-blind audit)\n   — Mandatory for both same and separate workspaces; auto-wakes upon final delivery and session settle with exit 0 for independent audit.\n3. **Output Baton Pass Prompt (Tail block standard)**: Local AI adapts to the user's active language with title, instructions, and code block separated:\n   ## Baton Pass Prompt\n   > Copy the prompt below to pass to the receiver Agent:\n   ```text\n   Please [Target Role] take handoff: <path> (<topic>)\n   ```\n\n**Minimal Workflow (Inbound = Receive/Receipt/Deliver)**\n1. `baton status --for <lane|target>`\n2. Filter pending (`draft`/`forwarded`) assigned to current party → confirm target ID\n3. `baton show <ID>`\n4. Minimal scoped modification (only files belonging to this lane)\n5. Write receipt only after all tests pass: follow `$(lab path handoffs)/RESPONSE-TEMPLATE.md` → run `baton receipt <ID> -n \"<Body>\" --evidence-paths \"file1,...\" --evidence-commits \"<sha>\"` (or atomic `baton receipt <ID> --deliver ...`). (audit requires `--audit-nonce \"<nonce>\"`; blocked progress goes to reviews/ only, never submit premature receipt)\n6. `baton check` (verify evidence and anchors pass, exit 0)\n7. **Final Delivery & Session Wrap-Up**: Run `baton deliver <ID>` (marks delivered and enters settle buffer before waking initiator; session wraps up).\n\nSee `$(lab path handoffs)/AGENT-GUIDE.md` for full Preflight.";
const STUB_SHA_EN = crypto.createHash('sha256').update(STUB_BODY_EN).digest('hex').slice(0, 8);
const STUB_BLOCK_EN = `${STUB_BEGIN}\n<!-- generated — do not edit -->\n<!-- stub:sha256:${STUB_SHA_EN} -->\n${STUB_BODY_EN}\n${STUB_END}`;

const STUB_BODY = STUB_BODY_ZH;
const STUB_SHA = STUB_SHA_ZH;
const STUB_BLOCK = STUB_BLOCK_ZH;

function safeWrite(file, content) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
    return true;
  } catch (e) {
    console.error(`⚠️ 写入失败（跳过，不中断其余目标）: ${file} — ${e.code || e.message}`);
    return false;
  }
}

function checkStubCarrier() {
  const home = process.env.HOME || '';
  const cdir = process.cwd();
  const targets = [
    path.join(cdir, 'AGENTS.md'),
    path.join(cdir, 'CLAUDE.md'),
    path.join(cdir, 'README.md'),
  ];
  if (home) {
    targets.push(path.join(home, '.claude/CLAUDE.md'));
    targets.push(path.join(home, '.config/opencode/AGENTS.md'));
  }
  if (fs.existsSync(path.join(cdir, 'GEMINI.md'))) {
    targets.push(path.join(cdir, 'GEMINI.md'));
  }
  const stdZH = STUB_CANON(STUB_BLOCK_ZH);
  const stdEN = STUB_CANON(STUB_BLOCK_EN);
  const problems = [];
  for (const p of targets) {
    if (!fs.existsSync(p)) continue;
    const txt = fs.readFileSync(p, 'utf8');
    const regions = scanStub(txt);
    if (!regions.length) continue; // 无桩（手写指针）→ 不在此校验
    if (regions.length > 1) { problems.push(`[桩] 载体含 ${regions.length} 份接入桩（应恰 1）: ${p}`); continue; }
    if (!regions[0].includes(STUB_BEGIN)) { problems.push(`[桩] 载体缺标准 marker（应含 ${STUB_BEGIN}）: ${p}`); continue; }
    const canon = STUB_CANON(regions[0]);
    if (canon !== stdZH && canon !== stdEN) {
      problems.push(`[桩] 载体漂移/被手工改: ${p} → 跑 baton install 更新`);
      continue;
    }
    const shaM = regions[0].match(/<!-- stub:sha256:([0-9a-f]+) -->/);
    if (shaM && shaM[1] !== STUB_SHA_ZH && shaM[1] !== STUB_SHA_EN) {
      problems.push(`[桩] 载体内嵌 sha(${shaM[1]}) 校验失败: ${p}`);
    }
  }
  if (problems.length) {
    console.error(`❌ check 未通过（桩载体 ${problems.length} 个问题）:`);
    for (const x of problems) console.error('  - ' + x);
    process.exit(1);
  }
}

function extractTitle(body) {
  const m = body.match(/^# (.+)$/m);
  return m ? m[1].trim() : '(无标题)';
}

function cmdCheck() {
  checkStubCarrier();
  // CLI 可达性（热修批次八）：先于模式分支，跨仓/仓内都门禁
  const cliProblems = [];
  const cliWarnings = [];
  checkCliReachable(cliProblems, cliWarnings);
  for (const w of cliWarnings) console.log('⚠️ ' + w);
  if (cliProblems.length) {
    console.error(`❌ check 未通过（CLI 可达性 · ${cliProblems.length} 个问题）:`);
    for (const p of cliProblems) console.error('  - ' + p);
    process.exit(1);
  }
  if (MODE === 'intra-repo') return cmdCheckIntra();
  // ── 跨仓模式（逐字保留旧逻辑）──
  const problems = [];
  const hAll = fs.existsSync(H_DIR) ? fs.readdirSync(H_DIR).filter(f => f.endsWith('.md')) : [];
  for (const f of hAll.sort()) {
    const p = path.join(H_DIR, f);
    if (!H_RE.test(f)) { problems.push(`[交接] 文件名不符合命名规范: ${f}`); continue; }
    const raw = fs.readFileSync(p, 'utf8');
    const fm = readFM(raw);
    if (!fm) { problems.push(`[交接] 缺 frontmatter: ${f}`); continue; }
    const id = f.replace(/\.md$/, '');
    if (fm.handoff_id !== id) problems.push(`[交接] handoff_id(${fm.handoff_id}) ≠ 文件名: ${f}`);
    if (!TARGETS.has(fm.target)) problems.push(`[交接] target 非法(${fm.target}): ${f}`);
    if (!TYPES.has(fm.type)) problems.push(`[交接] type 非法(${fm.type}): ${f}`);
    if (!STATUSES.has(fm.status)) problems.push(`[交接] status 非法(${fm.status}): ${f}`);
    if ((fm.status === 'received' || fm.status === 'delivered' || fm.status === 'closed') && !fs.existsSync(path.join(R_DIR, `${id}-resp.md`)))
      problems.push(`[交接] status=${fm.status} 但缺回执 receipts/${id}-resp.md: ${f}`);
    if (fm.status === 'closed' && !fm.closed)
      problems.push(`[交接] status=closed 但缺 closed 日期: ${f}`);
    if (fm.status === 'closed' && fm.created && fm.created >= '2026-11-08' && !fm.delivered_at)
      problems.push(`[交接] status=closed 但缺 delivered_at 交付时间标记（新交接须经 baton deliver 交付再闭环）: ${f}`);
    if (fm.status === 'closed' && !/^## (验收记录|Audit Record|Acceptance Record)/im.test(raw))
      problems.push(`[交接] status=closed 但缺「验收记录」节（须经 handoff accept <id> -n "<结论>" 闭环）: ${f}`);
  }
  const rAll = fs.existsSync(R_DIR) ? fs.readdirSync(R_DIR).filter(f => f.endsWith('.md')) : [];
  for (const f of rAll.sort()) {
    if (!R_RE.test(f)) { problems.push(`[回执] 文件名不符合命名规范: ${f}`); continue; }
    const raw = fs.readFileSync(path.join(R_DIR, f), 'utf8');
    const fm = readFM(raw);
    if (!fm || !fm.handoff_id) { problems.push(`[回执] 缺 handoff_id frontmatter: ${f}`); continue; }
    if (!fs.existsSync(path.join(H_DIR, `${fm.handoff_id}.md`)))
      problems.push(`[回执] 孤儿回执（无对应交接）: ${f}`);
    checkReceiptBody(f, fm, raw, problems);
    checkReceiptPrompt(f, fm, raw, problems);
    { const w = []; evidenceProblems(normalizeEvidence(fm), gateDate(fm), { mode: 'cross', workspace: undefined }, problems, w); for (const x of w) console.log('⚠️ ' + x); }
  }
  if (problems.length) {
    console.error(`❌ check 未通过（${problems.length} 个问题）:`);
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.log(`✅ check 通过: ${hAll.length} 份交接 / ${rAll.length} 份回执，全部合规`);
  reportSize();
  reportMissingReceiptPrompt();
  reportStalePending();
}

// 仓内模式门禁：按 ROOT 模式（配置）分支；per-file `mode` 仅作一致性校验，不替代根模式判定
function cmdCheckIntra() {
  const problems = [];
  const lanes = new Set((HUB_CONFIG.lanes || []).map(s => String(s).toLowerCase()));
  const types = new Set([...(HUB_CONFIG.types || []), ...INTRA_TYPES].map(s => String(s).toLowerCase()));
  if (!lanes.size) problems.push(`[配置] .handoff-hub.json 缺 lanes（仓内交接靠 lane 路由）`);
  const hAll = fs.existsSync(H_DIR) ? fs.readdirSync(H_DIR).filter(f => f.endsWith('.md')) : [];
  for (const f of hAll.sort()) {
    const p = path.join(H_DIR, f);
    if (!INTRA_ID_RE.test(f)) { problems.push(`[交接] 文件名不符合仓内命名规范（<LANE>-<YYYYMMDD>-<NN>-<TYPE>）: ${f}`); continue; }
    const raw = fs.readFileSync(p, 'utf8');
    const fm = readFM(raw);
    if (!fm) { problems.push(`[交接] 缺 frontmatter: ${f}`); continue; }
    const id = f.replace(/\.md$/, '');
    if (fm.handoff_id !== id) problems.push(`[交接] handoff_id(${fm.handoff_id}) ≠ 文件名: ${f}`);
    if (fm.mode !== 'intra-repo') problems.push(`[交接] mode 应为 intra-repo，但为 ${fm.mode}: ${f}`);
    if (!fm.to_lane || !lanes.has(String(fm.to_lane).toLowerCase())) problems.push(`[交接] to_lane(${fm.to_lane}) 不在配置 lanes(${[...lanes].join('/')}): ${f}`);
    if (fm.from_lane && !lanes.has(String(fm.from_lane).toLowerCase())) problems.push(`[交接] from_lane(${fm.from_lane}) 不在配置 lanes: ${f}`);
    if (!types.has(String(fm.type).toLowerCase())) problems.push(`[交接] type 非法(${fm.type}): ${f}`);
    if (!STATUSES.has(fm.status)) problems.push(`[交接] status 非法(${fm.status}): ${f}`);
    if (fm.workspace && !['same', 'separate'].includes(fm.workspace)) problems.push(`[交接] workspace 非法(${fm.workspace}): ${f}`);
    if ((fm.status === 'received' || fm.status === 'delivered' || fm.status === 'closed') && !fs.existsSync(path.join(R_DIR, `${id}-resp.md`)))
      problems.push(`[交接] status=${fm.status} 但缺回执 receipts/${id}-resp.md: ${f}`);
    if (fm.status === 'closed' && !fm.closed)
      problems.push(`[交接] status=closed 但缺 closed 日期: ${f}`);
    if (fm.status === 'closed' && fm.created && fm.created >= '2026-11-08' && !fm.delivered_at)
      problems.push(`[交接] status=closed 但缺 delivered_at 交付时间标记（新交接须经 baton deliver 交付再闭环）: ${f}`);
    if (fm.status === 'closed' && !/^## (验收记录|Audit Record|Acceptance Record)/im.test(raw))
      problems.push(`[交接] status=closed 但缺「验收记录」节（须经 handoff accept <id> -n "<结论>" 闭环）: ${f}`);
  }
  const rAll = fs.existsSync(R_DIR) ? fs.readdirSync(R_DIR).filter(f => f.endsWith('.md')) : [];
  for (const f of rAll.sort()) {
    if (!INTRA_RESP_RE.test(f)) { problems.push(`[回执] 文件名不符合命名规范: ${f}`); continue; }
    const raw = fs.readFileSync(path.join(R_DIR, f), 'utf8');
    const fm = readFM(raw);
    if (!fm || !fm.handoff_id) { problems.push(`[回执] 缺 handoff_id frontmatter: ${f}`); continue; }
    if (!fs.existsSync(path.join(H_DIR, `${fm.handoff_id}.md`)))
      problems.push(`[回执] 孤儿回执（无对应交接）: ${f}`);
    // 防提前闭环（v2.13）：回执 author_lane 即其所属交接的发起方 from_lane ⇒ 发起方自填回执，破坏审计制衡。
    if (fm.author_lane) {
      try {
        const hFm0 = readFM(fs.readFileSync(path.join(H_DIR, `${fm.handoff_id}.md`), 'utf8')) || {};
        if (hFm0.from_lane && String(fm.author_lane).toLowerCase() === String(hFm0.from_lane).toLowerCase()) {
          problems.push(`[回执] 自填回执（author_lane=${fm.author_lane} == 交接 from_lane=${hFm0.from_lane}）：${f} —— 回执必须由接收方 to_lane 独立撰写，发起方自填破坏独立审计制衡`);
        }
      } catch { /* 交接不可读不阻断其它校验 */ }
    }
    checkReceiptBody(f, fm, raw, problems);
    let ws;
    try { ws = readFM(fs.readFileSync(path.join(H_DIR, `${fm.handoff_id}.md`), 'utf8'))?.workspace; } catch {}
    checkReceiptPrompt(f, fm, raw, problems);
    { const w = []; evidenceProblems(normalizeEvidence(fm), gateDate(fm), { mode: 'intra-repo', workspace: ws }, problems, w); for (const x of w) console.log('⚠️ ' + x); }
  }
  if (problems.length) {
    console.error(`❌ check 未通过（仓内模式 · ${problems.length} 个问题）:`);
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.log(`✅ check 通过（仓内模式）: ${hAll.length} 份交接 / ${rAll.length} 份回执，全部合规`);
  reportSize();
  reportStalePending();
}

/** 体积提示（**非阻断** · 契约 v2.6 的体积预算）。
 *
 * 为什么只查契约生效后（2026-08-31 起）的文档：存量是历史证据，为体积回改等于毁证据；
 * 全量报会把 30+ 份旧文档刷成噪音，反而没人看真正该改的那份。
 * 为什么不设成硬失败：同上——体积是纪律不是合规，用可见性约束比用 exit code 合适。 */
const SIZE_BUDGET = { handoffs: 60, receipts: 50 };
const SIZE_SINCE = '2026-08-31';
function reportSize() {
  const rows = [];
  for (const [dir, kind] of [[H_DIR, 'handoffs'], [R_DIR, 'receipts']]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.md'))) {
      const raw = fs.readFileSync(path.join(dir, f), 'utf8');
      const fm = readFM(raw);
      const made = fm?.created || fm?.date;
      if (!made || String(made) < SIZE_SINCE) continue; // 无日期或早于契约生效日 = 存量，不报
      const lines = raw.split('\n').length;
      if (lines > SIZE_BUDGET[kind]) rows.push({ f, kind, lines, budget: SIZE_BUDGET[kind] });
    }
  }
  if (!rows.length) return;
  rows.sort((a, b) => b.lines - a.lines);
  console.log(`📏 体积提示（${SIZE_SINCE} 起的文档 · 预算 交接≤60 行 / 回执≤50 行）：${rows.length} 份超限`);
  for (const r of rows) console.log(`   ${r.lines} 行（预算 ${r.budget}） ${r.kind}/${r.f}`);
  console.log('   超限 = 把该放外链（reviews/）的背景论证抄进了正文。');
}

/** 回执「转递提示词」缺失提示（**非阻断** · 契约 v2.8.1）。
 *
 * 为什么需要：2026-09-10 排查发现 43 份回执中 31 份照抄 RESPONSE-TEMPLATE.md 骨架、
 * 100% 漏写「转递提示词」节——当时该要求只写在骨架之外的散文里，agent 复制骨架时带不走。
 * 骨架已内置该节（L70-71），但漏写仍无机器信号，故加此提示兜底。
 * 为什么只查 2026-09-10 起：骨架修复日之前的回执补写无意义（多已闭环），且 30+ 份存量
 * 全量报会刷成噪音，反而没人看真正该改的那份（同 reportSize 的处理原则）。
 * 为什么排除 COREML-*：同工作区侧免转递，契约明载不适用此话术。
 * 为什么不设硬失败：用可见性约束比 exit code 合适——硬校验会让存量立刻不合规。 */
const PROMPT_SINCE = '2026-09-10';
function reportMissingReceiptPrompt() {
  if (!fs.existsSync(R_DIR)) return;
  const rows = [];
  for (const f of fs.readdirSync(R_DIR).filter(x => x.endsWith('.md'))) {
    if (f.startsWith('COREML-')) continue; // 同工作区侧免转递
    const raw = fs.readFileSync(path.join(R_DIR, f), 'utf8');
    const fm = readFM(raw);
    const made = fm?.date;
    if (!made || String(made) < PROMPT_SINCE) continue; // 无日期或早于骨架修复日 = 存量，不报
    // 必须锚定行首：只认「提示词行」本身，不认正文里引用/描述该话术的文字
    // （2026-09-10 教训：宽松写法 /登记回执/ 把 PROSPERO-20260910-01-bug-resp.md 第 31 行
    //  的改动描述误判为「已含」，产生假阴性）。行首可带一个反引号（提示词常写成 `xxx` 行内代码）。
    // v2.8.2：新式「请收 <写回执仓> 回执：」与旧式「登记回执：」均认（存量回执/旧记忆不回改）。
    if (/^`?(登记回执|请收[^\n：]*回执|请【[^\n】]*】查收【[^\n】]*】回执|Please review[^\n:]*receipt|Register receipt)[：:]/im.test(raw)) continue;
    rows.push(f);
  }
  if (!rows.length) return;
  console.log(`🔔 回执转递提示词缺失（${PROMPT_SINCE} 起的回执 · 非阻断）：${rows.length} 份`);
  for (const f of rows.sort()) console.log(`   receipts/${f}`);
  console.log('   缺失 = 用户得自己拼提示词。补法：回执末尾加「## 转递提示词（必含 · 供用户原样复制）」节 + 一行可复制交付行（新式「请收 <本仓> 回执：<路径>（…）」或旧式「登记回执：<路径>」）。');
}

/** 待执行滞留提示（**非阻断** · v2.12.5）。
 *
 * 为什么需要：draft/forwarded 是「该执行方动工」的待办态，此前只有 status 输出可见、
 * 躺多久都零红灯——与 v2.7「严禁据此判不处理」配套的机器信号：交接落归属方 N 天未推进，
 * 执行方漏接（B 窗口只读不执行）或发起方漏催，check 至少要指名道姓。
 * 为什么不设硬失败：同 reportSize/reportMissingReceiptPrompt——滞留是协作节奏问题不是
 * 合规问题，用可见性约束比 exit code 合适（存量大量历史 draft 会把 check 立刻打红）。
 * 7 天阈值：对齐人读周节奏；created 取交接创建日（发起方时间戳，非执行方可篡改）。 */
const STALE_PENDING_DAYS = 7;
function reportStalePending() {
  if (!fs.existsSync(H_DIR)) return;
  const re = MODE === 'intra-repo' ? INTRA_ID_RE : H_RE;
  const rows = [];
  for (const f of listMdFiles(H_DIR, re)) {
    const fm = readFM(fs.readFileSync(path.join(H_DIR, f), 'utf8'));
    if (!fm || (fm.status !== 'draft' && fm.status !== 'forwarded')) continue;
    const created = String(fm.created || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(created)) continue;
    const age = Math.floor((Date.now() - new Date(created + 'T00:00:00Z').getTime()) / 86400000);
    if (age >= STALE_PENDING_DAYS) rows.push({ id: fm.handoff_id, status: fm.status, age });
  }
  if (!rows.length) return;
  rows.sort((a, b) => b.age - a.age);
  console.log(`⏳ 待执行滞留（draft/forwarded ≥${STALE_PENDING_DAYS} 天未推进 · 非阻断）：${rows.length} 项`);
  for (const r of rows) console.log(`   ${r.age} 天 ${r.status}  ${r.id}`);
  console.log(`   滞留 = 交接已落归属方但未见动工/回执——执行方跑 \`handoff status --for <本方>\` 认领开工；发起方该催办（status --json 可查）。`);
}

/** 当前工作区归属哪个仓库（用于方向自检）。
 *
 * 为什么需要：prompt 是「发送方 → 转递给依赖方」的工具。若调用者所在仓库
 * 恰好就是交接的 target，说明调用者本身即接收方，再生成转递话术等于把交接
 * 转给自己（2026-09-01 SWOOP-20260901-02 事故：Swoop agent 在 Swoop 工作区
 * 对 target:swoop 的交接跑 prompt，输出「复制给 swoop Agent」）。
 * 判定不了时返回 null 放行——宁可漏拦，不可误伤合法的发送方场景。 */
function detectRepo(cwd) {
  try {
    const url = execFileSync('git', ['-C', cwd, 'remote', 'get-url', 'origin'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().toLowerCase();
    for (const t of TARGETS) {
      if (url.includes(`/${t}.git`) || url.endsWith(`/${t}`)) return t;
    }
  } catch { /* 非 git 目录或无 origin → 回退到目录名 */ }
  try {
    const base = path.basename(cwd).toLowerCase();
    if (TARGETS.has(base)) return base;
  } catch { /* cwd 异常 → 放行 */ }
  return null;
}

function cmdPrompt(args) {
  const [id] = args.filter(a => !a.startsWith('--'));
  if (!id) { console.error('用法: handoff prompt <id>'); process.exit(2); }
  const hFile = path.join(H_DIR, `${id}.md`);
  if (!fs.existsSync(hFile)) { console.error('找不到交接: ' + hFile); process.exit(1); }
  const content = fs.readFileSync(hFile, 'utf8');
  const title = extractTitle(content.replace(/^---\n[\s\S]*?\n---\n/, ''));
  const isZh = detectLang() === 'zh';
  const display = hFile.startsWith(os.homedir()) ? '~' + hFile.slice(os.homedir().length) : hFile;

  if (MODE === 'intra-repo') {
    const fm = readFM(content) || {};
    const ws = fm.workspace || 'same';
    const toRole = resolveLaneRole(fm.to_lane) || fm.to_lane || (isZh ? '执行方' : 'Executor');
    // 审计动作契约（v2.13）：to_lane=audit 时注入强制审计动作，提示词与接入桩同步。
    const auditContract = (String(fm.to_lane || '').toLowerCase() === 'audit')
      ? (isZh
          ? `\n（⚠️ 审计动作契约 · to_lane=audit）：审计方（【${toRole}】）**严禁仅静态读码**——必须在终端**独立执行**交接文档「验收判据」中的**所有测试与校验命令**，以实测输出为唯一准绳，**严禁采信自报**（执行方回执里的「已通过」一律视为待验证声明）。`
          : `\n(⚠️ Audit Action Contract · to_lane=audit): The auditor ([${toRole}]) MUST NOT merely read code statically — all verification and test commands in "Acceptance Criteria" MUST be executed independently in the terminal. Never rely on self-reported claims in the receipt.`)
      : '';

    if (isZh) {
      console.log(`📋 仓内交接 (${id}) · workspace=${ws}:`);
      console.log(`   主题: ${title}`);
      console.log(`\n## 交接提示词\n`);
      console.log(`> 直接复制下方提示词，发送给接收方 Agent 接单：\n`);
      console.log(`\`\`\`text`);
      console.log(`请【${toRole}】接单：${display}（${title}）`);
      console.log(`\`\`\`\n`);
      if (ws !== 'same') {
        console.log(`（发送方注 · 异工作区请先同步工作树。）\n`);
      } else {
        console.log(`（若已挂起后台监听，回执登记后状态机会自动感知唤醒发起方闭环。）\n`);
      }
      if (auditContract) console.log(auditContract);
    } else {
      console.log(`📋 Intra-Repo Baton (${id}) · workspace=${ws}:`);
      console.log(`   Title: ${title}`);
      console.log(`\n## Baton Pass Prompt\n`);
      console.log(`> Copy the prompt below to pass to the receiver Agent:\n`);
      console.log(`\`\`\`text`);
      console.log(`Please [${toRole}] take handoff: ${display} (${title})`);
      console.log(`\`\`\`\n`);
      if (ws !== 'same') {
        console.log(`(Sender note: separate workspace detected, please sync git tree first.)\n`);
      } else {
        console.log(`(If background listener is running, the state machine will automatically wake up upon receipt.)\n`);
      }
      if (auditContract) console.log(auditContract);
    }
    return;
  }

  // ── 方向自检（硬护栏）──
  // 调用者所在仓库 == 交接 target ⇒ 调用者就是接收方 ⇒ prompt 的产物会是
  // 「把这份交接转给你自己」，属事故，直接拦下并指明正确动作。
  const pTarget = readFM(content)?.target;
  const cwdRepo = detectRepo(process.cwd());
  if (cwdRepo && pTarget && cwdRepo === pTarget) {
    if (isZh) {
      console.error(
        `⛔ 方向错误：当前工作区就是 ${cwdRepo}，而你正要处理的是 target:${pTarget} 的交接——你就是接收方。\n` +
        `   prompt 是「发送方 → 转递给依赖方」的工具，用它等于把交接转给你自己\n` +
        `   （2026-09-01 SWOOP-20260901-02 事故即此）。\n\n` +
        `   正确动作：直接开工执行交接 → 完工写 receipts/${id}-resp.md → handoff receipt ${id}\n` +
        `   接收方处理交接：用自然语言「处理交接 ${id}」即可（读交接「给执行方」节 + RESPONSE-TEMPLATE.md 写回执）。`
      );
    } else {
      console.error(
        `⛔ Direction Error: Current workspace is ${cwdRepo}, but you are processing target:${pTarget} handoff — you are the receiver.\n` +
        `   prompt is for sender → pass to receiver. Running it passes the task to yourself.\n\n` +
        `   Correct action: execute the task → write receipts/${id}-resp.md → baton receipt ${id}\n` +
        `   Processing handoff: read handoff and follow RESPONSE-TEMPLATE.md to write receipt.`
      );
    }
    process.exit(3);
  }

  const targetLabel = pTarget ? (TARGET_LABELS[pTarget] || pTarget) : (isZh ? '依赖方' : 'dependency');
  if (isZh) {
    console.log(`📋 跨仓交接 (${id}) · target=${pTarget || 'unknown'}:`);
    console.log(`   主题: ${title}`);
    console.log(`\n## 交接提示词\n`);
    console.log(`> 直接复制下方提示词，发送给接收方 Agent 接单：\n`);
    console.log(`\`\`\`text`);
    console.log(`请收 ${targetLabel} 交接：${display}（${title}）`);
    console.log(`\`\`\`\n`);
    console.log(`（若已挂起后台监听，回执登记后状态机会自动感知唤醒发起方闭环。）\n`);
  } else {
    console.log(`📋 Cross-Repo Baton (${id}) · target=${pTarget || 'unknown'}:`);
    console.log(`   Title: ${title}`);
    console.log(`\n## Baton Pass Prompt\n`);
    console.log(`> Copy the prompt below to pass to the receiver Agent:\n`);
    console.log(`\`\`\`text`);
    console.log(`Please [${targetLabel}] take handoff: ${display} (${title})`);
    console.log(`\`\`\`\n`);
    console.log(`(If background listener is running, the state machine will automatically wake up upon receipt.)\n`);
  }
}

function cmdInstall(args) {
  const home = process.env.HOME;
  const targets = [];
  if (!args.includes('--global')) {
    for (const f of ['AGENTS.md', 'CLAUDE.md']) targets.push(path.join(process.cwd(), f));
    if (fs.existsSync(path.join(process.cwd(), 'GEMINI.md'))) {
      targets.push(path.join(process.cwd(), 'GEMINI.md'));
    }
  }
  if (!args.includes('--project')) {
    targets.push(path.join(home, '.claude/CLAUDE.md'), path.join(home, '.config/opencode/AGENTS.md'));
  }
  // include README if requested or default (v2.12)；--global 只装全局，不写 cwd README（F3）
  if (!args.includes('--no-readme') && !args.includes('--global')) {
    targets.push(path.join(process.cwd(), 'README.md'));
  }
  let changed = 0;
  let warned = 0;
  // 只装 prose 接入桩；/ 命令别名已于 v2.8 修订废除，不再写入任何 command 文件。
  for (const t of [...new Set(targets)]) {
    let c = '';
    try { c = fs.readFileSync(t, 'utf8'); } catch {}
    const regions = scanStub(c);
    if (regions.length) {
      // 剥掉全部历史/重复桩区块后，只落一份规范桩（幂等 + 去重修复）。
      // 仅在「被删区块的接缝」处规范化空行，保留用户其它排版（F4）。
      const re = (c.match(STUB_MARKER_RE) || []).length ? STUB_MARKER_RE : STUB_HEADING_RE;
      const cleaned = c.split(re)
        .map(p => p.replace(/^\n+/, '').replace(/\s+$/, ''))
        .filter(Boolean)
        .join('\n\n');
      const langArg = flagValue(args, '--lang');
      const lang = (langArg && langArg.toLowerCase().startsWith('zh')) ? 'zh' : (langArg ? 'en' : detectLang());
      const activeStubBlock = (lang === 'zh') ? STUB_BLOCK_ZH : STUB_BLOCK_EN;
      const next = (cleaned ? cleaned + '\n\n' : '') + activeStubBlock + '\n';
      if (next === c) { console.log(`↩️ 已是最新: ${t}`); continue; }
      if (!safeWrite(t, next)) { warned++; continue; }
      changed++;
      console.log(regions.length > 1 ? `🧹 去重 + 更新桩（原 ${regions.length} 份 → 1）: ${t}` : `🔁 桩已更新: ${t}`);
      continue;
    }
    if (c.includes('handoffs/README.md')) {
      // 手写指针（含 hub README 引用）但无标准桩标记 → install 无法刷新它，
      // 会随契约升版静默漂移（只能人工手改版本号）。告警而非静默跳过。
      console.log(`⚠️ 跳过（手写指针，无标准桩标记）: ${t}`);
      console.log(`   含 handoffs/README.md 但缺 ${STUB_BEGIN} → install 不会刷新它。`);
      console.log(`   对齐方法：用 $(lab path handoffs)/README.md 「接入桩」段的标准桩替换手写段，再跑 install（幂等）。`);
      warned++;
      continue;
    }
    const langArg = flagValue(args, '--lang');
    const lang = (langArg && langArg.toLowerCase().startsWith('zh')) ? 'zh' : (langArg ? 'en' : detectLang());
    const activeStubBlock = (lang === 'zh') ? STUB_BLOCK_ZH : STUB_BLOCK_EN;
    if (!safeWrite(t, (c ? c.replace(/\n*$/, '\n\n') : '') + activeStubBlock + '\n')) { warned++; continue; }
    changed++;
    console.log(`✅ 已写入桩: ${t}`);
  }
  if (changed) console.log(`完成（${changed} 个文件）。可重复执行，幂等。`);
  else if (warned) console.log(`无需变更，但 ${warned} 个文件为手写指针（见上告警），建议对齐标准桩。`);
  else console.log('全部无需变更。');
}

/** `handoff` 命令接入 PATH（幂等自愈 · v2.12.4 热修批次八）。
 *
 * 病根：v2.8 废除 / 别名时把 command shim 一并拆除，但文档与接入桩大量使用裸
 * `handoff <op>` 写法 → 消费方照敲即 `command not found: handoff`（2026-10-19 实报）。
 * 根修不是把文档改回全路径迁就「没有命令」，而是让裸命令真实存在——且必须是
 * **指向中央引擎的符号链接**（非副本）：引擎热修零传播、零版本漂移，与既有
 * 「无全局 bin、全部按路径调中央引擎」的审计结论兼容。
 *
 * 落点：优先 ~/.local/bin（在 PATH 且用户可写，无 sudo）；否则取 PATH 中第一个
 * home 下可写目录（跳过 .workbuddy/.nvm/.cargo 等受管运行时）；再不行则创建
 * ~/.local/bin 并提示加入 shell profile。绝不写 /Applications、/System、/Library、
 * /usr/local/bin（需 sudo 的系统/应用领地）。 */
function cmdLink(args) {
  const engine = fs.realpathSync(process.argv[1]);
  const remove = args.includes('--remove');
  const home = process.env.HOME;
  const canonical = path.join(home, '.local/bin', 'handoff');
  const inPath = (d) => String(process.env.PATH || '').split(path.delimiter).filter(Boolean).includes(d);
  const writable = (d) => { try { fs.accessSync(d, fs.constants.W_OK); return true; } catch { return false; } };

  // --remove：摘除 shim（测试/回退用）
  if (remove) {
    let removed = false;
    for (const d of [canonical, ...String(process.env.PATH || '').split(path.delimiter).filter(Boolean)]) {
      const p = path.join(d, 'handoff');
      try {
        if (fs.lstatSync(p).isSymbolicLink() && fs.realpathSync(p) === engine) { fs.unlinkSync(p); console.log(`🗑️ 已摘除: ${p}`); removed = true; }
      } catch { /* 不存在或非本引擎 shim → 跳过 */ }
    }
    if (!removed) console.log('未找到指向中央引擎的 handoff shim，无需摘除。');
    return;
  }

  // 引擎须可执行（shebang 已在；缺执行位时补上，否则 symlink 也无法运行）
  try { fs.chmodSync(engine, 0o755); } catch (e) { console.error(`⚠️ 无法补执行位: ${engine} — ${e.message}`); }

  // 选落点
  let dir = null;
  if (inPath(canonical.replace(/\/handoff$/, ''))) {
    try { fs.mkdirSync(path.dirname(canonical), { recursive: true }); } catch {}
    if (writable(path.dirname(canonical))) dir = path.dirname(canonical);
  }
  if (!dir) {
    for (const d of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
      if (!d.startsWith(home + path.sep)) continue;                                   // 只认 home 下目录
      if (/\/\.(workbuddy|nvm|cargo|swiftly|antigravity)\//.test(d + '/')) continue;   // 不污染受管运行时
      try { if (fs.statSync(d).isDirectory() && writable(d)) { dir = d; break; } } catch {}
    }
  }
  if (!dir) {
    dir = path.dirname(canonical);
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { console.error(`❌ 无法创建 ${dir}: ${e.message}`); process.exit(1); }
    if (!inPath(dir)) console.log(`⚠️ ${dir} 不在当前 PATH —— 请把它加入 shell profile，例如: echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc`);
  }

  const link = path.join(dir, 'handoff');
  try {
    const st = fs.lstatSync(link);
    if (st.isSymbolicLink()) {
      if (fs.realpathSync(link) === engine) {
        console.log(`↩️ 已是最新: ${link} → ${engine}`);
        verifyLink(link);
        return;
      }
      fs.unlinkSync(link);
      console.log(`🔁 原 shim 指向 ${fs.realpathSync(link)}（非中央引擎），改指: ${engine}`);
    } else {
      const bak = `${link}.bak-${todayISO()}`;
      fs.renameSync(link, bak);
      console.log(`📦 ${link} 是普通文件（非符号链接），已备份为 ${bak} 后重建为 shim。`);
    }
  } catch { /* 不存在 → 直接建 */ }
  fs.symlinkSync(engine, link);
  console.log(`✅ 已接入: ${link} → ${engine}`);
  verifyLink(link);
}
function verifyLink(link) {
  try {
    execFileSync(link, [], { stdio: ['ignore', 'pipe', 'pipe'] });
    console.log(`   验证通过: \`handoff\` 可直接调用（裸命令即中央引擎）。`);
  } catch (e) {
    console.error(`⚠️ shim 已建但验证调用失败: ${e.message}`);
  }
}

/** PATH 中解析 `handoff`（复刻 shell 查找：存在 + 可执行）。 */
function whichHandoff() {
  for (const d of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    const p = path.join(d, 'handoff');
    try { if (fs.statSync(p).isFile() && fs.accessSync(p, fs.constants.X_OK) === undefined) return p; } catch {}
  }
  return null;
}

/** CLI 可达性门禁（v2.12.4 热修批次八）：裸 `handoff` 必须可用且指向中央引擎。
 *
 * 为什么进 check：文档/接入桩全部按裸命令编写，「命令不存在」这类不一致只有机器信号
 * 才能在扩散前被拦住。shim 存在但当前 PATH 解析不到 = 环境问题（某工具未 source
 * profile），降级为 ⚠️ 提示加 PATH，不阻断收尾。 */
function checkCliReachable(problems, warnings) {
  let engine;
  try { engine = fs.realpathSync(process.argv[1]); } catch { return; }
  const viaPath = whichHandoff();
  if (viaPath) {
    let real = null;
    try { real = fs.realpathSync(viaPath); } catch {}
    if (real === engine) return;
    problems.push(`[CLI] handoff(${viaPath}) 指向 ${real || '失效目标'} ≠ 中央引擎(${engine}) → 自愈: node ${engine} link`);
    return;
  }
  const canonical = path.join(process.env.HOME, '.local/bin', 'handoff');
  try {
    if (fs.statSync(canonical).isFile() && fs.realpathSync(canonical) === engine) {
      warnings.push(`[CLI] shim 存在于 ${canonical} 但当前 PATH 解析不到 → 将 ~/.local/bin 加入 shell profile（echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc）`);
      return;
    }
  } catch {}
  problems.push(`[CLI] 裸 handoff 命令不在 PATH（文档/接入桩均按 \`handoff <op>\` 编写）→ 自愈: node ${engine} link`);
}

function cmdBrief(args) {
  if (MODE === 'intra-repo') { console.log('仓内模式无 inbox 转递概念（brief 仅用于跨仓 lab Hub）。'); return; }
  const only = args.find(a => !a.startsWith('-'));
  const I_DIR = path.join(ROOT, 'inbox');
  fs.mkdirSync(I_DIR, { recursive: true });
  const rows = [];
  for (const f of listMdFiles(H_DIR, H_RE)) {
    const raw = fs.readFileSync(path.join(H_DIR, f), 'utf8');
    const fm = readFM(raw);
    if (!fm || (fm.status !== 'draft' && fm.status !== 'forwarded')) continue;
    if (only && fm.target !== only.toLowerCase()) continue;
    rows.push({ id: fm.handoff_id, target: fm.target, title: extractTitle(raw.replace(/^---\n[\s\S]*?\n---\n/, '')) });
  }
  const targets = [...new Set(rows.map(r => r.target))];
  // v2.12.5：draft+forwarded 都收——① 仅收 draft 时，按 new→forward→brief 顺序跑的发起方会拿到空收件箱；
  // ② 驳回退回（status=forwarded）的返工单也必须重新出现在收件箱，否则执行方看不到退回理由的转递。
  if (!targets.length) { console.log('没有待办的交接（status=draft/forwarded）'); return; }
  for (const t of targets) {
    const items = rows.filter(r => r.target === t);
    // IGGLE-* = 反向发现（Swoop/Prospero → iggle），接收方 iggle 需适配本仓；
    // 其余 target = iggle → 依赖方，依赖方 agent 写回执、不改 iggle。
    // intro 不猜发送方（2026-10-18 批次七修）：旧写法「由依赖方发起」/「由 iggle 发起」二选一都写死了 iggle 枢纽，
    // hub 直接发起的 IGGLE-* 会被误印成「由依赖方发起，需你方适配」。发送方以交接 frontmatter / 转递话术为准。
    const reverse = t === 'iggle';
    const intro = reverse
      ? '以下交接接收方是你方（iggle），需适配本仓（发送方以交接 frontmatter / 转递话术为准）：'
      : '以下交接等待你方处理（发送方以交接 frontmatter / 转递话术为准）：';
    const req = reverse
      ? [
          '## 处理要求',
          `- 交接文档（必读）：${path.join(SCRIPT_ROOT, 'handoffs', '<ID>.md')}`,
          `- 适配本仓后回执写到：${path.join(SCRIPT_ROOT, 'receipts', '<ID>-resp.md')}（frontmatter 四字段 handoff_id / from_repo / to_repo / date）`,
          '- **执行方不 accept/reject**（只交回执 `handoff receipt <ID>`）；发起方收回执=审计，通过才闭环，不过则 reject 退回。',
          '',
        ]
      : [
          '## 处理要求',
          '- 回执规范（必读）：$(lab path handoffs)/RESPONSE-TEMPLATE.md',
          `- 完成后回执写到：${path.join(SCRIPT_ROOT, 'receipts', '<ID>-resp.md')}`,
          '- 禁止修改对方仓任何文件（只读排查定位行号）；用户是唯一转递通道。',
          '',
        ];
    const lines = [
      `# ${t} 收件箱（自动生成于 ${todayISO()} · 勿手编，由 handoff brief 重建）`,
      '',
      intro,
      '',
      ...items.flatMap(i => [`## ${i.id}`, '', `- 主题：${i.title}`, `- 文档：${path.join(SCRIPT_ROOT, 'handoffs', `${i.id}.md`)}`, '']),
      ...req,
    ];
    fs.writeFileSync(path.join(I_DIR, `${t}.md`), lines.join('\n'));
    console.log(`📥 inbox/${t}.md ← ${items.map(i => i.id).join(', ')}`);
  }
  console.log('\n转递话术（复制给对应 Agent，固定一句话）:');
  for (const t of targets) console.log(`  → ${t}: 把 inbox/${t}.md 里的交接路径交给对方，说「请 ${t} 收交接 <路径>」（旧式「处理交接 <路径>」亦可；或让对方跑 \`handoff status --for ${t}\` 取实时待办后读 handoffs/<ID>.md）`);
}

function cmdSync() {
  if (MODE === 'intra-repo') { console.log('仓内模式无 sync（sync 为跨仓 lab Hub 自动登记回执）。'); return; }
  let n = 0;
  for (const f of listMdFiles(R_DIR, R_RE)) {
    const rf = readFM(fs.readFileSync(path.join(R_DIR, f), 'utf8'));
    if (!rf?.handoff_id) continue;
    const hp = path.join(H_DIR, `${rf.handoff_id}.md`);
    if (!fs.existsSync(hp)) continue;
    const hfm = readFM(fs.readFileSync(hp, 'utf8'));
    if (hfm.status !== 'draft' && hfm.status !== 'forwarded') continue;
    setFM(hp, { status: 'received', ...(typeof rf.needs_iggle_change === 'boolean' ? { needs_iggle_change: rf.needs_iggle_change } : {}) });
    console.log(`🔄 ${rf.handoff_id} → received（回执自动登记）`);
    n++;
  }
  console.log(n ? `sync 完成：${n} 项。` : '无需同步：所有回执均已登记。');
}

/** 版本失效回流（ZSpec ④）。
 *
 * ZSpec 的版本控制回流思想 = 区分 common 与平台版本，只对真正受影响的 Unit 失效：
 * - `--common`        ：共享版本变更 → 全员（所有未闭环交接）标 needs_iggle_change。
 * - `--platform <p>`  ：某平台专属版本变更 → 仅该平台下游（target == p 的未闭环交接）标 needs_iggle_change，
 *                       不波及其它平台 / common。
 * 已闭环（closed）的交接不标（结论已锁，无需重对）。 */
function cmdDrift(args) {
  if (MODE === 'intra-repo') { console.log('仓内模式无 drift（版本失效回流为跨仓概念）。'); return; }
  const common = args.includes('--common');
  const pIdx = args.indexOf('--platform');
  const platform = pIdx !== -1 ? args[pIdx + 1]?.toLowerCase() : undefined;
  if (!common && !platform) {
    console.error(`用法: handoff drift --common | handoff drift --platform <${[...TARGETS].join('|')}>`);
    process.exit(2);
  }
  if (common && platform) { console.error('只能指定一个维度：--common 或 --platform <name>'); process.exit(2); }
  if (platform && !TARGETS.has(platform)) { console.error(`--platform 必须是 ${[...TARGETS].join(' / ')}`); process.exit(2); }
  let marked = 0, skipped = 0;
  for (const f of listMdFiles(H_DIR, H_RE)) {
    const p = path.join(H_DIR, f);
    const fm = readFM(fs.readFileSync(p, 'utf8'));
    if (!fm || fm.status === 'closed') continue;
    const affected = common ? true : (fm.target === platform);
    if (affected) {
      setFM(p, { needs_iggle_change: true, version_drift: common ? 'common' : `platform:${platform}` });
      marked++;
      console.log(`  ↳ ${fm.handoff_id} → needs_iggle_change=true（维度：${common ? 'common' : 'platform=' + platform}）`);
    } else {
      skipped++;
    }
  }
  if (marked === 0 && skipped === 0) console.log('没有未闭环交接，无需回流。');
  else console.log(`✅ 失效回流完成：${marked} 份未闭环交接被标记需改动（${skipped} 份未受影响）。`);
}

/** 仓内模式初始化：在项目根生成 `.handoffs/`（子 Hub） + `.handoff-hub.json`（配置）。
 *
 * 与 lab Hub 的「不属于任何仓库」相反：仓内子 Hub 随代码走（提交进 git），
 * 因仓内双方同属一仓，「依赖方越界写入」的约束不存在（提案 §4.2）。 */
// 仓内接入桩（init 时生成 .handoffs/README.md）：教新项目 Agent 写转递/回执提示词的统一标准。
// 只放指针，不复制细则——真相源在 $(lab path handoffs)/（README 契约 + RESPONSE-TEMPLATE.md + handoff.mjs 的 prompt 模板）。
// 教训（RESPONSE-TEMPLATE.md 历史教训一）：凡要求 agent 产出固定文本，必须放进「可直接复制」的骨架/桩里，只写散文 = 没有。
const INTRA_README_TEMPLATE = `# 仓内交接子 Hub（intra-repo · <PROJECT>）

> 指针桩：命令语义与格式细则以 \`$(lab path handoffs)/\` 契约为单一来源，此处不复制细则。

## 一句话规则
- **lane**：<LANES>（接收通道 = 回执撰写方 = 交接文件名前缀）。
- **workspace 默认**：<WS_DEFAULT>。同工作区 = 共享工作树就地修改；异工作区才需先同步工作树。
- **一切操作只走 CLI**：\`handoff <new|show|forward|receipt|status|prompt|check|accept|reject>\`（若报 command not found 跑 handoff link 自愈；仓内无 install/sync/brief/open）。

## 生命周期
\`draft → forwarded → received → closed\`，frontmatter.status 是唯一真相源。
1. 发起：\`handoff new <lane> <type> "<标题>"\`（type: <TYPES>）。
2. 转递：\`handoff forward <ID>\`。
3. 回执：接收方写 \`receipts/<ID>-resp.md\`（frontmatter: handoff_id / mode / from_lane / to_lane / needs_change / date）→ \`handoff receipt <ID> [--needs-change]\`。
4. 闭环：**执行方不 accept/reject**；发起 lane 收回执=审计，通过后 \`handoff accept <ID> -n "<验收结论>"\`，不过用 \`handoff reject <ID> -n "<驳回理由>"\` 退回。
   - \`close_policy=self\`（\`.handoff-hub.json\`）时，\`continuation\` 由**后继会话**（to_lane）闭环：\`handoff accept <ID> -n "<验收结论>" --by <to_lane>\`（硬校验，缺/错 --by 即拒绝）。默认 \`sender\` 由发起 lane 闭环，\`--by\` 可选。

## 转递 / 回执提示词（统一标准 · 不要手写）
- **同工作区（workspace=same，默认）**：**出站任务转递免**（共享工作树，不搬）⇒ \`handoff prompt\` 此步跳过、收尾写「无需转递」；**但回执仍须含「## 转递提示词」节**（回执交付行不豁免，仅 \`COREML-*\` 免）。归属只看 frontmatter，**严禁用 mtime 推断**。
- **异工作区**：转递提示词用 \`handoff prompt <ID>\` 生成（真相源在 Hub 侧 handoff.mjs，一行式），不手写、不复制到仓侧。
- **回执**：写法与结尾话术单一来源在 \`$(lab path handoffs)/RESPONSE-TEMPLATE.md\`；仓内回执仅需 frontmatter 五字段 + 结论，跨仓专属节（是否需 iggle 改动 / 部署钉值）不适用。

## 硬门禁
- 收尾：\`handoff check\` 必须 exit 0，否则任务不算完成。
- 待办：接收方 \`handoff status --for <lane>\`；发起方裸 \`handoff status\`（MUST NOT 扫描 handoffs/）。
`;

function cmdInit(args) {
  let repoRoot = process.cwd();
  const ri = args.indexOf('--root');
  if (ri !== -1 && args[ri + 1]) repoRoot = args[ri + 1];
  const hubRoot = path.join(repoRoot, '.handoffs');
  const cfgPath = path.join(hubRoot, '.handoff-hub.json');
  if (fs.existsSync(cfgPath)) { console.error(`仓内子 Hub 已存在: ${cfgPath}`); process.exit(1); }
  const getArg = (flag, dflt) => { const i = args.indexOf(flag); return (i !== -1 && args[i + 1]) ? args[i + 1] : dflt; };
  const lanes = getArg('--lanes', 'impl,audit').split(',').map(s => s.trim()).filter(Boolean);
  const types = getArg('--types', 'task,bug,feature,question,continuation').split(',').map(s => s.trim()).filter(Boolean);
  const project = getArg('--project', path.basename(repoRoot)).toLowerCase();
  // 防串味：lane 名不得与跨仓 TARGET 撞名
  for (const l of lanes) if (TARGETS.has(l.toLowerCase())) {
    console.error(`lane 名「${l}」与跨仓 TARGET 撞名，请改用其它 lane 名`);
    process.exit(2);
  }
  const cfg = {
    mode: 'intra-repo',
    project,
    lanes,
    types,
    workspace_default: 'same',
    close_policy: 'sender',
  };
  fs.mkdirSync(path.join(hubRoot, 'handoffs'), { recursive: true });
  fs.mkdirSync(path.join(hubRoot, 'receipts'), { recursive: true });
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  // 接入桩：教新项目 Agent 写转递/回执提示词的统一标准（指针，不复制细则）
  const readme = INTRA_README_TEMPLATE
    .replaceAll('<PROJECT>', project)
    .replaceAll('<LANES>', lanes.join(' / '))
    .replaceAll('<WS_DEFAULT>', cfg.workspace_default)
    .replaceAll('<TYPES>', cfg.types.join(' / '));
  fs.writeFileSync(path.join(hubRoot, 'README.md'), readme, 'utf8');
  console.log(`✅ 已初始化仓内子 Hub: ${hubRoot}`);
  console.log(`   配置: ${cfgPath}`);
  console.log(`   接入桩: ${path.join(hubRoot, 'README.md')}`);
  console.log(`   lanes=${lanes.join('/')}  types=${types.join('/')}  workspace_default=${cfg.workspace_default}`);
  console.log(`   下一步: handoff new <lane> <type> "<标题>"`);
}

// 仓内 import：扫描旧 handoffs 目录，best-effort 分类，生成只读 STATUS.md（非搬移、非重写存量）。
// 默认 draft-only：仅文件名含 VERDICT/COMPLETE 才标 closed 候选，其余一律 draft；无法归类进「未判定」交人工。
// 依据提案 §12 迁移路径第 2 条：存量不重写、旧目录保留归档、STATUS.md 为生成物（非权威快照）。
function classifyIntraImport(file) {
  const base = file.replace(/\.md$/, '');
  const isResp = /-resp($|-)/i.test(base) || /^(RECEIPT|RESPONSE|ACCEPT)[-_]/i.test(base);
  const isHandoff = /^HANDOFF[-_]/i.test(base) && !isResp;
  const isAudit = /^(AUDIT|VERDICT)[-_]/i.test(base);
  const isClosed = /(COMPLETE|VERDICT)/i.test(base);
  let kind;
  if (isResp) kind = '回执';
  else if (isHandoff) kind = '交接';
  else if (isAudit) kind = '审计';
  else kind = '未判定';
  return { file, kind, status: isClosed ? 'closed候选' : 'draft' };
}

function cmdImport(args) {
  if (MODE !== 'intra-repo') { console.error('import 仅仓内模式可用（需 .handoff-hub.json）'); process.exit(2); }
  const fromIdx = args.indexOf('--from');
  const from = fromIdx !== -1 ? args[fromIdx + 1] : null;
  if (!from) { console.error('用法: handoff import --from <dir>'); process.exit(2); }
  const dir = path.resolve(from);
  if (!fs.existsSync(dir)) { console.error('目录不存在: ' + dir); process.exit(1); }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort();
  if (!files.length) { console.log('无 .md 文件: ' + dir); return; }
  const rows = files.map(classifyIntraImport);
  const byKind = {};
  for (const r of rows) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
  const closed = rows.filter(r => r.status === 'closed候选').length;

  const lines = [];
  lines.push(`# STATUS.md（只读快照 · 非权威 · 生成于 ${todayISO()}）`);
  lines.push('');
  lines.push('> 由 `handoff import --from <dir>` 生成。旧目录保留归档、存量文件未被改动；本快照仅供人类快速浏览，');
  lines.push('> 权威真相源 = .handoffs/handoffs/ 与 .handoffs/receipts/ 的 frontmatter（新交接才走状态机）。');
  lines.push('');
  lines.push('## 统计');
  lines.push(`- 扫描：${files.length} 个文件（${dir}）`);
  for (const k of ['交接', '回执', '审计', '未判定']) {
    if (byKind[k]) lines.push(`- ${k}：${byKind[k]}`);
  }
  lines.push(`- closed 候选（文件名含 VERDICT/COMPLETE）：${closed}`);
  lines.push('');
  const sections = [
    ['交接', r => r.kind === '交接'],
    ['回执', r => r.kind === '回执'],
    ['审计', r => r.kind === '审计'],
    ['未判定（人工）', r => r.kind === '未判定'],
  ];
  for (const [title, pred] of sections) {
    const list = rows.filter(pred);
    lines.push(`## ${title}（${list.length}）`);
    if (!list.length) lines.push('（无）');
    else {
      lines.push('| 文件 | 状态 |');
      lines.push('|---|---|');
      for (const r of list) lines.push(`| ${r.file} | ${r.status} |`);
    }
    lines.push('');
  }
  const out = path.join(ROOT, 'STATUS.md');
  fs.writeFileSync(out, lines.join('\n'), 'utf8');
  console.log(`✅ 已生成只读快照: ${out}`);
  console.log(`   扫描 ${files.length} 文件：交接 ${byKind['交接'] || 0} / 回执 ${byKind['回执'] || 0} / 审计 ${byKind['审计'] || 0} / 未判定 ${byKind['未判定'] || 0}`);
  console.log(`   默认 draft-only；closed 候选 ${closed} 个（VERDICT/COMPLETE）；未判定 ${byKind['未判定'] || 0} 个交人工。`);
  console.log(`   存量文件未改动；旧目录保留归档。`);
}

/** 解析时长字符串（支持 500ms, 30s, 30m, 1h 等；缺省单位为秒）。 */
function parseDuration(str, defaultSec = 1800) {
  if (!str) return defaultSec * 1000;
  const match = String(str).trim().match(/^(\d+)(ms|s|m|h|d)?$/i);
  if (!match) return defaultSec * 1000;
  const num = parseInt(match[1], 10);
  const unit = (match[2] || 's').toLowerCase();
  switch (unit) {
    case 'ms': return num;
    case 's': return num * 1000;
    case 'm': return num * 60 * 1000;
    case 'h': return num * 3600 * 1000;
    case 'd': return num * 86400 * 1000;
    default: return num * 1000;
  }
}

/** 格式化毫秒为人类友好形式。 */
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1).replace(/\.0$/, '')}m`;
  return `${(ms / 3600000).toFixed(1).replace(/\.0$/, '')}h`;
}

/** 打印 wait 唤醒摘要，引导发起方/审计方进行独立实测与闭环。 */
function printWaitWakeupSummary(id, hFile, rFile, hFm) {
  let rFm = {}, rText = '', conclusion = '';
  if (fs.existsSync(rFile)) {
    try {
      rText = fs.readFileSync(rFile, 'utf8');
      rFm = readFM(rText) || {};
      conclusion = extractConclusion(rText);
    } catch {}
  }
  const displayR = rFile.startsWith(os.homedir()) ? '~' + rFile.slice(os.homedir().length) : rFile;
  const displayH = hFile.startsWith(os.homedir()) ? '~' + hFile.slice(os.homedir().length) : hFile;
  const needsChange = Boolean(hFm?.needs_change || hFm?.needs_iggle_change || rFm?.needs_change || rFm?.needs_iggle_change);

  console.log(`\n==================================================`);
  console.log(`🎯 [交付已就绪] 交接回执已正式交付: ${id}`);
  console.log(`- 交接文档: ${displayH}`);
  console.log(`- 回执文件: ${displayR}`);
  if (MODE === 'intra-repo') {
    const fromRole = resolveLaneRole(rFm.from_lane || hFm?.to_lane) || '执行方';
    console.log(`- 回执来源: 【${fromRole}】(lane: ${rFm.from_lane || hFm?.to_lane || 'unknown'})`);
  } else {
    console.log(`- 回执来源: ${rFm.authorLabel || hFm?.target || '依赖方'}`);
  }
  if (hFm?.delivered_at || rFm?.delivered_at) {
    console.log(`- 交付时间: ${hFm?.delivered_at || rFm?.delivered_at}`);
  }
  if (conclusion) console.log(`- 结论摘要: ${conclusion}`);
  if (rFm.evidence_paths) console.log(`- 变更文件: ${rFm.evidence_paths}`);
  if (rFm.evidence_commits) console.log(`- 提交版本: ${rFm.evidence_commits}`);
  if (rFm.evidence_note) console.log(`- 证据说明: ${rFm.evidence_note}`);
  console.log(`- 需后续改动: ${needsChange ? '⚠️ 是 (needs_change=true)' : '✅ 否'}`);
  console.log(`==================================================`);
  console.log(`👉 下一步（发起方/审计方核心职责）：`);
  console.log(`1. 严禁仅静态读码或自报采信！`);
  console.log(`2. ⚠️ 严禁在完成独立实测验收前，提前将未定稿回执结论写入主线 Backlog 或规格规划！`);
  console.log(`3. 请在终端独立执行验收命令与证据核验：`);
  console.log(`   baton show ${id}`);
  console.log(`4. 验收通过后闭环：`);
  console.log(`   baton close ${id} -n "已独立实测验证..."`);
  console.log(`5. 如验收不通过则驳回重做：`);
  console.log(`   baton reject ${id} -n "驳回原因与缺失点..."\n`);

  if (process.env.BATON_DAEMON && process.platform === 'darwin') {
    try {
      execFileSync('osascript', ['-e', `display notification "交接 ${id} 回执已到达，请进行独立实测验收" with title "Agent Baton"`]);
    } catch {}
  }
}

/** 后台监听回执状态变迁（支持跨仓与同仓多窗口协同）。
 * 设计为配合 Agent run_in_background 执行：挂起 0 Token 消耗，回执到达时 Exit 0 唤醒。
 * 针对 macOS / Apple Silicon 能效深度优化：
 * 1. fs.watch 事件驱动：系统内核级事件监听，有变动瞬间触发唤醒（毫秒级响应），无变动时不占用 CPU。
 * 2. mtime 守卫：未检测到文件修改时间变动时，跳过 readFileSync 与正则解析，消除重复磁盘与 CPU 开销。
 * 3. 自适应动态退避（Adaptive Backoff）：定时器防丢事件保底，随时间自动拉长休眠周期，大幅减少 CPU 唤醒次数，彻底避免发热与卡顿。
 */
async function cmdWait(args) {
  const timeoutVal = flagValue(args, '--timeout') || flagValue(args, '-t');
  const intervalVal = flagValue(args, '--interval') || flagValue(args, '-i');
  const settleVal = flagValue(args, '--settle') || flagValue(args, '-s');

  const defaultTimeoutSec = (() => {
    const envVal = process.env.BATON_WAIT_TIMEOUT || process.env.HANDOFF_WAIT_TIMEOUT;
    if (envVal) return Math.round(parseDuration(envVal, 3600) / 1000);
    if (HUB_CONFIG && (HUB_CONFIG.wait_timeout || HUB_CONFIG.timeout)) {
      return Math.round(parseDuration(HUB_CONFIG.wait_timeout || HUB_CONFIG.timeout, 3600) / 1000);
    }
    return 3600; // 默认超时提升至 60 分钟（3600 秒），适配深度测试与长任务
  })();
  const timeoutMs = parseDuration(timeoutVal, defaultTimeoutSec);
  const explicitIntervalMs = intervalVal ? Math.max(500, parseDuration(intervalVal, 3)) : null;

  const settleDelayMs = (() => {
    const raw = settleVal !== undefined ? settleVal : (process.env.BATON_SETTLE_DELAY || (HUB_CONFIG && HUB_CONFIG.settle_delay));
    return parseDuration(raw, 10); // 默认 10 秒会话平息缓冲期，等待执行方会话彻底收尾
  })();

  const valFlags = ['--timeout', '-t', '--interval', '-i', '--settle', '-s'];
  const valueIdx = new Set();
  for (let i = 0; i < args.length; i++) if (valFlags.includes(args[i])) valueIdx.add(i + 1);
  const id = args.find((a, i) => !a.startsWith('-') && !valueIdx.has(i));

  if (!id) {
    console.error('用法: baton wait <id> [--timeout <duration>] [--interval <duration>] [--settle <duration>] [--daemon]');
    console.error('示例: baton wait SWOOP-20261104-01-feat --timeout 60m --settle 10s --daemon');
    process.exit(2);
  }

  const isDaemon = args.includes('--daemon') || args.includes('-d');
  if (isDaemon && !process.env.BATON_DAEMON) {
    if (isAgentEnvironment()) {
      const isZh = detectLang() === 'zh';
      if (isZh) {
        console.log(`🤖 [AI 宿主环境感知] 检测到 Agent 托管管道，--daemon 自动切换为托管阻塞等待（保持进程树存活以供宿主任务管理器捕获并在回执到达时 Exit 0 唤醒）。\n`);
      } else {
        console.log(`🤖 [Agent Host Detected] In managed agent environment, --daemon automatically falls back to managed blocking wait (preserves process-tree for reactive wakeup on Exit 0).\n`);
      }
      // 不 return，继续向下执行 cmdWait 托管阻塞等待
    } else {
      spawnDaemonWait(id, args);
      return;
    }
  }

  const hFile = path.join(H_DIR, `${id}.md`);
  if (!fs.existsSync(hFile)) {
    console.error(`❌ 找不到交接文档: ${hFile}`);
    process.exit(1);
  }

  const rFile = path.join(R_DIR, `${id}-resp.md`);
  let hFm = readFM(fs.readFileSync(hFile, 'utf8')) || {};
  let curStatus = hFm.status;

  if (curStatus === 'closed') {
    console.log(`ℹ️ 交接 ${id} 已经是 closed（已闭环），无需等待。`);
    process.exit(0);
  }

  if (curStatus === 'delivered') {
    console.log(`✅ 交接 ${id} 已经处于 delivered（已交付）状态。`);
    printWaitWakeupSummary(id, hFile, rFile, hFm);
    process.exit(0);
  }

  const isLegacyExemptInit = hFm.created && hFm.created < '2026-11-08' && !hFm.delivered_at;
  if (curStatus === 'received' && isLegacyExemptInit) {
    console.log(`✅ 交接 ${id} 处于 received（历史存量已收到回执）状态。`);
    printWaitWakeupSummary(id, hFile, rFile, hFm);
    process.exit(0);
  }

  const startTime = Date.now();
  console.log(`⏳ [Handoff Wait] 正在监听交接 ${id} 的回执到达...`);
  console.log(`   - 当前状态: ${curStatus || 'draft'}`);
  console.log(`   - 目标文件: ${path.relative(ROOT, rFile)}`);
  console.log(`   - 超时设定: ${formatDuration(timeoutMs)} (能效模式: 事件驱动 + 自适应退避)`);
  if (settleDelayMs > 0) {
    console.log(`   - 平息缓冲: ${formatDuration(settleDelayMs)} (终态交付后等待执行方会话彻底收尾，杜绝抢跑)`);
  }
  console.log(`   - 运行模式: ${MODE === 'intra-repo' ? '仓内模式 (intra-repo)' : '跨仓模式'}`);
  if (process.env.HANDOFF_LANE) {
    console.log(`   - 当前窗口 Lane: ${process.env.HANDOFF_LANE}`);
  }
  console.log(`   (提示: 此命令设计为在后台运行 run_in_background，回执到达时将 Exit 0 唤醒主会话)\n`);

  let lastHMtime = 0;
  let lastRMtime = 0;
  let lastHeartbeatTime = startTime;
  let hasWarnedReceived = false;

  // 设置 fs.watch 监听目录变动（事件驱动瞬间唤醒）
  let triggerResolve = null;
  const watchers = [];
  const onFsEvent = (filename) => {
    if (!filename || filename.includes(id)) {
      if (triggerResolve) {
        const r = triggerResolve;
        triggerResolve = null;
        r('fs-event');
      }
    }
  };

  const safeWatch = (targetDir) => {
    try {
      if (fs.existsSync(targetDir)) {
        const w = fs.watch(targetDir, { persistent: false }, (eventType, filename) => {
          onFsEvent(filename);
        });
        watchers.push(w);
      }
    } catch {}
  };

  safeWatch(H_DIR);
  safeWatch(R_DIR);

  const cleanupWatchers = () => {
    for (const w of watchers) {
      try { w.close(); } catch {}
    }
    watchers.length = 0;
  };

  process.on('exit', cleanupWatchers);

  // 自适应动态退避（未显式指定间隔时根据等待时长智能拉长兜底轮询）
  const getNextInterval = (elapsed) => {
    if (explicitIntervalMs) return explicitIntervalMs;
    if (elapsed < 30_000) return 2_000;       // 前 30 秒：2s
    if (elapsed < 120_000) return 4_000;      // 30s ~ 2min：4s
    if (elapsed < 300_000) return 8_000;      // 2min ~ 5min：8s
    return 15_000;                            // 5min 以上长稳态：15s 保底
  };

  while (true) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= timeoutMs) {
      cleanupWatchers();
      let rExists = false;
      try { rExists = fs.existsSync(rFile); } catch {}
      if (curStatus === 'received' && rExists) {
        console.error(`\n⏰ [超时诊断] 等待交接 ${id} 终态交付超时（已持续监听 ${formatDuration(timeoutMs)}）。`);
        console.error(`⚠️ 核心根因：检测到回执文件已存在（status: received），但执行方未执行 baton deliver ${id} 确认终态交付！`);
        console.error(`   发起方探针为防止会话竞态抢跑，严格等待显式交付。`);
        console.error(`   👉 救砖建议：若确认执行方工作与自测已完成，可在执行方或人工运行: baton deliver ${id} 即可唤醒闭环。`);
        process.exit(124);
      }
      console.error(`\n⏰ [超时] 等待交接 ${id} 回执超过 ${formatDuration(timeoutMs)}，执行方未在时限内提交回执。`);
      console.error(`⚠️ 监听已退出 (Exit 124)。建议联系执行方或检查执行窗口进度。`);
      process.exit(124);
    }

    // 保活心跳（每 5 分钟微量输出，防止宿主外层框架因无标准输出误杀进程）
    if (Date.now() - lastHeartbeatTime >= 300_000) {
      lastHeartbeatTime = Date.now();
      console.log(`⏳ [探针活跃] 正在持续监听交接 ${id}（已等待 ${formatDuration(elapsed)} / 上限 ${formatDuration(timeoutMs)}）...`);
      if (curStatus === 'received' && !hasWarnedReceived) {
        hasWarnedReceived = true;
        console.log(`   💡 提示：检测到回执草稿已就绪（status: received），正在等待执行方会话收尾并确认终态交付 (baton deliver)。`);
      }
    }

    try {
      // 1. 检查 hFile 的 mtime 是否变动（mtime 守卫）
      let hMtime = 0;
      try {
        if (fs.existsSync(hFile)) hMtime = fs.statSync(hFile).mtimeMs;
      } catch {}

      if (hMtime && hMtime !== lastHMtime) {
        lastHMtime = hMtime;
        hFm = readFM(fs.readFileSync(hFile, 'utf8')) || {};
        curStatus = hFm.status;
      }

      // 2. 检查 rFile 是否生成或更新
      let rExists = false;
      let rMtime = 0;
      try {
        if (fs.existsSync(rFile)) {
          rExists = true;
          rMtime = fs.statSync(rFile).mtimeMs;
        }
      } catch {}

      if (curStatus !== 'delivered' && curStatus !== 'closed' && rExists && rMtime !== lastRMtime) {
        lastRMtime = rMtime;
        const rRaw = fs.readFileSync(rFile, 'utf8');
        const rFm = readFM(rRaw);
        if (rFm && (rFm.handoff_id === id || !rFm.handoff_id)) {
          const isDelivered = Boolean(rFm.delivered_at || hFm.delivered_at);
          if (isDelivered) {
            const needsChange = Boolean(rFm.needs_change || rFm.needs_iggle_change);
            setFM(hFile, { status: 'delivered', delivered_at: rFm.delivered_at || new Date().toISOString(), ...(MODE !== 'intra-repo' ? { needs_iggle_change: needsChange } : {}) });
            curStatus = 'delivered';
          } else {
            // 回执文件更新但执行方尚未宣布交付：仅跨仓记录 seen，绝不抢跑翻 received 触发唤醒
            if (MODE !== 'intra-repo' && curStatus !== 'received') {
              setFM(hFile, { receipt_seen_at: new Date().toISOString() });
            }
          }
        }
      }

      // 唤醒条件（v2.18+ · 防抢跑平息）：必须已显式交付 (delivered) 或已闭环 (closed)
      // 历史存量工单（created < '2026-11-08' 且无 delivered_at 标记）允许 received 唤醒以保持向后兼容
      const isLegacyExempt = hFm.created && hFm.created < '2026-11-08' && !hFm.delivered_at;
      if (curStatus === 'delivered' || curStatus === 'closed' || (curStatus === 'received' && isLegacyExempt)) {
        // 执行方平息缓冲（Settle Window · 防抢跑核心）：
        // 当执行方刚打上 delivered 戳时，执行方 Agent 极可能仍在输出收尾说明、运行后置清理或释放资源；
        // 探针在此处静默缓冲若干秒，若检测到工作区仍有写入活动则顺延，直到执行方会话彻底平息再唤醒发起方。
        if (settleDelayMs > 0 && curStatus === 'delivered') {
          console.log(`\n⏳ [交付平息缓冲] 检测到交付信号（status: delivered），等待执行方会话彻底结束（平息缓冲 ${formatDuration(settleDelayMs)}）...`);
          let settleStart = Date.now();
          while (Date.now() - settleStart < settleDelayMs) {
            const remain = settleDelayMs - (Date.now() - settleStart);
            await new Promise((r) => setTimeout(r, Math.min(remain, 1000)));
            let newHMtime = 0, newRMtime = 0;
            try { if (fs.existsSync(hFile)) newHMtime = fs.statSync(hFile).mtimeMs; } catch {}
            try { if (fs.existsSync(rFile)) newRMtime = fs.statSync(rFile).mtimeMs; } catch {}
            if ((newHMtime && newHMtime !== lastHMtime) || (newRMtime && newRMtime !== lastRMtime)) {
              lastHMtime = newHMtime;
              lastRMtime = newRMtime;
              settleStart = Date.now();
              console.log(`   [写入活动中] 检测到执行方后置操作，重置平息缓冲计时器...`);
            }
          }
          console.log(`🎉 [会话已平息] 执行方会话已彻底结束，正式唤醒发起方！`);
        }

        cleanupWatchers();
        console.log(`\n🎉 [交付已就绪] 检测到交接 ${id} 状态已转为 ${curStatus}！`);
        printWaitWakeupSummary(id, hFile, rFile, hFm);
        process.exit(0);
      }
    } catch {
      // 容忍读文件过程中的瞬时读写冲突
    }

    // 结合自适应退避与 fs.watch 事件驱动：任意一个先触发即刻进入下一轮检查
    const waitTime = Math.min(getNextInterval(elapsed), Math.max(0, timeoutMs - elapsed));
    await new Promise((resolve) => {
      let timer = null;
      triggerResolve = (source) => {
        if (timer) clearTimeout(timer);
        resolve(source);
      };
      timer = setTimeout(() => {
        triggerResolve = null;
        resolve('timer');
      }, Math.max(200, waitTime));
    });
  }
}

const rawArgv = process.argv.slice(2);
// 剥离全局旗标 --root（及其值）/ --root=...，命令 = 第一个非旗标 token；resolveRoot 已在模块加载时消费了 --root。
const nonRoot = [];
for (let i = 0; i < rawArgv.length; i++) {
  if (rawArgv[i] === '--root') { i++; continue; }
  if (rawArgv[i].startsWith('--root=')) continue;
  nonRoot.push(rawArgv[i]);
}
const cmd = nonRoot.find(a => !a.startsWith('-'));
const cmdIdx = nonRoot.indexOf(cmd);
const rest = cmdIdx >= 0 ? nonRoot.slice(cmdIdx + 1) : [];
switch (cmd) {
  case 'init': cmdInit(rest); break;
  case 'new': cmdNew(rest); break;
  case 'status': cmdStatus(rest); break;
  case 'accept': cmdAccept(rest); break;
  case 'close': cmdAccept(rest); break; // 兼容历史文档「handoff close」表述的别名
  case 'reject': cmdReject(rest); break;
  case 'receipt': cmdReceipt(rest); break;
  case 'deliver': cmdDeliver(rest); break;
  case 'forward': await cmdForward(rest); break;
  case 'open': cmdOpen(rest); break;
  case 'show': cmdShow(rest); break;
  case 'check': cmdCheck(); break;
  case 'prompt': cmdPrompt(rest); break;
  case 'import': cmdImport(rest); break;
  case 'install': cmdInstall(rest); break;
  case 'link': cmdLink(rest); break;
  case 'brief': cmdBrief(rest); break;
  case 'sync': cmdSync(); break;
  case 'wait': await cmdWait(rest); break;
  case 'drift': cmdDrift(rest); break;
  default: {
    const isZh = detectLang() === 'zh';
    if (isZh) {
      console.log(`Agent Baton (baton) CLI · v2.19.0 (alias: handoff)
用法:
  baton init [--cross] [--root <dir>] [--targets <a,b>] [--lanes <a,b>]
                                               初始化 Hub（--cross 为跨仓中立中枢，默认仓内子 Hub）
  baton import --from <dir>                    扫描旧交接目录生成只读快照
  baton new <target|lane> <type> <标题...>     创建交接（跨仓 target / 仓内 lane）
  baton status [--json] [--for <t|lane>] [--mermaid]
                                               查看未闭环摘要（支持 --mermaid 拓扑图）
  baton accept <id> -n "<验收结论>" [--by <lane>] 审计闭环（close 为同义别名）
  baton reject <id> -n "<驳回理由>"            审计驳回（退回执行方继续改）
  baton receipt <id> [-n "<回执正文>"] [--deliver] [--evidence-paths "..."] [--evidence-commits "..."] [--audit-nonce "..."]
                                               登记回执并翻 received（可选 --deliver 一步直达交付）
  baton deliver <id> [-n "<交付补充说明>"]     执行方终态交付并翻 delivered（触发发起方独立实测）
  baton forward <id> [--wait] [--daemon] [--blind]
                                               标记已转递（--wait 托管阻塞监听；--daemon 脱钩后台守护；--blind 双盲脱敏）
  baton wait <id> [--timeout <dur>] [--settle <dur>] [--daemon]
                                               0-Token 事件监听回执交付到达并 Exit 0 自动唤醒（支持平息缓冲防抢跑；--daemon 终端脱钩入后台）
  baton open <id>                              打开交接文件
  baton show <id>                              triage 摘要视图（不 dump 全文）
  baton check                                  全库合规体检（任务收尾判据）
  baton prompt <id>                            生成交接提示词（异工作区）
  baton install [--global|--project] [--no-readme] [--lang <en|zh>]
                                               刷新各工具指令文件接入桩（幂等）
  baton link [--remove]                        把中央引擎以 baton / handoff 之名接入 PATH
  baton brief [target]                         生成收件箱快照
  baton sync                                   扫 receipts/ 自动登记回执
  baton drift --common | --platform <p>        版本失效回流
作用域根：--root <dir> | BATON_ROOT / HANDOFF_ROOT | cwd 上溯 .handoff-hub.json | 回退 lab Hub
跨仓 target: ${[...TARGETS].join(' | ')}    type: bug | feature | breaking | question
仓内 lane: 由配置文件定义                     type: task | bug | feature | question | continuation`);
    } else {
      console.log(`Agent Baton (baton) CLI · v2.19.0 (alias: handoff)
Usage:
  baton init [--cross] [--root <dir>] [--targets <a,b>] [--lanes <a,b>]
                                               Initialize hub (--cross for cross-repo, default intra-repo)
  baton import --from <dir>                    Scan legacy handoffs directory to generate read-only snapshot
  baton new <target|lane> <type> <title...>    Create handoff (cross-repo target / intra-repo lane)
  baton status [--json] [--for <t|lane>] [--mermaid]
                                               View open handoffs summary (supports --mermaid diagram)
  baton accept <id> -n "<verdict>" [--by <lane>]
                                               Audit closure (close is an alias)
  baton reject <id> -n "<reason>"              Audit rejection (return to executor for revision)
  baton receipt <id> [-n "<body text>"] [--deliver] [--evidence-paths "..."] [--evidence-commits "..."] [--audit-nonce "..."]
                                               Record receipt and set received (optional --deliver for one-step delivery)
  baton deliver <id> [-n "<delivery note>"]    Final executor delivery to state 'delivered' (ready for audit)
  baton forward <id> [--wait] [--daemon] [--blind]
                                               Mark forwarded (--wait managed blocking wait; --daemon detached daemon; --blind desensitize)
  baton wait <id> [--timeout <dur>] [--settle <dur>] [--daemon]
                                               0-Token background event listener waiting for delivery (with settle window; --daemon detaches)
  baton open <id>                              Open handoff file in editor
  baton show <id>                              Triage summary view (does not dump full text)
  baton check                                  Full hub compliance inspection (exit condition)
  baton prompt <id>                            Generate Baton Pass Prompt (cross-workspace)
  baton install [--global|--project] [--no-readme] [--lang <en|zh>]
                                               Install/refresh guard stub into agent instructions files (idempotent)
  baton link [--remove]                        Link central engine into PATH as baton / handoff
  baton brief [target]                         Generate inbox snapshot
  baton sync                                   Scan receipts/ to register incoming receipts
  baton drift --common | --platform <p>        Upstream contract drift tracking
Scope root: --root <dir> | BATON_ROOT / HANDOFF_ROOT | upward search for .handoff-hub.json | fallback to central Hub
Cross-repo target: ${[...TARGETS].join(' | ')}    type: bug | feature | breaking | question
Intra-repo lane: defined by configuration          type: task | bug | feature | question | continuation`);
    }
    process.exit(cmd ? 2 : 0);
  }
}
