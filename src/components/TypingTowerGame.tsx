import { useEffect, useRef, useState } from "react";
import config from "@/lib/game-config.json";

type Vec = { x: number; y: number };

type Enemy = {
  id: number;
  pathIdx: number;
  t: number; // distance traveled along path
  x: number;
  y: number;
  letter: string;
  hp: number;
  speed: number;
  radius: number;
};

type Bullet = {
  id: number;
  x: number;
  y: number;
  dx: number; // unit direction
  dy: number;
  speed: number;      // current speed
  launchSpeed: number;
  accel: number;      // px/s^2
  maxSpeed: number;   // 2x launch
  targetId: number;
  life: number;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
};

type Obstacle = { x: number; y: number; r: number; hp: number };

type MuzzleFlash = { angle: number; life: number };

type Path = {
  points: Vec[];     // waypoints
  cum: number[];     // cumulative lengths
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
      g.gain.setValueAtTime(0.2, t);
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
  };
}

// Build a curvy path from an edge point to the center
function buildPath(start: Vec, end: Vec, seed: number): Path {
  const points: Vec[] = [start];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.hypot(dx, dy);
  const steps = 6;
  // perpendicular unit
  const nx = -dy / dist;
  const ny = dx / dist;
  let s = seed;
  const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const baseX = start.x + dx * t;
    const baseY = start.y + dy * t;
    // taper offset near ends so path actually reaches start/end
    const taper = Math.sin(t * Math.PI);
    const off = (rand() - 0.5) * 280 * taper;
    points.push({ x: baseX + nx * off, y: baseY + ny * off });
  }
  points.push(end);
  // cumulative lengths
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
  // find segment
  let i = 1;
  while (i < path.cum.length && path.cum[i] < t) i++;
  const segLen = path.cum[i] - path.cum[i - 1];
  const f = (t - path.cum[i - 1]) / segLen;
  const a = path.points[i - 1], b = path.points[i];
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

