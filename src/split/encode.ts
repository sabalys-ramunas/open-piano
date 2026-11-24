// Keeps the split backing small enough to store: Opus in an Ogg file through
// WebCodecs (AudioEncoder) where the browser has it and can play the result,
// otherwise 16-bit WAV at 22.05 kHz. Works in a worker. The Ogg writer is a
// minimal one: one logical stream, Opus packets, page CRCs, granule positions
// in 48 kHz samples (RFC 7845).

export interface EncodedAudio {
  bytes: ArrayBuffer;
  type: string;
}

export interface BackingEncoder {
  /** Rate the encoder wants its input at. */
  readonly rate: 44100 | 22050;
  push(left: Float32Array, right: Float32Array): Promise<void>;
  finish(): Promise<EncodedAudio>;
  close(): void;
}

export const OGG_OPUS_TYPE = 'audio/ogg; codecs=opus';
export const WAV_TYPE = 'audio/wav';
const OPUS_BITRATE = 96_000;

// ---------------------------------------------------------------------------
// Ogg

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();

/** The Ogg page checksum (CRC-32, polynomial 0x04c11db7, no reflection, starting at 0). */
export function oggCrc(bytes: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ bytes[i]) & 0xff]) >>> 0;
  return crc >>> 0;
}

/** Writes Ogg pages for one Opus stream. */
export class OggOpusWriter {
  private pages: Uint8Array[] = [];
  private pending: Uint8Array[] = [];
  private pendingSegments = 0;
  private sequence = 0;
  private granule = 0;
  private readonly serial: number;
  readonly preSkip: number;

  /** `head` is the OpusHead packet (WebCodecs gives it as the decoder description). */
  constructor(head: Uint8Array, serial = 0x5049414e) {
    this.serial = serial >>> 0;
    this.preSkip = head.length >= 12 ? head[10] | (head[11] << 8) : 312;
    this.page([head], 0, 0x02);
    const vendor = new TextEncoder().encode('piano');
    const tags = new Uint8Array(8 + 4 + vendor.length + 4);
    tags.set(new TextEncoder().encode('OpusTags'));
    new DataView(tags.buffer).setUint32(8, vendor.length, true);
    tags.set(vendor, 12);
    this.page([tags], 0, 0);
  }

  /** Adds one Opus packet that holds `samples` samples at 48 kHz. */
  add(packet: Uint8Array, samples: number): void {
    const segments = Math.floor(packet.length / 255) + 1;
    if (this.pendingSegments + segments > 255) this.flush();
    this.pending.push(packet);
    this.pendingSegments += segments;
    this.granule += samples;
    // About one second per page.
    if (this.pending.length >= 50) this.flush();
  }

  /** The whole file. `length` (48 kHz samples, without the pre-skip) trims the end exactly. */
  finish(length?: number): Uint8Array[] {
    if (length !== undefined) this.granule = Math.min(this.granule, this.preSkip + Math.max(0, Math.round(length)));
    this.flush(true);
    return this.pages;
  }

  private flush(last = false): void {
    if (this.pending.length === 0 && !last) return;
    this.page(this.pending, this.granule, last ? 0x04 : 0);
    this.pending = [];
    this.pendingSegments = 0;
  }

  private page(packets: readonly Uint8Array[], granule: number, flags: number): void {
    const lacing: number[] = [];
    let body = 0;
    for (const p of packets) {
      let left = p.length;
      while (left >= 255) {
        lacing.push(255);
        left -= 255;
      }
      lacing.push(left);
      body += p.length;
    }
    const page = new Uint8Array(27 + lacing.length + body);
    const view = new DataView(page.buffer);
    page.set([0x4f, 0x67, 0x67, 0x53]); // OggS
    page[4] = 0;
    page[5] = flags;
    view.setUint32(6, granule % 2 ** 32, true);
    view.setUint32(10, Math.floor(granule / 2 ** 32), true);
    view.setUint32(14, this.serial, true);
    view.setUint32(18, this.sequence++, true);
    view.setUint32(22, 0, true);
    page[26] = lacing.length;
    page.set(lacing, 27);
    let at = 27 + lacing.length;
    for (const p of packets) {
      page.set(p, at);
      at += p.length;
    }
    view.setUint32(22, oggCrc(page), true);
    this.pages.push(page);
  }
}

// ---------------------------------------------------------------------------
// WAV

