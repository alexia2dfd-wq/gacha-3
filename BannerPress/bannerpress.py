"""
BannerPress — banner schedule publisher for GachAlexia.

Reads the BANNERS registry from ../cards.js, lets you pick a banner and a
window, then publishes banner/current.json to the gacha-3 GitHub repo via a
scratch git clone. The extension fetches the raw.githubusercontent.com URL
to decide which banner is live and when.

Why GitHub and not Cloudinary: Cloudinary's CDN caches raw uploads for
30 days (Cache-Control: max-age=2592000) and strips query strings from the
cache key — overwriting current-banner.json there means users see a stale
schedule for up to a month. raw.githubusercontent.com updates within
seconds of a push.

Usage:
    python bannerpress.py            # GUI
    python bannerpress.py --cli      # terminal prompts instead

Requires: git on PATH, with push credentials for the repo (cached by your
normal git setup — no tokens in this file).
"""

import json
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

# ---- config ---------------------------------------------------------------
REPO_URL  = "https://github.com/alexia2dfd-wq/gacha-3.git"
REPO_FILE = Path("banner") / "current.json"   # path inside the repo
# served at: https://raw.githubusercontent.com/alexia2dfd-wq/gacha-3/main/banner/current.json
CARDS_JS = Path(__file__).resolve().parent.parent / "cards.js"
# ---------------------------------------------------------------------------


def load_banners(path: Path) -> list[dict]:
    """Extract the BANNERS array from cards.js (lenient JS-object parsing)."""
    text = path.read_text(encoding="utf-8")
    m = re.search(r"const BANNERS = \[(.*?)\];", text, re.S)
    if not m:
        raise SystemExit("❌ No BANNERS registry found in cards.js")
    body = m.group(1)
    banners = []
    for block in re.findall(r"\{(.*?)\}", body, re.S):
        def grab(key, default=None):
            km = re.search(rf'{key}:\s*"([^"]*)"', block)
            return km.group(1) if km else default
        ids_m = re.search(r"cardIds:\s*\[([^\]]*)\]", block)
        card_ids = re.findall(r'"([^"]+)"', ids_m.group(1)) if ids_m else []
        banners.append({
            "id": grab("id"),
            "name": grab("name"),
            "cardIds": card_ids,
            "startsAt": grab("startsAt"),
            "endsAt": grab("endsAt"),
        })
    if not banners:
        raise SystemExit("❌ BANNERS registry is empty")
    return banners


def load_card_names(path: Path) -> dict:
    """id → name map from ENCRYPTED_CARDS, for display purposes."""
    text = path.read_text(encoding="utf-8")
    m = re.search(r"const ENCRYPTED_CARDS = \[(.*?)\];", text, re.S)
    if not m:
        return {}
    out = {}
    for block in re.findall(r"\{(.*?)\}", m.group(1), re.S):
        id_m = re.search(r'id:\s*"([^"]+)"', block)
        name_m = re.search(r'name:\s*"([^"]+)"', block)
        if id_m and name_m:
            out[id_m.group(1)] = name_m.group(1)
    return out


def _git(args: list[str], cwd: Path):
    """Run a git command, raising SystemExit with stderr on failure."""
    r = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise SystemExit(f"❌ git {' '.join(args[:2])} failed (rc={r.returncode}): "
                         f"{r.stderr.strip()[:600] or r.stdout.strip()[:600]}")
    return r


def publish_schedule(payload: dict) -> str:
    """Push the schedule JSON to banner/current.json on the repo's main branch.

    Uses a throwaway scratch clone so the user's working tree is never
    touched. Relies on the machine's cached git credentials (no tokens here).
    """
    scratch = Path(tempfile.mkdtemp(prefix="bannerpress-"))
    try:
        _git(["clone", "--depth", "1", REPO_URL, str(scratch)], cwd=scratch.parent)
        target = scratch / REPO_FILE
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        _git(["add", str(REPO_FILE)], cwd=scratch)
        try:
            _git(["-c", "user.name=BannerPress", "-c", "user.email=bannerpress@gachalexia.local",
                  "commit", "-m", f"banner schedule: {payload['bannerId']} until {payload.get('endsAt', 'open')}"],
                 cwd=scratch)
        except SystemExit as e:
            # identical payload already published — that's success, not failure
            if "nothing to commit" not in str(e):
                raise
        else:
            _git(["push", "origin", "HEAD:main"], cwd=scratch)
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    return "https://raw.githubusercontent.com/alexia2dfd-wq/gacha-3/main/banner/current.json"


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---- CLI mode ---------------------------------------------------------------

