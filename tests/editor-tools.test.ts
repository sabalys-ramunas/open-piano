import { describe, expect, it } from 'vitest';
import type { Instrument } from '../src/audio/instrument';
import { decodeDraft, draftKey, encodeDraft, sameContent } from '../src/editor/draft';
import { makeNote } from '../src/editor/model';
import { parseTags } from '../src/editor/panels';
import { Recorder } from '../src/editor/recorder';
import { WHILE_RECORDING, actionFor, cheatSheet, type KeyLike } from '../src/editor/shortcuts';
import { TapTempo, bpmFromTaps } from '../src/editor/tempo';
import { Transport, type EditorBacking } from '../src/editor/transport';
import { clampView, firstVisible, fitView, hitTest, midiAt, scrollBy, timeAt, xOf, yOf, zoomTime, type Viewport } from '../src/editor/viewport';
import { computePeaks, peakRange } from '../src/editor/waveform';
import type { Song } from '../src/song';

describe('tap tempo', () => {
  it('needs four taps and uses the middle gap', () => {
    expect(bpmFromTaps([0, 500, 1000])).toBeNull();
    expect(bpmFromTaps([0, 500, 1000, 1500])).toBe(120);
    // One sloppy tap does not move the result.
    expect(bpmFromTaps([0, 500, 1000, 1700, 2200, 2700])).toBe(120);
  });

  it('starts over after a long pause', () => {
    const t = new TapTempo();
    [0, 600, 1200, 1800].forEach((x) => t.tap(x));
    expect(t.tap(2400)).toBe(100);
    expect(t.tap(9000)).toBeNull();
    expect(t.count).toBe(1);
  });
});

describe('recorder', () => {
  it('turns key presses into notes, split into hands by key', () => {
    const r = new Recorder('auto', 60);
    r.down(64, 1);
    r.down(48, 1.1);
    r.up(64, 1.5);
    expect(r.notes).toHaveLength(1);
    expect(r.holding).toBe(1);
    const notes = r.finish(2);
    expect(notes.map((n) => [n.midi, n.start, n.hand])).toEqual([
      [64, 1, 'right'],
      [48, 1.1, 'left'],
    ]);
    expect(notes[1].dur).toBeCloseTo(0.9, 6);
  });

  it('records into one hand when asked, ignores keys off the piano and clamps to 0', () => {
    const r = new Recorder('left');
    r.down(72, -0.05);
    r.up(72, 0.2);
    r.down(5, 0);
    expect(r.finish(1).map((n) => [n.midi, n.start, n.hand])).toEqual([[72, 0, 'left']]);
  });

  it('a second press of a held key ends the first note', () => {
    const r = new Recorder('right');
    r.down(60, 0);
    r.down(60, 0.5);
    r.up(60, 0.7);
    expect(r.finish(1).map((n) => n.start)).toEqual([0, 0.5]);
  });
});

describe('viewport', () => {
  const v: Viewport = { t0: 10, pxPerSec: 100, top: 72, rowH: 10, width: 800, height: 240 };

  it('maps time and pitch both ways', () => {
    expect(xOf(v, 11)).toBe(100);
    expect(timeAt(v, 250)).toBe(12.5);
    expect(yOf(v, 71)).toBe(0);
    expect(midiAt(v, 5)).toBe(71);
    expect(midiAt(v, 15)).toBe(70);
  });

  it('zooms around the pointer', () => {
    const z = zoomTime(v, 2, 400);
    expect(timeAt(z, 400)).toBeCloseTo(timeAt(v, 400), 9);
    expect(z.pxPerSec).toBe(200);
  });

  it('stays inside the song and the keyboard', () => {
    const c = clampView(scrollBy(v, -100000, -100000), 60);
    expect(c.t0).toBe(-0.5);
    expect(c.top).toBe(120);
    const low = clampView(scrollBy(v, 0, 100000), 60);
    expect(low.top - low.height / low.rowH).toBeCloseTo(12, 6);
  });

  it('fits a range of time and keys', () => {
    const f = fitView(v, 0, 8, 60, 72);
    expect(timeAt(f, 0)).toBeLessThan(0);
    expect(timeAt(f, f.width)).toBeGreaterThan(8);
    expect(midiAt(f, 0)).toBeGreaterThanOrEqual(72);
    expect(midiAt(f, f.height - 1)).toBeLessThanOrEqual(60);
  });

  it('finds the note and the part under the pointer', () => {
    const n = makeNote(70, 11, 1, 'right'); // x 100..200, row y 10..20
    expect(hitTest([n], v, 150, 15)?.part).toBe('body');
    expect(hitTest([n], v, 197, 15)?.part).toBe('end');
    expect(hitTest([n], v, 102, 15)?.part).toBe('start');
    expect(hitTest([n], v, 150, 25)).toBeNull();
    expect(hitTest([n], v, 260, 15)).toBeNull();
    const short = makeNote(70, 13, 0.05, 'right'); // 5 px wide: still movable
    expect(hitTest([short], v, 301, 15)?.part).toBe('body');
  });

  it('finds the first note that can be on screen', () => {
    const notes = [0, 1, 2, 3, 4].map((t) => makeNote(60, t, 0.5, 'right'));
    expect(firstVisible(notes, 2.2, 0.5)).toBe(2);
    expect(firstVisible(notes, 2.2, 3)).toBe(0);
  });
});

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

