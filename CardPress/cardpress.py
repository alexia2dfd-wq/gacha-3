"""
CardPress — GachAlexia card asset pipeline
==========================================
Upload card images to Cloudinary, encrypt the links (AES-GCM), and emit
copy-pastable ENCRYPTED_CARDS snippets for the extension.

Usage:
    python cardpress.py              # launch GUI
    python cardpress.py --gen-key    # generate a new cardkey.hex (first run)

Requires: requests, cryptography, Pillow
    pip install requests cryptography Pillow
"""

import base64
import hashlib
import json
import os
import sys
import threading
import tkinter as tk
from tkinter import ttk, filedialog, messagebox

import requests
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

try:
    from PIL import Image, ImageTk
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

CLOUD_NAME = "ddjjknjpb"          # from EdgeLandmine
UPLOAD_PRESET = "wallpaper_upload"                # TODO: create an UNSIGNED upload preset in
                                  # Cloudinary console → Settings → Upload,
                                  # and paste its name here.

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
KEY_FILE = os.path.join(BASE_DIR, "cardkey.hex")
LOG_FILE = os.path.join(BASE_DIR, "cards_out.json")

TIER_PREFIX = {1: "b", 2: "s", 4: "l"}          # bronze / silver / soul
TIER_NAMES = {1: "Bronze", 2: "Silver", 4: "Soul"}

# ---------------------------------------------------------------------------
# Key management
# ---------------------------------------------------------------------------

def generate_key():
    """Create a new 256-bit key and print extension-ready key pieces."""
    key = AESGCM.generate_key(bit_length=256)
    hexkey = key.hex()
    with open(KEY_FILE, "w") as f:
        f.write(hexkey)

    # split into 3 pieces for obfuscated storage in the extension
    h = hexkey
    p1, p2, p3 = h[:22], h[22:44], h[44:]
    print("New key written to cardkey.hex")
    print("Paste these pieces into the extension (cards.js):")
    print(f'  const KEY_P1 = "{p1}";')
    print(f'  const KEY_P2 = "{p2}";')
    print(f'  const KEY_P3 = "{p3}";')
    print("  // reassemble: KEY_P1 + KEY_P2 + KEY_P3, hex → bytes")


def load_key():
    if not os.path.exists(KEY_FILE):
        return None
    with open(KEY_FILE) as f:
        return bytes.fromhex(f.read().strip())

# ---------------------------------------------------------------------------
# Crypto
# ---------------------------------------------------------------------------

def encrypt_url(url, key):
    """AES-256-GCM encrypt a URL → base64(iv + ciphertext+tag)."""
    iv = os.urandom(12)
    ct = AESGCM(key).encrypt(iv, url.encode(), None)
    return base64.b64encode(iv + ct).decode()

# ---------------------------------------------------------------------------
# Cloudinary
# ---------------------------------------------------------------------------

def upload_image(path):
    """Upload to Cloudinary (unsigned preset) → secure CDN URL."""
    url = f"https://api.cloudinary.com/v1_1/{CLOUD_NAME}/image/upload"
    with open(path, "rb") as f:
        resp = requests.post(url,
                             data={"upload_preset": UPLOAD_PRESET},
                             files={"file": f},
                             timeout=60)
    resp.raise_for_status()
    return resp.json()["secure_url"]

# ---------------------------------------------------------------------------
# Log / ids / dupe detection
# ---------------------------------------------------------------------------

