import { useEffect, useRef, useState } from "react";
import config from "@/lib/game-config.json";

type Enemy = {
  id: number;
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
  vx: number;
  vy: number;
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

type MuzzleFlash = { angle: number; life: number };

let _id = 1;
const nextId = () => _id++;

// Tiny audio synth — no assets needed
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
      o.frequency.setValueAtTime(880, t);
      o.frequency.exponentialRampToValueAtTime(120, t + 0.08);
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.1);
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
      f.type = "lowpass";
      f.frequency.value = 1200;
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
      o.start(t);
      o.stop(t + 0.14);
    },
  };
}

export default function TypingTowerGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const enemiesRef = useRef<Enemy[]>([]);
  const bulletsRef = useRef<Bullet[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const muzzleRef = useRef<MuzzleFlash | null>(null);
  const turretAngleRef = useRef(-Math.PI / 2);
  const recoilRef = useRef(0);
  const sizeRef = useRef({ w: 1280, h: 720 });
  const lastSpawnRef = useRef(0);
  const lastTimeRef = useRef(performance.now());
  const comboRef = useRef(0);
  const healthRef = useRef(config.playerHealth);
  const gameOverRef = useRef(false);

  const audio = useAudio();

  const [hudCombo, setHudCombo] = useState(0);
  const [hudHealth, setHudHealth] = useState(config.playerHealth);
  const [gameOver, setGameOver] = useState(false);

  // Resize
  useEffect(() => {
    const c = canvasRef.current!;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth;
      const h = c.clientHeight;
      c.width = w * dpr;
      c.height = h * dpr;
      const ctx = c.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sizeRef.current = { w, h };
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // Spawn helper
  const spawnEnemy = () => {
    const { w, h } = sizeRef.current;
    const side = Math.floor(Math.random() * 4);
    let x = 0, y = 0;
    if (side === 0) { x = Math.random() * w; y = -30; }
    else if (side === 1) { x = w + 30; y = Math.random() * h; }
    else if (side === 2) { x = Math.random() * w; y = h + 30; }
    else { x = -30; y = Math.random() * h; }
    const letters = config.letters;
    // avoid duplicate active letters
    const taken = new Set(enemiesRef.current.map(e => e.letter));
    let letter = letters[Math.floor(Math.random() * letters.length)];
    let tries = 0;
    while (taken.has(letter) && tries < 30) {
      letter = letters[Math.floor(Math.random() * letters.length)];
      tries++;
    }
    if (taken.has(letter)) return; // skip this spawn
    enemiesRef.current.push({
      id: nextId(),
      x, y,
      letter,
      hp: 1,
      speed: config.enemySpeed + Math.random() * 12,
      radius: 18,
    });
  };

  // Explosion
  const explode = (x: number, y: number) => {
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 80 + Math.random() * 220;
      particlesRef.current.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0.5 + Math.random() * 0.3,
        maxLife: 0.8,
        color: Math.random() < 0.5 ? "#ffb347" : "#ff5722",
        size: 2 + Math.random() * 3,
      });
    }
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 30 + Math.random() * 80;
      particlesRef.current.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0.6,
        maxLife: 0.6,
        color: "#555",
        size: 4 + Math.random() * 4,
      });
    }
  };

  // Fire bullet at enemy
  const fireAt = (enemy: Enemy) => {
    const { w, h } = sizeRef.current;
    const cx = w / 2, cy = h / 2;
    const dx = enemy.x - cx;
    const dy = enemy.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    const speed = comboRef.current >= 10 ? config.bulletSpeed * 1.4 : config.bulletSpeed;
    bulletsRef.current.push({
      id: nextId(),
      x: cx, y: cy,
      vx: (dx / len) * speed,
      vy: (dy / len) * speed,
      targetId: enemy.id,
      life: 1.2,
    });
    turretAngleRef.current = Math.atan2(dy, dx);
    recoilRef.current = 6;
    muzzleRef.current = { angle: Math.atan2(dy, dx), life: 0.08 };
    audio.shot();
  };

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (gameOverRef.current) {
        if (e.key === "Enter") restart();
        return;
      }
      const k = e.key.toUpperCase();
      if (k.length !== 1 || !/[A-Z]/.test(k)) return;
      // find closest enemy with matching letter
      const { w, h } = sizeRef.current;
      const cx = w / 2, cy = h / 2;
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
      } else {
        comboRef.current = 0;
        setHudCombo(0);
        audio.jam();
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
    healthRef.current = config.playerHealth;
    gameOverRef.current = false;
    setHudCombo(0);
    setHudHealth(config.playerHealth);
    setGameOver(false);
  };

  // Main loop
  useEffect(() => {
    let raf = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - lastTimeRef.current) / 1000);
      lastTimeRef.current = now;

      if (!gameOverRef.current) {
        lastSpawnRef.current += dt * 1000;
        if (lastSpawnRef.current > config.spawnIntervalMs) {
          lastSpawnRef.current = 0;
          spawnEnemy();
        }
      }

      const { w, h } = sizeRef.current;
      const cx = w / 2, cy = h / 2;

      // Update enemies — move toward center
      for (const en of enemiesRef.current) {
        const dx = cx - en.x, dy = cy - en.y;
        const d = Math.hypot(dx, dy) || 1;
        en.x += (dx / d) * en.speed * dt;
        en.y += (dy / d) * en.speed * dt;
      }

      // Enemy reaches turret
      const turretR = 40;
      const survivors: Enemy[] = [];
      for (const en of enemiesRef.current) {
        const d = Math.hypot(en.x - cx, en.y - cy);
        if (d < turretR) {
          healthRef.current -= config.enemyDamage;
          setHudHealth(Math.max(0, healthRef.current));
          explode(en.x, en.y);
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

      // Update bullets
      const aliveBullets: Bullet[] = [];
      for (const b of bulletsRef.current) {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.life -= dt;
        let hit = false;
        for (const en of enemiesRef.current) {
          if (Math.hypot(en.x - b.x, en.y - b.y) < en.radius) {
            en.hp -= 1;
            if (en.hp <= 0) {
              explode(en.x, en.y);
              audio.boom();
              enemiesRef.current = enemiesRef.current.filter(e => e.id !== en.id);
            }
            hit = true;
            break;
          }
        }
        if (!hit && b.life > 0 && b.x > -50 && b.x < w + 50 && b.y > -50 && b.y < h + 50) {
          aliveBullets.push(b);
        }
      }
      bulletsRef.current = aliveBullets;

      // Update particles
      for (const p of particlesRef.current) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.92;
        p.vy *= 0.92;
        p.life -= dt;
      }
      particlesRef.current = particlesRef.current.filter(p => p.life > 0);

      if (muzzleRef.current) {
        muzzleRef.current.life -= dt;
        if (muzzleRef.current.life <= 0) muzzleRef.current = null;
      }
      if (recoilRef.current > 0) recoilRef.current = Math.max(0, recoilRef.current - dt * 40);

      // Aim turret at nearest enemy
      if (enemiesRef.current.length > 0) {
        let nearest = enemiesRef.current[0];
        let bestD = Infinity;
        for (const en of enemiesRef.current) {
          const d = Math.hypot(en.x - cx, en.y - cy);
          if (d < bestD) { bestD = d; nearest = en; }
        }
        const targetAngle = Math.atan2(nearest.y - cy, nearest.x - cx);
        // smooth rotate
        let diff = targetAngle - turretAngleRef.current;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        turretAngleRef.current += diff * Math.min(1, dt * 10);
      }

      draw();
      raf = requestAnimationFrame(loop);
    };

    const draw = () => {
      const c = canvasRef.current!;
      const ctx = c.getContext("2d")!;
      const { w, h } = sizeRef.current;

      // Ground — gritty earth tone with grid
      ctx.fillStyle = "#2a2620";
      ctx.fillRect(0, 0, w, h);
      // sand/dirt patches
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
      const grid = 60;
      for (let x = 0; x < w; x += grid) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = 0; y < h; y += grid) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }

      const cx = w / 2, cy = h / 2;

      // Bullets — bright core + fading trail
      for (const b of bulletsRef.current) {
        const len = 18;
        const tx = b.x - (b.vx / 1400) * len;
        const ty = b.y - (b.vy / 1400) * len;
        const grad = ctx.createLinearGradient(tx, ty, b.x, b.y);
        grad.addColorStop(0, "rgba(255,220,120,0)");
        grad.addColorStop(1, "rgba(255,240,180,1)");
        ctx.strokeStyle = grad;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.fillStyle = "#fffbe6";
        ctx.beginPath();
        ctx.arc(b.x, b.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Enemies
      for (const en of enemiesRef.current) {
        // shadow
        ctx.fillStyle = "rgba(0,0,0,0.4)";
        ctx.beginPath();
        ctx.ellipse(en.x + 3, en.y + 5, en.radius, en.radius * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        // body
        ctx.fillStyle = "#5a6b3a";
        ctx.beginPath();
        ctx.arc(en.x, en.y, en.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#2e3a1f";
        ctx.lineWidth = 2;
        ctx.stroke();
        // camo spots
        ctx.fillStyle = "#3d4a26";
        ctx.beginPath();
        ctx.arc(en.x - 5, en.y - 4, 5, 0, Math.PI * 2);
        ctx.arc(en.x + 6, en.y + 3, 4, 0, Math.PI * 2);
        ctx.fill();

        // Letter — high contrast pill above
        const label = en.letter;
        ctx.font = "bold 22px ui-monospace, Menlo, monospace";
        const tw = ctx.measureText(label).width;
        const padX = 8, padY = 4;
        const bx = en.x - tw / 2 - padX;
        const by = en.y - en.radius - 32;
        const bw = tw + padX * 2;
        const bh = 28;
        ctx.fillStyle = "rgba(0,0,0,0.85)";
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = "#ffcc33";
        ctx.lineWidth = 2;
        ctx.strokeRect(bx, by, bw, bh);
        ctx.fillStyle = "#ffe066";
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";
        ctx.fillText(label, en.x, by + bh / 2 + 1);
      }

      // Turret
      const recoil = recoilRef.current;
      const ang = turretAngleRef.current;
      // base
      ctx.fillStyle = "#1a1a1a";
      ctx.beginPath();
      ctx.arc(cx, cy, 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#3a3a3a";
      ctx.beginPath();
      ctx.arc(cx, cy, 30, 0, Math.PI * 2);
      ctx.fill();
      // barrel
      ctx.save();
      ctx.translate(cx - Math.cos(ang) * recoil, cy - Math.sin(ang) * recoil);
      ctx.rotate(ang);
      const glow = comboRef.current >= 5;
      ctx.fillStyle = glow ? "#664422" : "#2a2a2a";
      ctx.fillRect(0, -8, 46, 16);
      ctx.strokeStyle = glow ? "#ff8c2a" : "#111";
      ctx.lineWidth = 2;
      ctx.strokeRect(0, -8, 46, 16);
      // muzzle flash
      if (muzzleRef.current) {
        const m = muzzleRef.current.life / 0.08;
        ctx.fillStyle = `rgba(255,220,120,${m})`;
        ctx.beginPath();
        ctx.moveTo(46, -10);
        ctx.lineTo(70, 0);
        ctx.lineTo(46, 10);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      // top cap
      ctx.fillStyle = "#222";
      ctx.beginPath();
      ctx.arc(cx, cy, 12, 0, Math.PI * 2);
      ctx.fill();

      // Particles
      for (const p of particlesRef.current) {
        const a = Math.max(0, p.life / p.maxLife);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden">
      <canvas ref={canvasRef} className="w-full h-full block" />

      {/* HUD */}
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
        <div className="flex justify-center">
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
