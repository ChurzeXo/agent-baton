#!/usr/bin/env node
// 公共交接目录（Handoff Hub）状态巡检工具。
// 脚本位置即交接根：<root>/handoff-status.mjs，<root>/handoffs/，<root>/receipts/。
// 人类可读摘要：  node <root>/handoff-status.mjs
// 机器可读（自动化运营轮询，v1，字段禁止改）： node <root>/handoff-status.mjs --json
// 依赖方待办视角：  node <root>/handoff-status.mjs --for <swoop|prospero|iggle|coreml|tappy|yiqiyihuihua> [--json=v2]
// 根目录由脚本自身位置推导，整个 hub 目录可整体移动而不失灵。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_ROOT = path.dirname(fileURLToPath(import.meta.url));
// 仓内模式：根与模式由调用方（handoff.mjs）经 --root/--mode 显式传入；缺省回退脚本目录（lab Hub，跨仓）。
let ROOT = SCRIPT_ROOT;
let MODE = 'cross';
// JSON 输出分两档（v2.6）：
//   --json      → v1（兼容默认，schema 不变；裸 status 的 v1 被自动化轮询消费，禁止改字段）
//   --json=v2   → v2（仅 --for 时有效，新增 target 感知的 pending + counts；禁止替换 v1）
let JSON_MODE = false;
let JSON_V2 = false;
let MERMAID_MODE = false;
for (const a of process.argv) {
  if (a === '--json') JSON_MODE = true;
  else if (a === '--json=v2') { JSON_MODE = true; JSON_V2 = true; }
  else if (a === '--mermaid') MERMAID_MODE = true;
  else if (a === '--root') { const i = process.argv.indexOf(a); if (process.argv[i + 1]) ROOT = process.argv[i + 1]; }
  else if (a.startsWith('--root=')) { ROOT = a.slice('--root='.length); }
  else if (a === '--mode') { const i = process.argv.indexOf(a); if (process.argv[i + 1]) MODE = process.argv[i + 1]; }
  else if (a.startsWith('--mode=')) { MODE = a.slice('--mode='.length); }
}
const H_DIR = path.join(ROOT, 'handoffs');
const R_DIR = path.join(ROOT, 'receipts');

// ── 依赖方视角（--for <target>，跨仓）／ --for <lane>（仓内）──
// 依赖方 agent 用「我的待办」单一入口：只列 target===<target>（或 to_lane===<lane>）且未闭环的交接。
// 是否计入 pending 见 isPendingFor：draft + forwarded 一律计入（v2.7 修正，不再按 target 区分）。
// 支持从 .handoff-hub.json 动态配置 targets，未配置时回退默认集合
let hubCfg = null;
try { hubCfg = JSON.parse(fs.readFileSync(path.join(ROOT, '.handoff-hub.json'), 'utf8')); } catch { /* 读不到回退 */ }
const DEFAULT_TARGETS = ['swoop', 'prospero', 'iggle', 'coreml', 'tappy', 'yiqiyihuihua'];
const VALID_TARGETS = new Set(
  (hubCfg && Array.isArray(hubCfg.targets) && hubCfg.targets.length > 0)
    ? hubCfg.targets.map(s => String(s).toLowerCase())
    : DEFAULT_TARGETS
);
let FOR = '';
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === '--for' && process.argv[i + 1]) { FOR = process.argv[i + 1].toLowerCase(); break; }
  if (process.argv[i].startsWith('--for=')) { FOR = process.argv[i].slice('--for='.length).toLowerCase(); break; }
}
if (FOR && MODE !== 'intra-repo' && !VALID_TARGETS.has(FOR)) {
  console.error(`--for 必须是 ${[...VALID_TARGETS].join(' / ')}（收到: ${FOR || '(空)'}）`);
  process.exit(2);
}
// 仓内模式：--for <lane> 按 .handoff-hub.json 的 lanes 校验（2026-10-18 修）。
// 原缺校验的后果：lane 拼错 ⇒ mine 为空 ⇒ 输出「✅ 没有待 X 处理的交接」——假阴性，
// agent 会据此判定「本轮无事可做」而跳过真正的待办（与 v2.7 draft 语义事故同类：可见性缺失）。
// 配置读不到 ⇒ 不校验（fail-open，宁可漏拦不误伤）；intra 模式 ROOT 即 .handoffs/，配置就在 ROOT 下。
if (FOR && MODE === 'intra-repo') {
  let lanes = [];
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, '.handoff-hub.json'), 'utf8'));
    lanes = (cfg.lanes || []).map(s => String(s).toLowerCase());
  } catch { /* 配置不可读：跳过校验 */ }
  if (lanes.length && !lanes.includes(FOR)) {
    console.error(`--for 必须是 ${lanes.join(' / ')}（来自 .handoff-hub.json 的 lanes；收到: ${FOR}）`);
    process.exit(2);
  }
}

