// Probes what the storage/playback design depends on, in Playwright Chromium
// and WebKit: WebCodecs audio encoding (to keep stems small in IndexedDB),
// decoding of the formats we would store, WebGPU, SharedArrayBuffer with and
// without COOP/COEP, storage quota.
//   node probe-features.mjs
import { spawn } from 'node:child_process';
import { chromium, webkit } from 'playwright';

const servers = [spawn(process.execPath, ['serve.mjs', '5191'], { cwd: import.meta.dirname }), spawn(process.execPath, ['serve.mjs', '5192', '--coi'], { cwd: import.meta.dirname })];
await new Promise((r) => setTimeout(r, 600));

const probe = async () => {
  const out = { crossOriginIsolated: self.crossOriginIsolated, sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined', webgpu: 'gpu' in navigator };
  out.audioEncoder = typeof AudioEncoder !== 'undefined';
  if (out.audioEncoder) {
    for (const codec of ['opus', 'mp4a.40.2', 'flac']) {
      try { out[`encode_${codec}`] = (await AudioEncoder.isConfigSupported({ codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 })).supported; } catch (e) { out[`encode_${codec}`] = `error ${e.message}`; }
    }
  }
  const a = document.createElement('audio');
  for (const [k, t] of [['ogg_opus', 'audio/ogg; codecs=opus'], ['webm_opus', 'audio/webm; codecs=opus'], ['mp4_aac', 'audio/mp4; codecs=mp4a.40.2'], ['mp4_opus', 'audio/mp4; codecs=opus'], ['flac', 'audio/flac'], ['mpeg', 'audio/mpeg']]) out[`play_${k}`] = a.canPlayType(t) || 'no';
  out.preservesPitch = 'preservesPitch' in a;
  try { const e = await navigator.storage.estimate(); out.quotaGB = +(e.quota / 1e9).toFixed(1); } catch { out.quotaGB = null; }
  return out;
};

for (const [name, type] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await type.launch({ args: name === 'chromium' ? ['--mute-audio', '--enable-unsafe-webgpu'] : [] });
  for (const port of [5191, 5192]) {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    console.log(name, browser.version(), port === 5192 ? 'COOP/COEP' : 'no headers', JSON.stringify(await page.evaluate(probe)));
    await page.close();
  }
  await browser.close();
}
for (const s of servers) s.kill();
