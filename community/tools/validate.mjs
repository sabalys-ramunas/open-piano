#!/usr/bin/env node
// Checks a community catalog folder: the index and every lesson it lists.
//
//   node community/tools/validate.mjs [catalog-folder] [--mirror <folder>]
//
// Run it from a checkout of the Piano app (it uses the app's own strict lesson
// checks from src/community/validate.ts, loaded through Vite). In CI:
//
//   npm ci && node community/tools/validate.mjs community --mirror public/community
//
// It fails (exit code 1) when:
// - the index is not a valid catalog, or any entry has a missing or bad field
// - an id is repeated, or a lesson file is not at lessons/<id>.json
// - a lesson file is missing, too big, or its size or sha256 differ from the index
// - a lesson file does not pass the strict lesson check (only notes and
//   metadata, no audio, no lyrics, no unknown fields), or its note count or
//   length differ from the index
// - lessons/ holds a file the index does not list
// - with --mirror: the copy served by the app differs from the catalog

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const mirrorAt = args.indexOf('--mirror');
const mirror = mirrorAt >= 0 ? resolve(args[mirrorAt + 1] ?? '') : null;
const folder = resolve(args.find((a, i) => !a.startsWith('--') && i !== mirrorAt + 1) ?? join(appRoot, 'community'));

async function loadValidator() {
  const server = await createServer({
    configFile: false,
    root: appRoot,
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const [validate, hash] = await Promise.all([server.ssrLoadModule('/src/community/validate.ts'), server.ssrLoadModule('/src/community/sha256.ts')]);
    return { validate, hash, close: () => server.close() };
  } catch (error) {
    await server.close();
    throw error;
  }
}

async function main() {
  const problems = [];
  const indexPath = join(folder, 'index.json');
  if (!existsSync(indexPath)) {
    console.error(`No index.json in ${folder}`);
    process.exit(1);
  }
  const { validate, hash, close } = await loadValidator();
  try {
    const indexText = readFileSync(indexPath, 'utf8');
    let parsed;
    try {
      parsed = validate.parseCatalog(indexText);
    } catch (error) {
      console.error(`index.json: ${error.message}`);
      process.exit(1);
    }
    problems.push(...parsed.problems.map((p) => `index.json: ${p}`));
    const listed = new Set();
    for (const entry of parsed.catalog.lessons) {
      const where = `lessons/${entry.id}.json`;
      if (entry.url !== where) {
        problems.push(`"${entry.id}": url should be "${where}" (lessons live in this folder, named after their id)`);
        continue;
      }
      listed.add(`${entry.id}.json`);
      const path = join(folder, where);
      if (!existsSync(path)) {
        problems.push(`"${entry.id}": ${where} is missing`);
        continue;
      }
      const size = statSync(path).size;
      if (size > validate.MAX_LESSON_BYTES) {
        problems.push(`"${entry.id}": the file is ${size} bytes, the limit is ${validate.MAX_LESSON_BYTES}`);
        continue;
      }
      const raw = readFileSync(path);
      if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) problems.push(`"${entry.id}": save the file as UTF-8 without a byte order mark`);
      const text = raw.toString('utf8');
      if (hash.sha256(new Uint8Array(raw)) !== entry.sha256) problems.push(`"${entry.id}": sha256 in the index does not match the file`);
      try {
        validate.checkLesson(text, entry);
      } catch (error) {
        problems.push(`"${entry.id}": ${error.message}`);
      }
    }
    const lessonsDir = join(folder, 'lessons');
    if (existsSync(lessonsDir)) {
      for (const name of readdirSync(lessonsDir)) {
        if (!listed.has(name)) problems.push(`lessons/${name} is not listed in index.json`);
      }
    }
    if (mirror) {
      const same = (a, b) => existsSync(a) && existsSync(b) && readFileSync(a).equals(readFileSync(b));
      if (!same(indexPath, join(mirror, 'index.json'))) problems.push(`${mirror}/index.json differs from the catalog`);
      for (const name of listed) {
        if (!same(join(lessonsDir, name), join(mirror, 'lessons', name))) problems.push(`${mirror}/lessons/${name} differs from the catalog`);
      }
    }

    if (problems.length > 0) {
      console.error(`${problems.length} problem(s) in ${folder}:`);
      for (const p of problems) console.error(`  - ${p}`);
      process.exitCode = 1;
    } else {
      console.log(`OK: ${parsed.catalog.lessons.length} lessons in ${folder} passed every check.`);
    }
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
