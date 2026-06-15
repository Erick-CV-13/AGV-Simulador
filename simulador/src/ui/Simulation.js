/**
 * Simulation — Motor principal (Sprints 1–6)
 * Game loop, pipeline de colisiones jerárquico, métricas,
 * modo caos, exportación y viewports múltiples.
 */
class Simulation {
  constructor() {
    // ── Mapa ─────────────────────────────────────────────────────────────────
    this.map = new OccupancyMap(256, 192, 0.05);
    this.map.generateWarehouse();

    // ── Renderer ──────────────────────────────────────────────────────────────
    const canvas = document.getElementById('canvas-main');
    this.renderer = new Renderer(canvas, this.map);

    // ── Pathfinding ───────────────────────────────────────────────────────────
    this.astar = new AStar(this.map, 0);

    // ── Spatial Grid ──────────────────────────────────────────────────────────
    this.spatialGrid = new SpatialGrid(this.map.widthM, this.map.heightM, 1.5);

    // ── Estado global ─────────────────────────────────────────────────────────
    this.state = {
      robots:        [],
      selectedRobot: null,
      spatialGrid:   this.spatialGrid,
      showAABB:      true,
      showOBB:       true,
      showRays:      true,
      showPaths:     true,
      showSplines:   true,
      showGrid:      false,
      showFrustum:   false,
      showMTV:       true,
      frustumMargin: 50,
      astar:         this.astar,
      astarStepMode: false
    };

    // ── Parámetros ────────────────────────────────────────────────────────────
    this.running           = false;
    this.simSpeed          = 1;
    this.restitution       = 0.3;
    this.useSpatialGrid    = true;
    this.useFrustumCulling = true;
    this.drawTool          = 'none';

    // Viewports (Sprint 5)
    this.showSecondary = false;
    this.showThird     = false;
    this.showFourth    = false;

    // ── Métricas ──────────────────────────────────────────────────────────────
    this._resetMetrics();
    this._fpsSmooth        = 60;
    this._lastTime         = performance.now();
    this._simTimeSec       = 0;   // tiempo simulado en segundos (escalado por simSpeed)
    this._destReachedTotal = 0;

    // ── Gráficos ──────────────────────────────────────────────────────────────
    this.fpsGraph        = new FpsGraph(document.getElementById('fps-graph'),        'FPS', '#00d4aa', 65);
    this.pipelineGraph   = new FpsGraph(document.getElementById('pipeline-graph'),   'ms',  '#ff7c2a', 16);
    this.collisionsGraph = new FpsGraph(document.getElementById('collisions-graph'), 'Col', '#ff7c2a', 200);

    // ── Log de replanificaciones ──────────────────────────────────────────────
    this._replanLog = [];

    // ── Handles de intervalos ─────────────────────────────────────────────────
    this._chaosMode         = false;
    this._chaosInterval     = null;
    this._astarStepInterval = null;

    // ── UI ────────────────────────────────────────────────────────────────────
    this.ui = new UI(this);

    window.addEventListener('resize', () => this.renderer.resize());
    this.spawnRobots(5);
    this._loop();
  }

  // ─── Métricas ─────────────────────────────────────────────────────────────

  _resetMetrics() {
    this.metrics = {
      fps: 60, frame: 0,
      throughput: 0,
      collisionsAvoided: 0,
      collisionsResolved: 0,
      replans: 0,
      pairsAABB: 0,
      pairsSAT: 0,
      collisionMs: 0,
      robotsInFrustum: 0
    };
  }

  // ─── Game Loop ────────────────────────────────────────────────────────────

  _loop() {
    const loop = (now) => {
      requestAnimationFrame(loop);
      const rawDt = Math.min((now - this._lastTime) / 1000, 0.05);
      this._lastTime = now;

      const fps = 1 / (rawDt || 0.016);
      this._fpsSmooth  = this._fpsSmooth * 0.9 + fps * 0.1;
      this.metrics.fps = this._fpsSmooth;

      if (this.running) {
        const dt = rawDt * this.simSpeed;
        this._simTimeSec += dt;
        this._update(dt);
        this.metrics.frame++;
      }

      this._render();
      this._updateUI();
    };
    requestAnimationFrame(loop);
  }

