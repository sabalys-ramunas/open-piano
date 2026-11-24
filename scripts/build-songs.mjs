#!/usr/bin/env node
// Builds the built-in song pack in public/songs/.
//
//   node scripts/build-songs.mjs [--cache <dir>] [--update-hashes] [--stats]
//
// 1. Reads scripts/songs-sources.json: every piece from the Mutopia Project
//    (mutopiaproject.org) with its MIDI URL, licence, typesetter and sha256.
// 2. Downloads each MIDI file into a cache folder OUTSIDE the project
//    (default: <system temp>/piano-song-sources) and checks its sha256, so a
//    changed upstream file is noticed instead of silently shipped.
// 3. Converts it with src/songs/convert.ts: hands from the two staves, tempo,
//    beats, time signature, trimmed leading silence, cleaned overlaps, and an
//    "easy" melody-and-bass arrangement where the manifest asks for one.
// 4. Writes the hand-arranged traditional tunes from src/songs/tunes.ts.
// 5. Writes public/songs/index.json listing every file.
// 6. Writes the community catalog seed (community/lessons/ and
//    community/index.json) from the "community" list, and copies it to
//    public/community/ so the app can show it without a network.
//
// The TypeScript modules are loaded through Vite, so the app and this script
// share exactly the same code. Licences: Public Domain editions give lessons
// that are public domain (our own simplifications of them are CC0); CC BY-SA
// editions give CC BY-SA lessons with credit to the typesetter.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const manifestPath = join(root, 'scripts', 'songs-sources.json');
const outDir = join(root, 'public', 'songs');
const cacheDir = resolve(option('--cache', join(tmpdir(), 'piano-song-sources')));

