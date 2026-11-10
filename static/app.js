/* Battle Companion: mobile AoS list + turn helper. Plain JS, no build step. */
"use strict";

// ------------------------------------------------------------------ helpers
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $("#app");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = s => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9']+/g, " ").trim();
const nice = s => (s && s === s.toUpperCase() && /[A-Z]/.test(s)) ? s.toLowerCase().replace(/(^|[\s\-(“"'])([a-z])/g, (m, a, b) => a + b.toUpperCase()) : (s || "");
const fmt = t => esc(t).replace(/\n/g, "<br>");
const pct = v => v == null ? "–" : `${Math.round(v * 10) / 10}%`;

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}

async function api(path, opts = {}) {
  if (window.bcBackend) {
    try { return await window.bcBackend.api(path, opts); }
    catch (e) { if (e.status === 401 && path !== "login") { state.me = null; go("#/login"); } throw e; }
  }
  const r = await fetch("api/" + path, {
    method: opts.method || "GET", credentials: "same-origin",
    headers: opts.body ? { "Content-Type": "application/json" } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = {};
  try { data = await r.json(); } catch (e) { /* empty */ }
  if (r.status === 401 && path !== "login") { state.me = null; go("#/login"); throw new Error("Not signed in"); }
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

const cache = {};
async function data(path) {
  if (!cache[path]) cache[path] = fetch("data/" + path).then(r => { if (!r.ok) throw new Error("missing " + path); return r.json(); });
  return cache[path];
}
window.bcData = path => data(path);
const stats = {};
async function getStats(slug) {
  if (!stats[slug]) stats[slug] = api("stats/" + slug);
  return stats[slug];
}

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
};

const state = { me: null, list: null, army: null };

// ------------------------------------------------------------------ chrome
function chrome({ title = "Battle Companion", subtitle = "", back = null, tabs = false, tab = null, menu = true }) {
  $("#title").textContent = title;
  $("#subtitle").textContent = subtitle;
  const b = $("#back");
  b.hidden = !back; b.onclick = () => go(back);
  $("#menu-btn").hidden = !menu || !state.me;
  $("#menu-btn").onclick = () => go("#/settings");
  const nav = $("#tabs");
  nav.hidden = !tabs;
  document.body.style.paddingBottom = tabs ? "" : "1rem";
  if (tabs && state.list) {
    $$("a", nav).forEach(a => {
      a.href = `#/list/${state.list.id}/${a.dataset.tab}`;
      a.classList.toggle("on", a.dataset.tab === tab);
    });
  }
}

function go(h) { if (location.hash === h) route(); else location.hash = h; }
window.addEventListener("hashchange", route);

async function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const [view, id, tab] = h.split("/");
  try {
    if (!state.me && view !== "login") {
      try { state.me = await api("me"); } catch (e) { return; }
    }
    window.scrollTo(0, 0);
    if (view === "login") return await viewLogin();
    if (view === "add") return await viewAdd();
    if (view === "settings") return await viewSettings();
    if (view === "rules" ) return await viewRulesGlobal();
    if (view === "list" && id) return await viewList(+id, tab || "play");
    return await viewLists();
  } catch (e) {
    app.innerHTML = `<div class="card"><p class="bad">${esc(e.message)}</p></div>`;
  }
}

// ------------------------------------------------------------------ login
function viewLogin() {
  chrome({ menu: false });
  app.innerHTML = `
  <form class="login card" id="f">
    <img class="logo" src="icon.svg" alt="">
    <h2 style="text-align:center">Sign in</h2>
    <label for="u">Username</label><input id="u" type="text" autocomplete="username" autocapitalize="none" required>
    <label for="p">Password</label><input id="p" type="password" autocomplete="current-password" required>
    <p id="err" class="bad small"></p>
    <button class="btn primary block">Sign in</button>
  </form>`;
  $("#f").onsubmit = async e => {
    e.preventDefault();
    try {
      const r = await api("login", { method: "POST", body: { username: $("#u").value, password: $("#p").value } });
      state.me = r;
      if (r.defaultPassword) toast("You're using the default admin password. Change it in Settings.");
      go("#/lists");
    } catch (err) { $("#err").textContent = err.message; }
  };
}

// ------------------------------------------------------------------ lists
async function viewLists() {
  state.list = null; state.army = null;   // ids can be reused after a delete, so never keep a stale list
  chrome({ title: "My lists", subtitle: state.me ? `Signed in as ${state.me.username}` : "" });
  app.innerHTML = `<p class="muted">Loading…</p>`;
  const lists = await api("lists");
  app.innerHTML = `
    <div class="row spread"><h2 style="margin:0">Army lists</h2><a class="btn primary small" href="#/add">+ Add list</a></div>
    ${lists.length ? lists.map(l => `
      <a class="card list-item" href="#/list/${l.id}/play">
        <div class="name">${esc(l.name)}</div>
        <div class="muted small">${esc(l.faction)}${l.formation ? " · " + esc(l.formation) : ""}${l.points ? " · " + l.points + " pts" : ""}</div>
      </a>`).join("") : `<div class="empty card">No lists yet.<br>Paste one from the Warhammer AoS app, Sigdex or New Recruit.<br><br><a class="btn primary" href="#/add">Add your first list</a></div>`}
    <div class="card tight row spread"><span class="small muted">Core rules, GHB 2026-27 tactics and battleplans</span><a class="btn small" href="#/rules">Rules</a></div>`;
}

function parsedSummary(p) {
  if (p.error) return `<p class="bad">${esc(p.error)}</p>`;
  const lore = [p.spellLore && `Spells: ${p.spellLore}`, p.prayerLore && `Prayers: ${p.prayerLore}`, p.manifestationLore && `Manifestations: ${p.manifestationLore}`].filter(Boolean);
  return `
    <div class="row wrap"><span class="chip accent">${esc(p.faction)}</span>${p.armyOfRenown ? `<span class="chip">${esc(p.armyOfRenown)}</span>` : ""}
      ${p.formation ? `<span class="chip">${esc(p.formation)}</span>` : `<span class="chip warn">no formation found</span>`}
      ${p.points ? `<span class="chip">${p.points}${p.pointsLimit ? "/" + p.pointsLimit : ""} pts</span>` : ""}${p.drops ? `<span class="chip">${p.drops} drops</span>` : ""}</div>
    ${lore.length ? `<p class="small">${lore.map(esc).join(" · ")}</p>` : ""}
    ${p.tactics?.length ? `<p class="small">Battle tactics: ${p.tactics.map(esc).join(", ")}</p>` : `<p class="small warn">No battle tactic cards found</p>`}
    ${p.regiments.map(r => `<h4 style="margin-top:.7rem">${esc(r.name)}</h4>` + r.units.map(u => `
      <div class="small">✓ ${esc(u.name)}${u.general ? " <span class='chip accent'>General</span>" : ""}${u.reinforced ? " <span class='chip'>Reinforced</span>" : ""}${u.faction ? ` <span class='chip'>${esc(u.faction)}</span>` : ""}
      ${(u.enhancements || []).map(e => `<span class="chip">${esc(nice(e.name))}</span>`).join(" ")}
      ${u.points ? `<span class="muted"> ${u.points}</span>` : ""}</div>`).join("")).join("")}
    ${p.terrain?.length ? `<h4 style="margin-top:.7rem">Terrain</h4>` + p.terrain.map(t => `<div class="small">${esc(t.name)}</div>`).join("") : ""}
    ${p.unmatched?.length ? `<div class="warn-box"><b>Not matched to a warscroll</b> (check spelling, or the unit may not be in the current rules data):<br>${p.unmatched.map(esc).join("<br>")}</div>` : ""}`;
}

function viewAdd(existing) {
  chrome({ title: existing ? "Edit list" : "Add list", back: existing ? `#/list/${existing.id}/army` : "#/lists" });
  app.innerHTML = `
    <p class="small muted">In the Warhammer AoS app use <b>Export list → Copy</b>; in Sigdex or New Recruit copy the text export. Paste it below, or use <b>Read from screenshot</b> to turn a picture of the list into text (you can pick several screenshots of a long list).</p>
    <label for="nm">List name (optional)</label><input id="nm" type="text" value="${esc(existing?.name || "")}" placeholder="Taken from the list if blank">
    <div class="row spread" style="margin-top:.9rem"><label for="raw" style="margin:0">List text</label>
      <button class="btn small" id="ocrbtn" type="button">Read from screenshot…</button><input id="ocrfile" type="file" accept="image/*" multiple hidden></div>
    <div id="ocrstate" class="tiny muted"></div>
    <textarea id="raw" placeholder="My list 2000/2000 pts&#10;&#10;Skaven&#10;Warpcog Convocation&#10;…">${esc(existing?.raw || "")}</textarea>
    <div class="row" style="margin-top:.6rem"><button class="btn grow" id="prev">Check list</button><button class="btn primary grow" id="save">Save</button></div>
    <div id="out"></div>`;
  $("#ocrbtn").onclick = () => $("#ocrfile").click();
  $("#ocrfile").onchange = async e => {
    const files = [...e.target.files]; e.target.value = "";
    if (!files.length) return;
    const btn = $("#ocrbtn"), st = $("#ocrstate");
    btn.disabled = true;
    try {
      const text = await ocrImages(files, msg => { st.textContent = msg; });
      if (!text.trim()) throw new Error("No text found in that image");
      const raw = $("#raw");
      raw.value = raw.value.trim() ? `${raw.value.trimEnd()}\n\n${text}` : text;
      st.innerHTML = `Read ${files.length} image${files.length === 1 ? "" : "s"}. <b>Check the text against your list</b>: screenshots read well, photos less so. Fix anything Check list flags.`;
      $("#prev").click();
    } catch (err) { st.innerHTML = `<span class="bad">${esc(err.message || "Couldn't read the image")}</span>`; }
    finally { btn.disabled = false; }
  };
  $("#prev").onclick = async () => {
    try { const p = await api("parse", { method: "POST", body: { raw: $("#raw").value } }); $("#out").innerHTML = `<div class="card">${parsedSummary(p)}</div>`; }
    catch (e) { $("#out").innerHTML = `<p class="bad">${esc(e.message)}</p>`; }
  };
  $("#save").onclick = async () => {
    try {
      const body = { raw: $("#raw").value, name: $("#nm").value };
      const r = existing ? await api(`lists/${existing.id}`, { method: "PUT", body: { ...body, reparse: true } }) : await api("lists", { method: "POST", body });
      toast("Saved"); state.list = null; go(`#/list/${r.id}/army`);
    } catch (e) { toast(e.message); }
  };
}

// ------------------------------------------------------------------ list from a screenshot (OCR in the browser)
// Tesseract.js is only loaded when someone uses it; the first run downloads the English model (~10MB, then cached).
const TESS_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
let tessLoad = null;
const loadTesseract = () => tessLoad || (tessLoad = new Promise((ok, bad) => {
  if (window.Tesseract) return ok(window.Tesseract);
  const sc = document.createElement("script"); sc.src = TESS_URL;
  sc.onload = () => ok(window.Tesseract); sc.onerror = () => { tessLoad = null; bad(new Error("Couldn't load the text reader (are you online?)")); };
  document.head.appendChild(sc);
}));

// Greyscale, scaled up at least 1.5x (Tesseract misreads the app's condensed headings at phone size) and
// dark-mode screenshots flipped to dark text on light. A contrast boost made the headings worse, so there isn't one.
async function ocrPrep(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(3, Math.max(1.5, 1300 / bmp.width));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(bmp, 0, 0, c.width, c.height);
  const im = g.getImageData(0, 0, c.width, c.height), d = im.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114;
  const dark = sum / (d.length / 4) < 128;   // dark-mode screenshot: flip to dark text on light
  for (let i = 0; i < d.length; i += 4) {
    let y = d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114;
    if (dark) y = 255 - y;
    d[i] = d[i + 1] = d[i + 2] = y;
  }
  g.putImageData(im, 0, 0);
  return c;
}

async function ocrImages(files, progress) {
  progress("Loading the text reader…");
  const T = await loadTesseract();
  let cur = 0;
  const worker = await T.createWorker("eng", 1, {
    logger: m => {
      if (m.status === "recognizing text") progress(`Reading image ${cur + 1} of ${files.length}… ${Math.round(m.progress * 100)}%`);
      else if (/loading|initializ/.test(m.status)) progress(`Getting the text reader ready… ${Math.round((m.progress || 0) * 100)}% (first time only)`);
    },
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: "4" });   // one column of text in mixed sizes: what a list looks like
    const out = [];
    for (cur = 0; cur < files.length; cur++) {
      const { data } = await worker.recognize(await ocrPrep(files[cur]));
      out.push(cleanOcr(data.text));
    }
    return out.filter(Boolean).join("\n\n");
  } finally { await worker.terminate(); }
}

// Tidy what OCR gives back so the list parser can read it.
function cleanOcr(t) {
  let lines = t.replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"').replace(/[—–]/g, "-").split(/\r?\n/).map(l => l.replace(/\s+/g, " ").trim());
  lines = lines.map(l => l
    .replace(/^(?:[e«»*°¢©®•·o]|\.|-)\s+(?=[A-Z(])/, "• ")              // bullets read as e, «, * …
    .replace(/\(\s*([0-9OoIlSB]{2,4})\s*(points?|pts?)\s*[)}\]]?/gi, (m, n, w) => `(${n.replace(/[Oo]/g, "0").replace(/[Il]/g, "1").replace(/S/g, "5").replace(/B/g, "8")} ${w})`)
    .replace(/(\d)[,.](\d{3})(?!\d)/g, "$1$2"))                                     // 2,000/2,000pts -> 2000/2000pts
    .filter(l => l && !/^[-_=~.\s|]+$/.test(l) && !/^(created with|app:|data:)/i.test(l));
  // join lines the screenshot wrapped: a line ending in a comma, or a short lowercase-led continuation
  const out = [];
  for (const l of lines) {
    const prev = out[out.length - 1];
    if (prev && (/,$/.test(prev) || /^battle tactics? cards?:/i.test(prev) && !/:\s*$/.test(prev) && /^[A-Z][a-z]+$/.test(l))) out[out.length - 1] = `${prev} ${l}`;
    else out.push(l);
  }
  // a list name that wrapped onto a second all-caps line ("MY LIST 2000/2000pts" + "NAME") goes back on the first line
  if (out.length > 1 && /\d+\s*\/\s*\d+\s*pts/i.test(out[0]) && /^[A-Z0-9' &!-]{3,}$/.test(out[1]) && !/^(GENERAL|REGIMENT|FACTION|AUXILIARY|MANIFESTATION)/.test(out[1]))
    out.splice(0, 2, out[0].replace(/\s*(\d+\s*\/\s*\d+\s*pts)/i, ` ${out[1]} $1`));
  return out.join("\n");
}

// ------------------------------------------------------------------ army assembly
function* walk(groups, path = []) {
  for (const g of groups || []) { yield [g, path]; yield* walk(g.groups, [...path, g]); }
}

const PHASES = ["start-of-turn", "hero", "movement", "shooting", "charge", "combat", "end-of-turn"];
const PHASE_NAME = { "start-of-turn": "Start of turn", hero: "Hero", movement: "Movement", shooting: "Shooting", charge: "Charge", combat: "Combat", "end-of-turn": "End of turn", "battle-round-start": "Start of round", deployment: "Deployment" };
const PHASE_SHORT = { "start-of-turn": "Start", hero: "Hero", movement: "Move", shooting: "Shoot", charge: "Charge", combat: "Combat", "end-of-turn": "End" };

function triggerPhases(a) {
  const t = (a.extra?.reactionTrigger || a.timing || "").toUpperCase();
  const out = new Set();
  if (/SPELL|PRAYER|CHANT|BANISH|UNBIND/.test(t)) out.add("hero");
  if (/\bRUN\b|\bMOVE\b|RETREAT|REDEPLOY/.test(t)) out.add("movement");
  if (/SHOOT/.test(t)) out.add("shooting");
  if (/CHARGE/.test(t)) out.add("charge");
  if (/FIGHT/.test(t)) out.add("combat");
  if (/ATTACK/.test(t)) { out.add("shooting"); out.add("combat"); }
  if (/COMMAND/.test(t) && !out.size) PHASES.forEach(p => out.add(p));
  return out;
}

function tag(a, src, srcType, extra = {}) { return { ...a, name: nice(a.name), src: nice(src), srcType, key: `${srcType}|${src}|${a.name}`, ...extra }; }

async function buildArmy(list) {
  const p = list.parsed;
  const [fac, lores, ghb, core] = await Promise.all([data(`rules/${p.slug}.json`), data("rules/lores.json"), data("rules/ghb.json"), data("core.json").catch(() => ({}))]);
  const groups = [...walk(fac.groups)];
  const top = groups.filter(([g, path]) => !path.length);
  const aor = p.armyOfRenown ? groups.find(([g]) => g.type === "army-of-renown" && g.name === p.armyOfRenown)?.[0] : null;
  const scope = aor ? [...walk(aor.groups)] : top;
  const abilities = [];
  const armyRules = [];
  const seen = new Set();
  const add = a => { if (!seen.has(a.key)) { seen.add(a.key); abilities.push(a); } };

  // battle traits
  for (const [g] of scope.filter(([g]) => g.type === "battle-trait")) {
    armyRules.push({ title: "Battle traits", sub: g.name === "Battle Traits" ? "" : g.name, abilities: g.abilities.map(a => tag(a, "Battle trait", "army")) });
    g.abilities.forEach(a => add(tag(a, "Battle trait", "army")));
  }
  // formation
  const form = p.formation && groups.find(([g]) => g.type === "battle-formation" && norm(g.name) === norm(p.formation))?.[0];
  if (form) { armyRules.push({ title: "Battle formation", sub: form.name, abilities: form.abilities.map(a => tag(a, form.name, "army")) }); form.abilities.forEach(a => add(tag(a, form.name, "army"))); }

  // units (merge duplicates)
  const unitMap = new Map();
  const otherFactions = {};
  for (const r of p.regiments) for (const u of r.units) {
    let w = fac.warscrolls.find(x => x.name === u.name);
    if (!w && u.faction) {
      const slug = u.faction.toLowerCase().replace(/'/g, "").replace(/[^a-z0-9]+/g, "-");
      otherFactions[slug] = otherFactions[slug] || await data(`rules/${slug}.json`).catch(() => null);
      w = otherFactions[slug]?.warscrolls.find(x => x.name === u.name);
    }
    if (!w) continue;
    if (!unitMap.has(w.name)) unitMap.set(w.name, { w, entries: [], regiment: r.name });
    unitMap.get(w.name).entries.push(u);
  }
  const units = [...unitMap.values()];
  for (const un of units) {
    const label = un.w.name + (un.entries.length > 1 ? ` ×${un.entries.length}` : "");
    un.w.abilities.forEach(a => add(tag(a, label, "unit", { unit: un.w.name })));
    for (const e of un.entries) for (const en of e.enhancements || []) {
      const hit = groups.find(([g]) => g.name === en.group)?.[0]?.abilities.find(a => a.name === en.name);
      if (hit) add(tag(hit, `${nice(en.group)} · ${un.w.name}`, "enhancement", { unit: un.w.name }));
    }
  }
  const enh = abilities.filter(a => a.srcType === "enhancement");
  if (enh.length) armyRules.push({ title: "Enhancements", sub: "", abilities: enh });

  // lores
  const findLore = name => name && (lores[name] || groups.find(([g]) => norm(g.name) === norm(name))?.[0]);
  const manifestations = [];
  for (const [key, label, type] of [["spellLore", "Spell lore", "spell"], ["prayerLore", "Prayer lore", "prayer"], ["manifestationLore", "Manifestation lore", "manifestation"]]) {
    const lore = findLore(p[key]);
    if (!lore) continue;
    const abs = lore.abilities.map(a => tag(a, lore.name, type));
    abs.forEach(add);
    armyRules.push({ title: label, sub: lore.name, abilities: abs });
    if (type === "manifestation") {
      for (const a of lore.abilities) {
        const nm = norm(a.name.replace(/^summon\s+/i, ""));
        const mw = fac.warscrolls.find(w => w.manifestation && norm(w.name) === nm);
        if (mw) { manifestations.push(mw); mw.abilities.forEach(x => add(tag(x, mw.name, "manifestation", { unit: mw.name }))); }
      }
    }
  }
  // faction terrain
  const terrain = [];
  for (const t of p.terrain || []) {
    const tw = fac.warscrolls.find(w => norm(w.name) === norm(t.name.replace(/\(.*\)/, "")));
    if (tw) { terrain.push(tw); tw.abilities.forEach(x => add(tag(x, tw.name, "terrain", { unit: tw.name }))); }
  }
  // core + season
  (ghb.coreAbilities || []).forEach(a => add(tag(a, "Core rules", "core")));
  (core.extraAbilities || []).forEach(a => add(tag(a, "Core rules", "core")));
  (ghb.seasonRules || []).forEach(a => add(tag(a, "Season rules 2026-27", "season")));

  // drop priest/wizard-only core rules the army can't use
  const hasKw = re => units.some(u => u.w.keywords.some(k => re.test(k)));
  const canPray = hasKw(/^PRIEST/), canCast = hasKw(/^WIZARD/);
  for (let i = abilities.length - 1; i >= 0; i--) {
    const a = abilities[i];
    if (a.srcType !== "core") continue;
    if (/sacred rites/i.test(a.name) && !canPray) abilities.splice(i, 1);
    else if (/^(unbind)$/i.test(a.name) && !canCast) abilities.splice(i, 1);
    else if (/magical intervention|banish manifestation/i.test(a.name) && !canPray && !canCast) abilities.splice(i, 1);
  }
  const tactics = (p.tactics || []).map(n => (ghb.tactics || []).find(c => norm(c.name) === norm(n)) || { name: n, tiers: [], card: "", missing: true });
  const wizards = units.filter(u => u.w.keywords.some(k => /^WIZARD/.test(k)));
  const priests = units.filter(u => u.w.keywords.some(k => /^PRIEST/.test(k)));
  return { fac, ghb, core, units, abilities, armyRules, manifestations, terrain, tactics, wizards, priests, form };
}

// ------------------------------------------------------------------ ability rendering
function abilityHTML(a, opts = {}) {
  const used = opts.game && opts.game.used[a.key];
  const once = /\/battle/.test(a.usage || "");
  const cls = a.kind === "reaction" ? "reaction" : a.kind === "passive" ? "passive" : "active";
  const chips = [];
  if (a.cost) chips.push(`<span class="chip ${/command/i.test(a.cost) ? "cp" : "accent"}">${esc(a.cost.replace(/Command-Points (\d+)/, "$1 CP").replace(/^Spell (\d+)/, "Cast $1+").replace(/^Prayer (\d+)/, "Chant $1+").replace(/-/g, " "))}</span>`);
  if (a.usage) chips.push(`<span class="chip">${esc(a.usage.replace("1/turn", "Once per turn").replace("1/battle-round", "Once per round").replace("1/battle", "Once per battle").replace("1/phase", "Once per phase"))}</span>`);
  return `<div class="ab ${cls} ${used ? "used" : ""}" data-key="${esc(a.key)}">
    <div class="ab-head"><span class="ab-name">${esc(a.name)}</span>${chips.join("")}
      ${opts.game && once ? `<button class="btn small use" data-use="${esc(a.key)}">${used ? "Used ✓" : "Mark used"}</button>` : ""}</div>
    <div class="ab-src">${esc(a.src)}${opts.timing !== false && a.timing ? " · " + esc(a.timing) : ""}</div>
    <div class="ab-body">
      ${a.declare ? `<div><b>Declare:</b> ${fmt(a.declare)}</div>` : ""}
      ${a.effect ? `<div><b>Effect:</b> ${fmt(a.effect)}</div>` : ""}
      ${a.setup ? `<div><b>Set-up:</b> ${fmt(a.setup)}</div>` : ""}
      ${a.description ? `<div>${fmt(a.description)}</div>` : ""}
      ${a.keywords?.length ? `<div class="kw">${a.keywords.map(esc).join(" · ")}</div>` : ""}
    </div></div>`;
}

function warscrollHTML(w, entries = []) {
  const st = w.stats || {};
  const order = ["move", "health", "save", "control", "banishment", "ward"];
  const keys = [...order.filter(k => st[k] != null), ...Object.keys(st).filter(k => !order.includes(k))];
  const weapons = w.weapons || [];
  const wt = (title, ws) => ws.length ? `<div class="table-wrap"><table><thead><tr><th>${title}</th><th class="num">Rng</th><th class="num">A</th><th class="num">Hit</th><th class="num">Wnd</th><th class="num">Rnd</th><th class="num">Dmg</th></tr></thead><tbody>
    ${ws.map(x => `<tr><td>${esc(x.name)}${x.abilities?.length ? `<div class="kw">${x.abilities.map(esc).join(", ")}</div>` : ""}</td><td class="num">${esc(x.range || "–")}</td><td class="num">${esc(x.a)}</td><td class="num">${esc(x.hit)}</td><td class="num">${esc(x.wound)}</td><td class="num">${esc(x.rend)}</td><td class="num">${esc(x.dmg)}</td></tr>`).join("")}</tbody></table></div>` : "";
  const extras = entries.map(e => [e.general && "General", e.reinforced && "Reinforced", ...(e.enhancements || []).map(x => nice(x.name)), ...(e.options || [])].filter(Boolean)).filter(x => x.length);
  return `<div class="ws-stats">${keys.map(k => `<div><small>${esc(k)}</small><b>${esc(st[k])}</b></div>`).join("")}</div>
    ${w.points ? `<p class="small muted">${w.points} pts · unit size ${esc(w.unitSize ?? "?")}${w.regimentOptions?.length ? " · Regiment: " + esc(w.regimentOptions.join("; ")) : ""}</p>` : ""}
    ${extras.length ? `<p class="small">${extras.map(x => x.map(esc).join(", ")).join(" | ")}</p>` : ""}
    ${wt("Ranged", weapons.filter(x => /ranged/i.test(x.type)))}${wt("Melee", weapons.filter(x => !/ranged/i.test(x.type)))}
    ${w.abilities.map(a => abilityHTML(tag(a, w.name, "unit"))).join("")}
    <div class="kw">${esc((w.keywords || []).join(" · "))}</div>`;
}

// ------------------------------------------------------------------ list view + tabs
async function viewList(id, tab) {
  if (!state.list || state.list.id !== id) {
    app.innerHTML = `<p class="muted">Loading list…</p>`;
    state.list = await api(`lists/${id}`);
    state.army = null;
  }
  const list = state.list;
  chrome({ title: list.name, subtitle: `${list.faction}${list.formation ? " · " + list.formation : ""}`, back: "#/lists", tabs: true, tab });
  if (!state.army) state.army = await buildArmy(list);
  const army = state.army;
  if (tab === "army") return viewArmy(list, army);
  if (tab === "stats") return viewStats(list, army);
  if (tab === "rules") return viewRules(army.ghb, army.core, army);
  if (tab === "deploy") return viewDeploy(list, army);
  return viewPlay(list, army);
}

function viewArmy(list, army) {
  const p = list.parsed;
  app.innerHTML = `
    <div class="card">${parsedSummary(p)}
      <div class="row" style="margin-top:.6rem"><button class="btn small" id="edit">Edit list</button><button class="btn small danger" id="del">Delete</button></div></div>
    <h2>Army rules</h2>
    ${army.armyRules.map(r => `<details class="card"><summary>${esc(r.title)}${r.sub ? ` <span class="muted small">· ${esc(r.sub)}</span>` : ""}</summary>${r.abilities.map(a => abilityHTML(a)).join("")}</details>`).join("")}
    <h2>Units</h2>
    ${army.units.map(u => `<details class="card"><summary><span class="grow">${esc(u.w.name)}${u.entries.length > 1 ? ` ×${u.entries.length}` : ""}</span>
        <span class="chip">${esc(u.w.stats.move || "")} · ${esc(u.w.stats.health || "")}W · ${esc(u.w.stats.save || "")}</span></summary>${warscrollHTML(u.w, u.entries)}</details>`).join("")}
    ${army.manifestations.length ? `<h2>Manifestations</h2>` + army.manifestations.map(w => `<details class="card"><summary>${esc(w.name)}</summary>${warscrollHTML(w)}</details>`).join("") : ""}
    ${army.terrain.length ? `<h2>Faction terrain</h2>` + army.terrain.map(w => `<details class="card"><summary>${esc(w.name)}</summary>${warscrollHTML(w)}</details>`).join("") : ""}
    <h2>Battle tactic cards</h2>
    ${army.tactics.map(c => tacticHTML(c)).join("") || `<p class="muted">None in the list.</p>`}
    <p class="tiny muted">Rules data: AoS Reminders corpus (generated ${esc((army.fac.generated || "").slice(0, 10))}) + BSData (Sigdex). Check FAQs for anything newer.</p>`;
  $("#edit").onclick = () => viewAdd(list);
  $("#del").onclick = async () => {
    if (!confirm(`Delete "${list.name}"? This can't be undone.`)) return;
    await api(`lists/${list.id}`, { method: "DELETE" }); store.del(`bc-game-${list.id}`); state.list = null; toast("Deleted"); go("#/lists");
  };
}

function tacticHTML(c, game) {
  if (c.missing) return `<div class="card"><b>${esc(c.name)}</b> <span class="chip warn">not a GHB 2026-27 card</span></div>`;
  return `<div class="card"><h3>${esc(c.name)}</h3>${c.card ? `<p class="small">${fmt(c.card)}</p>` : ""}
    ${c.tiers.map(t => {
      const k = `tac|${c.name}|${t.tier}`;
      return `<div class="ab active"><div class="ab-head"><span class="chip accent">${esc(t.tier)}</span><span class="ab-name">${esc(t.name)}</span>
        ${game ? `<button class="btn small use" data-tac="${esc(k)}">${game.tactics[k] ? "Done ✓ R" + game.tactics[k] : "Completed?"}</button>` : ""}</div>
        <div class="ab-body">${fmt(t.text)}</div></div>`;
    }).join("")}</div>`;
}

// ------------------------------------------------------------------ scoring popup (tap the VP number)
// Battle tactics are worth 5 VP each; ticking one adds them and unticking takes them off again.
const TAC_VP = 5;
function toggleTactic(game, k, r) {
  if (game.tactics[k]) { delete game.tactics[k]; game.vp.me = Math.max(0, game.vp.me - TAC_VP); }
  else { game.tactics[k] = r; game.vp.me += TAC_VP; }
}
// The tier to show for a card in round r: the one completed in r (so it can be unticked), else the next one to do.
function tierFor(game, c, r) {
  const key = t => `tac|${c.name}|${t.tier}`;
  return c.tiers.find(t => game.tactics[key(t)] === r) || c.tiers.find(t => !game.tactics[key(t)]) || null;
}
// "Round 1 only" / "Round 2 onwards" scoring lines only count in those rounds
const scoreApplies = (txt, r) => !(/^round 1 only/i.test(txt) && r !== 1) && !(/^round 2 onwards/i.test(txt) && r < 2);

// remind: opened by Next at the end of a turn; "Continue" runs next(), closing stays on the step
function scoreSheet({ game, army, bp, side, round, save, done, remind, next }) {
  game.scored = game.scored || { me: {}, opp: {} };
  game.scored[side] = game.scored[side] || {};
  let r = round;
  const bg = document.createElement("div");
  bg.className = "sheet-bg";
  document.body.appendChild(bg);
  document.body.classList.add("dep-lock");
  const onKey = e => { if (e.key === "Escape") close(); };
  function close(go) { bg.parentNode?.removeChild(bg); document.body.classList.remove("dep-lock"); document.removeEventListener("keydown", onKey); (go && next ? next : done)(); }
  document.addEventListener("keydown", onKey);
  const row = (attrs, on, vp, body, off) => `<button class="score-row${on ? " on" : ""}" ${attrs} ${off ? "disabled" : ""} aria-pressed="${on}"><span class="sc-vp">${vp} VP</span><span class="sc-txt">${body}</span><span class="sc-tick">${on ? "✓" : ""}</span></button>`;
  function paint() {
    const got = game.scored[side][r] || [];
    const vp = side === "me" ? game.vp.me : game.vp.opp;
    const prim = bp?.scoring?.length ? bp.scoring.map((x, i) => row(`data-pri="${i}"`, got.includes(i), x[0], esc(x[1]), !scoreApplies(x[1], r) && !got.includes(i))).join("")
      : `<p class="small muted">Pick the battleplan in Set-up to see its scoring.</p>`;
    let tac = "";
    if (side === "me") {
      tac = army.tactics.map(c => {
        if (c.missing) return `<div class="small warn">${esc(c.name)}: not a GHB 2026-27 card</div>`;
        const t = tierFor(game, c, r), k = t && `tac|${c.name}|${t.tier}`;
        const prev = c.tiers.filter(x => game.tactics[`tac|${c.name}|${x.tier}`] && x !== t).map(x => `${x.tier} (R${game.tactics[`tac|${c.name}|${x.tier}`]})`);
        return `<div class="sc-card"><div class="tiny muted"><b>${esc(c.name)}</b>${prev.length ? ` · done: ${prev.join(", ")}` : ""}</div>
          ${t ? row(`data-stac="${esc(k)}"`, !!game.tactics[k], TAC_VP, `<b>${esc(t.tier)}: ${esc(t.name)}</b><span class="small">${fmt(t.text)}</span>`) : `<p class="small good">All three tactics on this card are done.</p>`}</div>`;
      }).join("") || `<p class="small muted">No battle tactic cards in this list.</p>`;
    }
    bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="Scoring">
      ${remind ? `<div class="warn-box" style="margin-top:0"><b>End of ${side === "me" ? "your" : "your opponent's"} turn:</b> enter ${side === "me" ? "your" : "their"} round ${round} scores before moving on.</div>` : ""}
      <div class="row spread"><h3 style="margin:0">${side === "me" ? "Your" : "Opponent's"} scoring</h3><button class="icon-btn" data-x aria-label="Close">✕</button></div>
      <div class="row spread sc-sub"><div class="seg"><button data-rd="-1" aria-label="Previous round" ${r <= 1 ? "disabled" : ""}>‹</button><button class="on" tabindex="-1">Round ${r}</button><button data-rd="1" aria-label="Next round" ${r >= 5 ? "disabled" : ""}>›</button></div>
        <span>${side === "me" ? "You" : "Opponent"}: <b>${vp} VP</b></span></div>
      <h4>${bp ? esc(bp.name) : "Battleplan"}: end of turn</h4>${prim}
      ${side === "me" ? `<h4>Battle tactics</h4>${tac}<p class="tiny muted">One tactic per card each turn, in order: Affray, then Strike, then Domination. Once one is done, the next one shows from the next round.</p>`
        : `<h4>Battle tactics completed this round</h4><div class="seg">${[0, 1, 2].map(n => `<button data-otac="${n}" class="${(game.oppTac?.[r] || 0) === n ? "on" : ""}">${n}</button>`).join("")}</div><span class="small muted"> × ${TAC_VP} VP</span>`}
      <p class="tiny muted">Ticking adds the VP and unticking takes it off. Use + and − for anything else.</p>
      ${remind ? `<button class="btn primary block" data-go>Scores entered, continue ›</button>` : ""}
    </div>`;
  }
  bg.addEventListener("click", e => {
    if (e.target.closest("[data-go]")) return close(true);
    if (e.target === bg || e.target.closest("[data-x]")) return close();
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    if (b.dataset.rd) { r = Math.min(5, Math.max(1, r + +b.dataset.rd)); paint(); return; }
    if (b.dataset.pri != null) {
      const i = +b.dataset.pri, pts = parseInt(bp.scoring[i][0], 10) || 0, got = game.scored[side][r] = game.scored[side][r] || [];
      const on = got.includes(i), d = on ? -pts : pts;
      game.scored[side][r] = on ? got.filter(x => x !== i) : [...got, i];
      if (side === "me") game.vp.me = Math.max(0, game.vp.me + d); else game.vp.opp = Math.max(0, game.vp.opp + d);
    }
    if (b.dataset.stac) toggleTactic(game, b.dataset.stac, r);
    if (b.dataset.otac != null) {
      game.oppTac = game.oppTac || {};
      const was = game.oppTac[r] || 0, n = +b.dataset.otac;
      game.oppTac[r] = n; game.vp.opp = Math.max(0, game.vp.opp + (n - was) * TAC_VP);
    }
    save(); paint();
    $$(".trk-open").forEach(x => { x.textContent = x.dataset.score === "me" ? game.vp.me : game.vp.opp; });
  });
  paint();
  $("[data-x]", bg).focus();
}

// ------------------------------------------------------------------ end of game: summary, image, results kept on the device
// Share sheet on phones (save to Photos), a download elsewhere.
async function saveBlob(blob, fname, title) {
  fname = fname.replace(/[\\/:*?"<>|]+/g, "");
  const file = new File([blob], fname, { type: blob.type });
  if (coarse && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = fname;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast("Image saved");
}

const WHO = { me: "You", opp: "Opp" };
function gameSummary(game, army, bp) {
  const pri = (side, r) => (game.scored?.[side]?.[r] || []).reduce((s, i) => s + (parseInt(bp?.scoring?.[i]?.[0], 10) || 0), 0);
  const tierName = (card, tier) => army.tactics.find(c => c.name === card)?.tiers.find(t => t.tier === tier)?.name || "";
  const rounds = [1, 2, 3, 4, 5].map(r => {
    const tacs = Object.entries(game.tactics).filter(([, v]) => v === r).map(([k]) => { const [, card, tier] = k.split("|"); return { card, tier, name: tierName(card, tier) }; });
    const me = { pri: pri("me", r), tac: tacs.length * TAC_VP, tacs };
    const opp = { pri: pri("opp", r), tac: (game.oppTac?.[r] || 0) * TAC_VP };
    me.total = me.pri + me.tac; opp.total = opp.pri + opp.tac;
    return { r, prio: game.prio?.[r] || null, first: game.first[r] || null, me, opp };
  });
  const tot = side => {
    const p = rounds.reduce((s, x) => s + x[side].pri, 0), t = rounds.reduce((s, x) => s + x[side].tac, 0), total = side === "me" ? game.vp.me : game.vp.opp;
    return { pri: p, tac: t, other: total - p - t, total };
  };
  const me = tot("me"), opp = tot("opp");
  return { rounds, me, opp, result: me.total > opp.total ? "Win" : me.total < opp.total ? "Loss" : "Draw" };
}

// one record per game, upserted while the game-end step is open (a database copy comes later)
function storeResult(game, list, bp, sum) {
  const all = store.get("bc-results", []);
  const rec = {
    id: game.id, listId: list.id, list: list.name, faction: list.faction, battleplan: bp?.name || "", role: game.role || "",
    date: new Date().toISOString(), me: sum.me, opp: sum.opp, result: sum.result,
    rounds: sum.rounds.map(x => ({ r: x.r, prio: x.prio, first: x.first, me: { pri: x.me.pri, tac: x.me.tac, tacs: x.me.tacs }, opp: x.opp })),
  };
  const i = all.findIndex(x => x.id === rec.id);
  if (i >= 0) { rec.date = all[i].date; all[i] = rec; } else all.unshift(rec);
  store.set("bc-results", all.slice(0, 200));
  return all.filter(x => x.listId === list.id);
}

function summaryHTML(sum, game, bp) {
  const cell = v => `<td class="num">${v || "–"}</td>`;
  const rows = sum.rounds.map(x => `<tr><td><b>R${x.r}</b></td><td>${x.prio ? WHO[x.prio] : "–"}</td><td>${x.first ? WHO[x.first] : "–"}</td>
    ${cell(x.me.pri)}${cell(x.me.tac)}<td class="num"><b>${x.me.total}</b></td>${cell(x.opp.pri)}${cell(x.opp.tac)}<td class="num"><b>${x.opp.total}</b></td></tr>`).join("");
  const other = sum.me.other || sum.opp.other ? `<tr class="muted"><td colspan="3">Other (+ / −)</td><td colspan="2"></td><td class="num">${sum.me.other}</td><td colspan="2"></td><td class="num">${sum.opp.other}</td></tr>` : "";
  const tacs = sum.rounds.flatMap(x => x.me.tacs.map(t => `<li>R${x.r}: <b>${esc(t.card)}</b>, ${esc(t.tier)}${t.name ? `: ${esc(t.name)}` : ""}</li>`)).join("");
  return `<div class="card">
      <div class="row spread"><div><div class="small muted">${esc(bp?.name || "Battleplan not set")}${game.role ? ` · ${game.role === "attacker" ? "Attacker" : "Defender"}` : ""}</div>
        <div class="final">You <b>${sum.me.total}</b> – <b>${sum.opp.total}</b> Opponent</div></div>
        <span class="chip ${sum.result === "Win" ? "good" : sum.result === "Loss" ? "bad" : ""}">${sum.result}</span></div>
      <div class="sum-wrap"><table class="sum">
        <thead><tr><th></th><th>Priority</th><th>First</th><th class="num grp" colspan="3">You</th><th class="num grp" colspan="3">Opponent</th></tr>
          <tr><th></th><th></th><th></th><th class="num">Pri</th><th class="num">Tac</th><th class="num">Rd</th><th class="num">Pri</th><th class="num">Tac</th><th class="num">Rd</th></tr></thead>
        <tbody>${rows}${other}<tr class="sum-tot"><td colspan="3"><b>Total</b></td><td class="num">${sum.me.pri}</td><td class="num">${sum.me.tac}</td><td class="num"><b>${sum.me.total}</b></td><td class="num">${sum.opp.pri}</td><td class="num">${sum.opp.tac}</td><td class="num"><b>${sum.opp.total}</b></td></tr></tbody>
      </table></div>
      <p class="tiny muted">Pri = battleplan scoring, Tac = battle tactics (5 VP each). Priority and first turn come from each round's start step; scores from the VP popups.</p>
      ${tacs ? `<h4>Your battle tactics</h4><ul class="small sum-tacs">${tacs}</ul>` : ""}
    </div>`;
}

// the summary drawn straight onto a canvas, so it saves as a clean PNG
async function summaryImage(sum, game, list, bp) {
  const cs = getComputedStyle(document.body), root = getComputedStyle(document.documentElement);
  const C = { bg: cs.backgroundColor, ink: cs.color, muted: root.getPropertyValue("--muted").trim() || "#999", line: root.getPropertyValue("--line").trim() || "#444",
    good: root.getPropertyValue("--good").trim(), bad: root.getPropertyValue("--bad").trim(), card: root.getPropertyValue("--surface").trim() || cs.backgroundColor };
  const font = cs.fontFamily, W = 1080, pad = 48, rowH = 58;
  const tacLines = sum.rounds.flatMap(x => x.me.tacs.map(t => `R${x.r}  ${t.card}, ${t.tier}${t.name ? `: ${t.name}` : ""}`));
  const hasOther = sum.me.other || sum.opp.other;
  const H = pad + 150 + rowH * (2 + 5 + 1 + (hasOther ? 1 : 0)) + 40 + (tacLines.length ? 50 + tacLines.length * 36 : 0) + pad;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  g.textBaseline = "middle";
  let y = pad;
  g.fillStyle = C.ink; g.font = `800 40px ${font}`; g.fillText(list.name, pad, y + 20);
  g.fillStyle = C.muted; g.font = `400 26px ${font}`;
  g.fillText([list.faction, bp?.name, game.role && (game.role === "attacker" ? "Attacker" : "Defender"), new Date().toLocaleDateString()].filter(Boolean).join("  ·  "), pad, y + 66);
  g.fillStyle = C.ink; g.font = `800 46px ${font}`; g.fillText(`You ${sum.me.total} – ${sum.opp.total} Opponent`, pad, y + 120);
  g.fillStyle = sum.result === "Win" ? C.good : sum.result === "Loss" ? C.bad : C.muted; g.font = `800 40px ${font}`;
  g.textAlign = "right"; g.fillText(sum.result.toUpperCase(), W - pad, y + 120); g.textAlign = "left";
  y += 160;
  // columns: round, priority, first, you pri/tac/rd, opp pri/tac/rd
  const xs = [pad, pad + 90, pad + 230, 470, 570, 670, 800, 900, 1000];
  const text = (t, i, yy, f, col, al = i >= 3 ? "center" : "left") => { g.font = f; g.fillStyle = col; g.textAlign = al; g.fillText(String(t), i >= 3 ? xs[i] : xs[i], yy); g.textAlign = "left"; };
  const hr = yy => { g.strokeStyle = C.line; g.lineWidth = 2; g.beginPath(); g.moveTo(pad, yy); g.lineTo(W - pad, yy); g.stroke(); };
  const hf = `700 22px ${font}`, bf = `400 28px ${font}`, bb = `800 28px ${font}`;
  g.fillStyle = C.muted; g.font = hf; g.textAlign = "center"; g.fillText("YOU", xs[4], y + rowH / 2); g.fillText("OPPONENT", xs[7], y + rowH / 2); g.textAlign = "left";
  y += rowH;
  ["", "PRIORITY", "FIRST", "PRI", "TAC", "RD", "PRI", "TAC", "RD"].forEach((h, i) => text(h, i, y + rowH / 2, hf, C.muted));
  y += rowH; hr(y);
  for (const x of sum.rounds) {
    const v = n => n || "–";
    [`R${x.r}`, x.prio ? WHO[x.prio] : "–", x.first ? WHO[x.first] : "–", v(x.me.pri), v(x.me.tac), x.me.total, v(x.opp.pri), v(x.opp.tac), x.opp.total]
      .forEach((t, i) => text(t, i, y + rowH / 2, i === 0 || i === 5 || i === 8 ? bb : bf, i === 0 || i === 5 || i === 8 ? C.ink : (t === "–" ? C.muted : C.ink)));
    y += rowH; hr(y);
  }
  if (hasOther) { text("Other (+ / −)", 0, y + rowH / 2, bf, C.muted); text(sum.me.other, 5, y + rowH / 2, bf, C.muted); text(sum.opp.other, 8, y + rowH / 2, bf, C.muted); y += rowH; hr(y); }
  ["TOTAL", "", "", sum.me.pri, sum.me.tac, sum.me.total, sum.opp.pri, sum.opp.tac, sum.opp.total].forEach((t, i) => text(t, i, y + rowH / 2, bb, C.ink));
  y += rowH + 40;
  if (tacLines.length) {
    g.fillStyle = C.muted; g.font = hf; g.fillText("YOUR BATTLE TACTICS", pad, y); y += 44;
    g.fillStyle = C.ink; g.font = `400 26px ${font}`;
    for (const l of tacLines) { g.fillText(l, pad, y); y += 36; }
  }
  const blob = await new Promise(ok => c.toBlob(ok, "image/png"));
  await saveBlob(blob, `${list.name} - ${bp?.name || "game"} - ${sum.me.total}-${sum.opp.total}.png`, "Game result");
}

// ------------------------------------------------------------------ play (phase navigator)
function newGame() {
  return { step: 0, first: {}, cp: 0, vp: { me: 0, opp: 0 }, fury: 0, rage: 0, battleplan: "", role: "", checks: {}, used: {}, tactics: {}, side: "me", scored: { me: {}, opp: {} }, prio: {}, oppTac: {}, id: `g${Date.now()}` };
}

function stepsFor(game) {
  const s = [{ kind: "pre", id: "setup", label: "Set-up" }, { kind: "pre", id: "deploy", label: "Deploy" }];
  for (let r = 1; r <= 5; r++) {
    s.push({ kind: "round", r, label: `Round ${r}` });
    for (const t of [0, 1]) for (const ph of PHASES) s.push({ kind: "turn", r, t, phase: ph });
  }
  s.push({ kind: "end", label: "Game end" });
  return s;
}
const sideOf = (game, st) => { const f = game.first[st.r] || "me"; return st.t === 0 ? f : (f === "me" ? "opp" : "me"); };

function relevant(a, side, phase) {
  if (a.kind === "passive") return false;
  if (a.when === "reaction" || a.kind === "reaction") {
    if (!triggerPhases(a).has(phase)) return false;
    const t = (a.extra?.reactionTrigger || a.timing || "");
    if (/^.*You declared/i.test(t)) return side === "me";
    if (/Opponent declared/i.test(t)) return side === "opp";
    return true;
  }
  if (a.when !== phase) return false;
  if (a.who === "your") return side === "me";
  if (a.who === "enemy") return side === "opp";
  return true;
}

const PASSIVE_HINT = {
  hero: /hero phase|casting|chant|spell|prayer|unbind/i, movement: /movement phase|\bmove\b|\brun\b|retreat|set up/i,
  shooting: /shoot|ranged/i, charge: /charg/i, combat: /combat|fight|melee|pile/i, "end-of-turn": /end of (the|any|your|each) turn|control score|objective/i, "start-of-turn": /start of (the|any|your) turn/i,
};

function groupAbilities(list) {
  const order = ["core", "season", "army", "enhancement", "unit", "spell", "prayer", "manifestation", "terrain"];
  const label = { core: "Core rules", season: "Season rules", army: "Army rules", enhancement: "Enhancements", unit: "Units", spell: "Spells", prayer: "Prayers", manifestation: "Manifestations", terrain: "Faction terrain" };
  return order.map(k => [label[k], list.filter(a => a.srcType === k)]).filter(([, l]) => l.length);
}

function checklist(items, game, prefix) {
  return items.map((it, i) => {
    const k = `${prefix}|${i}`;
    const done = !!game.checks[k];
    return `<label class="check ${done ? "done" : ""}"><input type="checkbox" data-check="${esc(k)}" ${done ? "checked" : ""}><span>${it}</span></label>`;
  }).join("");
}

function mapShapes(bp) {
  return (bp?.map || []).map(g => {
    if (g[0] === "r") return `<rect x="${g[1]}" y="${g[2]}" width="${g[3]}" height="${g[4]}" class="${g[5]}"/>`;
    if (g[0] === "c") return `<circle cx="${g[1]}" cy="${g[2]}" r="${g[3]}" class="${g[4]}"/>`;
    if (g[0] === "t") return `<text x="${g[1]}" y="${g[2]}" class="${g[4]}">${esc(g[3])}</text>`;
    return "";
  }).join("");
}

function bpMap(bp, legend) {
  if (!bp?.map?.length) return "";
  const shapes = mapShapes(bp);
  const objs = [...new Set(bp.map.filter(g => g[0] === "c" && /objective-/.test(g[4])).map(g => g[4].split("objective-")[1]))];
  const col = { golden_lions: "#e0b450", sun_seekers: "#e07a3c", sigmarite: "#8fb3d9", heldenhain: "#9fc98a" };
  return `<svg class="bp-map" viewBox="0 0 480 352" role="img" aria-label="${esc(bp.name)} map: 60 by 44 inch board">${shapes}</svg>
    <div class="legend">${objs.map(o => `<span><i style="background:${col[o] || "#999"}"></i>${esc((legend[o] || [o, o])[1])}</span>`).join("")}
    <span>○ ruin</span><span>┄ obscuring</span><span style="color:var(--accent)">○ place of power</span><span>60″ × 44″</span></div>`;
}

function battleplanHTML(bp, legend, statsRow) {
  if (!bp) return "";
  return `<div class="card"><div class="row spread"><h3 style="margin:0">${esc(bp.name)}</h3>${statsRow ? `<span class="chip">${pct(statsRow.winRate)} · ${statsRow.games} games</span>` : ""}</div>
    ${bpMap(bp, legend)}
    ${bp.twist ? `<p class="small"><b>Twist:</b> ${esc(bp.twist)}</p>` : ""}
    ${bp.scoring?.length ? `<h4>Scoring</h4><table><tbody>${bp.scoring.map(s => `<tr><td class="num" style="width:3rem"><b>${esc(s[0])} VP</b></td><td>${esc(s[1])}</td></tr>`).join("")}</tbody></table>` : ""}
    ${bp.rules?.map(a => abilityHTML(tag(a, bp.name, "battleplan"))).join("") || ""}
    ${bp.summary?.length && !bp.rules?.length ? bp.summary.map(s => `<p class="small"><b>${esc(s.name)}</b> (${esc(s.who)}, ${esc(s.when)}): ${esc(s.effect)}</p>`).join("") : ""}
  </div>`;
}

async function viewPlay(list, army) {
  const key = `bc-game-${list.id}`;
  const game = Object.assign(newGame(), store.get(key, {}));
  const steps = stepsFor(game);
  const save = () => store.set(key, game);
  if (!game.id) { game.id = `g${Date.now()}`; save(); }   // games started before results were kept
  const core = army.core || {};
  const st = steps[Math.min(game.step, steps.length - 1)];
  const facStats = await getStats(list.slug).catch(() => ({}));
  const bp = army.ghb.battleplans.find(b => b.name === game.battleplan);
  const bpAbilities = (bp?.rules || []).map(a => tag(a, bp.name, "battleplan"));
  const all = [...army.abilities, ...bpAbilities];

  // stepper (current round only, plus set-up)
  const visible = steps.map((s, i) => [s, i]).filter(([s]) => st.kind === "pre" ? s.kind === "pre" || (s.kind === "round" && s.r === 1) : (s.r === st.r || (s.kind === "round" && s.r === st.r + 1) || (st.kind === "end" && s.kind === "end")));
  const chip = (s, i) => {
    let lbl = s.label;
    if (s.kind === "turn") lbl = `${sideOf(game, s) === "me" ? "You" : "Opp"} · ${PHASE_SHORT[s.phase]}`;
    return `<button data-step="${i}" class="${i === game.step ? "on" : i < game.step ? "done" : ""}">${esc(lbl)}</button>`;
  };

  let head = "", body = "", sum = null;
  if (st.kind === "pre" && st.id === "setup") {
    head = `<div class="phase-head"><h2>Before the battle</h2></div>`;
    const bpStats = r => (facStats.battleplans || []).find(x => norm(x.name) === norm(r));
    body = `
      <div class="card"><label for="bp">Battleplan</label>
        <select id="bp"><option value="">Pick the battleplan…</option>${army.ghb.battleplans.map(b => `<option ${b.name === game.battleplan ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select>
        <label>You are the…</label><div class="seg" id="role">${["attacker", "defender"].map(r => `<button data-role="${r}" class="${game.role === r ? "on" : ""}">${r[0].toUpperCase() + r.slice(1)}</button>`).join("")}</div>
      </div>
      ${battleplanHTML(bp, army.ghb.mapLegend || {}, bp && bpStats(bp.name))}
      ${bp?.map?.length ? `<a class="btn small block" id="practise" href="#/list/${list.id}/deploy">Practise deployment on ${esc(bp.name)} ›</a>` : ""}
      <div class="card"><h3>Set-up checklist</h3>${checklist(core.pregame || [], game, "pre")}</div>
      <h3>Your battle tactic cards</h3>
      ${army.tactics.map(c => tacticHTML(c)).join("")}`;
  } else if (st.kind === "pre") {
    head = `<div class="phase-head"><h2>Deployment</h2></div>`;
    const dep = all.filter(a => a.when === "deployment");
    body = `<div class="card">${checklist(core.deployment || [], game, "dep")}</div>
      ${groupAbilities(dep).map(([l, as]) => `<h4>${esc(l)}</h4>` + as.map(a => abilityHTML(a, { game })).join("")).join("") || `<p class="muted">No deployment abilities in this list.</p>`}
      ${army.tactics.filter(c => c.card).map(c => `<div class="card tight"><b>${esc(c.name)}</b>: <span class="small">${fmt(c.card)}</span></div>`).join("")}`;
  } else if (st.kind === "round") {
    head = `<div class="phase-head"><h2>Start of battle round ${st.r}</h2></div>`;
    const ra = all.filter(a => a.when === "battle-round-start" && (!a.round || a.round === st.r));
    body = `<div class="card"><label>Who had priority this round?</label>
        <div class="seg"><button data-prio="me" class="${game.prio?.[st.r] === "me" ? "on" : ""}">Me</button><button data-prio="opp" class="${game.prio?.[st.r] === "opp" ? "on" : ""}">Opponent</button></div>
        <label>Who takes the first turn this round?</label>
        <div class="seg" id="first"><button data-first="me" class="${game.first[st.r] === "me" ? "on" : ""}">Me</button><button data-first="opp" class="${game.first[st.r] === "opp" ? "on" : ""}">Opponent</button></div>
        <hr>${checklist(core.roundStart || [], game, `r${st.r}`)}</div>
      ${groupAbilities(ra).map(([l, as]) => `<h4>${esc(l)}</h4>` + as.map(a => abilityHTML(a, { game })).join("")).join("")}`;
  } else if (st.kind === "turn") {
    const side = sideOf(game, st);
    const ph = (core.phases || []).find(p => p.id === st.phase) || { steps: [] };
    const now = all.filter(a => relevant(a, side, st.phase));
    const active = now.filter(a => a.kind !== "reaction" && !/command/i.test(a.cost || ""));
    const commands = now.filter(a => a.kind !== "reaction" && /command/i.test(a.cost || ""));
    const reactions = now.filter(a => a.kind === "reaction");
    const passives = all.filter(a => a.kind === "passive" && ["army", "unit", "enhancement", "manifestation", "terrain", "battleplan"].includes(a.srcType) && PASSIVE_HINT[st.phase]?.test(`${a.effect || ""} ${a.declare || ""}`));
    head = `<div class="phase-head"><span class="turn-badge ${side}">${side === "me" ? "YOUR TURN" : "OPPONENT'S TURN"}</span><h2>${esc(PHASE_NAME[st.phase])}</h2><span class="muted small">Round ${st.r}</span></div>`;
    const steps2 = (side === "me" ? ph.steps : (ph.oppSteps || ph.steps)) || [];
    body = `
      ${steps2.length ? `<div class="card"><h4>${side === "me" ? "Do this, in order" : "What happens"}</h4>${checklist(steps2, game, `r${st.r}t${st.t}${st.phase}`)}</div>` : ""}
      ${st.phase === "start-of-turn" && side === "me" ? `<h3>Battle tactics</h3>${army.tactics.map(c => tacticHTML(c, game)).join("")}` : ""}
      ${st.phase === "end-of-turn" && side === "me" ? `<h3>Battle tactics: did you complete one?</h3>${army.tactics.map(c => tacticHTML(c, game)).join("")}` : ""}
      ${st.phase === "end-of-turn" && bp ? `<details class="card"><summary>Scoring: ${esc(bp.name)}</summary>${(bp.scoring || []).map(s => `<p class="small"><b>${esc(s[0])} VP</b> ${esc(s[1])}</p>`).join("")}</details>` : ""}
      <h3>${side === "me" ? "You can use now" : "You can use in their turn"} <span class="muted small">(${active.length})</span></h3>
      ${groupAbilities(active).map(([l, as]) => `<h4>${esc(l)}</h4>` + as.map(a => abilityHTML(a, { game })).join("")).join("") || `<p class="muted small">Nothing for this phase.</p>`}
      ${commands.length ? `<details class="card" ${side === "me" ? "open" : ""}><summary>Commands (${commands.length}) <span class="chip cp">${game.cp} CP left</span></summary>${commands.map(a => abilityHTML(a, { game })).join("")}</details>` : ""}
      ${reactions.length ? `<details class="card"><summary>Reactions (${reactions.length})</summary>${reactions.map(a => abilityHTML(a, { game })).join("")}</details>` : ""}
      ${passives.length ? `<details class="card"><summary>Passives to remember (${passives.length})</summary>${passives.map(a => abilityHTML(a, { game, timing: false })).join("")}</details>` : ""}`;
  } else {
    head = `<div class="phase-head"><h2>Game over</h2></div>`;
    sum = gameSummary(game, army, bp);
    const past = storeResult(game, list, bp, sum).filter(x => x.id !== game.id);
    body = `${summaryHTML(sum, game, bp)}
      <button class="btn primary block" id="sumimg">Save image</button>
      <p class="tiny muted" style="margin:.4rem 0 1rem">This result is saved on this device.</p>
      ${past.length ? `<details class="card"><summary>Earlier games with this list (${past.length})</summary><table><tbody>${past.map(x => `<tr><td>${esc(new Date(x.date).toLocaleDateString())}</td><td>${esc(x.battleplan || "–")}</td><td class="num">${x.me.total}–${x.opp.total}</td><td><span class="chip ${x.result === "Win" ? "good" : x.result === "Loss" ? "bad" : ""}">${x.result}</span></td></tr>`).join("")}</tbody></table></details>` : ""}
      <button class="btn danger block" id="reset">Start a new game</button>`;
  }

  app.innerHTML = `
    <div class="trackers">
      ${[["cp", "CP"], ["vpme", "VP you"], ["vpopp", "VP opp"], ["fury", "Fury"]].map(([k, l]) => `<div class="trk"><div class="lbl">${l}</div><div class="val"><button data-trk="${k}" data-d="-1" aria-label="${l} minus">−</button>${k === "vpme" || k === "vpopp" ? `<b class="trk-open" role="button" tabindex="0" data-score="${k === "vpme" ? "me" : "opp"}" aria-label="${l}: open scoring">${k === "vpme" ? game.vp.me : game.vp.opp}</b>` : `<b>${k === "cp" ? game.cp : game.fury}</b>`}<button data-trk="${k}" data-d="1" aria-label="${l} plus">+</button></div></div>`).join("")}
    </div>
    <div class="stepper" id="stepper">${visible.map(([s, i]) => chip(s, i)).join("")}</div>
    ${head}${body}
    <div class="navbar"><button class="btn" id="prev" ${game.step === 0 ? "disabled" : ""}>‹ Back</button><button class="btn primary" id="next" ${game.step >= steps.length - 1 ? "disabled" : ""}>Next ›</button></div>
    <p class="tiny muted" style="margin-top:1rem">Game progress is saved on this device. <a href="#" id="newgame">Reset game</a></p>`;

  const rerender = () => { save(); viewPlay(list, army); };
  const onStep = i => { game.step = i; rerender(); window.scrollTo(0, 0); };
  $("#stepper .on")?.scrollIntoView({ inline: "center", block: "nearest" });
  $$("[data-step]").forEach(b => b.onclick = () => onStep(+b.dataset.step));
  $("#prev").onclick = () => onStep(Math.max(0, game.step - 1));
  $("#next").onclick = () => {
    if (st.kind === "round" && !game.first[st.r]) { toast("Pick who goes first this round"); return; }
    const go = () => onStep(Math.min(steps.length - 1, game.step + 1));
    const tk = st.kind === "turn" && st.phase === "end-of-turn" && `r${st.r}t${st.t}`;
    if (tk && !(game.reminded || {})[tk]) {   // leaving a player's turn: prompt for that player's scores first (once per turn)
      game.reminded = { ...(game.reminded || {}), [tk]: true }; save();
      scoreSheet({ game, army, bp, side: sideOf(game, st), round: st.r, save, done: rerender, remind: true, next: go });
      return;
    }
    go();
  };
  $$("[data-trk]").forEach(b => b.onclick = () => {
    const d = +b.dataset.d, k = b.dataset.trk;
    if (k === "cp") game.cp = Math.max(0, game.cp + d);
    if (k === "vpme") game.vp.me = Math.max(0, game.vp.me + d);
    if (k === "vpopp") game.vp.opp = Math.max(0, game.vp.opp + d);
    if (k === "fury") game.fury = Math.min(7, Math.max(0, game.fury + d));
    rerender();
  });
  $$("[data-check]").forEach(c => c.onchange = () => { game.checks[c.dataset.check] = c.checked; c.closest(".check").classList.toggle("done", c.checked); save(); });
  $$("[data-use]").forEach(b => b.onclick = () => { const k = b.dataset.use; game.used[k] = !game.used[k]; rerender(); });
  $$("[data-tac]").forEach(b => b.onclick = () => { toggleTactic(game, b.dataset.tac, st.r || 1); rerender(); });
  $$("[data-score]").forEach(b => {
    const open = () => scoreSheet({ game, army, bp, side: b.dataset.score, round: st.r || (st.kind === "end" ? 5 : 1), save, done: rerender });
    b.onclick = open; b.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } };
  });
  $$("[data-first]").forEach(b => b.onclick = () => { game.first[st.r] = b.dataset.first; rerender(); });
  $$("[data-prio]").forEach(b => b.onclick = () => { game.prio = { ...(game.prio || {}), [st.r]: b.dataset.prio }; rerender(); });
  $$("[data-role]").forEach(b => b.onclick = () => { game.role = b.dataset.role; rerender(); });
  const sel = $("#bp"); if (sel) sel.onchange = () => { game.battleplan = sel.value; rerender(); };
  const pr = $("#practise"); if (pr) pr.onclick = () => store.set(`bc-deploy-bp-${list.id}`, game.battleplan);
  const reset = () => { if (confirm("Reset this game's progress, scores and ticks?")) { store.del(key); viewPlay(list, army); } };
  $("#newgame").onclick = e => { e.preventDefault(); reset(); };
  if ($("#reset")) $("#reset").onclick = reset;
  if ($("#sumimg")) $("#sumimg").onclick = () => summaryImage(sum, game, list, bp).catch(e => toast(e.message));
}

// ------------------------------------------------------------------ deploy (deployment practice)
// Board is drawn in inches: viewBox 0 0 60 44. Map data is 8 px per inch, so it sits in a scale(1/8) group.
// Layout = { side: "attacker"|"defender", units: { uid: { n: unit name, m: [[x, y, angle], …] } } }, one entry per model.
const BW = 60, BH = 44, MM_IN = 25.4;
const TERR_DEF = [6, 4];   // inches: marker for faction terrain whose size isn't in the rules data
const radOf = b => b.rect ? Math.hypot(b.w, b.h) / 2 : Math.max(b.w, b.h) / 2;
const DEP_COLORS = ["#e0675f", "#6aa8e8", "#5fbf7f", "#e0b450", "#b07ae0", "#4fc1c1", "#e07ab8", "#a3c25a", "#e09a4f", "#8c94e8", "#c9a27e", "#7ec99f"];
const r2 = v => Math.round(v * 100) / 100;
const coarse = matchMedia("(pointer: coarse)").matches;   // phone or tablet: real full screen instead of a popup
let depExitFull = null;   // set while the deploy board is full screen
const depFsChange = () => { if (!(document.fullscreenElement || document.webkitFullscreenElement) && depExitFull) depExitFull(); };
document.addEventListener("fullscreenchange", depFsChange);
document.addEventListener("webkitfullscreenchange", depFsChange);
document.addEventListener("keydown", e => { if (e.key === "Escape" && depExitFull) depExitFull(); });
window.addEventListener("hashchange", () => { document.body.classList.remove("dep-lock"); depExitFull = null; document.body.appendChild($("#toast")); });
const mmTxt = b => `${+b[0].toFixed(1)}${b[0] !== b[1] ? "×" + +b[1].toFixed(1) : ""}mm`;

// Models for one list entry. Base data is [[width_mm, depth_mm, count|null], …] from build_rules.py.
function modelBases(w, n, reinforced) {
  let b = w.bases, guessed = false;
  if (!b?.length) {
    guessed = true;
    const kw = (w.keywords || []).join(" ");
    b = [/MONSTER/.test(kw) ? [100, 100, null] : /CAVALRY/.test(kw) ? [60, 35, null] : /HERO/.test(kw) ? [40, 40, null] : [32, 32, null]];
  }
  const mult = reinforced ? 2 : 1;
  const sum = b.reduce((s, x) => s + (x[2] || 0), 0);
  let out = [];
  if (b.every(x => x[2]) && sum * mult === n) b.forEach(x => { for (let i = 0; i < x[2] * mult; i++) out.push(x); });
  else {
    // champions / odd models once each, then fill with the uncounted (or most common) base
    const bulk = b.reduce((a, x) => (x[2] ?? Infinity) > (a[2] ?? Infinity) ? x : a);
    b.filter(x => x !== bulk).forEach(x => { for (let i = 0; i < (x[2] || 1) && out.length < n - 1; i++) out.push(x); });
    while (out.length < n) out.push(bulk);
  }
  out = out.slice(0, n);
  const kinds = [...new Set(out.map(mmTxt))];
  const label = kinds.length === 1 ? kinds[0] : kinds.map(k => `${out.filter(x => mmTxt(x) === k).length}× ${k}`).join(" + ");
  return { models: out.map(x => ({ w: x[0] / MM_IN, h: x[1] / MM_IN })), guessed, label };
}

async function deployUnits(list, army) {
  const other = {}, units = [];
  for (const [ri, r] of (list.parsed.regiments || []).entries()) for (const [ui, u] of r.units.entries()) {
    let w = army.fac.warscrolls.find(x => x.name === u.name);
    if (!w && u.faction) {
      const slug = u.faction.toLowerCase().replace(/'/g, "").replace(/[^a-z0-9]+/g, "-");
      other[slug] = other[slug] || await data(`rules/${slug}.json`).catch(() => null);
      w = other[slug]?.warscrolls.find(x => x.name === u.name);
    }
    const base = { uid: `${ri}.${ui}`, regiment: r.name, name: u.name, general: !!u.general, reinforced: !!u.reinforced };
    if (!w) { units.push({ ...base, missing: true, models: [], n: 0 }); continue; }
    const per = w.unitSize || null;
    const n = (per || 1) * (u.reinforced ? 2 : 1);
    units.push({ ...base, w, n, sizeMissing: !per, ...modelBases(w, n, u.reinforced) });
  }
  // short codes (initials) for the tokens, numbered when repeated; one colour per unit
  const code = nm => {
    const words = nm.replace(/[^A-Za-z\s-]/g, "").split(/[\s-]+/).filter(x => x && !/^(of|the|and|with|on|a)$/i.test(x));
    return (words.length === 1 ? words[0].slice(0, 2) : words.slice(-3).map(x => x[0]).join("")).toUpperCase();
  };
  // faction terrain from the list: base from the battle profile when there is one, else a default marker
  for (const [ti, t] of (list.parsed.terrain || []).entries()) {
    const w = army.fac.warscrolls.find(x => x.name.toLowerCase() === String(t.name).toLowerCase());
    const b = w?.bases?.[0];
    units.push({ uid: `t${ti}`, regiment: "Faction terrain", name: w?.name || t.name, terrain: true, w, n: 1,
      models: [b ? { w: b[0] / MM_IN, h: b[1] / MM_IN } : { w: TERR_DEF[0], h: TERR_DEF[1], rect: true }],
      label: b ? mmTxt(b) : `${TERR_DEF[0]}″ × ${TERR_DEF[1]}″ marker`, defaultSize: !b });
  }
  units.forEach(u => { u.code = code(u.name); });
  // different units with the same initials get the next letter of their last word (Blood Sisters BSi, Blood Stalkers BSt)
  const clash = units.filter(u => units.some(x => x.code === u.code && x.name !== u.name));
  clash.forEach(u => { u.code = u.code.slice(0, 2) + (u.name.split(/[\s-]+/).pop()[1] || ""); });
  const counts = {};
  units.forEach(u => { counts[u.code] = (counts[u.code] || 0) + 1; });
  const seen = {};
  units.forEach((u, i) => { if (counts[u.code] > 1) u.code += (seen[u.code] = (seen[u.code] || 0) + 1); u.color = u.terrain ? "#9b8862" : DEP_COLORS[i % DEP_COLORS.length]; });
  return units;
}

function zonesOf(bp) {
  const z = { attacker: [], defender: [] };
  for (const g of bp?.map || []) {
    if (g[0] !== "r") continue;
    const s = /zone-attacker/.test(g[5]) ? "attacker" : /zone-defender/.test(g[5]) ? "defender" : null;
    if (s) z[s].push({ x: g[1] / 8, y: g[2] / 8, w: g[3] / 8, h: g[4] / 8 });
  }
  return z;
}

function rimPts(x, y, a, b) {
  const out = [], rx = b.w / 2, ry = b.h / 2, t = a * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  const add = (px, py) => out.push([x + px * c - py * s, y + px * s + py * c]);
  if (b.rect) { for (let k = 0; k <= 8; k++) { const f = k / 8; add(-rx + 2 * rx * f, -ry); add(-rx + 2 * rx * f, ry); add(-rx, -ry + 2 * ry * f); add(rx, -ry + 2 * ry * f); } }
  else for (let k = 0; k < 24; k++) { const q = k * Math.PI / 12; add(rx * Math.cos(q), ry * Math.sin(q)); }
  return out;
}
const inRect = (p, r) => p[0] >= r.x - 1e-6 && p[0] <= r.x + r.w + 1e-6 && p[1] >= r.y - 1e-6 && p[1] <= r.y + r.h + 1e-6;
const rectDist = (p, r) => Math.hypot(Math.max(r.x - p[0], 0, p[0] - r.x - r.w), Math.max(r.y - p[1], 0, p[1] - r.y - r.h));
// wholly within friendly territory and more than 9" from enemy territory
// faction terrain: wholly within friendly territory and more than 3" from objectives and the battleplan's terrain
const OBJ_R = 20 / MM_IN;
function terrainOkAt(x, y, a, b, mine, bp) {
  const circ = (bp?.map || []).filter(g => g[0] === "c").map(g => ({ x: g[1] / 8, y: g[2] / 8, r: /objective/.test(g[4]) ? OBJ_R : g[3] / 8 }));
  return rimPts(x, y, a, b).every(p => mine.some(r => inRect(p, r)) && circ.every(o => Math.hypot(p[0] - o.x, p[1] - o.y) > o.r + 3));
}
const legalAt = (x, y, a, b, mine, enemy) => rimPts(x, y, a, b).every(p => mine.some(r => inRect(p, r)) && enemy.every(r => rectDist(p, r) > 9));
function radiusToward(b, a, dir) { const phi = dir - a * Math.PI / 180, A = b.w / 2, B = b.h / 2; return A * B / Math.hypot(B * Math.cos(phi), A * Math.sin(phi)); }
function edgeGap(p, bp, q, bq) {
  const d = Math.hypot(q[0] - p[0], q[1] - p[1]), dir = Math.atan2(q[1] - p[1], q[0] - p[0]);
  return d - radiusToward(bp, p[2], dir) - radiusToward(bq, q[2], dir + Math.PI);
}
// coherency: every model within ½" of another and the unit is one group
function coherent(pos, models) {
  if (pos.length < 2) return true;
  const seen = new Set([0]), stack = [0];
  while (stack.length) {
    const i = stack.pop();
    for (let j = 0; j < pos.length; j++) if (!seen.has(j) && edgeGap(pos[i], models[i], pos[j], models[j]) <= 0.5 + 1e-3) { seen.add(j); stack.push(j); }
  }
  return seen.size === pos.length;
}

// rows of models, 0.3" apart (inside ½" coherency), centred on 0,0
function clusterOffsets(models) {
  const n = models.length, rows = Math.max(1, Math.round(Math.sqrt(n / 2.5))), cols = Math.ceil(n / rows), gap = 0.3;
  const rowH = Math.max(...models.map(m => m.h)) + gap, out = [];
  for (let r = 0; r < rows; r++) {
    const row = models.slice(r * cols, (r + 1) * cols);
    const total = row.reduce((s, m) => s + m.w, 0) + gap * (row.length - 1);
    let x = -total / 2;
    row.forEach(m => { out.push([x + m.w / 2, (r - (rows - 1) / 2) * rowH]); x += m.w + gap; });
  }
  return out;
}

async function viewDeploy(list, army) {
  document.body.classList.remove("dep-lock"); depExitFull = null;
  const bps = (army.ghb.battleplans || []).filter(b => b.map?.length);
  if (!bps.length) { app.innerHTML = `<div class="card empty">No battleplan maps in the rules data.</div>`; return; }
  const game = store.get(`bc-game-${list.id}`, {});
  let bpName = store.get(`bc-deploy-bp-${list.id}`, "") || game.battleplan || "";
  if (!bps.some(b => b.name === bpName)) bpName = bps[0].name;
  const bp = bps.find(b => b.name === bpName);
  const zones = zonesOf(bp);
  const units = await deployUnits(list, army);
  const byId = Object.fromEntries(units.map(u => [u.uid, u]));
  const draftKey = `bc-deploy-${list.id}-${bpName}`;
  const draft = store.get(draftKey, null);
  let templates = [];
  try { templates = (await api(`lists/${list.id}/layouts`)).filter(t => t.battleplan === bpName); } catch (e) { toast(e.message); }
  const D = {
    layout: draft?.layout || { side: game.role || "attacker", units: {} }, tplId: draft?.tplId || null, hist: [],
    sel: null, selModel: null, mode: store.get("bc-deploy-mode", "unit"), ring: store.get("bc-deploy-ring", 0), nd: store.get("bc-deploy-nd", true),
    view: { x: 0, y: 0, w: BW },
  };
  if (D.tplId && !templates.some(t => t.id === D.tplId)) D.tplId = null;
  const clean = layout => {   // drop placements that no longer match the list (edited list, changed model count)
    const dropped = [];
    for (const [uid, v] of Object.entries(layout.units || {})) {
      const u = byId[uid];
      if (!u || u.name !== v.n || v.m.length !== u.n) { delete layout.units[uid]; dropped.push(v.n); }
    }
    if (dropped.length) toast(`Removed from the table (list changed): ${dropped.join(", ")}`);
    return layout;
  };
  clean(D.layout);

  const grid = [...Array(9).keys()].map(i => `<line x1="${(i + 1) * 6}" y1="0" x2="${(i + 1) * 6}" y2="${BH}"/>`).join("")
    + [...Array(7).keys()].map(i => `<line x1="0" y1="${(i + 1) * 6}" x2="${BW}" y2="${(i + 1) * 6}"/>`).join("");
  const regs = [...new Set(units.map(u => u.regiment))];
  const tplOptions = () => `<option value="">Scratch layout (not saved)</option>` + templates.map(t => `<option value="${t.id}" ${t.id === D.tplId ? "selected" : ""}>${esc(t.name)}</option>`).join("");
  const problems = units.filter(u => u.missing || u.sizeMissing || u.guessed || u.defaultSize);

  app.innerHTML = `<div id="dep">
    <div class="dep-top">
      <div class="row dep-bar">
        <select id="dbp" aria-label="Battleplan">${bps.map(b => `<option ${b.name === bpName ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select>
        <div class="seg" id="dside">${["attacker", "defender"].map(s => `<button data-side="${s}">${s === "attacker" ? "Attacker" : "Defender"}</button>`).join("")}</div>
      </div>
      <div class="dep-wrap">
        <svg id="dboard" class="bp-map dep-board" viewBox="0 0 ${BW} ${BH}" role="img" aria-label="${esc(bpName)} deployment map, 60 by 44 inches">
          <defs><pattern id="dhatch" patternUnits="userSpaceOnUse" width="1" height="1" patternTransform="rotate(45)"><rect width=".4" height="1" class="dep-hatch"/></pattern>
            <clipPath id="dclip"></clipPath></defs>
          <g transform="scale(.125)">${mapShapes(bp)}</g>
          <g class="dep-grid">${grid}</g>
          <g id="dnd" clip-path="url(#dclip)"></g>
          <g id="drings" class="dep-rings"></g>
          <g id="dtoks"></g>
        </svg>
        <div class="dep-zoom"><button data-z="in" aria-label="Zoom in">+</button><button data-z="out" aria-label="Zoom out">−</button><button data-z="fit" aria-label="Show whole table">⤢</button></div>
      </div>
      <div class="row dep-tools">
        <div class="seg" id="dmode"><button data-mode="unit" title="Drag moves the whole unit">Unit</button><button data-mode="model" title="Drag moves one model">Model</button></div>
        <button class="btn small" data-act="rotl" aria-label="Rotate 15° anticlockwise">↺</button>
        <button class="btn small" data-act="rotr" aria-label="Rotate 15° clockwise">↻</button>
        <button class="btn small" data-act="undo" aria-label="Undo" title="Undo"><svg class="ico" viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg></button>
        <span class="dep-tools-end">
          <button class="btn small" data-act="img" aria-label="Save image" title="Save image"><svg class="ico" viewBox="0 0 24 24"><path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/></svg></button>
          <button class="btn small" data-act="full" id="dfull" aria-label="Full screen" title="Full screen"><svg class="ico" viewBox="0 0 24 24"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg></button>
        </span>
      </div>
      <div id="dstatus" class="tiny"></div>
      <div class="dep-rotate-hint tiny muted">Turn your phone sideways for a bigger table.</div>
    </div>
    <div class="card tight">
      <div class="row wrap"><span class="small muted">Ring round selected unit</span>
        <div class="seg" id="dring">${[[0, "Off"], [0.5, "½″"], [1, "1″"], [3, "3″"]].map(([v, l]) => `<button data-ring="${v}">${l}</button>`).join("")}</div></div>
      <label class="row small" style="color:var(--text);margin:.5rem 0 0"><input type="checkbox" id="dnd9" style="width:auto;min-height:auto" ${D.nd ? "checked" : ""}> Hatch the 9″ no-deploy band next to enemy territory</label>
    </div>
    <div class="card tight">
      <label for="dtpl" style="margin-top:0">Saved deployments for ${esc(bpName)}</label>
      <select id="dtpl">${tplOptions()}</select>
      <div id="dtplstate" class="tiny muted" style="margin-top:.25rem"></div>
      <div class="row wrap" style="margin-top:.4rem"><button class="btn small primary" data-act="save">Save</button><button class="btn small" data-act="saveas">Save as new…</button>
        <button class="btn small danger" data-act="deltpl">Delete</button><button class="btn small danger" data-act="clear" style="margin-left:auto">Clear table</button></div>
    </div>
    ${problems.length ? `<div class="warn-box">${problems.map(u => u.defaultSize ? `<b>${esc(u.name)}</b>: size not in the rules data${u.w ? ` ("${esc((u.w.baseSizes || []).join(", ") || "none")}")` : ""}, so it's a ${esc(u.label)}.` : u.missing ? `<b>${esc(u.name)}</b>: no warscroll found, so it can't be placed.`
      : `<b>${esc(u.name)}</b>: ${[u.sizeMissing && "unit size not in the rules data (using 1 model)", u.guessed && `base size not in the rules data ("${esc((u.w.baseSizes || []).join(", ") || "none")}"), using ${esc(u.label)}`].filter(Boolean).join("; ")}.`).join("<br>")}</div>` : ""}
    <div class="row spread" style="margin-top:.8rem"><h2 style="margin:0">Units</h2><button class="btn small" data-act="placeall">Place all</button></div>
    <div id="dtray"></div>
    <p class="tiny muted">Drag a model to move it (Unit moves the whole unit; Model moves one). Place regiment puts a regiment in no man's land, clear of the rest of your army, ready to drag in. ⤓ saves a picture of the table; ⛶ goes full screen. Drag empty table to pan, pinch or use + − to zoom. Red dashed bases are not wholly inside your territory or are within 9″ of enemy territory. Model counts come from the warscroll unit size (doubled when reinforced); bases are drawn at true size. Your current layout is kept on this device; Save stores it on the server.</p>
  </div>`;

  const svg = $("#dboard"), root = $("#dep");
  const sides = () => { const side = D.layout.side, foe = side === "attacker" ? "defender" : "attacker"; return [zones[side], zones[foe]]; };
  const saveDraft = () => store.set(draftKey, { layout: D.layout, tplId: D.tplId });
  const pushHist = () => { D.hist.push(JSON.stringify(D.layout)); if (D.hist.length > 80) D.hist.shift(); };
  const segs = () => {
    $$("[data-side]", root).forEach(b => b.classList.toggle("on", b.dataset.side === D.layout.side));
    $$("[data-mode]", root).forEach(b => b.classList.toggle("on", b.dataset.mode === D.mode));
    $$("[data-ring]", root).forEach(b => b.classList.toggle("on", +b.dataset.ring === +D.ring));
  };

  function setView() {
    const v = D.view;
    v.w = Math.min(BW, Math.max(6, v.w));
    const h = v.w * BH / BW;
    v.x = Math.min(BW - v.w, Math.max(0, v.x)); v.y = Math.min(BH - h, Math.max(0, v.y));
    svg.setAttribute("viewBox", `${r2(v.x)} ${r2(v.y)} ${r2(v.w)} ${r2(h)}`);
  }
  function zoomAt(f, cx, cy) {
    const v = D.view, nw = Math.min(BW, Math.max(6, v.w * f)), k = nw / v.w;
    v.x = cx - (cx - v.x) * k; v.y = cy - (cy - v.y) * k; v.w = nw; setView();
  }

  function draw(light) {
    const [mine, enemy] = sides();
    $("#dclip").innerHTML = mine.map(r => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>`).join("");
    $("#dnd").innerHTML = D.nd ? enemy.map(r => `<rect x="${r.x - 9}" y="${r.y - 9}" width="${r.w + 18}" height="${r.h + 18}" rx="9" fill="url(#dhatch)"/>`).join("") : "";
    let toks = "", selToks = "", rings = "", badModels = 0, placed = 0;
    const stat = {};
    for (const u of units) {
      const pl = D.layout.units[u.uid];
      if (!pl) continue;
      const st = stat[u.uid] = { bad: 0, coh: coherent(pl.m, u.models) };
      pl.m.forEach((p, i) => {
        const b = u.models[i], ok = u.terrain ? terrainOkAt(p[0], p[1], p[2], b, mine, bp) : legalAt(p[0], p[1], p[2], b, mine, enemy);
        if (!u.terrain) placed++;
        if (!ok) { st.bad++; badModels++; }
        const cls = `tok${ok ? "" : " bad"}${D.sel === u.uid ? " sel" : ""}${D.sel === u.uid && D.mode === "model" && D.selModel === i ? " selm" : ""}`;
        const t = `<g class="${cls}${u.terrain ? " terr" : ""}" data-u="${u.uid}" data-i="${i}" transform="translate(${r2(p[0])} ${r2(p[1])}) rotate(${p[2]})">`
          + (b.rect ? `<rect x="${r2(-b.w / 2)}" y="${r2(-b.h / 2)}" width="${r2(b.w)}" height="${r2(b.h)}" rx=".5" style="fill:${u.color}"/>` : `<ellipse rx="${r2(b.w / 2)}" ry="${r2(b.h / 2)}" style="fill:${u.color}"/>`)
          + `<text class="tok-t" transform="rotate(${-p[2]})" style="font-size:${r2(Math.min(1.4, Math.min(b.w, b.h) * (u.code.length > 2 ? .36 : .45)))}px">${esc(u.code)}</text></g>`;
        if (D.sel === u.uid) selToks += t; else toks += t;
        if (D.sel === u.uid && +D.ring && b.rect) rings += `<rect x="${r2(-b.w / 2 - D.ring)}" y="${r2(-b.h / 2 - D.ring)}" width="${r2(b.w + 2 * D.ring)}" height="${r2(b.h + 2 * D.ring)}" rx="${D.ring}" transform="translate(${r2(p[0])} ${r2(p[1])}) rotate(${p[2]})"/>`;
        else if (D.sel === u.uid && +D.ring) rings += `<ellipse cx="${r2(p[0])}" cy="${r2(p[1])}" rx="${r2(b.w / 2 + +D.ring)}" ry="${r2(b.h / 2 + +D.ring)}" transform="rotate(${p[2]} ${r2(p[0])} ${r2(p[1])})"/>`;
      });
    }
    $("#dtoks").innerHTML = toks + selToks;
    $("#drings").innerHTML = rings;
    const total = units.reduce((s, u) => s + (u.terrain ? 0 : u.n), 0);
    const su = D.sel && byId[D.sel], ss = su && stat[su.uid];
    $("#dstatus").innerHTML = `<span class="muted">${placed}/${total} models on the table</span> · ${badModels ? `<span class="bad">${badModels} outside your deployable area</span>` : `<span class="good">all legal</span>`}`
      + (su ? ` · <b>${esc(su.code)}</b> ${esc(su.name)}${ss && !su.terrain ? (ss.coh ? ` <span class="good">coherent</span>` : ` <span class="bad">not coherent</span>`) : ""}` : "");
    const tpl = templates.find(t => t.id === D.tplId);
    $("#dtplstate").textContent = tpl ? (JSON.stringify(tpl.data) === JSON.stringify(D.layout) ? "Saved." : "Unsaved changes.") : (placed ? "Not saved yet: use Save to keep it as a named deployment." : "");
    if (light) return;
    segs();
    $("#dtray").innerHTML = regs.map((rg, ri) => `<div class="card tight"><div class="row spread" style="margin-bottom:.2rem"><h4 style="margin:0">${esc(rg)}</h4>
      ${units.some(u => u.regiment === rg && !u.missing && !D.layout.units[u.uid]) ? `<button class="btn small" data-act="placereg" data-r="${ri}" title="Puts the regiment in no man's land, clear of the rest of your army, ready to drag in">Place ${u0(rg)}</button>`
        : units.some(u => u.regiment === rg && D.layout.units[u.uid]) ? `<button class="btn small" data-act="remreg" data-r="${ri}">Remove ${u0(rg)}</button>` : ""}</div>${units.filter(u => u.regiment === rg).map(u => {
      const st = stat[u.uid];
      return `<div class="dep-unit ${D.sel === u.uid ? "on" : ""}" data-u="${u.uid}">
        <i class="sw" style="background:${u.color}"></i>
        <div class="grow"><div><b>${esc(u.code)}</b> ${esc(u.name)}${u.general ? ` <span class="chip accent">General</span>` : ""}</div>
          <div class="tiny muted">${u.missing ? "no warscroll" : u.terrain ? `Faction terrain · ${esc(u.label)}${u.defaultSize ? ` <span class="warn">(default size)</span>` : ""}` : `${u.n} model${u.n === 1 ? "" : "s"}${u.reinforced ? ` (reinforced, 2×${u.w.unitSize})` : ""} · ${esc(u.label)}${u.guessed ? ` <span class="warn">(guessed)</span>` : ""}`}
          ${st ? ` · ${st.bad ? `<span class="bad">${u.terrain ? "not legal (needs: in your territory, 3″ from objectives and terrain)" : `${st.bad} out of zone`}</span>` : `<span class="good">legal</span>`}${st.coh ? "" : ` · <span class="bad">not coherent</span>`}` : ""}</div></div>
        ${u.missing ? "" : st ? `<button class="btn small" data-act="remove" data-u="${u.uid}">Remove</button>` : `<button class="btn small primary" data-act="place" data-u="${u.uid}">Place</button>`}
      </div>`;
    }).join("")}</div>`).join("");
  }
  const commit = () => { saveDraft(); draw(); };
  const u0 = rg => rg === "Faction terrain" ? "terrain" : "regiment";

  // A free spot for the unit as a coherent block, 1" clear of other units. Normally a legal spot in your
  // territory; with neutral, a spot in no man's land (½" clear of both territories) so it stands out to drag in.
  function autoSpot(u, o = {}) {
    const [mine, enemy] = sides(), off = clusterOffsets(u.models), side = D.layout.side, zonesAll = [...mine, ...enemy];
    const others = [];
    for (const [uid, pl] of Object.entries(D.layout.units)) if (uid !== u.uid) pl.m.forEach((p, i) => { const b = byId[uid].models[i]; others.push([p[0], p[1], radOf(b)]); });
    const big = mine.slice().sort((a, b) => b.w * b.h - a.w * a.h)[0] || { x: 0, y: 0, w: BW, h: BH };
    const v = D.view, vh = v.w * BH / BW;
    const pref = o.pref || (o.neutral ? [BW / 2, BH / 2] : v.w < BW - 1 ? [v.x + v.w / 2, v.y + vh / 2] : [big.x + big.w / 2, big.y + big.h / 2]);
    const okAt = o.neutral
      ? (x, y, b) => rimPts(x, y, 0, b).every(p => p[0] > .25 && p[0] < BW - .25 && p[1] > .25 && p[1] < BH - .25 && zonesAll.every(r => rectDist(p, r) > .5))
      : u.terrain ? (x, y, b) => terrainOkAt(x, y, 0, b, mine, bp) : (x, y, b) => legalAt(x, y, 0, b, mine, enemy);
    const cands = [];
    for (let x = 0.5; x < BW; x += 0.5) for (let y = 0.5; y < BH; y += 0.5) cands.push([x, y, (x - pref[0]) ** 2 + (y - pref[1]) ** 2]);
    cands.sort((a, b) => a[2] - b[2]);
    const fits = (cx, cy) => u.models.every((b, i) => {
      const x = cx + off[i][0], y = cy + off[i][1], R = radOf(b);
      return okAt(x, y, b) && others.every(q => Math.hypot(q[0] - x, q[1] - y) > q[2] + R + 1);
    });
    const hit = cands.find(c => fits(c[0], c[1]));
    if (!hit) toast(o.neutral ? `No free spot in no man's land for ${u.name}: placed in the middle, move it yourself`
      : `No free legal spot for ${u.name} as the ${side}: placed in the middle, move it yourself`);
    const [cx, cy] = hit || pref;
    return off.map(q => [r2(Math.min(BW, Math.max(0, cx + q[0]))), r2(Math.min(BH, Math.max(0, cy + q[1]))), 0]);
  }
  // neutral: into no man's land to drag in yourself (Place, Place regiment); otherwise a legal spot (Place all)
  const place = (u, neutral) => { D.layout.units[u.uid] = { n: u.name, m: autoSpot(u, { neutral }) }; D.sel = u.uid; D.selModel = null; };
  function placeRegiment(rg) {
    const todo = units.filter(x => x.regiment === rg && !x.missing && !D.layout.units[x.uid]);
    if (!todo.length) { toast("That regiment is already on the table"); return; }
    pushHist();
    let pref = null;
    for (const u of todo) {   // each unit goes next to the previous one, so the regiment stays together
      const m = autoSpot(u, { neutral: true, pref });
      D.layout.units[u.uid] = { n: u.name, m };
      pref = [m.reduce((s, p) => s + p[0], 0) / m.length, m.reduce((s, p) => s + p[1], 0) / m.length];
    }
    D.sel = todo[0].uid; D.selModel = null;
    D.view = { x: 0, y: 0, w: BW }; setView();
    commit();
    toast(`${rg}: ${todo.length} unit${todo.length === 1 ? "" : "s"} in no man's land, drag them into your territory`);
  }

  // ---- save image: the whole table as a PNG, with the list, battleplan and side across the top
  async function saveImage() {
    const keep = [D.sel, D.selModel];
    D.sel = null; D.selModel = null; draw(true);
    const clone = svg.cloneNode(true);
    const src = [svg, ...svg.querySelectorAll("*")], dst = [clone, ...clone.querySelectorAll("*")];
    const props = ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "opacity", "font-size", "font-weight", "font-family", "text-anchor", "dominant-baseline", "display"];
    src.forEach((el, i) => { const cs = getComputedStyle(el); for (const p of props) { const v = cs.getPropertyValue(p); if (v && !/url\(/.test(v)) dst[i].style.setProperty(p, v); } });
    const bg = getComputedStyle(svg).backgroundColor, page = getComputedStyle(document.body), ink = page.color, paper = page.backgroundColor;
    [D.sel, D.selModel] = keep; draw(true);
    const PX = 25, W = BW * PX, H = BH * PX, HEAD = 64;
    clone.setAttribute("viewBox", `0 0 ${BW} ${BH}`); clone.setAttribute("width", W); clone.setAttribute("height", H);
    clone.removeAttribute("style"); clone.removeAttribute("class");
    clone.insertAdjacentHTML("afterbegin", `<rect x="0" y="0" width="${BW}" height="${BH}" style="fill:${bg}"/>`);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
    try {
      const img = new Image();
      await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error("Couldn't draw the table")); img.src = url; });
      const c = document.createElement("canvas"); c.width = W; c.height = H + HEAD;
      const g = c.getContext("2d");
      g.fillStyle = paper; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = ink; g.textBaseline = "middle";
      g.font = `700 26px ${page.fontFamily}`; g.fillText(list.name, 16, HEAD / 2 - 10);
      g.font = `400 20px ${page.fontFamily}`;
      const placed = Object.values(D.layout.units).reduce((s, pl) => s + pl.m.length, 0);
      g.fillText(`${bpName} · ${D.layout.side === "attacker" ? "Attacker" : "Defender"} · ${placed} models`, 16, HEAD / 2 + 16);
      g.drawImage(img, 0, HEAD, W, H);
      const blob = await new Promise(ok => c.toBlob(ok, "image/png"));
      await saveBlob(blob, `${list.name} - ${bpName} - ${D.layout.side}.png`, `${bpName} deployment`);
    } catch (e) { toast(e.message); }
    finally { URL.revokeObjectURL(url); }
  }

  // ---- full screen: phones and tablets go properly full screen (landscape where the browser allows);
  // bigger screens get the board in a large popup. Both use .dep-full; the board is sized to fit.
  const top = $(".dep-top", root), wrap = $(".dep-wrap", root), zoomEl = $(".dep-zoom", root);
  const fit = () => {
    if (!top.classList.contains("dep-full")) { svg.style.width = svg.style.height = zoomEl.style.right = zoomEl.style.top = ""; return; }
    const s = Math.min(wrap.clientWidth / BW, wrap.clientHeight / BH), w = Math.floor(s * BW), h = Math.floor(s * BH);
    svg.style.width = `${w}px`; svg.style.height = `${h}px`;
    // keep the zoom buttons on the board's corner, not the corner of the empty space round it
    zoomEl.style.right = `${Math.floor((wrap.clientWidth - w) / 2) + 6}px`; zoomEl.style.top = `${Math.floor((wrap.clientHeight - h) / 2) + 6}px`;
  };
  const ro = new ResizeObserver(fit); ro.observe(wrap);
  async function setFull(on) {
    top.classList.toggle("dep-full", on);
    document.body.classList.toggle("dep-lock", on);
    (on ? top : document.body).appendChild($("#toast"));   // keep messages visible inside real full screen
    const b = $("#dfull"); b.classList.toggle("on", on); b.setAttribute("aria-label", on ? "Exit full screen" : "Full screen"); b.title = b.getAttribute("aria-label");
    b.innerHTML = on ? `<svg class="ico" viewBox="0 0 24 24"><path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/></svg>` : `<svg class="ico" viewBox="0 0 24 24"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>`;
    depExitFull = on ? () => setFull(false) : null;
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (on && coarse && !fsEl) {
      const req = top.requestFullscreen || top.webkitRequestFullscreen;
      try { if (req) await req.call(top, { navigationUI: "hide" }); await screen.orientation?.lock?.("landscape"); } catch (e) { /* iPhone Safari: no element full screen or rotation lock; the overlay still fills the screen */ }
    } else if (!on && fsEl) {
      try { screen.orientation?.unlock?.(); } catch (e) { /* ignore */ }
      try { await (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) { /* ignore */ }
    }
    fit();
  }

  function rotate(deg) {
    const pl = D.sel && D.layout.units[D.sel];
    if (!pl) { toast("Select a unit on the table first"); return; }
    pushHist();
    if (D.mode === "model" && D.selModel != null) { const p = pl.m[D.selModel]; p[2] = (p[2] + deg + 360) % 360; }
    else {
      const cx = pl.m.reduce((s, p) => s + p[0], 0) / pl.m.length, cy = pl.m.reduce((s, p) => s + p[1], 0) / pl.m.length;
      const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
      pl.m = pl.m.map(p => { const dx = p[0] - cx, dy = p[1] - cy; return [r2(cx + dx * c - dy * s), r2(cy + dx * s + dy * c), (p[2] + deg + 360) % 360]; });
    }
    commit();
  }

  async function saveAs() {
    const n = Object.keys(D.layout.units).length;
    // default name: battleplan initials, small words lower case (Caverns of Slaughter -> CoS), numbered when taken
    const abbr = bpName.split(/\s+/).map(w => /^(of|the|from|under|is|in|and|to|a)$/i.test(w) ? w[0].toLowerCase() : w[0].toUpperCase()).join("");
    let def = abbr, k = 1;
    while (templates.some(t => t.name === def)) def = `${abbr} ${++k}`;
    const name = prompt(`Name this ${bpName} deployment`, def);
    if (!name?.trim()) return;
    try {
      const t = await api(`lists/${list.id}/layouts`, { method: "POST", body: { battleplan: bpName, name: name.trim(), data: D.layout } });
      templates.push(t); D.tplId = t.id; $("#dtpl").innerHTML = tplOptions(); saveDraft(); draw(true); toast(`Saved "${t.name}" (${n} units)`);
    } catch (e) { toast(e.message); }
  }

  root.addEventListener("click", async e => {
    if (e.target.closest("#dboard")) return;
    const t = e.target.closest("[data-act],[data-side],[data-mode],[data-ring],[data-z],.dep-unit");
    if (!t) return;
    const v = D.view, vh = v.w * BH / BW;
    if (t.dataset.z) {
      if (t.dataset.z === "fit") { D.view = { x: 0, y: 0, w: BW }; setView(); } else zoomAt(t.dataset.z === "in" ? 0.6 : 1 / 0.6, v.x + v.w / 2, v.y + vh / 2);
      return;
    }
    if (t.dataset.side) { if (t.dataset.side !== D.layout.side) { pushHist(); D.layout.side = t.dataset.side; commit(); } return; }
    if (t.dataset.mode) { D.mode = t.dataset.mode; store.set("bc-deploy-mode", D.mode); draw(); return; }
    if (t.dataset.ring) { D.ring = +t.dataset.ring; store.set("bc-deploy-ring", D.ring); draw(); return; }
    const act = t.dataset.act, u = t.dataset.u && byId[t.dataset.u];
    if (act === "place" && u) { pushHist(); place(u, true); D.view = { x: 0, y: 0, w: BW }; setView(); commit(); toast(`${u.name} is in no man's land: drag it into your territory`); return; }
    if (act === "remove" && u) { pushHist(); delete D.layout.units[u.uid]; if (D.sel === u.uid) D.sel = null; commit(); return; }
    if (act === "placeall") {
      const todo = units.filter(x => !x.missing && !D.layout.units[x.uid]);
      if (!todo.length) { toast("Everything is already on the table"); return; }
      pushHist(); todo.forEach(x => place(x, false)); D.sel = null; commit(); return;
    }
    if (act === "placereg") return placeRegiment(regs[+t.dataset.r]);
    if (act === "remreg") {
      const rg = regs[+t.dataset.r], ids = units.filter(x => x.regiment === rg && D.layout.units[x.uid]).map(x => x.uid);
      pushHist(); ids.forEach(id => delete D.layout.units[id]); if (ids.includes(D.sel)) { D.sel = null; D.selModel = null; }
      commit(); toast(`Took ${rg} off the table`); return;
    }
    if (act === "img") return saveImage();
    if (act === "full") return setFull(!top.classList.contains("dep-full"));
    if (act === "rotl") return rotate(-15);
    if (act === "rotr") return rotate(15);
    if (act === "undo") { if (!D.hist.length) { toast("Nothing to undo"); return; } D.layout = JSON.parse(D.hist.pop()); commit(); return; }
    if (act === "clear") { if (!Object.keys(D.layout.units).length || !confirm("Take every model off the table?")) return; pushHist(); D.layout.units = {}; D.sel = null; commit(); return; }
    if (act === "save") {
      if (!D.tplId) return saveAs();
      try {
        const r = await api(`layouts/${D.tplId}`, { method: "PUT", body: { data: D.layout } });
        templates = templates.map(x => x.id === r.id ? r : x); draw(true); toast(`Saved "${r.name}"`);
      } catch (err) { toast(err.message); }
      return;
    }
    if (act === "saveas") return saveAs();
    if (act === "deltpl") {
      const tpl = templates.find(x => x.id === D.tplId);
      if (!tpl) { toast("Pick a saved deployment first"); return; }
      if (!confirm(`Delete the saved deployment "${tpl.name}"? The models stay on the table.`)) return;
      try { await api(`layouts/${tpl.id}`, { method: "DELETE" }); templates = templates.filter(x => x.id !== tpl.id); D.tplId = null; $("#dtpl").innerHTML = tplOptions(); saveDraft(); draw(true); toast("Deleted"); }
      catch (err) { toast(err.message); }
      return;
    }
    if (t.classList.contains("dep-unit") && !act) { D.sel = D.sel === t.dataset.u ? null : t.dataset.u; D.selModel = null; draw(); }
  });
  $("#dbp").onchange = e => { store.set(`bc-deploy-bp-${list.id}`, e.target.value); viewDeploy(list, army); };
  $("#dnd9").onchange = e => { D.nd = e.target.checked; store.set("bc-deploy-nd", D.nd); draw(true); };
  $("#dtpl").onchange = e => {
    const tpl = templates.find(x => x.id === +e.target.value);
    if (!tpl) { D.tplId = null; saveDraft(); draw(true); return; }
    pushHist(); D.tplId = tpl.id; D.layout = clean(JSON.parse(JSON.stringify(tpl.data))); D.sel = null; commit();
  };

  // ---- pointer input: drag models, pan, pinch-zoom
  const ptrs = new Map();
  let drag = null;
  const toBoard = (cx, cy) => { const pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy; const q = pt.matrixTransform(svg.getScreenCTM().inverse()); return [q.x, q.y]; };
  svg.addEventListener("pointerdown", e => {
    e.preventDefault();
    svg.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (drag?.kind === "tok" && drag.moved) saveDraft();
      drag = { kind: "pinch", d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, w0: D.view.w, pb: toBoard(...mid) };
      return;
    }
    if (ptrs.size > 2) return;
    const tok = e.target.closest(".tok");
    const p = toBoard(e.clientX, e.clientY);
    if (tok) {
      const uid = tok.dataset.u, i = +tok.dataset.i, pl = D.layout.units[uid];
      const changed = D.sel !== uid || D.selModel !== i;
      D.sel = uid; D.selModel = i;
      const idx = D.mode === "unit" ? pl.m.map((_, k) => k) : [i];
      drag = { kind: "tok", uid, idx, start: p, orig: pl.m.map(q => q.slice()), snap: JSON.stringify(D.layout), moved: false };
      if (changed) draw();
    } else drag = { kind: "pan", c0: [e.clientX, e.clientY], v0: { ...D.view }, moved: false };
  });
  svg.addEventListener("pointermove", e => {
    if (!ptrs.has(e.pointerId) || !drag) return;
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    const rect = svg.getBoundingClientRect();
    if (drag.kind === "pinch" && ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()], mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const nw = Math.min(BW, Math.max(6, drag.w0 * drag.d0 / (Math.hypot(a[0] - b[0], a[1] - b[1]) || 1)));
      D.view = { x: drag.pb[0] - (mid[0] - rect.left) / rect.width * nw, y: drag.pb[1] - (mid[1] - rect.top) / rect.height * nw * BH / BW, w: nw };
      setView(); return;
    }
    if (drag.kind === "pan") {
      const dx = e.clientX - drag.c0[0], dy = e.clientY - drag.c0[1];
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      const k = drag.v0.w / rect.width;
      D.view = { x: drag.v0.x - dx * k, y: drag.v0.y - dy * k, w: drag.v0.w }; setView(); return;
    }
    if (drag.kind === "tok") {
      const p = toBoard(e.clientX, e.clientY), u = byId[drag.uid], pl = D.layout.units[drag.uid];
      let dx = p[0] - drag.start[0], dy = p[1] - drag.start[1];
      if (!drag.moved && Math.hypot(dx, dy) < 0.15) return;
      if (!drag.moved) { drag.moved = true; D.hist.push(drag.snap); if (D.hist.length > 80) D.hist.shift(); }
      for (const k of drag.idx) {   // keep every moved model on the table
        const o = drag.orig[k], R = radOf(u.models[k]);
        dx = Math.min(BW - R - o[0], Math.max(R - o[0], dx)); dy = Math.min(BH - R - o[1], Math.max(R - o[1], dy));
      }
      for (const k of drag.idx) pl.m[k] = [r2(drag.orig[k][0] + dx), r2(drag.orig[k][1] + dy), drag.orig[k][2]];
      draw(true);
    }
  });
  const up = e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (drag?.kind === "tok") { if (drag.moved) commit(); }
    else if (drag?.kind === "pan" && !drag.moved && !e.target.closest(".tok") && D.sel) { D.sel = null; D.selModel = null; draw(); }
    if (ptrs.size === 0) drag = null; else if (drag?.kind === "pinch" && ptrs.size === 1) drag = null;
  };
  svg.addEventListener("pointerup", up);
  svg.addEventListener("pointercancel", up);
  svg.addEventListener("wheel", e => { e.preventDefault(); const p = toBoard(e.clientX, e.clientY); zoomAt(e.deltaY > 0 ? 1.15 : 1 / 1.15, p[0], p[1]); }, { passive: false });

  setView();
  draw();
}

