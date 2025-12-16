# Red vs Blue Pokémon Battle Sim (Android-friendly)

This is a small **installable web app (PWA)**:
- It runs in Chrome on Android.
- You can **Install** it to your home screen.
- It caches app files for offline use.

It pulls Pokémon data from **PokéAPI** and caches it locally to be polite.

## Super-simple “like I’m 5” steps

### Option A: Put it online (best for Android install)
1) Make a free GitHub account
2) Create a new repository (a folder online) named: `rvsb-sim`
3) Upload ALL the files from this zip into that repo
4) Turn on **GitHub Pages**:
   - Repo Settings → Pages → “Deploy from branch” → main → /(root)
5) Wait a minute, then open the Pages link on your Android phone in Chrome.
6) Tap the **⋮ menu** (3 dots) → **Install app** or **Add to Home screen**.

✅ This makes it install like a real app and works best because it is served over HTTPS.

### Option B: Run it on your computer (quick testing)
1) Install Node.js
2) In the folder, run:
   - `npx serve`
3) Open the shown URL in your browser.

## What it does right now (MVP)
- Add Pokémon to Red / Blue (type a name like `pikachu`)
- Auto-load stats, types, and 4 damaging moves
- Sim battle with play-by-play + HP bar animation
- “Secret” abilities exist and show up as ??? until discovered

## Next upgrades (tell me what you want first)
- Better AI for moves and switching
- More accurate mechanics (status, abilities, items, etc.)
- Real engine integration (Pokémon Showdown or @pkmn/engine)
- More animations (hit flashes, sprites, sounds)