  // ─── Update ───────────────────────────────────────────────────────────────

  _update(dt) {
    for (const r of this.state.robots) {
      r.update(dt, this.map);

      if (r.state === 'replanning' && r.replanCooldown <= 0) {
        this._planRobot(r);
      }

      if (document.getElementById('show-rays')?.checked) {
        r._lastRay = Raycast.cast(this.map, r.x, r.y, r.destX, r.destY);
      }

      if (r.state === 'arrived') {
        r.state = 'idle';
        this._assignRandomDest(r);
      }
    }

    const t0          = performance.now();
    this._collisionPipeline();
    const collisionMs = performance.now() - t0;

    // Suavizado exponencial del tiempo de pipeline
    this.metrics.collisionMs     = collisionMs * 0.2 + this.metrics.collisionMs * 0.8;
    this.metrics.throughput      = (this._destReachedTotal / (this._simTimeSec / 60)) || 0;
    this._destReachedTotal       = this.state.robots.reduce((s, r) => s + r.stats.destinationsReached, 0);
  }

  // ─── Planificación ────────────────────────────────────────────────────────

  /**
   * Ejecuta A* para un robot y asigna la ruta resultante suavizada con spline.
   * @param {Robot} robot
   */
  _planRobot(robot) {
    const t0 = performance.now();
    const clearancePx = Math.round(
      parseFloat(document.getElementById('astar-clearance')?.value ?? 0.3) / this.map.scale
    );
    this.astar.setClearance(clearancePx);

    const path   = this.astar.findPath(robot.x, robot.y, robot.destX, robot.destY);
    const ms     = performance.now() - t0;
    const spline = path.length > 1
      ? Spline.resample(Spline.buildSpline(path, 0.5), 0.15)
      : path;

    robot.setPath(path, spline);

    if (robot.stats.replans > 0) {
      this._addReplanLog(robot, ms);
    }
  }

  _addReplanLog(robot, ms) {
    const entry = {
      time:    this._simTimeSec,
      robotId: robot.id,
      cause:   robot.state === 'replanning' ? 'colisión' : 'ruta',
      ms
    };
    this._replanLog.push(entry);
    this.ui.addLogEntry(entry);
    this.metrics.replans++;
  }

  // ─── Pipeline de colisiones ───────────────────────────────────────────────

  /**
   * Orquesta el pipeline completo: frustum culling → fase amplia → fase estrecha.
   * Sprint 6: extraído en métodos _broadPhase y _narrowPhase para legibilidad.
   */
  _collisionPipeline() {
    const epsilon = parseFloat(document.getElementById('sat-epsilon')?.value ?? 0.01);
    const active  = this._applyFrustumCulling();
    const pairs   = this._broadPhase(active);
    this._narrowPhase(pairs, epsilon);
  }

  /**
   * Frustum culling: filtra robots cuyo AABB no intersecta el viewport activo.
   * @returns {Robot[]} robots dentro del frustum
   */
  _applyFrustumCulling() {
    const robots = this.state.robots;
    if (!this.useFrustumCulling) {
      this.metrics.robotsInFrustum = robots.length;
      return robots;
    }
    const margin = this.state.frustumMargin || 50;
    const canvas = document.getElementById('canvas-main');
    const W      = canvas.getBoundingClientRect().width;
    const H      = canvas.getBoundingClientRect().height;
    const tl     = this.renderer.canvasToWorld(-margin, -margin);
    const br     = this.renderer.canvasToWorld(W + margin, H + margin);

    const active = robots.filter(r => {
      const aabb = r.getAABB();
      return aabb.maxX >= tl.wx && aabb.minX <= br.wx &&
             aabb.maxY >= tl.wy && aabb.minY <= br.wy;
    });
    this.metrics.robotsInFrustum = active.length;
    return active;
  }