// ------------------------------------------------------------------ stats
function bars(rows, opts = {}) {
  if (!rows?.length) return `<p class="muted small">No data.</p>`;
  return rows.map(r => {
    const v = opts.value ? opts.value(r) : r.winRate;
    const w = Math.max(0, Math.min(100, v ?? 0));
    const good = opts.delta ? v >= 0 : v >= 50;
    const fill = opts.delta ? `left:${v >= 0 ? 50 : 50 + Math.max(-50, v * 2.5)}%;width:${Math.min(50, Math.abs(v) * 2.5)}%` : `left:0;width:${w}%`;
    return `<div class="bar-row ${r.mine ? "mine" : ""}"><div class="nm">${r.mine ? "★ " : ""}${esc(r.name)} <small>${r.games != null ? r.games + "g" : ""}${r.extra ? " · " + esc(r.extra) : ""}</small></div>
      <div class="bar"><i style="${fill};background:${good ? "var(--good)" : "var(--bad)"}"></i></div>
      <div class="v ${good ? "good" : "bad"}">${opts.delta ? (v > 0 ? "+" : "") + (Math.round(v * 10) / 10) : pct(v)}</div></div>`;
  }).join("");
}

async function viewStats(list, army) {
  app.innerHTML = `<p class="muted">Loading stats…</p>`;
  const s = await getStats(list.slug);
  if (s.missing) { app.innerHTML = `<div class="card empty">No stats for ${esc(list.faction)} yet.</div>`; return; }
  const p = list.parsed;
  const myUnits = new Set(army.units.map(u => norm(u.w.name)));
  const myEnh = new Set(p.regiments.flatMap(r => r.units.flatMap(u => (u.enhancements || []).map(e => norm(e.name)))));
  const mark = (rows, set) => (rows || []).map(r => ({ ...r, mine: set.has(norm(r.name)) }));
  const minGames = 10;
  const unitRows = mark(s.units, myUnits).map(r => ({ ...r, extra: `${r.playShare}% play` }));
  const mine = unitRows.filter(r => r.mine);
  const k = (lbl, o, sub) => `<div class="kpi"><div class="lbl">${lbl}</div><div class="val">${o ? pct(o.winRate) : "–"}</div><div class="sub">${o ? `${o.games} games${sub ? " · " + sub(o) : ""}` : "no data"}</div></div>`;
  const match = (s.matchups || []).filter(r => r.games >= minGames).sort((a, b) => b.winRate - a.winRate);
  const enhRows = [...(s.traits || []), ...(s.artefacts || []), ...(s.enhancements || [])].map(r => ({ ...r, mine: myEnh.has(norm(r.name)), extra: r.type || "" }));
  const tacMine = new Set((p.tactics || []).map(norm));
  app.innerHTML = `
    <div class="card"><h3>${esc(list.faction)} this season</h3>
      <div class="kpis">${k("GT win rate · aos-events", s.aosevents, () => `4+ wins ${s.fourPlusWins ?? "–"}%`)}${k("Since Battlescroll · listhammer", s.listhammer_dataslate, o => `${o.top4} top-4s`)}${k("Last 4 weeks · listhammer", s.listhammer_4weeks)}${k("App games · aosstats", s.aosstats)}</div>
      <p class="tiny muted">Updated ${esc((s.updated || "").replace("T", " "))}. Win rates count draws as half. ★ = in your list.</p></div>
    <div class="card"><h3>Your units vs the field</h3><p class="tiny muted">Win-rate difference for lists that include the unit vs lists that don't (aos-events, GTs 5+ rounds).</p>
      ${bars(mine.length ? mine : [], { delta: true, value: r => r.delta })}
      <details><summary class="small">All ${esc(list.faction)} units (${unitRows.length})</summary>${bars(unitRows.filter(r => r.games >= minGames).sort((a, b) => b.delta - a.delta), { delta: true, value: r => r.delta })}</details></div>
    <div class="card"><h3>Battle formations</h3>${bars(mark(s.formations, new Set([norm(p.formation)])))}</div>
    <div class="card"><h3>Battle tactic cards</h3>${bars(mark(s.tactics, tacMine))}
      <details><summary class="small">Card pairs</summary>${bars((s.tacticPairs || []).filter(r => r.games >= minGames).map(r => ({ ...r, mine: (p.tactics || []).length === 2 && (p.tactics || []).every(t => norm(r.name).includes(norm(t))) })).sort((a, b) => b.winRate - a.winRate))}</details></div>
    <div class="card"><h3>Battleplans <span class="muted small">(team events, RTB)</span></h3>${bars((s.battleplans || []).slice().sort((a, b) => b.winRate - a.winRate))}</div>
    <div class="card"><h3>Matchups</h3><p class="tiny muted">${minGames}+ games, best first.</p>${bars(match)}</div>
    <div class="card"><h3>Enhancements</h3>${bars(enhRows.filter(r => r.games >= 5).sort((a, b) => b.games - a.games))}</div>
    <div class="card"><h3>Manifestation lores</h3>${bars(mark(s.manifestations, new Set([norm(p.manifestationLore)])))}</div>
    <div class="card"><h3>Drops</h3>${bars((s.drops || []).map(r => ({ ...r, name: r.name + " drops", mine: String(r.name) === String(p.drops) })))}</div>
    <p class="tiny muted">Sources: aos-events.com (BCP GTs, 5+ rounds, mirrors excluded), listhammer.info, aosstats.tabletopbattles.com, releasethebeast.app. Stats never override rules or points.</p>`;
}

