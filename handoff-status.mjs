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
for (const a of process.argv) {
  if (a === '--json') JSON_MODE = true;
  else if (a === '--json=v2') { JSON_MODE = true; JSON_V2 = true; }
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
let hubCfg = null;
try {
  const cfgPath = path.join(ROOT, '.handoff-hub.json');
  if (fs.existsSync(cfgPath)) hubCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
} catch {}

const VALID_TARGETS = new Set(
  hubCfg && Array.isArray(hubCfg.targets) && hubCfg.targets.length
    ? hubCfg.targets.map(s => String(s).toLowerCase())
    : ['frontend', 'backend', 'mobile', 'audit']
);

function detectLang() {
  if (process.env.BATON_LANG) {
    return process.env.BATON_LANG.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  }
  if (hubCfg && (hubCfg.locale || hubCfg.lang)) {
    return String(hubCfg.locale || hubCfg.lang).toLowerCase().startsWith('zh') ? 'zh' : 'en';
  }
  const allLabels = [
    ...Object.values((hubCfg && (hubCfg.lane_labels || hubCfg.lane_roles)) || {}),
    ...Object.values((hubCfg && hubCfg.target_labels) || {})
  ];
  if (allLabels.some(r => /[\u4e00-\u9fa5]/.test(String(r)))) {
    return 'zh';
  }
  const envLang = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '';
  if (envLang.toLowerCase().startsWith('zh')) {
    return 'zh';
  }
  return 'en';
}

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
    delivered_at: fm.delivered_at || '',
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
  receipts[id] = { file: `receipts/${f}`, needs: fm && fm.needs_iggle_change, delivered_at: fm && fm.delivered_at };
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

function formatDurationShort(ms) {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  return `${hr}h`;
}

function getWatchInfo(id) {
  const watchFile = path.join(ROOT, '.watch', `${id}.json`);
  let isAlive = false;
  let data = null;
  if (fs.existsSync(watchFile)) {
    try {
      data = JSON.parse(fs.readFileSync(watchFile, 'utf8'));
      if (data && data.pid) {
        try {
          process.kill(data.pid, 0);
          isAlive = true;
        } catch (e) {
          if (e.code === 'EPERM') {
            isAlive = true;
          } else {
            isAlive = false;
            try { fs.unlinkSync(watchFile); } catch {}
          }
        }
      }
    } catch {}
  }
  if (isAlive && data) {
    const started = data.started_at ? new Date(data.started_at).getTime() : 0;
    const elapsed = started ? Math.max(0, Date.now() - started) : 0;
    const durStr = formatDurationShort(elapsed);
    return {
      listening: true,
      pid: data.pid,
      started_at: data.started_at,
      duration: durStr,
      text: `监听: pid ${data.pid} (${durStr})`
    };
  }
  return {
    listening: false,
    text: `⚠️ 无监听`
  };
}

function getCreatedTime(r) {
  if (r.created) {
    const t = new Date(r.created).getTime();
    if (!isNaN(t)) return t;
  }
  try {
    const hFile = path.join(ROOT, r.file);
    return fs.statSync(hFile).mtimeMs;
  } catch {
    return 0;
  }
}

function isReceivedIdle(r) {
  if (r.status !== 'received') return false;
  if (r.delivered_at) return false;
  const hFm = hFmMap.get(path.basename(r.file));
  if (hFm && hFm.delivered_at) return false;
  const rObj = receipts[r.id];
  if (rObj && rObj.delivered_at) return false;
  const cTime = getCreatedTime(r);
  if (!cTime) return false;
  return (Date.now() - cTime) >= 10 * 60 * 1000;
}

function formatRowLine(r, isZh) {
  const receiptPart = r.receiptFile ? '  ' + (isZh ? '回执:' : 'Receipt:') + r.receiptFile : '';
  const watch = getWatchInfo(r.id);
  const idle = isReceivedIdle(r);
  const idleAlert = idle ? (isZh ? '  ⚠️ [空转告警: received 超 10m 未 deliver]' : '  ⚠️ [空转告警 / Idle Warning: received >10m without deliver]') : '';
  return `  - ${r.id}  ${r.file}${receiptPart}  [${watch.text}]${idleAlert}`;
}

const rows = Object.values(handoffs).map(h => ({
  ...h,
  hasReceipt: !!receipts[h.id],
  receiptFile: receipts[h.id] ? receipts[h.id].file : '',
}));

for (const r of rows) {
  if (isReceivedIdle(r)) {
    warnings.push(`[空转告警] 交接 ${r.id} 处于 received 状态超过 10 分钟且未 deliver（发起方监听无法唤醒，请尽快运行 baton deliver ${r.id} 确认交付）`);
  }
}

const open = rows.filter(r => r.status !== 'closed');
const byStatus = {};
for (const r of open) (byStatus[r.status] = byStatus[r.status] || []).push(r);
const receiptButStale = open.filter(r => r.hasReceipt && r.status !== 'received' && r.status !== 'delivered' && r.status !== 'closed');

// ── 下一步导航 ──
// 状态名中文化 + 每项给出「谁该做什么」，消除「看到状态名却不知下一步」的记忆负担。
// v2.12.5 · P1-b 标签分区：仓内 draft/forwarded 渲染「待执行」——原「待转递/已转递」是跨仓
// 口吻（发起方视角的转递进度），放在仓内会被读成「已发出去、有人接手了」，误导执行 lane 不动工
// （同仓新单天生停在 draft，标签还说「待转递」= 暗示『不该我处理』）。跨仓标签保持不变。
const isZh = detectLang() === 'zh';

const STATUS_LABEL = isZh
  ? (MODE === 'intra-repo'
      ? { draft: '待执行', forwarded: '待执行', received: '已写回执', delivered: '已交付（待验收）', closed: '已闭环' }
      : { draft: '待转递', forwarded: '已转递', received: '已写回执', delivered: '已交付（待验收）', closed: '已闭环' })
  : (MODE === 'intra-repo'
      ? { draft: 'Pending Execution', forwarded: 'Pending Execution', received: 'Receipt Drafted', delivered: 'Delivered (Pending Acceptance)', closed: 'Closed' }
      : { draft: 'Draft', forwarded: 'Forwarded', received: 'Receipt Drafted', delivered: 'Delivered (Pending Acceptance)', closed: 'Closed' });

// 只引导固定命令（/inbox、/sync），不带 <ID> 的 /handoff 子命令——带 ID 命令用户记不住。
function nextStep(r) {
  if (MODE === 'intra-repo') {
    // v2.12.5：仓内下一步给动作而非只给状态复读——「lane=x · 待执行」读者仍不知道该干嘛；
    // 对齐 --for 视图的 nextStepFor，让中央视图每项自带「读→写」动作。
    const lane = r.to_lane || '?';
    if (r.status === 'received') {
      return isZh
        ? `lane=${lane} · 已写回执草稿（等执行方 baton deliver 交付）`
        : `lane=${lane} · Receipt drafted (awaiting executor baton deliver)`;
    }
    if (r.status === 'delivered') {
      return isZh
        ? `lane=${lane} · 已交付（等发起 lane 实测后 close）`
        : `lane=${lane} · Delivered (awaiting initiator verification to close)`;
    }
    if (r.status === 'closed') {
      return isZh ? `lane=${lane} · 已闭环` : `lane=${lane} · Closed`;
    }
    return isZh
      ? `lane=${lane} · 待执行：读 ${r.file} 开工 → 写 receipts/${r.id}-resp.md`
      : `lane=${lane} · Pending: read ${r.file} → write receipts/${r.id}-resp.md`;
  }
  const t = (r.target || '').toLowerCase();
  switch (r.status) {
    case 'draft':
      if (t === 'coreml') return isZh ? '同工作区，不用请人转交：切 coreml 角色直接做 → 写回执' : 'Same workspace: switch to coreml role → write receipt';
      if (t === 'iggle') return isZh ? '依赖方发起，iggle 侧适配本仓' : 'Initiated by dependency, adapter work';
      return isZh ? `待转递：输 /inbox 生成收件箱转给 ${t}` : `Pending forward: pass to ${t}`;
    case 'forwarded':
      if (t === 'coreml') return isZh ? '规格已定稿，可开工（切 coreml 角色）' : 'Spec finalized, ready to execute (coreml)';
      if (t === 'iggle') return isZh ? '已转递，等 iggle 适配回执' : 'Forwarded, awaiting adapter receipt';
      return isZh ? `已转递，等 ${t} 回执（回执到后输 /sync 登记）` : `Forwarded, awaiting ${t} receipt`;
    case 'received':
      if (t === 'iggle') return isZh ? '已写回执草稿，等执行方 deliver 交付' : 'Receipt drafted, awaiting delivery';
      return isZh ? `已收 ${t} 回执草稿：等待终态交付 (baton deliver)` : `Received ${t} draft: awaiting baton deliver`;
    case 'delivered':
      if (t === 'iggle') return isZh ? '已终态交付，等独立实测后闭环' : 'Delivered, awaiting verification';
      return isZh ? `已收 ${t} 终态交付：发起方独立实测后闭环` : `Delivered by ${t}: verify independently then close`;
    default:
      return '';
  }
}

// ── `draft` 对依赖方 = 待处理，不是「尚未转递」（v2.7 修正）──
// 2026-09-04 事故根因：用户常把交接文档直接交给依赖方而不跑 `forward`，
// 旧逻辑把 draft 排除在依赖方待办之外 → SWOOP-20260904-02 被误判「不属于本轮范围」。
// `forward` 只是 iggle 侧可选的事后标记，**不是「已送达」的可靠信号**。
// 故：draft / forwarded 一律计入 pending；received / delivered = 已回执/已交付（不 pending）；closed 不列出。
// 「是否落到我手上」的可靠判据只有两条：① target === 当前工作区；② 用户直接给了文档
// 或它出现在本命令的输出里。**不要用 draft/forwarded 判断该不该开工。**
function isPendingFor(_target, status) {
  if (status === 'closed' || status === 'received' || status === 'delivered') return false;
  if (status === 'draft' || status === 'forwarded') return true;
  return false;
}

// ── 依赖方视角的「下一步」导航 ──
// 与中心视角 nextStep 相反：这里「我」= target，只有 isPendingFor() 为真的项才进 pending。
function nextStepFor(r) {
  if (MODE === 'intra-repo') {
    if (r.status === 'received') {
      return isZh
        ? '已写回执草稿，请在会话收尾时运行 baton deliver 交付'
        : 'Receipt drafted, run baton deliver when wrapping up';
    }
    if (r.status === 'delivered') {
      return isZh
        ? '已终态交付，等发起 lane 独立实测后 close'
        : 'Delivered, awaiting initiator verification to close';
    }
    return isZh
      ? `读 handoffs/${r.id}.md 开工 → 写 receipts/${r.id}-resp.md`
      : `Read handoffs/${r.id}.md to start → write receipts/${r.id}-resp.md`;
  }
  const t = (r.target || '').toLowerCase();
  switch (r.status) {
    case 'draft':
      // v2.7 起所有 target 的 draft 都进 pending
      return t === 'coreml'
        ? (isZh ? `同工作区，读完交接即可切 coreml 角色开工 → 写 receipts/${r.id}-resp.md` : `Same workspace: read handoff and start as coreml → write receipts/${r.id}-resp.md`)
        : (isZh ? `待 ${t} 处理：读 handoffs/${r.id}.md 直接开工 → 写 receipts/${r.id}-resp.md` : `Pending for ${t}: read handoffs/${r.id}.md to start → write receipts/${r.id}-resp.md`);
    case 'forwarded':
      return t === 'coreml'
        ? (isZh ? `规格已定稿，切 coreml 角色开工 → 写 receipts/${r.id}-resp.md` : `Spec finalized, start as coreml → write receipts/${r.id}-resp.md`)
        : (isZh ? `已转递，读 handoffs/${r.id}.md 直接开工 → 写 receipts/${r.id}-resp.md` : `Forwarded: read handoffs/${r.id}.md to start → write receipts/${r.id}-resp.md`);
    case 'received':
      return isZh ? '回执草稿已登记，请在收尾时运行 baton deliver 交付' : 'Receipt drafted, run baton deliver to finalize';
    case 'delivered':
      return isZh ? '已终态交付，等发起方独立实测后 close' : 'Delivered, awaiting verification to close';
    default:
      return '';
  }
}

if (FOR) {
  // 依赖方视角：只列 target===FOR（跨仓）或 to_lane===FOR（仓内）且未闭环；pending 按角色语义过滤（isPendingFor）。
  const laneMatch = (r) => MODE === 'intra-repo' ? (r.to_lane === FOR) : (r.target === FOR);
  const mine = rows.filter(r => laneMatch(r) && r.status !== 'closed');
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
  const deliv = mine.filter(r => r.status === 'delivered');
  const lines = [];
  if (isZh) {
    lines.push(`[交接追踪 · ${ROOT}] ${FOR} 未闭环 ${mine.length} 项（${MODE === 'intra-repo' ? 'lane' : 'target'}=${FOR}）`);
    if (mine.length === 0) {
      lines.push(`✅ 没有待 ${FOR} 处理的交接。`);
    } else {
      if (todo.length) {
        lines.push(`- 待 ${FOR} 处理（${todo.length}）:`);
        for (const r of todo) {
          lines.push(formatRowLine(r, true));
          const step = nextStepFor(r);
          if (step) lines.push(`      → 下一步：${step}`);
        }
      }
      if (recv.length) {
        lines.push(`- 已写回执待终态交付（${recv.length}）:`);
        for (const r of recv) {
          lines.push(formatRowLine(r, true));
          const step = nextStepFor(r);
          if (step) lines.push(`      → 下一步：${step}`);
        }
      }
      if (deliv.length) {
        lines.push(MODE === 'intra-repo'
          ? `- 已交付待发起 lane 实测（${deliv.length}）:`
          : `- 已交付待发起方实测（${deliv.length}）:`);
        for (const r of deliv) {
          lines.push(formatRowLine(r, true));
          const step = nextStepFor(r);
          if (step) lines.push(`      → 下一步：${step}`);
        }
      }
    }
    if (warnings.length) {
      lines.push('⚠️ 规范性问题（请修正以免影响 agent 识别）：');
      for (const w of warnings) lines.push(`  - ${w}`);
    }
  } else {
    lines.push(`[Baton Status · ${ROOT}] ${FOR}: ${mine.length} open item(s) (${MODE === 'intra-repo' ? 'lane' : 'target'}=${FOR})`);
    if (mine.length === 0) {
      lines.push(`✅ No pending handoffs for ${FOR}.`);
    } else {
      if (todo.length) {
        lines.push(`- Pending for ${FOR} (${todo.length}):`);
        for (const r of todo) {
          lines.push(formatRowLine(r, false));
          const step = nextStepFor(r);
          if (step) lines.push(`      → Next step: ${step}`);
        }
      }
      if (recv.length) {
        lines.push(`- Draft receipts awaiting final delivery (${recv.length}):`);
        for (const r of recv) {
          lines.push(formatRowLine(r, false));
          const step = nextStepFor(r);
          if (step) lines.push(`      → Next step: ${step}`);
        }
      }
      if (deliv.length) {
        lines.push(MODE === 'intra-repo'
          ? `- Delivered, awaiting initiator verification (${deliv.length}):`
          : `- Delivered, awaiting verification (${deliv.length}):`);
        for (const r of deliv) {
          lines.push(formatRowLine(r, false));
          const step = nextStepFor(r);
          if (step) lines.push(`      → Next step: ${step}`);
        }
      }
    }
    if (warnings.length) {
      lines.push('⚠️ Compliance issues:');
      for (const w of warnings) lines.push(`  - ${w}`);
    }
  }
  console.log(lines.join('\n'));
  process.exit(0);
}

if (JSON_MODE) {
  console.log(JSON.stringify({ root: ROOT, total: rows.length, open: open.length, warnings, rows }, null, 2));
  process.exit(0);
}

const lines = [];
if (isZh) {
  lines.push(`[交接追踪 · ${ROOT}] 进行中 ${open.length} 项 / 总计 ${rows.length} 项`);
  if (rows.length === 0) {
    lines.push('✅ 公共交接目录为空（或已全部闭环）。');
  } else {
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
        lines.push(formatRowLine(r, true));
        const step = nextStep(r);
        if (step) lines.push(`      → 下一步：${step}`);
      }
    }
    if (receiptButStale.length) {
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
} else {
  lines.push(`[Baton Status · ${ROOT}] In Progress: ${open.length} / Total: ${rows.length}`);
  if (rows.length === 0) {
    lines.push('✅ Hub directory is empty (or all handoffs are closed).');
  } else {
    const buckets = MODE === 'intra-repo'
      ? [
          ['Pending Execution', open.filter(r => r.status === 'draft' || r.status === 'forwarded')],
          ['Receipt Submitted', byStatus.received || []],
          ...[...new Set(open.map(r => r.status))].sort()
            .filter(st => !['draft', 'forwarded', 'received'].includes(st))
            .map(st => [STATUS_LABEL[st] || st, byStatus[st]]),
        ].filter(([, arr]) => arr.length)
      : [...new Set(open.map(r => r.status))].sort().map(st => [STATUS_LABEL[st] || st, byStatus[st]]);
    for (const [label, arr] of buckets) {
      lines.push(`- ${label} (${arr.length}):`);
      for (const r of arr) {
        lines.push(formatRowLine(r, false));
        const step = nextStep(r);
        if (step) lines.push(`      → Next step: ${step}`);
      }
    }
    if (receiptButStale.length) {
      lines.push(MODE === 'intra-repo'
        ? '⚠️ Receipt received but status not updated (run baton receipt <id> to register):'
        : '⚠️ Receipt received but status not updated:');
      for (const r of receiptButStale) lines.push(`  - ${r.id}`);
    }
  }
  if (warnings.length) {
    lines.push('⚠️ Compliance issues:');
    for (const w of warnings) lines.push(`  - ${w}`);
  }
}
console.log(lines.join('\n'));
