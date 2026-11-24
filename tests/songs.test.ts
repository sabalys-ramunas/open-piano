import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Midi } from '@tonejs/midi';
import { describe, expect, it } from 'vitest';
import { fromLesson } from '../src/lesson';
import { songLength, type Note, type Song } from '../src/song';
import { BUILT_IN, loadSongPack, type SongPackIndex } from '../src/songs';
import { assignTracks, balanceHands, cleanNotes, convertMidi, estimateDifficulty, melodyAndBass, trimLeadingSilence } from '../src/songs/convert';
import { arrangeTune, parseMelody, TUNES } from '../src/songs/tunes';

const dir = join(__dirname, '..', 'public', 'songs');
const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as SongPackIndex;
const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json');
const songs = new Map<string, Song>(files.map((f) => [f, fromLesson(readFileSync(join(dir, f), 'utf8'))]));
const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'scripts', 'songs-sources.json'), 'utf8')) as {
  mutopia: { file: string; url: string; info: string; sha256: string; sourceLicence: string; typesetter: string; easy?: object }[];
};

/** Pairs of notes on the same key that overlap in time. */
function overlaps(notes: readonly Note[]): string[] {
  const bad: string[] = [];
  const last = new Map<number, Note>();
  for (const n of [...notes].sort((a, b) => a.start - b.start)) {
    const prev = last.get(n.midi);
    if (prev && prev.start + prev.dur > n.start + 1e-6) bad.push(`${n.midi} at ${prev.start} and ${n.start}`);
    last.set(n.midi, n);
  }
  return bad;
}

describe('built-in song pack files', () => {
  it('ships a real library', () => {
    expect(files.length + BUILT_IN.length).toBeGreaterThanOrEqual(40);
    const levels = new Set([...songs.values(), ...BUILT_IN].map((s) => s.difficulty));
    expect([...levels].sort()).toEqual([1, 2, 3, 4, 5]);
    const tags = new Set([...songs.values()].flatMap((s) => s.tags ?? []));
    for (const tag of ['children', 'folk', 'classical', 'holiday', 'hymn', 'ragtime', 'easy version']) expect(tags).toContain(tag);
  });

  it('index and files agree', () => {
    expect([...index.songs].sort()).toEqual([...files].sort());
    expect(new Set(index.songs).size).toBe(index.songs.length);
    expect(index.details?.length).toBe(index.songs.length);
    for (const d of index.details ?? []) {
      const song = songs.get(d.file)!;
      expect(song.title).toBe(d.title);
      expect(song.by).toBe(d.by);
      expect(song.difficulty).toBe(d.difficulty);
      expect(song.tags).toEqual(d.tags);
      expect(song.notes.length).toBe(d.notes);
      expect(Math.abs(songLength(song) - (d.seconds ?? 0))).toBeLessThanOrEqual(1);
    }
  });

  it.each(files)('%s has metadata, a licence and sane notes', (file) => {
    const song = songs.get(file)!;
    expect(song.title.length).toBeGreaterThan(2);
    expect(song.by.length).toBeGreaterThan(2);
    expect(song.difficulty).toBeGreaterThanOrEqual(1);
    expect(song.tags?.length).toBeGreaterThan(0);
    expect(song.licence).toMatch(/^(Public domain|CC0 1\.0|CC BY(-SA)? \d\.\d)/);
    expect(song.credit?.length).toBeGreaterThan(10);
    expect(song.bpm).toBeGreaterThanOrEqual(20);
    expect(song.timeSignature).toBeDefined();
    expect(song.beats!.length).toBeGreaterThan(4);

    const notes = song.notes;
    expect(notes.length).toBeGreaterThanOrEqual(20);
    expect(notes.some((n) => n.hand === 'right')).toBe(true);
    expect(notes.some((n) => n.hand === 'left')).toBe(true);
    expect(notes.every((n) => n.midi >= 21 && n.midi <= 108 && n.dur > 0 && n.dur < 20)).toBe(true);
    expect(notes[0].start).toBe(0); // leading silence trimmed
    const length = songLength(song);
    expect(length).toBeGreaterThan(8);
    expect(length).toBeLessThan(600);
    expect(overlaps(notes)).toEqual([]);
    // Each hand stays playable by one hand: no more than five keys at once.
    for (const hand of ['right', 'left'] as const) {
      const starts = new Map<number, number>();
      for (const n of notes.filter((x) => x.hand === hand)) starts.set(n.start, (starts.get(n.start) ?? 0) + 1);
      expect(Math.max(...starts.values())).toBeLessThanOrEqual(5);
    }
  });

  it('credits share-alike editions under the same licence, and every Mutopia source is pinned', () => {
    for (const entry of manifest.mutopia) {
      expect(entry.url).toMatch(/^https:\/\/www\.mutopiaproject\.org\/ftp\/.+\.mid$/);
      expect(entry.info).toMatch(/^https:\/\/www\.mutopiaproject\.org\/cgibin\/piece-info\.cgi\?id=\d+$/);
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      const song = songs.get(`${entry.file}.json`);
      expect(song, entry.file).toBeDefined();
      expect(song!.credit).toContain(entry.typesetter);
      expect(song!.credit).toContain('Mutopia');
      if (/ShareAlike/.test(entry.sourceLicence)) expect(song!.licence).toMatch(/^CC BY-SA/);
      if (entry.easy) {
        const easy = songs.get(`${entry.file}-easy.json`)!;
        expect(easy.tags).toContain('easy version');
        expect(easy.notes.length).toBeLessThan(song!.notes.length);
        if (/ShareAlike/.test(entry.sourceLicence)) expect(easy.licence).toMatch(/^CC BY-SA/);
      }
    }
  });
});