/** The 44-byte header of a 16-bit PCM WAV file. */
export function wavHeader(channels: number, rate: number, dataBytes: number): Uint8Array {
  const h = new Uint8Array(44);
  const v = new DataView(h.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) h[at + i] = s.charCodeAt(i);
  };
  text(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, dataBytes, true);
  return h;
}

/** Interleaved 16-bit samples of two channels. */
export function toPcm16(left: Float32Array, right: Float32Array): Uint8Array {
  const out = new Int16Array(left.length * 2);
  for (let i = 0; i < left.length; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    out[2 * i] = Math.round(l * 32767);
    out[2 * i + 1] = Math.round(r * 32767);
  }
  return new Uint8Array(out.buffer);
}

/** Glues parts into one ArrayBuffer. */
export function concat(parts: readonly Uint8Array[]): ArrayBuffer {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out.buffer;
}

export function wavEncoder(): BackingEncoder {
  const parts: Uint8Array[] = [];
  let bytes = 0;
  return {
    rate: 22050,
    async push(left, right) {
      const pcm = toPcm16(left, right);
      parts.push(pcm);
      bytes += pcm.length;
    },
    async finish() {
      return { bytes: concat([wavHeader(2, 22050, bytes), ...parts]), type: WAV_TYPE };
    },
    close() {
      parts.length = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Opus through WebCodecs

/** True when this browser can make Opus with WebCodecs from 44.1 kHz stereo. */
export async function canEncodeOpus(): Promise<boolean> {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return false;
  try {
    const support = await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: 44100, numberOfChannels: 2, bitrate: OPUS_BITRATE });
    return support.supported === true;
  } catch {
    return false;
  }
}

export function opusEncoder(): BackingEncoder {
  let writer: OggOpusWriter | null = null;
  let failure: Error | null = null;
  let frames = 0;
  let timestamp = 0;
  const early: [Uint8Array, number][] = [];
  const encoder = new AudioEncoder({
    output(chunk, meta) {
      const desc = meta?.decoderConfig?.description;
      if (!writer && desc) {
        const head = ArrayBuffer.isView(desc) ? new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength) : new Uint8Array(desc);
        writer = new OggOpusWriter(Uint8Array.from(head));
      }
      const packet = new Uint8Array(chunk.byteLength);
      chunk.copyTo(packet);
      const samples = Math.round(((chunk.duration ?? 20_000) * 48_000) / 1e6);
      if (writer) {
        for (const [p, s] of early.splice(0)) writer.add(p, s);
        writer.add(packet, samples);
      } else {
        early.push([packet, samples]);
      }
    },
    error(error) {
      failure = error instanceof Error ? error : new Error(String(error));
    },
  });
  encoder.configure({ codec: 'opus', sampleRate: 44100, numberOfChannels: 2, bitrate: OPUS_BITRATE });
  const waitForQueue = async () => {
    while (encoder.encodeQueueSize > 2 && !failure) await new Promise((r) => setTimeout(r, 5));
  };
  return {
    rate: 44100,
    async push(left, right) {
      if (failure) throw failure;
      const data = new Float32Array(left.length * 2);
      data.set(left, 0);
      data.set(right, left.length);
      const audio = new AudioData({ format: 'f32-planar', sampleRate: 44100, numberOfFrames: left.length, numberOfChannels: 2, timestamp, data });
      timestamp += Math.round((left.length * 1e6) / 44100);
      frames += left.length;
      encoder.encode(audio);
      audio.close();
      await waitForQueue();
    },
    async finish() {
      await encoder.flush();
      encoder.close();
      if (failure) throw failure;
      // An encoder that never described its stream: make the OpusHead ourselves.
      const out = writer ?? new OggOpusWriter(opusHead(2, 312, 44100));
      for (const [p, s] of early.splice(0)) out.add(p, s);
      const pages = out.finish((frames * 48_000) / 44100);
      return { bytes: concat(pages), type: OGG_OPUS_TYPE };
    },
    close() {
      if (encoder.state !== 'closed') encoder.close();
    },
  };
}

/** An OpusHead packet (RFC 7845, mapping family 0). */
export function opusHead(channels: number, preSkip: number, inputRate: number): Uint8Array {
  const h = new Uint8Array(19);
  const v = new DataView(h.buffer);
  h.set(new TextEncoder().encode('OpusHead'));
  h[8] = 1;
  h[9] = channels;
  v.setUint16(10, preSkip, true);
  v.setUint32(12, inputRate, true);
  v.setInt16(16, 0, true);
  h[18] = 0;
  return h;
}
