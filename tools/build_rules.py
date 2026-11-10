#!/usr/bin/env python3
"""Export the local AoS rules cache (~/Documents/Warhammer/rules-cache) into compact JSON the web app serves.

Writes static/data/rules/:
  index.json            factions (name, slug, unit names, group names) + corpus date
  <faction-slug>.json   warscrolls (stats, points, abilities, weapons) and the faction's rule groups
  lores.json            every spell / prayer / manifestation lore by name (covers universal manifestation lores)
  tactics.json          GHB battle tactic cards from the BSData .gst (current season flagged)

Only matched-play contexts are kept: standard 4th edition plus the current GHB season (no Spearhead,
Legends or past-season variants, which often share names with the matched-play rule).

Usage: python3 tools/build_rules.py [--cache <rules-cache dir>]
"""
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path
WARHAMMER = Path(os.environ.get("WARHAMMER_DIR", Path.home() / "Documents" / "Warhammer"))  # rules cache + 6 Nations data live here

ROOT = Path(__file__).resolve().parents[1]
CACHE = WARHAMMER / "rules-cache"
OUT = ROOT / "static" / "data" / "rules"

ARMY_TYPES = {"battle-trait", "battle-formation", "heroic-trait", "artefact-of-power", "spell-lore", "prayer-lore",
              "manifestation-lore", "monstrous-traits"}
LORE_TYPES = {"spell-lore", "prayer-lore", "manifestation-lore"}


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower().replace("'", "")).strip("-")


class Corpus:
    def __init__(self, cache):
        d = json.loads((cache / "aos-reminders" / "catalog.json").read_text())
        self.generated = d.get("generatedAt")
        ctx = {c["id"]: c for c in d["rulesContexts"]}
        self.allowed = {cid for cid, c in ctx.items() if c["status"] in ("current", "seasonal") and c.get("mode") != "spearhead"}
        self.ents = {e["id"]: e for e in d["entities"]}
        self.out = defaultdict(list)
        self.inn = defaultdict(list)
        for r in d["relationships"]:
            if r["kind"] == "excludes":
                continue
            self.out[r["from"]].append(r["to"])
            self.inn[r["to"]].append(r["from"])

    def visible(self, e):
        return any(c in self.allowed for c in e.get("rulesContextIds", []))

    def children(self, eid, kind=None):
        seen, res = set(), []
        for t in self.out.get(eid, []):
            e = self.ents.get(t)
            if e and t not in seen and (kind is None or e["kind"] == kind) and self.visible(e):
                seen.add(t)
                res.append(e)
        return res


def ability(a):
    t = a.get("text", {}) or {}
    tm = (a.get("timings") or [{}])[0]
    win = tm.get("window", {}) or {}
    usage = tm.get("usage")
    out = {
        "name": a["name"],
        "timing": ", ".join(x.get("raw", "") for x in a.get("timings", [])) or a.get("abilityKind", ""),
        "kind": tm.get("kind", a.get("abilityKind")),          # passive / active / reaction
        "who": tm.get("perspective"),                          # your / any / enemy / neutral
        "when": win.get("phase") or win.get("kind"),            # hero/movement/.../deployment/battle-round-start/reaction/always
    }
    if win.get("round"):
        out["round"] = win["round"]
    if usage:
        out["usage"] = f"{usage.get('limit')}/{usage.get('period')}" + (f" ({usage.get('scope')})" if usage.get("scope") else "")
    if a.get("cost"):
        out["cost"] = f"{a['cost'].get('kind', '').title()} {a['cost'].get('value')}"
    if a.get("keywords"):
        out["keywords"] = a["keywords"]
    for k in ("declare", "effect", "setup", "description"):
        if t.get(k):
            out[k] = t[k]
    extra = {k: v for k, v in t.items() if k not in ("declare", "effect", "setup", "description") and v}
    if extra:
        out["extra"] = extra
    return out


def weapon(w):
    p = w.get("profile", {}) or {}
    rng = p.get("rangeInches")
    return {
        "name": w["name"], "type": w.get("weaponType", ""), "range": f'{rng}"' if rng else "",
        "a": p.get("attacks", ""), "hit": p.get("hit", ""), "wound": p.get("wound", ""),
        "rend": p.get("rend", ""), "dmg": p.get("damage", ""),
        "abilities": [k.get("raw", "") for k in w.get("keywords", [])],
    }


BASE_RE = re.compile(r"([\d.]+)\s*(?:[×x]\s*([\d.]+)\s*)?mm(?:\s*\[(\d+)\])?", re.I)


