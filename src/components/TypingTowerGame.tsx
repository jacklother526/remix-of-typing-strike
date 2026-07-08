import { useEffect, useRef, useState } from "react";
import config from "@/lib/game-config.json";
import {
  lettersForLevel,
  targetWordLength,
  spawnIntervalMs,
  enemySpeedMultiplier,
  pickEnemyKind,
  pickWord,
  pickLetter,
  killsForLevel,
  repeatCountForLevel,
  rollSpecialShot,
  type EnemyKind,
  type SpecialKind,
} from "@/lib/game-progression";

type Vec = { x: number; y: number };

type Enemy = {
  id: number;
  pathIdx: number;
  t: number;         // distance traveled along path
  x: number;         // rendered position (with sway)
  y: number;
  baseX: number;     // path centerline position
  baseY: number;
  kind: EnemyKind;
  word: string;      // 1 letter in L1-10, longer word in L11+
  typed: number;     // # of letters already destroyed
  hp: number;        // matches remaining letters
  speed: number;
  radius: number;
  lane: number;      // constant lateral offset inside the road (px)
  sway: number;      // amplitude px
  swayFreq: number;  // rad/s
  swayPhase: number;
  age: number;
};

// Combo rewards: pierce/explosive. Special shots: bounce/laser/electric/explosive.
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
  bounces: number;      // ricochets off obstacles
  mode: BulletMode;
  bounceHits: number;   // enemy bounces used (bounce mode)
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
  };
}

