import { useEffect, useRef, useState } from "react";
import config from "@/lib/game-config.json";
import {
  spawnIntervalMs,
  enemySpeedMultiplier,
  pickEnemyKind,
  pickWord,
  pickLetter,
  killsForLevel,
  repeatCountForLevel,
  targetWordLength,
  lettersForLevel,
  rollSpecialShot,
  type EnemyKind,
} from "@/lib/game-progression";
import {
  learnLetters,
  newestLetter,
  isNewLetterLevel,
  buildLearnWave,
  learnSpawnSpacingMs,
  waveCount,
  learnBanMs,
  starsForLevel,
  type WaveEnemy,
} from "@/lib/learn-progression";
import { playVoice } from "@/lib/voice";

type Vec = { x: number; y: number };

type GameMode = "menu" | "learn" | "survival";

type Enemy = {
  id: number;
  pathIdx: number;
  t: number;
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  kind: EnemyKind;
  word: string;
  typed: number;
  hp: number;
  speed: number;
  radius: number;
  lane: number;
  sway: number;
  swayFreq: number;
  swayPhase: number;
  age: number;
};

type BulletMode = "normal" | "pierce" | "explosive" | "bounce" | "laser" | "electric";

type Bullet = {
  id: number;
  x: number; y: number;
  dx: number; dy: number;
  speed: number;
  launchSpeed: number;
  accel: number;
  maxSpeed: number;
  targetId: number;
  life: number;
  bounces: number;
  mode: BulletMode;
  bounceHits: number;
  hitIds: number[];
};

type RewardKind = "pierce" | "explosive";

type Particle = {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  color: string; size: number;
};

type Obstacle = { x: number; y: number; r: number; hp: number };

type MuzzleFlash = { angle: number; life: number };

type Beam = { x1: number; y1: number; x2: number; y2: number; life: number; color: string };

type Path = {
  points: Vec[];
  cum: number[];
  total: number;
};

let _id = 1;
const nextId = () => _id++;

function useAudio() {
  const ctxRef = useRef<AudioContext | null>(null);
  const ensure = () => {
    if (!ctxRef.current) {
      const AC = (window as unknown as { AudioContext: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
        || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctxRef.current = new AC();
    }
    return ctxRef.current!;
  };
  return {
    shot: () => {
      const ctx = ensure();
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.setValueAtTime(980, t);
      o.frequency.exponentialRampToValueAtTime(110, t + 0.07);
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + 0.09);
    },
    boom: () => {
      const ctx = ensure();
      const t = ctx.currentTime;
      const bufferSize = ctx.sampleRate * 0.25;
      const noise = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.35, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      const f = ctx.createBiquadFilter();
      f.type = "lowpass"; f.frequency.value = 1200;
      src.connect(f).connect(g).connect(ctx.destination);
      src.start(t);
    },
    jam: () => {
      const ctx = ensure();
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(140, t);
      o.frequency.linearRampToValueAtTime(80, t + 0.12);
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + 0.14);
    },
    thud: () => {
      const ctx = ensure();
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "triangle";
      o.frequency.setValueAtTime(220, t);
      o.frequency.exponentialRampToValueAtTime(60, t + 0.08);
      g.gain.setValueAtTime(0.1, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + 0.1);
    },
    tick: () => {
      const ctx = ensure();
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.setValueAtTime(1400, t);
      g.gain.setValueAtTime(0.05, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + 0.05);
    },
    chime: () => {
      const ctx = ensure();
      const t = ctx.currentTime;
      [523, 659, 784, 1046].forEach((f, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "triangle";
        o.frequency.setValueAtTime(f, t + i * 0.09);
        g.gain.setValueAtTime(0.0001, t + i * 0.09);
        g.gain.exponentialRampToValueAtTime(0.18, t + i * 0.09 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.28);
        o.connect(g).connect(ctx.destination);
        o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.3);
      });
    },
  };
}

function buildPathThrough(anchors: Vec[], seed: number): Path {
  let s = seed;
  const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const points: Vec[] = [anchors[0]];
  for (let a = 0; a < anchors.length - 1; a++) {
    const A = anchors[a], B = anchors[a + 1];
    const dx = B.x - A.x, dy = B.y - A.y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = -dy / dist, ny = dx / dist;
    const steps = 5;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const bx = A.x + dx * t;
      const by = A.y + dy * t;
      const taper = Math.sin(t * Math.PI);
      const amp = Math.min(220, dist * 0.22);
      const off = (rand() - 0.5) * amp * 2 * taper;
      points.push({ x: bx + nx * off, y: by + ny * off });
    }
    points.push(B);
  }
  const cum: number[] = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    cum.push(total);
  }
  return { points, cum, total };
}

function pointOnPath(path: Path, t: number): Vec {
  if (t <= 0) return path.points[0];
  if (t >= path.total) return path.points[path.points.length - 1];
  let i = 1;
  while (i < path.cum.length && path.cum[i] < t) i++;
  const segLen = path.cum[i] - path.cum[i - 1];
  const f = (t - path.cum[i - 1]) / segLen;
  const a = path.points[i - 1], b = path.points[i];
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

function pathTangent(path: Path, t: number): Vec {
  const p1 = pointOnPath(path, Math.max(0, t - 2));
  const p2 = pointOnPath(path, Math.min(path.total, t + 2));
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const d = Math.hypot(dx, dy) || 1;
  return { x: dx / d, y: dy / d };
}

function segCircleHit(x1: number, y1: number, x2: number, y2: number, cx: number, cy: number, r: number): boolean {
  const dx = x2 - x1, dy = y2 - y1;
  const fx = x1 - cx, fy = y1 - cy;
  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  let disc = b * b - 4 * a * c;
  if (disc < 0) return false;
  disc = Math.sqrt(disc);
  const t1 = (-b - disc) / (2 * a);
  const t2 = (-b + disc) / (2 * a);
  return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1);
}

