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

## Na iPhonu

Aplikace běží na tvém počítači a iPhone ji otevře v Safari. Video se zpracovává přímo v telefonu.

**Varianta A – odkudkoli (doporučeno):**

```bash
# do .env si dej APP_PASSWORD=nejake-heslo
npm run phone
```

Ve výpisu se objeví adresa `https://….trycloudflare.com`. Otevři ji v Safari na iPhonu a zadej heslo
(jméno je libovolné). Přes HTTPS funguje i rychlejší přepis (WebGPU) a model Whisper se uloží do
mezipaměti. Adresa platí, dokud běží `npm run phone`; při dalším spuštění bude jiná.

**Varianta B – jen doma ve stejné Wi-Fi:**

```bash
npm run build && npm start
```

Server vypíše adresu typu `http://192.168.x.x:8787`. Přes obyčejné HTTP se ale model pro přepis
pokaždé stahuje znovu a běží pomaleji.

**Jako appka na ploše:** v Safari klepni na *Sdílet → Přidat na plochu*. Otevře se na celou obrazovku
s vlastní ikonou.

Na iPhonu:
- video vybereš z Fotek nebo Souborů,
- text v přepisu označíš podržením prstu,
- klipy posouváš šipkami ◀ ▶ v horní liště,
- hotové video uložíš tlačítkem **Uložit do Fotek / sdílet**.

Omezení: export v telefonu je pomalejší, pro videa z iPhonu (4K, HEVC) zvol formát 720p nebo
9:16 a kvalitu *Rychlý náhled*. Hodně dlouhá videa se do paměti Safari nemusí vejít.

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
