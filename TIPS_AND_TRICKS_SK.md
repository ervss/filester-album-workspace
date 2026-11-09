# Prehľad úprav, tipy a triky (SK príručka)

Tento priečinok obsahuje plne samostatnú (standalone), do angličtiny preloženú a vylepšenú verziu tvojho skriptu **Filester Album Workspace v2.1.0**, pripravenú na okamžité zdieľanie s komunitou.

Pôvodný súbor `filester-album-workspace.user.js` v hlavnom priečinku zostal **úplne nedotknutý**.

---

## 🆕 Čo je nové vo verzii 2.1.0 (Podpriečinky a zlučovanie albumov)

V najnovšej standalone verzii sme pridali kompletnú správu podpriečinkov bez akejkoľvek závislosti na lokálnom Nexus serveri:
1. **Podpora podpriečinkov (`subfolders`):**
   - Automatická detekcia a zobrazenie reálneho počtu súborov, počtu stránok (napr. `📄 121 files (6 pages)`), celkovej veľkosti (`💾 119.72 GB`) a dátumu uploadu pod názvom priečinka.
   - Náhľad zostáva čistý (bez duplicitného odznaku veľkosti), obsahuje zaškrtávacie pole a tlačidlo `↗` na priame otvorenie.
2. **Lišta priečinkov (Folder Toolbar):**
   - Odstránený limit 5 priečinkov z pôvodného Filesteru (všetky priečinky sú ihneď viditeľné).
   - Rýchle vyhľadávanie (`Filter folders…`) a 7 režimov triedenia (podľa veľkosti, počtu súborov, dátumu, názvu).
3. **Plávajúci panel akcií (Folder Action Dock):**
   - Pri označení priečinkov sa vysunie panel so súčtom položiek a veľkosti.
   - Možnosť stiahnuť označené priečinky ako ZIP (`/api/folder/download`) alebo hromadne uložiť ich súbory do svojho Filester účtu (`/api/file/save`).
4. **Virtuálny zlúčený album (Virtual Merged View):**
   - Spojí súbory z vybraných priečinkov do jednej mriežky priamo na stránke (alebo v novom tabe cez `#merge=slug1,slug2`).
   - Automaticky prejde a načíta **všetky strany** každého zvoleného priečinka (Filester natívne vracia len 24 položiek na stranu).
   - Interaktívne filtre (chipy) pre jednotlivé priečinky, tagy pôvodu na kartách (`📁 Folder Name`) a návrat späť na zoznam priečinkov jedným klikom.
   - Všetky funkcie standalone prehrávača (modálny prehrávač, 12-kanálový split-screen, export do .M3U, JSON, kopírovanie priamych URL) plne fungujú aj na zlúčených súboroch!

---

## 🔍 1. Čo by iným ľuďom v pôvodnom skripte nefungovalo (a ako sme to vyriešili)

V pôvodnom skripte bolo viacero funkcií pevne naviazaných na tvoj lokálny Python backend (`http://localhost:8001` – Nexus Dashboard) alebo na externý skript `Nexus Universal Split-Screen`. Bežnému používateľovi bez tvojho servera by svietilo červené `Nexus offline` a nefungovalo by mu prakticky nič okrem základného filtrovania názvov.

