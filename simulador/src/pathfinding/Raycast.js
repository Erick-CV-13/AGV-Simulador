/**
 * Raycast — Sprint 3
 * Raycasting sobre la matriz binaria de ocupación.
 * Utiliza el algoritmo de Bresenham para recorrido eficiente del grid.
 */
const Raycast = {

  /**
   * Lanza un rayo desde (x0, y0) hacia (x1, y1) en coordenadas mundo (metros).
   * @param {OccupancyMap} map
   * @param {number} x0, y0  - origen (metros)
   * @param {number} x1, y1  - destino (metros)
   * @returns {{ hit: boolean, hitX: number, hitY: number, t: number }}
   *          t = parámetro normalizado [0,1] donde ocurrió la colisión (1 = sin obstáculo)
   */
  cast(map, x0, y0, x1, y1) {
    const { px: px0, py: py0 } = map.mundoAPixel(x0, y0);
    const { px: px1, py: py1 } = map.mundoAPixel(x1, y1);

    // Bresenham's line algorithm
    let cx = px0, cy = py0;
    const dx = Math.abs(px1 - px0), dy = Math.abs(py1 - py0);
    const sx = px0 < px1 ? 1 : -1;
    const sy = py0 < py1 ? 1 : -1;
    let err = dx - dy;
    const totalDist = Math.sqrt(dx * dx + dy * dy);

    while (true) {
      if (cx === px1 && cy === py1) break;  // llegó al destino

      if (map.isBlocked(cx, cy)) {
        // Calcular t
        const traveled = Math.sqrt((cx - px0) ** 2 + (cy - py0) ** 2);
        const t = totalDist > 0 ? traveled / totalDist : 1;
        const { wx, wy } = map.pixelAMundo(cx, cy);
        return { hit: true, hitX: wx, hitY: wy, t };
      }

      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; cx += sx; }
      if (e2 <  dx) { err += dx; cy += sy; }
    }

    return { hit: false, hitX: x1, hitY: y1, t: 1 };
  },

  /**
   * Dibuja el rayo en el canvas.
   * Verde = libre, rojo = bloqueado hasta el punto de impacto.
   */
  draw(ctx, x0, y0, x1, y1, result, map) {
    const s = 1 / map.scale;
    ctx.save();
    ctx.lineWidth = 1;

    if (result.hit) {
      // Segmento bloqueado (rojo)
      ctx.beginPath();
      ctx.moveTo(x0 * s, y0 * s);
      ctx.lineTo(result.hitX * s, result.hitY * s);
      ctx.strokeStyle = 'rgba(255,64,64,0.7)';
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Punto de impacto
      ctx.beginPath();
      ctx.arc(result.hitX * s, result.hitY * s, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ff4040';
      ctx.fill();
    } else {
      // Segmento libre (verde)
      ctx.beginPath();
      ctx.moveTo(x0 * s, y0 * s);
      ctx.lineTo(x1 * s, y1 * s);
      ctx.strokeStyle = 'rgba(0,212,170,0.4)';
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }
};
