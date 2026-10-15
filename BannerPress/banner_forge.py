"""
BannerForge — banner authoring tool for GachAlexia.

Reads CardPress output (../CardPress/cards_out.json), shows which cards are
NOT yet in ../cards.js, and inserts them (exclusive: true) plus a new banner
entry into ../cards.js — in the right places, no manual editing.

Usage:
    python banner_forge.py          # GUI
    python banner_forge.py --cli    # terminal prompts

No network access needed — pure file manipulation (with a .bak backup).
"""

import json
import re
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
CARDS_JS = HERE.parent / "cards.js"
CARDS_OUT = HERE.parent / "CardPress" / "cards_out.json"

TIER_NAMES = {1: "bronze", 2: "silver", 4: "soul"}

# Placeholder Court passives for forged cards (banner-flavored, tier-scaled).
# Retune in cards.js after forging — every card must ship with a passive.
PLACEHOLDER_PASSIVES = {
    1: '{ kind: "rareRateUp", value: 0.01, blurb: "+1% rare-group rate" }',
    2: '{ kind: "bannerLuck", value: 0.05, blurb: "+5% banner 50/50 odds" }',
    4: '{ kind: "bannerLuck", value: 0.10, blurb: "+10% banner 50/50 odds" }',
}


def load_log_cards() -> list[dict]:
    """Cards from the CardPress log, deduped by id (last entry wins —
    CardPress appends renames/re-uploads as new records)."""
    if not CARDS_OUT.exists():
        raise SystemExit(f"❌ CardPress log not found: {CARDS_OUT}")
    data = json.loads(CARDS_OUT.read_text(encoding="utf-8"))
    by_id = {}
    for c in data:
        if c.get("id"):
            by_id[c["id"]] = c
    return list(by_id.values())


def load_existing_ids() -> set[str]:
    text = CARDS_JS.read_text(encoding="utf-8")
    m = re.search(r"const ENCRYPTED_CARDS = \[(.*?)\];", text, re.S)
    if not m:
        raise SystemExit("❌ ENCRYPTED_CARDS not found in cards.js")
    return set(re.findall(r'id:\s*"([^"]+)"', m.group(1)))


def next_banner_id(text: str) -> str:
    nums = [int(n) for n in re.findall(r'id:\s*"banner-(\d+)"', text)]
    return f"banner-{(max(nums) if nums else 0) + 1:03d}"


def js_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


def insert_banner(cards: list[dict], banner_name: str) -> tuple[str, str]:
    """Insert card defs + a banner entry into cards.js. Returns (banner_id, summary)."""
    text = CARDS_JS.read_text(encoding="utf-8")

    # --- card lines, inserted right before ENCRYPTED_CARDS' closing bracket
    # every card carries a placeholder Court passive — retune in cards.js
    card_lines = "".join(
        f'  {{ id: "{c["id"]}", name: "{js_escape(c["name"])}", tier: {c["tier"]}, exclusive: true, '
        f'passive: {PLACEHOLDER_PASSIVES.get(c["tier"], PLACEHOLDER_PASSIVES[1])}, enc: "{c["enc"]}" }},\n'
        for c in cards
    )
    m = re.search(r"(const ENCRYPTED_CARDS = \[.*?\n)(\];)", text, re.S)
    if not m:
        raise SystemExit("❌ Couldn't locate ENCRYPTED_CARDS closing bracket")
    text = text[:m.start()] + m.group(1) + card_lines + m.group(2) + text[m.end():]

    # --- banner entry, appended inside BANNERS
    banner_id = next_banner_id(text)
    ids_js = ", ".join(f'"{c["id"]}"' for c in cards)
    entry = (
        f'  {{\n'
        f'    id: "{banner_id}",\n'
        f'    name: "{js_escape(banner_name)}",\n'
        f'    cardIds: [{ids_js}]\n'
        f'  }}\n'
    )
    m = re.search(r"(const BANNERS = \[)(.*?)(\n\];)", text, re.S)
    if not m:
        raise SystemExit("❌ Couldn't locate BANNERS closing bracket")
    body = m.group(2)
    # keep a comma after the previous last entry
    if body.strip() and not body.rstrip().endswith(","):
        body = body.rstrip() + ",\n"
    elif body.strip():
        body = body.rstrip() + "\n"
    new_body = body + entry
    text = text[:m.start()] + m.group(1) + new_body + m.group(3) + text[m.end():]

    # backup then write
    shutil.copy2(CARDS_JS, CARDS_JS.with_suffix(".js.bak"))
    CARDS_JS.write_text(text, encoding="utf-8")

    summary = f"{banner_id} «{banner_name}»: " + ", ".join(
        f'{c["id"]} {c["name"]} ({TIER_NAMES.get(c["tier"], "?")})' for c in cards
    )
    return banner_id, summary


# ---- CLI --------------------------------------------------------------------

