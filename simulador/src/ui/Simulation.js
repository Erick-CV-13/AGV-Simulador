/**
 * Simulation — Motor principal
 * Game loop, pipeline de colisiones, métricas, modo caos.
 */
class Simulation {
  constructor() {
    // ── Mapa ────────────────────────────────────────────────────────────────
    this.map = new OccupancyMap(256, 192, 0.05);
    this.map.generateWarehouse();

    // ── Renderer ─────────────────────────────────────────────────────────────
    const canvas = document.getElementById('canvas-main');
    this.renderer = new Renderer(canvas, this.map);

    // ── Pathfinding ──────────────────────────────────────────────────────────
    this.astar = new AStar(this.map, 0);

    // ── Spatial Grid ─────────────────────────────────────────────────────────
    this.spatialGrid = new SpatialGrid(this.map.widthM, this.map.heightM, 1.5);

    // ── Estado global ────────────────────────────────────────────────────────
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

    // ── Parámetros ───────────────────────────────────────────────────────────
    this.running         = false;
    this.simSpeed        = 1;
    this.restitution     = 0.3;
    this.useSpatialGrid  = true;
    this.useFrustumCulling = true;
    this.drawTool        = 'none';
    this.showSecondary   = false;
    this.showThird   = false;   // zoom fijo en robot
    this.showFourth  = false;   // canvas de métricas acumuladas
    this._simTimeSec = 0;       // tiempo total de simulación en segundos

    // ── Métricas ─────────────────────────────────────────────────────────────
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
    this._fpsSmooth = 60;
    this._lastTime  = performance.now();
    this._simTime   = 0;
    this._destReachedTotal = 0;
    this._simStartTime = performance.now();

    // ── Gráficos ─────────────────────────────────────────────────────────────
    this.fpsGraph      = new FpsGraph(document.getElementById('fps-graph'),      'FPS',  '#00d4aa', 65);
    this.pipelineGraph = new FpsGraph(document.getElementById('pipeline-graph'), 'ms',   '#ff7c2a', 16);
    this.collisionsGraph = new FpsGraph(document.getElementById('collisions-graph'), 'Col', '#ff7c2a', 200);

    // ── Log ──────────────────────────────────────────────────────────────────
    this._replanLog = [];

    // ── Modo Caos ─────────────────────────────────────────────────────────────
    this._chaosMode    = false;
    this._chaosInterval = null;

    // ── A* paso a paso ────────────────────────────────────────────────────────
    this._astarStepInterval = null;

    // ── UI ───────────────────────────────────────────────────────────────────
    this.ui = new UI(this);

    // ── Resize ────────────────────────────────────────────────────────────────
    window.addEventListener('resize', () => this.renderer.resize());

    // Spawn inicial
    this.spawnRobots(5);
    this._loop();
  }

  // ─── Game Loop ────────────────────────────────────────────────────────────

