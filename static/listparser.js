/* AoS list parser (browser port of listparser.py; keep the two in step).
   parseList(text, loadJSON) -> parsed list. loadJSON(path) fetches files under data/rules/. */
"use strict";
(function () {
  const ALIAS = {
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
  };
  const SECTION_RE = /^(general'?s regiment|regiment\s*\d*|auxiliary( units)?|regiments? of renown|faction terrain|manifestations?|terrain|endless spells?|hero(es)?|battleline|other)\b/i;
  const POINTS_SRC = String.raw`[\(\[]\s*(\d{1,4})\s*(?:pts?|points?)?\s*[\)\]]|[-–:]\s*(\d{1,4})\s*(?:pts?|points?)\b|\b(\d{1,4})\s*(?:pts|points)\b`;
  const POINTS_RE = new RegExp(POINTS_SRC, "i");
  const POINTS_RE_G = new RegExp(POINTS_SRC, "gi");
  const BULLET_RE = /^\s*(?:[•·\-\*–>~]|\+|o\s)\s*/;
  const ENH_SKIP = new Set(["battle-trait", "battle-formation", "spell-lore", "prayer-lore", "manifestation-lore",
    "general-rules", "rules-module", "regiment-of-renown", "army-of-renown", "supplemental-content"]);

  function norm(s) {
    s = String(s || "").normalize("NFKD").replace(/[^\x00-\x7f’‑]/g, c => c === "’" ? "'" : c === "‑" ? "-" : "");
    s = s.toLowerCase().replace(/-/g, " ").replace(/[^a-z0-9' ]+/g, " ");
    return s.replace(/\s+/g, " ").trim();
  }
  const strip = (s, chars) => { let a = 0, b = s.length; while (a < b && chars.includes(s[a])) a++; while (b > a && chars.includes(s[b - 1])) b--; return s.slice(a, b); };
  function* walk(gs, path = []) { for (const g of gs || []) { yield [g, path]; yield* walk(g.groups, [...path, g.name]); } }

  function detectFaction(lines, index) {
    const names = new Map(index.factions.map(f => [norm(f.name), f]));
    const aliases = new Map(Object.entries(ALIAS).map(([k, v]) => [norm(k), v]));
    for (const l of lines.slice(0, 15)) {
      let n = norm(l.replace(/\d+\s*\/\s*\d+\s*pts?/gi, ""));
      n = n.replace(/^(faction|allegiance|army)\s*/, "");
      if (names.has(n)) return [names.get(n), null];
      if (aliases.has(n)) return [names.get(norm(aliases.get(n))), l.trim()];
    }
    for (const l of lines.slice(0, 15)) {
      const n = norm(l);
      for (const f of index.factions) if (f.groups.some(g => norm(g) === n)) return [f, null];
    }
    let best = null, score = 0;
    const blob = lines.map(norm).join("\n");
    for (const f of index.factions) {
      const s = f.units.filter(u => u.length > 5 && blob.includes(norm(u))).length;
      if (s > score) { best = f; score = s; }
    }
    return [best, null];
  }

  function matcher(faction) {
    const units = new Map(faction.warscrolls.map(w => [norm(w.name), w]));
    const keys = [...units.keys()].sort((a, b) => b.length - a.length);
    const enh = new Map();
    for (const [g] of walk(faction.groups)) {
      if (["heroic-trait", "artefact-of-power", "monstrous-traits"].includes(g.type) || !ENH_SKIP.has(g.type))
        for (const a of g.abilities) if (!enh.has(norm(a.name))) enh.set(norm(a.name), [a, g]);
    }
    return {
      unit(raw) {
        const n = norm(raw);
        if (units.has(n)) return units.get(n);
        const n2 = norm(raw.replace(/\([^)]*\)/g, ""));
        if (units.has(n2)) return units.get(n2);
        for (const k of keys) if (k.length >= 4 && (n2 === k || n2.startsWith(k + " ") || n2.endsWith(" " + k))) return units.get(k);
        return null;
      },
      enhancement(raw) { return enh.get(norm(raw.replace(/\([^)]*\)|[-–]\s*\(?\d+\)?\s*points?/gi, ""))) || null; },
    };
  }

  async function parseList(text, load) {
    text = text.replace(/```/g, "");
    let lines = [];
    for (const l of text.split(/\r?\n/)) lines.push(...(l.includes(" | ") ? l.split(" | ").map(p => p.trim()) : [l.replace(/\s+$/, "")]));
    lines = lines.filter(l => l.trim());
    if (!lines.length) return { error: "Paste a list first" };
    const [index, glob] = await Promise.all([load("index.json"), load("global.json")]);
    const [fmeta, aor] = detectFaction(lines, index);
    if (!fmeta) return { error: "Could not work out the faction. Make sure the faction name is in the list." };
    const faction = await load(`${fmeta.slug}.json`);
    const m = matcher(faction);
    const gUnits = new Map(); for (const [n, s] of glob.units) if (!gUnits.has(norm(n))) gUnits.set(norm(n), s);
    const gRors = new Map(glob.rors.map(n => [norm(n), n]));
    const out = { faction: faction.name, slug: faction.slug, armyOfRenown: null, name: "", points: null, pointsLimit: null, formation: null,
      drops: null, spellLore: null, prayerLore: null, manifestationLore: null, tactics: [], regiments: [], terrain: [], unmatched: [], general: null };

    const head = lines[0];
    const pm = head.match(/(\d{3,4})\s*\/\s*(\d{3,4})\s*pts?/i);
    if (pm) { out.points = +pm[1]; out.pointsLimit = +pm[2]; out.name = strip(head.slice(0, pm.index), " -|"); }
    else out.name = head.trim();

    const formations = new Map(), aors = new Map();
    for (const [g] of walk(faction.groups)) {
      if (g.type === "battle-formation") formations.set(norm(g.name), g.name);
      if (g.type === "army-of-renown") aors.set(norm(g.name), g.name);
    }
    const globalUnit = async raw => {
      for (const cand of [norm(raw), norm(raw.replace(/\([^)]*\)/g, "")), norm(raw.replace(/^(sog|soa)\s+/i, ""))]) {
        const slug = gUnits.get(cand);
        if (slug && slug !== faction.slug) {
          const fac = await load(`${slug}.json`);
          const w = fac.warscrolls.find(x => norm(x.name) === cand);
          if (w) return [w, fac.name];
        }
      }
      return [null, null];
    };

    let cur = null, last = null, section = "units";
    for (const raw of lines.slice(1)) {
      const l = raw.trim(), low = l.toLowerCase();
      if (/^(points:\s*)?\d{3,4}\s*\/\s*\d{3,4}\s*(pts|points)?$/.test(low) || low.startsWith("grand alliance")) continue;
      if (["created with", "app:", "data:", "app version", "server version", "data version", "wounds:", "general's handbook", "pitched battles", "battle regiment"].some(p => low.startsWith(p))) continue;
      const km = l.match(/^(spell lore|prayer lore|manifestation lore|lore of manifestations)\s*[-:–]\s*(.+)$/i);
      if (km) { out[{ "spell lore": "spellLore", "prayer lore": "prayerLore" }[km[1].toLowerCase()] || "manifestationLore"] = km[2].trim().replace(/\s*\(\d+.*\)$/, ""); continue; }
      const tm = l.match(/^battle tactic(?: cards?)?\s*[:\-]\s*(.+)$/i);
      if (tm) { out.tactics = tm[1].split(/,|\/|;/).map(t => t.trim()).filter(Boolean); continue; }
      const dm = l.match(/^drops?\s*[:\-]\s*(\d+)/i);
      if (dm) { out.drops = +dm[1]; continue; }
      const nl = norm(l.replace(/\(\d+\s*(points?|pts)?\)/gi, ""));
      if (!out.formation && formations.has(nl)) { out.formation = formations.get(nl); continue; }
      if (aors.has(nl)) { out.armyOfRenown = aors.get(nl); continue; }
      if (norm(l) === norm(faction.name) || (aor && l === aor)) continue;
      if (SECTION_RE.test(l) && !BULLET_RE.test(raw) && !POINTS_RE.test(l)) {
        section = low.includes("terrain") ? "terrain" : (low.includes("manifest") || low.includes("endless")) ? "manifestation" : "units";
        cur = { name: strip(l, " :"), units: [] };
        if (section === "units") out.regiments.push(cur);
        last = null; continue;
      }
      const bullet = BULLET_RE.test(raw);
      const body = raw.replace(BULLET_RE, "").trim();
      let pts = null;
      const pmm = body.match(POINTS_RE);
      if (pmm) pts = +(pmm[1] || pmm[2] || pmm[3]);
      let clean = strip(body.replace(POINTS_RE_G, "").trim(), " -–:");
      clean = clean.replace(/^\d+\s*x\s*/i, "");

      if (low.startsWith("options:") && last) { (last.options ||= []).push(l.split(":").slice(1).join(":").trim()); continue; }
      if (bullet && last) {
        const lo = clean.toLowerCase();
        if (lo === "general") { last.general = true; out.general = last.name; }
        else if (lo.startsWith("reinforced")) last.reinforced = true;
        else {
          const e = m.enhancement(clean);
          if (e) (last.enhancements ||= []).push({ name: e[0].name, group: e[1].name, points: pts });
          else (last.options ||= []).push(clean);
        }
        continue;
      }
      if (section === "terrain") { out.terrain.push({ name: clean, points: pts }); continue; }
      const ror = gRors.get(norm(clean.replace(/\([^)]*\)/g, "")));
      if (ror && !bullet) {
        (out.regimentsOfRenown ||= []).push({ name: ror, points: pts });
        cur = { name: ror, units: [], renown: true }; out.regiments.push(cur); last = null; continue;
      }
      let w = m.unit(clean), ally = null;
      if (!w) [w, ally] = await globalUnit(clean);
      if (w) {
        const u = { name: w.name, listed: clean, points: pts };
        if (ally) u.faction = ally;
        if (!cur) { cur = { name: "Units", units: [] }; out.regiments.push(cur); }
        cur.units.push(u); last = u;
      } else if (pts !== null || (cur && !bullet)) { out.unmatched.push(l); last = null; }
    }
    out.regiments = out.regiments.filter(r => r.units.length);
    if (out.points === null) out.points = out.regiments.reduce((s, r) => s + r.units.reduce((t, u) => t + (u.points || 0), 0), 0) || null;
    return out;
  }

  window.parseList = parseList;
})();
