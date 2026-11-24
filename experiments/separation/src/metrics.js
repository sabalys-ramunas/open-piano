// Objective quality measures against known stems (Node only).
//
// sdrGlobal: 10 log10(|s|^2 / |s - s_hat|^2) over the whole track, both
//   channels. This is the "SDR" of the Sony/MDX 2021 challenge (no
//   distortion filter), stricter than museval's BSS-eval v4 numbers that most
//   papers quote, so expect lower values than the papers.
// sdrMedian: same formula on 1 s frames, median over frames where the true
//   stem is not silent (close in spirit to museval's per-frame median).
// leakage: how the estimate's energy splits between the true stems
//   (least-squares projection onto each true stem; stems are nearly
//   orthogonal), plus what is left over (artefacts).

export function sdrGlobal(ref, est) {
  let num = 0, den = 0;
  for (let i = 0; i < ref.length; i++) { const d = ref[i] - est[i]; num += ref[i] * ref[i]; den += d * d; }
  return 10 * Math.log10((num + 1e-12) / (den + 1e-12));
}

export function sdrMedian(ref, est, frame = 44100 * 2) {
  const vals = [];
  for (let s = 0; s + frame <= ref.length; s += frame) {
    let num = 0, den = 0;
    for (let i = s; i < s + frame; i++) { const d = ref[i] - est[i]; num += ref[i] * ref[i]; den += d * d; }
    if (num / frame > 1e-7) vals.push(10 * Math.log10((num + 1e-12) / (den + 1e-12)));
  }
  vals.sort((a, b) => a - b);
  return vals.length ? vals[Math.floor(vals.length / 2)] : NaN;
}

export function energy(x) { let e = 0; for (let i = 0; i < x.length; i++) e += x[i] * x[i]; return e; }

/** Fraction of est's energy explained by each true stem, and the unexplained rest. */
export function leakage(est, truths) {
  const total = energy(est) + 1e-12;
  const shares = {};
  const resid = Float32Array.from(est);
  for (const [name, s] of Object.entries(truths)) {
    let dot = 0; const es = energy(s) + 1e-12;
    for (let i = 0; i < s.length; i++) dot += est[i] * s[i];
    const a = dot / es;
    shares[name] = (a * a * es) / total;
    for (let i = 0; i < s.length; i++) resid[i] -= a * s[i];
  }
  shares.artefacts = energy(resid) / total;
  return shares;
}

/** Interleaves two channels (for comparing with the interleaved ground truth). */
export function interleave(l, r) {
  const out = new Float32Array(l.length * 2);
  for (let i = 0; i < l.length; i++) { out[2 * i] = l[i]; out[2 * i + 1] = r[i]; }
  return out;
}
