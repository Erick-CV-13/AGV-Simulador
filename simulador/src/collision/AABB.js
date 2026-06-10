/**
 * AABB — Sprint 2
 * Caja delimitadora alineada a ejes.
 * Fase amplia de detección de colisiones.
 */
const AABB = {

  /**
   * Comprueba solapamiento entre dos AABB.
   * Solo requiere 4 comparaciones — O(1).
   * @returns {boolean}
   */
  overlap(a, b) {
    return !(a.maxX < b.minX || b.maxX < a.minX ||
             a.maxY < b.minY || b.maxY < a.minY);
  },

  /**
   * Devuelve el AABB de un robot como {minX, maxX, minY, maxY}
   * (wrapper para que sea explícito en el pipeline).
   */
  of(robot) {
    return robot.getAABB();
  },

  /**
   * Comprueba si un punto (wx, wy) está dentro del AABB.
   */
  containsPoint(aabb, wx, wy) {
    return wx >= aabb.minX && wx <= aabb.maxX &&
           wy >= aabb.minY && wy <= aabb.maxY;
  },

  /**
   * Dibuja el AABB de un robot sobre el canvas (coordenadas píxel).
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} aabb - {minX, maxX, minY, maxY} en metros
   * @param {OccupancyMap} map
   * @param {string} color
   * @param {boolean} colliding
   */
  draw(ctx, aabb, map, color = '#4da8ff', colliding = false) {
    const s = 1 / map.scale;  // px / m
    const x = aabb.minX * s;
    const y = aabb.minY * s;
    const w = (aabb.maxX - aabb.minX) * s;
    const h = (aabb.maxY - aabb.minY) * s;

    ctx.save();
    ctx.strokeStyle = colliding ? '#ff7c2a' : color;
    ctx.lineWidth   = colliding ? 1.5 : 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.restore();
  },

  /**
   * Obtiene el vector de penetración mínima entre dos AABB.
   * Retorna {dx, dy} del MTV o null si no solapan.
   */
  getMTV(a, b) {
    if (!AABB.overlap(a, b)) return null;
    const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
    const overlapY = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
    if (overlapX < overlapY) {
      const dir = (a.minX + a.maxX) / 2 < (b.minX + b.maxX) / 2 ? -1 : 1;
      return { dx: dir * overlapX, dy: 0 };
    } else {
      const dir = (a.minY + a.maxY) / 2 < (b.minY + b.maxY) / 2 ? -1 : 1;
      return { dx: 0, dy: dir * overlapY };
    }
  }
};
