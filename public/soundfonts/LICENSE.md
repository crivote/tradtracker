# Soundfont samples — attribution

The practice player in `/practice` synthesises tunes with **abcjs**, and abcjs
builds the URL of every note as `soundFontUrl + instrument + '-mp3/' + note + '.mp3'`.
This directory holds exactly those files, served by this app instead of a
third-party CDN, so the player works offline and the licence obligation stays
visible in the repository.

- **Soundfont:** FluidR3_GM
- **Licence:** [Creative Commons Attribution 3.0 (CC BY 3.0)](https://creativecommons.org/licenses/by/3.0/)
- **Source:** [gleitz/midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts),
  branch `gh-pages`, path `FluidR3_GM/<instrument>-mp3/*.mp3`
- **Instruments:** fiddle, whistle, accordion, banjo — 88 notes each (`A0` … `C8`)
- **Re-fetch:** `node scripts/fetch-soundfonts.mjs` (idempotent)

The notes are named the way the soundfont names them, with flats (`Ab1`,
`Bb3`, `Gb2`) and never with sharps (`A#`, `F#`): that is also the convention of
abcjs's `pitchToNoteName` table, so no enharmonic mapping is needed.

These files are unmodified copies of the published samples. The licence is
CC BY 3.0: attribution is required, and it is shown to the user in `/about`.
