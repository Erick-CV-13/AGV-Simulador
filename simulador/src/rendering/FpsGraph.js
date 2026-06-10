/**
 * FpsGraph — Sprint 4
 * Gráficos mini de FPS y tiempo de pipeline de colisiones.
 */
class FpsGraph {
  constructor(canvas, label, color, max) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.label  = label;
    this.color  = color;
    this.max    = max;   // valor máximo del eje Y
    this.values = new Array(60).fill(0);
    this.W = canvas.width;
    this.H = canvas.height;
  }

  push(value) {
    this.values.push(value);
    if (this.values.length > 60) this.values.shift();
    this.draw();
  }

  draw() {
    const ctx = this.ctx;
    const W = this.W, H = this.H;
    ctx.clearRect(0, 0, W, H);

    // Fondo
    ctx.fillStyle = '#1e2330';
    ctx.fillRect(0, 0, W, H);

    // Líneas guía
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = Math.floor(H * i / 4) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Área del gráfico
    const vals = this.values;
    const n    = vals.length;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * W;
      const y = H - (vals[i] / this.max) * (H - 4) - 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, this.color + 'cc');
    grad.addColorStop(1, this.color + '11');
    ctx.fillStyle = grad;
    ctx.fill();

    // Línea
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * W;
      const y = H - (vals[i] / this.max) * (H - 4) - 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Valor actual
    const current = vals[vals.length - 1];
    ctx.fillStyle = this.color;
    ctx.font = '9px Share Tech Mono';
    ctx.textAlign = 'right';
    ctx.fillText(current.toFixed(1), W - 3, 10);

    // Umbral (línea roja para FPS < 30)
    if (this.label === 'FPS') {
      const threshY = H - (30 / this.max) * (H - 4) - 2;
      ctx.strokeStyle = 'rgba(255,64,64,0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(0, threshY); ctx.lineTo(W, threshY);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}
