/**
 * Robot — Sprint 1 & 2
 * Clase principal del AGV: posición, velocidad, ángulo,
 * AABB, OBB, ruta activa, estado de colisión.
 */
class Robot {
  static _nextId = 0;
  static COLORS = [
    '#00d4aa','#4da8ff','#ffd447','#ff7c2a',
    '#a78bfa','#ff6b9d','#7bffa0','#ff9af0',
    '#ff4040','#00ccff','#ffaa00','#cc88ff'
  ];

  /**
   * @param {number} wx     - posición X mundo (metros)
   * @param {number} wy     - posición Y mundo (metros)
   * @param {number} angle  - ángulo (radianes)
   * @param {number} w      - ancho (metros)
   * @param {number} h      - alto (metros)
   * @param {number} vmax   - velocidad máxima (m/s)
   */
  constructor(wx, wy, angle = 0, w = 0.6, h = 0.4, vmax = 2.0) {
    this.id    = Robot._nextId++;
    this.color = Robot.COLORS[this.id % Robot.COLORS.length];

    // ── Pose ────────────────────────────────────────
    this.x     = wx;
    this.y     = wy;
    this.angle = angle;   // radianes, rango [-π, π]

    // ── Cinemática ──────────────────────────────────
    this.vx    = 0;
    this.vy    = 0;
    this.omega = 0;       // velocidad angular (rad/s)
    this.vmax  = vmax;
    this.accel = 3.0;     // aceleración (m/s²)
    this.mass  = 1.0;

    // ── Geometría ───────────────────────────────────
    this.width  = w;
    this.height = h;

    // ── Destino y ruta ──────────────────────────────
    this.destX  = wx;
    this.destY  = wy;
    this.path   = [];     // waypoints mundo [{wx, wy}, ...]
    this.pathIdx = 0;
    this.spline = [];     // puntos spline suavizada
    this.splineIdx = 0;

    // ── Estado ──────────────────────────────────────
    this.state   = 'idle';   // idle | moving | replanning | arrived | waiting
    this.inCollision = false;
    this.collisionPartner = null;
    this.usingAABBFallback = false;
    this.replanCooldown = 0;

    // ── Métricas propias ────────────────────────────
    this.stats = {
      distanceTraveled: 0,
      collisions: 0,
      replans: 0,
      destinationsReached: 0
    };

    // ── Sensor / escena jerárquica ──────────────────
    // El sensor LIDAR está desplazado frontalmente
    this.sensorOffset = { x: this.width / 2, y: 0 };

    // ── MTV (vector de penetración mínima) ──────────
    this.mtv = null;   // { dx, dy } si hay colisión resuelta este frame
  }

  // ─── Transformación homogénea 3×3 ────────────────────────────────────────

  /**
   * Devuelve la matriz de transformación homogénea T·R del robot.
   * | cos θ  -sin θ   tx |
   * | sin θ   cos θ   ty |
   * |   0      0      1  |
   */
  getHomogeneousMatrix() {
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    return [
      [c, -s, this.x],
      [s,  c, this.y],
      [0,  0, 1]
    ];
  }

  /** Formatea la matriz 3×3 para display educativo */
  getMatrixDisplay() {
    const m = this.getHomogeneousMatrix();
    return m.map(row =>
      '[ ' + row.map(v => (v >= 0 ? ' ' : '') + v.toFixed(3)).join('  ') + ' ]'
    ).join('\n');
  }

  /**
   * Transforma un punto local (relativo al robot) a coordenadas mundo.
   */
  localToWorld(lx, ly) {
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    return {
      x: this.x + c * lx - s * ly,
      y: this.y + s * lx + c * ly
    };
  }

  /** Posición del sensor LIDAR en coordenadas mundo */
  getSensorWorldPos() {
    return this.localToWorld(this.sensorOffset.x, this.sensorOffset.y);
  }

  // ─── Vértices OBB ────────────────────────────────────────────────────────

