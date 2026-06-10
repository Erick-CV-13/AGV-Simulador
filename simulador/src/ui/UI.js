/**
 * UI — Sprint 5
 * Controlador de la interfaz de usuario.
 * Vincula los controles HTML con el estado de la simulación.
 */
class UI {
  constructor(sim) {
    this.sim = sim;
    this._bindControls();
    this._bindViewports();
    this._bindMapDrawing();
    this._bindKeyboard();
  }

  // ─── Controles principales ────────────────────────────────────────────────

  _bindControls() {
    const sim = this.sim;

    // Play/Pause
    const btnPlay = document.getElementById('btn-play');
    btnPlay.addEventListener('click', () => {
      sim.togglePlay();
      btnPlay.textContent = sim.running ? '⏸' : '▶';
      btnPlay.classList.toggle('primary', !sim.running);
      document.querySelector('.dot').className = 'dot ' + (sim.running ? 'running' : 'paused');
      document.getElementById('status-label').textContent = sim.running ? 'Corriendo' : 'Pausado';
    });

    // Step
    document.getElementById('btn-step').addEventListener('click', () => sim.step());

    // Reset
    document.getElementById('btn-reset').addEventListener('click', () => {
      sim.reset();
      btnPlay.textContent = '▶';
      btnPlay.classList.add('primary');
    });

    // Velocidad
    document.getElementById('sim-speed').addEventListener('change', e => {
      sim.simSpeed = parseFloat(e.target.value);
    });

    // Mapa
    document.getElementById('map-file').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const img = new Image();
        img.onload = () => {
          const thr = parseInt(document.getElementById('threshold').value);
          sim.map.loadFromImage(img, thr);
          sim.renderer.invalidateMapCache();
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });

    document.getElementById('threshold').addEventListener('input', e => {
      document.getElementById('threshold-val').textContent = e.target.value;
    });

    document.getElementById('btn-gen-map').addEventListener('click', () => {
      sim.map.generateWarehouse();
      sim.renderer.invalidateMapCache();
    });

    document.getElementById('btn-clear-obs').addEventListener('click', () => {
      sim.map.grid.fill(0);
      sim.renderer.invalidateMapCache();
    });

    document.getElementById('map-scale').addEventListener('change', e => {
      sim.map.scale = parseFloat(e.target.value);
      sim.astar.clearancePx = Math.round(
        parseFloat(document.getElementById('astar-clearance').value) / sim.map.scale
      );
      sim.renderer._fitMap();
      sim.renderer.invalidateMapCache();
    });

    // Flota
    document.getElementById('btn-spawn').addEventListener('click', () => {
      const n = parseInt(document.getElementById('robot-count').value);
      const v = parseFloat(document.getElementById('robot-speed').value);
      const sz = parseFloat(document.getElementById('robot-size').value);
      sim.spawnRobots(n, v, sz);
    });

