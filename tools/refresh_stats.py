#!/usr/bin/env python3
"""Fetch the competitive stats we use (aos-events, listhammer, aosstats, releasethebeast) and build per-faction digests.

  python3 tools/refresh_stats.py            # fetch live, then digest
  python3 tools/refresh_stats.py --offline  # digest from data/stats/raw (or the 6nations2026 meta cache) without fetching

Writes data/stats/raw/... (source files) and data/stats/digest/<faction-slug>.json + overview.json.
listhammer returns 403 on parallel requests, so every fetch here is sequential with a pause.
Stats never supply rules text or points; those come from the rules cache.
"""
import datetime
import json
import os
import re
import shutil
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path
WARHAMMER = Path(os.environ.get("WARHAMMER_DIR", Path.home() / "Documents" / "Warhammer"))  # rules cache + 6 Nations data live here

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "stats" / "raw"
DIG = ROOT / "static" / "data" / "stats"   # served to the browser as data/stats/<faction>.json
FALLBACK = WARHAMMER / "6nations2026" / "meta" / ".data"
UA = {"User-Agent": "Mozilla/5.0 (battle-companion stats refresh)"}
SEASON_START = "2026-07-01"
TIME = "ghb26_27"
EDITION = "GHB 26-27"
PACK = "Pitched Battles 2026-27"

ALIAS = {"Skaventide": "Skaven", "Lumineth Realm-Lords": "Lumineth Realm-lords",
         "Court of the Godlings": "Disciples of Tzeentch", "Legion of the First Prince": "Slaves to Darkness",
         "Lords of the Clan": "Sylvaneth", "New Summercourt": "Flesh-eater Courts", "The Baleful Lords": "Blades of Khorne",
         "Taar's Grand Forgehost": "Helsmiths of Hashut", "The First Phalanx of Ionrach": "Idoneth Deepkin",
         "The Gardeners of Nurgle": "Maggotkin of Nurgle"}


def canon(f):
    f = (f or "").strip()
    return ALIAS.get(f, f)


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower().replace("'", "")).strip("-")


def get(url, tries=3):
    for i in range(tries):
        try:
            return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read())
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(2 * (i + 1))


def save(name, obj):
    p = RAW / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj))


