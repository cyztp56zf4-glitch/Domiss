# Domiss – AI střih videa

Webová aplikace na střih a úpravu videa s pomocí AI. Video se zpracovává přímo v prohlížeči
(nikam se nenahrává); na server jde jen textový přepis, když použiješ AI střih přes Claude.

## Co umí

| Funkce | Jak to funguje |
|---|---|
| **Import** | Přetáhni do okna jedno nebo víc videí (MP4, MOV, WebM…) |
| **Časová osa** | Waveform, rozdělení (`S`), ořez tažením okrajů, přesun klipů tažením, mazání (`Delete`), zpět/znovu (`Ctrl+Z` / `Ctrl+Shift+Z`) |
| **Přepis řeči** | Whisper běží v prohlížeči (WebGPU, jinak WASM), časování po slovech, čeština i další jazyky |
| **Střih textem** | V záložce *Přepis* označ text a dej *Vystřihnout* – zmizí i z videa. *Obnovit* ho vrátí |
| **Odstranění ticha** | Nastavitelný práh (dB), minimální délka a rezerva kolem řeči |
| **Vycpávková slova** | Jedním klikem vystřihne „ehm“, „eee“, „jako“, „prostě“… (seznam jde upravit) |
| **AI střih (Claude)** | Podle pokynu („odstraň opakované pokusy“, „udělej 2minutové shrnutí“) a volitelné cílové délky navrhne a rovnou použije střih |
| **Klipy na Shorts** | Claude najde nejsilnější samostatné momenty, ohodnotí je a jedním klikem z nich udělá časovou osu nebo sestřih |
| **Podklady k publikaci** | Návrhy názvu, popis, kapitoly s časy podle aktuálního střihu, tagy |
| **Export** | MP4 (H.264/AAC) jako zdroj, 1080p, 720p, **9:16 na výšku**, 1:1; volitelně vypálené titulky; titulky SRT/VTT |
| **Ukládání na vybraný disk** | V záložce *Export → Kam ukládat* vyber libovolnou složku na libovolném disku (externí disk, D:, síťový disk…). Aplikace si ji pamatuje a ukládá tam videa i titulky; existující soubory nepřepisuje. Funguje v Chrome a Edge na počítači, jinde se soubory stahují do Stažených |

## Spuštění

Potřebuješ Node.js 22+.

```bash
npm install
cp .env.example .env      # a doplň ANTHROPIC_API_KEY
npm run dev               # web na http://localhost:5173, API na :8787
```

Produkční běh:

```bash
npm run build
npm start                 # vše na http://localhost:8787
```

Bez `ANTHROPIC_API_KEY` funguje všechno kromě sekce *AI střih (Claude)*.

Při prvním přepisu se z Hugging Face stáhne model Whisper (~80 MB, resp. ~250 MB pro Small);
prohlížeč si ho pak pamatuje.

## Architektura

```
src/
  App.tsx                 rozvržení, import, klávesové zkratky
  store.ts                stav projektu (média, přepisy, klipy) s historií zpět/znovu
  usePlayer.ts            přehrávání střihu jedním <video> (skoky mezi klipy)
  components/             Timeline, TranscriptPanel, AIPanel, ExportPanel
  lib/timeline.ts         čisté funkce nad klipy (split, ripple delete, vystřižení/obnovení rozsahů)
  lib/transcript.ts       segmentace přepisu, vycpávková slova, titulky (SRT/VTT)
  lib/audio.ts            dekódování zvuku, detekce ticha
  lib/saveTarget.ts       výběr a zapamatování cílové složky (File System Access API)
  lib/ffmpeg.ts           export přes ffmpeg.wasm (jeden vstup na klip, concat, ASS titulky)
  workers/whisper.worker  přepis přes transformers.js
server/
  index.ts                Express – /api/ai/edit, v produkci servíruje i dist/
  ai.ts                   Claude API: strukturovaný výstup (Zod) – střih, klipy, metadata
tests/                    unit testy (vitest)
```

Model pracuje s přepisem rozděleným na očíslované segmenty a vrací jen indexy segmentů (ne časy),
takže si nemůže vymyslet neexistující místo ve videu. Výsledek se aplikuje na aktuální střih, takže
jde kombinovat s odstraněním ticha a ručními úpravami a vždy vrátit přes `Ctrl+Z`.

Výchozí model je `claude-opus-5-5` (lze změnit proměnnou `CLAUDE_MODEL`). Pokud model požadavek
z bezpečnostních důvodů odmítne, API ho automaticky zkusí na záložním modelu (`fallbacks: "default"`).

## Testy

```bash
npm test          # unit testy
npm run typecheck
```