  /**
   * Fase amplia: genera pares candidatos con AABB + grid espacial (o fuerza bruta).
   * @param {Robot[]} active
   * @returns {Array<[Robot, Robot]>} pares candidatos
   */
  _broadPhase(active) {
    let pairs;
    if (this.useSpatialGrid) {
      this.spatialGrid.clear();
      for (const r of active) this.spatialGrid.insert(r);
      pairs = this.spatialGrid.getCandidatePairs();
    } else {
      pairs = [];
      for (let i = 0; i < active.length; i++)
        for (let j = i + 1; j < active.length; j++)
          pairs.push([active[i], active[j]]);
    }
    this.metrics.pairsAABB = pairs.length;
    return pairs;
  }

  /**
   * Fase estrecha: SAT sobre pares candidatos cuyas AABB solapan.
   * Resuelve colisiones con MTV y dispara replanificación.
   * @param {Array<[Robot, Robot]>} pairs
   * @param {number} epsilon - tolerancia angular para fallback AABB
   */
  _narrowPhase(pairs, epsilon) {
    let satCount = 0, colResolved = 0;

    for (const [rA, rB] of pairs) {
      const aabbA = rA.getAABB();
      const aabbB = rB.getAABB();

      if (!AABB.overlap(aabbA, aabbB)) {
        this.metrics.collisionsAvoided++;
        continue;
      }

      satCount++;
      const result = SAT.test(rA, rB, epsilon);
      rA.usingAABBFallback = result.usingFallback;
      rB.usingAABBFallback = result.usingFallback;

      if (result.colliding && result.mtv) {
        colResolved++;
        this._resolveCollision(rA, rB, result.mtv);
      } else {
        this.metrics.collisionsAvoided++;
      }
    }

    this.metrics.pairsSAT          = satCount;
    this.metrics.collisionsResolved += colResolved;
  }