def bases(raw):
    """Normalise battle-profile baseSizes ("32mm", "60 × 35mm", "28.5mm [3]", "60 × 35mm. Champion is 40mm.")
    into [[width_mm, depth_mm, count_or_null], ...]. Returns None for "Use model" or no data."""
    out = []
    for s in raw or []:
        if "use model" in s.lower():
            return None
        champ = re.search(r"champion is ([\d.]+)\s*mm", s, re.I)
        if champ:
            out.append([float(champ.group(1)), float(champ.group(1)), 1])
            s = s[:champ.start()]
        m = BASE_RE.search(s.split(" or ")[0])
        if m:
            w = float(m.group(1))
            h = float(m.group(2)) if m.group(2) else w
            out.append([w, h, int(m.group(3)) if m.group(3) else None])
    return out or None


def warscroll(c, w):
    ch = dict(w.get("characteristics", {}))
    is_mani = "MANIFESTATION" in w.get("keywords", [])
    if is_mani and "control" in ch:   # corpus files the Banishment value under 'control'
        ch["banishment"] = ch.pop("control")
    bps = c.children(w["id"], "battle-profile")
    bp = bps[0] if bps else {}
    return {
        "name": w["name"],
        "stats": ch,
        "keywords": w.get("keywords", []),
        "points": bp.get("points"),
        "unitSize": bp.get("unitSize"),
        "baseSizes": bp.get("baseSizes", []),
        "bases": bases(bp.get("baseSizes")),
        "regimentOptions": bp.get("regimentOptions", []),
        "notes": bp.get("notes", []),
        "abilities": [ability(a) for a in c.children(w["id"], "ability")],
        "weapons": [weapon(x) for x in c.children(w["id"], "weapon")],
        "manifestation": is_mani,
    }


def group(c, g, depth=0, seen=None):
    seen = seen if seen is not None else set()
    if g["id"] in seen or depth > 5:
        return None
    seen.add(g["id"])
    out = {"name": g["name"], "type": g.get("groupType"),
           "abilities": [ability(a) for a in c.children(g["id"], "ability")]}
    subs = [group(c, s, depth + 1, seen) for s in c.children(g["id"], "content-group")]
    subs = [s for s in subs if s]
    if subs:
        out["groups"] = subs
    ws = c.children(g["id"], "warscroll")
    if ws:
        out["warscrolls"] = [warscroll(c, w) for w in ws]
    return out


def walk_groups(gs):
    for g in gs:
        yield g
        yield from walk_groups(g.get("groups", []))


def tactics_from_gst(cache):
    p = cache / "bsdata" / "Age of Sigmar 4.0.gst"
    xml = p.read_text()
    forces = {m.group(2): m.group(1) for m in re.finditer(r'<forceEntry name="([^"]*)" id="([^"]*)"', xml)}
    unesc = lambda s: (s.replace("&quot;", '"').replace("&apos;", "'").replace("&amp;", "&")
                       .replace("&lt;", "<").replace("&gt;", ">"))
    seasons = []
    for grp in re.finditer(r'<selectionEntryGroup name="([^"]*)"[^>]*>(.*?)</selectionEntryGroup>', xml, re.S):
        body = grp.group(2)
        cards = re.findall(r'<profile name="([^"]*)"[^>]*typeName="Battle Tactic Card">(.*?)</profile>', body, re.S)
        if not cards:
            continue
        head = body.split("<selectionEntries>", 1)[0]
        label = ", ".join(sorted({unesc(forces.get(cid, cid)) for cid in re.findall(r'childId="([^"]*)"', head)})).replace("✦ ", "")
        out = []
        for name, cbody in cards:
            card = {"name": unesc(name), "card": "", "tiers": []}
            for stage, text in re.findall(r'<characteristic name="([^"]*)"[^>]*?(?:/>|>(.*?)</characteristic>)', cbody, re.S):
                text = unesc(re.sub(r"\*\*\^\^(.*?)\^\^\*\*", r"\1", text or "")).replace("**", "").strip()
                if not text:
                    continue
                if stage == "Card":
                    card["card"] = text
                else:
                    title, _, rest = text.partition(":")
                    card["tiers"].append({"tier": stage, "name": title.strip(), "text": rest.strip()})
            out.append(card)
        seasons.append({"season": label, "cards": out})
    return seasons


