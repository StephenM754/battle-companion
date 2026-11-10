#!/usr/bin/env python3
"""Battle Companion: mobile AoS list + turn helper. Python standard library only.

  python3 server.py                 # http://127.0.0.1:8790
  python3 server.py --lan           # also reachable from phones on the same Wi-Fi
  python3 server.py --port 9000

First run creates data/app.db with the user admin / admin (change it under Settings).
"""
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import sys
import threading
import time
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
RULES = STATIC / "data" / "rules"
DIGEST = STATIC / "data" / "stats"
DB_PATH = Path(os.environ.get("BC_DB", ROOT / "data" / "app.db"))
SESSION_DAYS = 30
MAX_BODY = 256 * 1024
COOKIE = "bc_session"
SECURE_COOKIE = os.environ.get("BC_SECURE_COOKIE") == "1"   # set when served over https

sys.path.insert(0, str(ROOT))
from listparser import parse as parse_list  # noqa: E402

_lock = threading.Lock()


# ---------------------------------------------------------------- database
def db():
    con = sqlite3.connect(DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def hash_pw(pw, salt=None):
    salt = salt or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), 200_000).hex()
    return f"pbkdf2${salt}${h}"


def check_pw(pw, stored):
    try:
        _, salt, h = stored.split("$")
    except ValueError:
        return False
    return hmac.compare_digest(hash_pw(pw, salt), stored)


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with db() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS users(
            id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL COLLATE NOCASE, pw TEXT NOT NULL,
            is_admin INTEGER NOT NULL DEFAULT 0, created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(
            token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS lists(
            id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL, faction TEXT, slug TEXT, points INTEGER, raw TEXT NOT NULL, parsed TEXT NOT NULL,
            notes TEXT DEFAULT '', created REAL NOT NULL, updated REAL NOT NULL);
        CREATE INDEX IF NOT EXISTS lists_user ON lists(user_id);
        CREATE TABLE IF NOT EXISTS layouts(
            id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
            battleplan TEXT NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL, created REAL NOT NULL, updated REAL NOT NULL);
        CREATE INDEX IF NOT EXISTS layouts_list ON layouts(list_id, battleplan);
        """)
        if not con.execute("SELECT 1 FROM users LIMIT 1").fetchone():
            con.execute("INSERT INTO users(username, pw, is_admin, created) VALUES (?,?,1,?)", ("admin", hash_pw("admin"), time.time()))
            print("created default user admin / admin")


def list_row(r, full=False):
    d = {"id": r["id"], "name": r["name"], "faction": r["faction"], "slug": r["slug"], "points": r["points"],
         "updated": r["updated"]}
    p = json.loads(r["parsed"])
    d["formation"] = p.get("formation")
    if full:
        d.update(raw=r["raw"], parsed=p, notes=r["notes"])
    return d


def layout_row(r):
    return {"id": r["id"], "listId": r["list_id"], "battleplan": r["battleplan"], "name": r["name"],
            "data": json.loads(r["data"]), "updated": r["updated"]}


# ---------------------------------------------------------------- http
class Handler(BaseHTTPRequestHandler):
    server_version = "BattleCompanion/1.0"

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            sys.stderr.write("%s %s\n" % (self.log_date_time_string(), fmt % args))

    # helpers
    def send_json(self, obj, status=200, headers=None):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def err(self, status, msg):
        self.send_json({"error": msg}, status)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            raise ValueError("request too large")
        raw = self.rfile.read(n) if n else b"{}"
        return json.loads(raw or b"{}")

    def user(self):
        c = SimpleCookie(self.headers.get("Cookie") or "")
        tok = c.get(COOKIE)
        if not tok:
            return None
        with db() as con:
            r = con.execute("SELECT u.id, u.username, u.is_admin FROM sessions s JOIN users u ON u.id=s.user_id "
                            "WHERE s.token=? AND s.expires>?", (tok.value, time.time())).fetchone()
        return dict(r) if r else None

    def cookie(self, token, max_age):
        flags = f"{COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}"
        return flags + ("; Secure" if SECURE_COOKIE else "")

    # routing
    def do_GET(self):
        self.route("GET")

    def do_POST(self):
        self.route("POST")

    def do_PUT(self):
        self.route("PUT")

    def do_DELETE(self):
        self.route("DELETE")

    def route(self, method):
        path = urlparse(self.path).path
        try:
            if path.startswith("/api/"):
                return self.api(method, path[5:].strip("/"))
            if method != "GET":
                return self.err(405, "method not allowed")
            return self.static(path)
        except (ValueError, json.JSONDecodeError) as e:
            return self.err(400, str(e))
        except Exception as e:  # keep the server alive; report the error
            import traceback
            traceback.print_exc()
            return self.err(500, f"server error: {e}")

    def static(self, path):
        if path in ("", "/"):
            path = "/index.html"
        f = (STATIC / path.lstrip("/")).resolve()
        if not str(f).startswith(str(STATIC)) or not f.is_file():
            f = STATIC / "index.html"   # single-page app fallback
        data = f.read_bytes()
        ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", ctype + ("; charset=utf-8" if ctype.startswith(("text/", "application/javascript", "application/json")) else ""))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def api(self, method, path):
        parts = path.split("/")
        if path == "login" and method == "POST":
            b = self.body()
            with db() as con:
                r = con.execute("SELECT * FROM users WHERE username=?", ((b.get("username") or "").strip(),)).fetchone()
                if not r or not check_pw(b.get("password") or "", r["pw"]):
                    time.sleep(0.5)
                    return self.err(401, "Wrong username or password")
                tok = secrets.token_urlsafe(32)
                con.execute("DELETE FROM sessions WHERE expires<?", (time.time(),))
                con.execute("INSERT INTO sessions VALUES (?,?,?)", (tok, r["id"], time.time() + SESSION_DAYS * 86400))
            return self.send_json({"username": r["username"], "isAdmin": bool(r["is_admin"]),
                                   "defaultPassword": r["username"] == "admin" and b.get("password") == "admin"},
                                  headers={"Set-Cookie": self.cookie(tok, SESSION_DAYS * 86400)})

        u = self.user()
        if not u:
            return self.err(401, "Not signed in")

        if path == "logout" and method == "POST":
            tok = SimpleCookie(self.headers.get("Cookie") or "").get(COOKIE)
            with db() as con:
                con.execute("DELETE FROM sessions WHERE token=?", (tok.value if tok else "",))
            return self.send_json({"ok": True}, headers={"Set-Cookie": self.cookie("", 0)})
        if path == "me":
            return self.send_json({"username": u["username"], "isAdmin": bool(u["is_admin"])})
        if path == "password" and method == "POST":
            b = self.body()
            new = b.get("new") or ""
            if len(new) < 6:
                return self.err(400, "Use at least 6 characters")
            with db() as con:
                r = con.execute("SELECT pw FROM users WHERE id=?", (u["id"],)).fetchone()
                if not check_pw(b.get("current") or "", r["pw"]):
                    return self.err(400, "Current password is wrong")
                con.execute("UPDATE users SET pw=? WHERE id=?", (hash_pw(new), u["id"]))
            return self.send_json({"ok": True})

        # ----- users (admin)
        if parts[0] == "users":
            if not u["is_admin"]:
                return self.err(403, "Admins only")
            with db() as con:
                if method == "GET" and len(parts) == 1:
                    rows = con.execute("SELECT u.id, u.username, u.is_admin, (SELECT COUNT(*) FROM lists l WHERE l.user_id=u.id) n "
                                       "FROM users u ORDER BY username").fetchall()
                    return self.send_json([{"id": r["id"], "username": r["username"], "isAdmin": bool(r["is_admin"]),
                                            "lists": r["n"]} for r in rows])
                if method == "POST" and len(parts) == 1:
                    b = self.body()
                    name = (b.get("username") or "").strip()
                    if not re.fullmatch(r"[A-Za-z0-9_.\- ]{2,40}", name):
                        return self.err(400, "Username: 2-40 letters, numbers, spaces, . _ -")
                    if len(b.get("password") or "") < 6:
                        return self.err(400, "Password: at least 6 characters")
                    try:
                        con.execute("INSERT INTO users(username, pw, is_admin, created) VALUES (?,?,?,?)",
                                    (name, hash_pw(b["password"]), 1 if b.get("isAdmin") else 0, time.time()))
                    except sqlite3.IntegrityError:
                        return self.err(400, "That username is taken")
                    return self.send_json({"ok": True})
                if len(parts) == 2 and parts[1].isdigit():
                    uid = int(parts[1])
                    if method == "DELETE":
                        if uid == u["id"]:
                            return self.err(400, "You can't delete yourself")
                        con.execute("DELETE FROM users WHERE id=?", (uid,))
                        return self.send_json({"ok": True})
                    if method == "PUT":
                        b = self.body()
                        if b.get("password"):
                            if len(b["password"]) < 6:
                                return self.err(400, "Password: at least 6 characters")
                            con.execute("UPDATE users SET pw=? WHERE id=?", (hash_pw(b["password"]), uid))
                            con.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
                        return self.send_json({"ok": True})
            return self.err(404, "not found")

        # ----- lists
        if path == "parse" and method == "POST":
            raw = (self.body().get("raw") or "").strip()
            if not raw:
                return self.err(400, "Paste a list first")
            return self.send_json(parse_list(raw, RULES))
        if parts[0] == "lists":
            with db() as con:
                if len(parts) == 1 and method == "GET":
                    rows = con.execute("SELECT * FROM lists WHERE user_id=? ORDER BY updated DESC", (u["id"],)).fetchall()
                    return self.send_json([list_row(r) for r in rows])
                if len(parts) == 1 and method == "POST":
                    b = self.body()
                    raw = (b.get("raw") or "").strip()
                    if not raw:
                        return self.err(400, "Paste a list first")
                    p = parse_list(raw, RULES)
                    if "error" in p:
                        return self.err(400, p["error"])
                    name = (b.get("name") or p.get("name") or p["faction"]).strip()[:120]
                    now = time.time()
                    cur = con.execute("INSERT INTO lists(user_id,name,faction,slug,points,raw,parsed,created,updated) "
                                      "VALUES (?,?,?,?,?,?,?,?,?)",
                                      (u["id"], name, p["faction"], p["slug"], p.get("points"), raw, json.dumps(p), now, now))
                    r = con.execute("SELECT * FROM lists WHERE id=?", (cur.lastrowid,)).fetchone()
                    return self.send_json(list_row(r, True))
                if len(parts) == 3 and parts[1].isdigit() and parts[2] == "layouts":
                    # deployment templates for one list: GET all, POST a new one
                    lid = int(parts[1])
                    if not con.execute("SELECT 1 FROM lists WHERE id=? AND user_id=?", (lid, u["id"])).fetchone():
                        return self.err(404, "List not found")
                    if method == "GET":
                        rows = con.execute("SELECT * FROM layouts WHERE list_id=? AND user_id=? ORDER BY battleplan, name",
                                           (lid, u["id"])).fetchall()
                        return self.send_json([layout_row(x) for x in rows])
                    if method == "POST":
                        b = self.body()
                        bp, name = (b.get("battleplan") or "").strip()[:80], (b.get("name") or "").strip()[:80]
                        if not bp or not name or not isinstance(b.get("data"), dict):
                            return self.err(400, "Need a battleplan, a name and the layout")
                        now = time.time()
                        cur = con.execute("INSERT INTO layouts(user_id,list_id,battleplan,name,data,created,updated) VALUES (?,?,?,?,?,?,?)",
                                          (u["id"], lid, bp, name, json.dumps(b["data"]), now, now))
                        return self.send_json(layout_row(con.execute("SELECT * FROM layouts WHERE id=?", (cur.lastrowid,)).fetchone()))
                if len(parts) == 2 and parts[1].isdigit():
                    lid = int(parts[1])
                    r = con.execute("SELECT * FROM lists WHERE id=? AND user_id=?", (lid, u["id"])).fetchone()
                    if not r:
                        return self.err(404, "List not found")
                    if method == "GET":
                        return self.send_json(list_row(r, True))
                    if method == "DELETE":
                        con.execute("DELETE FROM lists WHERE id=?", (lid,))
                        return self.send_json({"ok": True})
                    if method == "PUT":
                        b = self.body()
                        raw = (b.get("raw") or r["raw"]).strip()
                        p = parse_list(raw, RULES) if raw != r["raw"] or b.get("reparse") else json.loads(r["parsed"])
                        if "error" in p:
                            return self.err(400, p["error"])
                        con.execute("UPDATE lists SET name=?, raw=?, parsed=?, faction=?, slug=?, points=?, notes=?, updated=? WHERE id=?",
                                    ((b.get("name") or r["name"]).strip()[:120], raw, json.dumps(p), p["faction"], p["slug"],
                                     p.get("points"), b.get("notes", r["notes"]), time.time(), lid))
                        r = con.execute("SELECT * FROM lists WHERE id=?", (lid,)).fetchone()
                        return self.send_json(list_row(r, True))
            return self.err(404, "not found")

        # ----- deployment templates: PUT (rename / overwrite), DELETE
        if parts[0] == "layouts" and len(parts) == 2 and parts[1].isdigit():
            with db() as con:
                r = con.execute("SELECT * FROM layouts WHERE id=? AND user_id=?", (int(parts[1]), u["id"])).fetchone()
                if not r:
                    return self.err(404, "Layout not found")
                if method == "DELETE":
                    con.execute("DELETE FROM layouts WHERE id=?", (r["id"],))
                    return self.send_json({"ok": True})
                if method == "PUT":
                    b = self.body()
                    name = (b.get("name") or r["name"]).strip()[:80]
                    data = json.dumps(b["data"]) if isinstance(b.get("data"), dict) else r["data"]
                    con.execute("UPDATE layouts SET name=?, data=?, updated=? WHERE id=?", (name, data, time.time(), r["id"]))
                    return self.send_json(layout_row(con.execute("SELECT * FROM layouts WHERE id=?", (r["id"],)).fetchone()))
            return self.err(404, "not found")

        # ----- stats
        if parts[0] == "stats" and method == "GET":
            name = parts[1] if len(parts) > 1 else "overview"
            if not re.fullmatch(r"[a-z0-9-]+", name):
                return self.err(400, "bad faction")
            f = DIGEST / f"{name}.json"
            if not f.exists():
                return self.send_json({"missing": True})
            return self.send_json(json.loads(f.read_text()))

        return self.err(404, "not found")


def main():
    port = 8790
    host = "127.0.0.1"
    if "--port" in sys.argv:
        port = int(sys.argv[sys.argv.index("--port") + 1])
    if "--lan" in sys.argv:
        host = "0.0.0.0"
    init_db()
    srv = ThreadingHTTPServer((host, port), Handler)
    print(f"Battle Companion on http://{'localhost' if host == '127.0.0.1' else host}:{port}")
    srv.serve_forever()


if __name__ == "__main__":
    main()