  /**
   * Los 4 vértices del OBB en coordenadas mundo.
   * Ordenados: TL, TR, BR, BL respecto al eje local del robot.
   */
  getVertices() {
    const hw = this.width / 2, hh = this.height / 2;
    const corners = [
      { x: -hw, y: -hh },
      { x:  hw, y: -hh },
      { x:  hw, y:  hh },
      { x: -hw, y:  hh }
    ];
    return corners.map(c => this.localToWorld(c.x, c.y));
  }

  // ─── AABB ─────────────────────────────────────────────────────────────────

  /** Calcula el AABB del robot en coordenadas mundo. */
  getAABB() {
    const verts = this.getVertices();
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (const v of verts) {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
    return { minX, maxX, minY, maxY };
  }

  // ─── Actualización de posición ────────────────────────────────────────────

  /**
   * Integración numérica Euler explícito.
   * @param {number} dt  delta tiempo en segundos
   * @param {OccupancyMap} map
   */
  update(dt, map) {
    if (this.replanCooldown > 0) this.replanCooldown -= dt;

    const prev = { x: this.x, y: this.y };

    // Seguimiento de waypoints de la spline
    if (this.state === 'moving' && this.spline.length > 0) {
      this._followSpline(dt);
    }

    // Aplicar velocidad
    const nx = this.x + this.vx * dt;
    const ny = this.y + this.vy * dt;

    // Collision with map borders / obstacles
    if (!map.isBlockedWorld(nx, this.y)) this.x = nx;
    if (!map.isBlockedWorld(this.x, ny)) this.y = ny;

    // Distancia recorrida
    const dx = this.x - prev.x, dy = this.y - prev.y;
    this.stats.distanceTraveled += Math.sqrt(dx * dx + dy * dy);

    // Normalizar ángulo
    this.angle = ((this.angle + Math.PI) % (2 * Math.PI)) - Math.PI;

    // Limpiar estado de colisión y MTV del frame anterior
    this.inCollision = false;
    this.collisionPartner = null;
    this.mtv = null;
    this.usingAABBFallback = false;
  }

  _followSpline(dt) {
    if (this.splineIdx >= this.spline.length) {
      this._arrivedAtDestination();
      return;
    }

    const target = this.spline[this.splineIdx];
    const dx = target.wx - this.x;
    const dy = target.wy - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Avanzar al siguiente waypoint si está cerca
    if (dist < 0.12) {
      this.splineIdx++;
      return;
    }

    // Ángulo hacia el objetivo
    const targetAngle = Math.atan2(dy, dx);
    let dAngle = targetAngle - this.angle;
    // Normalizar diferencia angular al rango [-π, π]
    while (dAngle >  Math.PI) dAngle -= 2 * Math.PI;
    while (dAngle < -Math.PI) dAngle += 2 * Math.PI;

    // Velocidad angular proporcional (controlador P simple)
    this.omega = Math.max(-3, Math.min(3, dAngle * 4));
    this.angle += this.omega * dt;

    // Velocidad lineal — reducir si el ángulo no está alineado
    const alignFactor = Math.max(0, Math.cos(dAngle));
    const speed = this.vmax * alignFactor;
    this.vx = Math.cos(this.angle) * speed;
    this.vy = Math.sin(this.angle) * speed;
  }

  _arrivedAtDestination() {
    this.vx = 0; this.vy = 0; this.omega = 0;
    this.state = 'arrived';
    this.stats.destinationsReached++;
  }

  // ─── Destino y ruta ──────────────────────────────────────────────────────

  setDestination(wx, wy) {
    this.destX = wx;
    this.destY = wy;
    this.path = [];
    this.spline = [];
    this.pathIdx = 0;
    this.splineIdx = 0;
    this.state = 'replanning';
  }

  setPath(waypoints, splinePts) {
    this.path     = waypoints;
    this.spline   = splinePts;
    this.pathIdx  = 0;
    this.splineIdx = 0;
    this.state    = waypoints.length > 0 ? 'moving' : 'idle';
  }

  triggerReplan(cause = 'collision') {
    if (this.replanCooldown > 0) return false;
    this.stats.replans++;
    this.state = 'replanning';
    this.replanCooldown = parseFloat(
      document.getElementById('replan-cooldown')?.value ?? 0.5
    );
    return true;
  }
}
