"""Parse an AoS army list (Warhammer AoS app, Sigdex, New Recruit or loose text) against the rules index.

parse(text, rules_dir) -> dict with faction, formation, lores, tactics, regiments[{name, units[]}], unmatched[].
Every unit is matched against the faction's warscroll names, so the parser does not depend on one export format.
"""
import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

ALIAS = {
    "skaventide": "Skaven", "lumineth realm-lords": "Lumineth Realm-lords",
    "court of the godlings": "Disciples of Tzeentch", "legion of the first prince": "Slaves to Darkness",
    "lords of the clan": "Sylvaneth", "new summercourt": "Flesh-eater Courts", "the baleful lords": "Blades of Khorne",
    "taar's grand forgehost": "Helsmiths of Hashut", "the first phalanx of ionrach": "Idoneth Deepkin",
    "the gardeners of nurgle": "Maggotkin of Nurgle", "big waaagh!": "Ironjawz", "big waaagh": "Ironjawz",
    "khorne": "Blades of Khorne", "tzeentch": "Disciples of Tzeentch", "nurgle": "Maggotkin of Nurgle",
    "slaanesh": "Hedonites of Slaanesh", "stormcast": "Stormcast Eternals", "cities": "Cities of Sigmar",
    "fec": "Flesh-eater Courts", "ogors": "Ogor Mawtribes", "obr": "Ossiarch Bonereapers",
    "kharadron": "Kharadron Overlords", "idoneth": "Idoneth Deepkin", "lumineth": "Lumineth Realm-lords",
    "soulblight": "Soulblight Gravelords", "gloomspite": "Gloomspite Gitz", "sons": "Sons of Behemat",
    "helsmiths": "Helsmiths of Hashut", "std": "Slaves to Darkness", "dok": "Daughters of Khaine",
}
SECTION_RE = re.compile(r"^(general'?s regiment|regiment\s*\d*|auxiliary( units)?|regiments? of renown|faction terrain|"
                        r"manifestations?|terrain|endless spells?|hero(es)?|battleline|other)\b", re.I)
POINTS_RE = re.compile(r"[\(\[]\s*(\d{1,4})\s*(?:pts?|points?)?\s*[\)\]]|[-–:]\s*(\d{1,4})\s*(?:pts?|points?)\b|\b(\d{1,4})\s*(?:pts|points)\b", re.I)
BULLET_RE = re.compile(r"^\s*(?:[•·\-\*–>~]|\+|o\s)\s*")


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = s.lower().replace("’", "'").replace("‑", "-")
    s = re.sub(r"[^a-z0-9' ]+", " ", s.replace("-", " "))
    return re.sub(r"\s+", " ", s).strip()


@lru_cache(maxsize=4)
def load_index(rules_dir):
    rd = Path(rules_dir)
    return json.loads((rd / "index.json").read_text())


@lru_cache(maxsize=40)
def load_faction(rules_dir, slug):
    return json.loads((Path(rules_dir) / f"{slug}.json").read_text())


def walk(gs, path=()):
    for g in gs:
        yield g, path
        yield from walk(g.get("groups", []), path + (g["name"],))


def detect_faction(lines, index):
    names = {norm(f["name"]): f for f in index["factions"]}
    aliases = {norm(k): v for k, v in ALIAS.items()}
    for l in lines[:15]:
        n = norm(re.sub(r"\d+\s*/\s*\d+\s*pts?", "", l))
        n = re.sub(r"^(faction|allegiance|army)\s*", "", n)
        if n in names:
            return names[n], None
        if n in aliases:
            fname = aliases[n]
            return names[norm(fname)], l.strip()
    # army of renown lines (e.g. "Thanquol's Mutated Menagerie")
    for l in lines[:15]:
        n = norm(l)
        for f in index["factions"]:
            if any(norm(g) == n for g in f["groups"]):
                return f, None
    # last resort: whichever faction owns most matched unit names
    best, score = None, 0
    blob = "\n".join(norm(l) for l in lines)
    for f in index["factions"]:
        s = sum(1 for u in f["units"] if len(u) > 5 and norm(u) in blob)
        if s > score:
            best, score = f, s
    return best, None


