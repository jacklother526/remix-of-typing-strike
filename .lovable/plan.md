# Typing Tower — Settings, Ammo Queue & Tuning

All changes are frontend only, in `src/components/TypingTowerGame.tsx` (plus small
config defaults in `src/lib/game-config.json`). No backend/schema changes.

## 1. Menu settings (player-configurable)

Add three controls on the start menu (shown before choosing Learn/Survival),
stored in a `settingsRef` + React state so they can change live and drive the game:

- **Bullet initial speed** — slider, default = current `bulletSpeedBase`. Feeds
  the normal-bullet speed formula (see §4).
- **Turret rotation speed** — slider in degrees/sec, **default 60**.
- **Firing speed** — slider in shots/sec, **default 1**.

Defaults in `game-config.json` updated to match (`turretRotSpeedDeg: 60`,
`fireRatePerSec: 1`) so the menu opens on those values. The game loop reads these
from the settings refs instead of the static `config` constants.

## 2. "Ammo" queue (fire order, no false misses)

Rename/repurpose the existing `pendingShotsRef` into the **Ammo** list:

- Every correct keypress pushes an entry onto Ammo (the target it locked onto).
- Ammo is fired in order, one shot per firing interval, only after the turret has
  finished rotating to that target (see §3) — this is already the queue's shape.
- If an Ammo entry's target is already gone when its turn comes (e.g. destroyed by
  a special/area shot), it is **silently removed** — never counted as a miss. The
  rule "if it was there when you pressed, it's not a mistake" holds because the key
  only enters Ammo when a live matching enemy existed at press time.

## 3. Fire only after the turret aims

Bullets must not leave before the barrel points at the target. The loop already
gates firing on `Math.abs(diff) < 0.08`; this stays and now uses the
player-selected rotation speed, so with a slow (60°/s) turret the shot clearly
waits for the barrel to line up.

## 4. Randomized normal-bullet speed

Replace the current ±15% jitter with a per-bullet random multiplier in **[1.0,
1.7]** applied to the chosen initial speed: `launchSpeed = initialSpeed *
(1 + Math.random() * 0.7)`. Every normal bullet rolls a fresh value. Laser and
special shots keep their own speed rules.

## 5. Press, don't hold

In the keydown handler, ignore auto-repeat: `if (e.repeat) return;`. Holding a key
does nothing; the player must press again to fire again.

## 6. Wrong key → penalty + empty magazine

On a wrong key (the existing `registerMiss` path), in addition to the current
penalty/ban, **clear the Ammo queue** (`pendingShotsRef.current = []`) so queued
shots are lost — the magazine empties.

## 7. Tougher combo reward

Change the combo/reward trigger in `maybeGrantReward`:

- Window: **18 kills within 20 seconds** (was 10 in 10s).
- Reward duration: **always 5 seconds** (drop the 10s tier).

Everything else about the reward (pierce/explosive pick, voice/boom) stays.

## 8. F, H, G enemies always fast (3× base)

In both spawners (`spawnEnemy` for Survival, `spawnLearnEnemy` for Learn), if the
target's single letter is F, H, or G, set its speed to **3× the base enemy speed**
for that mode, overriding the normal speed roll. (Applies to single-letter targets;
for multi-letter words, applied when the word is exactly that letter.)

## 9. Fixed letter colors

When drawing the label text, color specific letters regardless of state:

- **B → blue**, **R → red**, **Y → yellow**, **G → green**.

Applied per-character in the label draw loop so these letters always render in
their color (other letters keep the existing typed/active coloring). Chosen tones
will use readable, vivid hues on the dark label background.

---

## Technical notes

- New `settingsRef` (mutable, read in the RAF loop) mirrored by React state for the
  menu sliders; `spawnBullet`, the rotation step, and `fireInterval` read from it.
- `game-config.json`: set `turretRotSpeedDeg: 60`, `fireRatePerSec: 1`; keep other
  keys. `bulletSpeedBase` stays the slider's default.
- Keydown: add `e.repeat` guard at the top; empty Ammo on miss.
- Bullet speed: swap jitter block in `spawnBullet` for the [1,1.7] multiplier.
- Combo: update `killTimesRef` window to 20000ms / threshold 18; fixed 5000ms
  reward.
- Fast letters: helper checking `["F","H","G"].includes(letter)` in both spawns.
- Letter colors: a small map `{B,R,Y,G}` consulted in the per-char label draw.
