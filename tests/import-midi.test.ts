import { Midi } from '@tonejs/midi';
import { describe, expect, it } from 'vitest';
import { decodeProblem } from '../src/import';
import { readMidi, readMidiSong } from '../src/import/midifile';

function file(build: (midi: Midi) => void): ArrayBuffer {
  const midi = new Midi();
  build(midi);
  const bytes = midi.toArray();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('MIDI files', () => {
  it('follows tempo changes and reads the beat grid and time signature', () => {
    const bytes = file((midi) => {
      midi.header.tempos = [
        { ticks: 0, bpm: 120 },
        { ticks: midi.header.ppq * 4, bpm: 60 },
      ];
      midi.header.timeSignatures = [{ ticks: 0, timeSignature: [3, 4] }];
      midi.header.update();
      const t = midi.addTrack();
      for (let beat = 0; beat < 8; beat++) t.addNote({ midi: 60 + beat, ticks: beat * midi.header.ppq, durationTicks: midi.header.ppq / 2 });
    });
    const song = readMidiSong(bytes);
    // Four beats at 120 bpm (0.5 s each), then 60 bpm (1 s each).
    expect(song.notes.map((n) => n.start)).toEqual([0, 0.5, 1, 1.5, 2, 3, 4, 5]);
    expect(song.timeSignature).toEqual({ beats: 3, unit: 4 });
    expect(song.beats?.slice(0, 7)).toEqual([0, 0.5, 1, 1.5, 2, 3, 4]);
    expect(song.bpm).toBe(60);
  });

  it('picks the tune and the bass from a band file and leaves drums and the rest out', () => {
    const bytes = file((midi) => {
      const drums = midi.addTrack();
      drums.channel = 9;
      for (let i = 0; i < 16; i++) drums.addNote({ midi: 36, time: i * 0.25, duration: 0.1 });
      const pad = midi.addTrack();
      pad.instrument.number = 48; // strings
      for (let i = 0; i < 4; i++) for (const m of [60, 64, 67]) pad.addNote({ midi: m, time: i, duration: 1 });
      const lead = midi.addTrack();
      lead.instrument.number = 73; // flute
      for (let i = 0; i < 16; i++) lead.addNote({ midi: 72 + (i % 5), time: i * 0.25, duration: 0.2 });
      const bass = midi.addTrack();
      bass.instrument.number = 33;
      for (let i = 0; i < 8; i++) bass.addNote({ midi: 36 + (i % 3), time: i * 0.5, duration: 0.4 });
    });
    const song = readMidiSong(bytes);
    expect(song.tracks.map((t) => t.suggested)).toEqual(['none', 'right', 'left']);
    expect(song.notes.filter((n) => n.hand === 'right').every((n) => n.midi >= 72)).toBe(true);
    expect(song.notes.filter((n) => n.hand === 'left').every((n) => n.midi < 40)).toBe(true);
    expect(song.notes.some((n) => n.midi === 36 && n.hand === 'right')).toBe(false);
  });

  it('lets the player choose which tracks are the hands', () => {
    const bytes = file((midi) => {
      for (const base of [48, 60, 72]) {
        const t = midi.addTrack();
        t.instrument.number = 40;
        for (let i = 0; i < 8; i++) t.addNote({ midi: base + i, time: i * 0.5, duration: 0.4 });
      }
    });
    const song = readMidiSong(bytes, { right: [1, 2], left: [0] });
    expect(song.notes.length).toBe(24);
    expect(song.notes.filter((n) => n.hand === 'left').every((n) => n.midi < 56)).toBe(true);
  });

  it('keeps the two-track piano convention and splits a single track at middle C', () => {
    const two = file((midi) => {
      const r = midi.addTrack();
      const l = midi.addTrack();
      r.addNote({ midi: 55, time: 0, duration: 1 }); // a low note still belongs to the right hand
      l.addNote({ midi: 48, time: 0, duration: 1 });
    });
    expect(readMidi(two).map((n) => n.hand)).toEqual(['left', 'right']);
    const one = file((midi) => {
      const t = midi.addTrack();
      t.addNote({ midi: 48, time: 0, duration: 1 });
      t.addNote({ midi: 64, time: 0, duration: 1 });
    });
    expect(readMidi(one).map((n) => n.hand)).toEqual(['left', 'right']);
  });

  it('ignores the sustain pedal and repairs overlapping repeats', () => {
    const bytes = file((midi) => {
      const t = midi.addTrack();
      t.addCC({ number: 64, value: 127, time: 0 });
      t.addNote({ midi: 60, time: 0, duration: 2 });
      t.addNote({ midi: 60, time: 1, duration: 1 });
      t.addCC({ number: 64, value: 0, time: 3 });
    });
    const notes = readMidi(bytes);
    expect(notes).toHaveLength(2);
    expect(notes[0].start + notes[0].dur).toBeLessThanOrEqual(1);
  });

  it('rejects files that are not MIDI', () => {
    expect(() => readMidi(new TextEncoder().encode('hello').buffer as ArrayBuffer)).toThrow();
  });
});

describe('plain-language file errors', () => {
  it('explains protected, video and unusual files', () => {
    expect(decodeProblem({ name: 'song.m4p', type: 'audio/mp4' })).toMatch(/copy-protected/);
    expect(decodeProblem({ name: 'clip.mov', type: 'video/quicktime' })).toMatch(/video/);
    expect(decodeProblem({ name: 'old.wma', type: '' })).toMatch(/MP3, M4A, WAV, OGG or FLAC/);
    expect(decodeProblem({ name: 'x.bin', type: '' })).toMatch(/could not be opened/);
  });
});
