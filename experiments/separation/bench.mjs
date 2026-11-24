// Drives the spike page in Playwright Chromium / WebKit and records timings,
// peak memory (RSS of the whole browser process tree, sampled every 200 ms)
// and, with --score, SDR against the synthetic ground truth.
//
//   node bench.mjs --browser chromium|webkit --model htdemucs|htdemucs_6s|spleeter4
//                  --ep wasm|webgpu [--threads 0] [--sec 30] [--coi] [--score] [--headed]
//
// Playwright is resolved from the app's node_modules (parent folders).
// Appends one JSON line per run to results/bench.jsonl.
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { chromium, webkit } from 'playwright';

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? def : process.argv[i + 1]; };
const flag = (name) => process.argv.includes(`--${name}`);
const browserName = arg('browser', 'chromium');
const model = arg('model', 'spleeter4');
const ep = arg('ep', 'wasm');
const threads = Number(arg('threads', '0'));
const sec = arg('sec', '30');
const coi = flag('coi');
const lowMem = flag('lowmem');
const port = coi ? 5192 : 5191;
const timeoutMin = Number(arg('timeout', '40'));

const server = spawn(process.execPath, ['serve.mjs', String(port), ...(coi ? ['--coi'] : [])], { cwd: import.meta.dirname, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => server.stdout.once('data', r));

// WebKit's WebContent/GPU/Networking processes are XPC services parented to
// launchd, not to the browser process, so for WebKit we also count Playwright
// WebKit processes that appeared after launch (a concurrent WebKit run by
// someone else on this machine would be counted too).
function psTable() {
  const out = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss=,command=']).toString();
  return out.trim().split('\n').map((line) => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
    return { pid: +m[1], ppid: +m[2], rss: +m[3], cmd: m[4] };
  });
}
const WEBKIT_RE = /ms-playwright\/webkit-[^/]+\/com\.apple\.WebKit/;
const preexisting = new Set(psTable().filter((p) => WEBKIT_RE.test(p.cmd)).map((p) => p.pid));
function treeRssMb(rootPid) {
  const table = psTable();
  const kids = new Map(); const rss = new Map();
  for (const { pid, ppid, rss: r } of table) {
    rss.set(pid, r);
    if (!kids.has(ppid)) kids.set(ppid, []);
    kids.get(ppid).push(pid);
  }
  let total = 0; const seen = new Set(); const stack = [rootPid];
  while (stack.length) { const p = stack.pop(); seen.add(p); total += rss.get(p) ?? 0; stack.push(...(kids.get(p) ?? [])); }
  if (browserName === 'webkit') for (const p of table) if (WEBKIT_RE.test(p.cmd) && !preexisting.has(p.pid) && !seen.has(p.pid)) total += p.rss;
  return total / 1024;
}

const type = browserName === 'webkit' ? webkit : chromium;
const args = browserName === 'chromium' ? ['--mute-audio', '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal'] : [];
const bs = await type.launchServer({ headless: !flag('headed'), args });
const rootPid = bs.process().pid;
const browser = await type.connect(bs.wsEndpoint());
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[page ${m.type()}]`, m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

const baseline = treeRssMb(rootPid);
let peak = baseline;
const sampler = setInterval(() => { try { peak = Math.max(peak, treeRssMb(rootPid)); } catch { /* process gone */ } }, 200);

const record = { when: new Date().toISOString(), browser: browserName, version: browser.version(), model, ep, threads, sec: Number(sec), coi, lowMem };
try {
  await page.goto(`http://127.0.0.1:${port}/`);
  record.pageEnv = await page.evaluate(() => ({ crossOriginIsolated: self.crossOriginIsolated, cores: navigator.hardwareConcurrency, webgpu: 'gpu' in navigator, ua: navigator.userAgent }));
  if (record.pageEnv.webgpu) {
    record.pageEnv.adapter = await page.evaluate(async () => { try { const a = await navigator.gpu.requestAdapter(); return a ? `${a.info?.vendor ?? ''} ${a.info?.architecture ?? ''}`.trim() || 'adapter' : null; } catch (e) { return `error: ${e.message}`; } });
  }
  page.setDefaultTimeout(timeoutMin * 60_000);
  const upload = flag('score') ? `${browserName}_${model}_${ep}_t${threads}${coi ? '_coi' : ''}${lowMem ? '_lowmem' : ''}_${sec}` : undefined;
  const t0 = Date.now();
  const r = await page.evaluate((o) => window.__separate(o), { url: `/testdata/mix_${sec}.wav`, model, ep, threads, upload, lowMem });
  record.wallMs = Date.now() - t0;
  Object.assign(record, r);
  record.realtimeFactor = +(r.seconds / (r.timings.separateMs / 1000)).toFixed(2);
  record.upload = upload;
} catch (e) {
  record.error = String(e.message ?? e).split('\n')[0].slice(0, 400);
}
clearInterval(sampler);
record.rssBaselineMb = Math.round(baseline);
record.rssPeakMb = Math.round(peak);
await browser.close().catch(() => {});
await bs.close().catch(() => {});
server.kill();
mkdirSync('results', { recursive: true });
appendFileSync('results/bench.jsonl', JSON.stringify(record) + '\n');
console.log(JSON.stringify(record, null, 1));
if (record.upload && !record.error) {
  execFileSync(process.execPath, ['evaluate.mjs', `results/audio/${record.upload}`, sec, '--json', `results/quality_${record.upload}.json`], { stdio: 'inherit', cwd: import.meta.dirname });
}