def week(d):
    return int(datetime.datetime.fromisoformat(d).timestamp() // 604800)


def fetch():
    ok, failed = [], []

    def job(name, url):
        try:
            save(name, get(url)); ok.append(name)
        except Exception as e:
            failed.append(f"{name}: {e}")
        time.sleep(1.2)

    A = "https://aos-events.com/api/aos/"
    job("aosevents/winrates.json", f"{A}winrates?time={TIME}&rounds=5plus&mirror=exclude&method=a")
    job("aosevents/matchups.json", f"{A}faction_matchups/all?time={TIME}&rounds=5plus")
    job("aosevents/enhancements.json", f"{A}enhancement_winrates?time={TIME}&rounds=5plus")
    job("aosevents/tactics.json", f"{A}tactic_winrates?time={TIME}&rounds=5plus")
    job("aosevents/release_events.json", f"{A}release_events")
    L = "https://listhammer.info/api/"
    job("listhammer/byFaction-dataslate.json", f"{L}stats/byFaction?gameType=aos&includeRtt=false&range=dataslate")
    job("listhammer/byFaction-4weeks.json", f"{L}stats/byFaction?gameType=aos&includeRtt=false&range=4weeks")
    R = "https://rtb-production-7d68.up.railway.app/api/"
    e = urllib.parse.quote(EDITION)
    job("rtb/edition-metrics.json", f"{R}tournaments/edition-metrics?edition={e}")
    job("rtb/edition-tactic-metrics.json", f"{R}tournaments/edition-metrics/tactic-metrics?edition={e}")
    B = "https://aosstats.tabletopbattles.com/data/reports/"
    now = week(datetime.date.today().isoformat())
    for w in range(week(SEASON_START), now + 1):
        try:
            save(f"aosstats/faction/{w}.json", get(f"{B}faction/{w}.json")); ok.append(f"aosstats/{w}")
        except Exception:
            pass
    (RAW / "fetched.json").write_text(json.dumps({"at": datetime.datetime.now().isoformat(timespec="seconds"),
                                                   "ok": ok, "failed": failed}, indent=1))
    print(f"fetched {len(ok)} files; {len(failed)} failed")
    if not ok:
        sys.exit("every stats source failed; keeping the previous digest")
    for f in failed:
        print("  FAILED", f)


def seed_from_fallback():
    """Copy the 6nations2026 meta cache into raw/ for anything we don't have yet."""
    pairs = {"aosevents/winrates.json": "aosevents/winrates-ghb26_27.json",
             "aosevents/matchups.json": "aosevents/matchups-ghb26_27.json",
             "aosevents/enhancements.json": "aosevents/enhancements-ghb26_27.json",
             "aosevents/tactics.json": "aosevents/tactics-ghb26_27.json",
             "aosevents/release_events.json": "aosevents/release_events.json",
             "listhammer/byFaction-dataslate.json": "listhammer/byFaction-dataslate-rttfalse.json",
             "listhammer/byFaction-4weeks.json": "listhammer/byFaction-4weeks-rttfalse.json",
             "rtb/edition-metrics.json": "rtb/edition-metrics.json",
             "rtb/edition-tactic-metrics.json": "rtb/edition-tactic-metrics.json"}
    for dst, src in pairs.items():
        if not (RAW / dst).exists() and (FALLBACK / src).exists():
            (RAW / dst).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(FALLBACK / src, RAW / dst)
    if not (RAW / "aosstats" / "faction").exists() and (FALLBACK / "aosstats" / "faction").exists():
        shutil.copytree(FALLBACK / "aosstats" / "faction", RAW / "aosstats" / "faction")


def load(name, default=None):
    p = RAW / name
    return json.loads(p.read_text()) if p.exists() else default


def pct(w, g):
    return round(100 * w / g, 1) if g else None


def digest():
    DIG.mkdir(parents=True, exist_ok=True)
    fac = defaultdict(lambda: defaultdict(list))
    over = {}

    wr = load("aosevents/winrates.json", {})
    for r in wr.get("factions", []):
        f = canon(r["name"])
        fac[f]["aosevents"] = {"wins": r["wins"], "draws": r["draws"], "losses": r["losses"], "games": r["games"],
                               "winRate": pct(r["wins"] + 0.5 * r["draws"], r["games"])}
    for r in wr.get("above50", []):
        fac[canon(r["faction"])]["above50"] = r["percentage"]
    for r in wr.get("win_distributions", []):
        fac[canon(r["name"])]["fourPlusWins"] = r.get("wins_4_plus_pct")
    for r in wr.get("units", []):
        fac[canon(r["faction"])]["units"].append({
            "name": r["name"], "playShare": r["play_share_pct"], "delta": r["win_rate_delta_pct"], "games": r["games"],
            "winWith": pct(r["wins"] + 0.5 * r["draws"], r["games"]), "winWithout": r.get("win_rate_without_pct")})

    en = load("aosevents/enhancements.json", {})
    for key, label, field in (("formations", "formations", "formation"), ("traits", "traits", "trait"),
                              ("artifacts", "artefacts", "artifact"), ("faction_enhancements", "enhancements", "enhancement"),
                              ("manifestations_by_faction", "manifestations", "manifestation"),
                              ("drops_by_faction", "drops", "drop_count")):
        for r in en.get(key, []):
            row = {"name": r[field], "winRate": r["win_rate_pct"], "games": r["games"]}
            if r.get("enhancement_type"):
                row["type"] = r["enhancement_type"]
            fac[canon(r["faction"])][label].append(row)

    ta = load("aosevents/tactics.json", {})
    for r in ta.get("tactic_by_faction", []):
        fac[canon(r["faction"])]["tactics"].append({"name": r["tactic"], "winRate": r["win_rate_pct"], "games": r["games"]})
    for r in ta.get("tactic_pairs_by_faction", []):
        fac[canon(r["faction"])]["tacticPairs"].append({"name": r["tactic_pair"].replace(",", " + "), "winRate": r["win_rate_pct"], "games": r["games"]})
    over["tactics"] = [{"name": r["tactic"], "winRate": r["win_rate_pct"], "games": r["games"]} for r in ta.get("tactics", [])]

    mu = load("aosevents/matchups.json", {})
    for f, opps in (mu.get("matchups") or {}).items():
        for o, r in opps.items():
            fac[canon(f)]["matchups"].append({"name": canon(o), "winRate": r["win_rate_pct"], "games": r["games"]})

    for rng in ("dataslate", "4weeks"):
        lh = load(f"listhammer/byFaction-{rng}.json", {})
        for r in lh.get("result", []):
            fac[canon(r["faction"])][f"listhammer_{rng}"] = {"winRate": float(r["winRate"]), "games": r["total"],
                                                             "players": r["players"], "top4": r["top4"], "eventWins": r["eventWins"]}

    rtb = load("rtb/edition-metrics.json", {})
    for r in rtb.get("battleplan_winrates", []):
        fac[canon(r["faction"])]["battleplans"].append({"name": r["battleplan"], "winRate": r["win_pct"], "games": r["total"]})
    for r in rtb.get("faction_avg_points", []):
        fac[canon(r["faction"])]["rtbAvgTP"] = {"avg": r["avg"], "games": r["games"]}

    agg = defaultdict(lambda: defaultdict(int))
    for p in sorted((RAW / "aosstats" / "faction").glob("*.json")) if (RAW / "aosstats" / "faction").exists() else []:
        d = json.loads(p.read_text()).get(PACK, {})
        for f, v in d.items():
            for k in ("wins", "games", "ties", "r_wins", "r_games"):
                agg[canon(f)][k] += v.get(k, 0)
    for f, v in agg.items():
        fac[f]["aosstats"] = {"winRate": pct(v["r_wins"] + 0.5 * v.get("ties", 0) * (v["r_games"] / v["games"] if v["games"] else 0), v["r_games"]),
                              "games": v["games"]}

    fetched = load("fetched.json", {"at": None})
    table = []
    for f, d in fac.items():
        for k in ("units", "formations", "traits", "artefacts", "enhancements", "manifestations", "tactics", "tacticPairs", "matchups", "battleplans"):
            if k in d:
                d[k].sort(key=lambda r: -(r.get("games") or 0))
        d = dict(d)
        d["faction"] = f
        d["updated"] = fetched.get("at")
        (DIG / f"{slug(f)}.json").write_text(json.dumps(d, separators=(",", ":")))
        table.append({"faction": f, "slug": slug(f),
                      "aosevents": d.get("aosevents"), "listhammer": d.get("listhammer_dataslate"),
                      "aosstats": d.get("aosstats"), "fourPlusWins": d.get("fourPlusWins")})
    over["factions"] = sorted(table, key=lambda r: -((r.get("aosevents") or {}).get("winRate") or 0))
    over["updated"] = fetched.get("at")
    over["sources"] = {
        "aosevents": "aos-events.com: BCP GTs with 5+ rounds, GHB 2026-27, mirrors excluded",
        "listhammer": "listhammer.info: GT singles since the latest Battlescroll",
        "aosstats": "aosstats.tabletopbattles.com: TTBattles app games, Pitched Battles 2026-27 (mirrors removed)",
        "rtb": "releasethebeast.app: team events, GHB 26-27 (battleplan win rates)",
    }
    (DIG / "overview.json").write_text(json.dumps(over, separators=(",", ":")))
    print(f"digested {len(fac)} factions -> {DIG}")


if __name__ == "__main__":
    if "--offline" not in sys.argv:
        fetch()
    seed_from_fallback()
    digest()