  /**
   * Aplica el MTV para separar dos robots en colisión y dispara replanificación.
   * @param {Robot} rA
   * @param {Robot} rB
   * @param {{ dx: number, dy: number }} mtv
   */
  _resolveCollision(rA, rB, mtv) {
    rA.inCollision      = true;
    rB.inCollision      = true;
    rA.collisionPartner = rB;
    rB.collisionPartner = rA;
    rA.stats.collisions++;
    rB.stats.collisions++;

    const totalMass = rA.mass + rB.mass;
    const ratioA    = rB.mass / totalMass;
    const ratioB    = rA.mass / totalMass;
    const rest      = this.restitution;

    rA.x += mtv.dx * ratioA;   rA.y += mtv.dy * ratioA;
    rB.x -= mtv.dx * ratioB;   rB.y -= mtv.dy * ratioB;

    rA.vx = -rA.vx * rest;     rA.vy = -rA.vy * rest;
    rB.vx = -rB.vx * rest;     rB.vy = -rB.vy * rest;

    rA.mtv = mtv;
    rB.mtv = { dx: -mtv.dx, dy: -mtv.dy };

    if (rA.triggerReplan('collision')) {
      this._planRobot(rA);
      this.metrics.collisionsAvoided++;
    }
    if (rB.triggerReplan('collision')) {
      this._planRobot(rB);
      this.metrics.collisionsAvoided++;
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  _render() {
    this.renderer.render(this.state);

    if (this.showSecondary && this.state.selectedRobot) {
      const sec  = document.getElementById('canvas-secondary');
      const rect = sec.parentElement.getBoundingClientRect();
      sec.width  = rect.width  || 300;
      sec.height = rect.height || 200;
      this.renderer.renderSecondary(sec, this.state.selectedRobot, this.state);
    }

    if (this.showThird) {
      const third  = document.getElementById('canvas-third');
      const rect   = third.parentElement.getBoundingClientRect();
      third.width  = rect.width  || 300;
      third.height = rect.height || 200;
      this.renderer.renderZoom(third, this.state);
    }

    if (this.showFourth) {
      const fourth  = document.getElementById('canvas-fourth');
      const rect    = fourth.parentElement.getBoundingClientRect();
      fourth.width  = rect.width  || 300;
      fourth.height = rect.height || 200;
      this._renderMetricsCanvas(fourth);
    }
  }

  // ─── UI update ────────────────────────────────────────────────────────────

  _updateUI() {
    this.ui.updateMetrics(this.metrics, this._simTimeSec);
    this.fpsGraph.push(this._fpsSmooth);
    this.pipelineGraph.push(this.metrics.collisionMs);
    this.collisionsGraph.push(this.metrics.collisionsResolved);

    if (this.state.selectedRobot) {
      this.ui.updateRobotInfo(this.state.selectedRobot);
    }
  }

  // ─── Control de simulación ────────────────────────────────────────────────

  togglePlay() { this.running = !this.running; }

  step() {
    if (this.running) return;
    const dt = (1 / 60) * this.simSpeed;
    this._simTimeSec += dt;
    this._update(dt);
    this._render();
    this._updateUI();
    this.metrics.frame++;
  }

  reset() {
    this.running = false;
    this._simTimeSec       = 0;
    this._destReachedTotal = 0;
    this._resetMetrics();
    this._replanLog = [];
    document.getElementById('replan-log').innerHTML = '';
    this.state.robots        = [];
    this.state.selectedRobot = null;
    Robot._nextId = 0;
    this.spawnRobots(parseInt(document.getElementById('robot-count').value));
  }

  // ─── Robots ───────────────────────────────────────────────────────────────

  spawnRobots(n, vmax, size) {
    vmax = vmax ?? parseFloat(document.getElementById('robot-speed').value);
    size = size ?? parseFloat(document.getElementById('robot-size').value);
    this.state.robots = [];
    Robot._nextId = 0;

    let placed = 0, attempts = 0;
    while (placed < n && attempts < 5000) {
      attempts++;
      const wx = Math.random() * this.map.widthM  * 0.9 + this.map.widthM  * 0.05;
      const wy = Math.random() * this.map.heightM * 0.9 + this.map.heightM * 0.05;
      if (this.map.isBlockedWorld(wx, wy)) continue;
      this.state.robots.push(new Robot(wx, wy, Math.random() * Math.PI * 2, size, size * 0.65, vmax));
      placed++;
    }

    this.spatialGrid = new SpatialGrid(
      this.map.widthM, this.map.heightM, Math.max(size * 2, 1.0)
    );
    this.state.spatialGrid = this.spatialGrid;
    this.assignRandomDestinations();
  }

  assignRandomDestinations() {
    for (const r of this.state.robots) this._assignRandomDest(r);
  }

  _assignRandomDest(robot) {
    for (let i = 0; i < 500; i++) {
      const wx = Math.random() * this.map.widthM  * 0.9 + this.map.widthM  * 0.05;
      const wy = Math.random() * this.map.heightM * 0.9 + this.map.heightM * 0.05;
      if (!this.map.isBlockedWorld(wx, wy)) {
        robot.setDestination(wx, wy);
        this._planRobot(robot);
        return;
      }
    }
  }

  setRobotDestination(robot, wx, wy) {
    if (this.map.isBlockedWorld(wx, wy)) return;
    robot.setDestination(wx, wy);
    this._planRobot(robot);
  }

  // ─── Modo Caos ────────────────────────────────────────────────────────────

  toggleChaosMode() {
    const btn = document.getElementById('btn-chaos');

    if (this._chaosMode) {
      clearInterval(this._chaosInterval);
      this._chaosMode = false;
      btn.textContent = 'Iniciar Modo Caos';
      document.querySelector('.dot').className = 'dot ' + (this.running ? 'running' : 'paused');
      return;
    }

    this._chaosMode = true;
    btn.textContent = 'Detener Caos';
    document.querySelector('.dot').className   = 'dot chaos';
    document.getElementById('status-label').textContent = 'MODO CAOS';
    this.running = true;

    const threshold = parseInt(document.getElementById('chaos-fps-threshold').value);

    this._chaosInterval = setInterval(() => {
      if (!this._chaosMode) return;
      if (this.state.robots.length >= 50) { this.toggleChaosMode(); return; }

      const sz = parseFloat(document.getElementById('robot-size').value);
      const v  = parseFloat(document.getElementById('robot-speed').value);

      for (let added = 0; added < 5; added++) {
        for (let i = 0; i < 200; i++) {
          const wx = Math.random() * this.map.widthM  * 0.9 + this.map.widthM  * 0.05;
          const wy = Math.random() * this.map.heightM * 0.9 + this.map.heightM * 0.05;
          if (!this.map.isBlockedWorld(wx, wy)) {
            const r = new Robot(wx, wy, Math.random() * Math.PI * 2, sz, sz * 0.65, v);
            this.state.robots.push(r);
            this._assignRandomDest(r);
            break;
          }
        }
      }

      this.spatialGrid       = new SpatialGrid(this.map.widthM, this.map.heightM, Math.max(sz * 2, 1.0));
      this.state.spatialGrid = this.spatialGrid;
      document.getElementById('robot-count').value = this.state.robots.length;

      if (this._fpsSmooth < threshold) {
        this.ui.showChaosReport({
          robots:      this.state.robots.length,
          fps:         this._fpsSmooth,
          collisionMs: this.metrics.collisionMs,
          pairs:       this.metrics.pairsAABB
        });
        this.toggleChaosMode();
      }
    }, 2000);
  }

  // ─── Benchmark ────────────────────────────────────────────────────────────

  runBenchmark() {
    const robots  = this.state.robots;
    const epsilon = parseFloat(document.getElementById('sat-epsilon')?.value ?? 0.01);
    const RUNS    = 10;

    let t0 = performance.now(), aabbPairs = 0, aabbHits = 0;
    for (let run = 0; run < RUNS; run++) {
      for (let i = 0; i < robots.length; i++) {
        for (let j = i + 1; j < robots.length; j++) {
          aabbPairs++;
          if (AABB.overlap(robots[i].getAABB(), robots[j].getAABB())) aabbHits++;
        }
      }
    }
    const aabbMs = (performance.now() - t0) / RUNS;

    t0 = performance.now();
    let satPairs = 0, satHits = 0;
    for (let run = 0; run < RUNS; run++) {
      for (let i = 0; i < robots.length; i++) {
        for (let j = i + 1; j < robots.length; j++) {
          satPairs++;
          if (AABB.overlap(robots[i].getAABB(), robots[j].getAABB())) {
            if (SAT.test(robots[i], robots[j], epsilon).colliding) satHits++;
          }
        }
      }
    }
    const satMs = (performance.now() - t0) / RUNS;

    this.ui.showBenchmark({
      aabbPairs: aabbPairs / RUNS, satPairs: satPairs / RUNS,
      aabbMs, satMs,
      aabbHits: aabbHits / RUNS,  satHits: satHits / RUNS
    });
  }

  // ─── A* paso a paso ───────────────────────────────────────────────────────

  toggleAStarStep() {
    const robot = this.state.selectedRobot || this.state.robots[0];
    if (!robot) return;

    if (this.state.astarStepMode) {
      clearInterval(this._astarStepInterval);
      this.state.astarStepMode = false;
      document.getElementById('astar-step-info').textContent = '';
      return;
    }

    const clearancePx = Math.round(
      parseFloat(document.getElementById('astar-clearance')?.value ?? 0.3) / this.map.scale
    );
    this.astar.setClearance(clearancePx);
    this.astar.initStepMode(robot.x, robot.y, robot.destX, robot.destY);
    this.state.astarStepMode = true;

    this._astarStepInterval = setInterval(() => {
      const st   = this.astar.stepOnce();
      const info = document.getElementById('astar-step-info');
      if (st.done) {
        clearInterval(this._astarStepInterval);
        this.state.astarStepMode = false;
        info.textContent = st.resultPath
          ? `✓ Ruta encontrada: ${st.resultPath.length} pasos`
          : '✗ Sin ruta';
      } else {
        info.textContent = `Open: ${st.openSet.length} | Closed: ${st.closedSet.size}`;
      }
    }, 80);
  }

  // ─── Canvas de métricas (viewport 4) ─────────────────────────────────────

  /**
   * Dibuja las métricas acumuladas directamente sobre un canvas independiente.
   * Útil en el layout de 4 viewports cuando el panel lateral no es visible.
   * @param {HTMLCanvasElement} canvas
   */
  _renderMetricsCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const W   = canvas.width;
    const H   = canvas.height;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#12151c';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#6b7897';
    ctx.font      = '10px Share Tech Mono';
    ctx.textAlign = 'left';
    ctx.fillText('MÉTRICAS ACUMULADAS', 8, 16);

    const rows = [
      ['Destinos/min',   this.metrics.throughput.toFixed(1)],
      ['Col. evitadas',  this.metrics.collisionsAvoided],
      ['Col. resueltas', this.metrics.collisionsResolved],
      ['Replanificac.',  this.metrics.replans],
      ['Pares AABB',     this.metrics.pairsAABB],
      ['Pares SAT',      this.metrics.pairsSAT],
      ['ms colisión',    this.metrics.collisionMs.toFixed(2)],
      ['FPS',            Math.round(this.metrics.fps)],
      ['Tiempo sim.',    this._simTimeSec.toFixed(1) + 's'],
    ];

    rows.forEach(([label, val], i) => {
      const y = 34 + i * 18;
      ctx.fillStyle = '#404862';
      ctx.font      = '10px Share Tech Mono';
      ctx.textAlign = 'left';
      ctx.fillText(label, 8, y);
      ctx.fillStyle = '#00d4aa';
      ctx.textAlign = 'right';
      ctx.fillText(String(val), W - 8, y);
    });
  }

  // ─── Exportación ──────────────────────────────────────────────────────────

  /** Descarga el log de replanificaciones como CSV. */
  exportLog() {
    const header = 'time_s,robot_id,cause,replanning_ms\n';
    const rows   = this._replanLog
      .map(e => `${e.time.toFixed(2)},${e.robotId},${e.cause},${e.ms.toFixed(2)}`)
      .join('\n');
    this._download(new Blob([header + rows], { type: 'text/csv' }),
      'agvsim_replan_log.csv');
  }

  /** Descarga una captura PNG del viewport principal con todos los overlays activos. */
  exportScreenshot() {
    document.getElementById('canvas-main').toBlob(blob => {
      this._download(blob, `agvsim_frame_${this.metrics.frame}.png`);
    });
  }

  /**
   * Descarga la configuración completa de la sesión como JSON reproducible.
   * Incluye mapa, robots, parámetros y métricas acumuladas.
   */
  exportConfig() {
    const config = {
      version:   'sprint6',
      timestamp: new Date().toISOString(),
      map: {
        widthPx:  this.map.widthPx,
        heightPx: this.map.heightPx,
        scale:    this.map.scale,
        grid:     Array.from(this.map.grid)
      },
      robots: this.state.robots.map(r => ({
        id: r.id, x: r.x, y: r.y, angle: r.angle,
        width: r.width, height: r.height, vmax: r.vmax,
        destX: r.destX, destY: r.destY
      })),
      params: {
        satEpsilon:        parseFloat(document.getElementById('sat-epsilon')?.value      ?? 0.01),
        astarClearance:    parseFloat(document.getElementById('astar-clearance')?.value  ?? 0.3),
        replanCooldown:    parseFloat(document.getElementById('replan-cooldown')?.value  ?? 0.5),
        restitution:       this.restitution,
        useSpatialGrid:    this.useSpatialGrid,
        useFrustumCulling: this.useFrustumCulling
      },
      metrics: { ...this.metrics, simTimeSec: this._simTimeSec }
    };
    this._download(
      new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' }),
      'agvsim_config.json'
    );
  }

  /** Helper: crea un enlace temporal y dispara la descarga. */
  _download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
window.addEventListener('load', () => { window._sim = new Simulation(); });