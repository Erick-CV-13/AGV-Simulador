/**
 * SpatialGrid — Sprint 4
 * Grid espacial uniforme para reducir complejidad de colisiones de O(n²) a O(n).
 * Divide el espacio en celdas de tamaño = diámetro máximo del robot.
 */
class SpatialGrid {
  /**
   * @param {number} mapW   - ancho mapa en metros
   * @param {number} mapH   - alto mapa en metros
   * @param {number} cellSize - tamaño de celda en metros
   */
  constructor(mapW, mapH, cellSize) {
    this.cellSize = cellSize;
    this.cols = Math.ceil(mapW / cellSize);
    this.rows = Math.ceil(mapH / cellSize);
    this.cells = new Map();   // "col,row" → Set de robots
  }

  _key(col, row) { return `${col},${row}`; }

  _cellOf(wx, wy) {
    return {
      col: Math.floor(wx / this.cellSize),
      row: Math.floor(wy / this.cellSize)
    };
  }

  clear() { this.cells.clear(); }

  /**
   * Inserta un robot en todas las celdas que toca su AABB.
   */
  insert(robot) {
    const aabb = robot.getAABB();
    const c0 = Math.floor(aabb.minX / this.cellSize);
    const c1 = Math.floor(aabb.maxX / this.cellSize);
    const r0 = Math.floor(aabb.minY / this.cellSize);
    const r1 = Math.floor(aabb.maxY / this.cellSize);

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const k = this._key(c, r);
        if (!this.cells.has(k)) this.cells.set(k, new Set());
        this.cells.get(k).add(robot);
      }
    }
  }

  /**
   * Devuelve los pares únicos de robots que comparten celda.
   * Complejidad: O(n) promedio con distribución uniforme.
   * @returns {Array<[Robot, Robot]>}
   */
  getCandidatePairs() {
    const checked = new Set();
    const pairs = [];

    for (const bucket of this.cells.values()) {
      const bots = Array.from(bucket);
      for (let i = 0; i < bots.length; i++) {
        for (let j = i + 1; j < bots.length; j++) {
          const a = bots[i], b = bots[j];
          // Clave de par ordenada por id
          const pairKey = a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;
          if (!checked.has(pairKey)) {
            checked.add(pairKey);
            pairs.push([a, b]);
          }
        }
      }
    }
    return pairs;
  }

  /**
   * Dibuja el grid como overlay semitransparente.
   */
  draw(ctx, map, showGrid) {
    if (!showGrid) return;
    const s = 1 / map.scale;   // píxeles por metro
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 0.5;
    for (let r = 0; r <= this.rows; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * this.cellSize * s);
      ctx.lineTo(this.cols * this.cellSize * s, r * this.cellSize * s);
      ctx.stroke();
    }
    for (let c = 0; c <= this.cols; c++) {
      ctx.beginPath();
      ctx.moveTo(c * this.cellSize * s, 0);
      ctx.lineTo(c * this.cellSize * s, this.rows * this.cellSize * s);
      ctx.stroke();
    }
    // Colorear celdas ocupadas
    ctx.fillStyle = 'rgba(0,212,170,0.05)';
    for (const [key, bucket] of this.cells.entries()) {
      if (bucket.size > 0) {
        const [c, r] = key.split(',').map(Number);
        ctx.fillRect(
          c * this.cellSize * s,
          r * this.cellSize * s,
          this.cellSize * s,
          this.cellSize * s
        );
      }
    }
    ctx.restore();
  }
}
