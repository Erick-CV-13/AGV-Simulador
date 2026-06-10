/**
 * OccupancyMap — Sprint 1
 * Mapa de ocupación binaria (0=libre, 1=obstáculo)
 * Generado desde imagen cenital o edición manual.
 */
class OccupancyMap {
  /**
   * @param {number} widthPx   - ancho en píxeles del canvas del mapa
   * @param {number} heightPx  - alto en píxeles del canvas del mapa
   * @param {number} scale     - metros por píxel (ej. 0.05)
   */
  constructor(widthPx, heightPx, scale = 0.05) {
    this.widthPx  = widthPx;
    this.heightPx = heightPx;
    this.scale    = scale;        // m/px
    // Matriz binaria: 0=libre, 1=obstáculo
    this.grid = new Uint8Array(widthPx * heightPx);
    // Canvas off-screen para operaciones de imagen
    this._offCanvas = document.createElement('canvas');
    this._offCanvas.width  = widthPx;
    this._offCanvas.height = heightPx;
    this._offCtx = this._offCanvas.getContext('2d');
  }

  // ─── Coordenadas ───────────────────────────────────────────────────────────

  /** Coordenadas mundo (metros) → píxel  */
  mundoAPixel(wx, wy) {
    return {
      px: Math.floor(wx / this.scale),
      py: Math.floor(wy / this.scale)
    };
  }

  /** Coordenadas píxel → mundo (metros) — centro de la celda */
  pixelAMundo(px, py) {
    return {
      wx: (px + 0.5) * this.scale,
      wy: (py + 0.5) * this.scale
    };
  }

  /** Ancho del mapa en metros */
  get widthM()  { return this.widthPx  * this.scale; }
  /** Alto del mapa en metros */
  get heightM() { return this.heightPx * this.scale; }

  // ─── Acceso a la grilla ────────────────────────────────────────────────────

  idx(px, py) { return py * this.widthPx + px; }

  isBlocked(px, py) {
    if (px < 0 || py < 0 || px >= this.widthPx || py >= this.heightPx) return true;
    return this.grid[this.idx(px, py)] === 1;
  }

  isBlockedWorld(wx, wy) {
    const { px, py } = this.mundoAPixel(wx, wy);
    return this.isBlocked(px, py);
  }

  setCell(px, py, val) {
    if (px < 0 || py < 0 || px >= this.widthPx || py >= this.heightPx) return;
    this.grid[this.idx(px, py)] = val ? 1 : 0;
  }

  // ─── Carga desde imagen ────────────────────────────────────────────────────

  /**
   * Umbraliza una imagen y rellena this.grid.
   * @param {ImageBitmap|HTMLImageElement} img
   * @param {number} threshold  0-255 (píxeles más oscuros → obstáculo)
   */
  loadFromImage(img, threshold = 128) {
    this._offCtx.clearRect(0, 0, this.widthPx, this.heightPx);
    this._offCtx.drawImage(img, 0, 0, this.widthPx, this.heightPx);
    const data = this._offCtx.getImageData(0, 0, this.widthPx, this.heightPx).data;
    for (let i = 0; i < this.widthPx * this.heightPx; i++) {
      // Luminancia aproximada
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      this.grid[i] = lum < threshold ? 1 : 0;
    }
  }

  // ─── Generación procedural ─────────────────────────────────────────────────

  /**
   * Genera un almacén típico con pasillos y estanterías.
   */
  generateWarehouse() {
    this.grid.fill(0);
    const W = this.widthPx, H = this.heightPx;

    // Paredes exteriores
    this._drawRect(0, 0, W, 4, 1);
    this._drawRect(0, H - 4, W, 4, 1);
    this._drawRect(0, 0, 4, H, 1);
    this._drawRect(W - 4, 0, 4, H, 1);

    // Estanterías horizontales (filas)
    const shelfH = 12, shelfW = 60, gap = 20;
    const startY = 30;
    for (let row = 0; row < 4; row++) {
      const y = startY + row * (shelfH + gap);
      // Dos columnas de estanterías por fila
      for (let col = 0; col < 3; col++) {
        const x = 20 + col * (shelfW + 20);
        this._drawRect(x, y, shelfW, shelfH, 1);
      }
    }

    // Pilares centrales
    const pillarPositions = [[130, 50], [130, 100], [200, 75]];
    for (const [px, py] of pillarPositions) {
      this._drawRect(px, py, 8, 8, 1);
    }
  }

  _drawRect(x, y, w, h, val) {
    for (let dy = 0; dy < h; dy++)
      for (let dx = 0; dx < w; dx++)
        this.setCell(x + dx, y + dy, val);
  }

  // Pincel circular para edición manual
  paintCircle(px, py, radius, val) {
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++)
        if (dx * dx + dy * dy <= radius * radius)
          this.setCell(px + dx, py + dy, val);
  }

  // ─── Inflado de obstáculos (para clearance A*) ─────────────────────────────

  /**
   * Devuelve una copia de la grilla con obstáculos inflados `r` píxeles.
   */
  getInflatedGrid(r) {
    const inflated = new Uint8Array(this.grid);
    if (r <= 0) return inflated;
    const W = this.widthPx, H = this.heightPx;
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        if (this.grid[this.idx(px, py)] === 1) {
          for (let dy = -r; dy <= r; dy++)
            for (let dx = -r; dx <= r; dx++) {
              const nx = px + dx, ny = py + dy;
              if (nx >= 0 && ny >= 0 && nx < W && ny < H)
                inflated[this.idx(nx, ny)] = 1;
            }
        }
      }
    }
    return inflated;
  }

  // ─── Serialización ─────────────────────────────────────────────────────────

  toJSON() {
    return {
      widthPx:  this.widthPx,
      heightPx: this.heightPx,
      scale:    this.scale,
      grid:     Array.from(this.grid)
    };
  }

  static fromJSON(data) {
    const map = new OccupancyMap(data.widthPx, data.heightPx, data.scale);
    map.grid = new Uint8Array(data.grid);
    return map;
  }
}