/** Loads TypeScript modules from src/ with Vite (no build step, same code as the app). */
async function loadModules(paths) {
  const pkg = JSON.stringify(join(root, 'package.json'));
  // @tonejs/midi ships CommonJS; give Vite's module runner a tiny ESM wrapper for it.
  const midiShim = {
    name: 'tonejs-midi-cjs',
    enforce: 'pre',
    resolveId: (id) => (id === '@tonejs/midi' ? '\0tonejs-midi' : undefined),
    load: (id) =>
      id === '\0tonejs-midi'
        ? `import { createRequire } from 'node:module'; export const Midi = createRequire(${pkg})('@tonejs/midi').Midi;`
        : undefined,
  };
  const server = await createServer({
    configFile: false,
    root,
    logLevel: 'error',
    plugins: [midiShim],
    ssr: { noExternal: ['@tonejs/midi'] },
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    return { modules: await Promise.all(paths.map((p) => server.ssrLoadModule(p))), close: () => server.close() };
  } catch (error) {
    await server.close();
    throw error;
  }
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function download(url) {
  const name = url.split('/').pop();
  if (!/^[A-Za-z0-9._-]+\.mid$/.test(name)) throw new Error(`Unexpected file name in ${url}`);
  const path = join(cacheDir, name);
  if (existsSync(path)) return readFileSync(path);
  const res = await fetch(url, { headers: { 'User-Agent': 'piano-song-pack-builder' } });
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > 2_000_000) throw new Error(`Suspiciously large file: ${url}`);
  writeFileSync(path, bytes);
  return bytes;
}

/** "Creative Commons Attribution-ShareAlike 3.0" -> "CC BY-SA 3.0". */
function shortLicence(text) {
  if (/^public domain$/i.test(text)) return 'Public domain';
  const m = /^Creative Commons Attribution(-ShareAlike)? (\d\.\d)$/.exec(text);
  if (!m) throw new Error(`Unknown licence "${text}": check it allows sharing and changes, then teach this script its short name.`);
  return `CC BY${m[1] ? '-SA' : ''} ${m[2]}`;
}

/** Writes a lesson with one note per line: small, and readable in a diff. */
function formatLesson(lesson) {
  const { notes, ...rest } = lesson;
  const head = JSON.stringify(rest).slice(0, -1); // always has format, version and title
  const rows = notes.map((n) => JSON.stringify(n)).join(',\n');
  return `${head},\n"notes":[\n${rows}\n]}\n`;
}

async function main() {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  const { modules, close } = await loadModules(['/src/songs/convert.ts', '/src/songs/tunes.ts', '/src/lesson.ts', '/src/community/validate.ts']);
  const [convert, tunes, lesson, validate] = modules;
  const built = []; // { file, song, estimate }
  let manifestChanged = false;

  /** Downloads, checks and converts one manifest entry; returns its lesson (and its easy version). */
  async function fromMutopia(entry) {
    const out = [];
    const bytes = await download(entry.url);
    const hash = sha256(bytes);
    if (!entry.sha256 || flag('--update-hashes')) {
      if (entry.sha256 !== hash) manifestChanged = true;
      entry.sha256 = hash;
    } else if (entry.sha256 !== hash) {
      throw new Error(`${entry.file}: the downloaded file changed upstream (sha256 ${hash}). Check it, then run with --update-hashes.`);
    }
    const licence = shortLicence(entry.sourceLicence);
    const shareAlike = licence !== 'Public domain';
    const edition = `the Mutopia Project edition typeset by ${entry.typesetter} (${entry.mutopiaId}), ${entry.info}`;
    const converted = convert.convertMidi(new Uint8Array(bytes), { tempoScale: entry.tempoScale, hands: entry.hands, split: entry.split });
    const base = {
      title: entry.title,
      by: entry.by,
      source: 'built-in',
      bpm: converted.bpm,
      beats: converted.beats,
      timeSignature: converted.timeSignature,
      tags: entry.tags,
    };
    const full = {
      ...base,
      id: `pack:${entry.file}`,
      notes: converted.notes,
      difficulty: entry.difficulty ?? convert.estimateDifficulty(converted.notes),
      licence,
      credit: `Notes from ${edition}.${entry.tempoScale ? ` Tempo changed by a factor of ${entry.tempoScale}.` : ''}`,
    };
    out.push({ file: `${entry.file}.json`, song: full, estimate: convert.estimateDifficulty(converted.notes) });
    if (entry.easy) {
      const notes = convert.melodyAndBass(full);
      out.push({
        file: `${entry.file}-easy.json`,
        estimate: convert.estimateDifficulty(notes),
        song: {
          ...base,
          id: `pack:${entry.file}-easy`,
          title: entry.easy.title ?? `${entry.title} (easy)`,
          notes,
          difficulty: entry.easy.difficulty ?? convert.estimateDifficulty(notes),
          tags: [...entry.tags, 'easy version'],
          licence: shareAlike ? licence : 'CC0 1.0 (simplified arrangement of a public domain edition)',
          credit: `Simplified to the tune and bass notes for this app by the Piano contributors, from ${edition}.`,
        },
      });
    }
    return out;
  }

  try {
    for (const entry of manifest.mutopia) built.push(...(await fromMutopia(entry)));
    for (const tune of tunes.TUNES) {
      for (const { file, song } of tunes.arrangeTune(tune)) built.push({ file, song, estimate: convert.estimateDifficulty(song.notes) });
    }

    // Write lessons, and remove generated files that are no longer listed.
    const files = new Set(built.map((b) => b.file));
    if (files.size !== built.length) throw new Error('Two songs share a file name.');
    for (const old of readdirSync(outDir)) {
      if (old.endsWith('.json') && old !== 'index.json' && !files.has(old)) rmSync(join(outDir, old));
    }
    for (const { file, song } of built) {
      const data = lesson.toLesson(song);
      const text = formatLesson(data);
      lesson.fromLesson(text); // throws if the file would not load in the app
      writeFileSync(join(outDir, file), text);
    }

    built.sort((a, b) => a.song.difficulty - b.song.difficulty || a.song.title.localeCompare(b.song.title));
    const index = {
      about: 'Built-in songs. Generated by scripts/build-songs.mjs; edit scripts/songs-sources.json or src/songs/tunes.ts instead.',
      songs: built.map((b) => b.file),
      details: built.map(({ file, song }) => ({
        file,
        title: song.title,
        by: song.by,
        difficulty: song.difficulty,
        tags: song.tags,
        seconds: Math.round(song.notes.reduce((end, n) => Math.max(end, n.start + n.dur), 0)),
        notes: song.notes.length,
        licence: song.licence,
      })),
    };
    writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 1) + '\n');

    // The community catalog seed: example lessons, the index describing them, and the copy the app serves offline.
    const seed = [];
    for (const entry of manifest.community ?? []) seed.push(...(await fromMutopia(entry)));
    const communityDir = join(root, 'community');
    const lessonsDir = join(communityDir, 'lessons');
    mkdirSync(lessonsDir, { recursive: true });
    const indexPath = join(communityDir, 'index.json');
    const previous = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : { lessons: [] };
    const today = new Date().toISOString().slice(0, 10);
    const generated = new Set(seed.map((s) => s.file));
    const kept = (previous.lessons ?? []).filter((l) => !generated.has(String(l.url).replace(/^lessons\//, '')));
    const lessons = [...kept];
    for (const { file, song } of seed) {
      const text = formatLesson(lesson.toLesson({ ...song, credit: song.credit }));
      writeFileSync(join(lessonsDir, file), text);
      const id = file.replace(/\.json$/, '');
      const old = (previous.lessons ?? []).find((l) => l.id === id);
      lessons.push(
        validate.describeLesson(text, {
          id,
          url: `lessons/${file}`,
          arranger: 'Piano contributors',
          added: old?.added ?? today,
        }),
      );
    }
    lessons.sort((a, b) => a.title.localeCompare(b.title));
    const catalog = { format: 'piano-catalog', version: 1, name: 'Piano community lessons', updated: today, lessons };
    const catalogText = JSON.stringify(catalog, null, 2) + '\n';
    const { problems } = validate.parseCatalog(catalogText);
    if (problems.length > 0) throw new Error(`Community index problems:\n${problems.join('\n')}`);
    writeFileSync(indexPath, catalogText);
    // Mirror into public/community so the app can load the seed without a network.
    const mirror = join(root, 'public', 'community');
    rmSync(mirror, { recursive: true, force: true });
    mkdirSync(join(mirror, 'lessons'), { recursive: true });
    writeFileSync(join(mirror, 'index.json'), catalogText);
    for (const l of lessons) {
      const name = String(l.url).replace(/^lessons\//, '');
      if (!/^[A-Za-z0-9._-]+\.json$/.test(name)) throw new Error(`Unexpected lesson path ${l.url}`);
      writeFileSync(join(mirror, 'lessons', name), readFileSync(join(lessonsDir, name)));
    }

    if (manifestChanged) writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

    if (flag('--stats')) {
      for (const { file, song, estimate } of built) {
        const s = convert.difficultyStats(song.notes);
        console.log(
          [file.padEnd(44), `level ${song.difficulty}`, `est ${estimate}`, `${Math.round(s.seconds)}s`.padStart(5), `${s.notesPerSecond.toFixed(1)} n/s`, `peak ${s.peakNotesPerSecond.toFixed(1)}`, `chords ${s.chordShare.toFixed(2)}`, `bpm ${song.bpm}`].join('  '),
        );
      }
    }
    console.log(`Wrote ${built.length} songs to public/songs and ${seed.length} example lessons to community/ (sources cached in ${cacheDir}).`);
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