def main():
    cache = CACHE
    if "--cache" in sys.argv:
        cache = Path(sys.argv[sys.argv.index("--cache") + 1])
    c = Corpus(cache)
    OUT.mkdir(parents=True, exist_ok=True)
    index = {"generated": c.generated, "factions": []}
    lores = {}

    for f in sorted((e for e in c.ents.values() if e["kind"] == "faction"), key=lambda e: e["name"]):
        ws = sorted(c.children(f["id"], "warscroll"), key=lambda w: w["name"])
        groups = [g for g in (group(c, g) for g in c.children(f["id"], "content-group")) if g]
        data = {"name": f["name"], "slug": slug(f["name"]), "generated": c.generated,
                "warscrolls": [warscroll(c, w) for w in ws], "groups": groups}
        for g in walk_groups(groups):
            if g["type"] in LORE_TYPES:
                lores.setdefault(g["name"], g)
        (OUT / f"{data['slug']}.json").write_text(json.dumps(data, separators=(",", ":")))
        index["factions"].append({
            "name": f["name"], "slug": data["slug"],
            "units": [w["name"] for w in data["warscrolls"]],
            "groups": sorted({g["name"] for g in walk_groups(groups) if g["type"] in ARMY_TYPES}),
        })
        print(f"{f['name']:<28} {len(ws):>4} warscrolls  {len(groups):>3} groups")

    # universal lores live outside factions (e.g. Twilit Sorceries)
    for e in c.ents.values():
        if e["kind"] == "content-group" and e.get("groupType") in LORE_TYPES and c.visible(e):
            g = group(c, e)
            if g:
                # wrapper groups named generically ("Manifestation Lore") hold the real lore one level down
                for sub in [g] + g.get("groups", []):
                    if sub["type"] in LORE_TYPES and sub["name"].lower() not in ("manifestation lore", "spell lore", "prayer lore"):
                        lores.setdefault(sub["name"], sub)
    # every unit name and Regiment of Renown across factions, for allies / RoR matching in the browser parser
    glob = {"units": [], "rors": []}
    for fi in index["factions"]:
        glob["units"] += [[u, fi["slug"]] for u in fi["units"]]
        fac = json.loads((OUT / f"{fi['slug']}.json").read_text())
        glob["rors"] += [g["name"] for g in walk_groups(fac["groups"]) if g["type"] == "regiment-of-renown"]
    glob["rors"] = sorted(set(glob["rors"]))
    (OUT / "global.json").write_text(json.dumps(glob, separators=(",", ":")))
    (OUT / "lores.json").write_text(json.dumps(lores, separators=(",", ":")))
    (OUT / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    (OUT / "tactics.json").write_text(json.dumps(tactics_from_gst(cache), indent=1))
    build_ghb(c)
    print(f"lores: {len(lores)}; written to {OUT}")


BP_MAPS = WARHAMMER / "6nations2026" / ".build" / "printables" / "battleplans.json"


def build_ghb(c):
    """GHB 2026-27: season rules, battleplan rules (corpus) merged with battleplan maps (6 Nations printables)."""
    season = next((x for x in tactics_from_gst(CACHE) if "2026-27" in x["season"]), None)
    core, season_rules, plans = None, None, {}
    for e in c.ents.values():
        if e["kind"] != "content-group" or not c.visible(e):
            continue
        if e["name"] == "The Core Rules" and core is None:
            core = group(c, e)
        elif e["name"] == "Season Rules 2026-27" and season_rules is None:
            season_rules = group(c, e)
    gctx = next(cid for cid in c.allowed if cid.endswith("006"))
    maps = json.loads(BP_MAPS.read_text()) if BP_MAPS.exists() else {}
    for e in c.ents.values():
        if e["kind"] == "content-group" and e.get("groupType") == "general-rules" and e.get("rulesContextIds") == [gctx]:
            g = group(c, e)
            if g and g["abilities"] and e["name"] != "Season Rules 2026-27":
                plans.setdefault(e["name"], g)
    norm = lambda s: re.sub(r"[^a-z]", "", s.lower())
    bps = []
    for name, m in maps.items():
        if name.startswith("_"):
            continue
        g = next((v for k, v in plans.items() if norm(k) == norm(name)), None)
        bps.append({"name": name, "twist": m.get("twist"), "summary": m.get("abilities", []), "scoring": m.get("scoring", []),
                    "map": m.get("g", []), "rules": g["abilities"] if g else []})
    for k, v in plans.items():
        if not any(norm(b["name"]) == norm(k) for b in bps):
            bps.append({"name": k, "rules": v["abilities"], "summary": [], "scoring": [], "map": []})
    out = {"season": "General's Handbook 2026-27", "tactics": season["cards"] if season else [],
           "seasonRules": season_rules["abilities"] if season_rules else [], "battleplans": sorted(bps, key=lambda b: b["name"]),
           "mapLegend": maps.get("_legend", {}), "mapSource": maps.get("_source", ""),
           "coreAbilities": [dict(a, section=g["name"]) for g in (core or {}).get("groups", []) for a in g["abilities"]]}
    (OUT / "ghb.json").write_text(json.dumps(out, indent=1))
    print(f"ghb: {len(out['tactics'])} tactic cards, {len(out['seasonRules'])} season rules, {len(bps)} battleplans, "
          f"{len(out['coreAbilities'])} core abilities")


if __name__ == "__main__":
    main()