  _loop() {
    const loop = (now) => {
      requestAnimationFrame(loop);
      const rawDt = Math.min((now - this._lastTime) / 1000, 0.05);
      this._lastTime = now;

      // FPS
      const fps = 1 / (rawDt || 0.016);
      this._fpsSmooth = this._fpsSmooth * 0.9 + fps * 0.1;
      this.metrics.fps = this._fpsSmooth;

      if (this.running) {
        const dt = rawDt * this.simSpeed;
        this._simTime += dt;
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
    this._simTimeSec += dt;
    const robots = this.state.robots;

    // 1) Actualizar posición de cada robot
    for (const r of robots) {
      r.update(dt, this.map);

      // Planificación: si está en estado replanning, ejecutar A*
      if (r.state === 'replanning' && r.replanCooldown <= 0) {
        this._planRobot(r);
      }

      // Rayo de planificación
      if (document.getElementById('show-rays')?.checked) {
        r._lastRay = Raycast.cast(this.map, r.x, r.y, r.destX, r.destY);
      }

      // Si llegó, puede recibir nuevo destino (modo ciclo continuo)
      if (r.state === 'arrived') {
        r.state = 'idle';
        // Asignar destino aleatorio automáticamente
        this._assignRandomDest(r);
      }
    }

    // 2) Pipeline de colisiones
    const t0 = performance.now();
    this._collisionPipeline(dt);
    const collisionMs = performance.now() - t0;

    // Métricas
    this.metrics.collisionMs = collisionMs * 0.2 + this.metrics.collisionMs * 0.8;
    this.metrics.throughput  =
      (this._destReachedTotal / (this._simTime / 60)) || 0;

    // Contar destinos alcanzados
    let total = 0;
    for (const r of robots) total += r.stats.destinationsReached;
    this._destReachedTotal = total;
  }

  // ─── Planificación ────────────────────────────────────────────────────────

  _planRobot(robot) {
    const t0 = performance.now();
    const clearancePx = Math.round(
      parseFloat(document.getElementById('astar-clearance')?.value ?? 0.3) / this.map.scale
    );
    this.astar.setClearance(clearancePx);

    const path = this.astar.findPath(robot.x, robot.y, robot.destX, robot.destY);
    const ms   = performance.now() - t0;

    const tension = 0.5;
    const spline  = path.length > 1
      ? Spline.resample(Spline.buildSpline(path, tension), 0.15)
      : path;

    robot.setPath(path, spline);

    if (robot.stats.replans > 0) {
      this._addReplanLog(robot, ms);
    }
  }

  _addReplanLog(robot, ms) {
    const entry = {
      time:    this._simTime,
      robotId: robot.id,
      cause:   robot.state === 'replanning' ? 'colisión' : 'ruta',
      ms
    };
    this._replanLog.push(entry);
    this.ui.addLogEntry(entry);
    this.metrics.replans++;
  }

  // ─── Pipeline de colisiones ────────────────────────────────────────────────

  _collisionPipeline(dt) {
    const robots  = this.state.robots;
    const epsilon = parseFloat(document.getElementById('sat-epsilon')?.value ?? 0.01);

    // ── Frustum culling ──────────────────────────────────────────────────────
    let active = robots;
    if (this.useFrustumCulling) {
      const margin = (this.state.frustumMargin || 50);
      const canvas = document.getElementById('canvas-main');
      const W = canvas.getBoundingClientRect().width;
      const H = canvas.getBoundingClientRect().height;
      const tl = this.renderer.canvasToWorld(-margin, -margin);
      const br = this.renderer.canvasToWorld(W + margin, H + margin);
      active = robots.filter(r => {
        const aabb = r.getAABB();
        return aabb.maxX >= tl.wx && aabb.minX <= br.wx &&
               aabb.maxY >= tl.wy && aabb.minY <= br.wy;
      });
      this.metrics.robotsInFrustum = active.length;
    } else {
      this.metrics.robotsInFrustum = robots.length;
    }

    // ── Fase amplia: AABB ─────────────────────────────────────────────────────
    let candidatePairs;
    if (this.useSpatialGrid) {
      this.spatialGrid.clear();
      for (const r of active) this.spatialGrid.insert(r);
      candidatePairs = this.spatialGrid.getCandidatePairs();
    } else {
      // O(n²) brute force
      candidatePairs = [];
      for (let i = 0; i < active.length; i++)
        for (let j = i + 1; j < active.length; j++)
          candidatePairs.push([active[i], active[j]]);
    }

    this.metrics.pairsAABB = candidatePairs.length;

    let satCount = 0, colAvoided = 0, colResolved = 0;

    for (const [rA, rB] of candidatePairs) {
      const aabbA = rA.getAABB();
      const aabbB = rB.getAABB();

      if (!AABB.overlap(aabbA, aabbB)) {
        colAvoided++;
        continue;
      }

      // ── Fase estrecha: SAT ───────────────────────────────────────────────
      satCount++;
      const result = SAT.test(rA, rB, epsilon);

      rA.usingAABBFallback = result.usingFallback;
      rB.usingAABBFallback = result.usingFallback;

      if (result.colliding && result.mtv) {
        colResolved++;
        rA.inCollision = true;
        rB.inCollision = true;
        rA.collisionPartner = rB;
        rB.collisionPartner = rA;
        rA.stats.collisions++;
        rB.stats.collisions++;

        // ── Resolución por MTV ───────────────────────────────────────────────
        const totalMass = rA.mass + rB.mass;
        const ratioA = rB.mass / totalMass;
        const ratioB = rA.mass / totalMass;
        const rest   = this.restitution;

        rA.x += result.mtv.dx * ratioA;
        rA.y += result.mtv.dy * ratioA;
        rB.x -= result.mtv.dx * ratioB;
        rB.y -= result.mtv.dy * ratioB;

        // Amortiguación de velocidad
        rA.vx = -rA.vx * rest;  rA.vy = -rA.vy * rest;
        rB.vx = -rB.vx * rest;  rB.vy = -rB.vy * rest;

        rA.mtv = result.mtv;
        rB.mtv = { dx: -result.mtv.dx, dy: -result.mtv.dy };

        // Trigger replanificación
        if (rA.triggerReplan('collision')) {
          this._planRobot(rA);
          this.metrics.collisionsAvoided++;
        }
        if (rB.triggerReplan('collision')) {
          this._planRobot(rB);
          this.metrics.collisionsAvoided++;
        }
      } else {
        this.metrics.collisionsAvoided++;
      }
    }

    this.metrics.pairsSAT = satCount;
    this.metrics.collisionsResolved += colResolved;
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  _render() {
    this.renderer.render(this.state);

    if (this.showSecondary && this.state.selectedRobot) {
      const sec = document.getElementById('canvas-secondary');
      this.renderer.renderSecondary(sec, this.state.selectedRobot, this.state);
    }

    if (this.showThird) {
      const third = document.getElementById('canvas-third');
      const rect  = third.parentElement.getBoundingClientRect();
      third.width  = rect.width  || 300;
      third.height = rect.height || 200;
      this.renderer.renderZoom(third, this.state);
    }

    if (this.showFourth) {
      const fourth = document.getElementById('canvas-fourth');
      const rect   = fourth.parentElement.getBoundingClientRect();
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

  // ─── Control ─────────────────────────────────────────────────────────────

  togglePlay() {
    this.running = !this.running;
  }

  step() {
    if (!this.running) {
      const dt = (1 / 60) * this.simSpeed;
      this._update(dt);
      this._render();
      this._updateUI();
      this.metrics.frame++;
    }
  }

  reset() {
    this.running = false;
    this._simTime = 0;
    this._destReachedTotal = 0;
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
    this._simTimeSec = 0;
    this._replanLog = [];
    document.getElementById('replan-log').innerHTML = '';
    this.state.robots = [];
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
      const wx = Math.random() * this.map.widthM * 0.9 + this.map.widthM * 0.05;
      const wy = Math.random() * this.map.heightM * 0.9 + this.map.heightM * 0.05;
      if (this.map.isBlockedWorld(wx, wy)) continue;
      const angle = Math.random() * Math.PI * 2;
      const r = new Robot(wx, wy, angle, size, size * 0.65, vmax);
      this.state.robots.push(r);
      placed++;
    }

    this.spatialGrid = new SpatialGrid(
      this.map.widthM, this.map.heightM,
      Math.max(size * 2, 1.0)
    );
    this.state.spatialGrid = this.spatialGrid;
    this.assignRandomDestinations();
  }

  assignRandomDestinations() {
    for (const r of this.state.robots) this._assignRandomDest(r);
  }

  _assignRandomDest(robot) {
    let attempts = 0;
    while (attempts++ < 500) {
      const wx = Math.random() * this.map.widthM * 0.9 + this.map.widthM * 0.05;
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
    document.querySelector('.dot').className = 'dot chaos';
    document.getElementById('status-label').textContent = 'MODO CAOS';
    this.running = true;

    const threshold = parseInt(document.getElementById('chaos-fps-threshold').value);

    this._chaosInterval = setInterval(() => {
      if (!this._chaosMode) return;

      // Agregar 5 robots más
      const n = this.state.robots.length + 5;
      if (n > 50) {
        this.toggleChaosMode();
        return;
      }

      const sz = parseFloat(document.getElementById('robot-size').value);
      const v  = parseFloat(document.getElementById('robot-speed').value);
      let added = 0;
      for (let i = 0; i < 5 && added < 5; i++) {
        let attempts = 0;
        while (attempts++ < 200) {
          const wx = Math.random() * this.map.widthM * 0.9 + this.map.widthM * 0.05;
          const wy = Math.random() * this.map.heightM * 0.9 + this.map.heightM * 0.05;
          if (!this.map.isBlockedWorld(wx, wy)) {
            const r = new Robot(wx, wy, Math.random() * Math.PI * 2, sz, sz * 0.65, v);
            this.state.robots.push(r);
            this._assignRandomDest(r);
            added++;
            break;
          }
        }
      }

      // Actualizar grid
      this.spatialGrid = new SpatialGrid(this.map.widthM, this.map.heightM, Math.max(sz * 2, 1.0));
      this.state.spatialGrid = this.spatialGrid;
      document.getElementById('robot-count').value = this.state.robots.length;

      // Detectar degradación
      if (this._fpsSmooth < threshold) {
        this.ui.showChaosReport({
          robots: this.state.robots.length,
          fps: this._fpsSmooth,
          collisionMs: this.metrics.collisionMs,
          pairs: this.metrics.pairsAABB
        });
        this.toggleChaosMode();
      }
    }, 2000);
  }

  // ─── Benchmark ────────────────────────────────────────────────────────────

  runBenchmark() {
    const robots = this.state.robots;
    const epsilon = parseFloat(document.getElementById('sat-epsilon')?.value ?? 0.01);
    const RUNS = 10;

    // AABB-only
    let t0 = performance.now();
    let aabbPairs = 0, aabbHits = 0;
    for (let r = 0; r < RUNS; r++) {
      for (let i = 0; i < robots.length; i++) {
        for (let j = i + 1; j < robots.length; j++) {
          aabbPairs++;
          if (AABB.overlap(robots[i].getAABB(), robots[j].getAABB())) aabbHits++;
        }
      }
    }
    const aabbMs = (performance.now() - t0) / RUNS;

    // AABB+SAT
    t0 = performance.now();
    let satPairs = 0, satHits = 0;
    for (let r = 0; r < RUNS; r++) {
      for (let i = 0; i < robots.length; i++) {
        for (let j = i + 1; j < robots.length; j++) {
          satPairs++;
          if (AABB.overlap(robots[i].getAABB(), robots[j].getAABB())) {
            const res = SAT.test(robots[i], robots[j], epsilon);
            if (res.colliding) satHits++;
          }
        }
      }
    }
    const satMs = (performance.now() - t0) / RUNS;

    this.ui.showBenchmark({
      aabbPairs: aabbPairs / RUNS,
      satPairs: satPairs / RUNS,
      aabbMs, satMs,
      aabbHits: aabbHits / RUNS,
      satHits: satHits / RUNS
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
      const st = this.astar.stepOnce();
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

  // ─── Sprint 5: canvas de métricas acumuladas ──────────────────────────────

  _renderMetricsCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#12151c';
    ctx.fillRect(0, 0, W, H);

    // Título
    ctx.fillStyle = '#6b7897';
    ctx.font = '10px Share Tech Mono';
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
    ];

    rows.forEach(([label, val], i) => {
      const y = 34 + i * 18;
      ctx.fillStyle = '#404862';
      ctx.font = '10px Share Tech Mono';
      ctx.textAlign = 'left';
      ctx.fillText(label, 8, y);
      ctx.fillStyle = '#00d4aa';
      ctx.textAlign = 'right';
      ctx.fillText(String(val), W - 8, y);
    });
  }

  // ─── Sprint 5: renderZoom (tercer viewport) ───────────────────────────────

  // (delegado al Renderer — ver Renderer.js)

  // ─── Sprint 5: exportar PNG del viewport ─────────────────────────────────

  exportScreenshot() {
    const canvas = document.getElementById('canvas-main');
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href = url;
      a.download = `agvsim_frame_${this.metrics.frame}.png`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  // ─── Sprint 5: exportar configuración completa a JSON ────────────────────

  exportConfig() {
    const config = {
      version: 'sprint5',
      timestamp: new Date().toISOString(),
      map: {
        widthPx:  this.map.widthPx,
        heightPx: this.map.heightPx,
        scale:    this.map.scale,
        grid:     Array.from(this.map.grid)
      },
      robots: this.state.robots.map(r => ({
        id:    r.id,
        x:     r.x,
        y:     r.y,
        angle: r.angle,
        width: r.width,
        height: r.height,
        vmax:  r.vmax,
        destX: r.destX,
        destY: r.destY
      })),
      params: {
        satEpsilon:      parseFloat(document.getElementById('sat-epsilon')?.value  ?? 0.01),
        astarClearance:  parseFloat(document.getElementById('astar-clearance')?.value ?? 0.3),
        replanCooldown:  parseFloat(document.getElementById('replan-cooldown')?.value ?? 0.5),
        restitution:     this.restitution,
        useSpatialGrid:  this.useSpatialGrid,
        useFrustumCulling: this.useFrustumCulling
      },
      metrics: { ...this.metrics, simTimeSec: this._simTimeSec }
    };

    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = 'agvsim_config.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─── Export ───────────────────────────────────────────────────────────────

  exportLog() {
    const header = 'time_s,robot_id,cause,replanning_ms\n';
    const rows = this._replanLog.map(e =>
      `${e.time.toFixed(2)},${e.robotId},${e.cause},${e.ms.toFixed(2)}`
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'agvsim_replan_log.csv';
    a.click(); URL.revokeObjectURL(url);
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
window.addEventListener('load', () => {
  window._sim = new Simulation();
});
