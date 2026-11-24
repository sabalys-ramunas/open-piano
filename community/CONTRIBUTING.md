# Making and sharing a lesson

Thank you for making a lesson. This guide takes you from a song you love to a lesson anyone can play. You do not need to know how to code.

Before you start, read the [content policy](POLICY.md). The short version: share notes only, never audio or lyrics, and only for music you have the right to share.

## 1. Make the lesson

You can start from a recording or from a MIDI file.

**From a recording (MP3, WAV and similar):**

1. Open the Piano app and choose **Add your own song** on the song list.
2. Pick the recording. The app listens to it on your computer (nothing is uploaded) and writes down the notes it hears.
3. Choose how much of the music you want in the lesson: just the tune, the tune with bass notes, or everything.

Recordings of a single piano work best. Songs with singing, drums or many instruments give rougher notes, so expect to fix more in the next step.

**From a MIDI file:** choose **Add your own song** and pick the file. Two-track piano files keep their right and left hand.

## 2. Fix it in the editor

Automatic notes are a starting point, not a finished lesson. Open the song and choose **Edit notes**.

- Play it through at a slow speed and listen for wrong or missing notes.
- Delete stray notes and add missing ones.
- Check that each note is in the right hand: the right hand usually plays the tune, the left hand the bass and chords.
- Keep it playable. If a passage needs more than five keys at once in one hand, or huge jumps, simplify it. A clean easier version is better than a messy complete one.
- Give the lesson a clear title and the name of the composer or artist.
- Pick an honest level from 1 to 5. Level 1 is for someone's first week at the piano; level 5 is for experienced players.

Then choose **Download lesson file**. The file contains only the notes and details like the title, never the recording.

## 3. Check it

If you can, run the catalog check from a checkout of the app:

```bash
node community/tools/validate.mjs community
```

It tells you exactly what to fix. If you cannot run it, a maintainer will run it for you.

## 4. Send it in

**With a pull request** (preferred):

1. Pick an id: lowercase words joined by dashes, for example `moonlight-sonata-first-movement-easy`. It can never change later.
2. Save your file as `lessons/<id>.json`.
3. Add an entry to `index.json` (see the field list in the [README](README.md)). The `sha256`, `bytes`, `notes` and `seconds` values must match your file. On most computers you can get the checksum with `shasum -a 256 lessons/<id>.json` (macOS and Linux) or `certutil -hashfile lessons\<id>.json SHA256` (Windows).
4. Open a pull request. In its description, confirm:
   - "I made this lesson myself (or have permission from the person who did)."
   - "I have the right to share these notes under the licence I chose."
   - "The file contains notes only: no audio and no lyrics."

**Without a pull request:** open an issue titled "New lesson: <song name>", attach the lesson file, fill in the same three confirmations, and say which licence you choose. A maintainer will add it for you.

## Choosing a licence

The licence covers your arrangement: the notes as you wrote them in the lesson.

- **CC0 1.0**: anyone may use it for anything, no credit needed. Simplest for everyone.
- **CC BY 4.0**: anyone may use it, as long as they credit you.
- **CC BY-SA 4.0**: as CC BY, and changed versions must use the same licence.

If you based your lesson on someone else's openly licensed work (for example a share-alike edition from the Mutopia Project), you must keep their licence terms and credit them in `credit`.

## What maintainers look for

- The check passes.
- The music is clearly allowed under the [policy](POLICY.md): a public-domain composition, the contributor's own music, or a lesson whose sharing is otherwise clearly permitted. When in doubt, the lesson is not added.
- The notes are reasonable: playable, in the right hands, roughly in time.
- Title, artist, level and tags are accurate. Tags are short lowercase words.