describe('hand-arranged tunes', () => {
  it.each(TUNES.map((t) => [t.slug, t] as const))('%s has whole bars and keeps the hands apart', (_slug, tune) => {
    const lessons = arrangeTune(tune); // throws on a wrong bar length or chord count
    expect(lessons.length).toBe(tune.easyOnly ? 1 : 2);
    for (const { song } of lessons) {
      expect(song.notes.filter((n) => n.hand === 'right').every((n) => n.midi >= 60)).toBe(true);
      expect(song.notes.filter((n) => n.hand === 'left').every((n) => n.midi < 60)).toBe(true);
      expect(overlaps(song.notes)).toEqual([]);
    }
    if (lessons.length === 2) {
      const [easy, full] = lessons;
      expect(easy.song.title).toMatch(/\(easy\)$/);
      expect(full.song.notes.filter((n) => n.hand === 'left').length).toBeGreaterThan(easy.song.notes.filter((n) => n.hand === 'left').length);
    }
  });

  it('reads ties, rests and bar lengths', () => {
    const parsed = parseMelody('C4/1 _/1 D4/2~ | D4/1 E4/3');
    expect(parsed.bars).toEqual([4, 4]);
    expect(parsed.notes).toEqual([
      { midi: 60, start: 0, dur: 1 },
      { midi: 62, start: 2, dur: 3 },
      { midi: 64, start: 5, dur: 3 },
    ]);
    expect(() => parseMelody('C4/1 H4/1')).toThrow();
  });
});

