// Learn campaign: alphabetical letters, structured finite waves, mastery-based.
import type { EnemyKind } from "./game-progression";

export const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

// Block = 4 levels per new letter. Level 1 starts with 2 letters (A, B).
const BLOCK = 4;

export function blockIndex(level: number): number {
  return Math.floor((level - 1) / BLOCK);
}

// Letters unlocked at a given level. L1-4 -> A,B ; L5-8 -> +C ; ...
export function learnLetters(level: number): string[] {
  const count = Math.min(26, 2 + blockIndex(level));
  return ALPHABET.slice(0, count);
}

// The newest letter for the current block (null during the very first block).
export function newestLetter(level: number): string | null {
  const b = blockIndex(level);
  if (b === 0) return null;
  return ALPHABET[Math.min(25, 1 + b)];
}

// Is this the debut level of a brand-new letter? (first level of a block, b>=1)
export function isNewLetterLevel(level: number): boolean {
  return blockIndex(level) >= 1 && (level - 1) % BLOCK === 0;
}

// True once every letter is unlocked -> the words phase can begin.
export function alphabetComplete(level: number): boolean {
  return 2 + blockIndex(level) >= 26;
}

// A short, curated word list (<= 20 words total) for the later phase.
const WORD_POOL: string[] = [
  "GO", "UP", "HI", "OK", "CAT", "DOG", "SUN", "RUN", "BIG", "RED",
  "FUN", "TOP", "FIRE", "BOMB", "STAR", "JUMP", "GOOD", "TANK", "BLAST", "HERO",
];

export function learnTargetWordLength(level: number): number {
  if (!alphabetComplete(level)) return 1;
  // First word-block levels use tiny words, growing slowly.
  const over = level - firstWordLevel();
  return Math.min(5, 2 + Math.floor(over / 8));
}

export function firstWordLevel(): number {
  // First level at which 2 + blockIndex >= 26  => blockIndex >= 24 => level 97.
  return 24 * BLOCK + 1;
}

export function pickLearnWord(len: number): string {
  const pool = WORD_POOL.filter((w) => w.length === len);
  const use = pool.length ? pool : WORD_POOL;
  return use[Math.floor(Math.random() * use.length)];
}

export type WaveEnemy = { letter: string; kind: EnemyKind; speedMul: number };

// How many enemies make up a level's wave.
export function waveCount(level: number): number {
  const b = blockIndex(level);
  const i = (level - 1) % BLOCK;
  return Math.min(85, 20 + i * 6 + b * 3);
}

// Spacing (ms) between spawns — tightens with difficulty.
export function learnSpawnSpacingMs(level: number): number {
  const b = blockIndex(level);
  const i = (level - 1) % BLOCK;
  return Math.max(480, 1300 - b * 35 - i * 130);
}

// Build the full roster for a level. Intentional letter mix + speed spread.
export function buildLearnWave(level: number): WaveEnemy[] {
  const letters = learnLetters(level);
  const b = blockIndex(level);
  const i = (level - 1) % BLOCK;
  const count = waveCount(level);
  const newest = newestLetter(level);
  // Newest letter gets a big share on its debut block so it MUST be learned.
  const newestShare = newest ? [0.5, 0.4, 0.32, 0.26][i] : 0;
  const older = letters.filter((l) => l !== newest);

  const wordsPhase = alphabetComplete(level);
  const out: WaveEnemy[] = [];
  for (let n = 0; n < count; n++) {
    let letter: string;
    if (wordsPhase) {
      letter = pickLearnWord(learnTargetWordLength(level));
    } else if (newest && Math.random() < newestShare) {
      letter = newest;
    } else if (older.length) {
      letter = older[Math.floor(Math.random() * older.length)];
    } else {
      letter = letters[Math.floor(Math.random() * letters.length)];
    }

    const baseMul = 1 + b * 0.04 + i * 0.07;
    let speedMul = baseMul * (0.85 + Math.random() * 0.5);
    let kind: EnemyKind = "grunt";
    const fastChance = 0.05 + i * 0.06 + b * 0.02;
    const weaveChance = b >= 3 ? 0.12 : 0;
    const r = Math.random();
    if (r < fastChance) {
      kind = "runner";
      speedMul *= 1.4;
    } else if (r < fastChance + weaveChance) {
      kind = "weaver";
    }
    out.push({ letter, kind, speedMul });
  }
  return out;
}

// Gentle-while-learning shot ban (ms) for a wrong key. Ramps up with level.
export function learnBanMs(level: number): number {
  if (level < 9) return 800;
  if (level < 20) return 1200;
  if (level < 40) return 1800;
  return 2400;
}

// Stars for a cleared level, from health kept + accuracy.
export function starsForLevel(healthPct: number, accuracy: number): number {
  if (healthPct > 0.85 && accuracy > 0.9) return 3;
  if (healthPct > 0.5 && accuracy > 0.72) return 2;
  return 1;
}