| Pôvodná funkcia | Prečo by iným nešla | Ako to rieši nová Standalone verzia (v2.0.0) |
| :--- | :--- | :--- |
| **Stav pripojenia (`Hľadám Nexus…`, výber portu `8001..8003`)** | Používatelia nemajú spustený lokálny server na `localhost`. | **Odstránené.** Nahradené čistým indikátorom `Standalone Mode (Direct Browser API)`. Odobraté aj `@connect localhost` a `127.0.0.1` z hlavičky, aby Tampermonkey nepýtal podozrivé povolenia na lokálnu sieť. |
| **Import do Nexus Dashboardu & Source Boards (`Importovať vybrané`, `Batch v dashboarde`)** | Volalo lokálne API `/api/v1/intake/import` a `/api/v1/source-boards`. | **Odstránené** a nahradené univerzálnymi exportmi pre každého: **Copy Page URLs**, **Copy Direct URLs**, **Export .M3U** (pre VLC/MPV/PotPlayer) a **Export JSON**. |
| **Zisťovanie metadát (`Meta vybrané` / `Meta viditeľné`)** | Volalo `localhost:8001/api/tester/batch-meta`. Bez servera nešlo zistiť dĺžku ani rozlíšenie. | **Prebudované na priamy browser resolver!** Skript priamo z prehliadača osloví Filester endpoint `/v2/api/public/view`, stiahne podstránku `/d/<slug>` (vyextrahuje dĺžku, veľkosť, dátum nahrania, rozlíšenie) a ak treba, dotiahne presné rozlíšenie/dĺžku cez HTML5 `<video preload="metadata">`. |
| **Prehrávač videa (`▶` na karte)** | Volal `localhost:8001/api/tester/batch-meta` na získanie priameho streamu. | **Funguje 100% samostatne!** Priamo vygeneruje CDN stream URL cez `/v2/api/public/view` a prehrá video v modálnom okne (navyše sme pridali tlačidlá `◀ Prev`, `Next ▶`, `Select`, `Review` a `Copy Stream` priamo do hlavičky prehrávača). |
| **Split-Screen (`▶▶ Split-Screen` a `▦`)** | Vyžadoval nainštalovaný druhý skript `Nexus Universal Split-Screen` + lokálny server. | **Zabudovaný vlastný Multi-Video Split-Screen Wall!** Ak používateľ nemá externý split-screen skript, otvorí sa priamo vstavaná mriežka až pre **12 videí naraz** (s automatickým prepínaním zvuku pri prechode myšou, Play All, Pause All, Mute All). |
| **HD náhľady (`HD náhľady`)** | Volalo `localhost:8001/api/tester/stream-frame` (FFmpeg na serveri). | **Klientsky Canvas Frame Capture!** Skript si v pozadí vytvorí HTML5 `<video>`, posunie sa na ~10–15 % dĺžky videa a vykreslí ostrý frame cez `<canvas>` (s automatickým fallbackom na `og:image` plagát). |

---

## 🚀 2. Nové vylepšenia, ktoré sme pridali navyše

1. **Shift + Klik pre výber rozsahu (Range Selection):**
   Označ prvé video, podrž `Shift` a klikni na desiate video – automaticky sa označia všetky videá medzi nimi.
2. **Nové filtre a rýchle akcie na lište:**
   - `☑ Selected Only` – zobrazí iba aktuálne označené videá (super na finálnu kontrolu pred exportom).
   - `Invert` (`Shift + I`) – invertuje výber viditeľných položiek.
   - `Reset Filters` – jedným klikom vyčistí vyhľadávanie, filtre dĺžky/veľkosti aj zoradenie.
   - Celková veľkosť označených súborov priamo v štatistike (napr. `12 selected (8.45 GB)`).
3. **Export .M3U8 playlistu (`Export .M3U`):**
   Vygeneruje playlist priamych CDN streamov. Používateľ si ho otvorí vo **VLC, MPV, IINA alebo PotPlayeri** a môže pozerať celý album bez sťahovania v plnej kvalite.
4. **Automatické doriešenie Direct URL pri kopírovaní:**
   V pôvodnom skripte tlačidlo `COPY DIRECT URL` vypísalo chybu, ak používateľ najprv nespustil `Meta vybrané`. Po novom skript chýbajúce direct streamy **automaticky načíta na pozadí** a hneď ich vloží do schránky.
5. **Vstavané okno s nápovedou (`?`):**
   Kliknutím na tlačidlo `?` vpravo hore (alebo stlačením klávesu `?`) sa otvorí prehľadné modálne okno so všetkými klávesovými skratkami a tipmi pre vyhľadávanie.
6. **Rozšírená podpora domén:**
   Okrem `filester.me` a `filester.gg` sú v `@match` pridané aj zrkadlá `filester.si` a `filester.sh`.

---

## 📦 3. Ako skript najlepšie odovzdať ľuďom

- **Najjednoduchší spôsob (1 súbor):** Pošli im priamo súbor `filester-album-workspace-standalone.user.js` spolu s `README.md` (prípadne oba súbory zabaľ do `.zip`).
- **Pre ešte pohodlnejšiu inštaláciu (1-klik link):**
  - Ak súbor nahráš na **GitHub Gist** (alebo do verejného GitHub repozitára) a pošleš ľuďom odkaz na **Raw** verziu súboru končiacu na `.user.js`, Tampermonkey / Violentmonkey automaticky rozpozná koncovku `.user.js` a rovno im ponúkne inštalačné okno jedným kliknutím.
  - Prípadne ho môžeš publikovať na **GreasyFork.org**, vďaka čomu budú mať používatelia aj automatické aktualizácie, keď vydáš novú verziu.