class Matcher:
    def __init__(self, faction):
        self.units = {norm(w["name"]): w for w in faction["warscrolls"]}
        # longest names first so "Stormfiends" doesn't match before "Rat Ogor Stormfiends" etc.
        self.keys = sorted(self.units, key=len, reverse=True)
        self.enh = {}
        self.groups = {}
        for g, path in walk(faction["groups"]):
            self.groups.setdefault(norm(g["name"]), g)
            if g["type"] in ("heroic-trait", "artefact-of-power", "monstrous-traits") or (
                    g["type"] not in ("battle-trait", "battle-formation", "spell-lore", "prayer-lore", "manifestation-lore",
                                      "general-rules", "rules-module", "regiment-of-renown", "army-of-renown", "supplemental-content")):
                for a in g["abilities"]:
                    self.enh.setdefault(norm(a["name"]), (a, g))

    def unit(self, raw):
        n = norm(raw)
        if n in self.units:
            return self.units[n]
        # drop parentheticals, e.g. "Megaboss (Scourge of Aqshy)"
        n2 = norm(re.sub(r"\([^)]*\)", "", raw))
        if n2 in self.units:
            return self.units[n2]
        for k in self.keys:
            if len(k) >= 4 and (n2 == k or n2.startswith(k + " ") or n2.endswith(" " + k)):
                return self.units[k]
        return None

    def enhancement(self, raw):
        n = norm(re.sub(r"\([^)]*\)|[-–]\s*\(?\d+\)?\s*points?", "", raw, flags=re.I))
        hit = self.enh.get(n)
        return hit


@lru_cache(maxsize=4)
def _global(rules_dir):
    index = load_index(rules_dir)
    units, rors = {}, {}
    for f in index["factions"]:
        for u in f["units"]:
            units.setdefault(norm(u), f["slug"])
        fac = load_faction(rules_dir, f["slug"])
        for g, _ in walk(fac["groups"]):
            if g["type"] == "regiment-of-renown":
                rors.setdefault(norm(g["name"]), g["name"])
    return units, rors


def find_ror(index, rules_dir, raw):
    _, rors = _global(str(rules_dir))
    return rors.get(norm(re.sub(r"\([^)]*\)", "", raw)))


def global_unit(index, rules_dir, raw, own_slug):
    units, _ = _global(str(rules_dir))
    for cand in (norm(raw), norm(re.sub(r"\([^)]*\)", "", raw)), norm(re.sub(r"^(sog|soa)\s+", "", raw, flags=re.I))):
        slug = units.get(cand)
        if slug and slug != own_slug:
            fac = load_faction(str(rules_dir), slug)
            for w in fac["warscrolls"]:
                if norm(w["name"]) == cand:
                    return w, fac["name"]
    return None, None