// 命名规范：跨仓 <TARGET>-<YYYYMMDD>-<NN>-<TYPE>；仓内 <LANE>-<YYYYMMDD>-<NN>-<TYPE>
const _TARGET_ALT = [...VALID_TARGETS].map(t => t.toUpperCase()).join('|');
const ID_RE = MODE === 'intra-repo'
  ? /^([A-Za-z0-9_-]+)-\d{8}-\d{2}-(task|bug|feature|question|continuation)$/
  : new RegExp(`^(${_TARGET_ALT})-\\d{8}-\\d{2}-(bug|feature|breaking|question)$`);

function parseFM(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  const obj = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim();
    let v = line.slice(idx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (v === 'true') v = true; else if (v === 'false') v = false;
    obj[k] = v;
  }
  return obj;
}

function listMd(dir) {
  try { return fs.readdirSync(dir).filter(f => f.endsWith('.md') && f.toUpperCase() !== 'README.MD'); }
  catch { return []; }
}

const hFiles = listMd(H_DIR);
const rFiles = listMd(R_DIR);
const hFmMap = new Map();
const rFmMap = new Map();

const handoffs = {};
for (const f of hFiles) {
  let fm = null;
  try { fm = parseFM(fs.readFileSync(path.join(H_DIR, f), 'utf8')); } catch {}
  hFmMap.set(f, fm);
  if (!fm || !fm.handoff_id) continue;
  const rec = {
    id: fm.handoff_id,
    target: fm.target || '',
    type: fm.type || '',
    status: fm.status || 'draft',
    needs: fm.needs_iggle_change,
    created: fm.created || '',
    closed: fm.closed || '',
    file: `handoffs/${f}`,
  };
  // 仓内模式：target 位复用为 to_lane，并补 from_lane / needs_change。跨仓 v1 schema 字段保持冻结。
  if (MODE === 'intra-repo') {
    rec.target = fm.to_lane || fm.target || '';
    rec.to_lane = fm.to_lane || '';
    rec.from_lane = fm.from_lane || '';
    rec.needs = fm.needs_change;
  }
  handoffs[fm.handoff_id] = rec;
}

const receipts = {};
for (const f of rFiles) {
  let fm = null;
  try { fm = parseFM(fs.readFileSync(path.join(R_DIR, f), 'utf8')); } catch {}
  rFmMap.set(f, fm);
  const id = (fm && fm.handoff_id) || f.replace(/-resp\.md$/i, '').replace(/\.md$/i, '');
  receipts[id] = { file: `receipts/${f}`, needs: fm && fm.needs_iggle_change };
}

// ── 规范性校验（直接利用内存缓存，0 重复磁盘 I/O）──
const warnings = [];
for (const f of hFiles) {
  const base = f.replace(/\.md$/i, '');
  const fm = hFmMap.get(f);
  if (!fm || !fm.handoff_id) { warnings.push(`交接文件缺 frontmatter handoff_id：${f}`); continue; }
  if (base !== fm.handoff_id) warnings.push(`文件名(${base}) 与 frontmatter handoff_id(${fm.handoff_id}) 不一致：${f}`);
  if (!ID_RE.test(fm.handoff_id)) warnings.push(`handoff_id 不符合规范（应为 ${MODE === 'intra-repo' ? '<LANE>-<YYYYMMDD>-<NN>-<TYPE>' : '<TARGET>-<YYYYMMDD>-<NN>-<TYPE>'}）：${fm.handoff_id}`);
}
for (const f of rFiles) {
  const base = f.replace(/-resp\.md$/i, '').replace(/\.md$/i, '');
  const fm = rFmMap.get(f);
  const id = (fm && fm.handoff_id) || base;
  if (!handoffs[id]) warnings.push(`回执找不到对应交接：${f} (id=${id})`);
}

