/**
 * Renderer — Sprints 1–6
 * Renderizador principal del simulador.
 * Transforma coordenadas mundo → píxel canvas y dibuja todos los elementos.
 * Soporta hasta 4 viewports simultáneos con transformaciones independientes.
 */
class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas - canvas principal
   * @param {OccupancyMap} map
   */
  constructor(canvas, map) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.map    = map;

    /** @type {number} Factor de zoom del viewport principal */
    this.zoom = 1;
    /** @type {number} Desplazamiento X del viewport principal */
    this.panX = 0;
    /** @type {number} Desplazamiento Y del viewport principal */
    this.panY = 0;

    this._mapCache      = null;
    this._mapCacheDirty = true;

    this._setupInput();
    this.resize();
  }

  // ─── Ciclo de vida ────────────────────────────────────────────────────────

  /** Ajusta el canvas al tamaño real del contenedor respetando DPR. */
  resize() {
    const dpr  = window.devicePixelRatio || 1;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width        = rect.width  * dpr;
    this.canvas.height       = rect.height * dpr;
    this.canvas.style.width  = rect.width  + 'px';
    this.canvas.style.height = rect.height + 'px';
    this.ctx.scale(dpr, dpr);
    this.W = rect.width;
    this.H = rect.height;
    this._mapCacheDirty = true;
    this._fitMap();
  }

  /** Calcula zoom y pan para encuadrar el mapa completo en el viewport. */
  _fitMap() {
    const mapW = this.map.widthPx;
    const mapH = this.map.heightPx;
    this.zoom = Math.min(this.W / mapW, this.H / mapH) * 0.95;
    this.panX = (this.W - mapW * this.zoom) / 2;
    this.panY = (this.H - mapH * this.zoom) / 2;
  }

  /** Marca el caché del mapa como inválido para reconstruirlo en el siguiente frame. */
  invalidateMapCache() { this._mapCacheDirty = true; }

  // ─── Transformaciones window-viewport ─────────────────────────────────────

  /**
   * Convierte coordenadas mundo (metros) a píxeles del canvas principal.
   * @param {number} wx
   * @param {number} wy
   * @returns {{ cx: number, cy: number }}
   */
  worldToCanvas(wx, wy) {
    const s = 1 / this.map.scale;
    return {
      cx: wx * s * this.zoom + this.panX,
      cy: wy * s * this.zoom + this.panY
    };
  }

  /**
   * Convierte píxeles del canvas principal a coordenadas mundo (metros).
   * @param {number} cx
   * @param {number} cy
   * @returns {{ wx: number, wy: number }}
   */
  canvasToWorld(cx, cy) {
    const s = 1 / this.map.scale;
    return {
      wx: ((cx - this.panX) / this.zoom) / s,
      wy: ((cy - this.panY) / this.zoom) / s
    };
  }

  /**
   * Convierte píxeles del canvas a píxel de la grilla del mapa.
   * @param {number} cx
   * @param {number} cy
   * @returns {{ px: number, py: number }}
   */
  canvasToMapPixel(cx, cy) {
    const { wx, wy } = this.canvasToWorld(cx, cy);
    return this.map.mundoAPixel(wx, wy);
  }

  // ─── Render principal (viewport 1) ────────────────────────────────────────

  /**
   * Renderiza un frame completo en el viewport principal.
   * @param {object} state - estado global de la simulación
   */
  render(state) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);

    ctx.save();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);

    this._drawMap();
    this._drawSpatialGrid(state);
    this._drawFrustum(state);

    for (const robot of state.robots) {
      this._drawRobotPath(robot, state);
      this._drawRobotRay(robot, state);
      this._drawRobotGeometry(robot, state);
      this._drawRobotBody(robot, state);
    }

    if (state.astar && state.astarStepMode) {
      state.astar.drawStepState(ctx, this.map);
    }

    ctx.restore();
    this._drawHUD();
  }

  // ─── Caché del mapa ───────────────────────────────────────────────────────

  _drawMap() {
    if (this._mapCacheDirty) {
      this._buildMapCache();
      this._mapCacheDirty = false;
    }
    this.ctx.drawImage(this._mapCache, 0, 0);
  }

  _buildMapCache() {
    const W = this.map.widthPx, H = this.map.heightPx;
    const offC   = document.createElement('canvas');
    offC.width   = W;
    offC.height  = H;
    const offCtx = offC.getContext('2d');
    const imgData = offCtx.createImageData(W, H);
    const data    = imgData.data;

    for (let i = 0; i < W * H; i++) {
      const blocked = this.map.grid[i] === 1;
      const base    = i * 4;
      if (blocked) {
        data[base] = 42; data[base+1] = 50; data[base+2] = 70;
      } else {
        data[base] = 20; data[base+1] = 24; data[base+2] = 36;
      }
      data[base+3] = 255;
    }

    offCtx.putImageData(imgData, 0, 0);
    this._mapCache = offC;
  }

  // ─── Overlays del viewport principal ─────────────────────────────────────

  _drawSpatialGrid(state) {
    if (!state.showGrid || !state.spatialGrid) return;
    state.spatialGrid.draw(this.ctx, this.map, true);
  }

  _drawFrustum(state) {
    if (!state.showFrustum) return;
    const margin = state.frustumMargin || 50;
    const { wx: x0, wy: y0 } = this.canvasToWorld(-margin, -margin);
    const { wx: x1, wy: y1 } = this.canvasToWorld(this.W + margin, this.H + margin);
    const s = 1 / this.map.scale;

    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(255,124,42,0.5)';
    this.ctx.lineWidth   = 1 / this.zoom;
    this.ctx.setLineDash([6, 4]);
    this.ctx.strokeRect(x0 * s, y0 * s, (x1 - x0) * s, (y1 - y0) * s);
    this.ctx.setLineDash([]);
    this.ctx.restore();
  }

  // ─── Ruta del robot ───────────────────────────────────────────────────────

  _drawRobotPath(robot, state) {
    Spline.draw(
      this.ctx, robot.path, robot.spline, this.map,
      state.showPaths, state.showSplines
    );

    if (robot.state !== 'idle' && robot.state !== 'arrived') {
      const s  = 1 / this.map.scale;
      const dx = robot.destX * s;
      const dy = robot.destY * s;

      this.ctx.save();
      this.ctx.strokeStyle = robot.color;
      this.ctx.lineWidth   = 1;
      this.ctx.globalAlpha = 0.6;
      this.ctx.beginPath();
      this.ctx.moveTo(dx - 5, dy); this.ctx.lineTo(dx + 5, dy);
      this.ctx.moveTo(dx, dy - 5); this.ctx.lineTo(dx, dy + 5);
      this.ctx.stroke();
      this.ctx.beginPath();
      this.ctx.arc(dx, dy, 4, 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.restore();
    }
  }

  // ─── Rayo de planificación ────────────────────────────────────────────────

  _drawRobotRay(robot, state) {
    if (!state.showRays || !robot._lastRay) return;
    Raycast.draw(
      this.ctx, robot.x, robot.y,
      robot.destX, robot.destY,
      robot._lastRay, this.map
    );
  }

  // ─── Geometría de colisiones ──────────────────────────────────────────────

  _drawRobotGeometry(robot, state) {
    const selected = state.selectedRobot === robot;

    if (state.showAABB) {
      AABB.draw(this.ctx, robot.getAABB(), this.map, robot.color, robot.inCollision);
    }

    if (state.showOBB) {
      SAT.drawOBB(this.ctx, robot, this.map, robot.inCollision);
    }

    if (state.showMTV && robot.mtv) {
      this._drawMTV(robot);
    }

    if (selected && robot.inCollision && robot.collisionPartner && state.showOBB) {
      const epsilon = parseFloat(document.getElementById('sat-epsilon')?.value ?? 0.01);
      const result  = SAT.test(robot, robot.collisionPartner, epsilon);
      SAT.drawInspector(this.ctx, robot, robot.collisionPartner, result, this.map);
    }
  }

  /**
   * Dibuja el Vector de Penetración Mínima como flecha sobre el robot.
   * @param {Robot} robot
   */
  _drawMTV(robot) {
    const s     = 1 / this.map.scale;
    const ox    = robot.x * s;
    const oy    = robot.y * s;
    const scale = s * 8;
    const mx    = robot.mtv.dx * scale;
    const my    = robot.mtv.dy * scale;
    const angle = Math.atan2(my, mx);
    const len   = 5;

    this.ctx.save();
    this.ctx.strokeStyle = '#ff4040';
    this.ctx.fillStyle   = '#ff4040';
    this.ctx.lineWidth   = 1.5;

    this.ctx.beginPath();
    this.ctx.moveTo(ox, oy);
    this.ctx.lineTo(ox + mx, oy + my);
    this.ctx.stroke();

    this.ctx.beginPath();
    this.ctx.moveTo(ox + mx, oy + my);
    this.ctx.lineTo(ox + mx - len * Math.cos(angle - 0.4), oy + my - len * Math.sin(angle - 0.4));
    this.ctx.lineTo(ox + mx - len * Math.cos(angle + 0.4), oy + my - len * Math.sin(angle + 0.4));
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.restore();
  }

  // ─── Cuerpo del robot ─────────────────────────────────────────────────────

  _drawRobotBody(robot, state) {
    const s        = 1 / this.map.scale;
    const ctx      = this.ctx;
    const selected = state.selectedRobot === robot;
    const hw       = robot.width  / 2 * s;
    const hh       = robot.height / 2 * s;

    ctx.save();
    ctx.translate(robot.x * s, robot.y * s);
    ctx.rotate(robot.angle);

    ctx.shadowColor = robot.color;
    ctx.shadowBlur  = robot.inCollision ? 8 : (selected ? 6 : 2);

    ctx.fillStyle   = robot.inCollision ? '#ff2020'
      : (robot.state === 'arrived' ? '#404862' : robot.color);
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.roundRect(-hw, -hh, hw * 2, hh * 2, 1);
    ctx.fill();

    ctx.shadowBlur  = 0;
    ctx.globalAlpha = 1;

    // Franja frontal de dirección
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(hw * 0.5, -hh, hw * 0.5, hh * 2);

    // ID
    ctx.fillStyle    = 'rgba(0,0,0,0.7)';
    ctx.font         = `${Math.max(6, hh * 0.8)}px 'Share Tech Mono'`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(robot.id.toString(), 0, 0);

    if (selected) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth   = 1.5 / this.zoom;
      ctx.beginPath();
      ctx.roundRect(-hw - 2, -hh - 2, hw * 2 + 4, hh * 2 + 4, 2);
      ctx.stroke();
    }

    if (robot.state === 'replanning') {
      ctx.fillStyle = '#ffd447';
      ctx.font      = '8px sans-serif';
      ctx.fillText('↻', 0, -hh - 6);
    }

    // Punto sensor LIDAR
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(hw - 1, 0, 1.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // ─── HUD ─────────────────────────────────────────────────────────────────

  /** Dibuja la barra de escala en la esquina inferior izquierda del viewport. */
  _drawHUD() {
    const barM  = 10;
    const barPx = barM / this.map.scale * this.zoom;
    const x = 20, y = this.H - 20;

    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(200,210,230,0.6)';
    this.ctx.lineWidth   = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(x, y);           this.ctx.lineTo(x + barPx, y);
    this.ctx.moveTo(x, y - 4);       this.ctx.lineTo(x, y + 4);
    this.ctx.moveTo(x + barPx, y-4); this.ctx.lineTo(x + barPx, y + 4);
    this.ctx.stroke();
    this.ctx.fillStyle  = 'rgba(200,210,230,0.8)';
    this.ctx.font       = '10px Share Tech Mono';
    this.ctx.textAlign  = 'center';
    this.ctx.fillText(`${barM}m`, x + barPx / 2, y - 7);
    this.ctx.restore();
  }

  // ─── Viewport 2: seguimiento de robot ────────────────────────────────────

  /**
   * Renderiza una vista en tercera persona centrada en el robot seleccionado.
   * Muestra el campo de visión del sensor LIDAR y robots cercanos.
   * @param {HTMLCanvasElement} canvas
   * @param {Robot} robot
   * @param {object} state
   */
  renderSecondary(canvas, robot, state) {
    if (!robot) return;
    const ctx  = canvas.getContext('2d');
    const W    = canvas.width;
    const H    = canvas.height;
    const s    = 1 / this.map.scale;
    const zoom = 3;

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2 - robot.x * s * zoom, H / 2 - robot.y * s * zoom);
    ctx.scale(zoom, zoom);

    if (this._mapCache) ctx.drawImage(this._mapCache, 0, 0);

    for (const r of state.robots) {
      if (Math.hypot(r.x - robot.x, r.y - robot.y) > 8) continue;
      const hw = r.width  / 2 * s;
      const hh = r.height / 2 * s;
      ctx.save();
      ctx.translate(r.x * s, r.y * s);
      ctx.rotate(r.angle);
      ctx.fillStyle   = r === robot ? '#ffffff' : r.color;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.roundRect(-hw, -hh, hw * 2, hh * 2, 1);
      ctx.fill();
      ctx.restore();
    }

    // Campo de visión del sensor LIDAR
    const fov = Math.PI / 3;
    ctx.strokeStyle = 'rgba(0,212,170,0.3)';
    ctx.fillStyle   = 'rgba(0,212,170,0.08)';
    ctx.lineWidth   = 0.5;
    ctx.beginPath();
    ctx.moveTo(robot.x * s, robot.y * s);
    ctx.arc(robot.x * s, robot.y * s, 20, robot.angle - fov / 2, robot.angle + fov / 2);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();

    ctx.restore();
    ctx.fillStyle = 'rgba(107,120,151,0.8)';
    ctx.font      = '9px Share Tech Mono';
    ctx.textAlign = 'right';
    ctx.fillText(`Robot #${robot.id}`, W - 6, H - 6);
  }

  // ─── Viewport 3: overview con zoom fijo ──────────────────────────────────

  /**
   * Renderiza una vista general del mapa completo con zoom calculado
   * automáticamente para encuadrar todo el espacio de trabajo.
   * @param {HTMLCanvasElement} canvas
   * @param {object} state
   */
  renderZoom(canvas, state) {
    const ctx  = canvas.getContext('2d');
    const W    = canvas.width;
    const H    = canvas.height;
    const s    = 1 / this.map.scale;
    const mapW = this.map.widthPx;
    const mapH = this.map.heightPx;
    const zoom = Math.min(W / mapW, H / mapH) * 0.92;
    const panX = (W - mapW * zoom) / 2;
    const panY = (H - mapH * zoom) / 2;

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    if (this._mapCache) ctx.drawImage(this._mapCache, 0, 0);

    for (const robot of state.robots) {
      const hw = robot.width  / 2 * s;
      const hh = robot.height / 2 * s;
      ctx.save();
      ctx.translate(robot.x * s, robot.y * s);
      ctx.rotate(robot.angle);
      ctx.fillStyle   = robot.inCollision ? '#ff4040' : robot.color;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.roundRect(-hw, -hh, hw * 2, hh * 2, 1);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
    ctx.fillStyle = 'rgba(107,120,151,0.7)';
    ctx.font      = '9px Share Tech Mono';
    ctx.textAlign = 'right';
    ctx.fillText('OVERVIEW', W - 6, H - 6);
  }

  // ─── Input (pan/zoom del viewport principal) ──────────────────────────────

  _setupInput() {
    const canvas = this.canvas;

    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const rect   = canvas.getBoundingClientRect();
      const mx     = e.clientX - rect.left;
      const my     = e.clientY - rect.top;
      this.panX    = mx - (mx - this.panX) * factor;
      this.panY    = my - (my - this.panY) * factor;
      this.zoom    = Math.max(0.3, Math.min(10, this.zoom * factor));
    }, { passive: false });

    let dragging = false, lastX = 0, lastY = 0;
    canvas.addEventListener('mousedown', e => {
      if (e.button === 1 || e.button === 2) {
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        e.preventDefault();
      }
    });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      this.panX += e.clientX - lastX;
      this.panY += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
    });
    window.addEventListener('mouseup', () => { dragging = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }
}