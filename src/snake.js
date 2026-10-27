const INK = "#292a23";
const LIME = "#d8fd71";
const CREAM = "#f6f5ee";
const TAU = Math.PI * 2;

const SIZES = [
  {
    maxWidth: 640,
    cell: 14,
    bodyWidth: 9.8,
    wave: 2.3,
    speed: 64,
    initialLength: 138,
    growth: 16,
    appleRadius: 8,
  },
  {
    maxWidth: 1024,
    cell: 17,
    bodyWidth: 13,
    wave: 3.2,
    speed: 80,
    initialLength: 200,
    growth: 22,
    appleRadius: 9.5,
  },
  {
    maxWidth: Infinity,
    cell: 20,
    bodyWidth: 16,
    wave: 4.2,
    speed: 96,
    initialLength: 260,
    growth: 26,
    appleRadius: 11.5,
  },
];

const DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function sizeFor(width) {
  return SIZES.find((size) => width <= size.maxWidth) ?? SIZES[SIZES.length - 1];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hypot(x, y) {
  return Math.sqrt(x * x + y * y);
}

class MinHeap {
  constructor() {
    this.ids = [];
    this.keys = [];
  }

  get size() {
    return this.ids.length;
  }

  push(id, key) {
    this.ids.push(id);
    this.keys.push(key);
    let index = this.ids.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.keys[parent] <= this.keys[index]) break;
      this.swap(parent, index);
      index = parent;
    }
  }

  pop() {
    const top = this.ids[0];
    const lastId = this.ids.pop();
    const lastKey = this.keys.pop();
    if (this.ids.length && lastId !== undefined) {
      this.ids[0] = lastId;
      this.keys[0] = lastKey;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < this.ids.length && this.keys[left] < this.keys[smallest]) smallest = left;
        if (right < this.ids.length && this.keys[right] < this.keys[smallest]) smallest = right;
        if (smallest === index) break;
        this.swap(smallest, index);
        index = smallest;
      }
    }
    return top;
  }

  swap(a, b) {
    [this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}

export function startPageSnake(canvas) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const snake = new PageSnake(canvas, ctx);
  snake.start();
  return snake;
}

class PageSnake {
  constructor(canvas, ctx) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.cfg = sizeFor(window.innerWidth);
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.grid = null;
    this.head = null;
    this.trail = [];
    this.path = [];
    this.angle = 0;
    this.visualAngle = 0;
    this.phase = 0;
    this.bodyLength = 0;
    this.apple = null;
    this.particles = [];
    this.alpha = 1;
    this.occluded = false;
    this.layoutDirty = true;
    this.lastGridAt = -Infinity;
    this.lastScrollAt = -Infinity;
    this.lastRecoverAt = -Infinity;
    this.nextInitAt = 0;
    this.nextAppleAt = 0;
    this.nextWanderAt = 0;
    this.lastFrame = 0;
    this.raf = 0;
    this.tongueSeed = Math.random() * 6;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.boundTick = (time) => this.tick(time);
    this.boundScroll = () => {
      this.lastScrollAt = performance.now();
      this.layoutDirty = true;
    };
    this.boundResize = () => {
      this.lastScrollAt = performance.now();
      this.measure();
      this.layoutDirty = true;
    };
    this.boundToggle = (event) => {
      if (event.target instanceof HTMLDetailsElement) {
        this.layoutDirty = true;
      }
    };
    this.boundVisibility = () => {
      if (!document.hidden) this.lastFrame = performance.now();
    };

    window.addEventListener("scroll", this.boundScroll, { passive: true });
    window.addEventListener("resize", this.boundResize, { passive: true });
    document.addEventListener("toggle", this.boundToggle, true);
    document.addEventListener("visibilitychange", this.boundVisibility);

