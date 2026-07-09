// Level → allowed letters and word length rules.

const LEVEL_LETTERS: string[] = [
  "FJDK",                       // 1  (4)
  "FJDKSL",                     // 2  (+2)  6
  "FJDKSLAG",                   // 3  (+2)  8
  "FJDKSLAGEIO",                // 4  (+3)  11
  "FJDKSLAGRUW",                // 5  (+3 replace/extend) 11 -> we use union below
];

// Instead of the fragile array above we build cumulative letter sets.
const CUMULATIVE: string[] = (() => {
  const additions = [
    "FJDK",     // L1 base (4)
    "SL",       // L2 (+2) 6
    "AG",       // L3 (+2) 8
    "EIO",      // L4 (+3) 11
    "RUW",      // L5 (+3) 14
    "MN",       // L6 (+2) 16
    "BCV",      // L7 (+3) 19
    "PT",       // L8 (+2) 21
    "HY",       // L9 (+2) 23
    "QXZ",      // L10 (+3) 26
  ];
  const out: string[] = [];
  let acc = "";
  for (const a of additions) {
    for (const ch of a) if (!acc.includes(ch)) acc += ch;
    out.push(acc);
  }
  return out;
})();

export function lettersForLevel(level: number): string {
  if (level <= 0) return CUMULATIVE[0];
  if (level >= CUMULATIVE.length) return "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return CUMULATIVE[level - 1];
}

// Word length: level <=10 -> 1 letter, then grows to 8 by level 30.
export function targetWordLength(level: number): number {
  if (level <= 10) return 1;
  const l = Math.min(8, 2 + Math.floor((level - 11) / 3));
  return l;
}

// Spawn interval shortens with level & time. Returns ms.
export function spawnIntervalMs(level: number, elapsedSec: number): number {
  const base = 1500 - Math.min(900, (level - 1) * 70);
  const timeShrink = Math.min(300, elapsedSec * 3);
  return Math.max(320, base - timeShrink);
}

export function enemySpeedMultiplier(level: number, elapsedSec: number): number {
  return 1 + (level - 1) * 0.06 + Math.min(0.4, elapsedSec * 0.004);
}

// Weighted enemy variant picker. Types:
//  grunt, runner, weaver, tank
export type EnemyKind = "grunt" | "runner" | "weaver" | "tank";

export function pickEnemyKind(level: number): EnemyKind {
  const r = Math.random();
  if (level < 3) return "grunt";
  if (level < 5) return r < 0.8 ? "grunt" : "runner";
  if (level < 8) {
    if (r < 0.55) return "grunt";
    if (r < 0.85) return "runner";
    return "weaver";
  }
  if (level < 11) {
    if (r < 0.45) return "grunt";
    if (r < 0.75) return "runner";
    return "weaver";
  }
  // level 11+ tanks appear
  if (r < 0.35) return "grunt";
  if (r < 0.6) return "runner";
  if (r < 0.8) return "weaver";
  return "tank";
}

const WORDS_BY_LEN: Record<number, string[]> = {
  2: ["GO","HI","UP","ON","IN","Ok","My","IT","NO","WE"],
  3: ["RUN","HIT","FOX","GUN","TNT","MUD","WAR","RED","SKY","RAM","FOG","ICE","JAM","AXE"],
  4: ["TANK","BOMB","FIRE","ARMY","BOLT","RUST","IRON","BASE","SHOT","KILL","DUST","SCAR","AMMO","FUEL"],
  5: ["STORM","SCRAP","METAL","BLAST","DRONE","LASER","RIVER","ALPHA","TIGER","SHELL","RUINS","SMOKE","FLARE"],
  6: ["TURRET","BUNKER","CANNON","ENGINE","TARGET","ROCKET","SNIPER","ATTACK","MORTAR","VOLLEY","BATTLE"],
  7: ["MISSILE","WARZONE","SOLDIER","CIRCUIT","GUNSHIP","EXPLODE","DEFENSE","WARHEAD","COMMAND","GRENADE"],
  8: ["SQUADRON","INFANTRY","FIREBALL","DEMOLISH","TERMINAL","DETONATE","ARMORING","RAILGUNS","AMBUSHED","SHRAPNEL"],
};

export function pickWord(len: number): string {
  const pool = WORDS_BY_LEN[len];
  if (!pool) return "GO";
  return pool[Math.floor(Math.random() * pool.length)];
}

export function pickLetter(level: number): string {
  const set = lettersForLevel(level);
  return set[Math.floor(Math.random() * set.length)];
}

// Kills needed to clear a level.
//  L1-5  -> 50 each
//  L6-10 -> 75 each
//  L11+  -> 100 each
export function killsForLevel(level: number): number {
  if (level <= 5) return 50;
  if (level <= 10) return 75;
  return 100;
}

// ---- Chance-based special shots (permanent, unlocked by level) ----
// explosive L4, bounce L5, laser L6, electric L7.
// Base 1% at unlock, +1% every 2 levels, capped at 10%.
export type SpecialKind = "explosive" | "bounce" | "laser" | "electric";

const SPECIAL_UNLOCK: Record<SpecialKind, number> = {
  explosive: 4,
  bounce: 5,
  laser: 6,
  electric: 7,
};

export function specialChance(level: number, kind: SpecialKind): number {
  const unlock = SPECIAL_UNLOCK[kind];
  if (level < unlock) return 0;
  return Math.min(10, 1 + Math.floor((level - unlock) / 2)) / 100;
}

// Roll for a special shot. If several succeed, pick one at random.
export function rollSpecialShot(level: number): SpecialKind | null {
  const kinds: SpecialKind[] = ["explosive", "bounce", "laser", "electric"];
  const hits = kinds.filter((k) => Math.random() < specialChance(level, k));
  if (hits.length === 0) return null;
  return hits[Math.floor(Math.random() * hits.length)];
}

// ---- Repeated-letter targets (single-letter phase, levels <= 10) ----
// Double: after level 3 (from L4), 3% +1% every 2 levels, cap 30%.
export function doubleLetterChance(level: number): number {
  if (level < 4) return 0;
  return Math.min(0.3, 0.03 + Math.floor((level - 4) / 2) * 0.01);
}
// Triple: after level 4 (from L5), 1% +1% every 2 levels, cap 10%.
export function tripleLetterChance(level: number): number {
  if (level < 5) return 0;
  return Math.min(0.1, 0.01 + Math.floor((level - 5) / 2) * 0.01);
}

// How many times a single-letter target repeats (1, 2 or 3).
export function repeatCountForLevel(level: number): number {
  if (Math.random() < tripleLetterChance(level)) return 3;
  if (Math.random() < doubleLetterChance(level)) return 2;
  return 1;
}