def pick_cards_cli(unused: list[dict]) -> list[dict]:
    print("Cards in cards_out.json not yet in cards.js:")
    for i, c in enumerate(unused, 1):
        print(f"  {i:2d}. {c['id']:5s} {c['name']:25s} ({TIER_NAMES.get(c['tier'], '?')})")
    raw = input("Pick numbers (comma-separated): ").strip()
    picks = [unused[int(x.strip()) - 1] for x in raw.split(",") if x.strip()]
    if not picks:
        raise SystemExit("no cards picked — aborting")
    tiers = {c["tier"] for c in picks}
    print(f"composition: " + ", ".join(f"{sum(1 for c in picks if c['tier']==t)} {TIER_NAMES[t]}" for t in sorted(tiers)))
    return picks


def run_cli():
    log_cards = load_log_cards()
    existing = load_existing_ids()
    unused = [c for c in log_cards if c["id"] not in existing]
    if not unused:
        raise SystemExit("✓ every card in cards_out.json is already in cards.js")
    picks = pick_cards_cli(unused)
    default_name = next((c["name"] for c in picks if c["tier"] == 4), picks[0]["name"])
    name = input(f'Banner name (default "{default_name}"): ').strip() or default_name
    banner_id, summary = insert_banner(picks, name)
    print(f"\n✅ inserted into cards.js (backup: cards.js.bak)\n   {summary}")
    print(f"   publish it with BannerPress when ready (banner id: {banner_id})")


# ---- GUI --------------------------------------------------------------------

def run_gui():
    import tkinter as tk
    from tkinter import messagebox

    log_cards = load_log_cards()
    existing = load_existing_ids()
    unused = [c for c in log_cards if c["id"] not in existing]

    root = tk.Tk()
    root.title("BannerForge — banner author")
    root.configure(bg="#1a0014")
    root.geometry("640x560")

    fg, accent = "#e8a0d0", "#ff60a0"
    tk.Label(root, text="✦ BannerForge ✦", bg="#1a0014", fg=accent,
             font=("Segoe UI", 18, "italic")).pack(pady=(18, 2))
    tk.Label(root, text="new cards from CardPress — tick the banner's picks",
             bg="#1a0014", fg=fg, font=("Segoe UI", 10)).pack()

    if not unused:
        tk.Label(root, text="✓ every logged card is already in cards.js",
                 bg="#1a0014", fg=fg, font=("Segoe UI", 12)).pack(expand=True)
        tk.Button(root, text="close", command=root.destroy).pack(pady=12)
        root.mainloop()
        return

    list_frame = tk.Frame(root, bg="#1a0014")
    list_frame.pack(fill="both", expand=True, padx=24, pady=12)

    vars_ = []
    for c in unused:
        v = tk.BooleanVar(value=False)
        vars_.append((v, c))
        tk.Checkbutton(
            list_frame,
            text=f'{c["id"]:5s}  {c["name"]:28s}  {TIER_NAMES.get(c["tier"], "?")}',
            variable=v, bg="#1a0014", fg=fg, selectcolor="#3a002c",
            activebackground="#1a0014", activeforeground="#ffd5ec",
            font=("Consolas", 10), anchor="w",
        ).pack(fill="x", pady=1)

    name_frame = tk.Frame(root, bg="#1a0014")
    name_frame.pack(pady=4)
    tk.Label(name_frame, text="banner name:", bg="#1a0014", fg=fg,
             font=("Segoe UI", 10)).pack(side="left")
    name_var = tk.StringVar()
    tk.Entry(name_frame, textvariable=name_var, width=28, bg="#24001c", fg="#ffd5ec",
             insertbackground="#ffd5ec", font=("Segoe UI", 10)).pack(side="left", padx=8)

    status = tk.Label(root, text="", bg="#1a0014", fg=accent,
                      font=("Segoe UI", 9), wraplength=580, justify="center")
    status.pack(pady=4)

    def forge():
        picks = [c for v, c in vars_ if v.get()]
        if not picks:
            messagebox.showwarning("BannerForge", "tick at least one card~")
            return
        default_name = next((c["name"] for c in picks if c["tier"] == 4), picks[0]["name"])
        name = name_var.get().strip() or default_name
        try:
            banner_id, summary = insert_banner(picks, name)
        except SystemExit as e:
            status.config(text=str(e))
            return
        status.config(text=f"✅ {summary}\n(backup: cards.js.bak — publish with BannerPress)")
        # refresh the list so re-running shows remaining cards
        for v, c in vars_:
            if c in picks:
                v.set(False)
        root.title(f"BannerForge — created {banner_id}")

    tk.Button(root, text="🔥 Forge banner", command=forge,
              bg="#3a002c", fg="#ffd5ec", font=("Segoe UI", 12),
              activebackground="#5a0044", relief="flat",
              padx=18, pady=6, cursor="hand2").pack(pady=8)

    root.mainloop()


if __name__ == "__main__":
    if "--cli" in sys.argv:
        run_cli()
    else:
        run_gui()