// Build a curvy path through a list of anchors, adding wobble between them.
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
  const lastFireRef = useRef(0); // performance.now() of last shot (fire-rate gate)
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
  const activeTargetRef = useRef<number | null>(null); // enemy id being typed in word mode
  const levelBannerRef = useRef(0); // sec remaining to display "LEVEL X"
  const pendingShotsRef = useRef<{ enemyId: number }[]>([]); // shots waiting for turret to aim
  const killTimesRef = useRef<number[]>([]); // timestamps (ms) of recent kills for combo reward
  const rewardUntilRef = useRef(0); // performance.now() until which a reward is active
  const rewardTypeRef = useRef<RewardKind | null>(null);

  const audio = useAudio();

  const [hudCombo, setHudCombo] = useState(0);
  const [hudHealth, setHudHealth] = useState(config.playerHealth);
  const [gameOver, setGameOver] = useState(false);
  const [banRemaining, setBanRemaining] = useState(0);
  const [missStreak, setMissStreak] = useState(0);
  const [level, setLevel] = useState(1);
  const [kills, setKills] = useState(0);
  const [showBanner, setShowBanner] = useState(false);
  const [rewardType, setRewardType] = useState<RewardKind | null>(null);
  const [rewardRemaining, setRewardRemaining] = useState(0);

  const buildLevel = () => {
    const { w, h } = sizeRef.current;
    const cx = w * 0.93, cy = h * 0.5;
    const jitter = (r: number) => (Math.random() - 0.5) * r;

    // Path anchors:
    //  0: straight-ish from left-middle
    //  1: UPPER — start near top-left, cross to top-right corner, then curve down to turret
    //  2: from left-lower
    //  3: LOWER — start near bottom-left, cross to bottom-right corner, then curve up to turret
    const upperCorner = { x: w * 0.9 + jitter(60), y: h * 0.1 + jitter(40) };
    const lowerCorner = { x: w * 0.9 + jitter(60), y: h * 0.9 + jitter(40) };

    const specs: Vec[][] = [
      [{ x: -20, y: h * 0.35 + jitter(60) }, { x: w * 0.55, y: h * 0.5 + jitter(80) }, { x: cx, y: cy }],
      [{ x: w * 0.08 + jitter(60), y: -20 }, upperCorner, { x: cx, y: cy }],
      [{ x: -20, y: h * 0.75 + jitter(60) }, { x: w * 0.5, y: h * 0.65 + jitter(60) }, { x: cx, y: cy }],
      [{ x: w * 0.12 + jitter(60), y: h + 20 }, lowerCorner, { x: cx, y: cy }],
    ];
    pathsRef.current = specs.map((s, i) => buildPathThrough(s, (i + 1) * 7919 + Math.floor(Math.random() * 9999)));

    // Obstacles — poles scattered off the roads, not blocking them.
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

  const spawnEnemy = () => {
    if (pathsRef.current.length === 0) return;
    const pi = Math.floor(Math.random() * pathsRef.current.length);
    const p = pathsRef.current[pi];
    const start = p.points[0];
    const lvl = levelRef.current;
    const kind = pickEnemyKind(lvl);

    // Word / letter
    const wordLen = targetWordLength(lvl);
    let word: string;
    if (wordLen === 1) {
      // Single-letter phase: same letter may repeat 2x or 3x at higher levels.
      const letter = pickLetter(lvl);
      const reps = kind === "tank" ? Math.min(3, repeatCountForLevel(lvl) + 1) : repeatCountForLevel(lvl);
      word = letter.repeat(reps);
    } else {
      // Tanks get a longer word
      const useLen = kind === "tank" ? Math.min(8, wordLen + 1) : wordLen;
      word = pickWord(useLen);
    }

    // Speed by kind + wider variety (some enemies are much faster).
    const mul = enemySpeedMultiplier(lvl, elapsedRef.current);
    const baseSpeed = config.enemySpeedMin + Math.random() * (config.enemySpeedMax - config.enemySpeedMin);
    let speed = baseSpeed * mul;
    let radius = 18;
    let sway = 0;
    let swayFreq = 0;

    if (kind === "runner") { speed *= 1.5; radius = 15; }
    else if (kind === "tank") { speed *= 0.55; radius = 26; }
    else if (kind === "weaver") { sway = 22; swayFreq = 3.4; }

    // ~14% of non-tanks get a burst of much higher speed.
    if (kind !== "tank" && Math.random() < 0.14) speed *= 1.9 + Math.random() * 1.3;

    // Lateral lane offset so targets fill the road width (not just the centerline).
    const half = config.pathWidth / 2 - radius - 2;
    const lane = half > 0 ? (Math.random() * 2 - 1) * half : 0;

    enemiesRef.current.push({
      id: nextId(),
      pathIdx: pi,
      t: 0,
      x: start.x, y: start.y,
      baseX: start.x, baseY: start.y,
      kind,
      word,
      typed: 0,
      hp: word.length,
      speed,
      radius,
      lane,
      sway,
      swayFreq,
      swayPhase: Math.random() * Math.PI * 2,
      age: 0,
    });
  };


  const explode = (x: number, y: number, big = false) => {
    const n = big ? 40 : 24;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 80 + Math.random() * (big ? 360 : 240);
      particlesRef.current.push({
        x, y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.5 + Math.random() * 0.4, maxLife: 0.9,
        color: Math.random() < 0.5 ? "#ffb347" : "#ff5722",
        size: 2 + Math.random() * 3,
      });
    }
    for (let i = 0; i < (big ? 18 : 10); i++) {
      const a = Math.random() * Math.PI * 2;
      particlesRef.current.push({
        x, y,
        vx: Math.cos(a) * (30 + Math.random() * 80),
        vy: Math.sin(a) * (30 + Math.random() * 80),
        life: 0.7, maxLife: 0.7,
        color: "#555", size: 4 + Math.random() * 4,
      });
    }
  };

  const sparks = (x: number, y: number) => {
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 60 + Math.random() * 140;
      particlesRef.current.push({
        x, y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.25, maxLife: 0.25,
        color: "#ffd966", size: 1.5 + Math.random() * 1.5,
      });
    }
  };

  const currentBulletSpeed = () => {
    const v = config.bulletSpeedBase + elapsedRef.current * config.bulletSpeedGrowthPerSec;
    return Math.min(v, config.bulletSpeedMax);
  };

  // Queue a shot: the turret must rotate to face the target before firing.
  const queueShot = (enemy: Enemy) => {
    pendingShotsRef.current.push({ enemyId: enemy.id });
  };

  // Actually spawn the bullet once the turret is aimed.
  // Special shots (chance-based, by level) take priority over combo rewards.
  const spawnBullet = (enemy: Enemy) => {
    const { w, h } = sizeRef.current;
    const cx = w * 0.93, cy = h * 0.5;
    const dx = enemy.x - cx;
    const dy = enemy.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    const ang = Math.atan2(dy, dx);
    const now = performance.now();

    // Decide bullet mode: special roll wins; otherwise fall back to combo reward.
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
      // Instant hit: extreme speed so the first frame's segment reaches the target.
      launchSpeed = 60000; maxSpeed = 60000; accel = 0;
    } else {
      const base = currentBulletSpeed();
      const jitter = 1 + (Math.random() * 2 - 1) * config.bulletJitter;
      launchSpeed = base * jitter;
      maxSpeed = launchSpeed * 2;
      accel = (maxSpeed * maxSpeed - launchSpeed * launchSpeed) / (2 * Math.max(60, len));
    }

    bulletsRef.current.push({
      id: nextId(),
      x: cx, y: cy,
      dx: dx / len, dy: dy / len,
      speed: launchSpeed, launchSpeed, accel, maxSpeed,
      targetId: enemy.id,
      life: mode === "laser" ? 0.06 : 1.5,
      bounces: 0,
      mode,
      bounceHits: 0,
      hitIds: [],
    });
    recoilRef.current = 8;
    muzzleRef.current = { angle: ang, life: 0.08 };
    if (mode === "laser") beamsRef.current.push({ x1: cx, y1: cy, x2: enemy.x, y2: enemy.y, life: 0.12, color: "#7df9ff" });
    audio.shot();
  };


  // Grant a combo reward: 10 kills within 10 seconds.
  const REWARD_LIST: RewardKind[] = ["pierce", "explosive"];
  const maybeGrantReward = () => {
    const now = performance.now();
    killTimesRef.current.push(now);
    killTimesRef.current = killTimesRef.current.filter((t) => now - t <= 10000);
    if (killTimesRef.current.length >= 10) {
      killTimesRef.current = [];
      const kind = REWARD_LIST[Math.floor(Math.random() * REWARD_LIST.length)];
      // Higher combo => longer reward (10s), otherwise 5s.
      const durationMs = comboRef.current >= 20 ? 10000 : 5000;
      rewardTypeRef.current = kind;
      rewardUntilRef.current = now + durationMs;
      setRewardType(kind);
      setRewardRemaining(durationMs);
      audio.boom();
    }
  };

  const registerKill = () => {
    killsRef.current += 1;
    setKills(killsRef.current);
    maybeGrantReward();
    if (killsRef.current >= killsForLevel(levelRef.current)) {
      // Advance level
      killsRef.current = 0;
      setKills(0);
      levelRef.current += 1;
      setLevel(levelRef.current);
      levelBannerRef.current = 2.2;
      setShowBanner(true);
      buildLevel();
      // Clear old-level enemies visually (leave bullets)
      enemiesRef.current = [];
      activeTargetRef.current = null;
      pendingShotsRef.current = [];
      audio.boom();
    }
  };

  useEffect(() => {
    const MISS_PENALTY_MS = [2000, 4000, 7000];
    const onKey = (e: KeyboardEvent) => {
      if (gameOverRef.current) {
        if (e.key === "Enter") restart();
        return;
      }
      const k = e.key.toUpperCase();
      if (k.length !== 1 || !/[A-Z]/.test(k)) return;

      if (performance.now() < banUntilRef.current) {
        audio.jam();
        return;
      }


      // Soft word lock: if a word is mid-type and its next letter matches, keep
      // going. If it doesn't match, DON'T penalize — fall through and try to hit
      // any other enemy that holds this letter (rotate to an existing target).
      const active = activeTargetRef.current != null
        ? enemiesRef.current.find(e => e.id === activeTargetRef.current) || null
        : null;
      if (!active) activeTargetRef.current = null;

      const registerHit = (en: Enemy) => {
        en.typed += 1;
        queueShot(en);
        if (en.word.length > 1 && en.typed < en.word.length) {
          activeTargetRef.current = en.id;
        } else if (activeTargetRef.current === en.id) {
          activeTargetRef.current = null;
        }
        comboRef.current += 1;
        setHudCombo(comboRef.current);
        if (missStreakRef.current !== 0) { missStreakRef.current = 0; setMissStreak(0); }
      };

      const registerMiss = () => {
        comboRef.current = 0;
        setHudCombo(0);
        missStreakRef.current += 1;
        setMissStreak(missStreakRef.current);
        audio.jam();
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
      };

      // 1) Continue the active word if the next letter matches.
      if (active && active.word[active.typed] === k) {
        registerHit(active);
        return;
      }

      // 2) Otherwise, fire at the CLOSEST enemy whose next-needed letter matches.
      //    (No target is greyed out or blocked — any enemy holding this letter
      //     is a valid target.)
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
      if (best) {
        registerHit(best);
      } else {
        // Truly no enemy holds this letter → this is a mistake.
        registerMiss();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);


  const restart = () => {
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
    levelRef.current = 1;
    killsRef.current = 0;
    activeTargetRef.current = null;
    pendingShotsRef.current = [];
    killTimesRef.current = [];
    rewardUntilRef.current = 0;
    rewardTypeRef.current = null;
    setHudCombo(0);
    setHudHealth(config.playerHealth);
    setGameOver(false);
    setMissStreak(0);
    setBanRemaining(0);
    setLevel(1);
    setKills(0);
    setRewardType(null);
    setRewardRemaining(0);
    buildLevel();
  };

  useEffect(() => {
    let raf = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - lastTimeRef.current) / 1000);
      lastTimeRef.current = now;

      if (!gameOverRef.current) {
        elapsedRef.current += dt;
        lastSpawnRef.current += dt * 1000;
        const interval = spawnIntervalMs(levelRef.current, elapsedRef.current);
        if (lastSpawnRef.current > interval) {
          lastSpawnRef.current = 0;
          spawnEnemy();
        }
      }

      const rem = Math.max(0, banUntilRef.current - now);
      setBanRemaining(rem);

      // Reward countdown
      if (rewardTypeRef.current) {
        const rr = Math.max(0, rewardUntilRef.current - now);
        setRewardRemaining(rr);
        if (rr <= 0) {
          rewardTypeRef.current = null;
          setRewardType(null);
        }
      }

      if (levelBannerRef.current > 0) {
        levelBannerRef.current -= dt;
        if (levelBannerRef.current <= 0) setShowBanner(false);
      }

      const { w, h } = sizeRef.current;
      const cx = w * 0.93, cy = h * 0.5;

      // Move enemies along path + sway
      for (const en of enemiesRef.current) {
        en.age += dt;
        en.t += en.speed * dt;
        const p = pathsRef.current[en.pathIdx];
        const pos = pointOnPath(p, en.t);
        en.baseX = pos.x; en.baseY = pos.y;
        if (en.sway > 0) {
          const tan = pathTangent(p, en.t);
          const nx = -tan.y, ny = tan.x;
          const s = Math.sin(en.age * en.swayFreq + en.swayPhase) * en.sway;
          en.x = pos.x + nx * s;
          en.y = pos.y + ny * s;
        } else {
          en.x = pos.x; en.y = pos.y;
        }
      }

      // Enemy reaches turret
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

      // Bullets
      const killEnemy = (en: Enemy) => {
        enemiesRef.current = enemiesRef.current.filter(e => e.id !== en.id);
        if (activeTargetRef.current === en.id) activeTargetRef.current = null;
        registerKill();
      };
      // A bullet that never touched an enemy (blocked / flew off) refunds the
      // target's letter so the player can simply fire at it again.
      const refundTarget = (b: Bullet) => {
        if (b.hitIds.length > 0) return;
        const en = enemiesRef.current.find(e => e.id === b.targetId);
        if (en && en.typed > 0) {
          en.typed -= 1;
          if (en.word.length > 1 && activeTargetRef.current == null) activeTargetRef.current = en.id;
        }
      };

      const aliveBullets: Bullet[] = [];
      for (const b of bulletsRef.current) {
        b.speed = Math.min(b.maxSpeed, b.speed + b.accel * dt);
        const nx = b.x + b.dx * b.speed * dt;
        const ny = b.y + b.dy * b.speed * dt;
        b.life -= dt;
        let consumed = false;

        // obstacles — with ricochet (piercing bullets ignore obstacles)
        if (!b.pierce) {
          for (const o of obstaclesRef.current) {
            if (segCircleHit(b.x, b.y, nx, ny, o.x, o.y, o.r + 2)) {
              sparks(o.x, o.y);
              o.hp -= 1;
              if (o.hp <= 0) {
                // punch through — bullet continues
                audio.tick();
              } else {
                // reflect off obstacle
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
              consumed = true; // handled this frame
              break;
            }
          }
          if (consumed) continue;
        }

        // enemies
        if (b.pierce) {
          // Armor-piercing: destroy every enemy along the path, keep flying.
          for (const en of [...enemiesRef.current]) {
            if (b.hitIds.includes(en.id)) continue;
            if (segCircleHit(b.x, b.y, nx, ny, en.x, en.y, en.radius)) {
              b.hitIds.push(en.id);
              explode(en.x, en.y, en.kind === "tank");
              audio.boom();
              killEnemy(en);
            }
          }
        } else {
          let hitEnemy = false;
          for (const en of enemiesRef.current) {
            if (segCircleHit(b.x, b.y, nx, ny, en.x, en.y, en.radius)) {
              b.hitIds.push(en.id);
              sparks(en.x, en.y);
              if (b.explosive) {
                // Detonate: destroy target + nearby enemies.
                explode(en.x, en.y, true);
                audio.boom();
                const ex = en.x, ey = en.y;
                killEnemy(en);
                const R = 95;
                for (const other of [...enemiesRef.current]) {
                  if (Math.hypot(other.x - ex, other.y - ey) <= R) {
                    explode(other.x, other.y, other.kind === "tank");
                    killEnemy(other);
                  }
                }
              } else {
                en.hp -= 1;
                if (en.hp <= 0) {
                  explode(en.x, en.y, en.kind === "tank");
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


      // particles
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

      // Aim at the next queued shot's target, rotate, then fire only once aligned.
      const pending = pendingShotsRef.current;
      while (pending.length) {
        const en = enemiesRef.current.find(e => e.id === pending[0].enemyId);
        if (!en) { pending.shift(); continue; } // target gone, drop the shot
        targetAngleRef.current = Math.atan2(en.y - cy, en.x - cx);
        break;
      }

      let diff = targetAngleRef.current - turretAngleRef.current;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      turretAngleRef.current += diff * Math.min(1, dt * 18);

      // Fire the queued shot once the barrel points at the target.
      if (pending.length && Math.abs(diff) < 0.1) {
        const en = enemiesRef.current.find(e => e.id === pending[0].enemyId);
        if (en) spawnBullet(en);
        pending.shift();
      }

      draw();
      raf = requestAnimationFrame(loop);
    };

    const draw = () => {
      const c = canvasRef.current!;
      const ctx = c.getContext("2d")!;
      const { w, h } = sizeRef.current;
      const cx = w * 0.93, cy = h * 0.5;

      // Ground
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

      // Paths
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

      // Obstacles
      for (const o of obstaclesRef.current) {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.beginPath(); ctx.ellipse(o.x + 2, o.y + 4, o.r + 2, (o.r + 2) * 0.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#3a2e22";
        ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#1a1410"; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        ctx.beginPath(); ctx.arc(o.x - o.r * 0.3, o.y - o.r * 0.3, o.r * 0.4, 0, Math.PI * 2); ctx.fill();
      }

      // Bullets
      for (const b of bulletsRef.current) {
        const len = Math.min(34, 10 + b.speed / 70);
        const ux = b.dx, uy = b.dy;
        const tx = b.x - ux * len, ty = b.y - uy * len;
        // Color-code special reward bullets.
        const trail = b.pierce ? "rgba(120,220,255,0.4)" : b.explosive ? "rgba(255,120,60,0.4)" : "rgba(255,180,80,0.35)";
        const core = b.pierce ? "rgba(200,245,255,1)" : b.explosive ? "rgba(255,210,150,1)" : "rgba(255,255,220,1)";
        const dot = b.pierce ? "#dff6ff" : b.explosive ? "#ffd9b0" : "#fffbe6";
        ctx.strokeStyle = trail;
        ctx.lineWidth = b.pierce || b.explosive ? 9 : 7;
        ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y); ctx.stroke();
        const grad = ctx.createLinearGradient(tx, ty, b.x, b.y);
        grad.addColorStop(0, "rgba(255,220,120,0)");
        grad.addColorStop(1, core);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.fillStyle = dot;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.pierce || b.explosive ? 4 : 3, 0, Math.PI * 2); ctx.fill();
        ctx.lineCap = "butt";
      }


      // Enemies
      for (const en of enemiesRef.current) {
        const isActive = activeTargetRef.current === en.id;
        ctx.fillStyle = "rgba(0,0,0,0.4)";
        ctx.beginPath();
        ctx.ellipse(en.x + 3, en.y + 5, en.radius, en.radius * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        // body color by kind
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
          // turret hint
          ctx.fillStyle = "#333";
          ctx.fillRect(en.x - 4, en.y - en.radius * 0.5, en.radius * 0.9, 8);
        }
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.beginPath();
        ctx.arc(en.x - 5, en.y - 4, 5, 0, Math.PI * 2);
        ctx.arc(en.x + 6, en.y + 3, 4, 0, Math.PI * 2);
        ctx.fill();

        // Label: split into typed (dim) and remaining (bright)
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
        // draw each letter
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

      // Turret
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

      // Particles
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
  const killPct = Math.min(100, (kills / config.killsPerLevel) * 100);
  const currentLetters = lettersForLevel(level);
  const wordLen = targetWordLength(level);

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden">
      <canvas ref={canvasRef} className="w-full h-full block" />

      <div className="pointer-events-none absolute inset-0 p-4 flex flex-col justify-between text-foreground">
        <div className="flex items-start justify-between">
          <div className="bg-black/60 border border-white/10 rounded px-3 py-2 font-mono text-sm min-w-[240px]">
            <div className="flex items-baseline justify-between">
              <span className="text-white/60">LEVEL</span>
              <span className="text-2xl text-amber-300 font-bold leading-none">{level}</span>
            </div>
            <div className="mt-2 flex justify-between text-white/60 text-xs">
              <span>KILLS</span>
              <span>{kills}/{config.killsPerLevel}</span>
            </div>
            <div className="h-1.5 bg-white/10 rounded overflow-hidden mt-1">
              <div className="h-full bg-gradient-to-r from-amber-500 to-yellow-200" style={{ width: `${killPct}%` }} />
            </div>
            <div className="mt-2 text-white/50 text-[10px] tracking-wider">
              {wordLen === 1 ? `KEYS: ${currentLetters}` : `WORDS · LEN ${wordLen}`}
            </div>
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
                        ? (i === 3 ? "bg-red-500 border-red-300" : "bg-amber-400 border-amber-200")
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

      {showBanner && !gameOver && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="font-mono text-amber-300 text-7xl font-black tracking-widest drop-shadow-[0_0_20px_rgba(255,180,50,0.6)]">
            LEVEL {level}
          </div>
        </div>
      )}

      {banned && !gameOver && !showBanner && (
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
            <div className="text-white/70 mb-6">Press ENTER to redeploy</div>
          </div>
        </div>
      )}
    </div>
  );
}