// ------------------------------------------------------------------ rules
function viewRulesBody(ghb, core, army) {
  const sections = [
    ["Turn sequence", `<div class="card">${(core.overview || []).map(x => `<p class="small">${x}</p>`).join("")}
      ${(core.phases || []).map(p => `<h4 style="margin-top:.6rem">${esc(p.name)}</h4><ol class="small" style="padding-left:1.2rem;margin:.2rem 0">${p.steps.map(s => `<li>${s}</li>`).join("")}</ol>`).join("")}</div>`],
    ["Core abilities and commands", [...(ghb.coreAbilities || []), ...(core.extraAbilities || [])].map(a => abilityHTML(tag(a, a.section || "Core rules", "core"))).join("")],
    ["Season rules 2026-27", (ghb.seasonRules || []).map(a => abilityHTML(tag(a, "Season rules", "season"))).join("") + (core.season || []).map(x => `<p class="small">${x}</p>`).join("")],
    ["Battle tactic cards (GHB 2026-27)", (core.tacticsHowTo ? `<p class="small">${core.tacticsHowTo}</p>` : "") + (ghb.tactics || []).map(c => tacticHTML(c)).join("")],
    ["Battleplans", (ghb.battleplans || []).map(b => `<details class="card"><summary>${esc(b.name)}</summary>${battleplanHTML(b, ghb.mapLegend || {})}</details>`).join("") + `<p class="tiny muted">${esc(ghb.mapSource || "")}</p>`],
  ];
  return `<div class="search"><input type="search" id="q" placeholder="Search rules${army ? " and your army" : ""}…"></div><div id="qres"></div>
    <div id="secs">${sections.map(([t, h], i) => `<details class="card" ${i === 0 ? "open" : ""}><summary>${esc(t)}</summary>${h}</details>`).join("")}</div>
    ${core.sources?.length ? `<p class="tiny muted">Core rules sources: ${core.sources.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.what || s.url)}</a>`).join(" · ")}</p>` : ""}`;
}

function bindSearch(ghb, core, army) {
  const pool = army ? army.abilities : [...(ghb.coreAbilities || []), ...(core.extraAbilities || [])].map(a => tag(a, "Core rules", "core")).concat((ghb.seasonRules || []).map(a => tag(a, "Season rules", "season")));
  $("#q").oninput = e => {
    const q = norm(e.target.value);
    if (q.length < 2) { $("#qres").innerHTML = ""; $("#secs").hidden = false; return; }
    const hits = pool.filter(a => norm(`${a.name} ${a.src} ${a.effect} ${a.declare} ${(a.keywords || []).join(" ")}`).includes(q)).slice(0, 60);
    $("#secs").hidden = true;
    $("#qres").innerHTML = hits.length ? hits.map(a => abilityHTML(a)).join("") : `<p class="muted">No matches.</p>`;
  };
}

function viewRules(ghb, core, army) { app.innerHTML = viewRulesBody(ghb, core, army); bindSearch(ghb, core, army); }

async function viewRulesGlobal() {
  chrome({ title: "Rules", subtitle: "Core rules · GHB 2026-27", back: "#/lists" });
  const [ghb, core] = await Promise.all([data("rules/ghb.json"), data("core.json").catch(() => ({}))]);
  viewRules(ghb, core, null);
}

// ------------------------------------------------------------------ settings
async function viewSettings() {
  chrome({ title: "Settings", back: state.list ? `#/list/${state.list.id}/play` : "#/lists" });
  app.innerHTML = `
    <div class="card"><h3>Signed in as ${esc(state.me.username)}</h3><button class="btn small" id="out">Sign out</button></div>
    <form class="card" id="pw"><h3>Change password</h3>
      <label for="cur">Current password</label><input type="password" id="cur" autocomplete="current-password" required>
      <label for="new">New password</label><input type="password" id="new" autocomplete="new-password" minlength="6" required>
      <button class="btn primary" style="margin-top:.6rem">Update password</button></form>
    <div class="card"><h3>Backup</h3><p class="small muted">Download your lists and saved deployments as a file, or load a file (for example from the old local server).</p>
      <div class="row wrap"><button class="btn small" id="exp">Export</button><label class="btn small" style="margin:0">Import<input type="file" id="imp" accept="application/json,.json" hidden></label></div></div>
    <div id="admin"></div>
    <div class="card"><h3>Appearance</h3><div class="seg" id="theme">${["auto", "dark", "light"].map(t => `<button data-theme="${t}" class="${(store.get("bc-theme", "auto")) === t ? "on" : ""}">${t}</button>`).join("")}</div></div>`;
  $("#out").onclick = async () => { await api("logout", { method: "POST" }).catch(() => { }); state.me = null; state.list = null; go("#/login"); };
  $("#pw").onsubmit = async e => {
    e.preventDefault();
    try { await api("password", { method: "POST", body: { current: $("#cur").value, new: $("#new").value } }); toast("Password updated"); e.target.reset(); }
    catch (err) { toast(err.message); }
  };
  $$("[data-theme]").forEach(b => b.onclick = () => { store.set("bc-theme", b.dataset.theme); applyTheme(); viewSettings(); });
  $("#exp").onclick = async () => {
    try {
      const lists = [];
      for (const l of await api("lists")) {
        const full = await api(`lists/${l.id}`);
        lists.push({ name: full.name, raw: full.raw, parsed: full.parsed, notes: full.notes || "", layouts: (await api(`lists/${l.id}/layouts`)).map(t => ({ battleplan: t.battleplan, name: t.name, data: t.data })) });
      }
      const blob = new Blob([JSON.stringify({ app: "battle-companion", version: 1, exported: new Date().toISOString(), lists }, null, 1)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `battle-companion-${state.me.username}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (err) { toast(err.message); }
  };
  $("#imp").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!Array.isArray(d.lists)) throw new Error("That isn't a Battle Companion export");
      const have = new Set((await api("lists")).map(l => l.name));
      let nl = 0, nt = 0;
      for (const l of d.lists) {
        if (have.has(l.name) && !confirm(`You already have a list called "${l.name}". Import another copy?`)) continue;
        const r = await api("lists", { method: "POST", body: { name: l.name, raw: l.raw, notes: l.notes } }); nl++;
        for (const t of l.layouts || []) { await api(`lists/${r.id}/layouts`, { method: "POST", body: t }); nt++; }
      }
      toast(`Imported ${nl} lists and ${nt} deployments`);
    } catch (err) { toast(err.message); }
    e.target.value = "";
  };
  if (!state.me.isAdmin) return;
  const users = await api("users");
  if (window.bcBackend) {
    $("#admin").innerHTML = `<div class="card"><h3>Users</h3>
      ${users.map(u => `<div class="row spread" style="padding:.3rem 0;border-bottom:1px solid var(--line)"><span>${esc(u.username)} ${u.isAdmin ? "<span class='chip accent'>admin</span>" : ""}</span></div>`).join("")}
      <p class="small muted" style="margin-top:.6rem">To add someone: Supabase dashboard → Authentication → Users → Add user → email <b>&lt;username&gt;@${esc(window.BC_CONFIG.emailDomain)}</b>, a password, tick <b>Auto Confirm User</b>. They sign in here with just the username. Reset passwords and remove users there too.</p></div>`;
    return;
  }
  $("#admin").innerHTML = `<div class="card"><h3>Users</h3>
    ${users.map(u => `<div class="row spread" style="padding:.3rem 0;border-bottom:1px solid var(--line)"><span>${esc(u.username)} ${u.isAdmin ? "<span class='chip accent'>admin</span>" : ""} <span class="muted small">${u.lists} lists</span></span>
      <span class="row"><button class="btn small" data-reset="${u.id}">Reset pw</button>${u.username !== state.me.username ? `<button class="btn small danger" data-deluser="${u.id}">Delete</button>` : ""}</span></div>`).join("")}
    <form id="nu" style="margin-top:.6rem"><h4>Add user</h4>
      <input type="text" id="nun" placeholder="Username (e.g. charlie)" autocapitalize="none" required>
      <input type="password" id="nup" placeholder="Password (6+ characters)" minlength="6" required style="margin-top:.4rem" autocomplete="new-password">
      <label class="row" style="color:var(--text)"><input type="checkbox" id="nua" style="width:auto;min-height:auto"> Admin</label>
      <button class="btn primary">Add user</button></form></div>`;
  $("#nu").onsubmit = async e => {
    e.preventDefault();
    try { await api("users", { method: "POST", body: { username: $("#nun").value, password: $("#nup").value, isAdmin: $("#nua").checked } }); toast("User added"); viewSettings(); }
    catch (err) { toast(err.message); }
  };
  $$("[data-reset]").forEach(b => b.onclick = async () => {
    const pw = prompt("New password (6+ characters):"); if (!pw) return;
    try { await api(`users/${b.dataset.reset}`, { method: "PUT", body: { password: pw } }); toast("Password reset"); } catch (err) { toast(err.message); }
  });
  $$("[data-deluser]").forEach(b => b.onclick = async () => {
    if (!confirm("Delete this user and all their lists? This can't be undone.")) return;
    await api(`users/${b.dataset.deluser}`, { method: "DELETE" }); toast("User deleted"); viewSettings();
  });
}

function applyTheme() {
  const t = store.get("bc-theme", "auto");
  if (t === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.dataset.theme = t;
}

applyTheme();
route();
