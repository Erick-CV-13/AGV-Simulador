/**
 * SAT — Sprint 2
 * Separating Axis Theorem para detección precisa de colisiones
 * entre OBB (Oriented Bounding Box).
 *
 * Para dos OBBs se evalúan 4 ejes separadores potenciales:
 *   - 2 ejes normales a las aristas del OBB A
 *   - 2 ejes normales a las aristas del OBB B
 * Si en algún eje las proyecciones no se solapan → NO hay colisión.
 */
const SAT = {

  /**
   * Proyecta los vértices de un polígono sobre un eje normalizado.
   * @returns {{ min, max }}
   */
  project(vertices, axis) {
    let min = Infinity, max = -Infinity;
    for (const v of vertices) {
      const dot = v.x * axis.x + v.y * axis.y;
      if (dot < min) min = dot;
      if (dot > max) max = dot;
    }
    return { min, max };
  },

  /**
   * Obtiene los 4 ejes separadores potenciales para dos OBBs
   * (normales a las aristas de cada caja).
   * @param {Array<{x,y}>} vertsA
   * @param {Array<{x,y}>} vertsB
   * @returns {Array<{x,y}>}  ejes normalizados
   */
  getAxes(vertsA, vertsB) {
    const axes = [];
    const polys = [vertsA, vertsB];
    for (const verts of polys) {
      for (let i = 0; i < verts.length; i++) {
        const a = verts[i];
        const b = verts[(i + 1) % verts.length];
        // Normal perpendicular a la arista (sin normalizar, el SAT funciona igual)
        const edge = { x: b.x - a.x, y: b.y - a.y };
        const len  = Math.sqrt(edge.x * edge.x + edge.y * edge.y);
        if (len < 1e-10) continue;
        axes.push({ x: -edge.y / len, y: edge.x / len });
      }
    }
    return axes;
  },

  /**
   * Prueba SAT entre dos robots con OBB.
   * Incluye fallback a AABB cuando el ángulo relativo es < epsilon (rad).
   *
   * @param {Robot} rA
   * @param {Robot} rB
   * @param {number} epsilon  tolerancia angular (rad)
   * @returns {{ colliding, mtv: {dx,dy}, axes, projA, projB, usingFallback }}
   */
  test(rA, rB, epsilon = 0.01) {
    // ── Fallback a AABB ────────────────────────────────────────────────────
    const angleDiff = Math.abs(((rA.angle - rB.angle + Math.PI) % (2 * Math.PI)) - Math.PI);
    const usingFallback = angleDiff < epsilon;

    if (usingFallback) {
      const aabbA = rA.getAABB();
      const aabbB = rB.getAABB();
      const colliding = AABB.overlap(aabbA, aabbB);
      const mtv = colliding ? AABB.getMTV(aabbA, aabbB) : null;
      return { colliding, mtv, axes: [], projA: [], projB: [], usingFallback: true };
    }

    // ── SAT completo con OBB ───────────────────────────────────────────────
    const vertsA = rA.getVertices();
    const vertsB = rB.getVertices();
    const axes   = SAT.getAxes(vertsA, vertsB);

    let minOverlap = Infinity;
    let mtvAxis    = null;
    const projAs = [], projBs = [];

    for (const axis of axes) {
      const projA = SAT.project(vertsA, axis);
      const projB = SAT.project(vertsB, axis);
      projAs.push(projA);
      projBs.push(projB);

      // ¿Existe eje separador?
      if (projA.max < projB.min || projB.max < projA.min) {
        return {
          colliding: false, mtv: null,
          axes, projA: projAs, projB: projBs,
          separatingAxisIdx: axes.indexOf(axis),
          usingFallback: false
        };
      }

      // Calcular solapamiento en este eje
      const overlap = Math.min(projA.max, projB.max) - Math.max(projA.min, projB.min);
      if (overlap < minOverlap) {
        minOverlap = overlap;
        mtvAxis    = axis;
      }
    }

    // Colisión confirmada — calcular MTV
    // El MTV apunta de B hacia A
    const center = {
      x: rA.x - rB.x,
      y: rA.y - rB.y
    };
    const dot = center.x * mtvAxis.x + center.y * mtvAxis.y;
    const sign = dot < 0 ? -1 : 1;

    return {
      colliding: true,
      mtv: {
        dx: sign * mtvAxis.x * minOverlap,
        dy: sign * mtvAxis.y * minOverlap
      },
      axes,
      projA: projAs,
      projB: projBs,
      usingFallback: false
    };
  },

  /**
   * Dibuja los OBB de dos robots con sus ejes y proyecciones (modo inspector).
   * Solo para el robot seleccionado.
   */
  drawInspector(ctx, rA, rB, result, map) {
    const s = 1 / map.scale;
    ctx.save();
    // OBBs
    for (const r of [rA, rB]) {
      const verts = r.getVertices();
      ctx.beginPath();
      ctx.moveTo(verts[0].x * s, verts[0].y * s);
      for (let i = 1; i < verts.length; i++)
        ctx.lineTo(verts[i].x * s, verts[i].y * s);
      ctx.closePath();
      ctx.strokeStyle = result.colliding ? '#ff4040' : '#ffd447';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Ejes separadores
    if (result.axes && result.axes.length) {
      const cx = (rA.x + rB.x) / 2, cy = (rA.y + rB.y) / 2;
      result.axes.forEach((axis, i) => {
        const len = 40; // px
        ctx.beginPath();
        ctx.moveTo((cx - axis.x * len / s) * s, (cy - axis.y * len / s) * s);
        ctx.lineTo((cx + axis.x * len / s) * s, (cy + axis.y * len / s) * s);
        ctx.strokeStyle = i === result.separatingAxisIdx
          ? '#ff4040' : 'rgba(255,212,71,0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      });
    }

    ctx.restore();
  },

  /**
   * Dibuja el OBB de un solo robot.
   */
  drawOBB(ctx, robot, map, colliding = false) {
    const verts = robot.getVertices();
    const s = 1 / map.scale;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(verts[0].x * s, verts[0].y * s);
    for (let i = 1; i < verts.length; i++)
      ctx.lineTo(verts[i].x * s, verts[i].y * s);
    ctx.closePath();
    ctx.strokeStyle = colliding ? '#ff4040' : (robot.usingAABBFallback ? '#ffd447' : '#a78bfa');
    ctx.lineWidth   = colliding ? 2 : 1;
    ctx.stroke();
    ctx.restore();
  }
};
