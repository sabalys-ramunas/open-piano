import { describe, expect, it } from 'vitest';
import { OggOpusWriter, concat, oggCrc, opusHead, toPcm16, wavEncoder, wavHeader } from '../src/split/encode';
import { splitSupport } from '../src/split';

/** Walks Ogg pages, checking each page's CRC; returns the packets and the page fields. */
function readOgg(bytes: Uint8Array) {
  const pages: { flags: number; granule: number; sequence: number; packets: Uint8Array[] }[] = [];
  let at = 0;
  let partial: number[] = [];
  while (at < bytes.length) {
    expect(String.fromCharCode(...bytes.subarray(at, at + 4))).toBe('OggS');
    const view = new DataView(bytes.buffer, bytes.byteOffset + at);
    const segments = bytes[at + 26];
    const lacing = bytes.subarray(at + 27, at + 27 + segments);
    const bodyLength = lacing.reduce((s, x) => s + x, 0);
    const length = 27 + segments + bodyLength;
    const page = bytes.slice(at, at + length);
    const crc = new DataView(page.buffer).getUint32(22, true);
    new DataView(page.buffer).setUint32(22, 0, true);
    expect(oggCrc(page)).toBe(crc);
    const packets: Uint8Array[] = [];
    let p = at + 27 + segments;
    for (const l of lacing) {
      partial.push(...bytes.subarray(p, p + l));
      p += l;
      if (l < 255) {
        packets.push(Uint8Array.from(partial));
        partial = [];
      }
    }
    pages.push({ flags: bytes[at + 5], granule: view.getUint32(6, true) + view.getUint32(10, true) * 2 ** 32, sequence: view.getUint32(18, true), packets });
    at += length;
  }
  return pages;
}

describe('backing encoding', () => {
  it('computes the Ogg checksum', () => {
    expect(oggCrc(new TextEncoder().encode('123456789'))).toBe(0x89a1897f);
  });

  it('writes a valid Ogg Opus stream: head, tags, audio pages, granule positions, end trimming', () => {
    const head = opusHead(2, 312, 44100);
    const writer = new OggOpusWriter(head);
    expect(writer.preSkip).toBe(312);
    const packets: Uint8Array[] = [];
    for (let i = 0; i < 120; i++) {
      // Sizes around the lacing edge cases: 254, 255 (needs a trailing 0), 510 and a few ordinary ones.
      const size = [3, 254, 255, 510, 300][i % 5];
      packets.push(Uint8Array.from({ length: size }, (_, k) => (i + k) & 0xff));
    }
    for (const p of packets) writer.add(p, 960);
    const length = 120 * 960 - 500;
    const pages = readOgg(new Uint8Array(concat(writer.finish(length))));
    expect(pages[0].flags).toBe(0x02);
    expect(pages[0].packets[0]).toEqual(head);
    expect(new TextDecoder().decode(pages[1].packets[0].subarray(0, 8))).toBe('OpusTags');
    expect(pages.at(-1)!.flags).toBe(0x04);
    expect(pages.at(-1)!.granule).toBe(312 + length);
    pages.forEach((p, i) => expect(p.sequence).toBe(i));
    const audio = pages.slice(2).flatMap((p) => p.packets);
    expect(audio).toHaveLength(packets.length);
    audio.forEach((p, i) => expect(p).toEqual(packets[i]));
    // Granule positions only grow.
    const granules = pages.slice(2).map((p) => p.granule);
    expect([...granules].sort((a, b) => a - b)).toEqual(granules);
  });

  it('writes 16-bit WAV at 22.05 kHz', async () => {
    const enc = wavEncoder();
    expect(enc.rate).toBe(22050);
    await enc.push(Float32Array.from([0, 0.5, -1, 2]), Float32Array.from([1, -0.5, 0, -2]));
    await enc.push(Float32Array.from([0.25]), Float32Array.from([-0.25]));
    const { bytes, type } = await enc.finish();
    expect(type).toBe('audio/wav');
    const v = new DataView(bytes);
    expect(String.fromCharCode(...new Uint8Array(bytes, 0, 4))).toBe('RIFF');
    expect(v.getUint32(24, true)).toBe(22050);
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(40, true)).toBe(5 * 4);
    const pcm = new Int16Array(bytes, 44);
    expect([...pcm]).toEqual([0, 32767, 16384, -16383, -32767, 0, 32767, -32767, 8192, -8192]);
    expect(wavHeader(2, 22050, 0).length).toBe(44);
    expect(toPcm16(new Float32Array(0), new Float32Array(0)).length).toBe(0);
  });

  it('only splits where there are workers, WebAssembly and enough memory', () => {
    expect(splitSupport({ deviceMemory: 8, hasWorker: true, hasWasm: true }).ok).toBe(true);
    expect(splitSupport({ deviceMemory: 2, hasWorker: true, hasWasm: true })).toEqual({ ok: false, reason: 'memory' });
    expect(splitSupport({ hasWorker: false, hasWasm: true })).toEqual({ ok: false, reason: 'unsupported' });
    // Safari does not say how much memory there is: try, and stop if an allocation fails.
    expect(splitSupport({ hasWorker: true, hasWasm: true }).ok).toBe(true);
  });
});