describe('MIDI conversion', () => {
  const note = (midi: number, start: number, dur: number, hand: Note['hand'] = 'right'): Note => ({ midi, start, dur, hand });

  it('groups tracks into hands by pitch', () => {
    expect(assignTracks([52, 70])).toEqual(['left', 'right']);
    expect(assignTracks([70, 66, 50])).toEqual(['right', 'right', 'left']);
    expect(assignTracks([70, 54, 50])).toEqual(['right', 'left', 'left']);
  });

  it('removes duplicate and overlapping strikes of one key', () => {
    const cleaned = cleanNotes([note(60, 0, 1), note(60, 0.005, 2, 'left'), note(60, 1.5, 1), note(64, 0, 0.001)]);
    expect(cleaned.filter((n) => n.midi === 60)).toHaveLength(2);
    expect(overlaps(cleaned)).toEqual([]);
    expect(cleaned.find((n) => n.midi === 64)!.dur).toBeGreaterThanOrEqual(0.02);
  });

  it('moves extra keys of a six-note chord to the other hand', () => {
    const notes = [35, 42, 47, 51, 54, 59].map((m) => note(m, 1, 1, 'left'));
    balanceHands(notes);
    expect(notes.filter((n) => n.hand === 'right').map((n) => n.midi)).toEqual([59]);
  });

  it('trims leading silence', () => {
    const notes = [note(60, 2.5, 1), note(62, 3, 1)];
    expect(trimLeadingSilence(notes)).toBe(2.5);
    expect(notes.map((n) => n.start)).toEqual([0, 0.5]);
  });

  it('reads a two-track file with tempo, time signature, beats and hands', () => {
    const midi = new Midi();
    midi.header.setTempo(90);
    midi.header.timeSignatures.push({ ticks: 0, timeSignature: [3, 4] });
    midi.header.update();
    const right = midi.addTrack();
    const left = midi.addTrack();
    // One silent beat first, then a bar of melody over a held bass note.
    [72, 74, 76].forEach((m, i) => right.addNote({ midi: m, ticks: midi.header.ppq * (1 + i), durationTicks: midi.header.ppq }));
    right.addNote({ midi: 72, ticks: midi.header.ppq * 1, durationTicks: midi.header.ppq / 2 }); // doubled note
    left.addNote({ midi: 48, ticks: midi.header.ppq, durationTicks: midi.header.ppq * 3 });
    const out = convertMidi(midi.toArray());
    expect(out.timeSignature).toEqual({ beats: 3, unit: 4 });
    expect(out.bpm).toBe(90);
    expect(out.notes[0].start).toBe(0);
    expect(out.notes.filter((n) => n.hand === 'left').map((n) => n.midi)).toEqual([48]);
    expect(out.notes.filter((n) => n.hand === 'right').map((n) => n.midi)).toEqual([72, 74, 76]);
    expect(out.beats!.slice(0, 3)).toEqual([0, 0.666, 1.333]); // relative to the first note, which starts at 0.667 s
    expect(convertMidi(midi.toArray(), { tempoScale: 2 }).bpm).toBe(180);
  });

  it('splits a single track at middle C', () => {
    const midi = new Midi();
    const track = midi.addTrack();
    track.addNote({ midi: 48, time: 0, duration: 0.5 });
    track.addNote({ midi: 67, time: 0, duration: 0.5 });
    expect(convertMidi(midi.toArray()).notes.map((n) => n.hand)).toEqual(['left', 'right']);
  });

  it('makes a melody-and-bass arrangement with the top line and one bass note per bar', () => {
    const notes = [
      note(72, 0, 0.5), note(64, 0, 0.5), note(74, 0.5, 0.5), note(76, 1, 1), note(67, 1.2, 0.3),
      note(48, 0, 0.4, 'left'), note(55, 0.5, 0.4, 'left'), note(52, 1, 0.4, 'left'), note(43, 1.5, 0.4, 'left'),
    ];
    const easy = melodyAndBass({ notes, beats: [0, 0.5, 1, 1.5, 2], timeSignature: { beats: 2, unit: 4 } });
    expect(easy.filter((n) => n.hand === 'right').map((n) => n.midi)).toEqual([72, 74, 76]);
    expect(easy.filter((n) => n.hand === 'left').map((n) => n.midi)).toEqual([48, 52]);
  });

  it('rates busier music as harder', () => {
    const slow = Array.from({ length: 16 }, (_, i) => note(60 + (i % 5), i, 0.9));
    const fast = Array.from({ length: 200 }, (_, i) => note(60 + ((i * 7) % 24), i * 0.08, 0.07)).concat(
      Array.from({ length: 100 }, (_, i) => note(36 + ((i * 5) % 12), i * 0.16, 0.15, 'left')),
    );
    expect(estimateDifficulty(slow)).toBe(1);
    expect(estimateDifficulty(fast)).toBeGreaterThanOrEqual(4);
  });
});

describe('loadSongPack', () => {
  const lesson = (title: string) => JSON.stringify({ format: 'piano-lesson', version: 1, title, by: 'x', notes: [[60, 0, 1, 0]] });

  it('loads listed files in order, skipping unsafe names and broken files', async () => {
    const served: Record<string, string> = {
      '/songs/index.json': JSON.stringify({ songs: ['b.json', '../evil.json', 'a.json', 'broken.json', 'missing.json', 'a.json'] }),
      '/songs/a.json': lesson('A'),
      '/songs/b.json': lesson('B'),
      '/songs/broken.json': '{"format":"piano-lesson"',
    };
    const requested: string[] = [];
    const fetcher = async (url: string) => {
      requested.push(url);
      const body = served[url];
      return { ok: body !== undefined, json: async () => JSON.parse(body ?? 'null'), text: async () => body ?? '' };
    };
    const loaded = await loadSongPack(fetcher, '/');
    expect(loaded.map((s) => [s.id, s.title, s.source])).toEqual([
      ['pack:b', 'B', 'built-in'],
      ['pack:a', 'A', 'built-in'],
    ]);
    expect(requested.some((u) => u.includes('evil'))).toBe(false);
  });

  it('returns nothing when the index is missing', async () => {
    const fetcher = async () => ({ ok: false, json: async () => null, text: async () => '' });
    expect(await loadSongPack(fetcher, '/')).toEqual([]);
  });
});
