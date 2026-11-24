# Third-party notices

The source code of Piano is released under the MIT licence (see LICENSE). This file lists everything bundled with the app that comes from elsewhere or carries its own licence: the piano recordings, the songs, the note detection model and the software libraries included in the built site.

## Piano recordings

`public/samples/piano/`

- **Salamander Grand Piano V3** by Alexander Holm, recorded from a Yamaha C5 grand piano.
- Licence: Creative Commons Attribution 3.0 (CC BY 3.0), https://creativecommons.org/licenses/by/3.0/
- Source: https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html (SalamanderGrandPianoV3+20161209_44khz16bit.tar.xz)
- Changes: every third semitone (A0 to C8) in two loudness layers (original layers v5 and v12), silence removed from the start of each note, each note shortened to between 2.5 and 7 seconds with a fade out, converted to 80 kbps MP3. The app pitch-shifts these recordings to play the notes in between. See `public/samples/piano/CREDITS.txt`.

## Fonts

`public/fonts/`

- **Fredoka** (headings and buttons), Copyright 2016 The Fredoka Project Authors, https://github.com/hafontia/Fredoka-One
- **Atkinson Hyperlegible** (body text), Copyright 2020 Braille Institute of America, Inc.
- Licence: SIL Open Font License 1.1, full texts in `public/fonts/OFL-Fredoka.txt` and `public/fonts/OFL-AtkinsonHyperlegible.txt`.
- Source: the Google Fonts repository (https://github.com/google/fonts, `ofl/fredoka` and `ofl/atkinsonhyperlegible`).
- Changes: Fredoka fixed to its normal width at weight 600 (a static font); both fonts subset into a Latin and an extended Latin file, hinting removed, converted to WOFF2. The fonts keep their original names (neither declares a Reserved Font Name).

## Note detection model

`public/model/` (model.json and its weights)

- **Basic Pitch** by Spotify, https://github.com/spotify/basic-pitch
- Licence: Apache License 2.0, https://www.apache.org/licenses/LICENSE-2.0
- Copyright 2022 Spotify AB. The model files are taken unchanged from the `@spotify/basic-pitch` npm package (version 1.0.1). The app runs the model with its own code to work out the notes in a recording on the device.

## Song splitter model (downloaded, not bundled)

Not part of the app or this repository. When someone chooses to split a song, the app downloads these four files
once and keeps them on the device (`src/split/model-files.ts` holds the address, sizes and SHA-256 sums). A copy in
`public/models/spleeter-4stems/` is used instead when present; that folder is ignored by git.

- **Spleeter 4stems** (vocals, drums, bass, other) by Deezer Research, https://github.com/deezer/spleeter
- Licence of the code and the trained models: MIT, as stated in the paper that describes Spleeter and its
  pre-trained models (Hennequin, Khlif, Voituret and Moussallam, "Spleeter: a fast and efficient music source
  separation tool with pre-trained models", Journal of Open Source Software 5(50), 2154, 2020,
  https://doi.org/10.21105/joss.02154). The repository is MIT licensed. The models were trained by Deezer; the
  weights' licence rests on that statement.
- ONNX conversion: **Best-Practice/spleeter-4stems-onnx** on Hugging Face, licence Apache License 2.0, files
  `vocals.fp16.onnx`, `drums.fp16.onnx`, `bass.fp16.onnx`, `other.fp16.onnx` (fp16 weights), revision
  `486643021f18a4d057d282fff1d11b89a30e9887`:
  https://huggingface.co/Best-Practice/spleeter-4stems-onnx/tree/486643021f18a4d057d282fff1d11b89a30e9887
- Changes: none. The app runs the networks with its own code (the STFT, masks and inverse in `src/split/`).
- Not used: Demucs, whose author says its trained weights are "provided only for scientific purposes"
  (see `experiments/separation/README.md`).

## Songs

Every song file states its licence and credit, and the app shows both. Lessons hold notes and timing only.

### Songs from Mutopia Project editions

These were made by `scripts/build-songs.mjs` from MIDI files of editions on the Mutopia Project (https://www.mutopiaproject.org/). Lessons made from public-domain editions are public domain; the easy versions of them are simplified arrangements by the Piano contributors released under CC0 1.0. Lessons made from editions licensed Creative Commons Attribution-ShareAlike (CC BY-SA) are released under the same licence, with credit to the edition's typesetter; this includes easy versions made from them. Licence texts: https://creativecommons.org/licenses/by-sa/2.5/, https://creativecommons.org/licenses/by-sa/3.0/, https://creativecommons.org/licenses/by-sa/4.0/ and https://creativecommons.org/publicdomain/zero/1.0/.

| File (public/songs/) | Piece | Composer | Edition typeset by | Licence of the lesson |
|---|---|---|---|---|
| satie-gymnopedie-1-easy.json | [Gymnopédie No. 1 (easy version)](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=37) | Erik Satie | Evin Robertson | CC0 1.0 |
| burgmuller-candour.json | [La Candeur (Op. 100, No. 1)](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=202) | Friedrich Burgmüller | Bas Wassink | Public domain |
| schumann-melody.json | [Melody (Album for the Young, No. 1)](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=647) | Robert Schumann | Philippe Hézaine | CC BY-SA 2.5 |
| minuet-in-a-minor.json | [Minuet in A minor](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1612) | Anonymous (from the Notebook for Anna Magdalena Bach) | Steven McDougall | Public domain |
| mozart-minuet-k2.json | [Minuet in F major, K. 2](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1770) | Wolfgang Amadeus Mozart | Nicolas Morant | Public domain |
| petzold-minuet-in-g.json | [Minuet in G major](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=75) | Christian Petzold (from the Notebook for Anna Magdalena Bach) | Allen Garvin | Public domain |
| petzold-minuet-in-g-minor.json | [Minuet in G minor](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=76) | Christian Petzold (from the Notebook for Anna Magdalena Bach) | Allen Garvin | Public domain |
| tchaikovsky-morning-prayer.json | [Morning Prayer (Album for the Young, No. 1)](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=2032) | Pyotr Ilyich Tchaikovsky | Rem Zolotykh | Public domain |
| schumann-soldiers-march.json | [Soldiers' March (Album for the Young, No. 2)](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=650) | Robert Schumann | Philippe Hézaine | CC BY-SA 2.5 |
| grieg-album-leaf.json | [Album Leaf, Op. 12 No. 7](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=2194) | Edvard Grieg | Knute Snortum | CC BY-SA 4.0 |
| burgmuller-arabesque.json | [Arabesque (Op. 100, No. 2)](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=203) | Friedrich Burgmüller | Bas Wassink | Public domain |
| bach-chorale-bwv269.json | [Aus meines Herzens Grunde (chorale, BWV 269)](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=378) | Johann Sebastian Bach | Laurent Ducos | Public domain |
| beethoven-fur-elise-easy.json | [Für Elise (easy version)](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=931) | Ludwig van Beethoven | Stelios Samelis | CC0 1.0 |
| satie-gymnopedie-1.json | [Gymnopédie No. 1](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=37) | Erik Satie | Evin Robertson | Public domain |
| bach-chorale-bwv347.json | [Ich dank dir, lieber Herre (chorale, BWV 347)](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=379) | Johann Sebastian Bach | Laurent Ducos | Public domain |
| burgmuller-pastorale.json | [La Pastorale (Op. 100, No. 3)](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=218) | Friedrich Burgmüller | Bas Wassink | Public domain |
| tchaikovsky-wooden-soldiers.json | [March of the Wooden Soldiers (Album for the Young, No. 5)](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1806) | Pyotr Ilyich Tchaikovsky | Anonymous | Public domain |
| musette-in-d.json | [Musette in D major](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=79) | Anonymous (from the Notebook for Anna Magdalena Bach) | Allen Garvin | Public domain |
| tchaikovsky-old-french-song.json | [Old French Song (Album for the Young, No. 16)](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=2080) | Pyotr Ilyich Tchaikovsky | David McNamara | Public domain |
| chopin-prelude-a-major.json | [Prelude in A major, Op. 28 No. 7](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=470) | Frédéric Chopin | Magnus Lewis-Smith | Public domain |
| bach-prelude-in-c.json | [Prelude in C major, BWV 846](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=5) | Johann Sebastian Bach | Tobias Erbsland | Public domain |
| chopin-prelude-e-minor.json | [Prelude in E minor, Op. 28 No. 4](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=468) | Frédéric Chopin | Magnus Lewis-Smith | Public domain |
| mozart-rondo-alla-turca-easy.json | [Rondo alla Turca (Sonata K. 331) (easy version)](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=108) | Wolfgang Amadeus Mozart | Rune Zedeler and Chris Sawer | CC0 1.0 |
| mozart-sonata-k545-1-easy.json | [Sonata in C major, K. 545: first movement (easy version)](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=998) | Wolfgang Amadeus Mozart | Alejandro Sierra | CC BY-SA 3.0 |
| handel-sonatina-b-flat.json | [Sonatina in B-flat major, HWV 585](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=98) | George Frideric Handel | David Maddock | Public domain |
| joplin-the-entertainer-easy.json | [The Entertainer (easy version)](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=263) | Scott Joplin | Chris Sawer | CC0 1.0 |
| schumann-happy-farmer.json | [The Happy Farmer (Album for the Young, No. 10)](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=659) | Robert Schumann | Philippe Hézaine | CC BY-SA 2.5 |
| schumann-wild-rider.json | [The Wild Rider (Album for the Young, No. 8)](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=655) | Robert Schumann | Philippe Hézaine | CC BY-SA 2.5 |
| burgmuller-ballade.json | [Ballade (Op. 100, No. 15)](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=227) | Friedrich Burgmüller | Bas Wassink | Public domain |
| beethoven-fur-elise.json | [Für Elise](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=931) | Ludwig van Beethoven | Stelios Samelis | Public domain |
| bach-invention-1.json | [Invention No. 1 in C major, BWV 772](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=40) | Johann Sebastian Bach | jeff covey | CC BY-SA 3.0 |
| chopin-prelude-c-minor.json | [Prelude in C minor, Op. 28 No. 20](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=472) | Frédéric Chopin | Magnus Lewis-Smith | Public domain |
| mozart-sonata-k545-1.json | [Sonata in C major, K. 545: first movement](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=998) | Wolfgang Amadeus Mozart | Alejandro Sierra | CC BY-SA 3.0 |
| beethoven-sonata-49-2-minuet.json | [Sonata Op. 49 No. 2: Tempo di Menuetto](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=777) | Ludwig van Beethoven | Stelios Samelis | Public domain |
| joplin-the-entertainer.json | [The Entertainer](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=263) | Scott Joplin | Chris Sawer | Public domain |
| schumann-traumerei.json | [Träumerei (Scenes from Childhood, No. 7)](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=504) | Robert Schumann | Ying-Chun Liu | Public domain |
| debussy-arabesque-1.json | [Arabesque No. 1](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1777) | Claude Debussy | Keith OHara | Public domain |
| debussy-clair-de-lune.json | [Clair de lune](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1778) | Claude Debussy | Keith OHara | Public domain |
| grieg-mountain-king.json | [In the Hall of the Mountain King](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1888) | Edvard Grieg | Coyau | Public domain |
| joplin-maple-leaf-rag.json | [Maple Leaf Rag](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=23) | Scott Joplin | Chris Sawer | Public domain |
| chopin-nocturne-op9-2.json | [Nocturne in E-flat major, Op. 9 No. 2](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1590) | Frédéric Chopin | Renato Biolcati Rinaldi | CC BY-SA 3.0 |
| mozart-rondo-alla-turca.json | [Rondo alla Turca (Sonata K. 331)](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=108) | Wolfgang Amadeus Mozart | Rune Zedeler and Chris Sawer | Public domain |

### Shared lessons (community catalog seed)

`community/lessons/` and its copy in `public/community/lessons/`, made the same way from Mutopia Project editions.

| File | Piece | Composer | Edition typeset by | Licence of the lesson |
|---|---|---|---|---|
| satie-gymnopedie-2.json | [Gymnopédie No. 2](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=38) | Erik Satie | Evin Robertson | Public domain |
| schumann-humming-song.json | [Humming Song (Album for the Young, No. 3)](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=651) | Robert Schumann | Philippe Hézaine | CC BY-SA 3.0 |
| burgmuller-innocence.json | [Innocence (Op. 100, No. 5)](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=214) | Friedrich Burgmüller | Bas Wassink | Public domain |
| joplin-solace.json | [Solace](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=482) | Scott Joplin | Magnus Lewis-Smith | Public domain |
| joplin-solace-easy.json | [Solace (easy version)](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=482) | Scott Joplin | Magnus Lewis-Smith | CC0 1.0 |

### Traditional tunes and built-in songs

The following tunes are traditional and in the public domain. The arrangements in `public/songs/tune-*.json` were written for this app by the Piano contributors (in `src/songs/tunes.ts`) and are released under CC0 1.0. The three short songs in the app code (`src/songs/index.ts`: Twinkle, Twinkle, Little Star; Ode to Joy by Ludwig van Beethoven; the opening of Für Elise by Ludwig van Beethoven) are arrangements by the Piano contributors dedicated to the public domain.

Amazing Grace, Au clair de la lune, Deck the Halls, Frère Jacques, Greensleeves, Happy Birthday to You, Hot Cross Buns, Jingle Bells (chorus), London Bridge Is Falling Down, Mary Had a Little Lamb, Old MacDonald Had a Farm, Row, Row, Row Your Boat, Silent Night, We Wish You a Merry Christmas, Yankee Doodle.

## Software included in the built site

| Package | Licence | Copyright |
|---|---|---|
| @tensorflow/tfjs 3.21.0 and its parts (tfjs-core, tfjs-converter, tfjs-backend-webgl, tfjs-backend-cpu), @tensorflow/tfjs-backend-wasm 3.21.0 (including its WebAssembly files) | Apache License 2.0 | Copyright 2017 to 2022 Google LLC |
| @spotify/basic-pitch 1.0.1 (only its model files, in `public/model/`; the app uses its own code to run them) | Apache License 2.0 | Copyright 2022 Spotify AB |
| @tonejs/midi 2.0.28 | MIT | Copyright (c) 2016 Yotam Mann |
| onnxruntime-web 1.23.2 and onnxruntime-common 1.23.2 (including the WebAssembly files `ort-wasm-simd-threaded.wasm` and `ort-wasm-simd-threaded.asyncify.wasm`) | MIT | Copyright (c) Microsoft Corporation |

The Apache License 2.0 text is at https://www.apache.org/licenses/LICENSE-2.0 and in each package's LICENSE file. The MIT licence text of @tonejs/midi is in its LICENSE.md file. These libraries are loaded only when a song is added from a file. onnxruntime-web is loaded only by the song splitter's worker, when someone splits a song. Its WebAssembly files are ONNX Runtime built for the web, which includes third-party components under their own licences, listed in ONNX Runtime's ThirdPartyNotices.txt (https://github.com/microsoft/onnxruntime/blob/v1.23.2/ThirdPartyNotices.txt).
