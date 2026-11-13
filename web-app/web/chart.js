// Hand-drawn canvas charts. No library.
function drawLine(canvas, points, color) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  if (!points.length) return;
  ctx.beginPath();
  ctx.strokeStyle = color || '#00d35a';
  ctx.lineWidth = 2;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const min = Math.min(...points), max = Math.max(...points);
  points.forEach((p, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - ((p - min) / (max - min || 1)) * h;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
}
function drawCandles(canvas, candles) {
  // stub for 1m OHLC from prices
  drawLine(canvas, candles.map(c => c.close || c), '#00d35a');
}