    if (document.fonts?.ready) {
      document.fonts.ready.then(() => {
        this.layoutDirty = true;
      }).catch(() => {});
    }
  }

  start() {
    requestAnimationFrame(() => {
      this.measure();
      this.rebuildGrid(performance.now());
      this.lastFrame = performance.now();
      this.raf = requestAnimationFrame(this.boundTick);
    });
  }

  tick(now) {
    this.raf = requestAnimationFrame(this.boundTick);
    let dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 0.05);

    if (this.layoutDirty && now - this.lastGridAt > 80) {
      this.rebuildGrid(now);
    }

    this.update(dt, now);
    this.render(now);
  }

  measure() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (width === this.w && height === this.h && dpr === this.dpr) return false;

    this.w = width;
    this.h = height;
    this.dpr = dpr;
    this.cfg = sizeFor(width);

    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
    if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  /* Every marked content block becomes an inflated island in the nav grid. */
  rebuildGrid(now) {
    this.measure();
    const cell = this.cfg.cell;
    const cols = Math.max(1, Math.ceil(this.w / cell));
    const rows = Math.max(1, Math.ceil(this.h / cell));
    const blocked = new Uint8Array(cols * rows);
    const clearance = this.cfg.bodyWidth / 2 + this.cfg.wave + 5;

    const nodes = document.querySelectorAll("[data-snake-avoid]");
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      if (rect.bottom < -clearance || rect.top > this.h + clearance) continue;

      const x0 = rect.left - clearance;
      const y0 = rect.top - clearance;
      const x1 = rect.right + clearance;
      const y1 = rect.bottom + clearance;
      if (x1 <= 0 || y1 <= 0 || x0 >= this.w || y0 >= this.h) continue;

      const c0 = Math.max(0, Math.floor(x0 / cell));
      const c1 = Math.min(cols - 1, Math.floor((x1 - 0.01) / cell));
      const r0 = Math.max(0, Math.floor(y0 / cell));
      const r1 = Math.min(rows - 1, Math.floor((y1 - 0.01) / cell));
      if (c1 < c0 || r1 < r0) continue;

      for (let row = r0; row <= r1; row += 1) {
        blocked.fill(1, row * cols + c0, row * cols + c1 + 1);
      }
    }

    this.grid = { cell, cols, rows, blocked };
    this.layoutDirty = false;
    this.lastGridAt = now;
    this.afterLayout(now);
  }

  afterLayout(now) {
    if (!this.grid) return;
    if (!this.head) {
      if (now >= this.nextInitAt) this.initWorld(now);
      return;
    }

    if (!this.headIsFree() || !this.bodyIsFree()) {
      this.occluded = true;
      this.path = [];
      return;
    }

    if (this.occluded) return;

    if (this.apple && !this.pointIsFree(this.apple.x, this.apple.y)) {
      this.apple = null;
      this.nextAppleAt = now + 160;
    }

    if (this.path.length && !this.pathIsClear()) {
      this.path = [];
      if (this.apple) this.planToApple(now);
    }
  }

  update(dt, now) {
    if (!this.head) {
      this.alpha = 0;
      if (now >= this.nextInitAt) this.initWorld(now);
      this.updateParticles(dt);
      return;
    }

    const quiet = now - this.lastScrollAt > 220 && now - this.lastGridAt > 90;
    if (this.occluded && quiet && now - this.lastRecoverAt > 450) {
      if (this.headIsFree() && this.bodyIsFree()) {
        this.occluded = false;
        this.lastRecoverAt = now;
        if (this.apple && !this.pointIsFree(this.apple.x, this.apple.y)) {
          this.apple = null;
          this.nextAppleAt = now + 180;
        }
      } else {
        this.relocate(now);
      }
    }

    const alphaTarget = this.occluded ? 0 : 1;
    this.alpha += (alphaTarget - this.alpha) * Math.min(1, dt * 14);
    if (this.alpha < 0.01) this.alpha = 0;
    if (this.alpha > 0.99) this.alpha = 1;

    this.updateParticles(dt);

    if (this.occluded) return;

    if (!this.apple && now >= this.nextAppleAt) {
      if (!this.spawnApple(now)) {
        this.nextAppleAt = now + 850;
      }
    }

    if (!this.path.length) {
      if (this.apple) {
        this.planToApple(now);
      }
      if (!this.path.length) {
        this.planWander(now);
      }
    }

    if (this.path.length) {
      this.move(dt);
      this.trimTrail();
      this.checkEat(now);
    }
  }

  initWorld(now) {
    if (!this.bodyLength) this.bodyLength = this.cfg.initialLength;
    if (!this.placeSnake(now)) {
      this.nextInitAt = now + 650;
      return;
    }

    this.occluded = false;
    this.alpha = 1;
    this.apple = null;
    this.nextAppleAt = now;
    this.lastRecoverAt = now;
    this.spawnApple(now);
  }

  relocate(now) {
    this.lastRecoverAt = now;
    if (!this.placeSnake(now)) {
      this.occluded = true;
      return;
    }

    this.occluded = false;
    this.alpha = 0;
    this.apple = null;
    this.nextAppleAt = now + 220;
    this.particles = [];
  }

  placeSnake() {
    if (!this.grid) return false;
    const candidates = this.spawnCandidates().slice(0, 24);

    for (const candidate of candidates) {
      const chain = this.bodyChain(candidate.c, candidate.r);
      if (!chain || chain.length < 3) continue;

      const smoothed = this.smoothChain(chain);
      const head = smoothed[0];
      const neck = smoothed[1] ?? chain[1];
      this.head = { x: head.x, y: head.y };
      this.trail = smoothed.slice().reverse();
      this.angle = Math.atan2(head.y - neck.y, head.x - neck.x);
      this.visualAngle = this.angle;
      this.path = [];
      this.phase = Math.random() * TAU;
      return true;
    }

    return false;
  }

  spawnCandidates() {
    const { cols, rows, blocked, cell } = this.grid;
    const preferred = this.head
      ? { x: this.head.x, y: this.head.y }
      : { x: this.w * 0.53, y: this.h * 0.27 };
    const list = [];

    for (let r = 1; r < rows - 1; r += 1) {
      for (let c = 1; c < cols - 1; c += 1) {
        if (blocked[r * cols + c]) continue;
        const x = (c + 0.5) * cell;
        const y = (r + 0.5) * cell;
        if (x < cell * 1.5 || x > this.w - cell * 1.5) continue;
        if (y < cell * 1.5 || y > this.h - cell * 1.5) continue;

        let tier = 0;
        if (this.isOpen(c, r, 2)) tier = 3;
        else if (this.isOpen(c, r, 1)) tier = 2;
        else if (this.freeNeighbours(c, r) >= 2) tier = 1;
        if (!tier) continue;

        const distance = hypot(x - preferred.x, y - preferred.y);
        const score =
          tier * 100 +
          (this.head
            ? -distance * 0.3
            : -Math.abs(y - preferred.y) * 0.35 - Math.abs(x - preferred.x) * 0.04) +
          Math.random() * 34;
        list.push({ c, r, x, y, score });
      }
    }

    list.sort((a, b) => b.score - a.score);
    return list;
  }

  bodyChain(startC, startR) {
    const { cols, rows, blocked } = this.grid;
    const total = cols * rows;
    const start = startR * cols + startC;
    if (blocked[start]) return null;

    const parent = new Int32Array(total).fill(-1);
    const depth = new Uint16Array(total);
    const queue = new Int32Array(total);
    let head = 0;
    let tail = 0;
    queue[tail] = start;
    tail += 1;
    parent[start] = start;

    const wanted = Math.max(5, Math.ceil((this.bodyLength * 1.15) / this.grid.cell));
    const eligible = [];
    let farthest = start;
    let farthestDepth = 0;

    while (head < tail) {
      const id = queue[head];
      head += 1;
      const d = depth[id];
      if (d > farthestDepth) {
        farthest = id;
        farthestDepth = d;
      }
      if (d >= wanted && d <= wanted + 3 && eligible.length < 90) {
        eligible.push(id);
      }

      const c = id % cols;
      const r = (id / cols) | 0;
      const neighbours = [
        [c + 1, r],
        [c - 1, r],
        [c, r + 1],
        [c, r - 1],
      ];
      for (const [nc, nr] of neighbours) {
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const nid = nr * cols + nc;
        if (blocked[nid] || parent[nid] !== -1) continue;
        parent[nid] = id;
        depth[nid] = d + 1;
        queue[tail] = nid;
        tail += 1;
      }
    }

    if (farthestDepth < 2) return null;
    const chosen = eligible.length
      ? eligible[Math.floor(Math.random() * eligible.length)]
      : farthest;

    const ids = [];
    let cursor = chosen;
    while (cursor !== start) {
      ids.push(cursor);
      cursor = parent[cursor];
      if (cursor === -1) return null;
    }
    ids.push(start);
    ids.reverse();

    return ids.map((id) => {
      const c = id % cols;
      const r = (id / cols) | 0;
      return {
        x: (c + 0.5) * this.grid.cell,
        y: (r + 0.5) * this.grid.cell,
      };
    });
  }

  smoothChain(points) {
    if (points.length < 3) return points.slice();
    let result = points.map((point) => ({ ...point }));

    for (let pass = 0; pass < 2; pass += 1) {
      const next = [result[0]];
      for (let i = 0; i < result.length - 1; i += 1) {
        const a = result[i];
        const b = result[i + 1];
        next.push(
          { x: a.x * 0.72 + b.x * 0.28, y: a.y * 0.72 + b.y * 0.28 },
          { x: a.x * 0.28 + b.x * 0.72, y: a.y * 0.28 + b.y * 0.72 },
        );
      }
      next.push(result[result.length - 1]);
      result = next;
    }

    for (const point of result) {
      if (!this.pointIsFree(point.x, point.y)) return points.slice();
    }
    return result;
  }

  planToApple(now) {
    if (!this.head || !this.apple) return false;
    const start = this.cellAt(this.head.x, this.head.y);
    const goal = this.cellAt(this.apple.x, this.apple.y);
    if (!start || !goal) {
      this.apple = null;
      this.nextAppleAt = now + 500;
      return false;
    }

    const cells = this.findCellPath(start.c, start.r, goal.c, goal.r);
    if (!cells) {
      this.apple = null;
      this.nextAppleAt = now + 500;
      return false;
    }

    if (!cells.length) {
      this.path = [{ x: this.apple.x, y: this.apple.y }];
      return true;
    }

    const points = cells.map((id) => {
      const c = id % this.grid.cols;
      const r = (id / this.grid.cols) | 0;
      return {
        x: (c + 0.5) * this.grid.cell,
        y: (r + 0.5) * this.grid.cell,
      };
    });
    points[points.length - 1] = { x: this.apple.x, y: this.apple.y };
    this.path = this.smoothPath(points);
    return this.path.length > 0;
  }

  planWander(now) {
    if (now < this.nextWanderAt || !this.head) return false;
    this.nextWanderAt = now + 300;

    const start = this.cellAt(this.head.x, this.head.y);
    if (!start) return false;
    const reachable = this.reachableFrom(start.c, start.r);
    if (!reachable.length) return false;

    const cell = this.grid.cell;
    const options = [];
    const fallbackOptions = [];
    for (const id of reachable) {
      const c = id % this.grid.cols;
      const r = (id / this.grid.cols) | 0;
      const x = (c + 0.5) * cell;
      const y = (r + 0.5) * cell;
      const distance = hypot(x - this.head.x, y - this.head.y);
      if (distance < cell * 4 || distance > cell * 14) continue;
      if (this.isOpen(c, r, 1)) options.push({ c, r });
      else fallbackOptions.push({ c, r });
    }

    const pool = options.length ? options : fallbackOptions;
    if (!pool.length) return false;
    const target = pool[Math.floor(Math.random() * pool.length)];
    const cells = this.findCellPath(start.c, start.r, target.c, target.r);
    if (!cells || !cells.length) return false;

    const points = cells.map((id) => {
      const c = id % this.grid.cols;
      const r = (id / this.grid.cols) | 0;
      return {
        x: (c + 0.5) * cell,
        y: (r + 0.5) * cell,
      };
    });
    this.path = this.smoothPath(points);
    return this.path.length > 0;
  }

  spawnApple(now) {
    if (!this.head) return false;
    const start = this.cellAt(this.head.x, this.head.y);
    if (!start) return false;

    const reachable = this.reachableFrom(start.c, start.r);
    if (!reachable.length) return false;

    const cell = this.grid.cell;
    const margin = this.cfg.appleRadius + 6;
    const minDistance = Math.max(cell * 5, Math.min(140, this.w * 0.2));
    const idealDistance = Math.min(450, Math.max(165, this.w * 0.32));
    const bodyPoints = this.bodyOutlinePoints();

    const collect = (allowClose) => {
      const withSpace = [];
      const withoutSpace = [];
      for (const id of reachable) {
        const c = id % this.grid.cols;
        const r = (id / this.grid.cols) | 0;
        const x = (c + 0.5) * cell;
        const y = (r + 0.5) * cell;
        if (x < margin || x > this.w - margin) continue;
        if (y < margin || y > this.h - margin) continue;

        const distance = hypot(x - this.head.x, y - this.head.y);
        if (distance < minDistance && !allowClose) continue;

        let nearBody = false;
        for (const point of bodyPoints) {
          if (hypot(x - point.x, y - point.y) < this.cfg.bodyWidth + this.cfg.appleRadius + 10) {
            nearBody = true;
            break;
          }
        }
        if (nearBody) continue;

        const entry = { x, y, distance };
        if (this.isOpen(c, r, 1)) withSpace.push(entry);
        else withoutSpace.push(entry);
      }
      return withSpace.length ? withSpace : withoutSpace;
    };

    let candidates = collect(false);
    if (!candidates.length) candidates = collect(true);
    if (!candidates.length) return false;

    candidates.sort((a, b) => Math.abs(a.distance - idealDistance) - Math.abs(b.distance - idealDistance));
    const poolSize = Math.max(3, Math.ceil(candidates.length * 0.3));
    const pool = candidates.slice(0, poolSize);
    const chosen = pool[Math.floor(Math.random() * pool.length)];

    this.apple = { x: chosen.x, y: chosen.y, born: now, seed: Math.random() * 10 };
    this.planToApple(now);
    return true;
  }

  bodyOutlinePoints() {
    const points = [];
    const trail = this.trail;
    let accumulated = 0;
    for (let i = trail.length - 1; i >= 0; i -= 1) {
      const point = trail[i];
      if (i === trail.length - 1) {
        points.push(point);
        accumulated = 0;
        continue;
      }
      const previous = trail[i + 1];
      accumulated += hypot(point.x - previous.x, point.y - previous.y);
      if (accumulated >= 14) {
        points.push(point);
        accumulated = 0;
      }
      if (points.length > 80) break;
    }
    return points;
  }

  move(dt) {
    const previous = { x: this.head.x, y: this.head.y };
    const speed = this.cfg.speed * (this.reducedMotion.matches ? 0.38 : 1);
    let remaining = speed * dt;
    let travel = 0;
    let moveAngle = this.angle;

    while (remaining > 0.0001 && this.path.length) {
      const target = this.path[0];
      const dx = target.x - this.head.x;
      const dy = target.y - this.head.y;
      const distance = hypot(dx, dy);
      if (distance < 0.001) {
        this.path.shift();
        continue;
      }

      moveAngle = Math.atan2(dy, dx);
      if (distance <= remaining) {
        this.head.x = target.x;
        this.head.y = target.y;
        remaining -= distance;
        travel += distance;
        this.path.shift();
      } else {
        this.head.x += (dx / distance) * remaining;
        this.head.y += (dy / distance) * remaining;
        travel += remaining;
        remaining = 0;
      }
    }

    if (travel <= 0.001) return;

    let difference = moveAngle - this.visualAngle;
    while (difference > Math.PI) difference -= TAU;
    while (difference < -Math.PI) difference += TAU;
    this.visualAngle += difference * Math.min(1, dt * 12);

    this.phase += travel * (this.reducedMotion.matches ? 0.02 : 0.075);
    this.recordTrail();
  }

  recordTrail() {
    const last = this.trail[this.trail.length - 1];
    if (!last || hypot(this.head.x - last.x, this.head.y - last.y) > 0.8) {
      this.trail.push({ x: this.head.x, y: this.head.y });
    }
    if (this.trail.length > 800) this.trail.splice(0, this.trail.length - 800);
  }

  trimTrail() {
    const limit = this.bodyLength + 120;
    let accumulated = 0;
    for (let i = this.trail.length - 1; i > 0; i -= 1) {
      const a = this.trail[i];
      const b = this.trail[i - 1];
      accumulated += hypot(a.x - b.x, a.y - b.y);
      if (accumulated > limit) {
        this.trail.splice(0, i);
        break;
      }
    }
  }

  checkEat(now) {
    if (!this.apple) return;
    const reach = this.cfg.appleRadius + this.cfg.bodyWidth * 0.45;
    if (hypot(this.head.x - this.apple.x, this.head.y - this.apple.y) > reach) return;

    this.burst(this.apple.x, this.apple.y);
    this.bodyLength += this.cfg.growth;
    this.apple = null;
    this.nextAppleAt = now + 520;
    this.path = [];
    this.planWander(now);
  }

  burst(x, y) {
    const count = this.reducedMotion.matches ? 4 : 14;
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * TAU;
      const speed = 35 + Math.random() * 110;
      this.particles.push({
        type: "dot",
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 30,
        radius: 1.4 + Math.random() * 2.2,
        life: 0.35 + Math.random() * 0.4,
        age: 0,
        color: i % 3 === 0 ? INK : LIME,
      });
    }
    this.particles.push({
      type: "ring",
      x,
      y,
      radius: this.cfg.appleRadius * 0.7,
      life: 0.42,
      age: 0,
    });
  }

  updateParticles(dt) {
    for (const particle of this.particles) {
      particle.age += dt;
      if (particle.type === "ring") {
        particle.radius += dt * 70;
        continue;
      }
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += 150 * dt;
    }
    this.particles = this.particles.filter((particle) => particle.age < particle.life);
  }

  cellAt(x, y) {
    if (!this.grid) return null;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    const c = clamp(Math.floor(x / this.grid.cell), 0, this.grid.cols - 1);
    const r = clamp(Math.floor(y / this.grid.cell), 0, this.grid.rows - 1);
    return { c, r };
  }

  isFreeCell(c, r) {
    if (!this.grid) return false;
    if (c < 0 || r < 0 || c >= this.grid.cols || r >= this.grid.rows) return false;
    return this.grid.blocked[r * this.grid.cols + c] === 0;
  }

  isOpen(c, r, radius) {
    for (let dr = -radius; dr <= radius; dr += 1) {
      for (let dc = -radius; dc <= radius; dc += 1) {
        if (!this.isFreeCell(c + dc, r + dr)) return false;
      }
    }
    return true;
  }

  freeNeighbours(c, r) {
    let count = 0;
    if (this.isFreeCell(c + 1, r)) count += 1;
    if (this.isFreeCell(c - 1, r)) count += 1;
    if (this.isFreeCell(c, r + 1)) count += 1;
    if (this.isFreeCell(c, r - 1)) count += 1;
    return count;
  }

  pointIsFree(x, y) {
    const cell = this.cellAt(x, y);
    return !!cell && this.isFreeCell(cell.c, cell.r);
  }

  headIsFree() {
    return !!this.head && this.pointIsFree(this.head.x, this.head.y);
  }

  bodyIsFree() {
    if (!this.head) return false;
    for (const point of this.bodyOutlinePoints()) {
      if (!this.pointIsFree(point.x, point.y)) return false;
    }
    return true;
  }

  reachableFrom(startC, startR) {
    const { cols, rows, blocked } = this.grid;
    if (!this.isFreeCell(startC, startR)) return [];
    const seen = new Uint8Array(cols * rows);
    const queue = new Int32Array(cols * rows);
    const start = startR * cols + startC;
    let head = 0;
    let tail = 0;
    queue[tail] = start;
    tail += 1;
    seen[start] = 1;
    const cells = [];

    while (head < tail) {
      const id = queue[head];
      head += 1;
      cells.push(id);
      const c = id % cols;
      const r = (id / cols) | 0;
      if (c + 1 < cols) {
        const n = id + 1;
        if (!blocked[n] && !seen[n]) {
          seen[n] = 1;
          queue[tail] = n;
          tail += 1;
        }
      }
      if (c > 0) {
        const n = id - 1;
        if (!blocked[n] && !seen[n]) {
          seen[n] = 1;
          queue[tail] = n;
          tail += 1;
        }
      }
      if (r + 1 < rows) {
        const n = id + cols;
        if (!blocked[n] && !seen[n]) {
          seen[n] = 1;
          queue[tail] = n;
          tail += 1;
        }
      }
      if (r > 0) {
        const n = id - cols;
        if (!blocked[n] && !seen[n]) {
          seen[n] = 1;
          queue[tail] = n;
          tail += 1;
        }
      }
    }
    return cells;
  }

  heuristic(c, r, goalC, goalR) {
    const dx = Math.abs(c - goalC);
    const dy = Math.abs(r - goalR);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
  }

  findCellPath(startC, startR, goalC, goalR) {
    if (!this.isFreeCell(startC, startR) || !this.isFreeCell(goalC, goalR)) return null;
    const { cols, rows, blocked } = this.grid;
    const total = cols * rows;
    const start = startR * cols + startC;
    const goal = goalR * cols + goalC;
    if (start === goal) return [];

    const bodyCost = this.bodyCostMap();
    const gScore = new Float32Array(total).fill(Infinity);
    const parents = new Int32Array(total).fill(-1);
    const closed = new Uint8Array(total);
    const heap = new MinHeap();
    gScore[start] = 0;
    heap.push(start, this.heuristic(startC, startR, goalC, goalR));

    while (heap.size) {
      const current = heap.pop();
      if (closed[current]) continue;

      if (current === goal) {
        const path = [];
        let cursor = current;
        while (cursor !== start) {
          path.push(cursor);
          cursor = parents[cursor];
          if (cursor === -1) return null;
        }
        path.reverse();
        return path;
      }

      closed[current] = 1;
      const c = current % cols;
      const r = (current / cols) | 0;

      for (const [dc, dr] of DIRECTIONS) {
        const nc = c + dc;
        const nr = r + dr;
        if (!this.isFreeCell(nc, nr)) continue;
        if (dc !== 0 && dr !== 0) {
          if (!this.isFreeCell(c + dc, r) || !this.isFreeCell(c, r + dr)) continue;
        }
        const nid = nr * cols + nc;
        if (closed[nid]) continue;

        const step = dc !== 0 && dr !== 0 ? Math.SQRT2 : 1;
        const penalty = bodyCost[nid] ? 1.1 : 0;
        const tentative = gScore[current] + step + penalty;
        if (tentative >= gScore[nid]) continue;

        gScore[nid] = tentative;
        parents[nid] = current;
        heap.push(nid, tentative + this.heuristic(nc, nr, goalC, goalR) * 1.03);
      }
    }

    return null;
  }

  bodyCostMap() {
    const { cols, rows } = this.grid;
    const map = new Uint8Array(cols * rows);
    if (!this.head || !this.trail.length) return map;

    let accumulated = 0;
    let previous = this.head;
    for (let i = this.trail.length - 1; i >= 0; i -= 1) {
      const point = this.trail[i];
      accumulated += hypot(point.x - previous.x, point.y - previous.y);
      previous = point;
      if (accumulated < this.grid.cell * 2) continue;
      const c = clamp(Math.floor(point.x / this.grid.cell), 0, cols - 1);
      const r = clamp(Math.floor(point.y / this.grid.cell), 0, rows - 1);
      map[r * cols + c] = 1;
      if (accumulated > this.bodyLength) break;
    }
    return map;
  }

  smoothPath(points) {
    if (!points.length) return [];
    const result = [];
    let anchor = { x: this.head.x, y: this.head.y };
    let index = 0;

    while (index < points.length) {
      let farthest = index;
      for (let j = points.length - 1; j > index; j -= 1) {
        if (this.lineClear(anchor, points[j])) {
          farthest = j;
          break;
        }
      }
      const point = points[farthest];
      if (!this.lineClear(anchor, point) && farthest > index) {
        farthest = index;
      }
      result.push(points[farthest]);
      anchor = points[farthest];
      index = farthest + 1;
    }

    return result;
  }

  lineClear(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = hypot(dx, dy);
    if (distance < 0.001) return true;
    const steps = Math.max(1, Math.ceil(distance / (this.grid.cell * 0.35)));
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      if (!this.pointIsFree(a.x + dx * t, a.y + dy * t)) return false;
    }
    return true;
  }

  pathIsClear() {
    let previous = { x: this.head.x, y: this.head.y };
    for (const point of this.path) {
      if (!this.lineClear(previous, point)) return false;
      previous = point;
    }
    return true;
  }

  bodySamples() {
    const cfg = this.cfg;
    const bodyLength = this.bodyLength;
    const chain = [this.head, ...this.trail.slice().reverse()];
    if (chain.length < 2) return [];

    const step = Math.max(2, cfg.bodyWidth * 0.24);
    const points = [];
    let accumulated = 0;
    let nextDistance = 0;
    let index = 0;

    while (index < chain.length - 1 && nextDistance <= bodyLength) {
      const a = chain[index];
      const b = chain[index + 1];
      const segment = hypot(b.x - a.x, b.y - a.y);
      if (segment < 0.001) {
        index += 1;
        continue;
      }
      while (nextDistance <= accumulated + segment && nextDistance <= bodyLength) {
        const t = (nextDistance - accumulated) / segment;
        points.push({
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          s: nextDistance,
        });
        nextDistance += step;
      }
      accumulated += segment;
      index += 1;
    }

    if (!points.length) {
      points.push({ x: this.head.x, y: this.head.y, s: 0 });
    }

    const frequency = TAU / (cfg.bodyWidth * 5.4);
    const total = Math.max(1, bodyLength);
    for (let i = 0; i < points.length; i += 1) {
      const point = points[i];
      const previous = points[Math.max(0, i - 1)];
      const next = points[Math.min(points.length - 1, i + 1)];
      let tx = next.x - previous.x;
      let ty = next.y - previous.y;
      const length = hypot(tx, ty) || 1;
      tx /= length;
      ty /= length;

      const t = clamp(point.s / total, 0, 1);
      const envelope = Math.sin(Math.PI * t) ** 0.8;
      const wave = this.reducedMotion.matches
        ? 0
        : Math.sin(point.s * frequency - this.phase) * cfg.wave * envelope;
      point.x += -ty * wave;
      point.y += tx * wave;
      point.width = cfg.bodyWidth * (0.22 + 0.78 * Math.pow(1 - t, 0.42));
    }

    return points;
  }

  render(now) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);

    if (!this.head || this.alpha <= 0.005) return;

    ctx.save();
    ctx.globalAlpha = this.alpha;
    this.drawApple(now);
    this.drawSnake(now);
    this.drawParticles();
    ctx.restore();
  }

  drawApple(now) {
    if (!this.apple) return;
    const ctx = this.ctx;
    const age = clamp((now - this.apple.born) / 380, 0, 1);
    const pop = 1 + 2.4 * Math.pow(age - 1, 3) + 1.4 * Math.pow(age - 1, 2);
    const pulse = this.reducedMotion.matches ? 0 : Math.sin(now / 300 + this.apple.seed) * 0.035;
    const bob = this.reducedMotion.matches ? 0 : Math.sin(now / 460 + this.apple.seed) * 1.6;
    const scale = Math.max(0, pop * (1 + pulse));
    const radius = this.cfg.appleRadius;

    ctx.save();
    ctx.translate(this.apple.x, this.apple.y + bob);
    ctx.scale(scale, scale);

    ctx.beginPath();
    ctx.ellipse(0, radius * 0.92, radius * 0.9, radius * 0.28, 0, 0, TAU);
    ctx.fillStyle = "rgba(41, 42, 35, 0.08)";
    ctx.fill();

    ctx.shadowColor = "rgba(216, 253, 113, 0.85)";
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.moveTo(0, -radius * 0.5);
    ctx.bezierCurveTo(-radius * 1.28, -radius * 1.35, -radius * 1.5, radius * 0.25, -radius * 0.68, radius * 0.9);
    ctx.bezierCurveTo(-radius * 0.3, radius * 1.25, radius * 0.3, radius * 1.25, radius * 0.68, radius * 0.9);
    ctx.bezierCurveTo(radius * 1.5, radius * 0.25, radius * 1.28, -radius * 1.35, 0, -radius * 0.5);
    ctx.closePath();
    ctx.fillStyle = LIME;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, -radius * 0.55);
    ctx.quadraticCurveTo(radius * 0.05, -radius * 1.25, radius * 0.42, -radius * 1.35);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.1;
    ctx.lineCap = "round";
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(radius * 0.35, -radius * 1.3);
    ctx.quadraticCurveTo(radius * 0.9, -radius * 1.55, radius * 1.1, -radius * 1.02);
    ctx.quadraticCurveTo(radius * 0.7, -radius * 0.72, radius * 0.35, -radius * 1.3);
    ctx.fillStyle = INK;
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(-radius * 0.38, -radius * 0.1, radius * 0.22, radius * 0.36, -0.5, 0, TAU);
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.fill();

    ctx.restore();
  }

  drawSnake() {
    const ctx = this.ctx;
    const samples = this.bodySamples();
    const cfg = this.cfg;
    const outline = Math.max(1.4, cfg.bodyWidth * 0.15);

    if (samples.length > 1) {
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      for (let i = 0; i < samples.length - 1; i += 1) {
        const a = samples[i];
        const b = samples[i + 1];
        const width = (a.width + b.width) / 2;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineWidth = width + outline * 2;
        ctx.strokeStyle = INK;
        ctx.stroke();
      }

      for (let i = 0; i < samples.length - 1; i += 1) {
        const a = samples[i];
        const b = samples[i + 1];
        const width = (a.width + b.width) / 2;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineWidth = width;
        ctx.strokeStyle = LIME;
        ctx.stroke();
      }

      const stripeOffset = cfg.bodyWidth * 1.4;
      const stripeGap = cfg.bodyWidth * 2.3;
      const stripeWidth = cfg.bodyWidth * 0.55;
      ctx.lineCap = "round";

      for (let i = 0; i < samples.length - 1; i += 1) {
        const a = samples[i];
        const b = samples[i + 1];
        const middle = (a.s + b.s) / 2;
        if (middle <= stripeOffset) continue;
        if ((middle - stripeOffset) % stripeGap > stripeWidth) continue;

        const width = (a.width + b.width) / 2;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineWidth = width;
        ctx.strokeStyle = INK;
        ctx.stroke();
      }
    }

    this.drawHead();
  }

  drawHead() {
    const ctx = this.ctx;
    const cfg = this.cfg;
    const radius = cfg.bodyWidth * 0.78;
    const outline = Math.max(1.5, cfg.bodyWidth * 0.15);

    ctx.save();
    ctx.translate(this.head.x, this.head.y);
    ctx.rotate(this.visualAngle);

    ctx.beginPath();
    ctx.ellipse(radius * 0.18, 0, radius * 1.04, radius * 0.87, 0, 0, TAU);
    ctx.fillStyle = LIME;
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = outline * 1.35;
    ctx.lineJoin = "round";
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(-radius * 0.22, -radius * 0.34, radius * 0.42, radius * 0.16, -0.35, 0, TAU);
    ctx.fillStyle = "rgba(255, 255, 255, 0.38)";
    ctx.fill();

    for (const side of [-1, 1]) {
      const ex = radius * 0.36;
      const ey = side * radius * 0.47;
      ctx.beginPath();
      ctx.arc(ex, ey, radius * 0.23, 0, TAU);
      ctx.fillStyle = INK;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(ex + radius * 0.06, ey - radius * 0.06, radius * 0.07, 0, TAU);
      ctx.fillStyle = CREAM;
      ctx.fill();
    }

    if (!this.reducedMotion.matches) {
      const cycle = ((performance.now() / 1000 + this.tongueSeed) % 5.2);
      if (cycle < 0.7) {
        const extension = Math.sin((cycle / 0.7) * Math.PI);
        const startX = radius * 1.12;
        const length = radius * 0.8 + extension * radius * 0.95;
        ctx.beginPath();
        ctx.moveTo(startX, 0);
        ctx.lineTo(startX + length, 0);
        ctx.lineTo(startX + length + radius * 0.28, -radius * 0.24);
        ctx.moveTo(startX + length, 0);
        ctx.lineTo(startX + length + radius * 0.28, radius * 0.24);
        ctx.strokeStyle = INK;
        ctx.lineWidth = Math.max(1.1, cfg.bodyWidth * 0.11);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  drawParticles() {
    const ctx = this.ctx;
    for (const particle of this.particles) {
      const life = 1 - particle.age / particle.life;
      if (life <= 0) continue;
      ctx.save();
      ctx.globalAlpha *= life;
      if (particle.type === "ring") {
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.radius, 0, TAU);
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.3;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.radius, 0, TAU);
        ctx.fillStyle = particle.color;
        ctx.fill();
        if (particle.color === LIME) {
          ctx.strokeStyle = INK;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }
}
