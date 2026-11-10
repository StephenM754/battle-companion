#!/usr/bin/env python3
"""Run the list parser over the cached listhammer lists and report match rates."""
import json
import os, sys
from collections import Counter
from pathlib import Path
WARHAMMER = Path(os.environ.get("WARHAMMER_DIR", Path.home() / "Documents" / "Warhammer"))  # rules cache + 6 Nations data live here
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from listparser import parse
RULES = Path(__file__).resolve().parents[1] / "static/data/rules"
src = WARHAMMER / "6nations2026/meta/.data/listhammer/recentLists.json"
lists = json.load(open(src))
bad_fac = 0; units = 0; unmatched = Counter(); nf = Counter(); noform = 0; fails = []
for x in lists:
    t = x.get("listText") or ""
    r = parse(t, RULES)
    if "error" in r: nf[x["faction"]] += 1; continue
    exp = x["faction"].lower().replace("skaventide", "skaven")
    if r["faction"].lower() != exp and not (exp == "big waaagh!" ): bad_fac += 1; fails.append((x["faction"], r["faction"]))
    units += sum(len(g["units"]) for g in r["regiments"])
    for u in r["unmatched"]: unmatched[(r["faction"], u)] += 1
    if not r["formation"]: noform += 1
print("lists", len(lists), "faction errors", bad_fac, "no-faction", sum(nf.values()), "units matched", units, "unmatched lines", sum(unmatched.values()), "no formation", noform)
print(Counter(fails).most_common(10))
for (f, u), n in unmatched.most_common(40): print(n, f, "|", u)