// segment-circle intersection (for bullet vs obstacle and bullet vs enemy quick test)
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
  const turretAngleRef = useRef(-Math.PI / 2);
  const targetAngleRef = useRef(-Math.PI / 2);
  const recoilRef = useRef(0);
  const sizeRef = useRef({ w: 1280, h: 720 });
  const lastSpawnRef = useRef(0);
  const lastTimeRef = useRef(performance.now());
  const elapsedRef = useRef(0);
  const comboRef = useRef(0);
  const healthRef = useRef(config.playerHealth);
  const gameOverRef = useRef(false);
  const missStreakRef = useRef(0);
  const banUntilRef = useRef(0); // performance.now() ms

  const audio = useAudio();

  const [hudCombo, setHudCombo] = useState(0);
  const [hudHealth, setHudHealth] = useState(config.playerHealth);
  const [gameOver, setGameOver] = useState(false);
  const [banRemaining, setBanRemaining] = useState(0);
  const [missStreak, setMissStreak] = useState(0);

  const buildLevel = () => {
    const { w, h } = sizeRef.current;
    const cx = w * 0.93, cy = h * 0.5;
    // 4 paths from 4 edges
    const starts: Vec[] = [
      { x: -20, y: h * 0.15 },
      { x: w * 0.25, y: -20 },
      { x: -20, y: h * 0.85 },
      { x: w * 0.35, y: h + 20 },
    ];
    pathsRef.current = starts.map((s, i) => buildPath(s, { x: cx, y: cy }, (i + 1) * 7919 + Math.floor(Math.random() * 9999)));

    // Obstacles — keep away from turret and away from path centerlines (close enough to be in shooting lanes but not blocking the road)
    const obs: Obstacle[] = [];
    let tries = 0;
    const minTurret = 110;
    while (obs.length < config.obstacleCount && tries < 400) {
      tries++;
      const x = 60 + Math.random() * (w - 120);
      const y = 60 + Math.random() * (h - 120);
      if (Math.hypot(x - cx, y - cy) < minTurret) continue;
      // not directly on a path centerline (still possible to be near edges of road)
      let onPath = false;
      for (const p of pathsRef.current) {
        for (let i = 1; i < p.points.length; i++) {
          const a = p.points[i - 1], b = p.points[i];
          // distance from point to segment
          const vx = b.x - a.x, vy = b.y - a.y;
          const wx = x - a.x, wy = y - a.y;
          const segL2 = vx * vx + vy * vy;
          const tt = Math.max(0, Math.min(1, (wx * vx + wy * vy) / segL2));
          const px = a.x + vx * tt, py = a.y + vy * tt;
          if (Math.hypot(x - px, y - py) < 18) { onPath = true; break; }
        }
        if (onPath) break;
      }
      if (onPath) continue;
      // not too close to other obstacles
      if (obs.some(o => Math.hypot(o.x - x, o.y - y) < 70)) continue;
      obs.push({ x, y, r: 6 + Math.random() * 4, hp: 3 });
    }
    obstaclesRef.current = obs;
  };

  // Resize — world is 1.5x the client size so we see more battlefield (zoom out).
  useEffect(() => {
    const c = canvasRef.current!;
    const ZOOM = 1 / 1.5; // draw scale
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const cw = c.clientWidth;
      const ch = c.clientHeight;
      c.width = cw * dpr;
      c.height = ch * dpr;
      const ctx = c.getContext("2d")!;
      // Apply dpr and zoom so world units are 1.5x screen units.
      ctx.setTransform(dpr * ZOOM, 0, 0, dpr * ZOOM, 0, 0);
      sizeRef.current = { w: cw / ZOOM, h: ch / ZOOM };
      if (pathsRef.current.length === 0) buildLevel();
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
    const letters = config.letters;
    const letter = letters[Math.floor(Math.random() * letters.length)];
    const speed = config.enemySpeedMin + Math.random() * (config.enemySpeedMax - config.enemySpeedMin);
    enemiesRef.current.push({
      id: nextId(),
      pathIdx: pi,
      t: 0,
      x: start.x,
      y: start.y,
      letter,
      hp: 1,
      speed,
      radius: 18,
    });
  };

  const explode = (x: number, y: number) => {
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 80 + Math.random() * 240;
      particlesRef.current.push({
        x, y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.5 + Math.random() * 0.3, maxLife: 0.8,
        color: Math.random() < 0.5 ? "#ffb347" : "#ff5722",
        size: 2 + Math.random() * 3,
      });
    }
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      particlesRef.current.push({
        x, y,
        vx: Math.cos(a) * (30 + Math.random() * 80),
        vy: Math.sin(a) * (30 + Math.random() * 80),
        life: 0.6, maxLife: 0.6,
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

  const fireAt = (enemy: Enemy) => {
    const { w, h } = sizeRef.current;
    const cx = w * 0.93, cy = h * 0.5;
    const dx = enemy.x - cx;
    const dy = enemy.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    const base = currentBulletSpeed();
    const jitter = 1 + (Math.random() * 2 - 1) * config.bulletJitter;
    const launchSpeed = base * jitter;
    const maxSpeed = launchSpeed * 2;
    // v_f^2 = v_0^2 + 2 a D  =>  a = (v_f^2 - v_0^2) / (2 D)
    const accel = (maxSpeed * maxSpeed - launchSpeed * launchSpeed) / (2 * Math.max(60, len));
    const ang = Math.atan2(dy, dx);
    bulletsRef.current.push({
      id: nextId(),
      x: cx, y: cy,
      dx: dx / len,
      dy: dy / len,
      speed: launchSpeed,
      launchSpeed,
      accel,
      maxSpeed,
      targetId: enemy.id,
      life: 1.5,
    });
    // Turret rotates on fire only
    targetAngleRef.current = ang;
    recoilRef.current = 8;
    muzzleRef.current = { angle: ang, life: 0.08 };
    audio.shot();
  };

  useEffect(() => {
    const MISS_PENALTY_MS = [2000, 4000, 7000]; // 1st, 2nd, 3rd consecutive mistake
    const onKey = (e: KeyboardEvent) => {
      if (gameOverRef.current) {
        if (e.key === "Enter") restart();
        return;
      }
      const k = e.key.toUpperCase();
      if (k.length !== 1 || !/[A-Z]/.test(k)) return;

      // Shot ban: swallow input entirely while banned.
      if (performance.now() < banUntilRef.current) {
        audio.jam();
        return;
      }

      const { w, h } = sizeRef.current;
      const cx = w * 0.93, cy = h * 0.5;
      let target: Enemy | null = null;
      let bestD = Infinity;
      for (const en of enemiesRef.current) {
        if (en.letter === k) {
          const d = Math.hypot(en.x - cx, en.y - cy);
          if (d < bestD) { bestD = d; target = en; }
        }
      }
      if (target) {
        fireAt(target);
        comboRef.current += 1;
        setHudCombo(comboRef.current);
        // Reset miss streak on a correct hit.
        if (missStreakRef.current !== 0) {
          missStreakRef.current = 0;
          setMissStreak(0);
        }
      } else {
        comboRef.current = 0;
        setHudCombo(0);
        missStreakRef.current += 1;
        setMissStreak(missStreakRef.current);
        audio.jam();
        if (missStreakRef.current >= 4) {
          // 4 consecutive mistakes -> destroyed / lose the level
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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const restart = () => {
    enemiesRef.current = [];
    bulletsRef.current = [];
    particlesRef.current = [];
    comboRef.current = 0;
    elapsedRef.current = 0;
    healthRef.current = config.playerHealth;
    gameOverRef.current = false;
    missStreakRef.current = 0;
    banUntilRef.current = 0;
    setHudCombo(0);
    setHudHealth(config.playerHealth);
    setGameOver(false);
    setMissStreak(0);
    setBanRemaining(0);
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
        if (lastSpawnRef.current > config.spawnIntervalMs) {
          lastSpawnRef.current = 0;
          spawnEnemy();
        }
      }

      const { w, h } = sizeRef.current;
      const cx = w * 0.93, cy = h * 0.5;

      // Move enemies along paths
      for (const en of enemiesRef.current) {
        en.t += en.speed * dt;
        const p = pathsRef.current[en.pathIdx];
        const pos = pointOnPath(p, en.t);
        en.x = pos.x;
        en.y = pos.y;
      }

      // Enemy reaches turret (end of path)
      const survivors: Enemy[] = [];
      for (const en of enemiesRef.current) {
        const p = pathsRef.current[en.pathIdx];
        if (en.t >= p.total - 4) {
          healthRef.current -= config.enemyDamage;
          setHudHealth(Math.max(0, healthRef.current));
          explode(en.x, en.y);
          audio.thud();
          comboRef.current = 0;
          setHudCombo(0);
          if (healthRef.current <= 0 && !gameOverRef.current) {
            gameOverRef.current = true;
            setGameOver(true);
          }
        } else {
          survivors.push(en);
        }
      }
      enemiesRef.current = survivors;

      // Update bullets — sweep test against obstacles and enemies
      const aliveBullets: Bullet[] = [];
      for (const b of bulletsRef.current) {
        // accelerate up to maxSpeed
        b.speed = Math.min(b.maxSpeed, b.speed + b.accel * dt);
        const nx = b.x + b.dx * b.speed * dt;
        const ny = b.y + b.dy * b.speed * dt;
        b.life -= dt;
        let consumed = false;

        // obstacles
        for (const o of obstaclesRef.current) {
          if (segCircleHit(b.x, b.y, nx, ny, o.x, o.y, o.r + 2)) {
            sparks(o.x, o.y);
            o.hp -= 1;
            consumed = true;
            break;
          }
        }
        if (!consumed) {
          // enemies
          for (const en of enemiesRef.current) {
            if (segCircleHit(b.x, b.y, nx, ny, en.x, en.y, en.radius)) {
              en.hp -= 1;
              if (en.hp <= 0) {
                explode(en.x, en.y);
                audio.boom();
                enemiesRef.current = enemiesRef.current.filter(e => e.id !== en.id);
              }
              consumed = true;
              break;
            }
          }
        }

        b.x = nx; b.y = ny;
        if (!consumed && b.life > 0 && b.x > -60 && b.x < w + 60 && b.y > -60 && b.y < h + 60) {
          aliveBullets.push(b);
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

      // Smoothly rotate to last fire target (no auto-acquire)
      let diff = targetAngleRef.current - turretAngleRef.current;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      turretAngleRef.current += diff * Math.min(1, dt * 18);

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

      // Paths (roads)
      for (const p of pathsRef.current) {
        // dark outline
        ctx.strokeStyle = "#1a1612";
        ctx.lineWidth = config.pathWidth + 6;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(p.points[0].x, p.points[0].y);
        for (let i = 1; i < p.points.length; i++) ctx.lineTo(p.points[i].x, p.points[i].y);
        ctx.stroke();
        // dirt fill
        ctx.strokeStyle = "#5a4632";
        ctx.lineWidth = config.pathWidth;
        ctx.stroke();
        // center scuff
        ctx.strokeStyle = "rgba(0,0,0,0.18)";
        ctx.lineWidth = 4;
        ctx.setLineDash([14, 18]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Obstacles (poles)
      for (const o of obstaclesRef.current) {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.beginPath(); ctx.ellipse(o.x + 2, o.y + 4, o.r + 2, (o.r + 2) * 0.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#3a2e22";
        ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#1a1410";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        ctx.beginPath(); ctx.arc(o.x - o.r * 0.3, o.y - o.r * 0.3, o.r * 0.4, 0, Math.PI * 2); ctx.fill();
      }

      // Bullets — tracer with strong glow + length scaling with speed
      for (const b of bulletsRef.current) {
        const len = Math.min(34, 10 + b.speed / 70);
        const ux = b.dx, uy = b.dy;
        const tx = b.x - ux * len, ty = b.y - uy * len;
        // outer glow
        ctx.strokeStyle = "rgba(255,180,80,0.35)";
        ctx.lineWidth = 7;
        ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y); ctx.stroke();
        // bright core
        const grad = ctx.createLinearGradient(tx, ty, b.x, b.y);
        grad.addColorStop(0, "rgba(255,220,120,0)");
        grad.addColorStop(1, "rgba(255,255,220,1)");
        ctx.strokeStyle = grad;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y); ctx.stroke();
        // head
        ctx.fillStyle = "#fffbe6";
        ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, Math.PI * 2); ctx.fill();
        ctx.lineCap = "butt";
      }

      // Enemies
      for (const en of enemiesRef.current) {
        ctx.fillStyle = "rgba(0,0,0,0.4)";
        ctx.beginPath();
        ctx.ellipse(en.x + 3, en.y + 5, en.radius, en.radius * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        // color tint by speed (fast = redder)
        const sNorm = (en.speed - config.enemySpeedMin) / (config.enemySpeedMax - config.enemySpeedMin);
        const r = Math.floor(90 + sNorm * 110);
        const g = Math.floor(107 - sNorm * 50);
        const bb = Math.floor(58 - sNorm * 30);
        ctx.fillStyle = `rgb(${r},${g},${bb})`;
        ctx.beginPath(); ctx.arc(en.x, en.y, en.radius, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#2e3a1f"; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = "#3d4a26";
        ctx.beginPath();
        ctx.arc(en.x - 5, en.y - 4, 5, 0, Math.PI * 2);
        ctx.arc(en.x + 6, en.y + 3, 4, 0, Math.PI * 2);
        ctx.fill();

        const label = en.letter;
        ctx.font = "bold 22px ui-monospace, Menlo, monospace";
        const tw = ctx.measureText(label).width;
        const padX = 8;
        const bx = en.x - tw / 2 - padX;
        const by = en.y - en.radius - 32;
        const bw = tw + padX * 2;
        const bh = 28;
        ctx.fillStyle = "rgba(0,0,0,0.85)";
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = "#ffcc33"; ctx.lineWidth = 2; ctx.strokeRect(bx, by, bw, bh);
        ctx.fillStyle = "#ffe066";
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";
        ctx.fillText(label, en.x, by + bh / 2 + 1);
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

  const bulletSpeedPct = Math.round(((currentBulletSpeed() - config.bulletSpeedBase) / (config.bulletSpeedMax - config.bulletSpeedBase)) * 100);

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden">
      <canvas ref={canvasRef} className="w-full h-full block" />

      <div className="pointer-events-none absolute inset-0 p-4 flex flex-col justify-between text-foreground">
        <div className="flex items-start justify-between">
          <div className="bg-black/60 border border-white/10 rounded px-3 py-2 font-mono text-sm">
            <div className="text-white/60">STAGE</div>
            <div className="text-2xl text-amber-300 font-bold leading-none">{config.stage}</div>
          </div>
          <div className="bg-black/60 border border-white/10 rounded px-3 py-2 font-mono text-sm text-right">
            <div className="text-white/60">COMBO</div>
            <div className={`text-2xl font-bold leading-none ${hudCombo >= 10 ? "text-orange-400" : hudCombo >= 5 ? "text-amber-300" : "text-white"}`}>
              x{hudCombo}
            </div>
          </div>
        </div>
        <div className="flex justify-center gap-3">
          <div className="bg-black/60 border border-white/10 rounded px-3 py-2 w-80 font-mono text-xs">
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
            <div className="flex justify-between text-white/70 mt-2 mb-1">
              <span>BULLET CHARGE</span>
              <span>{Math.max(0, Math.min(100, bulletSpeedPct))}%</span>
            </div>
            <div className="h-2 bg-white/10 rounded overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-yellow-200"
                style={{ width: `${Math.max(0, Math.min(100, bulletSpeedPct))}%` }}
              />
            </div>
          </div>
        </div>
      </div>

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