    document.querySelectorAll('.btn-template').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('robot-count').value = btn.dataset.n;
        document.getElementById('btn-spawn').click();
      });
    });

    document.getElementById('btn-assign-dest').addEventListener('click', () => {
      sim.assignRandomDestinations();
    });

    // Capas visuales
    const layers = ['show-aabb','show-obb','show-rays','show-paths',
                    'show-splines','show-grid','show-frustum','show-mtv'];
    for (const id of layers) {
      const stateKey = id.replace('show-', 'show').replace(/-./g, c => c[1].toUpperCase());
      document.getElementById(id)?.addEventListener('change', e => {
        sim.state[this._layerId(id)] = e.target.checked;
      });
    }
    // Init state
    document.getElementById('show-matrix')?.addEventListener('change', e => {
      document.getElementById('matrix-panel').style.display = e.target.checked ? '' : 'none';
    });

    // Parámetros
    document.getElementById('restitution').addEventListener('input', e => {
      document.getElementById('restitution-val').textContent = parseFloat(e.target.value).toFixed(2);
      sim.restitution = parseFloat(e.target.value);
    });
    document.getElementById('frustum-margin').addEventListener('input', e => {
      document.getElementById('frustum-margin-val').textContent = e.target.value + 'px';
      sim.state.frustumMargin = parseInt(e.target.value);
    });
    document.getElementById('use-spatial-grid').addEventListener('change', e => {
      sim.useSpatialGrid = e.target.checked;
    });
    document.getElementById('use-frustum-culling').addEventListener('change', e => {
      sim.useFrustumCulling = e.target.checked;
    });
    document.getElementById('astar-clearance').addEventListener('change', e => {
      const px = Math.round(parseFloat(e.target.value) / sim.map.scale);
      sim.astar.setClearance(px);
    });

    // Modo Caos
    document.getElementById('btn-chaos').addEventListener('click', () => sim.toggleChaosMode());

    // Benchmark
    document.getElementById('btn-benchmark').addEventListener('click', () => sim.runBenchmark());

    // Export log
    document.getElementById('btn-export-log').addEventListener('click', () => sim.exportLog());

    // A* paso a paso
    document.getElementById('btn-astar-step').addEventListener('click', () => sim.toggleAStarStep());

    // Sprint 5: exportar PNG y JSON
    document.getElementById('btn-export-png').addEventListener('click',    () => sim.exportScreenshot());
    document.getElementById('btn-export-config').addEventListener('click', () => sim.exportConfig());

    // Sprint 5: presets de capas
    const layerIds = ['show-aabb','show-obb','show-rays','show-paths','show-splines','show-grid','show-frustum','show-mtv'];
    const setLayers = (vals) => layerIds.forEach((id, i) => {
      const el = document.getElementById(id);
      if (el) { el.checked = vals[i]; el.dispatchEvent(new Event('change')); }
    });
    document.getElementById('preset-all').addEventListener('click',   () => setLayers([1,1,1,1,1,0,0,1]));
    document.getElementById('preset-col').addEventListener('click',   () => setLayers([1,1,0,0,0,0,0,1]));
    document.getElementById('preset-route').addEventListener('click', () => setLayers([0,0,1,1,1,0,0,0]));
    document.getElementById('preset-none').addEventListener('click',  () => setLayers([0,0,0,0,0,0,0,0]));
  }

  _layerId(htmlId) {
    return htmlId.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  }

  // ─── Viewports ────────────────────────────────────────────────────────────

  _bindViewports() {
    const sim = this.sim;
    document.getElementById('btn-vp-1').addEventListener('click', () => {
      document.getElementById('vp-secondary').classList.add('hidden');
      document.getElementById('vp-third').classList.add('hidden');
      document.getElementById('vp-fourth').classList.add('hidden');
      document.getElementById('viewport-container').className = 'layout-1';
      ['btn-vp-1','btn-vp-2','btn-vp-4'].forEach(id => document.getElementById(id).classList.remove('active'));
      document.getElementById('btn-vp-1').classList.add('active');
      sim.showSecondary = false;
      sim.showThird     = false;
      sim.showFourth    = false;
    });
    document.getElementById('btn-vp-2').addEventListener('click', () => {
      document.getElementById('vp-secondary').classList.remove('hidden');
      document.getElementById('vp-third').classList.add('hidden');
      document.getElementById('vp-fourth').classList.add('hidden');
      document.getElementById('viewport-container').className = 'layout-2';
      ['btn-vp-1','btn-vp-2','btn-vp-4'].forEach(id => document.getElementById(id).classList.remove('active'));
      document.getElementById('btn-vp-2').classList.add('active');
      sim.showSecondary = true;
      sim.showThird     = false;
      sim.showFourth    = false;
      const sec = document.getElementById('canvas-secondary');
      const rect = sec.parentElement.getBoundingClientRect();
      sec.width = rect.width; sec.height = rect.height;
    });
    document.getElementById('btn-vp-4').addEventListener('click', () => {
      ['btn-vp-1','btn-vp-2','btn-vp-4'].forEach(id => document.getElementById(id).classList.remove('active'));
      document.getElementById('btn-vp-4').classList.add('active');
      document.getElementById('vp-secondary').classList.remove('hidden');
      document.getElementById('vp-third').classList.remove('hidden');
      document.getElementById('vp-fourth').classList.remove('hidden');
      document.getElementById('viewport-container').className = 'layout-4';
      sim.showSecondary = true;
      sim.showThird     = true;
      sim.showFourth    = true;
      // Inicializar canvas secundario
      const sec = document.getElementById('canvas-secondary');
      const rect = sec.parentElement.getBoundingClientRect();
      sec.width = rect.width; sec.height = rect.height;
    });
    // Selección de robot al hacer clic en el canvas
    document.getElementById('canvas-main').addEventListener('click', e => {
      const rect = e.target.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const { wx, wy } = sim.renderer.canvasToWorld(cx, cy);

      // Herramienta de dibujo
      if (sim.drawTool !== 'none') return;

      // Buscar robot más cercano al clic
      let closest = null, minDist = 1.5; // metros
      for (const r of sim.state.robots) {
        const d = Math.hypot(r.x - wx, r.y - wy);
        if (d < minDist) { minDist = d; closest = r; }
      }

      if (closest) {
        sim.state.selectedRobot = closest;
        this.updateRobotInfo(closest);
      } else {
        // Si hay robot seleccionado, asignar destino
        if (sim.state.selectedRobot) {
          sim.setRobotDestination(sim.state.selectedRobot, wx, wy);
        } else {
          sim.state.selectedRobot = null;
          document.getElementById('robot-info').innerHTML = '<p class="muted">Haz clic en un robot</p>';
        }
      }
    });
  }

  // ─── Dibujo de mapa ───────────────────────────────────────────────────────

  _bindMapDrawing() {
    const sim = this.sim;
    let painting = false;

    document.getElementById('tool-draw').addEventListener('click', e => {
      sim.drawTool = 'draw';
      e.target.classList.add('active');
      document.getElementById('tool-erase').classList.remove('active');
    });
    document.getElementById('tool-erase').addEventListener('click', e => {
      sim.drawTool = 'erase';
      e.target.classList.add('active');
      document.getElementById('tool-draw').classList.remove('active');
    });

    const canvas = document.getElementById('canvas-main');
    const paint = (e) => {
      if (!painting) return;
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const { wx, wy } = sim.renderer.canvasToWorld(cx, cy);
      const { px, py } = sim.map.mundoAPixel(wx, wy);
      const radius = parseInt(document.getElementById('brush-size').value);
      const val = sim.drawTool === 'draw' ? 1 : 0;
      sim.map.paintCircle(px, py, radius, val);
      sim.renderer.invalidateMapCache();
    };

    canvas.addEventListener('mousedown', e => {
      if (e.button === 0 && sim.drawTool !== 'none') { painting = true; paint(e); }
    });
    window.addEventListener('mousemove', paint);
    window.addEventListener('mouseup', () => { painting = false; });
  }

  // ─── Teclado ──────────────────────────────────────────────────────────────

  _bindKeyboard() {
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      const sim = this.sim;
      switch(e.code) {
        case 'Space':  e.preventDefault(); document.getElementById('btn-play').click(); break;
        case 'KeyF':   sim.step(); break;
        case 'KeyR':   document.getElementById('btn-reset').click(); break;
        case 'Escape': sim.state.selectedRobot = null; break;
      }
    });
  }

  // ─── Actualizar info robot ────────────────────────────────────────────────

  updateRobotInfo(robot) {
    const el = document.getElementById('robot-info');
    if (!robot) { el.innerHTML = '<p class="muted">Haz clic en un robot</p>'; return; }
    const row = (k, v) => `<div class="info-row"><span class="info-key">${k}</span><span class="info-val">${v}</span></div>`;
    el.innerHTML = `
      ${row('ID', `#${robot.id}`)}
      ${row('Estado', robot.state)}
      ${row('Pos. X', robot.x.toFixed(2) + 'm')}
      ${row('Pos. Y', robot.y.toFixed(2) + 'm')}
      ${row('Ángulo', (robot.angle * 180 / Math.PI).toFixed(1) + '°')}
      ${row('Vel. X', robot.vx.toFixed(2) + 'm/s')}
      ${row('Vel. Y', robot.vy.toFixed(2) + 'm/s')}
      ${row('Dist.', robot.stats.distanceTraveled.toFixed(1) + 'm')}
      ${row('Replans', robot.stats.replans)}
      ${row('Colisiones', robot.stats.collisions)}
      ${row('Destinos', robot.stats.destinationsReached)}
      ${row('AABB fallback', robot.usingAABBFallback ? 'Sí' : 'No')}
    `;

    if (document.getElementById('show-matrix')?.checked) {
      document.getElementById('matrix-display').textContent = robot.getMatrixDisplay();
    }
  }

  // ─── Actualizar métricas ──────────────────────────────────────────────────

  updateMetrics(metrics, simTimeSec = 0) {
    document.getElementById('m-throughput').textContent         = metrics.throughput.toFixed(1);
    document.getElementById('m-collisions-avoided').textContent = metrics.collisionsAvoided;
    document.getElementById('m-collisions-resolved').textContent= metrics.collisionsResolved;
    document.getElementById('m-replans').textContent            = metrics.replans;
    document.getElementById('m-pairs-aabb').textContent         = metrics.pairsAABB;
    document.getElementById('m-pairs-sat').textContent          = metrics.pairsSAT;
    document.getElementById('m-collision-ms').textContent       = metrics.collisionMs.toFixed(2);
    document.getElementById('m-robots-frustum').textContent     = metrics.robotsInFrustum;
    document.getElementById('fps-value').textContent            = Math.round(metrics.fps);
    document.getElementById('frame-value').textContent          = metrics.frame;
    // Sprint 5: tiempo simulado
    const el = document.getElementById('m-sim-time');
    if (el) el.textContent = simTimeSec.toFixed(1) + 's';
    const el2 = document.getElementById('sim-time-display');
    if (el2) el2.textContent = simTimeSec.toFixed(1) + 's';
  }

  // ─── Log de replanificación ───────────────────────────────────────────────

  addLogEntry(entry) {
    const log = document.getElementById('replan-log');
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.innerHTML = `<span class="t">[${entry.time.toFixed(1)}s]</span> ` +
      `<span class="robot-id">R#${entry.robotId}</span> ` +
      `<span class="${entry.cause === 'collision' ? 'cause-col' : 'cause-route'}">${entry.cause}</span> ` +
      `${entry.ms.toFixed(1)}ms`;
    log.prepend(div);
    // Limitar a 50 entradas
    while (log.children.length > 50) log.removeChild(log.lastChild);
  }

  // ─── Reporte de caos ─────────────────────────────────────────────────────

  showChaosReport(report) {
    const el = document.getElementById('chaos-report');
    el.classList.remove('hidden');
    el.innerHTML = `⚠ LÍMITE ALCANZADO\n` +
      `Robots: ${report.robots}\n` +
      `FPS: ${report.fps.toFixed(1)}\n` +
      `ms/frame col.: ${report.collisionMs.toFixed(2)}\n` +
      `Pares eval.: ${report.pairs}`;
    document.querySelector('.dot').className = 'dot';
    document.getElementById('status-label').textContent = 'Límite alcanzado';
  }

  // ─── Benchmark ────────────────────────────────────────────────────────────

  showBenchmark(result) {
    const el = document.getElementById('benchmark-result');
    const row = (label, v1, v2, lowerBetter = true) => {
      const good = lowerBetter ? v1 <= v2 : v1 >= v2;
      return `<div class="bench-row">
        <span class="bench-label">${label}</span>
        <span class="${good ? 'bench-val-good' : 'bench-val-bad'}">${typeof v1 === 'number' ? v1.toFixed(2) : v1}</span>
        <span>${typeof v2 === 'number' ? v2.toFixed(2) : v2}</span>
      </div>`;
    };
    el.innerHTML = `
      <div class="bench-row" style="color:var(--text-dim);font-size:9px;margin-bottom:4px">
        <span>Métrica</span><span>AABB</span><span>AABB+SAT</span>
      </div>
      ${row('Pares eval.', result.aabbPairs, result.satPairs)}
      ${row('ms/frame', result.aabbMs, result.satMs)}
      ${row('Col. detectadas', result.aabbHits, result.satHits, false)}
    `;
  }
}
