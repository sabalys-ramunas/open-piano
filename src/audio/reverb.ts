/**
 * A small, warm room made from shaped noise, so no impulse-response file has
 * to be downloaded. Returns one Float32Array per channel.
 */
export function roomImpulse(sampleRate: number, seconds = 2, seed = 7): Float32Array[] {
  const length = Math.max(1, Math.round(sampleRate * seconds));
  let state = seed >>> 0 || 1;
  const random = (): number => {
    // xorshift32: deterministic, so every page load sounds the same
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) / 4294967296) * 2 - 1;
  };
  const channels: Float32Array[] = [];
  const preDelay = Math.round(sampleRate * 0.012);
  for (let c = 0; c < 2; c++) {
    const data = new Float32Array(length);
    let low = 0;
    for (let i = preDelay; i < length; i++) {
      const t = (i - preDelay) / sampleRate;
      // Decays by 60 dB over `seconds`, and gets darker as it fades, like a real room.
      const envelope = Math.pow(10, (-3 * t) / seconds);
      const darkness = Math.min(0.92, 0.35 + t * 0.6);
      low = low * darkness + random() * (1 - darkness);
      data[i] = low * envelope * (1.6 + darkness);
    }
    // A few early reflections give a sense of walls.
    for (const [ms, gain] of [
      [17, 0.5],
      [29, 0.35],
      [43, 0.25],
    ] as const) {
      const at = preDelay + Math.round((ms + c * 3) * sampleRate * 0.001);
      if (at < length) data[at] += gain * (c === 0 ? 1 : -1);
    }
    channels.push(data);
  }
  // Normalise so the reverb level setting means the same at every sample rate.
  let energy = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) energy += ch[i] * ch[i];
  const scale = energy > 0 ? 1 / Math.sqrt(energy / 2) : 1;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] *= scale;
  return channels;
}