def run_cli():
    banners = load_banners(CARDS_JS)
    names = load_card_names(CARDS_JS)
    print("Available banners:")
    for i, b in enumerate(banners, 1):
        cards = ", ".join(f"{cid} ({names.get(cid, '?')})" for cid in b["cardIds"])
        print(f"  {i}. {b['id']} — {b['name']}  [{cards}]")
    pick = input("Pick a banner number (or 'q' to quit): ").strip()
    if pick.lower() == "q":
        return
    banner = banners[int(pick) - 1]

    days = input("Duration in days (default 14, 0 = open-ended): ").strip() or "14"
    days = int(days)
    start = datetime.now(timezone.utc)
    payload = {"bannerId": banner["id"], "startsAt": iso(start)}
    if days > 0:
        payload["endsAt"] = iso(start + timedelta(days=days))

    print(f"\nPublishing: {json.dumps(payload, indent=2)}\n")
    url = publish_schedule(payload)
    print(f"✅ Live at: {url}")
    print("(extensions pick it up on next poll — worst case the 6h alarm)")


# ---- GUI mode ---------------------------------------------------------------

def run_gui():
    import tkinter as tk
    from tkinter import messagebox, ttk

    banners = load_banners(CARDS_JS)
    names = load_card_names(CARDS_JS)

    root = tk.Tk()
    root.title("BannerPress — banner scheduler")
    root.configure(bg="#1a0014")
    root.geometry("560x440")

    fg, accent = "#e8a0d0", "#ff60a0"
    tk.Label(root, text="✦ BannerPress ✦", bg="#1a0014", fg=accent,
             font=("Segoe UI", 18, "italic")).pack(pady=(18, 4))
    tk.Label(root, text="pick a banner, set the window, publish",
             bg="#1a0014", fg=fg, font=("Segoe UI", 10)).pack()

    frame = tk.Frame(root, bg="#1a0014")
    frame.pack(fill="both", expand=True, padx=24, pady=14)

    rows = [f"{b['id']}  ·  {b['name']}  ·  {', '.join(b['cardIds'])}" for b in banners]
    lb = tk.Listbox(frame, font=("Consolas", 10), bg="#24001c", fg=fg,
                    selectbackground="#4a0036", selectforeground="#ffd5ec",
                    activestyle="none", height=8)
    for r in rows:
        lb.insert("end", r)
    lb.pack(fill="both", expand=True)
    lb.selection_set(0)

    opts = tk.Frame(root, bg="#1a0014")
    opts.pack(pady=6)
    tk.Label(opts, text="duration (days):", bg="#1a0014", fg=fg,
             font=("Segoe UI", 10)).pack(side="left")
    days_var = tk.StringVar(value="14")
    ttk.Entry(opts, textvariable=days_var, width=6).pack(side="left", padx=6)

    status = tk.Label(root, text="", bg="#1a0014", fg=accent,
                      font=("Segoe UI", 9), wraplength=520, justify="center")
    status.pack(pady=4)

    def publish():
        sel = lb.curselection()
        if not sel:
            messagebox.showwarning("BannerPress", "pick a banner first~")
            return
        banner = banners[sel[0]]
        try:
            days = int(days_var.get() or "14")
        except ValueError:
            messagebox.showwarning("BannerPress", "duration must be a number")
            return
        start = datetime.now(timezone.utc)
        payload = {"bannerId": banner["id"], "startsAt": iso(start)}
        if days > 0:
            payload["endsAt"] = iso(start + timedelta(days=days))
        status.config(text="publishing to GitHub…")
        root.update_idletasks()
        try:
            url = publish_schedule(payload)
        except SystemExit as e:
            status.config(text=str(e))
            return
        status.config(text=f"✅ live at:\n{url}")
        try:
            root.clipboard_clear()
            root.clipboard_append(url)
        except Exception:
            pass

    tk.Button(root, text="💋 Publish banner", command=publish,
              bg="#3a002c", fg="#ffd5ec", font=("Segoe UI", 12),
              activebackground="#5a0044", relief="flat",
              padx=18, pady=6, cursor="hand2").pack(pady=8)

    root.mainloop()


if __name__ == "__main__":
    if "--cli" in sys.argv:
        run_cli()
    else:
        run_gui()
