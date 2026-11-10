#!/usr/bin/env python3
"""Export a user's lists and saved deployments from the old local server database (data/app.db)
into the Battle Companion export format, for Settings > Backup > Import on the Supabase site.

  python3 tools/export_local.py admin data/export-admin.json
"""
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
user, out = sys.argv[1], Path(sys.argv[2])
con = sqlite3.connect(ROOT / "data" / "app.db")
con.row_factory = sqlite3.Row
uid = con.execute("SELECT id FROM users WHERE username=?", (user,)).fetchone()["id"]
lists = []
for l in con.execute("SELECT * FROM lists WHERE user_id=? ORDER BY updated DESC", (uid,)):
    lays = con.execute("SELECT battleplan, name, data FROM layouts WHERE list_id=? ORDER BY battleplan, name", (l["id"],)).fetchall()
    lists.append({"name": l["name"], "raw": l["raw"], "parsed": json.loads(l["parsed"]), "notes": l["notes"] or "",
                  "layouts": [{"battleplan": t["battleplan"], "name": t["name"], "data": json.loads(t["data"])} for t in lays]})
out.write_text(json.dumps({"app": "battle-companion", "version": 1, "exported": datetime.now(timezone.utc).isoformat(), "lists": lists}, indent=1))
print(f"{len(lists)} lists, {sum(len(l['layouts']) for l in lists)} deployments -> {out}")
