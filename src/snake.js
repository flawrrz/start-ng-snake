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

function angleDelta(a, b) {
  let difference = a - b;
  while (difference > Math.PI) difference -= TAU;
  while (difference < -Math.PI) difference += TAU;
  return difference;
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
    this.pathKind = null;
    this.angle = 0;
    this.visualAngle = 0;
    this.phase = 0;
    this.bodyLength = 0;
    this.apple = null;
    this.lastApple = null;
    this.particles = [];
    this.coveredSince = 0;
    this.nextResurfaceAt = 0;
    this.lastWanderAngle = null;
    this.wanderAvoid = null;
    this.command = null;
    this.commandArriveAt = 0;
    this.nextGuideAt = -Infinity;
    this.commandHold = 6500;
    this.maskCanvas = document.createElement("canvas");
    this.maskCtx = this.maskCanvas.getContext("2d");
    this.maskShapes = [];
    this.maskDirty = true;
    this.maskCacheDirty = true;
    this.maskScrollX = NaN;
    this.maskScrollY = NaN;
    this.layoutDirty = true;
    this.lastGridAt = -Infinity;
    this.nextInitAt = 0;
    this.nextAppleAt = 0;
    this.nextWanderAt = 0;
    this.lastFrame = 0;
    this.raf = 0;
    this.tongueSeed = Math.random() * 6;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.boundTick = (time) => this.tick(time);
    this.boundScroll = () => {
      this.layoutDirty = true;
    };
    this.boundResize = () => {
      this.measure();
      this.layoutDirty = true;
      this.maskCacheDirty = true;
    };
    this.boundToggle = (event) => {
      if (event.target instanceof HTMLDetailsElement) {
        this.layoutDirty = true;
        this.maskCacheDirty = true;
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
        this.maskCacheDirty = true;
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
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
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
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";
    this.maskDirty = true;
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
    if (this.maskCacheDirty) this.rebuildMaskCache();
    this.afterLayout(now);
  }

  afterLayout(now) {
    if (!this.grid) return;
    if (!this.head) {
      if (now >= this.nextInitAt) this.initWorld(now);
      return;
    }

    const margin = this.grid.cell * 0.5;
    const x = clamp(this.head.x, margin, Math.max(margin, this.w - margin));
    const y = clamp(this.head.y, margin, Math.max(margin, this.h - margin));
    if (x !== this.head.x || y !== this.head.y) {
      this.head.x = x;
      this.head.y = y;
      this.path = [];
      this.pathKind = null;
    }

    if (this.path.length && !this.pathIsClear()) {
      this.path = [];
      this.pathKind = null;
      if (this.commandActive(now)) this.guideTo(this.command.x, this.command.y, now);
      else if (this.appleTargetable()) this.planToApple(now);
    }
  }

  /* A click (or drag) destination. Auto behaviour resumes after commandHold. */
  guideTo(x, y, now = performance.now(), immediate = true) {
    if (!this.head || !this.grid) return false;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    if (!immediate && now < this.nextGuideAt) return false;
    this.nextGuideAt = now + 110;

    const start = this.cellAt(this.head.x, this.head.y);
    const goal = this.cellAt(x, y);
    if (!start || !goal) return false;

    this.command = { x, y, born: now, alpha: this.command ? this.command.alpha : 0 };
    this.commandArriveAt = now;

    if (goal.c === start.c && goal.r === start.r) {
      this.path = [];
      this.pathKind = null;
      return true;
    }

    const cells = this.findCellPath(start.c, start.r, goal.c, goal.r);
    if (!cells || !cells.length) return true;

    const points = cells.map((id) => {
      const c = id % this.grid.cols;
      const r = (id / this.grid.cols) | 0;
      return {
        x: (c + 0.5) * this.grid.cell,
        y: (r + 0.5) * this.grid.cell,
      };
    });
    points[points.length - 1] = { x, y };
    const path = this.smoothPath(points);
    if (path.length) {
      this.path = path;
      this.pathKind = "command";
      /* Auto resumes commandHold after the snake would have arrived, not after
         the click, so a far destination is not abandoned on the way. */
      const speed = this.cfg.speed * (this.reducedMotion.matches ? 0.5 : 1);
      const travel = (this.remainingPathLength() / Math.max(1, speed)) * 1000;
      this.commandArriveAt = now + Math.min(travel, 15000);
    }
    return true;
  }

  releaseControl() {
    this.command = null;
    this.commandArriveAt = 0;
    this.path = [];
    this.pathKind = null;
  }

  commandActive(now) {
    return Boolean(this.command) && now < this.commandArriveAt + this.commandHold;
  }

  fadeCommand(dt) {
    if (!this.command) return;
    if (this.commandActive(performance.now())) {
      this.command.alpha = Math.min(1, this.command.alpha + dt * 7);
    } else {
      this.command.alpha -= dt * 3;
      if (this.command.alpha <= 0.01) this.command = null;
    }
  }

  update(dt, now) {
    if (!this.head) {
      if (now >= this.nextInitAt) this.initWorld(now);
      this.updateParticles(dt);
      return;
    }

    this.updateParticles(dt);
    this.fadeCommand(dt);

    if (this.pointIsVisible(this.head.x, this.head.y)) {
      this.coveredSince = 0;
    } else if (!this.coveredSince) {
      this.coveredSince = now;
    }

    if (this.apple) {
      if (!this.apple.leaving && !this.appleSpotVisible(this.apple.x, this.apple.y)) {
        this.apple.leaving = true;
        const end = this.path[this.path.length - 1];
        if (end && hypot(end.x - this.apple.x, end.y - this.apple.y) < this.grid.cell * 1.5) {
          this.path = [];
          this.pathKind = null;
        }
      }
      if (this.apple.leaving) {
        this.apple.alpha -= dt * 4.5;
        if (this.apple.alpha <= 0.01) {
          this.apple = null;
          this.nextAppleAt = now + 360;
        }
      }
    }

    if (!this.apple && now >= this.nextAppleAt) {
      if (!this.spawnApple(now)) {
        this.nextAppleAt = now + 850;
      }
    }

    // A fresh apple takes over a wander leg, but a crossing that already ends
    // in open background is allowed to finish first.
    if (
      this.apple &&
      this.pathKind === "wander" &&
      !(this.coveredSince && this.pathEndsVisible()) &&
      this.appleTargetable()
    ) {
      this.path = [];
      this.pathKind = null;
    }

    if (!this.path.length) {
      if (this.commandActive(now)) {
        this.phase += dt * (this.reducedMotion.matches ? 0.5 : 1.9);
      } else {
        if (this.appleTargetable()) this.planToApple(now);
        if (!this.path.length && !this.coveredSince) this.planWander(now);
      }
    }

    if (this.pathKind !== "command" && this.coveredSince && now >= this.nextResurfaceAt) {
      const hiddenFor = now - this.coveredSince;
      if (hiddenFor > 450 && !this.pathEndsVisible()) {
        this.resurface(now);
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
    if (!this.placeSnake()) {
      this.nextInitAt = now + 650;
      return;
    }

    this.apple = null;
    this.lastApple = null;
    this.nextAppleAt = now;
    this.nextWanderAt = 0;
    this.coveredSince = 0;
    this.nextResurfaceAt = 0;
    this.lastWanderAngle = null;
    this.wanderAvoid = null;
    this.command = null;
    this.commandArriveAt = 0;
    this.spawnApple(now);
  }

  placeSnake() {
    if (!this.grid) return false;
    const attempts = [
      { allow: (c, r) => this.isFreeCell(c, r), candidates: this.spawnCandidates() },
      { allow: (c, r) => this.isRoamCell(c, r), candidates: this.spawnCandidates(true) },
    ];

    for (const attempt of attempts) {
      const candidates = attempt.candidates.slice(0, 28);
      for (const candidate of candidates) {
        if (!attempt.allow(candidate.c, candidate.r)) continue;
        const chain = this.bodyChain(candidate.c, candidate.r, attempt.allow);
        if (!chain || chain.length < 3) continue;

        const smoothed = this.smoothChain(chain, attempt.allow);
        const head = smoothed[0];
        const neck = smoothed[1] ?? chain[1];
        this.head = { x: head.x, y: head.y };
        this.trail = smoothed.slice().reverse();
        this.angle = Math.atan2(head.y - neck.y, head.x - neck.x);
        this.visualAngle = this.angle;
        this.path = [];
        this.pathKind = null;
        this.phase = Math.random() * TAU;
        this.coveredSince = 0;
        this.lastWanderAngle = null;
        return true;
      }
    }

    return false;
  }

  spawnCandidates(includeBlocked = false) {
    const { cols, rows, blocked, cell } = this.grid;
    const preferred = this.head
      ? { x: this.head.x, y: this.head.y }
      : { x: this.w * 0.53, y: this.h * 0.27 };
    const list = [];

    for (let r = 1; r < rows - 1; r += 1) {
      for (let c = 1; c < cols - 1; c += 1) {
        const isBlocked = blocked[r * cols + c] === 1;
        if (isBlocked && !includeBlocked) continue;
        const x = (c + 0.5) * cell;
        const y = (r + 0.5) * cell;
        if (x < cell * 1.5 || x > this.w - cell * 1.5) continue;
        if (y < cell * 1.5 || y > this.h - cell * 1.5) continue;

        let tier = 1;
        if (!isBlocked) {
          tier = 0;
          if (this.isOpen(c, r, 2)) tier = 3;
          else if (this.isOpen(c, r, 1)) tier = 2;
          else if (this.freeNeighbours(c, r) >= 2) tier = 1;
          if (!tier) continue;
        }

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

  bodyChain(startC, startR, allow) {
    const { cols, rows } = this.grid;
    const total = cols * rows;
    const start = startR * cols + startC;
    if (!allow(startC, startR)) return null;

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
        if (!allow(nc, nr)) continue;
        const nid = nr * cols + nc;
        if (parent[nid] !== -1) continue;
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

  smoothChain(points, allow) {
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
      const cell = this.cellAt(point.x, point.y);
      if (!cell || !allow(cell.c, cell.r)) return points.slice();
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
      this.pathKind = "apple";
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
    this.pathKind = this.path.length ? "apple" : null;
    return this.path.length > 0;
  }

  planWander(now) {
    if (now < this.nextWanderAt || !this.head) return false;
    this.nextWanderAt = now + 280;

    const start = this.cellAt(this.head.x, this.head.y);
    if (!start) return false;

    const hiddenFor = this.coveredSince ? now - this.coveredSince : 0;
    const target = this.pickWanderTarget(hiddenFor > 1600);
    if (!target) return false;

    const cells = this.findCellPath(start.c, start.r, target.c, target.r);
    if (!cells || !cells.length) return false;

    const points = cells.map((id) => {
      const c = id % this.grid.cols;
      const r = (id / this.grid.cols) | 0;
      return {
        x: (c + 0.5) * this.grid.cell,
        y: (r + 0.5) * this.grid.cell,
      };
    });
    this.path = this.smoothPath(points);
    this.pathKind = this.path.length ? "wander" : null;
    if (!this.path.length) return false;

    this.lastWanderAngle = Math.atan2(
      (target.r + 0.5) * this.grid.cell - this.head.y,
      (target.c + 0.5) * this.grid.cell - this.head.x,
    );
    this.wanderAvoid = null;
    return true;
  }

  /* Leave cover through the nearest opening that lies ahead of the head. */
  resurface(now) {
    this.nextResurfaceAt = now + 1200;
    if (!this.grid || !this.head) return false;
    const start = this.cellAt(this.head.x, this.head.y);
    if (!start) return false;

    const { cols, rows, cell } = this.grid;
    const body = this.bodyCostMap();
    const dirX = Math.cos(this.angle);
    const dirY = Math.sin(this.angle);
    let target = null;
    let bestScore = Infinity;

    const scan = (minAlign) => {
      for (let r = 1; r < rows - 1; r += 1) {
        for (let c = 1; c < cols - 1; c += 1) {
          if (body[r * cols + c]) continue;
          const x = (c + 0.5) * cell;
          const y = (r + 0.5) * cell;
          if (!this.pointIsVisible(x, y)) continue;
          const dx = x - this.head.x;
          const dy = y - this.head.y;
          const distance = hypot(dx, dy);
          if (distance < 0.001) continue;
          const align = (dx * dirX + dy * dirY) / distance;
          if (align < minAlign) continue;
          const edge = Math.min(x, y, this.w - x, this.h - y);
          const score =
            distance +
            (this.isOpen(c, r, 1) ? 0 : cell) +
            Math.max(0, cell * 3 - edge) * 1.5 +
            Math.max(0, -align) * cell * 8;
          if (score < bestScore) {
            bestScore = score;
            target = { c, r };
          }
        }
      }
    };

    scan(0.82);
    if (!target) scan(0.45);
    if (!target) scan(-1);

    if (!target) return false;
    if (target.c === start.c && target.r === start.r) return false;

    const cells = this.findCellPath(start.c, start.r, target.c, target.r);
    if (!cells || !cells.length) return false;

    const points = cells.map((id) => {
      const c = id % cols;
      const r = (id / cols) | 0;
      return {
        x: (c + 0.5) * cell,
        y: (r + 0.5) * cell,
      };
    });
    this.path = this.smoothPath(points);
    this.pathKind = this.path.length ? "resurface" : null;
    if (!this.path.length) return false;

    const speed = this.cfg.speed * (this.reducedMotion.matches ? 0.5 : 1);
    const travel = this.remainingPathLength() / Math.max(1, speed);
    this.nextResurfaceAt = now + clamp(travel * 1000 + 600, 1500, 12000);
    this.nextWanderAt = now + 280;
    this.lastWanderAngle = null;
    return true;
  }

  remainingPathLength() {
    let total = 0;
    let x = this.head.x;
    let y = this.head.y;
    for (const point of this.path) {
      total += hypot(point.x - x, point.y - y);
      x = point.x;
      y = point.y;
    }
    return total;
  }

  pathEndsVisible() {
    if (!this.path.length) return false;
    const end = this.path[this.path.length - 1];
    return this.pointIsVisible(end.x, end.y);
  }

  pickWanderTarget(freeOnly) {
    const { cols, rows, cell } = this.grid;
    const diag = hypot(this.w, this.h);
    const minDistance = Math.max(cell * 6, diag * 0.22);
    const maxDistance = Math.min(620, Math.max(minDistance + cell * 8, diag * 0.52));
    const margin = 2;
    const wantHidden = !freeOnly && Math.random() < 0.25;
    let best = null;
    let bestScore = 0;

    const sample = (hidden) => {
      for (let i = 0; i < 70; i += 1) {
        const spanC = Math.max(1, cols - margin * 2);
        const spanR = Math.max(1, rows - margin * 2);
        const c = margin + Math.floor(Math.random() * spanC);
        const r = margin + Math.floor(Math.random() * spanR);
        if (c >= cols - margin || r >= rows - margin) continue;

        const x = (c + 0.5) * cell;
        const y = (r + 0.5) * cell;
        if (this.pointIsVisible(x, y) === hidden) continue;

        const distance = hypot(x - this.head.x, y - this.head.y);
        if (distance < minDistance || distance > maxDistance) continue;

        const edge = Math.min(x, y, this.w - x, this.h - y);
        let score =
          0.55 +
          0.45 * clamp((distance - minDistance) / Math.max(1, maxDistance - minDistance), 0, 1);
        score *= 0.6 + 0.4 * clamp((edge - cell * 2) / (cell * 6), 0, 1);

        if (this.lastWanderAngle !== null) {
          const angle = Math.atan2(y - this.head.y, x - this.head.x);
          if (Math.abs(angleDelta(angle, this.lastWanderAngle)) < Math.PI / 2) score *= 0.4;
        }

        if (this.wanderAvoid) {
          const away = hypot(x - this.wanderAvoid.x, y - this.wanderAvoid.y);
          if (away < diag * 0.3) score *= 0.2;
        }

        score *= 0.7 + Math.random() * 0.6;
        if (score > bestScore) {
          bestScore = score;
          best = { c, r };
        }
      }
    };

    sample(wantHidden);
    if (!best) sample(!wantHidden);
    if (best) return best;

    for (let i = 0; i < 120; i += 1) {
      const c = 1 + Math.floor(Math.random() * Math.max(1, cols - 2));
      const r = 1 + Math.floor(Math.random() * Math.max(1, rows - 2));
      if (c >= cols - 1 || r >= rows - 1) continue;
      const x = (c + 0.5) * cell;
      const y = (r + 0.5) * cell;
      if (freeOnly && !this.pointIsVisible(x, y)) continue;
      if (hypot(x - this.head.x, y - this.head.y) < cell * 4) continue;
      return { c, r };
    }

    return null;
  }

  spawnApple(now) {
    if (!this.head) return false;
    const { cell, cols, rows, blocked } = this.grid;
    const margin = this.cfg.appleRadius + 6;
    const minDistance = Math.max(cell * 5, Math.min(140, this.w * 0.2));
    const idealDistance = Math.min(450, Math.max(165, this.w * 0.32));
    const bodyPoints = this.bodyOutlinePoints();
    const lastApple = this.lastApple;

    const collect = (allowClose, allowHalo) => {
      const withSpace = [];
      const withoutSpace = [];
      for (let r = 1; r < rows - 1; r += 1) {
        for (let c = 1; c < cols - 1; c += 1) {
          const crowded = Boolean(blocked[r * cols + c]);
          if (crowded && !allowHalo) continue;
          const x = (c + 0.5) * cell;
          const y = (r + 0.5) * cell;
          /* Narrow viewports can leave inflated obstacles over every cell, so
             the clearance halo is a last resort. Never under page content. */
          if (crowded && !this.pointIsVisible(x, y)) continue;
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

          const edge = Math.min(x, y, this.w - x, this.h - y);
          let score = Math.abs(distance - idealDistance) * 0.4;
          score += Math.max(0, cell * 7 - edge) * 2.4;
          if (lastApple && hypot(x - lastApple.x, y - lastApple.y) < Math.max(this.w, this.h) * 0.3) {
            score += 110;
          }

          const entry = { x, y, distance, score };
          if (this.isOpen(c, r, 1)) withSpace.push(entry);
          else withoutSpace.push(entry);
        }
      }
      return withSpace.length ? withSpace : withoutSpace;
    };

    let candidates = collect(false, false);
    if (!candidates.length) candidates = collect(true, false);
    if (!candidates.length) candidates = collect(false, true);
    if (!candidates.length) candidates = collect(true, true);
    if (!candidates.length) return false;

    candidates.sort((a, b) => a.score - b.score);
    const poolSize = Math.max(3, Math.ceil(candidates.length * 0.3));
    const pool = candidates.slice(0, poolSize);
    const chosen = pool[Math.floor(Math.random() * pool.length)];

    this.apple = {
      x: chosen.x,
      y: chosen.y,
      born: now,
      seed: Math.random() * 10,
      alpha: 1,
      leaving: false,
    };
    this.lastApple = { x: chosen.x, y: chosen.y };
    return true;
  }

  bodyOutlinePoints() {
    const points = [];
    const trail = this.trail;
    const step = Math.max(8, this.grid ? this.grid.cell * 0.5 : 12);
    const reach = this.bodyLength + step;
    let sincePoint = 0;
    let total = 0;
    for (let i = trail.length - 1; i >= 0; i -= 1) {
      const point = trail[i];
      if (i === trail.length - 1) {
        points.push(point);
        continue;
      }
      const previous = trail[i + 1];
      const segment = hypot(point.x - previous.x, point.y - previous.y);
      sincePoint += segment;
      total += segment;
      if (sincePoint >= step) {
        points.push(point);
        sincePoint = 0;
      }
      if (total >= reach) break;
    }
    return points;
  }

  move(dt) {
    const previous = { x: this.head.x, y: this.head.y };
    const speed = this.cfg.speed * (this.reducedMotion.matches ? 0.5 : 1);
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

    this.angle = moveAngle;
    let difference = moveAngle - this.visualAngle;
    while (difference > Math.PI) difference -= TAU;
    while (difference < -Math.PI) difference += TAU;
    const ease = 1 - Math.exp(-dt * 7);
    const maxTurn = dt * 6.5;
    this.visualAngle += clamp(difference * ease, -maxTurn, maxTurn);

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
    if (!this.apple || this.apple.leaving || this.apple.alpha < 0.6) return;
    const reach = this.cfg.appleRadius + this.cfg.bodyWidth * 0.45;
    if (hypot(this.head.x - this.apple.x, this.head.y - this.apple.y) > reach) return;

    this.burst(this.apple.x, this.apple.y);
    this.bodyLength += this.cfg.growth;
    this.wanderAvoid = { x: this.apple.x, y: this.apple.y };
    this.apple = null;
    this.nextAppleAt = now + 520;
    this.nextWanderAt = 0;
    this.path = [];
    this.pathKind = null;
    if (this.commandActive(now)) this.guideTo(this.command.x, this.command.y, now);
    else this.planWander(now);
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

  isRoamCell(c, r) {
    if (!this.grid) return false;
    return c >= 0 && r >= 0 && c < this.grid.cols && r < this.grid.rows;
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

  /* Apples may legally sit in the obstacle halo, so only real coverage retires
     one. */
  appleSpotVisible(x, y) {
    return this.pointIsFree(x, y) || this.pointIsVisible(x, y);
  }

  pointIsVisible(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    for (const shape of this.maskShapes) {
      const left = shape.fixed ? shape.x : shape.x - scrollX;
      const top = shape.fixed ? shape.y : shape.y - scrollY;
      if (x >= left && x <= left + shape.w && y >= top && y <= top + shape.h) return false;
    }
    return true;
  }

  pointIsRoamable(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  appleTargetable() {
    return Boolean(this.apple && !this.apple.leaving && this.head);
  }

  heuristic(c, r, goalC, goalR) {
    const dx = Math.abs(c - goalC);
    const dy = Math.abs(r - goalR);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
  }

  findCellPath(startC, startR, goalC, goalR) {
    if (!this.isRoamCell(startC, startR) || !this.isRoamCell(goalC, goalR)) return null;
    const { cols, rows } = this.grid;
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
        if (!this.isRoamCell(nc, nr)) continue;
        if (dc !== 0 && dr !== 0) {
          if (!this.isRoamCell(c + dc, r) || !this.isRoamCell(c, r + dr)) continue;
        }
        const nid = nr * cols + nc;
        if (closed[nid]) continue;

        const step = dc !== 0 && dr !== 0 ? Math.SQRT2 : 1;
        const edge = Math.min(nc, nr, cols - 1 - nc, rows - 1 - nr);
        const penalty =
          (bodyCost[nid] ? 1.1 : 0) + (edge === 0 ? 1.5 : edge === 1 ? 0.3 : 0);
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

    return this.curvedLead(result);
  }

  curvedLead(points) {
    if (!points.length || !this.head || !this.grid) return points;
    const target = points[0];
    const dx = target.x - this.head.x;
    const dy = target.y - this.head.y;
    const distance = hypot(dx, dy);
    const cell = this.grid.cell;
    if (distance < cell * 3) return points;

    const targetAngle = Math.atan2(dy, dx);
    let delta = targetAngle - this.angle;
    while (delta > Math.PI) delta -= TAU;
    while (delta < -Math.PI) delta += TAU;
    if (Math.abs(delta) < 0.35) return points;

    const targetX = dx / distance;
    const targetY = dy / distance;
    const currentX = Math.cos(this.angle);
    const currentY = Math.sin(this.angle);
    const lead = Math.min(
      distance * 0.5,
      clamp(Math.abs(delta) * cell * 2.2, cell * 2.2, cell * 5.5),
    );
    const endX = this.head.x + targetX * lead;
    const endY = this.head.y + targetY * lead;
    const controlOneX = this.head.x + currentX * lead * 0.45;
    const controlOneY = this.head.y + currentY * lead * 0.45;
    const controlTwoX = endX - targetX * lead * 0.45;
    const controlTwoY = endY - targetY * lead * 0.45;
    const curve = [];
    const steps = 12;

    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      const inverse = 1 - t;
      const x =
        inverse ** 3 * this.head.x +
        3 * inverse ** 2 * t * controlOneX +
        3 * inverse * t ** 2 * controlTwoX +
        t ** 3 * endX;
      const y =
        inverse ** 3 * this.head.y +
        3 * inverse ** 2 * t * controlOneY +
        3 * inverse * t ** 2 * controlTwoY +
        t ** 3 * endY;
      if (!this.pointIsRoamable(x, y)) return points;
      curve.push({ x, y });
    }

    return [...curve, ...points];
  }

  lineClear(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = hypot(dx, dy);
    if (distance < 0.001) return true;
    const steps = Math.max(1, Math.ceil(distance / (this.grid.cell * 0.35)));
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      if (!this.pointIsRoamable(a.x + dx * t, a.y + dy * t)) return false;
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

  rebuildMaskCache() {
    this.maskCacheDirty = false;
    this.maskDirty = true;
    const shapes = [];
    const range = document.createRange();

    for (const region of document.querySelectorAll("[data-snake-mask]")) {
      const fixed = this.isFixedRegion(region);

      const walk = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          if (node.nodeValue && node.nodeValue.trim()) {
            range.selectNodeContents(node);
            for (const rect of range.getClientRects()) {
              this.pushMaskRect(shapes, rect, 0, fixed);
            }
          }
          return;
        }
        if (!(node instanceof Element)) return;
        if (node.tagName === "SCRIPT" || node.tagName === "STYLE" || node.tagName === "NOSCRIPT") return;

        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return;

        if (this.paintsSurface(style, node)) {
          const radius = parseFloat(style.borderTopLeftRadius) || 0;
          for (const rect of node.getClientRects()) {
            this.pushMaskRect(shapes, rect, radius, fixed);
          }
        }

        for (const child of node.childNodes) walk(child);
      };

      walk(region);
    }

    this.maskShapes = shapes;
  }

  isFixedRegion(element) {
    let node = element;
    while (node && node !== document.documentElement) {
      const position = getComputedStyle(node).position;
      if (position === "fixed" || position === "sticky") return true;
      node = node.parentElement;
    }
    return false;
  }

  paintsSurface(style, element) {
    if (style.backgroundImage && style.backgroundImage !== "none") return true;

    const background = style.backgroundColor;
    if (background && background !== "transparent") {
      const match = background.match(/^rgba?\(([^)]+)\)$/);
      if (!match) return true;
      const parts = match[1].split(",");
      const alpha = parts.length > 3 ? parseFloat(parts[3]) : 1;
      if (alpha > 0.04) return true;
    }

    const tag = element.tagName;
    return tag === "IMG" || tag === "SVG" || tag === "VIDEO" || tag === "CANVAS";
  }

  pushMaskRect(shapes, rect, radius, fixed) {
    if (rect.width < 1 || rect.height < 1) return;
    shapes.push({
      x: rect.left + (fixed ? 0 : window.scrollX),
      y: rect.top + (fixed ? 0 : window.scrollY),
      w: rect.width,
      h: rect.height,
      r: radius,
      fixed,
    });
  }

  syncMask() {
    if (!this.maskCtx) return;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    if (!this.maskDirty && scrollX === this.maskScrollX && scrollY === this.maskScrollY) return;
    this.buildMask(scrollX, scrollY);
  }

  buildMask(scrollX, scrollY) {
    const ctx = this.maskCtx;
    const scale = 0.42;
    const width = Math.max(1, Math.round(this.w * scale));
    const height = Math.max(1, Math.round(this.h * scale));

    if (this.maskCanvas.width !== width || this.maskCanvas.height !== height) {
      this.maskCanvas.width = width;
      this.maskCanvas.height = height;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = "#000";

    for (const shape of this.maskShapes) {
      const x = shape.fixed ? shape.x : shape.x - scrollX;
      const y = shape.fixed ? shape.y : shape.y - scrollY;
      if (x > this.w || y > this.h || x + shape.w < 0 || y + shape.h < 0) continue;
      this.traceMaskRect(ctx, x - 0.6, y - 0.8, shape.w + 1.2, shape.h + 1.6, shape.r);
      ctx.fill();
    }

    this.maskScrollX = scrollX;
    this.maskScrollY = scrollY;
    this.maskDirty = false;
  }

  traceMaskRect(ctx, x, y, width, height, radius) {
    const r = Math.min(Math.max(0, radius), width / 2, height / 2);
    ctx.beginPath();
    if (r < 0.5) {
      ctx.rect(x, y, width, height);
      return;
    }
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.arcTo(x + width, y, x + width, y + r, r);
    ctx.lineTo(x + width, y + height - r);
    ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
    ctx.lineTo(x + r, y + height);
    ctx.arcTo(x, y + height, x, y + height - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  applyMask() {
    if (!this.maskCtx || !this.maskShapes.length) return;
    if (!this.maskCanvas.width || !this.maskCanvas.height) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(this.maskCanvas, 0, 0, this.w, this.h);
    ctx.restore();
  }

  render(now) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    this.syncMask();

    if (!this.head) return;

    this.drawApple(now);
    this.drawSnake(now);
    this.drawParticles();
    this.applyMask();
    /* The marker is transient UI, so it stays readable above page content. */
    this.drawCommand(now);
  }

  drawCommand(now) {
    const target = this.command;
    if (!target || target.alpha <= 0.01) return;
    const ctx = this.ctx;
    const cell = this.grid ? this.grid.cell : 16;
    const reduced = this.reducedMotion.matches;
    const distance = this.head ? hypot(this.head.x - target.x, this.head.y - target.y) : 0;
    const closing = clamp(distance / (cell * 5), 0, 1);
    const base = cell * 0.62;
    const pulse = reduced ? 0 : Math.sin(now / 230) * 0.09;

    ctx.save();
    ctx.globalAlpha = target.alpha;

    const age = (now - target.born) / 460;
    if (!reduced && age < 1) {
      ctx.globalAlpha = target.alpha * (1 - age) * 0.7;
      ctx.beginPath();
      ctx.arc(target.x, target.y, base * (0.5 + age * 2.1), 0, TAU);
      ctx.strokeStyle = LIME;
      ctx.lineWidth = 3 * (1 - age) + 0.6;
      ctx.stroke();
      ctx.globalAlpha = target.alpha;
    }

    ctx.translate(target.x, target.y);
    ctx.scale(0.62 + 0.38 * closing, 0.62 + 0.38 * closing);

    ctx.beginPath();
    ctx.arc(0, 0, base * (1 + pulse), 0, TAU);
    ctx.fillStyle = "rgba(216, 253, 113, 0.5)";
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, base * 0.24, 0, TAU);
    ctx.fillStyle = INK;
    ctx.fill();

    ctx.restore();
  }

  drawApple(now) {
    if (!this.apple || this.apple.alpha <= 0.01) return;
    const ctx = this.ctx;
    const age = clamp((now - this.apple.born) / 380, 0, 1);
    const pop = 1 + 2.4 * Math.pow(age - 1, 3) + 1.4 * Math.pow(age - 1, 2);
    const pulse = this.reducedMotion.matches ? 0 : Math.sin(now / 300 + this.apple.seed) * 0.035;
    const bob = this.reducedMotion.matches ? 0 : Math.sin(now / 460 + this.apple.seed) * 1.6;
    const scale = Math.max(0, pop * (1 + pulse));
    const radius = this.cfg.appleRadius;

    ctx.save();
    ctx.globalAlpha = this.apple.alpha;
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