const rows = Object.values(handoffs).map(h => ({
  ...h,
  hasReceipt: !!receipts[h.id],
  receiptFile: receipts[h.id] ? receipts[h.id].file : '',
}));

const open = rows.filter(r => r.status !== 'closed');
const byStatus = {};
for (const r of open) (byStatus[r.status] = byStatus[r.status] || []).push(r);
const receiptButStale = open.filter(r => r.hasReceipt && r.status !== 'received' && r.status !== 'closed');

// ── 下一步导航 ──
// 状态名中文化 + 每项给出「谁该做什么」，消除「看到状态名却不知下一步」的记忆负担。
// v2.12.5 · P1-b 标签分区：仓内 draft/forwarded 渲染「待执行」——原「待转递/已转递」是跨仓
// 口吻（发起方视角的转递进度），放在仓内会被读成「已发出去、有人接手了」，误导执行 lane 不动工
// （同仓新单天生停在 draft，标签还说「待转递」= 暗示『不该我处理』）。跨仓标签保持不变。
const STATUS_LABEL = MODE === 'intra-repo'
  ? { draft: '待执行', forwarded: '待执行', received: '已收回执', closed: '已闭环' }
  : { draft: '待转递', forwarded: '已转递', received: '已收回执', closed: '已闭环' };

// 只引导固定命令（/inbox、/sync），不带 <ID> 的 /handoff 子命令——带 ID 命令用户记不住。
function nextStep(r) {
  if (MODE === 'intra-repo') {
    // v2.12.5：仓内下一步给动作而非只给状态复读——「lane=x · 待执行」读者仍不知道该干嘛；
    // 对齐 --for 视图的 nextStepFor，让中央视图每项自带「读→写」动作。
    const lane = r.to_lane || '?';
    if (r.status === 'received') return `lane=${lane} · 已收回执（等发起 lane 实测后 close）`;
    if (r.status === 'closed') return `lane=${lane} · 已闭环`;
    return `lane=${lane} · 待执行：读 ${r.file} 开工 → 写 receipts/${r.id}-resp.md`;
  }
  const t = (r.target || '').toLowerCase();
  switch (r.status) {
    case 'draft':
      if (t === 'coreml') return '同工作区，无需转递：切 coreml 角色执行 → 写回执';
      if (t === 'iggle') return '依赖方发起，iggle 侧适配本仓';
      return `待转递：输 /inbox 生成收件箱转给 ${t}`;
    case 'forwarded':
      if (t === 'coreml') return '规格已定稿，可开工（切 coreml 角色）';
      if (t === 'iggle') return '已转递，等 iggle 适配回执';
      return `已转递，等 ${t} 回执（回执到后输 /sync 登记）`;
    case 'received':
      if (t === 'iggle') return 'iggle 已回执，等依赖方独立实测后闭环';
      return `已收 ${t} 回执：你（iggle）独立实测后闭环`;
    default:
      return '';
  }
}

// ── `draft` 对依赖方 = 待处理，不是「尚未转递」（v2.7 修正）──
// 2026-09-04 事故根因：用户常把交接文档直接交给依赖方而不跑 `forward`，
// 旧逻辑把 draft 排除在依赖方待办之外 → SWOOP-20260904-02 被误判「不属于本轮范围」。
// `forward` 只是 iggle 侧可选的事后标记，**不是「已送达」的可靠信号**。
// 故：draft / forwarded 一律计入 pending；received = 已回执（不 pending）；closed 不列出。
// 「是否落到我手上」的可靠判据只有两条：① target === 当前工作区；② 用户直接给了文档
// 或它出现在本命令的输出里。**不要用 draft/forwarded 判断该不该开工。**
function isPendingFor(_target, status) {
  if (status === 'closed' || status === 'received') return false;
  if (status === 'draft' || status === 'forwarded') return true;
  return false;
}

