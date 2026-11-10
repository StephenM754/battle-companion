/* Supabase backend. Implements the same routes app.js used to call on server.py, so the views don't care
   which one is behind them: api("lists"), api("lists/3", {method: "PUT", body}), api("lists/3/layouts") … */
"use strict";
(function () {
  const cfg = window.BC_CONFIG || {};
  if (!cfg.supabaseUrl || !window.supabase) return;   // no config: app.js falls back to the local server.py API
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true } });

  class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
  const email = u => (u.includes("@") ? u : `${u}@${cfg.emailDomain}`).trim().toLowerCase();
  const check = ({ data, error }) => { if (error) throw new ApiError(error.message, error.status || 400); return data; };
  const ts = s => (s ? Date.parse(s) / 1000 : null);

  async function user() {
    const { data } = await sb.auth.getSession();
    if (!data.session) throw new ApiError("Not signed in", 401);
    return data.session.user;
  }
  async function profile(u) {
    const p = check(await sb.from("profiles").select("username,is_admin").eq("id", u.id).maybeSingle());
    return { username: p?.username || u.email.split("@")[0], isAdmin: !!p?.is_admin };
  }
  const listOut = (r, full) => {
    const d = { id: r.id, name: r.name, faction: r.faction, slug: r.slug, points: r.points, updated: ts(r.updated_at), formation: r.parsed?.formation || null };
    if (full) Object.assign(d, { raw: r.raw, parsed: r.parsed, notes: r.notes });
    return d;
  };
  const layoutOut = r => ({ id: r.id, listId: r.list_id, battleplan: r.battleplan, name: r.name, data: r.data, updated: ts(r.updated_at) });
  const parse = raw => window.parseList(raw, p => window.bcData("rules/" + p));

  async function api(path, opts = {}) {
    const method = opts.method || "GET", b = opts.body || {};
    const parts = path.split("/");

    if (path === "login") {
      const r = await sb.auth.signInWithPassword({ email: email(b.username || ""), password: b.password || "" });
      if (r.error) throw new ApiError(/invalid login/i.test(r.error.message) ? "Wrong username or password" : r.error.message, 401);
      return profile(r.data.user);
    }
    const u = await user();
    if (path === "me") return profile(u);
    if (path === "logout") { await sb.auth.signOut(); return { ok: true }; }
    if (path === "password") {
      if ((b.new || "").length < 6) throw new ApiError("Use at least 6 characters", 400);
      const ok = await sb.auth.signInWithPassword({ email: u.email, password: b.current || "" });
      if (ok.error) throw new ApiError("Current password is wrong", 400);
      check(await sb.auth.updateUser({ password: b.new }));
      return { ok: true };
    }
    if (parts[0] === "users") {
      if (method !== "GET") throw new ApiError("Add, remove or reset users in the Supabase dashboard (Authentication → Users).", 400);
      const rows = check(await sb.from("profiles").select("id,username,is_admin").order("username"));
      return rows.map(r => ({ id: r.id, username: r.username, isAdmin: r.is_admin, lists: null }));
    }
    if (path === "parse") {
      if (!(b.raw || "").trim()) throw new ApiError("Paste a list first", 400);
      return parse(b.raw.trim());
    }
    if (parts[0] === "stats") {
      try { return await window.bcData(`stats/${parts[1] || "overview"}.json`); } catch (e) { return { missing: true }; }
    }

    if (parts[0] === "lists") {
      const id = parts[1] ? +parts[1] : null;
      if (!id && method === "GET") return check(await sb.from("lists").select("*").order("updated_at", { ascending: false })).map(r => listOut(r));
      if (!id && method === "POST") {
        const raw = (b.raw || "").trim();
        if (!raw) throw new ApiError("Paste a list first", 400);
        const p = b.parsed || await parse(raw);
        if (p.error) throw new ApiError(p.error, 400);
        const row = { name: (b.name || p.name || p.faction).trim().slice(0, 120), faction: p.faction, slug: p.slug, points: p.points, raw, parsed: p, notes: b.notes || "" };
        return listOut(check(await sb.from("lists").insert(row).select().single()), true);
      }
      if (id && parts[2] === "layouts") {
        if (method === "GET") return check(await sb.from("layouts").select("*").eq("list_id", id).order("battleplan").order("name")).map(layoutOut);
        if (method === "POST") {
          const bp = (b.battleplan || "").trim().slice(0, 80), name = (b.name || "").trim().slice(0, 80);
          if (!bp || !name || typeof b.data !== "object") throw new ApiError("Need a battleplan, a name and the layout", 400);
          return layoutOut(check(await sb.from("layouts").insert({ list_id: id, battleplan: bp, name, data: b.data }).select().single()));
        }
      }
      if (id) {
        const cur = check(await sb.from("lists").select("*").eq("id", id).maybeSingle());
        if (!cur) throw new ApiError("List not found", 404);
        if (method === "GET") return listOut(cur, true);
        if (method === "DELETE") { check(await sb.from("lists").delete().eq("id", id)); return { ok: true }; }
        if (method === "PUT") {
          const raw = (b.raw || cur.raw).trim();
          const p = raw !== cur.raw || b.reparse ? await parse(raw) : cur.parsed;
          if (p.error) throw new ApiError(p.error, 400);
          const row = { name: (b.name || cur.name).trim().slice(0, 120), raw, parsed: p, faction: p.faction, slug: p.slug, points: p.points, notes: b.notes ?? cur.notes };
          return listOut(check(await sb.from("lists").update(row).eq("id", id).select().single()), true);
        }
      }
    }
    if (parts[0] === "layouts" && parts[1]) {
      const id = +parts[1];
      if (method === "DELETE") { check(await sb.from("layouts").delete().eq("id", id)); return { ok: true }; }
      if (method === "PUT") {
        const upd = {};
        if (b.name) upd.name = b.name.trim().slice(0, 80);
        if (typeof b.data === "object") upd.data = b.data;
        const r = check(await sb.from("layouts").update(upd).eq("id", id).select().maybeSingle());
        if (!r) throw new ApiError("Layout not found", 404);
        return layoutOut(r);
      }
    }
    throw new ApiError("not found", 404);
  }

  window.bcBackend = { api, kind: "supabase", client: sb };
})();
