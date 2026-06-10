/**
 * AStar — Sprint 3
 * Algoritmo A* sobre el mapa de ocupación binaria.
 * Heurística euclidiana, vecindad de Moore (8 direcciones).
 * Soporta modo educativo paso a paso.
 */
class AStar {
  /**
   * @param {OccupancyMap} map
   * @param {number} clearancePx  radio de inflado de obstáculos en píxeles
   */
  constructor(map, clearancePx = 0) {
    this.map = map;
    this.clearancePx = clearancePx;
    this._inflatedGrid = null;
    this._rebuildInflated();

    // Estado del modo educativo
    this.stepMode   = false;
    this.stepState  = null;
  }

  _rebuildInflated() {
    this._inflatedGrid = this.map.getInflatedGrid(this.clearancePx);
  }

  setClearance(px) {
    this.clearancePx = px;
    this._rebuildInflated();
  }

  _isBlocked(px, py) {
    if (px < 0 || py < 0 || px >= this.map.widthPx || py >= this.map.heightPx) return true;
    return this._inflatedGrid[this.map.idx(px, py)] === 1;
  }

  _heuristic(ax, ay, bx, by) {
    const dx = ax - bx, dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Ejecuta A* desde coordenadas mundo origen a destino.
   * @returns {Array<{wx, wy}>} Lista de waypoints en coordenadas mundo, o []
   */
  findPath(x0, y0, x1, y1) {
    const { px: startX, py: startY } = this.map.mundoAPixel(x0, y0);
    const { px: goalX,  py: goalY  } = this.map.mundoAPixel(x1, y1);

    if (this._isBlocked(goalX, goalY)) return [];

    // MinHeap simple mediante array ordenado (suficiente para grids medianas)
    const openSet  = [{ px: startX, py: startY, f: 0, g: 0 }];
    const cameFrom = new Map();
    const gScore   = new Map();
    const key = (x, y) => `${x},${y}`;

    gScore.set(key(startX, startY), 0);

    const dirs8 = [
      [1,0],[0,1],[-1,0],[0,-1],
      [1,1],[-1,1],[1,-1],[-1,-1]
    ];
    const diagonalCost = Math.SQRT2;

    const maxIter = this.map.widthPx * this.map.heightPx;
    let iter = 0;

    while (openSet.length > 0 && iter++ < maxIter) {
      // Extraer nodo con menor f
      openSet.sort((a, b) => a.f - b.f);
      const current = openSet.shift();
      const { px: cx, py: cy } = current;

      if (cx === goalX && cy === goalY) {
        return this._reconstructPath(cameFrom, goalX, goalY);
      }

      for (const [ddx, ddy] of dirs8) {
        const nx = cx + ddx, ny = cy + ddy;
        if (this._isBlocked(nx, ny)) continue;

        const moveCost = (Math.abs(ddx) + Math.abs(ddy) === 2) ? diagonalCost : 1;
        const tentativeG = (gScore.get(key(cx, cy)) ?? Infinity) + moveCost;
        const nk = key(nx, ny);

        if (tentativeG < (gScore.get(nk) ?? Infinity)) {
          gScore.set(nk, tentativeG);
          cameFrom.set(nk, { px: cx, py: cy });
          const f = tentativeG + this._heuristic(nx, ny, goalX, goalY);
          openSet.push({ px: nx, py: ny, f, g: tentativeG });
        }
      }
    }

    return [];  // Sin ruta
  }

  _reconstructPath(cameFrom, goalX, goalY) {
    const path = [];
    let cur = `${goalX},${goalY}`;
    while (cameFrom.has(cur)) {
      const [x, y] = cur.split(',').map(Number);
      const { wx, wy } = this.map.pixelAMundo(x, y);
      path.unshift({ wx, wy });
      const prev = cameFrom.get(cur);
      cur = `${prev.px},${prev.py}`;
    }
    return path;
  }

  // ── Modo educativo paso a paso ────────────────────────────────────────────

  /**
   * Inicializa el modo paso a paso.
   */
  initStepMode(x0, y0, x1, y1) {
    const { px: startX, py: startY } = this.map.mundoAPixel(x0, y0);
    const { px: goalX,  py: goalY  } = this.map.mundoAPixel(x1, y1);
    this.stepState = {
      openSet:   [{ px: startX, py: startY, f: 0, g: 0 }],
      closedSet: new Set(),
      cameFrom:  new Map(),
      gScore:    new Map([[`${startX},${startY}`, 0]]),
      current:   null,
      goalX, goalY,
      done: false,
      resultPath: null
    };
  }

  /**
   * Avanza un paso del A* en modo educativo.
   * @returns {object} estado actual
   */
  stepOnce() {
    const st = this.stepState;
    if (!st || st.done) return st;

    st.openSet.sort((a, b) => a.f - b.f);
    if (st.openSet.length === 0) {
      st.done = true; st.resultPath = [];
      return st;
    }

    const current = st.openSet.shift();
    st.current = current;
    const { px: cx, py: cy } = current;
    const ck = `${cx},${cy}`;
    st.closedSet.add(ck);

    if (cx === st.goalX && cy === st.goalY) {
      st.done = true;
      st.resultPath = this._reconstructPath(st.cameFrom, st.goalX, st.goalY);
      return st;
    }

    const dirs8 = [[1,0],[0,1],[-1,0],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
    for (const [ddx, ddy] of dirs8) {
      const nx = cx + ddx, ny = cy + ddy;
      if (this._isBlocked(nx, ny)) continue;
      const nk = `${nx},${ny}`;
      if (st.closedSet.has(nk)) continue;
      const moveCost = (Math.abs(ddx) + Math.abs(ddy) === 2) ? Math.SQRT2 : 1;
      const tentativeG = (st.gScore.get(ck) ?? Infinity) + moveCost;
      if (tentativeG < (st.gScore.get(nk) ?? Infinity)) {
        st.gScore.set(nk, tentativeG);
        st.cameFrom.set(nk, { px: cx, py: cy });
        const f = tentativeG + this._heuristic(nx, ny, st.goalX, st.goalY);
        st.openSet.push({ px: nx, py: ny, f, g: tentativeG });
      }
    }

    return st;
  }

  /**
   * Dibuja el estado del A* en modo educativo.
   */
  drawStepState(ctx, map) {
    const st = this.stepState;
    if (!st) return;
    const s = 1 / map.scale;
    const cs = 1;  // tamaño celda en px (1:1)

    ctx.save();
    // Closed set — gris
    ctx.fillStyle = 'rgba(100,110,140,0.35)';
    for (const k of st.closedSet) {
      const [x, y] = k.split(',').map(Number);
      ctx.fillRect(x * cs * s - cs * s * 0.4, y * cs * s - cs * s * 0.4, cs * s * 0.8, cs * s * 0.8);
    }
    // Open set — amarillo
    ctx.fillStyle = 'rgba(255,212,71,0.35)';
    for (const node of st.openSet) {
      ctx.fillRect(node.px * s - s * 0.4, node.py * s - s * 0.4, s * 0.8, s * 0.8);
    }
    // Nodo actual — naranja
    if (st.current) {
      ctx.fillStyle = 'rgba(255,124,42,0.8)';
      ctx.fillRect(st.current.px * s - s * 0.5, st.current.py * s - s * 0.5, s, s);
    }
    // Ruta encontrada — verde
    if (st.resultPath) {
      ctx.strokeStyle = '#00d4aa';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < st.resultPath.length; i++) {
        const p = st.resultPath[i];
        if (i === 0) ctx.moveTo(p.wx / map.scale, p.wy / map.scale);
        else ctx.lineTo(p.wx / map.scale, p.wy / map.scale);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}