describe('shortcuts', () => {
  it('maps keys to actions with Ctrl and Cmd alike', () => {
    expect(actionFor(key('z', { ctrlKey: true }))).toBe('undo');
    expect(actionFor(key('Z', { metaKey: true, shiftKey: true }))).toBe('redo');
    expect(actionFor(key('y', { ctrlKey: true }))).toBe('redo');
    expect(actionFor(key('d', { metaKey: true }))).toBe('duplicate');
    expect(actionFor(key(' '))).toBe('play');
    expect(actionFor(key('ArrowUp', { shiftKey: true }))).toBe('octaveUp');
    expect(actionFor(key('ArrowLeft'))).toBe('left');
    expect(actionFor(key('Backspace'))).toBe('delete');
    expect(actionFor(key('?', { shiftKey: true }))).toBe('help');
    expect(actionFor(key('+', { shiftKey: true }))).toBe('zoomIn');
    expect(actionFor(key('H'))).toBe('hand');
    expect(actionFor(key('h', { shiftKey: true }))).toBeNull();
    expect(actionFor(key('k'))).toBeNull();
    expect(actionFor(key('z', { ctrlKey: true, altKey: true }))).toBeNull();
  });

  it('only lets safe actions through while the computer keyboard records', () => {
    expect(WHILE_RECORDING.has('play')).toBe(true);
    expect(WHILE_RECORDING.has('hand')).toBe(false);
    // R plays a note while recording, so it cannot also stop recording.
    expect(WHILE_RECORDING.has('record')).toBe(false);
  });

  it('has a cheat sheet without long dashes', () => {
    const text = JSON.stringify(cheatSheet('Cmd'));
    expect(text).toContain('Cmd + Z');
    expect(text).not.toContain('—');
  });
});

describe('drafts', () => {
  const song: Song = { id: 'mine:7', title: 'Draft', by: 'Me', notes: [{ midi: 60, start: 0, dur: 1, hand: 'right' }], difficulty: 3, tags: ['a'] };

  it('round-trips through the store format', () => {
    const rec = encodeDraft(song, 1234);
    const back = decodeDraft(JSON.parse(JSON.stringify(rec)));
    expect(back?.songId).toBe('mine:7');
    expect(back?.savedAt).toBe(1234);
    expect(back && sameContent(back.song, song)).toBe(true);
  });

  it('keeps drafts that have no notes yet', () => {
    const back = decodeDraft(encodeDraft({ ...song, notes: [] }));
    expect(back?.song.notes).toEqual([]);
    expect(back?.song.title).toBe('Draft');
  });

  it('refuses damaged drafts', () => {
    expect(decodeDraft(null)).toBeNull();
    expect(decodeDraft({ v: 2 })).toBeNull();
    expect(decodeDraft({ v: 1, songId: 'x', savedAt: 1, lesson: '{bad' })).toBeNull();
    const rec = encodeDraft(song);
    expect(decodeDraft({ ...rec, lesson: rec.lesson.replace('"difficulty":3', '"difficulty":9') })).toBeNull();
  });

  it('uses one key per song', () => {
    expect(draftKey('mine:7')).toBe('editor:draft:mine:7');
    expect(draftKey(null)).toBe('editor:draft:new');
  });
});

describe('tags', () => {
  it('splits, trims and removes repeats', () => {
    expect(parseTags(' slow, film ,, slow ,')).toEqual(['slow', 'film']);
    expect(parseTags(Array.from({ length: 30 }, (_, i) => `t${i}`).join(','))).toHaveLength(20);
  });
});

describe('waveform', () => {
  it('keeps the extremes of each slice and scales quiet audio up', () => {
    const rate = 1000;
    const ch = new Float32Array(2000);
    for (let i = 0; i < 1000; i++) ch[i] = i % 2 ? 0.3 : -0.3;
    const p = computePeaks([ch], rate, 100);
    expect(p.duration).toBe(2);
    expect(p.min.length).toBe(200);
    expect(p.max[0]).toBeCloseTo(0.9, 5);
    expect(p.min[0]).toBeCloseTo(-0.9, 5);
    expect(peakRange(p, 1.2, 1.5)).toEqual([0, 0]);
    expect(peakRange(p, 0.5, 1.5)[1]).toBeCloseTo(0.9, 5);
  });
});

function fakeInstrument() {
  const played: { midi: number; seconds: number }[] = [];
  const instrument: Instrument = {
    wake() {},
    noteOn() {},
    noteOff() {},
    play: (midi, seconds) => void played.push({ midi, seconds }),
    setVolume() {},
  };
  return { instrument, played };
}

