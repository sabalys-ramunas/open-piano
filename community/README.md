# Piano community lessons

This folder is the start of a shared catalog of piano lessons for the Piano app. It is laid out the way it would live in its own public repository: an index, the lesson files, a guide for people who make lessons, and a content policy.

A lesson holds **notes only**. It never contains a recording, lyrics or anything else. When a lesson was timed against a recording, the index names that recording (file name and size), and each player adds their own copy in the app to play along with the original.

## What is in here

| Path | What it is |
|---|---|
| `index.json` | The catalog: one entry per lesson. The app reads this file. |
| `lessons/<id>.json` | The lesson files, one per entry, named after the entry id. |
| `CONTRIBUTING.md` | How to make a lesson, fix it, check it and send it in. |
| `POLICY.md` | What may be shared, and how rights holders can ask for removal. |
| `tools/validate.mjs` | The check maintainers run on every change (also in CI). |

The app ships a copy of `index.json` and `lessons/` in `public/community/`, so the "Shared songs" screen works offline. Players can point the app at another catalog address under "Where lessons come from".

## The index format

```json
{
  "format": "piano-catalog",
  "version": 1,
  "name": "Piano community lessons",
  "updated": "2026-11-23",
  "lessons": [
    {
      "id": "satie-gymnopedie-2",
      "title": "Gymnopédie No. 2",
      "artist": "Erik Satie",
      "arranger": "Piano contributors",
      "difficulty": 3,
      "tags": ["classical"],
      "seconds": 195,
      "notes": 371,
      "recording": { "name": "gymnopedie-2.mp3", "bytes": 4200000 },
      "licence": "Public domain",
      "credit": "Notes from the Mutopia Project edition typeset by ...",
      "url": "lessons/satie-gymnopedie-2.json",
      "sha256": "6364b773...",
      "bytes": 6036,
      "added": "2026-11-23"
    }
  ]
}
```

| Field | Required | Rules |
|---|---|---|
| `id` | yes | Lowercase letters, digits and dashes, up to 64. Never changes once published: players' progress is stored against it. |
| `title` | yes | Up to 120 characters. |
| `artist` | yes | Who wrote or performed the original music. Up to 120 characters. |
| `arranger` | yes | Who made the lesson. Up to 120 characters. |
| `difficulty` | yes | Whole number from 1 (first steps) to 5 (advanced). |
| `tags` | yes | Up to 10 short lowercase words, for example `classical`, `folk`, `children`, `holiday`, `hymn`, `ragtime`, `pop`, `film`. |
| `seconds` | yes | Length of the lesson, rounded. Must match the file within 2 seconds. |
| `notes` | yes | Number of notes. Must match the file. |
| `recording` | no | `{ "name", "bytes" }` of the recording the timing was made for. Only the name and size, never the audio. |
| `licence` | yes | Licence of the lesson, for example `CC0 1.0`, `CC BY 4.0`, `CC BY-SA 4.0`, `Public domain`. |
| `credit` | no | A longer credit line, up to 500 characters. |
| `url` | yes | `lessons/<id>.json`. |
| `sha256` | yes | SHA-256 of the lesson file, lowercase hex. |
| `bytes` | yes | Size of the lesson file. At most 1,500,000 bytes. |
| `added` | no | Date added, `YYYY-MM-DD`. |

Lesson files use the app's own lesson format (`"format": "piano-lesson"`, version 1): title, artist, notes as `[key, start seconds, length seconds, 0 for right hand or 1 for left]`, and optional difficulty, tempo, beats, time signature, chord names, tags, licence and credit. Any other field gets the file refused.

## How the app treats downloads

Everything in a catalog comes from strangers, so the app:

- downloads without cookies or other credentials, and without sending the page address;
- stops reading any file that grows past the size limit;
- checks every entry, and leaves out (and counts) entries that break the rules;
- checks each lesson file's size, checksum, note count and length against its entry before adding it;
- shows all text as plain text and never runs or displays anything from a download as a web page.

## Checking the catalog

From a checkout of the Piano app:

```bash
npm ci
node community/tools/validate.mjs community --mirror public/community
```

It prints every problem it finds and exits with an error code if there are any, so it can run on every pull request.

## Where the example lessons come from

The example lessons are made from public-domain compositions, using MIDI files from the [Mutopia Project](https://www.mutopiaproject.org/). Each lesson's `credit` names the edition and its typesetter, and lessons made from share-alike editions keep the same licence. `scripts/build-songs.mjs` in the app regenerates them from `scripts/songs-sources.json`.
