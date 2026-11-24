// Page side of the spike: decode, hand samples to a worker, show progress,
// then play the stems together through Web Audio with a volume per stem.
// window.__separate(options) is the hook bench.mjs drives.

const $ = (id) => document.getElementById(id);
const SR = 44100;
let worker = null;
let lastStems = null;
let playing = [];
let audioCtx = null;
const gains = {};

$('env').textContent = `crossOriginIsolated: ${self.crossOriginIsolated === true} · cores: ${navigator.hardwareConcurrency} · WebGPU: ${'gpu' in navigator ? 'present' : 'absent'}`;

async function decode(arrayBuffer) {
  // OfflineAudioContext at 44.1 kHz resamples whatever the file is to what the model expects.
  const ctx = new OfflineAudioContext(2, 1, SR);
  const buf = await ctx.decodeAudioData(arrayBuffer);
  const left = buf.getChannelData(0).slice();
  const right = buf.numberOfChannels > 1 ? buf.getChannelData(1).slice() : left.slice();
  return { left, right, seconds: buf.duration };
}

/**
 * Runs one separation. Resolves with timings and stems.
 * @param {{ url?: string, file?: File, model: string, ep: string, threads?: number, upload?: string }} o
 */
async function runSeparation(o) {
  const t0 = performance.now();
  const bytes = o.file ? await o.file.arrayBuffer() : await (await fetch(o.url)).arrayBuffer();
  const { left, right, seconds } = await decode(bytes);
  const decodeMs = performance.now() - t0;
  setStatus(`Decoded ${seconds.toFixed(1)} s of audio. Loading the model...`);

  worker?.terminate();
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  const w = worker;
  $('cancel').disabled = false;
  const result = await new Promise((resolve, reject) => {
    let lastPct = -1;
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'download') {
        const pct = m.total ? Math.floor((100 * m.got) / m.total) : 0;
        if (pct !== lastPct) { lastPct = pct; setStatus(`Downloading ${m.file}: ${pct}%`); $('bar').value = 0; }
      } else if (m.type === 'stage') {
        if (m.stage === 'load') setStatus('Preparing the model...');
        if (m.stage === 'separate') setStatus('Splitting...');
      } else if (m.type === 'progress') {
        $('bar').value = m.fraction;
        setStatus(`Splitting: ${Math.round(100 * m.fraction)}%`);
      } else if (m.type === 'done') {
        resolve(m);
      } else if (m.type === 'error') {
        reject(Object.assign(new Error(m.message), { timings: m.timings, info: m.info }));
      }
    };
    w.onerror = (e) => reject(new Error(e.message || 'Worker failed'));
    w.postMessage({ type: 'run', model: o.model, ep: o.ep, threads: o.threads ?? 0, lowMem: o.lowMem === true, left, right, modelBase: new URL('../models/', import.meta.url).href }, [left.buffer, right.buffer]);
  }).finally(() => { $('cancel').disabled = true; w.terminate(); if (worker === w) worker = null; });

  const stems = {};
  for (const [name, [l, r]] of Object.entries(result.stems)) stems[name] = { left: l, right: r };
  if (o.upload) {
    for (const [name, { left: l, right: r }] of Object.entries(stems)) {
      const inter = new Float32Array(l.length * 2);
      for (let i = 0; i < l.length; i++) { inter[2 * i] = l[i]; inter[2 * i + 1] = r[i]; }
      await fetch(`/upload/${o.upload}/${name}.f32`, { method: 'POST', body: inter });
    }
  }
  return { seconds, decodeMs, timings: result.timings, info: result.info, stems };
}

function setStatus(text) { $('status').textContent = text; }

function wavBlob(l, r) {
  const n = l.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, SR, true);
  v.setUint32(28, SR * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    v.setInt16(44 + 4 * i, Math.max(-1, Math.min(1, l[i])) * 32767, true);
    v.setInt16(46 + 4 * i, Math.max(-1, Math.min(1, r[i])) * 32767, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

function showStems(stems, report) {
  lastStems = stems;
  const rows = $('rows');
  rows.replaceChildren();
  for (const [name, { left, right }] of Object.entries(stems)) {
    const tr = document.createElement('tr');
    const tdName = document.createElement('td'); tdName.textContent = name;
    const tdVol = document.createElement('td');
    const range = Object.assign(document.createElement('input'), { type: 'range', min: '0', max: '1', step: '0.01', value: '1' });
    range.setAttribute('aria-label', `${name} volume`);
    range.dataset.stem = name;
    range.addEventListener('input', () => { if (gains[name]) gains[name].gain.value = Number(range.value); });
    tdVol.append(range);
    const tdDl = document.createElement('td');
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(wavBlob(left, right)), download: `${name}.wav`, textContent: `${name}.wav` });
    tdDl.append(a);
    tr.append(tdName, tdVol, tdDl);
    rows.append(tr);
  }
  $('report').textContent = JSON.stringify(report, null, 2);
  $('results').hidden = false;
}

function stopAll() { for (const s of playing) { try { s.stop(); } catch { /* already stopped */ } } playing = []; }

$('play').addEventListener('click', () => {
  if (!lastStems) return;
  stopAll();
  audioCtx ??= new AudioContext({ sampleRate: SR });
  const when = audioCtx.currentTime + 0.1;
  for (const [name, { left, right }] of Object.entries(lastStems)) {
    const buf = audioCtx.createBuffer(2, left.length, SR);
    buf.copyToChannel(left, 0); buf.copyToChannel(right, 1);
    const src = audioCtx.createBufferSource(); src.buffer = buf;
    const g = audioCtx.createGain();
    g.gain.value = Number(document.querySelector(`input[data-stem="${name}"]`)?.value ?? 1);
    gains[name] = g;
    src.connect(g).connect(audioCtx.destination);
    src.start(when);
    playing.push(src);
  }
});
$('stop').addEventListener('click', stopAll);
$('backing').addEventListener('click', () => {
  for (const input of document.querySelectorAll('input[data-stem]')) {
    const off = ['other', 'guitar', 'piano'].includes(input.dataset.stem);
    input.value = off ? '0' : '1';
    input.dispatchEvent(new Event('input'));
  }
});
$('cancel').addEventListener('click', () => { worker?.postMessage({ type: 'cancel' }); setStatus('Cancelling...'); });
$('go').addEventListener('click', async () => {
  const file = $('file').files?.[0];
  if (!file) { setStatus('Choose a recording first.'); return; }
  $('go').disabled = true;
  try {
    const r = await runSeparation({ file, model: $('model').value, ep: $('ep').value, threads: Number($('threads').value) });
    const audioSeconds = r.seconds;
    setStatus(`Done. ${audioSeconds.toFixed(1)} s of audio split in ${(r.timings.separateMs / 1000).toFixed(1)} s.`);
    showStems(r.stems, { seconds: r.seconds, decodeMs: Math.round(r.decodeMs), timings: r.timings, info: r.info });
  } catch (e) {
    setStatus(e.message === 'Cancelled' ? 'Cancelled.' : `Could not split: ${e.message}`);
  } finally {
    $('go').disabled = false;
  }
});

// Hook for bench.mjs: returns numbers only (stems go to the server via upload).
window.__separate = async (o) => {
  const r = await runSeparation(o);
  return { seconds: r.seconds, decodeMs: r.decodeMs, timings: r.timings, info: r.info, stems: Object.keys(r.stems) };
};