export default function TypingTowerGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const enemiesRef = useRef<Enemy[]>([]);
  const bulletsRef = useRef<Bullet[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const obstaclesRef = useRef<Obstacle[]>([]);
  const pathsRef = useRef<Path[]>([]);
  const muzzleRef = useRef<MuzzleFlash | null>(null);
  const beamsRef = useRef<Beam[]>([]);
  const lastFireRef = useRef(0);
  const turretAngleRef = useRef(Math.PI);
  const targetAngleRef = useRef(Math.PI);
  const recoilRef = useRef(0);
  const sizeRef = useRef({ w: 1280, h: 720 });
  const lastSpawnRef = useRef(0);
  const lastTimeRef = useRef(performance.now());
  const elapsedRef = useRef(0);
  const comboRef = useRef(0);
  const healthRef = useRef(config.playerHealth);
  const gameOverRef = useRef(false);
  const missStreakRef = useRef(0);
  const banUntilRef = useRef(0);
  const levelRef = useRef(1);
  const killsRef = useRef(0);
  const activeTargetRef = useRef<number | null>(null);
  const levelBannerRef = useRef(0);
  const pendingShotsRef = useRef<{ enemyId: number }[]>([]);
  const killTimesRef = useRef<number[]>([]);
  const rewardUntilRef = useRef(0);
  const rewardTypeRef = useRef<RewardKind | null>(null);

  // --- mode / learn campaign ---
  const modeRef = useRef<GameMode>("menu");
  const countdownRef = useRef(0);
  const waveQueueRef = useRef<WaveEnemy[]>([]);
  const waveTotalRef = useRef(0);
  const spawnedRef = useRef(0);
  const spacingRef = useRef(1200);
  const statsRef = useRef({ hits: 0, misses: 0 });
  const levelCompleteRef = useRef(false);
  const goTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextLevelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const praiseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const audio = useAudio();

  const [mode, setMode] = useState<GameMode>("menu");
  const [hudCombo, setHudCombo] = useState(0);
  const [hudHealth, setHudHealth] = useState(config.playerHealth);
  const [gameOver, setGameOver] = useState(false);
  const [banRemaining, setBanRemaining] = useState(0);
  const [missStreak, setMissStreak] = useState(0);
  const [level, setLevel] = useState(1);
  const [kills, setKills] = useState(0);
  const [waveTotal, setWaveTotal] = useState(0);
  const [showBanner, setShowBanner] = useState(false);
  const [rewardType, setRewardType] = useState<RewardKind | null>(null);
  const [rewardRemaining, setRewardRemaining] = useState(0);
  const [countdownNum, setCountdownNum] = useState<number | null>(null);
  const [newLetter, setNewLetter] = useState<string | null>(null);
  const [levelResult, setLevelResult] = useState<{ level: number; stars: number } | null>(null);
  const [praise, setPraise] = useState<string | null>(null);

  // --- player-configurable settings (menu) ---
  const settingsRef = useRef({
    bulletSpeed: config.bulletSpeedBase,
    turretRotSpeedDeg: config.turretRotSpeedDeg,
    fireRatePerSec: config.fireRatePerSec,
  });
  const [bulletSpeed, setBulletSpeed] = useState(config.bulletSpeedBase);
  const [turretRotSpeed, setTurretRotSpeed] = useState(config.turretRotSpeedDeg);
  const [fireRate, setFireRate] = useState(config.fireRatePerSec);



  const buildLevel = () => {
    const { w, h } = sizeRef.current;
    const cx = w * 0.93, cy = h * 0.5;
    const jitter = (r: number) => (Math.random() - 0.5) * r;

    const upperCorner = { x: w * 0.9 + jitter(60), y: h * 0.1 + jitter(40) };
    const lowerCorner = { x: w * 0.9 + jitter(60), y: h * 0.9 + jitter(40) };

    const specs: Vec[][] = [
      [{ x: -20, y: h * 0.35 + jitter(60) }, { x: w * 0.55, y: h * 0.5 + jitter(80) }, { x: cx, y: cy }],
      [{ x: w * 0.08 + jitter(60), y: -20 }, upperCorner, { x: cx, y: cy }],
      [{ x: -20, y: h * 0.75 + jitter(60) }, { x: w * 0.5, y: h * 0.65 + jitter(60) }, { x: cx, y: cy }],
      [{ x: w * 0.12 + jitter(60), y: h + 20 }, lowerCorner, { x: cx, y: cy }],
    ];
    pathsRef.current = specs.map((s, i) => buildPathThrough(s, (i + 1) * 7919 + Math.floor(Math.random() * 9999)));

    const obs: Obstacle[] = [];
    let tries = 0;
    const minTurret = 130;
    while (obs.length < config.obstacleCount && tries < 400) {
      tries++;
      const x = 60 + Math.random() * (w - 120);
      const y = 60 + Math.random() * (h - 120);
      if (Math.hypot(x - cx, y - cy) < minTurret) continue;
      let onPath = false;
      for (const p of pathsRef.current) {
        for (let i = 1; i < p.points.length; i++) {
          const a = p.points[i - 1], b = p.points[i];
          const vx = b.x - a.x, vy = b.y - a.y;
          const wx = x - a.x, wy = y - a.y;
          const segL2 = (vx * vx + vy * vy) || 1;
          const tt = Math.max(0, Math.min(1, (wx * vx + wy * vy) / segL2));
          const px = a.x + vx * tt, py = a.y + vy * tt;
          if (Math.hypot(x - px, y - py) < config.pathWidth * 0.6) { onPath = true; break; }
        }
        if (onPath) break;
      }
      if (onPath) continue;
      if (obs.some(o => Math.hypot(o.x - x, o.y - y) < 70)) continue;
      obs.push({ x, y, r: 6 + Math.random() * 4, hp: 3 });
    }
    obstaclesRef.current = obs;
  };

  useEffect(() => {
    const c = canvasRef.current!;
    const ZOOM = 1 / 1.5;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const cw = c.clientWidth;
      const ch = c.clientHeight;
      c.width = cw * dpr;
      c.height = ch * dpr;
      const ctx = c.getContext("2d")!;
      ctx.setTransform(dpr * ZOOM, 0, 0, dpr * ZOOM, 0, 0);
      sizeRef.current = { w: cw / ZOOM, h: ch / ZOOM };
      buildLevel();
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // ------- Survival spawn (endless, randomized) -------
  const spawnEnemy = () => {
    if (pathsRef.current.length === 0) return;
    const pi = Math.floor(Math.random() * pathsRef.current.length);
    const p = pathsRef.current[pi];
    const start = p.points[0];
    const lvl = levelRef.current;
    const kind = pickEnemyKind(lvl);

    const wordLen = targetWordLength(lvl);
    let word: string;
    if (wordLen === 1) {
      const letter = pickLetter(lvl);
      const reps = kind === "tank" ? Math.min(3, repeatCountForLevel(lvl) + 1) : repeatCountForLevel(lvl);
      word = letter.repeat(reps);
    } else {
      const useLen = kind === "tank" ? Math.min(8, wordLen + 1) : wordLen;
      word = pickWord(useLen);
    }

    const mul = enemySpeedMultiplier(lvl, elapsedRef.current);
    const baseSpeed = config.enemySpeedMin + Math.random() * (config.enemySpeedMax - config.enemySpeedMin);
    let speed = baseSpeed * mul;
    let radius = 18;
    let sway = 0;
    let swayFreq = 0;

    if (kind === "runner") { speed *= 1.5; radius = 15; }
    else if (kind === "tank") { speed *= 0.55; radius = 26; }
    else if (kind === "weaver") { sway = 22; swayFreq = 3.4; }

    if (kind !== "tank" && Math.random() < 0.14) speed *= 1.9 + Math.random() * 1.3;

    const half = config.pathWidth / 2 - radius - 2;
    const lane = half > 0 ? (Math.random() * 2 - 1) * half : 0;

    enemiesRef.current.push({
      id: nextId(), pathIdx: pi, t: 0,
      x: start.x, y: start.y, baseX: start.x, baseY: start.y,
      kind, word, typed: 0, hp: word.length, speed, radius, lane, sway, swayFreq,
      swayPhase: Math.random() * Math.PI * 2, age: 0,
    });
  };

  // ------- Learn spawn (from a finite roster) -------
  const spawnLearnEnemy = (we: WaveEnemy) => {
    if (pathsRef.current.length === 0) return;
    const pi = Math.floor(Math.random() * pathsRef.current.length);
    const p = pathsRef.current[pi];
    const start = p.points[0];
    let radius = 18, sway = 0, swayFreq = 0;
    if (we.kind === "runner") radius = 15;
    else if (we.kind === "weaver") { sway = 20; swayFreq = 3.2; }
    else if (we.kind === "tank") radius = 26;
    const speed = config.learnEnemySpeedBase * we.speedMul;
    const half = config.pathWidth / 2 - radius - 2;
    const lane = half > 0 ? (Math.random() * 2 - 1) * half : 0;
    enemiesRef.current.push({
      id: nextId(), pathIdx: pi, t: 0,
      x: start.x, y: start.y, baseX: start.x, baseY: start.y,
      kind: we.kind, word: we.letter, typed: 0, hp: we.letter.length,
      speed, radius, lane, sway, swayFreq,
      swayPhase: Math.random() * Math.PI * 2, age: 0,
    });
  };

  const explode = (x: number, y: number, big = false) => {
    const n = big ? 40 : 24;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 80 + Math.random() * (big ? 360 : 240);
      particlesRef.current.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.5 + Math.random() * 0.4, maxLife: 0.9,
        color: Math.random() < 0.5 ? "#ffb347" : "#ff5722", size: 2 + Math.random() * 3,
      });
    }
    for (let i = 0; i < (big ? 18 : 10); i++) {
      const a = Math.random() * Math.PI * 2;
      particlesRef.current.push({
        x, y, vx: Math.cos(a) * (30 + Math.random() * 80), vy: Math.sin(a) * (30 + Math.random() * 80),
        life: 0.7, maxLife: 0.7, color: "#555", size: 4 + Math.random() * 4,
      });
    }
  };

  const sparks = (x: number, y: number) => {
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 60 + Math.random() * 140;
      particlesRef.current.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.25, maxLife: 0.25, color: "#ffd966", size: 1.5 + Math.random() * 1.5,
      });
    }
  };


  const queueShot = (enemy: Enemy) => {
    pendingShotsRef.current.push({ enemyId: enemy.id });
  };

  const spawnBullet = (enemy: Enemy) => {
    const { w, h } = sizeRef.current;
    const cx = w * 0.93, cy = h * 0.5;
    const dx = enemy.x - cx;
    const dy = enemy.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    const ang = Math.atan2(dy, dx);
    const now = performance.now();

    let mode: BulletMode = "normal";
    const special = rollSpecialShot(levelRef.current);
    if (special) {
      mode = special;
    } else if (now < rewardUntilRef.current && rewardTypeRef.current) {
      mode = rewardTypeRef.current;
    }

    let launchSpeed: number;
    let maxSpeed: number;
    let accel: number;
    if (mode === "laser") {
      launchSpeed = 60000; maxSpeed = 60000; accel = 0;
    } else {
      // Every normal bullet rolls a fresh speed in [1.0, 1.7] x initial speed.
      const base = settingsRef.current.bulletSpeed;
      launchSpeed = base * (1 + Math.random() * 0.7);
      maxSpeed = launchSpeed * 2;
      accel = (maxSpeed * maxSpeed - launchSpeed * launchSpeed) / (2 * Math.max(60, len));
    }

    bulletsRef.current.push({
      id: nextId(), x: cx, y: cy, dx: dx / len, dy: dy / len,
      speed: launchSpeed, launchSpeed, accel, maxSpeed,
      targetId: enemy.id, life: mode === "laser" ? 0.06 : 1.5,
      bounces: 0, mode, bounceHits: 0, hitIds: [],
    });
    recoilRef.current = 8;
    muzzleRef.current = { angle: ang, life: 0.08 };
    if (mode === "laser") beamsRef.current.push({ x1: cx, y1: cy, x2: enemy.x, y2: enemy.y, life: 0.12, color: "#7df9ff" });
    audio.shot();
  };

  const REWARD_LIST: RewardKind[] = ["pierce", "explosive"];
  const maybeGrantReward = () => {
    const now = performance.now();
    killTimesRef.current.push(now);
    killTimesRef.current = killTimesRef.current.filter((t) => now - t <= 20000);
    if (killTimesRef.current.length >= 18) {
      killTimesRef.current = [];
      const kind = REWARD_LIST[Math.floor(Math.random() * REWARD_LIST.length)];
      const durationMs = 5000;
      rewardTypeRef.current = kind;
      rewardUntilRef.current = now + durationMs;
      setRewardType(kind);
      setRewardRemaining(durationMs);
      playVoice("destroy");
      audio.boom();
    }
  };

  const registerKill = () => {
    killsRef.current += 1;
    setKills(killsRef.current);
    maybeGrantReward();
    if (modeRef.current === "survival" && killsRef.current >= killsForLevel(levelRef.current)) {
      killsRef.current = 0;
      setKills(0);
      levelRef.current += 1;
      setLevel(levelRef.current);
      levelBannerRef.current = 2.2;
      setShowBanner(true);
      buildLevel();
      enemiesRef.current = [];
      activeTargetRef.current = null;
      pendingShotsRef.current = [];
      audio.boom();
    }
  };

  // Start the pre-wave countdown for the current learn level.
  const beginLearnLevel = () => {
    countdownRef.current = 3.0;
    setCountdownNum(3);
    const lvl = levelRef.current;
    if (isNewLetterLevel(lvl)) {
      const nl = newestLetter(lvl);
      setNewLetter(nl);
      playVoice("newletter", `New letter! ${nl}`);
    } else {
      setNewLetter(null);
      playVoice("ready");
    }
  };

  // Countdown finished -> load the wave and go.
  const startWave = () => {
    countdownRef.current = 0;
    setNewLetter(null);
    setCountdownNum(0); // shows "GO!"
    if (goTimerRef.current) clearTimeout(goTimerRef.current);
    goTimerRef.current = setTimeout(() => setCountdownNum(null), 700);
    lastSpawnRef.current = 0;
    if (modeRef.current === "learn") {
      const roster = buildLearnWave(levelRef.current);
      waveQueueRef.current = roster;
      waveTotalRef.current = roster.length;
      setWaveTotal(roster.length);
      spawnedRef.current = 0;
      spacingRef.current = learnSpawnSpacingMs(levelRef.current);
      killsRef.current = 0;
      setKills(0);
    }
    playVoice("fire");
  };

  const completeLearnLevel = () => {
    levelCompleteRef.current = true;
    const { hits, misses } = statsRef.current;
    const acc = hits / Math.max(1, hits + misses);
    const hp = healthRef.current / config.playerHealth;
    const stars = starsForLevel(hp, acc);
    setLevelResult({ level: levelRef.current, stars });
    playVoice("goodjob");
    audio.chime();
    if (nextLevelTimerRef.current) clearTimeout(nextLevelTimerRef.current);
    nextLevelTimerRef.current = setTimeout(() => {
      levelRef.current += 1;
      setLevel(levelRef.current);
      statsRef.current = { hits: 0, misses: 0 };
      enemiesRef.current = [];
      bulletsRef.current = [];
      activeTargetRef.current = null;
      pendingShotsRef.current = [];
      setLevelResult(null);
      levelCompleteRef.current = false;
      buildLevel();
      beginLearnLevel();
    }, 2800);
  };

  const flashPraise = (text: string) => {
    setPraise(text);
    if (praiseTimerRef.current) clearTimeout(praiseTimerRef.current);
    praiseTimerRef.current = setTimeout(() => setPraise(null), 900);
  };

  const startGame = (m: "learn" | "survival") => {
    resetState();
    modeRef.current = m;
    setMode(m);
    levelRef.current = 1;
    setLevel(1);
    buildLevel();
    if (m === "learn") {
      beginLearnLevel();
    } else {
      countdownRef.current = 3.0;
      setCountdownNum(3);
      playVoice("ready");
    }
  };

  const resetState = () => {
    if (goTimerRef.current) clearTimeout(goTimerRef.current);
    if (nextLevelTimerRef.current) clearTimeout(nextLevelTimerRef.current);
    if (praiseTimerRef.current) clearTimeout(praiseTimerRef.current);
    enemiesRef.current = [];
    bulletsRef.current = [];
    particlesRef.current = [];
    beamsRef.current = [];
    lastFireRef.current = 0;
    comboRef.current = 0;
    elapsedRef.current = 0;
    healthRef.current = config.playerHealth;
    gameOverRef.current = false;
    missStreakRef.current = 0;
    banUntilRef.current = 0;
    killsRef.current = 0;
    activeTargetRef.current = null;
    pendingShotsRef.current = [];
    killTimesRef.current = [];
    rewardUntilRef.current = 0;
    rewardTypeRef.current = null;
    waveQueueRef.current = [];
    waveTotalRef.current = 0;
    spawnedRef.current = 0;
    levelCompleteRef.current = false;
    statsRef.current = { hits: 0, misses: 0 };
    setHudCombo(0);
    setHudHealth(config.playerHealth);
    setGameOver(false);
    setMissStreak(0);
    setBanRemaining(0);
    setKills(0);
    setWaveTotal(0);
    setRewardType(null);
    setRewardRemaining(0);
    setCountdownNum(null);
    setNewLetter(null);
    setLevelResult(null);
    setPraise(null);
    setShowBanner(false);
  };

  const toMenu = () => {
    resetState();
    modeRef.current = "menu";
    setMode("menu");
    levelRef.current = 1;
    setLevel(1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (gameOverRef.current) {
        if (e.key === "Enter") startGame(modeRef.current === "survival" ? "survival" : "learn");
        return;
      }
      if (modeRef.current === "menu") return;
      if (countdownRef.current > 0 || levelCompleteRef.current) return;

      const k = e.key.toUpperCase();
      if (k.length !== 1 || !/[A-Z]/.test(k)) return;

      if (performance.now() < banUntilRef.current) {
        audio.jam();
        return;
      }

      const active = activeTargetRef.current != null
        ? enemiesRef.current.find(e => e.id === activeTargetRef.current) || null
        : null;
      if (!active) activeTargetRef.current = null;

      const registerHit = (en: Enemy) => {
        // Only multi-letter words advance progress. Single letters stay
        // targetable while alive, so you can fire as much as you want.
        if (en.word.length > 1) {
          en.typed += 1;
          if (en.typed < en.word.length) activeTargetRef.current = en.id;
          else if (activeTargetRef.current === en.id) activeTargetRef.current = null;
        }
        queueShot(en);
        comboRef.current += 1;
        setHudCombo(comboRef.current);
        statsRef.current.hits += 1;
        if (comboRef.current > 0 && comboRef.current % 10 === 0) {
          flashPraise(comboRef.current >= 30 ? "AMAZING!" : comboRef.current >= 20 ? "GREAT!" : "NICE!");
        }
        if (missStreakRef.current !== 0) { missStreakRef.current = 0; setMissStreak(0); }
      };

      const registerMiss = () => {
        comboRef.current = 0;
        setHudCombo(0);
        statsRef.current.misses += 1;
        missStreakRef.current += 1;
        setMissStreak(missStreakRef.current);
        audio.jam();
        if (modeRef.current === "learn") {
          // Gentle while learning: short ban, never instant destruction.
          const penalty = learnBanMs(levelRef.current);
          banUntilRef.current = performance.now() + penalty;
          setBanRemaining(penalty);
        } else {
          const MISS_PENALTY_MS = [2000, 4000, 7000];
          if (missStreakRef.current >= 4) {
            healthRef.current = 0;
            setHudHealth(0);
            gameOverRef.current = true;
            setGameOver(true);
            audio.boom();
          } else {
            const penalty = MISS_PENALTY_MS[missStreakRef.current - 1];
            banUntilRef.current = performance.now() + penalty;
            setBanRemaining(penalty);
          }
        }
      };

      if (active && active.word[active.typed] === k) {
        registerHit(active);
        return;
      }

      const { w, h } = sizeRef.current;
      const cx = w * 0.93, cy = h * 0.5;
      let best: Enemy | null = null;
      let bestD = Infinity;
      for (const en of enemiesRef.current) {
        const idx = en.typed;
        if (idx < en.word.length && en.word[idx] === k) {
          const d = Math.hypot(en.x - cx, en.y - cy);
          if (d < bestD) { bestD = d; best = en; }
        }
      }
      if (best) registerHit(best);
      else registerMiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    let raf = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - lastTimeRef.current) / 1000);
      lastTimeRef.current = now;

      const { w, h } = sizeRef.current;
      const cx = w * 0.93, cy = h * 0.5;
      const playing = modeRef.current !== "menu" && !gameOverRef.current && !levelCompleteRef.current;

      // Pre-wave countdown: freeze the battlefield.
      if (playing && countdownRef.current > 0) {
        countdownRef.current -= dt;
        setCountdownNum(Math.max(0, Math.ceil(countdownRef.current)));
        if (countdownRef.current <= 0) startWave();
        draw();
        raf = requestAnimationFrame(loop);
        return;
      }

      if (playing) {
        elapsedRef.current += dt;
        if (modeRef.current === "survival") {
          lastSpawnRef.current += dt * 1000;
          const interval = spawnIntervalMs(levelRef.current, elapsedRef.current);
          if (lastSpawnRef.current > interval) { lastSpawnRef.current = 0; spawnEnemy(); }
        } else {
          if (waveQueueRef.current.length > 0) {
            lastSpawnRef.current += dt * 1000;
            if (lastSpawnRef.current > spacingRef.current) {
              lastSpawnRef.current = 0;
              spawnLearnEnemy(waveQueueRef.current.shift()!);
              spawnedRef.current += 1;
            }
          }
        }
      }

      const rem = Math.max(0, banUntilRef.current - now);
      setBanRemaining(rem);

      if (rewardTypeRef.current) {
        const rr = Math.max(0, rewardUntilRef.current - now);
        setRewardRemaining(rr);
        if (rr <= 0) { rewardTypeRef.current = null; setRewardType(null); }
      }

      if (levelBannerRef.current > 0) {
        levelBannerRef.current -= dt;
        if (levelBannerRef.current <= 0) setShowBanner(false);
      }

      for (const en of enemiesRef.current) {
        en.age += dt;
        en.t += en.speed * dt;
        const p = pathsRef.current[en.pathIdx];
        const pos = pointOnPath(p, en.t);
        en.baseX = pos.x; en.baseY = pos.y;
        const swayS = en.sway > 0 ? Math.sin(en.age * en.swayFreq + en.swayPhase) * en.sway : 0;
        const offset = en.lane + swayS;
        if (offset !== 0) {
          const tan = pathTangent(p, en.t);
          const nx = -tan.y, ny = tan.x;
          en.x = pos.x + nx * offset;
          en.y = pos.y + ny * offset;
        } else {
          en.x = pos.x; en.y = pos.y;
        }
      }

      const survivors: Enemy[] = [];
      for (const en of enemiesRef.current) {
        const p = pathsRef.current[en.pathIdx];
        if (en.t >= p.total - 4) {
          const dmg = config.enemyDamage * (en.kind === "tank" ? 2 : 1);
          healthRef.current -= dmg;
          setHudHealth(Math.max(0, healthRef.current));
          explode(en.x, en.y, en.kind === "tank");
          audio.thud();
          comboRef.current = 0;
          setHudCombo(0);
          if (activeTargetRef.current === en.id) activeTargetRef.current = null;
          if (healthRef.current <= 0 && !gameOverRef.current) {
            gameOverRef.current = true;
            setGameOver(true);
          }
        } else {
          survivors.push(en);
        }
      }
      enemiesRef.current = survivors;

      const killEnemy = (en: Enemy) => {
        enemiesRef.current = enemiesRef.current.filter(e => e.id !== en.id);
        if (activeTargetRef.current === en.id) activeTargetRef.current = null;
        registerKill();
      };
      const refundTarget = (b: Bullet) => {
        if (b.hitIds.length > 0) return;
        const en = enemiesRef.current.find(e => e.id === b.targetId);
        if (en && en.typed > 0) {
          en.typed -= 1;
          if (en.word.length > 1 && activeTargetRef.current == null) activeTargetRef.current = en.id;
        }
      };
      const areaKill = (x: number, y: number, radius: number, max: number) => {
        const cand = enemiesRef.current
          .map(e => ({ e, d: Math.hypot(e.x - x, e.y - y) }))
          .filter(o => o.d <= radius)
          .sort((a, b) => a.d - b.d)
          .slice(0, max);
        for (const { e } of cand) { explode(e.x, e.y, e.kind === "tank"); killEnemy(e); }
      };
      const chainKill = (x: number, y: number, max: number) => {
        const cand = enemiesRef.current
          .map(e => ({ e, d: Math.hypot(e.x - x, e.y - y) }))
          .sort((a, b) => a.d - b.d)
          .slice(0, max);
        for (const { e } of cand) {
          beamsRef.current.push({ x1: x, y1: y, x2: e.x, y2: e.y, life: 0.16, color: "#a8f0ff" });
          explode(e.x, e.y, false);
          killEnemy(e);
        }
      };

      const aliveBullets: Bullet[] = [];
      for (const b of bulletsRef.current) {
        b.speed = Math.min(b.maxSpeed, b.speed + b.accel * dt);
        const nx = b.x + b.dx * b.speed * dt;
        const ny = b.y + b.dy * b.speed * dt;
        b.life -= dt;
        let consumed = false;

        if (b.mode !== "pierce" && b.mode !== "laser") {
          for (const o of obstaclesRef.current) {
            if (segCircleHit(b.x, b.y, nx, ny, o.x, o.y, o.r + 2)) {
              sparks(o.x, o.y);
              o.hp -= 1;
              if (o.hp <= 0) {
                audio.tick();
              } else {
                const rnx = (b.x - o.x);
                const rny = (b.y - o.y);
                const rl = Math.hypot(rnx, rny) || 1;
                const nnx = rnx / rl, nny = rny / rl;
                const dot = b.dx * nnx + b.dy * nny;
                b.dx = b.dx - 2 * dot * nnx;
                b.dy = b.dy - 2 * dot * nny;
                b.bounces += 1;
                b.speed *= 0.85;
                audio.tick();
                if (b.bounces > 2) consumed = true;
              }
              b.x = nx; b.y = ny;
              if (!consumed) aliveBullets.push(b);
              else refundTarget(b);
              consumed = true;
              break;
            }
          }
          if (consumed) continue;
        }

        if (b.mode === "pierce") {
          for (const en of [...enemiesRef.current]) {
            if (b.hitIds.includes(en.id)) continue;
            if (segCircleHit(b.x, b.y, nx, ny, en.x, en.y, en.radius)) {
              b.hitIds.push(en.id);
              explode(en.x, en.y, en.kind === "tank");
              audio.boom();
              killEnemy(en);
            }
          }
        } else if (b.mode === "bounce") {
          let dead = false, bounced = false;
          for (const en of enemiesRef.current) {
            if (b.hitIds.includes(en.id)) continue;
            if (segCircleHit(b.x, b.y, nx, ny, en.x, en.y, en.radius)) {
              b.hitIds.push(en.id);
              explode(en.x, en.y, en.kind === "tank");
              audio.boom();
              killEnemy(en);
              b.bounceHits += 1;
              if (b.bounceHits >= 10) { dead = true; }
              else {
                const a = Math.random() * Math.PI * 2;
                b.dx = Math.cos(a); b.dy = Math.sin(a);
                b.x = en.x; b.y = en.y; b.life = 1.2;
                bounced = true;
              }
              break;
            }
          }
          if (dead) continue;
          if (bounced) { aliveBullets.push(b); continue; }
        } else {
          let hitEnemy = false;
          for (const en of enemiesRef.current) {
            if (segCircleHit(b.x, b.y, nx, ny, en.x, en.y, en.radius)) {
              b.hitIds.push(en.id);
              sparks(en.x, en.y);
              const ex = en.x, ey = en.y;
              if (b.mode === "explosive") {
                explode(ex, ey, true);
                audio.boom();
                killEnemy(en);
                areaKill(ex, ey, 100, 3);
              } else if (b.mode === "electric") {
                explode(ex, ey, false);
                audio.boom();
                killEnemy(en);
                chainKill(ex, ey, 3);
              } else {
                en.hp -= 1;
                if (en.hp <= 0) {
                  explode(ex, ey, en.kind === "tank");
                  audio.boom();
                  killEnemy(en);
                }
              }
              hitEnemy = true;
              break;
            }
          }
          if (hitEnemy) continue;
        }

        b.x = nx; b.y = ny;
        if (b.life > 0 && b.x > -60 && b.x < w + 60 && b.y > -60 && b.y < h + 60) {
          aliveBullets.push(b);
        } else {
          refundTarget(b);
        }
      }
      bulletsRef.current = aliveBullets;
      obstaclesRef.current = obstaclesRef.current.filter(o => o.hp > 0);

      for (const bm of beamsRef.current) bm.life -= dt;
      beamsRef.current = beamsRef.current.filter(bm => bm.life > 0);

      for (const p of particlesRef.current) {
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vx *= 0.92; p.vy *= 0.92;
        p.life -= dt;
      }
      particlesRef.current = particlesRef.current.filter(p => p.life > 0);

      if (muzzleRef.current) {
        muzzleRef.current.life -= dt;
        if (muzzleRef.current.life <= 0) muzzleRef.current = null;
      }
      if (recoilRef.current > 0) recoilRef.current = Math.max(0, recoilRef.current - dt * 40);

      const pending = pendingShotsRef.current;
      while (pending.length) {
        const en = enemiesRef.current.find(e => e.id === pending[0].enemyId);
        if (!en) { pending.shift(); continue; }
        targetAngleRef.current = Math.atan2(en.y - cy, en.x - cx);
        break;
      }

      let diff = targetAngleRef.current - turretAngleRef.current;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const rotSpeed = (config.turretRotSpeedDeg * Math.PI) / 180;
      const maxStep = rotSpeed * dt;
      if (Math.abs(diff) <= maxStep) turretAngleRef.current = targetAngleRef.current;
      else turretAngleRef.current += Math.sign(diff) * maxStep;

      const fireInterval = 1000 / (config.fireRatePerSec + (comboRef.current >= 15 ? 2 : 0));
      if (pending.length && Math.abs(diff) < 0.08 && now - lastFireRef.current >= fireInterval) {
        const en = enemiesRef.current.find(e => e.id === pending[0].enemyId);
        if (en) { spawnBullet(en); lastFireRef.current = now; }
        pending.shift();
      }

      // Learn: level clears once the whole roster is spawned and the field is empty.
      if (playing && modeRef.current === "learn"
        && spawnedRef.current > 0
        && waveQueueRef.current.length === 0
        && enemiesRef.current.length === 0) {
        completeLearnLevel();
      }

      draw();
      raf = requestAnimationFrame(loop);
    };

    const draw = () => {
      const c = canvasRef.current!;
      const ctx = c.getContext("2d")!;
      const { w, h } = sizeRef.current;
      const cx = w * 0.93, cy = h * 0.5;

      ctx.fillStyle = "#2a2620";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(90, 75, 55, 0.25)";
      for (let i = 0; i < 6; i++) {
        const px = (i * 173) % w;
        const py = (i * 251) % h;
        ctx.beginPath();
        ctx.ellipse(px, py, 120, 70, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = "rgba(255,255,255,0.03)";
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 0; y < h; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

      for (const p of pathsRef.current) {
        ctx.strokeStyle = "#1a1612";
        ctx.lineWidth = config.pathWidth + 6;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(p.points[0].x, p.points[0].y);
        for (let i = 1; i < p.points.length; i++) ctx.lineTo(p.points[i].x, p.points[i].y);
        ctx.stroke();
        ctx.strokeStyle = "#5a4632";
        ctx.lineWidth = config.pathWidth;
        ctx.stroke();
        ctx.strokeStyle = "rgba(0,0,0,0.18)";
        ctx.lineWidth = 4;
        ctx.setLineDash([14, 18]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      for (const o of obstaclesRef.current) {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.beginPath(); ctx.ellipse(o.x + 2, o.y + 4, o.r + 2, (o.r + 2) * 0.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#3a2e22";
        ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#1a1410"; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        ctx.beginPath(); ctx.arc(o.x - o.r * 0.3, o.y - o.r * 0.3, o.r * 0.4, 0, Math.PI * 2); ctx.fill();
      }

      for (const bm of beamsRef.current) {
        const a = Math.max(0, Math.min(1, bm.life / 0.16));
        ctx.globalAlpha = a;
        ctx.strokeStyle = bm.color;
        ctx.lineWidth = 6;
        ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(bm.x1, bm.y1); ctx.lineTo(bm.x2, bm.y2); ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(bm.x1, bm.y1); ctx.lineTo(bm.x2, bm.y2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.lineCap = "butt";

      const bulletColors: Record<BulletMode, { trail: string; core: string; dot: string }> = {
        normal: { trail: "rgba(255,180,80,0.35)", core: "rgba(255,255,220,1)", dot: "#fffbe6" },
        pierce: { trail: "rgba(120,220,255,0.4)", core: "rgba(200,245,255,1)", dot: "#dff6ff" },
        explosive: { trail: "rgba(255,120,60,0.4)", core: "rgba(255,210,150,1)", dot: "#ffd9b0" },
        bounce: { trail: "rgba(180,120,255,0.4)", core: "rgba(225,200,255,1)", dot: "#e8ddff" },
        laser: { trail: "rgba(125,249,255,0.5)", core: "rgba(230,255,255,1)", dot: "#e6ffff" },
        electric: { trail: "rgba(120,200,255,0.5)", core: "rgba(210,240,255,1)", dot: "#d2f0ff" },
      };
      for (const b of bulletsRef.current) {
        const len = Math.min(34, 10 + b.speed / 70);
        const ux = b.dx, uy = b.dy;
        const tx = b.x - ux * len, ty = b.y - uy * len;
        const special = b.mode !== "normal";
        const cc = bulletColors[b.mode];
        ctx.strokeStyle = cc.trail;
        ctx.lineWidth = special ? 9 : 7;
        ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y); ctx.stroke();
        const grad = ctx.createLinearGradient(tx, ty, b.x, b.y);
        grad.addColorStop(0, "rgba(255,220,120,0)");
        grad.addColorStop(1, cc.core);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.fillStyle = cc.dot;
        ctx.beginPath(); ctx.arc(b.x, b.y, special ? 4 : 3, 0, Math.PI * 2); ctx.fill();
        ctx.lineCap = "butt";
      }

      for (const en of enemiesRef.current) {
        const isActive = activeTargetRef.current === en.id;
        ctx.fillStyle = "rgba(0,0,0,0.4)";
        ctx.beginPath();
        ctx.ellipse(en.x + 3, en.y + 5, en.radius, en.radius * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        let bodyR = 90, bodyG = 107, bodyB = 58;
        if (en.kind === "runner") { bodyR = 170; bodyG = 60; bodyB = 45; }
        else if (en.kind === "tank") { bodyR = 60; bodyG = 60; bodyB = 60; }
        else if (en.kind === "weaver") { bodyR = 110; bodyG = 90; bodyB = 140; }
        ctx.fillStyle = `rgb(${bodyR},${bodyG},${bodyB})`;
        ctx.beginPath(); ctx.arc(en.x, en.y, en.radius, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = isActive ? "#ffcc33" : "#2e3a1f";
        ctx.lineWidth = isActive ? 3 : 2;
        ctx.stroke();
        if (en.kind === "tank") {
          ctx.fillStyle = "#333";
          ctx.fillRect(en.x - 4, en.y - en.radius * 0.5, en.radius * 0.9, 8);
        }
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.beginPath();
        ctx.arc(en.x - 5, en.y - 4, 5, 0, Math.PI * 2);
        ctx.arc(en.x + 6, en.y + 3, 4, 0, Math.PI * 2);
        ctx.fill();

        const label = en.word;
        ctx.font = "bold 22px ui-monospace, Menlo, monospace";
        const tw = ctx.measureText(label).width;
        const padX = 10;
        const bx = en.x - tw / 2 - padX;
        const by = en.y - en.radius - 34;
        const bw = tw + padX * 2;
        const bh = 30;
        ctx.fillStyle = isActive ? "rgba(30,10,0,0.9)" : "rgba(0,0,0,0.85)";
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = isActive ? "#ff8c2a" : "#ffcc33";
        ctx.lineWidth = 2; ctx.strokeRect(bx, by, bw, bh);
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        let cursorX = bx + padX;
        const midY = by + bh / 2 + 1;
        for (let i = 0; i < label.length; i++) {
          const ch = label[i];
          ctx.fillStyle = i < en.typed ? "rgba(255,255,255,0.28)" : (isActive ? "#ffd966" : "#ffe066");
          ctx.fillText(ch, cursorX, midY);
          cursorX += ctx.measureText(ch).width;
        }
        ctx.textAlign = "center";
      }

      const recoil = recoilRef.current;
      const ang = turretAngleRef.current;
      ctx.fillStyle = "#1a1a1a";
      ctx.beginPath(); ctx.arc(cx, cy, 34, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#3a3a3a";
      ctx.beginPath(); ctx.arc(cx, cy, 30, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.translate(cx - Math.cos(ang) * recoil, cy - Math.sin(ang) * recoil);
      ctx.rotate(ang);
      const glow = comboRef.current >= 5;
      ctx.fillStyle = glow ? "#664422" : "#2a2a2a";
      ctx.fillRect(0, -8, 46, 16);
      ctx.strokeStyle = glow ? "#ff8c2a" : "#111";
      ctx.lineWidth = 2;
      ctx.strokeRect(0, -8, 46, 16);
      if (muzzleRef.current) {
        const m = muzzleRef.current.life / 0.08;
        ctx.fillStyle = `rgba(255,220,120,${m})`;
        ctx.beginPath();
        ctx.moveTo(46, -10); ctx.lineTo(72, 0); ctx.lineTo(46, 10);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      ctx.fillStyle = "#222";
      ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI * 2); ctx.fill();

      for (const p of particlesRef.current) {
        const a = Math.max(0, p.life / p.maxLife);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = a;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const banSec = banRemaining > 0 ? (banRemaining / 1000).toFixed(1) : "0.0";
  const banned = banRemaining > 0;
  const missDots = [0, 1, 2, 3];
  const isLearn = mode === "learn";
  const killGoal = isLearn ? (waveTotal || waveCount(level)) : killsForLevel(level);
  const killPct = Math.min(100, (kills / Math.max(1, killGoal)) * 100);
  const currentLetters = isLearn ? learnLetters(level).join("") : lettersForLevel(level);
  const wordLen = isLearn ? 1 : targetWordLength(level);
  const unlockedSpecials = [
    level >= 4 ? "💥" : null,
    level >= 5 ? "🎯" : null,
    level >= 6 ? "⚡" : null,
    level >= 7 ? "🔷" : null,
  ].filter(Boolean) as string[];

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden">
      <canvas ref={canvasRef} className="w-full h-full block" />

      {mode !== "menu" && (
        <div className="pointer-events-none absolute inset-0 p-4 flex flex-col justify-between text-foreground">
          <div className="flex items-start justify-between">
            <div className="bg-black/60 border border-white/10 rounded px-3 py-2 font-mono text-sm min-w-[240px]">
              <div className="flex items-baseline justify-between">
                <span className="text-white/60">{isLearn ? "LEVEL" : "SURVIVAL · LVL"}</span>
                <span className="text-2xl text-amber-300 font-bold leading-none">{level}</span>
              </div>
              <div className="mt-2 flex justify-between text-white/60 text-xs">
                <span>{isLearn ? "CLEARED" : "KILLS"}</span>
                <span>{kills}/{killGoal}</span>
              </div>
              <div className="h-1.5 bg-white/10 rounded overflow-hidden mt-1">
                <div className="h-full bg-gradient-to-r from-amber-500 to-yellow-200" style={{ width: `${killPct}%` }} />
              </div>
              <div className="mt-2 text-white/50 text-[10px] tracking-wider">
                {wordLen === 1 ? `LETTERS: ${currentLetters}` : `WORDS · LEN ${wordLen}`}
              </div>
              {unlockedSpecials.length > 0 && (
                <div className="mt-1 text-cyan-300/70 text-[10px] tracking-wider">
                  SPECIALS: {unlockedSpecials.join(" ")}
                </div>
              )}
            </div>
            <div className="bg-black/60 border border-white/10 rounded px-3 py-2 font-mono text-sm text-right">
              <div className="text-white/60">COMBO</div>
              <div className={`text-2xl font-bold leading-none ${hudCombo >= 10 ? "text-orange-400" : hudCombo >= 5 ? "text-amber-300" : "text-white"}`}>
                x{hudCombo}
              </div>
              {rewardType && (
                <div className={`mt-2 text-[11px] font-bold tracking-wide ${rewardType === "pierce" ? "text-cyan-300" : "text-orange-400"}`}>
                  {rewardType === "pierce" ? "⚡ PIERCING" : "💥 EXPLOSIVE"} {(rewardRemaining / 1000).toFixed(1)}s
                </div>
              )}
            </div>
          </div>
          <div className="flex justify-center gap-3">
            <div className="bg-black/60 border border-white/10 rounded px-3 py-2 w-96 font-mono text-xs">
              <div className="flex justify-between text-white/70 mb-1">
                <span>HEALTH</span>
                <span>{hudHealth}/{config.playerHealth}</span>
              </div>
              <div className="h-2 bg-white/10 rounded overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-red-600 to-amber-400 transition-[width]"
                  style={{ width: `${(hudHealth / config.playerHealth) * 100}%` }}
                />
              </div>
              <div className="flex justify-between items-center text-white/70 mt-2 mb-1">
                <span>MISS STREAK</span>
                <div className="flex gap-1">
                  {missDots.map(i => (
                    <span
                      key={i}
                      className={`inline-block w-2.5 h-2.5 rounded-full border ${
                        i < missStreak
                          ? (i === 3 && !isLearn ? "bg-red-500 border-red-300" : "bg-amber-400 border-amber-200")
                          : "bg-white/5 border-white/20"
                      }`}
                    />
                  ))}
                </div>
              </div>
              <div className={`flex justify-between mt-1 ${banned ? "text-red-300" : "text-white/40"}`}>
                <span>{banned ? "SHOT BAN" : "READY"}</span>
                <span>{banned ? `${banSec}s` : "—"}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Start menu */}
      {mode === "menu" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="text-center font-mono max-w-md px-6">
            <div className="text-5xl font-black text-amber-300 mb-2 tracking-widest drop-shadow-[0_0_20px_rgba(255,180,50,0.5)]">
              TYPING TOWER
            </div>
            <div className="text-white/60 mb-8 text-sm">Learn the letters. Defend the base.</div>
            <div className="flex flex-col gap-4">
              <button
                onClick={() => startGame("learn")}
                className="group rounded-lg border-2 border-amber-400/70 bg-amber-500/10 hover:bg-amber-500/25 transition px-6 py-5 text-left"
              >
                <div className="text-2xl font-bold text-amber-300">🎓 LEARN</div>
                <div className="text-white/60 text-xs mt-1">Start at A &amp; B, master a new letter every few levels.</div>
              </button>
              <button
                onClick={() => startGame("survival")}
                className="group rounded-lg border-2 border-red-400/60 bg-red-500/10 hover:bg-red-500/25 transition px-6 py-5 text-left"
              >
                <div className="text-2xl font-bold text-red-300">🔥 SURVIVAL</div>
                <div className="text-white/60 text-xs mt-1">Endless waves. Fast, chaotic, no limits.</div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New-letter intro card */}
      {newLetter && !gameOver && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="text-center font-mono animate-in">
            <div className="text-amber-200 text-2xl tracking-widest mb-3">NEW LETTER</div>
            <div className="text-9xl font-black text-amber-300 drop-shadow-[0_0_30px_rgba(255,180,50,0.7)]">
              {newLetter}
            </div>
          </div>
        </div>
      )}

      {/* Countdown / GO */}
      {countdownNum !== null && !newLetter && !gameOver && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className={`font-mono font-black tracking-widest ${countdownNum === 0 ? "text-green-400 text-8xl" : "text-amber-300 text-9xl"} drop-shadow-[0_0_25px_rgba(255,180,50,0.6)]`}>
            {countdownNum === 0 ? "GO!" : countdownNum}
          </div>
        </div>
      )}

      {/* Combo praise */}
      {praise && !gameOver && (
        <div className="pointer-events-none absolute inset-x-0 top-1/3 flex items-center justify-center">
          <div className="font-mono text-4xl font-black text-yellow-300 drop-shadow-[0_0_16px_rgba(255,220,80,0.7)]">
            {praise}
          </div>
        </div>
      )}

      {/* Level clear celebration */}
      {levelResult && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40">
          <div className="text-center font-mono">
            <div className="text-6xl font-black text-green-400 mb-4 tracking-widest drop-shadow-[0_0_24px_rgba(80,255,120,0.6)]">
              GOOD JOB!
            </div>
            <div className="text-5xl mb-2">
              {[0, 1, 2].map(i => (
                <span key={i} className={i < levelResult.stars ? "opacity-100" : "opacity-25"}>⭐</span>
              ))}
            </div>
            <div className="text-white/70 text-lg">Level {levelResult.level} cleared</div>
          </div>
        </div>
      )}

      {showBanner && !gameOver && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="font-mono text-amber-300 text-7xl font-black tracking-widest drop-shadow-[0_0_20px_rgba(255,180,50,0.6)]">
            LEVEL {level}
          </div>
        </div>
      )}

      {banned && !gameOver && countdownNum === null && !levelResult && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="font-mono text-red-500/90 text-6xl font-black tracking-widest animate-pulse">
            JAMMED {banSec}s
          </div>
        </div>
      )}

      {gameOver && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70">
          <div className="text-center font-mono">
            <div className="text-5xl font-bold text-red-500 mb-2">BASE DESTROYED</div>
            <div className="text-white/70 mb-6">
              Reached Level {level}. Press ENTER to try again.
            </div>
            <button
              onClick={toMenu}
              className="pointer-events-auto rounded border border-white/30 px-5 py-2 text-white/80 hover:bg-white/10 transition"
            >
              Back to menu
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