// ── 依赖方视角的「下一步」导航 ──
// 与中心视角 nextStep 相反：这里「我」= target，只有 isPendingFor() 为真的项才进 pending。
function nextStepFor(r) {
  if (MODE === 'intra-repo') {
    if (r.status === 'received') return '已回执，等发起 lane 独立实测后 close';
    return `读 handoffs/${r.id}.md 开工 → 写 receipts/${r.id}-resp.md`;
  }
  const t = (r.target || '').toLowerCase();
  switch (r.status) {
    case 'draft':
      // v2.7 起所有 target 的 draft 都进 pending
      return t === 'coreml'
        ? `同工作区，读完交接即可切 coreml 角色开工 → 写 receipts/${r.id}-resp.md`
        : `待 ${t} 处理：读 handoffs/${r.id}.md 直接开工 → 写 receipts/${r.id}-resp.md`;
    case 'forwarded':
      return t === 'coreml'
        ? `规格已定稿，切 coreml 角色开工 → 写 receipts/${r.id}-resp.md`
        : `已转递，读 handoffs/${r.id}.md 直接开工 → 写 receipts/${r.id}-resp.md`;
    case 'received':
      return '已回执，等 iggle 独立实测后 close';
    default:
      return '';
  }
}

if (FOR) {
  // 依赖方视角：只列 target===FOR（跨仓）或 to_lane===FOR（仓内）且未闭环；pending 按角色语义过滤（isPendingFor）。
  const laneMatch = (r) => MODE === 'intra-repo' ? (r.to_lane === FOR) : (r.target === FOR);
  const mine = rows.filter(r => laneMatch(r) && r.status !== 'closed');
  if (MERMAID_MODE) {
  const mLines = ['```mermaid', 'flowchart LR'];
  const displayRows = FOR ? mine : open;
  if (!displayRows.length) {
    mLines.push('  empty["(无未闭环任务)"]');
  } else {
    for (const r of displayRows) {
      const from = r.from || (MODE === 'intra-repo' ? 'impl' : 'hub');
      const to = r.target || r.to || 'executor';
      const label = `${r.id}\\n[${r.status}]`;
      mLines.push(`  ${from}["${from}"] -->|"${label}"| ${to}["${to}"]`);
    }
  }
  mLines.push('```');
  console.log(mLines.join('\n'));
  process.exit(0);
}

if (JSON_MODE) {
    if (JSON_V2) {
      const pending = mine.filter(r => isPendingFor(FOR, r.status)).map(r => ({
        handoff_id: r.id,
        status: r.status,
        path: r.file,
      }));
      const closedForTarget = rows.filter(r => laneMatch(r) && r.status === 'closed').length;
      const counts = {
        pending: pending.length,
        received: mine.filter(r => r.status === 'received').length,
        closed: closedForTarget,
        draft: mine.filter(r => r.status === 'draft').length,
      };
      console.log(JSON.stringify({ target: FOR, pending, counts }, null, 2));
    } else {
      console.log(JSON.stringify({ root: ROOT, for: FOR, total: mine.length, open: mine.length, warnings, rows: mine }, null, 2));
    }
    process.exit(0);
  }
  const todo = mine.filter(r => isPendingFor(FOR, r.status));
  const recv = mine.filter(r => r.status === 'received');
  const lines = [];
  lines.push(`[交接追踪 · ${ROOT}] ${FOR} 未闭环 ${mine.length} 项（${MODE === 'intra-repo' ? 'lane' : 'target'}=${FOR}）`);
  if (mine.length === 0) {
    lines.push(`✅ 没有待 ${FOR} 处理的交接。`);
  } else {
    if (todo.length) {
      lines.push(`- 待 ${FOR} 处理（${todo.length}）:`);
      for (const r of todo) {
        lines.push(`  - ${r.id}  ${r.file}${r.receiptFile ? '  回执:' + r.receiptFile : ''}`);
        const step = nextStepFor(r);
        if (step) lines.push(`      → 下一步：${step}`);
      }
    }
    if (recv.length) {
      // 分组标题按模式分支（2026-10-18 修）：跨仓「实测」方恒为 iggle（hub 属主）；
      // 仓内是发起 lane（from_lane）独立实测。原硬编码「待 iggle 实测」无 MODE 守卫，
      // intra-repo 的 --for <lane> 同样命中 → Tappy 等仓内 received 项被烙错章，
      // agent 转述成「待 iggle 实测」，使用者误判为串仓（与 handoff.mjs:709 同类病根）。
      lines.push(MODE === 'intra-repo'
        ? `- 已回执待发起 lane 实测（${recv.length}）:`
        : `- 已回执待 iggle 实测（${recv.length}）:`);
      for (const r of recv) {
        lines.push(`  - ${r.id}  ${r.file}${r.receiptFile ? '  回执:' + r.receiptFile : ''}`);
        const step = nextStepFor(r);
        if (step) lines.push(`      → 下一步：${step}`);
      }
    }
  }
  if (warnings.length) {
    lines.push('⚠️ 规范性问题（请修正以免影响 agent 识别）：');
    for (const w of warnings) lines.push(`  - ${w}`);
  }
  console.log(lines.join('\n'));
  process.exit(0);
}

