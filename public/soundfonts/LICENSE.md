# Soundfont samples — attribution

The practice player in `/practice` synthesises tunes with **abcjs**, and abcjs
builds the URL of every note as `soundFontUrl + instrument + '-mp3/' + note + '.mp3'`.
This directory holds exactly those files, served by this app instead of a
third-party CDN, so the player works offline and the licence obligation stays
visible in the repository.

| Folder | Practice instrument | Soundfont | Licence |
|---|---|---|---|
| `violin-mp3` | fiddle | MusyngKite | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) |
| `recorder-mp3` | whistle | MusyngKite | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) |
| `accordion-mp3` | accordion | FluidR3_GM | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| `banjo-mp3` | banjo | FluidR3_GM | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |

- **Source:** [gleitz/midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts),
  branch `gh-pages`, path `<soundfont>/<instrument>-mp3/*.mp3`
- **Notes:** 88 per instrument (`A0` … `C8`), named the way the soundfont names
  them — flats (`Ab1`, `Bb3`, `Gb2`), never sharps (`A#`, `F#`). That is also
  the convention of abcjs's `pitchToNoteName` table, so no enharmonic mapping is
  needed.
- **Re-fetch:** `node scripts/fetch-soundfonts.mjs` (idempotent)

**Why two soundfonts.** The `fiddle` and `whistle` patches of FluidR3 are
orchestral: the fiddle takes more than a second to reach its peak (a string
swell) and the whistle is breath without an attack. At 108 bpm an eighth note
lasts 280 ms, so the note ends before the sample speaks. Measured at 50 ms, the
FluidR3 fiddle is at 28 % of its energy and the MusyngKite violin at 72 %; the
MusyngKite recorder peaks in 20-60 ms across the whole range, against 90-590 ms
for the FluidR3 whistle. The accordion and banjo were already articulated and
stay on FluidR3.

These files are unmodified copies of the published samples. Attribution is
required by both licences and is shown to the user in `/about`. The
Share-Alike term applies to these sample files, not to the application code.