function fakeBacking(): EditorBacking & { plays: number } {
  return {
    src: '',
    currentTime: 0,
    playbackRate: 1,
    volume: 1,
    duration: 10,
    paused: true,
    ended: false,
    plays: 0,
    async play() {
      this.plays++;
      (this as { paused: boolean }).paused = false;
    },
    pause() {
      (this as { paused: boolean }).paused = true;
    },
  };
}

describe('transport', () => {
  const notes = [0, 0.5, 1, 1.5, 2].map((start, i) => ({ midi: 60 + i, start, dur: 0.4 }));

  it('plays from the playhead and sounds each note once', () => {
    let now = 0;
    const { instrument, played } = fakeInstrument();
    const t = new Transport({ instrument: () => instrument, backing: null, clock: () => now });
    t.setNotes(notes);
    t.end = 3;
    t.seek(0.5);
    t.play();
    t.tick();
    expect(played.map((p) => p.midi)).toEqual([61]);
    for (let i = 1; i <= 6; i++) {
      now = i * 100;
      t.tick();
    }
    expect(t.time).toBeCloseTo(1.1, 6);
    expect(played.map((p) => p.midi)).toEqual([61, 62]);
    t.pause();
    now = 5000;
    t.tick();
    expect(t.time).toBeCloseTo(1.1, 6);
  });

  it('plays slower at a lower speed', () => {
    let now = 0;
    const { instrument, played } = fakeInstrument();
    const t = new Transport({ instrument: () => instrument, backing: null, clock: () => now });
    t.setNotes(notes);
    t.setSpeed(0.5);
    t.play();
    for (let i = 1; i <= 10; i++) {
      now = i * 100;
      t.tick();
    }
    expect(t.time).toBeCloseTo(0.5, 6);
    expect(played[0].seconds).toBeCloseTo(0.8, 6);
  });

  it('repeats a marked part', () => {
    let now = 0;
    const { instrument, played } = fakeInstrument();
    const t = new Transport({ instrument: () => instrument, backing: null, clock: () => now });
    t.setNotes(notes);
    t.loop = { start: 0.5, end: 1.2 };
    t.loopOn = true;
    t.play();
    expect(t.time).toBe(0.5);
    for (let i = 1; i <= 8; i++) {
      now = i * 100;
      t.tick();
    }
    // 0.8 s of playing inside a 0.7 s part: wrapped once, back near the start.
    expect(t.time).toBeGreaterThanOrEqual(0.5);
    expect(t.time).toBeLessThan(1.2);
    expect(played.map((p) => p.midi)).toEqual([61, 62, 61]);
  });

  it('stops at the end when not repeating', () => {
    let now = 0;
    const { instrument } = fakeInstrument();
    const t = new Transport({ instrument: () => instrument, backing: null, clock: () => now });
    t.end = 0.3;
    let changes = 0;
    t.onState = () => changes++;
    t.play();
    now = 250;
    t.tick();
    now = 500;
    t.tick();
    expect(t.playing).toBe(false);
    expect(t.time).toBe(0.3);
    expect(changes).toBe(2);
    // Play again from the end starts over.
    t.play();
    expect(t.time).toBe(0);
  });

  it('uses the recording as the clock when there is one', () => {
    let now = 0;
    const backing = fakeBacking();
    const { instrument, played } = fakeInstrument();
    const t = new Transport({ instrument: () => instrument, backing, clock: () => now });
    t.setNotes(notes);
    t.setAudio('blob:song');
    expect(backing.src).toBe('blob:song');
    t.seek(0.9);
    t.setSpeed(0.75);
    t.play();
    expect(backing.plays).toBe(1);
    expect(backing.currentTime).toBe(0.9);
    expect(backing.playbackRate).toBe(0.75);
    // The wall clock says much more time passed, but the recording decides.
    now = 2000;
    backing.currentTime = 1.05;
    t.tick();
    expect(t.time).toBe(1.05);
    expect(played.map((p) => p.midi)).toEqual([62]);
    expect(t.now()).toBe(1.05);
    t.pause();
    expect(backing.paused).toBe(true);
  });

  it('keeps time still while the recording has not started', () => {
    let now = 0;
    const backing = fakeBacking();
    backing.play = async () => {}; // stays paused, e.g. still loading
    const { instrument } = fakeInstrument();
    const t = new Transport({ instrument: () => instrument, backing, clock: () => now });
    t.setAudio('blob:song');
    t.play();
    now = 500;
    t.tick();
    expect(t.time).toBe(0);
  });

  it('mutes the recording when its sound is off, because iOS ignores volume', () => {
    const backing = fakeBacking();
    const { instrument } = fakeInstrument();
    const t = new Transport({ instrument: () => instrument, backing, clock: () => 0 });
    t.setAudio('blob:song');
    t.setRecordingVolume(0);
    expect(backing.volume).toBe(0);
    expect(backing.muted).toBe(true);
    t.play();
    expect(backing.muted).toBe(true);
    t.pause();
    t.setRecordingVolume(0.8);
    expect(backing.volume).toBe(0.8);
    expect(backing.muted).toBe(false);
    t.play();
    expect(backing.muted).toBe(false);
  });
});