if (MERMAID_MODE) {
  const mLines = ['```mermaid', 'flowchart LR'];
  const displayRows = FOR ? mine : open;
  if (!displayRows.length) {
    mLines.push('  empty["(无未闭环任务)"]');
  } else {
    for (const r of displayRows) {
      const from = r.from || (MODE === 'intra-repo' ? 'impl' : 'hub');
      const to = r.target || r.to || 'executor';
      const label = `${r.id}\\n[${r.status}]`;
      mLines.push(`  ${from}["${from}"] -->|"${label}"| ${to}["${to}"]`);
    }
  }
  mLines.push('```');
  console.log(mLines.join('\n'));
  process.exit(0);
}

if (JSON_MODE) {
  console.log(JSON.stringify({ root: ROOT, total: rows.length, open: open.length, warnings, rows }, null, 2));
  process.exit(0);
}

const lines = [];
lines.push(`[交接追踪 · ${ROOT}] 进行中 ${open.length} 项 / 总计 ${rows.length} 项`);
if (rows.length === 0) {
  lines.push('✅ 公共交接目录为空（或已全部闭环）。');
} else {
  // v2.12.5 · P1-b：仓内 draft/forwarded 同为「待执行」——分桶会连出两个同名标题，
  // 故合并一桶；跨仓保持原「按状态分桶 + 原标签」逐字不变（--json 消费方不受影响）。
  const buckets = MODE === 'intra-repo'
    ? [
        ['待执行', open.filter(r => r.status === 'draft' || r.status === 'forwarded')],
        ['已收回执', byStatus.received || []],
        ...[...new Set(open.map(r => r.status))].sort()
          .filter(st => !['draft', 'forwarded', 'received'].includes(st))
          .map(st => [STATUS_LABEL[st] || st, byStatus[st]]),
      ].filter(([, arr]) => arr.length)
    : [...new Set(open.map(r => r.status))].sort().map(st => [STATUS_LABEL[st] || st, byStatus[st]]);
  for (const [label, arr] of buckets) {
    lines.push(`- ${label}（${arr.length}）:`);
    for (const r of arr) {
      lines.push(`  - ${r.id}  ${r.file}${r.receiptFile ? '  回执:' + r.receiptFile : ''}`);
      const step = nextStep(r);
      if (step) lines.push(`      → 下一步：${step}`);
    }
  }
  if (receiptButStale.length) {
    // 2026-10-18 修：仓内模式的下一步是发起 lane 跑 handoff receipt 登记，不是「升依赖版本」。
    lines.push(MODE === 'intra-repo'
      ? '⚠️ 已收到回执但未翻状态（仓内：发起 lane 跑 handoff receipt <id> 登记回执并翻 received）:'
      : '⚠️ 已收到回执但未翻状态（请核对是否需升依赖版本 / 改调用）:');
    for (const r of receiptButStale) lines.push(`  - ${r.id}`);
  }
}
if (warnings.length) {
  lines.push('⚠️ 规范性问题（请修正以免影响 agent 识别）：');
  for (const w of warnings) lines.push(`  - ${w}`);
}
console.log(lines.join('\n'));