def parse(text, rules_dir):
    text = text.replace("```", "")
    lines = []
    for l in text.splitlines():
        # some exports put the header on one line: "Grand Alliance Order | Lumineth Realm-lords | Warhost of Duality"
        lines += [p.strip() for p in l.split(" | ")] if " | " in l else [l.rstrip()]
    lines = [l for l in lines if l.strip()]
    index = load_index(str(rules_dir))
    fmeta, aor = detect_faction(lines, index)
    if not fmeta:
        return {"error": "Could not work out the faction. Make sure the faction name is in the list."}
    faction = load_faction(str(rules_dir), fmeta["slug"])
    m = Matcher(faction)
    out = {"faction": faction["name"], "slug": faction["slug"], "armyOfRenown": None, "name": "", "points": None,
           "pointsLimit": None, "formation": None, "drops": None, "spellLore": None, "prayerLore": None,
           "manifestationLore": None, "tactics": [], "regiments": [], "terrain": [], "unmatched": [], "general": None}

    head = lines[0]
    pm = re.search(r"(\d{3,4})\s*/\s*(\d{3,4})\s*pts?", head, re.I)
    if pm:
        out["points"], out["pointsLimit"] = int(pm.group(1)), int(pm.group(2))
        out["name"] = head[:pm.start()].strip(" -|")
    else:
        out["name"] = head.strip()

    formations = {norm(g["name"]): g["name"] for g, _ in walk(faction["groups"]) if g["type"] == "battle-formation"}
    aors = {norm(g["name"]): g["name"] for g, _ in walk(faction["groups"]) if g["type"] == "army-of-renown"}

    cur = None
    last_unit = None
    section = "units"
    for raw in lines[1:]:
        l = raw.strip()
        low = l.lower()
        if re.match(r"^(points:\s*)?\d{3,4}\s*/\s*\d{3,4}\s*(pts|points)?$", low) or low.startswith("grand alliance"):
            continue
        if low.startswith(("created with", "app:", "data:", "app version", "server version", "data version", "wounds:", "general's handbook",
                           "pitched battles", "battle regiment")):
            continue
        km = re.match(r"^(spell lore|prayer lore|manifestation lore|lore of manifestations)\s*[-:–]\s*(.+)$", l, re.I)
        if km:
            key = {"spell lore": "spellLore", "prayer lore": "prayerLore"}.get(km.group(1).lower(), "manifestationLore")
            out[key] = re.sub(r"\s*\(\d+.*\)$", "", km.group(2).strip())
            continue
        tm = re.match(r"^battle tactic(?: cards?)?\s*[:\-]\s*(.+)$", l, re.I)
        if tm:
            out["tactics"] = [t.strip() for t in re.split(r",|/|;", tm.group(1)) if t.strip()]
            continue
        dm = re.match(r"^drops?\s*[:\-]\s*(\d+)", l, re.I)
        if dm:
            out["drops"] = int(dm.group(1))
            continue
        nl = norm(re.sub(r"\(\d+\s*(points?|pts)?\)", "", l, flags=re.I))
        if not out["formation"] and nl in formations:
            out["formation"] = formations[nl]
            continue
        if nl in aors:
            out["armyOfRenown"] = aors[nl]
            continue
        if norm(l) == norm(faction["name"]) or (aor and l.strip() == aor):
            continue
        sm = SECTION_RE.match(l)
        if sm and not BULLET_RE.match(raw) and not POINTS_RE.search(l):
            title = l.strip(" :")
            section = "terrain" if "terrain" in low else ("manifestation" if "manifest" in low or "endless" in low else "units")
            cur = {"name": title, "units": []}
            if section == "units":
                out["regiments"].append(cur)
            last_unit = None
            continue

        bullet = bool(BULLET_RE.match(raw))
        body = BULLET_RE.sub("", raw).strip()
        pts = None
        pmm = POINTS_RE.search(body)
        if pmm:
            pts = int(next(g for g in pmm.groups() if g))
        clean = POINTS_RE.sub("", body).strip(" -–:")
        clean = re.sub(r"^\d+\s*x\s*", "", clean, flags=re.I)

        if low.startswith("options:") and last_unit is not None:
            last_unit.setdefault("options", []).append(l.split(":", 1)[1].strip())
            continue
        if bullet and last_unit is not None:
            opt = clean
            lo = opt.lower()
            if lo == "general":
                last_unit["general"] = True
                out["general"] = last_unit["name"]
            elif lo.startswith("reinforced"):
                last_unit["reinforced"] = True
            else:
                e = m.enhancement(opt)
                if e:
                    last_unit.setdefault("enhancements", []).append({"name": e[0]["name"], "group": e[1]["name"], "points": pts})
                else:
                    last_unit.setdefault("options", []).append(opt)
            continue

        if section == "terrain":
            out["terrain"].append({"name": clean, "points": pts})
            continue
        ror = find_ror(index, rules_dir, clean)
        if ror and not bullet:
            out.setdefault("regimentsOfRenown", []).append({"name": ror, "points": pts})
            cur = {"name": ror, "units": [], "renown": True}
            out["regiments"].append(cur)
            last_unit = None
            continue
        w = m.unit(clean)
        ally = None
        if not w:
            w, ally = global_unit(index, rules_dir, clean, faction["slug"])
        if w:
            u = {"name": w["name"], "listed": clean, "points": pts}
            if ally:
                u["faction"] = ally
            if cur is None:
                cur = {"name": "Units", "units": []}
                out["regiments"].append(cur)
            cur["units"].append(u)
            last_unit = u
        elif pts is not None or (cur is not None and not bullet):
            out["unmatched"].append(l)
            last_unit = None
    out["regiments"] = [r for r in out["regiments"] if r["units"]]
    if out["points"] is None:
        out["points"] = sum((u.get("points") or 0) for r in out["regiments"] for u in r["units"]) or None
    return out
