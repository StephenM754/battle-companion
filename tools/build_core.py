#!/usr/bin/env python3
"""Build static/data/core.json: the phase-by-phase sequence (Core Rules + GHB 2026-27) the Play tab walks through.

Checklist text is written for the app from data/core_rules_research.json (official Core Rules PDF Apr 2025,
Rules Updates Oct 2026, WarCom GHB 2026-27 articles, wahapedia core-rules page dated after the Oct 2026 update).
Universal abilities the rules corpus already holds (Rally, Redeploy, All-out Attack…) come from the corpus via
ghb.json; this file only adds the ones the corpus lacks (Normal Move, Run, Retreat, Charge, Fight, Banish…).
Re-run after editing the steps below or refreshing the research file.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RESEARCH = ROOT / "data" / "core_rules_research.json"
OUT = ROOT / "static" / "data" / "core.json"

CORE_PDF = "https://assets.warhammer-community.com/eng_aos_core%26key_the-rules_apr25-t7q3fbv0zb-bit50crc5k.pdf"
UPDATES = "https://assets.warhammer-community.com/eng_28-10_aos_core_rules_and_key_downloads_rules_updates-aghvsvstmk-u8wyh173fe.pdf"

PREGAME = [
    "Rosters swapped. Note CP bonuses: <b>+1 CP every round</b> for whoever has fewer auxiliary units; <b>+1 CP in round 1</b> if your army is 50+ pts under the limit.",
    "Battleplan: one player rolls for the table (1-3 table 1, 4-6 table 2), the other rolls for the plan on it, or just agree one. Pick it above to see the map.",
    "Roll off: the winner chooses <b>attacker</b> or <b>defender</b>.",
    "Defender sets up the objectives as the map shows (each scores within 3\" of the 40mm marker).",
    "Defender sets up terrain (map layout, or each piece 3\"+ from edges and objectives, 6\"+ from other terrain).",
    "Attacker picks their territory.",
    "Tell your opponent your 2 battle tactic cards (and theirs to you).",
    "The battle lasts <b>5 battle rounds</b>.",
]
DEPLOYMENT = [
    "Faction terrain first: the attacker uses Deploy Faction Terrain, then the defender (optional). Wholly within your territory, 3\"+ from objectives and other terrain.",
    "Alternate drops, attacker first: <b>Deploy Regiment</b> places a whole regiment as one drop; units wholly within your territory and more than 9\" from enemy territory. Reserves are set up with their own Deploy abilities.",
    "Whoever <b>finishes deploying first</b> will choose who takes the first turn in round 1.",
    "Then other Deployment Phase abilities (the player who began deployment first). Season rule <b>Raising the Heat</b>: attacker sets fury to 1, defender to 2 (set the Fury tracker).",
    "Objective control is checked now, once all Deployment Phase abilities are done (Oct 2026 change).",
    "Battle tactic card picks (e.g. Blazing Onslaught hideout, Burning for Vengeance fugitive) happen after deployment abilities, before choosing the first turn.",
    "No underdog during deployment.",
]
ROUND_START = [
    "<b>Priority:</b> round 1, whoever finished deploying first chooses. From round 2, roll off; the winner chooses. Tie: whoever went first last round chooses. (Regimented Forces: a player with more regiments can re-roll priority once per battle.)",
    "<b>Seizing the initiative:</b> if the player who went second last round goes first now (two turns in a row), they can't complete battle tactics that turn, and their opponent counts as underdog until they seize it back. Not possible if the opponent leads by 11+ VP.",
    "<b>Underdog:</b> the player with fewest VP (tied = no underdog).",
    "<b>Command points:</b> 4 each, +1 underdog, +1 for fewer auxiliary units, +1 round 1 underspend. Set the CP tracker. Unspent CP are lost at the end of the round.",
    "<b>Simmering Rage</b> (mandatory): gain rage dice equal to your fury level. Unspent rage dice are lost at the end of the round.",
    "Start of Battle Round abilities: the player taking the first turn uses theirs first, then the opponent.",
    "<b>Round 4 only:</b> units still in reserve (set up by a Deploy ability) are destroyed.",
]
PHASES = [
    {"id": "start-of-turn", "name": "Start of turn",
     "steps": ["Your Start of Turn abilities first, then your opponent's.",
               "Activate Place of Power (once per turn, either player): a Hero within 3\" of a Place of Power rolls a D6; on 1 it takes D3 mortal damage, on 2+ pick Ignite Fury, Channel Wrath or Dizzying Rage.",
               "Remind yourself which battle tactic tier is next on each card (below)."],
     "oppSteps": ["They use Start of Turn abilities first, then you can use yours (Start of Any Turn / Enemy Turn)."]},
    {"id": "hero", "name": "Hero phase",
     "steps": ["Cast spells: 2D6 casting roll must equal or beat the casting value. Unmodified double 1 = miscast (D3 mortal damage, no more spells this phase). Each Wizard casts as many spells as its power level, each spell once per turn across the army (unless Unlimited).",
               "Chant prayers: D6 chanting roll. Unmodified 1 fails and loses D3 ritual points. Otherwise bank the roll as ritual points, or add banked points to beat the chanting value.",
               "Summon manifestations with their spells/prayers. Banish an enemy manifestation instead of a spell or prayer (2D6 vs banishment, within 30\").",
               "Rally (1 CP) a unit not in combat: 6 dice, each 4+ = 1 point; heal 1 per point, or return a slain model for points equal to its Health.",
               "Other Your/Any Hero Phase abilities, then your opponent uses theirs (e.g. Rally, Magical Intervention)."],
     "oppSteps": ["Watch their casting rolls: a Wizard within 30\" can <b>Unbind</b> (2D6 must beat the casting roll).",
                  "After they finish, you can use Any/Enemy Hero Phase abilities: <b>Rally</b> (1 CP), <b>Magical Intervention</b> (1 CP: cast, chant or banish at -1)."]},
    {"id": "movement", "name": "Movement phase",
     "steps": ["One unit at a time: <b>Normal Move</b> (not in combat, up to Move, can't enter combat), <b>Run</b> (Move + D6; At the Double 1 CP = +6\" instead of rolling), or <b>Retreat</b> (in combat: take D3 mortal damage, move, can't end in combat).",
               "Units that Ran or Retreated can't Shoot or Charge this turn.",
               "End every move in coherency (1/2\"; units of 7+ models each within 1/2\" of two others). Combat range is 3\".",
               "Then your opponent can use Enemy Movement abilities (e.g. Redeploy)."],
     "oppSteps": ["After they move: <b>Redeploy</b> (1 CP) one of your units not in combat D6\", not into or through combat range."]},
    {"id": "shooting", "name": "Shooting phase",
     "steps": ["Pick each unit that didn't Run or Retreat; declare all targets, then roll. In combat, only Shoot in Combat weapons, and only at units it is in combat with.",
               "Hit, wound, save (minus rend), then ward, then allocate damage. Modifiers to hit/wound cap at +1/-1; save bonuses cap at +1.",
               "Guarded Hero (-1 to hit; Infantry heroes can't be shot from 12\"+), Cover (-1 to hit) and Obscuring terrain apply.",
               "All-out Attack (1 CP, +1 to hit, -1 save rest of turn). Your opponent may then use Covering Fire."],
     "oppSteps": ["When they target you: <b>All-out Defence</b> (1 CP, +1 save for that attack).",
                  "After they finish: <b>Covering Fire</b> (1 CP) with a unit that didn't Run and isn't in combat, at the closest valid enemy, -1 to hit."]},
    {"id": "charge", "name": "Charge phase",
     "steps": ["Pick units not in combat that didn't Run or Retreat: roll 2D6, move up to that and end within 1/2\" of a visible enemy unit.",
               "Forward to Victory (1 CP): re-roll the charge roll.",
               "Your opponent may then Counter-charge."],
     "oppSteps": ["After their charges: <b>Counter-charge</b> (2 CP) with one of your units not in combat."]},
    {"id": "combat", "name": "Combat phase",
     "steps": ["1. Combat abilities that aren't Fight abilities: yours first, then your opponent's.",
               "2. Strike-first units fight first (alternating, you first). Check strike-first <b>after</b> step 1 (Oct 2026).",
               "3. Alternate picking units to Fight, starting with you: pile in 3\", then attack with all melee weapons. Every unit in combat must fight; units that charged can fight even if no longer in combat.",
               "4. Strike-last units go after everyone else; the alternation carries on into them.",
               "Reactions: All-out Attack (you) and All-out Defence (defender), 1 CP each. Fight Through the Pain: spend rage dice before damage is allocated (3+ removes 1 damage, fury -1 each)."],
     "oppSteps": ["Same sequence; they pick first, then you alternate. Use All-out Defence / All-out Attack (1 CP) and Fight Through the Pain as needed."]},
    {"id": "end-of-turn", "name": "End of turn",
     "steps": ["End of turn abilities: yours first, then your opponent's. <b>Power Through</b> (1 CP, a unit that charged: D3 mortal damage to a lower-Health enemy in combat, then move). <b>Eruption of Fury</b> (once per turn: spend up to 3 rage dice for extra attacks; 6s deal D3 mortal damage to each enemy in combat and raise the opponent's fury, 1s hurt you).",
               "Check control of every objective (each unit counts towards one objective only).",
               "<b>Score VP</b> for the battleplan (only the player whose turn it is scores).",
               "<b>Battle tactics:</b> complete at most 1 tactic per card (Affray, then Strike, then Domination), 5 VP each. You must complete it if you meet the conditions. None if you seized the initiative this turn.",
               "After the second turn of the round: End of Battle Round abilities, CP reset to 0, unspent rage dice lost."],
     "oppSteps": ["You can use End of Any Turn abilities after them: Power Through, Eruption of Fury.",
                  "Objective control is checked; they score VP and battle tactics (you don't score in their turn).",
                  "If this was the second turn: End of Battle Round abilities, CP reset to 0, rage dice lost."]},
]
OVERVIEW = [
    "A battle is 5 rounds. Each round both players take a turn: Start of Turn, Hero, Movement, Shooting, Charge, Combat, End of Turn.",
    "In every phase the player whose turn it is uses their abilities first, then their opponent. Reactions alternate, starting with whoever used the ability.",
    "Rules of One: max 1 CORE ability and 1 command per unit per phase; each command once per phase per army; an ability can't affect the same unit twice at once.",
    "Victory: 5+ VP ahead is a major win; less than 5 a minor win; VP tied, the player with more battle tactics wins a minor victory.",
]
TACTICS_HOWTO = ("GHB 2026-27: you pick 2 of the 6 cards when you write your list. Each card has Affray, then Strike, then Domination, "
                 "in that order, 5 VP each. At the end of each of your turns you complete at most 1 tactic per card (so up to 2), "
                 "and you must complete one if you meet its conditions. Seizing the initiative stops you completing tactics that turn.")

# abilities the corpus lacks; corpus versions win for everything else
EXTRA = {"Normal Move", "Run", "Retreat", "Shoot", "Charge", "Fight", "Pile-in move (part of Fight)", "Deploy Regiment",
         "Deploy Unit", "Deploy Faction Terrain", "Banish Manifestation", "Activate Place of Power",
         "Regimented Forces (army composition)", "Ward Save", "Fly"}


def classify(t):
    tl = t.lower()
    if tl.startswith("passive"):
        return "passive", "neutral", "always"
    if tl.startswith("reaction"):
        return "reaction", "neutral", "reaction"
    who = "your" if "your " in tl else "enemy" if "enemy " in tl else "any"
    for ph, key in (("start-of-turn", "start of"), ("hero", "hero phase"), ("movement", "movement phase"),
                    ("shooting", "shooting phase"), ("charge", "charge phase"), ("combat", "combat phase"),
                    ("end-of-turn", "end of"), ("deployment", "deployment")):
        if key in tl:
            if ph == "start-of-turn" and "battle round" in tl:
                return "active", "neutral", "battle-round-start"
            return "active", who, ph
    return "active", who, "battle-round-start" if "priority" in tl else "always"


def main():
    r = json.loads(RESEARCH.read_text())
    extra = []
    for a in r["core_abilities"]:
        if a["name"] not in EXTRA:
            continue
        kind, who, when = classify(a["timing"])
        if a["name"].startswith("Pile-in"):
            kind, who, when = "passive", "neutral", "always"
        e = {"name": re.sub(r"\s*\(.*\)$", "", a["name"]), "timing": a["timing"], "kind": kind, "who": who, "when": when,
             "keywords": [k.strip() for k in re.split(r"[,;]", a.get("keywords") or "") if k.strip() and len(k) < 30],
             "declare": a["declare"] if a.get("declare") not in ("-", None) else "", "effect": a["effect"], "section": "Core rules"}
        if a["name"] == "Activate Place of Power":
            e["usage"] = "1/turn (army)"
        extra.append(e)
    out = {
        "overview": OVERVIEW, "pregame": PREGAME, "deployment": DEPLOYMENT, "roundStart": ROUND_START, "phases": PHASES,
        "tacticsHowTo": TACTICS_HOWTO, "extraAbilities": extra,
        "sources": [{"url": CORE_PDF, "what": "Core Rules (Apr 2025)"}, {"url": UPDATES, "what": "Rules Updates (Oct 2026)"},
                    {"url": "https://www.warhammer-community.com/en-gb/articles/yb8viq2m/head-to-aqshy-with-the-new-generals-handbook/", "what": "GHB 2026-27 (WarCom)"},
                    {"url": "https://wahapedia.ru/aos4/the-rules/the-core-rules/", "what": "Wahapedia core rules (updated for Oct 2026)"}],
        "compiled": r.get("meta", {}).get("compiled"),
        "caveats": r.get("disagreements_and_gaps", []),
    }
    OUT.write_text(json.dumps(out, indent=1))
    print(f"core.json: {len(extra)} extra abilities, {len(PHASES)} phases")


if __name__ == "__main__":
    main()
