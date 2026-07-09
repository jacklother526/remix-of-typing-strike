# Typing Tower — Learn Mode + Fire Fix

## 1. Fix the fire limitation (the "grey target" bug)

Today, pressing a letter sets `enemy.typed = word.length`, which (a) greys the
label and (b) removes the enemy from the valid-target list (`idx < word.length`
is false), so you can't fire again until the in-flight bullet resolves.

Fix: decouple **firing** from **word progress**.
- Single-letter enemies (the whole letter phase): every keypress fires a bullet
  at the closest *alive* enemy holding that letter. The enemy dies only when a
  bullet actually hits it. No `typed` gate, no greying, no lock — fire as much as
  you want.
- Multi-letter words keep sequential progress (each letter chips one hp), but a
  missed shot still lets you re-fire that position (refund logic stays).

Result: a living target is always shootable.

## 2. Two modes (start menu)

A simple start screen: **LEARN** and **SURVIVAL**.
- **Survival** = today's endless, randomized game, unchanged (kept as-is).
- **Learn** = the new structured campaign below.

## 3. Learn campaign — letters first (L1 → ~L55)

Alphabetical, because the goal is English letters for a young beginner.

Letter schedule (a new letter every 3–4 levels, new one debuts on the first
level of each block):
```
Block 1  L1–4    A B
Block 2  L5–8    A B C
Block 3  L9–12   + D
Block 4  L13–16  + E   ...continues to Z (~L55)
```
This matches your example (C arrives at L5).

**Structured waves, not random.** Each level is a *finite roster* of enemies
(not an endless stream). The level is cleared only when the whole wave is
destroyed. Example early ramp:
```
L1  ~20 targets, slow
L2  ~30 targets, slow
L3  ~35 targets, some faster
L4  harder (faster, tighter spacing)
L5  NEW LETTER C — difficulty spike
```
Enemy count, speed spread, and enemy-type mix come from a per-level difficulty
profile — intentional, not luck.

**Level up only by real mastery, not chance.** Two reinforcing guards:
1. The newest letter appears on a large share of the debut block's targets
   (~45%), so you *must* recognize it.
2. Difficulty is tuned so a player who doesn't know the new letter physically
   can't clear the wave — enemies carrying the unknown letter pile up, reach the
   base, and you fail before clearing. So advancement requires actually learning
   the letters, exactly as you asked.

## 4. Gentler penalties while learning

- Early blocks: short shot-ban on a wrong key (e.g. ~1s), **no instant
  destruction** from consecutive mistakes.
- The real pressure comes from the wave itself (letters you don't know breach
  the base), not from harsh key-punishment.
- Strictness ramps up in later levels.

## 5. Words phase (later, small and capped)

After the alphabet is covered (~L55+), short words appear, growing slowly.
Curated list of **≤20 simple words total** (no giant random pools).

## 6. Voice + countdown (placeholder now, swappable later)

- **Countdown**: on game/level start, a 3-2-1 overlay plays with the spoken
  cue **"Ready?"**, then **"Fire!"** as the wave begins.
- **In-game cues**: **"Destroy!"** at charged/combo moments, **"Good Job!"** on
  level clear, and a **"New letter: C"** intro moment when a letter unlocks.
- **Placeholder voice**: the browser's built-in speech (SpeechSynthesis) speaks
  these English words now, behind a small `playVoice(cue)` layer. Later you drop
  recorded clips into `public/voice/<cue>.mp3` and they override the placeholder
  automatically — no code changes needed. (We can also switch to generated
  studio voices via the backend later.)

## 7. Kid-friendly rewards & feedback

- **New-letter intro moment**: a big celebratory card showing the letter before
  its block starts.
- **Praise**: quick "GREAT!" / "NICE!" pop-ups on combos; a **"GOOD JOB!"**
  celebration with **1–3 stars** on level clear (stars based on accuracy /
  health remaining) — fast, visible reward to keep an 8-year-old hooked.
- Keep the juicy explosions, muzzle flashes, and existing special shots.

## 8. Keep your test tweaks

Your increased fire rate and reduced enemy damage stay. Learn mode gets its own
difficulty numbers so tuning it won't disturb Survival.

---

## Technical notes

- **`src/lib/game-progression.ts`** — rewrite for Learn mode: alphabetical
  `lettersForLevel` (start A,B; +1 per block), per-level `waveRoster` (count,
  spawn spacing, speed profile, letter-mix weights favoring the newest letter),
  curated ≤20-word list + `targetWordLength` starting ~L55. Keep Survival's
  existing functions intact.
- **`src/components/TypingTowerGame.tsx`** —
  - Fire fix: keypress fires at closest alive matching enemy; drop the
    `typed`-based targeting/greying for single letters.
  - Add `mode: "menu" | "learn" | "survival"` state + start menu.
  - Learn loop: spawn from a finite roster, detect wave-clear → level-up flow;
    fail when health depleted. Survival loop unchanged.
  - Countdown overlay + level-clear celebration (stars) + new-letter intro.
  - Gentler penalty table for early Learn levels.
- **`src/lib/voice.ts`** (new) — `playVoice(cue)`: tries
  `public/voice/<cue>.mp3`, falls back to SpeechSynthesis. Cues: `ready`,
  `fire`, `destroy`, `goodjob`, `newletter` (letter interpolated).
- **`public/voice/`** (new) — folder + short README on dropping in real clips.
- **`src/lib/game-config.json`** — add Learn-mode tuning fields (early ban ms,
  star thresholds); keep your firerate/damage values.

No backend/schema changes in this pass.