def load_log():
    if os.path.exists(LOG_FILE):
        try:
            with open(LOG_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return []
    return []


def save_log(entries):
    with open(LOG_FILE, "w") as f:
        json.dump(entries, f, indent=2)


def next_id(tier, log):
    prefix = TIER_PREFIX[tier]
    nums = [int(c["id"][1:]) for c in log
            if c.get("id") and c["id"].startswith(prefix)
            and c["id"][1:].isdigit()]
    return f"{prefix}{(max(nums) + 1) if nums else 1:02d}"


def file_md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()

# ---------------------------------------------------------------------------
# GUI
# ---------------------------------------------------------------------------

class CardPress(tk.Tk):
    BG = "#140014"
    BG2 = "#250022"
    FG = "#e08cd7"
    ACCENT = "#c21590"
    FONT = ("Segoe UI", 10)

    def __init__(self):
        super().__init__()
        self.title("CardPress~")
        self.configure(bg=self.BG)
        self.minsize(760, 560)

        self.key = load_key()
        self.log_entries = load_log()
        self.queue = []          # [{path, hash, url, enc, name, tier, id, status}]
        self._thumbs = []        # keep PhotoImage refs alive

        self._build_header()
        self._build_queue_view()
        self._build_actions()
        self._build_stats()
        self._refresh_stats()

        if not self.key:
            self._set_status("⚠ no cardkey.hex — use --gen-key first")
        if not UPLOAD_PRESET:
            self._set_status("⚠ UPLOAD_PRESET not set in cardpress.py")

    # ---- layout ----

    def _build_header(self):
        top = tk.Frame(self, bg=self.BG)
        top.pack(fill="x", padx=14, pady=(12, 4))
        tk.Label(top, text="🎀 CardPress~", bg=self.BG, fg=self.FG,
                 font=("Segoe UI", 16, "italic")).pack(side="left")
        self.status_lbl = tk.Label(top, text="", bg=self.BG, fg="#a0609a",
                                   font=self.FONT)
        self.status_lbl.pack(side="right")

    def _build_queue_view(self):
        frame = tk.Frame(self, bg=self.BG2, bd=0)
        frame.pack(fill="both", expand=True, padx=14, pady=8)

        self.canvas = tk.Canvas(frame, bg=self.BG2, highlightthickness=0)
        scroll = ttk.Scrollbar(frame, orient="vertical",
                               command=self.canvas.yview)
        self.inner = tk.Frame(self.canvas, bg=self.BG2)
        self.inner.bind("<Configure>", lambda e: self.canvas.configure(
            scrollregion=self.canvas.bbox("all")))
        self.canvas.create_window((0, 0), window=self.inner, anchor="nw")
        self.canvas.configure(yscrollcommand=scroll.set)
        self.canvas.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")

    def _build_actions(self):
        bar = tk.Frame(self, bg=self.BG)
        bar.pack(fill="x", padx=14, pady=6)
        self._btn(bar, "＋ Add Images", self.add_images).pack(side="left", padx=4)
        self._btn(bar, "☁ Upload All", self.upload_all).pack(side="left", padx=4)
        self._btn(bar, "📋 Copy Snippet", self.copy_snippet).pack(side="left", padx=4)
        self._btn(bar, "✎ Rename Cards", self.open_rename).pack(side="left", padx=4)

    def _build_stats(self):
        self.stats_lbl = tk.Label(self, text="", bg=self.BG, fg="#a0609a",
                                  font=self.FONT)
        self.stats_lbl.pack(pady=(0, 10))

    def _btn(self, parent, text, cmd):
        return tk.Button(parent, text=text, command=cmd, bg=self.ACCENT,
                         fg="white", font=self.FONT, bd=0, padx=14, pady=6,
                         activebackground="#d81aa4", cursor="hand2")

    def _set_status(self, msg):
        self.status_lbl.config(text=msg)

    # ---- queue handling ----

    def add_images(self):
        paths = filedialog.askopenfilenames(
            title="Choose card images",
            filetypes=[("Images", "*.png *.jpg *.jpeg *.webp")])
        if not paths:
            return
        known = {c.get("hash") for c in self.log_entries}
        for p in paths:
            h = file_md5(p)
            entry = {"path": p, "hash": h, "url": None, "enc": None,
                     "name": os.path.splitext(os.path.basename(p))[0],
                     "tier": 1, "id": None, "status": "ready"}
            if h in known:
                entry["status"] = "⚠ dupe of an uploaded card"
            self.queue.append(entry)
        self._redraw_queue()

    def _redraw_queue(self):
        for w in self.inner.winfo_children():
            w.destroy()
        self._thumbs.clear()

        for i, e in enumerate(self.queue):
            row = tk.Frame(self.inner, bg=self.BG2)
            row.pack(fill="x", pady=3, padx=6)

            # thumbnail
            if HAS_PIL:
                try:
                    img = Image.open(e["path"]); img.thumbnail((56, 80))
                    ph = ImageTk.PhotoImage(img)
                    self._thumbs.append(ph)
                    tk.Label(row, image=ph, bg=self.BG2).pack(side="left", padx=4)
                except Exception:
                    tk.Label(row, text="🖼", bg=self.BG2, fg=self.FG,
                             width=4).pack(side="left", padx=4)

            # name
            name_var = tk.StringVar(value=e["name"])
            name_var.trace_add("write", lambda *a, i=i, v=name_var:
                               self.queue[i].update(name=v.get()))
            tk.Entry(row, textvariable=name_var, bg=self.BG, fg=self.FG,
                     insertbackground=self.FG, bd=0, font=self.FONT,
                     width=24).pack(side="left", padx=6)

            # tier
            tier_var = tk.StringVar(value=TIER_NAMES[e["tier"]])
            cb = ttk.Combobox(row, textvariable=tier_var, state="readonly",
                              values=list(TIER_NAMES.values()), width=8)
            cb.pack(side="left", padx=4)
            cb.bind("<<ComboboxSelected>>",
                    lambda ev, i=i, v=tier_var: self.queue[i].update(
                        tier={n: t for t, n in TIER_NAMES.items()}[v.get()]))

            # status
            tk.Label(row, text=e["status"], bg=self.BG2, fg="#a0609a",
                     font=self.FONT).pack(side="left", padx=10)

    # ---- upload + encrypt ----

    def upload_all(self):
        if not self.key:
            messagebox.showerror("No key", "Run: python cardpress.py --gen-key")
            return
        if not UPLOAD_PRESET:
            messagebox.showerror("No preset",
                                 "Set UPLOAD_PRESET in cardpress.py")
            return
        todo = [e for e in self.queue if e["url"] is None]
        if not todo:
            self._set_status("nothing to upload~")
            return
        threading.Thread(target=self._upload_worker, args=(todo,),
                         daemon=True).start()

    def _upload_worker(self, todo):
        for e in todo:
            try:
                self._ui(lambda e=e: e.update(status="uploading…"))
                self._redraw_safe()
                url = upload_image(e["path"])
                enc = encrypt_url(url, self.key)
                cid = next_id(e["tier"], self.log_entries + self.queue)
                e.update(url=url, enc=enc, id=cid, status="✓ done")
            except Exception as ex:
                e.update(status=f"✗ {ex}")
            self._redraw_safe()
        # persist to log (only fully-processed cards with an id)
        done = [c for c in self.queue if c["enc"] and c["id"]]
        self.log_entries.extend(
            {"id": c["id"], "name": c["name"], "tier": c["tier"],
             "enc": c["enc"], "hash": c["hash"], "url": c["url"]}
            for c in done if c not in self.log_entries)
        save_log(self.log_entries)
        self._ui(self._refresh_stats)
        self._ui(lambda: self._set_status("upload complete~ 📋 Copy Snippet"))

    def _ui(self, fn):
        self.after(0, fn)

    def _redraw_safe(self):
        self._ui(self._redraw_queue)

    # ---- output ----

    def copy_snippet(self):
        done = [c for c in self.queue if c["enc"]]
        if not done:
            self._set_status("nothing encrypted yet~")
            return
        lines = ["const ENCRYPTED_CARDS = ["]
        for c in done:
            lines.append(f'  {{ id: "{c["id"]}", name: "{c["name"]}", '
                         f'tier: {c["tier"]}, enc: "{c["enc"]}" }},')
        lines.append("];")
        snippet = "\n".join(lines)
        self.clipboard_clear()
        self.clipboard_append(snippet)
        self._set_status(f"copied {len(done)} card(s) to clipboard~ 💋")

    # ---- rename manager (edits the uploaded-card log) ----

    def open_rename(self):
        if not self.log_entries:
            self._set_status("no uploaded cards yet~")
            return
        win = tk.Toplevel(self)
        win.title("Rename Cards~")
        win.configure(bg=self.BG)
        win.minsize(560, 320)
        win.transient(self)

        canvas = tk.Canvas(win, bg=self.BG, highlightthickness=0)
        scroll = ttk.Scrollbar(win, orient="vertical", command=canvas.yview)
        inner = tk.Frame(canvas, bg=self.BG)
        inner.bind("<Configure>", lambda e: canvas.configure(
            scrollregion=canvas.bbox("all")))
        canvas.create_window((0, 0), window=inner, anchor="nw")
        canvas.configure(yscrollcommand=scroll.set)
        canvas.pack(side="left", fill="both", expand=True, padx=(14, 0), pady=10)
        scroll.pack(side="right", fill="y", pady=10)

        name_vars = []
        for c in sorted(self.log_entries,
                        key=lambda x: (x["tier"], x["id"])):
            row = tk.Frame(inner, bg=self.BG)
            row.pack(fill="x", pady=2, padx=6)
            tk.Label(row, text=f'{c["id"]} · {TIER_NAMES[c["tier"]]}',
                     bg=self.BG, fg="#a0609a", font=self.FONT,
                     width=14, anchor="w").pack(side="left")
            var = tk.StringVar(value=c["name"])
            name_vars.append((c, var))
            tk.Entry(row, textvariable=var, bg=self.BG2, fg=self.FG,
                     insertbackground=self.FG, bd=0, font=self.FONT,
                     width=34).pack(side="left", padx=8)

        btns = tk.Frame(win, bg=self.BG)
        btns.place(relx=0.5, rely=1.0, anchor="s", y=-8)
        self._btn(btns, "💾 Save Names",
                  lambda: self._save_renames(name_vars, win)).pack(side="left", padx=4)
        self._btn(btns, "📋 Copy Full Snippet",
                  lambda: self._copy_log_snippet(win)).pack(side="left", padx=4)

    def _save_renames(self, name_vars, win):
        changed = 0
        for c, var in name_vars:
            new = var.get().strip()
            if new and new != c["name"]:
                c["name"] = new
                changed += 1
        save_log(self.log_entries)
        win.destroy()
        self._set_status(f"renamed {changed} card(s)~ 💾")

    def _copy_log_snippet(self, win):
        lines = ["const ENCRYPTED_CARDS = ["]
        for c in sorted(self.log_entries, key=lambda x: (x["tier"], x["id"])):
            lines.append(f'  {{ id: "{c["id"]}", name: "{c["name"]}", '
                         f'tier: {c["tier"]}, enc: "{c["enc"]}" }},')
        lines.append("];")
        self.clipboard_clear()
        self.clipboard_append("\n".join(lines))
        win.destroy()
        self._set_status(f"copied all {len(self.log_entries)} card(s)~ 💋")

    # ---- stats ----

    def _refresh_stats(self):
        counts = {1: 0, 2: 0, 4: 0}
        for c in self.log_entries:
            counts[c["tier"]] = counts.get(c["tier"], 0) + 1
        self.stats_lbl.config(
            text=f"uploaded pool — bronze: {counts[1]} · "
                 f"silver: {counts[2]} · soul: {counts[4]}")

# ---------------------------------------------------------------------------

if __name__ == "__main__":
    if "--gen-key" in sys.argv:
        generate_key()
    else:
        CardPress().mainloop()
