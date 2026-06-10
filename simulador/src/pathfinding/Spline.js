/**
 * Spline — Sprint 3
 * Suavizado de trayectorias A* mediante interpolación Catmull-Rom.
 * Convierte waypoints discretos en una trayectoria continua y navegable.
 */
const Spline = {

  /**
   * Calcula un punto en la spline Catmull-Rom.
   * @param {number} t   parámetro [0,1]
   * @param {object} p0..p3  puntos de control {wx, wy}
   * @param {number} tension  [0,1] (default 0.5)
   */
  catmullRom(t, p0, p1, p2, p3, tension = 0.5) {
    const t2 = t * t, t3 = t2 * t;
    const m1x = tension * (p2.wx - p0.wx);
    const m1y = tension * (p2.wy - p0.wy);
    const m2x = tension * (p3.wx - p1.wx);
    const m2y = tension * (p3.wy - p1.wy);
    return {
      wx: (2 * t3 - 3 * t2 + 1) * p1.wx + (t3 - 2 * t2 + t) * m1x +
          (-2 * t3 + 3 * t2) * p2.wx + (t3 - t2) * m2x,
      wy: (2 * t3 - 3 * t2 + 1) * p1.wy + (t3 - 2 * t2 + t) * m1y +
          (-2 * t3 + 3 * t2) * p2.wy + (t3 - t2) * m2y
    };
  },

  /**
   * Genera los puntos de la spline a partir de waypoints A*.
   * @param {Array<{wx,wy}>} waypoints
   * @param {number} tension    [0,1]
   * @param {number} stepsPerSegment  resolución
   * @returns {Array<{wx,wy}>}
   */
  buildSpline(waypoints, tension = 0.5, stepsPerSegment = 10) {
    if (waypoints.length < 2) return waypoints;

    // Extender puntos de control en los extremos
    const pts = [
      waypoints[0],
      ...waypoints,
      waypoints[waypoints.length - 1]
    ];

    const spline = [];
    for (let i = 1; i < pts.length - 2; i++) {
      for (let step = 0; step < stepsPerSegment; step++) {
        const t = step / stepsPerSegment;
        spline.push(Spline.catmullRom(t, pts[i-1], pts[i], pts[i+1], pts[i+2], tension));
      }
    }
    spline.push(waypoints[waypoints.length - 1]);
    return spline;
  },

  /**
   * Remuestrea la spline a puntos equidistantes (distancia uniforme).
   * Necesario para control de velocidad uniforme del robot.
   * @param {Array<{wx,wy}>} spline
   * @param {number} stepSize  distancia entre puntos en metros
   * @returns {Array<{wx,wy}>}
   */
  resample(spline, stepSize = 0.15) {
    if (spline.length < 2) return spline;
    const result = [spline[0]];
    let accumulated = 0;

    for (let i = 1; i < spline.length; i++) {
      const prev = spline[i - 1], curr = spline[i];
      const dx = curr.wx - prev.wx, dy = curr.wy - prev.wy;
      const segLen = Math.sqrt(dx * dx + dy * dy);
      accumulated += segLen;

      if (accumulated >= stepSize) {
        result.push(curr);
        accumulated = 0;
      }
    }

    // Asegurar que el último punto esté incluido
    const last = spline[spline.length - 1];
    const prev = result[result.length - 1];
    if (Math.hypot(last.wx - prev.wx, last.wy - prev.wy) > 0.01) {
      result.push(last);
    }

    return result;
  },

  /**
   * Dibuja la ruta A* discreta (línea discontinua) y la spline (línea continua).
   */
  draw(ctx, waypoints, splinePoints, map, showRaw, showSpline) {
    const s = 1 / map.scale;
    ctx.save();

    // Ruta A* cruda
    if (showRaw && waypoints.length > 1) {
      ctx.beginPath();
      ctx.moveTo(waypoints[0].wx * s, waypoints[0].wy * s);
      for (let i = 1; i < waypoints.length; i++)
        ctx.lineTo(waypoints[i].wx * s, waypoints[i].wy * s);
      ctx.strokeStyle = 'rgba(255,212,71,0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Spline suavizada
    if (showSpline && splinePoints.length > 1) {
      ctx.beginPath();
      ctx.moveTo(splinePoints[0].wx * s, splinePoints[0].wy * s);
      for (let i = 1; i < splinePoints.length; i++)
        ctx.lineTo(splinePoints[i].wx * s, splinePoints[i].wy * s);
      ctx.strokeStyle = 'rgba(0,212,170,0.55)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    ctx.restore();
  }
};
