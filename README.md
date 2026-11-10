# Battle Companion

A mobile-first web app for Age of Sigmar (GHB 2026-27). Each player signs in, pastes a list from the Warhammer AoS app, Sigdex or New Recruit, and gets:

- **Play:** a step-by-step walk through the game: set-up (battleplan with map, attacker/defender), deployment, the start of each battle round, and every phase of both players' turns. Each step shows the core-rules checklist and only the abilities from *your* list that you can use right then (your turn or theirs), plus commands, reactions and passives to remember. It also tracks CP, VP, fury, once-per-battle abilities and battle tactic tiers. Progress is saved on the device.
- **Deploy:** deployment practice on a true-scale 60″ × 44″ table for any GHB 2026-27 battleplan. Every model in the list is its own token (count = warscroll unit size, doubled when reinforced; round and oval bases at true size from the battle profile). Place a unit as a coherent block, then drag the whole unit or single models (touch or mouse), rotate, pinch or +/− to zoom, undo, clear, and switch attacker/defender. It shows territories, objectives, terrain and the 9″ no-deploy band, flags models that aren't wholly in your territory or are within 9″ of enemy territory, checks unit coherency (½″, one group) and can draw a ½″/1″/3″ ring round the selected unit. Save several named deployments per list and battleplan (stored on the server against your login); the working layout is also kept on the device.
- **Army:** warscrolls (stats, weapons, abilities), battle traits, formation, enhancements on the right units, lores and manifestations, faction terrain, tactic cards.
- **Stats:** faction win rates from aos-events, listhammer and aosstats; win-rate deltas for the units in your list; formation, enhancement, tactic, battleplan (RTB) and matchup win rates.
- **Rules:** turn sequence, core abilities and commands, season rules, all six GHB 2026-27 tactic cards and all 12 battleplans with maps, plus a search box.

Live at **https://stephenm754.github.io/battle-companion/** (GitHub Pages, repo `StephenM754/battle-companion`). Local clone: `~/Dev/git/personal/battle-companion`.

## How it's built

- **Static site** (`static/`): plain HTML/CSS/JS, no build step. GitHub Pages serves it; the list parser runs in the browser (`static/listparser.js`, a port of `listparser.py`; `tools/test_parser_parity.mjs` checks they agree).
- **Supabase** (free tier) for logins, saved lists and saved deployments, so they follow the player across devices. Project URL and publishable key are in `static/config.js`; the publishable key is meant to be public, and row-level security in `supabase/schema.sql` means each user only ever sees their own rows. Never commit the `service_role` key.
- **Stats** are static JSON in `static/data/stats/`, refreshed daily by the GitHub Action (`.github/workflows/pages.yml`), which also republishes the site on every push to `main`.
- `server.py` is the original local server (SQLite, its own logins). It still serves the static site for local testing; with `static/config.js` present the app talks to Supabase, not to `server.py`'s API.

## Users

Accounts are created in the Supabase dashboard (sign-ups are switched off): Authentication → Users → Add user → email `<username>@battle-companion.app`, a password, tick **Auto Confirm User**. They sign in with just the username. Make someone admin by setting `is_admin` on their row in Table Editor → `profiles` (admins see the user list in Settings). Users change their own password in Settings. Reset or remove users in the dashboard.

Settings → Backup exports a user's lists and deployments as a file and imports one. `tools/export_local.py <user> <file>` exports from the old local database in the same format.

Supabase pauses free projects after 7 days without activity; if sign-in stops working after a quiet spell, open the Supabase dashboard and restore the project.

## Run it locally

```bash
python3 server.py            # http://localhost:8790 (serves static/, uses Supabase for data)
python3 server.py --lan      # phones on the same Wi-Fi: http://<this Mac's IP>:8790
```

## Refresh the data

The rules cache and the 6 Nations battleplan maps live in `~/Documents/Warhammer` (override with `WARHAMMER_DIR`).

```bash
python3 tools/refresh_stats.py      # live stats from aos-events, listhammer, aosstats, releasethebeast (sequential; ~1 min) -> static/data/stats
python3 tools/build_rules.py        # re-export rules after refreshing ~/Documents/Warhammer/rules-cache (fetch_rules.py in the aos-reference-pack skill)
python3 tools/build_core.py         # rebuild the phase checklists after editing them or data/core_rules_research.json
python3 tools/test_parser.py        # parse the ~900 cached tournament lists and report unmatched lines
```

Commit and push after rebuilding; Pages republishes on its own.

## Where things come from

| What | Source |
|---|---|
| Warscrolls, abilities, lores, enhancements, points, core commands, season rules, battleplan rules | `~/Documents/Warhammer/rules-cache` (AoS Reminders corpus + BSData/Sigdex), exported to `static/data/rules/` |
| GHB 2026-27 tactic cards | BSData `.gst` |
| Battleplan maps | `~/Documents/Warhammer/6nations2026/.build/printables/battleplans.json` (read from Sigdex) |
| Unit sizes and base sizes (Deploy) | battle profiles in `~/Documents/Warhammer/rules-cache` (`unitSize`, `baseSizes`), exported by `build_rules.py` as `unitSize`, `baseSizes` and normalised `bases` ([width mm, depth mm, count]) |
| Turn sequence checklists | `tools/build_core.py`, written from `data/core_rules_research.json` (Core Rules Apr 2025, Rules Updates Oct 2026, WarCom GHB 2026-27 articles, Wahapedia core rules page dated after Oct 2026) |
| Stats | `static/data/stats/` built by `tools/refresh_stats.py` (daily in the GitHub Action) |

Deploy notes: 25 warscrolls (mostly faction terrain and a few odd units) have no base size or say "Use model"; the Deploy tab says so on the unit and guesses (100mm monster, 60×35mm cavalry, 40mm hero, else 32mm). Mixed-base units (champions, retinues) use the bracketed counts from the battle profile. The 9″ check uses the board's territory rectangles, so battleplan twists that change deployment aren't modelled.

Known gaps (from the research): the exact order of battle-tactic scoring vs primary scoring inside End of Turn isn't stated anywhere official; Seizing the Initiative and the 5-VP-per-tactic values rest on Wahapedia's GHB page (dated June 2026) plus WarCom articles.

## Layout

```
static/              the site: index.html, app.js (views), backend.js (Supabase), listparser.js, config.js, app.css,
                     data/rules (generated rules JSON), data/core.json, data/stats (tournament stats)
supabase/schema.sql  tables + row-level security (paste into the Supabase SQL editor; safe to re-run)
.github/workflows/   pages.yml: publish static/ to Pages on push and daily with fresh stats
tools/               build_rules.py, build_core.py, refresh_stats.py, test_parser.py, test_parser_parity.mjs, export_local.py
data/                core_rules_research.json (sources for the checklists); app.db and stats/raw are local only
server.py, listparser.py   the original local server and Python parser (local testing, parser tests)
```
