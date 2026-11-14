/* Hand-drawn canvas charts. No chart library. devicePixelRatio aware.
   GBChart.line    Home balance line (gradient fill, dashed start line, marks)
   GBChart.candles Coin 1-minute OHLC + volume bars + Risk trailing stop line
   GBChart.ring    Analyst score ring 0-100 */
(function () {
  "use strict";
  const C = {
    green: "#00d35a", red: "#ff453a", orange: "#ff9f0a", blue: "#0a84ff",
    sec: "rgba(235,235,245,0.6)", ter: "rgba(235,235,245,0.3)", card2: "#2c2c2e", sep: "rgba(84,84,88,0.55)",
  };
  const FONT = '-apple-system, "SF Pro Text", BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function setup(canvas) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }
  const tms = (t) => (typeof t === "number" ? t : Date.parse(t));
  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function dashed(ctx, x0, x1, y, color) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(x0, y + 0.5); ctx.lineTo(x1, y + 0.5); ctx.stroke(); ctx.restore();
  }
  function anim(canvas, key, dur, draw) {
    if (reduced() || dur <= 0) { draw(1); return; }
    const st = canvas._gbAnim || (canvas._gbAnim = {});
    if (st[key]) cancelAnimationFrame(st[key]);
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      draw(p);
      if (p < 1) st[key] = requestAnimationFrame(step); else st[key] = 0;
    };
    st[key] = requestAnimationFrame(step);
  }

  /* ---------- Home line ---------- */
  function line(canvas, o) {
    const pts = (o.points || []).filter((p) => p && p.v != null && !isNaN(tms(p.t)))
      .map((p) => ({ t: tms(p.t), v: +p.v })).sort((a, b) => a.t - b.t);
    const marks = (o.marks || []).filter((m) => m && !isNaN(tms(m.ts))).map((m) => Object.assign({}, m, { _t: tms(m.ts) }))
      .sort((a, b) => a._t - b._t);
    const prev = canvas._gbLine || { n: 0, keys: {} };
    const grew = prev.n > 0 && pts.length > prev.n;
    const newKeys = {};
    marks.forEach((m) => { const k = m.ts + "|" + (m.title || "") + "|" + (m.value || ""); m._k = k; newKeys[k] = 1; });
    const fresh = marks.filter((m) => !prev.keys[m._k] && prev.n > 0);
    canvas._gbLine = { n: pts.length, keys: newKeys };

    function draw(pSlide, pFade) {
      const { ctx, w, h } = setup(canvas);
      const start = o.startValue != null ? +o.startValue : (pts[0] ? pts[0].v : null);
      if (pts.length < 2) {
        // Empty: dashed start line only. The caption is in the DOM.
        dashed(ctx, 0, w, Math.round(h * 0.62), C.ter);
        return;
      }
      const top = 64, bot = 14;
      let lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
      if (start != null) { lo = Math.min(lo, start); hi = Math.max(hi, start); }
      if (hi - lo < 1e-9) { hi += Math.max(1, Math.abs(hi) * 0.01); lo -= Math.max(1, Math.abs(lo) * 0.01); }
      const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
      const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
      const X = (t) => (t1 === t0 ? w : ((t - t0) / (t1 - t0)) * (w - 2) + 1);
      const Y = (v) => top + (1 - (v - lo) / (hi - lo)) * (h - top - bot);
      // Slide-in of the newest point (250ms): last segment grows from the previous point.
      let draw_pts = pts.map((p) => ({ x: X(p.t), y: Y(p.v) }));
      if (pSlide < 1 && draw_pts.length >= 2) {
        const a = draw_pts[draw_pts.length - 2], b = draw_pts[draw_pts.length - 1];
        draw_pts[draw_pts.length - 1] = { x: a.x + (b.x - a.x) * pSlide, y: a.y + (b.y - a.y) * pSlide };
      }
      if (start != null) dashed(ctx, 0, w, Math.round(Y(start)), C.ter);
      // gradient fill under the line
      const g = ctx.createLinearGradient(0, top, 0, h);
      g.addColorStop(0, "rgba(0,211,90,0.28)"); g.addColorStop(1, "rgba(0,211,90,0)");
      ctx.beginPath(); ctx.moveTo(draw_pts[0].x, h);
      draw_pts.forEach((p) => ctx.lineTo(p.x, p.y));
      ctx.lineTo(draw_pts[draw_pts.length - 1].x, h); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
      ctx.beginPath(); draw_pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.strokeStyle = C.green; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.stroke();
      // marks above the line; a later mark that would overlap moves up a row
      ctx.font = "600 12px " + FONT; ctx.textBaseline = "middle";
      const placed = [];
      const yAt = (t) => {
        if (t <= pts[0].t) return Y(pts[0].v);
        for (let i = 1; i < pts.length; i++) if (pts[i].t >= t) {
          const a = pts[i - 1], b = pts[i], f = (t - a.t) / ((b.t - a.t) || 1);
          return Y(a.v + (b.v - a.v) * f);
        }
        return Y(pts[pts.length - 1].v);
      };
      marks.forEach((m) => {
        const label = o.markLabel ? o.markLabel(m) : null;
        if (!label) return;
        const x = Math.max(4, Math.min(w - 4, X(Math.max(t0, Math.min(t1, m._t)))));
        const py = yAt(m._t);
        const tw = ctx.measureText(label.text).width + 14, bh = 20;
        let bx = Math.max(2, Math.min(w - tw - 2, x - tw / 2));
        let row = 0, by;
        for (;;) {
          by = py - 14 - bh - row * (bh + 4);
          const hit = placed.some((b) => bx < b.x + b.w + 3 && bx + tw + 3 > b.x && by < b.y + b.h + 2 && by + bh + 2 > b.y);
          if (!hit || row > 6) break;
          row++;
        }
        if (by < 2) by = 2;
        placed.push({ x: bx, y: by, w: tw, h: bh });
        const alpha = fresh.indexOf(m) >= 0 ? pFade : 1;
        ctx.save(); ctx.globalAlpha = alpha;
        ctx.strokeStyle = label.color; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, py - 4); ctx.lineTo(x, by + bh); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, py, 3.5, 0, Math.PI * 2); ctx.fillStyle = label.color; ctx.fill();
        rrect(ctx, bx, by, tw, bh, 10); ctx.fillStyle = "#1c1c1e"; ctx.fill();
        ctx.fillStyle = label.color; ctx.fillText(label.text, bx + 7, by + bh / 2 + 0.5);
        ctx.restore();
      });
    }
    const slide = grew && o.animate !== false;
    if (!slide && !fresh.length) { draw(1, 1); return { empty: pts.length < 2 }; }
    let ps = slide ? 0 : 1, pf = fresh.length ? 0 : 1;
    if (slide) anim(canvas, "slide", 250, (p) => { ps = p; draw(ps, pf); });
    if (fresh.length) anim(canvas, "fade", 200, (p) => { pf = p; draw(ps, pf); });
    return { empty: pts.length < 2 };
  }

  /* ---------- Coin candles ---------- */
  function candles(canvas, o) {
    const cs = (o.candles || []).filter((c) => c && c.o != null && c.c != null).map((c) => Object.assign({}, c, { _t: tms(c.t) }))
      .sort((a, b) => a._t - b._t);
    const { ctx, w, h } = setup(canvas);
    if (!cs.length) {
      dashed(ctx, 0, w, Math.round(h * 0.5), C.ter);
      ctx.fillStyle = C.sec; ctx.font = "15px " + FONT; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(o.emptyText || "No price ticks yet", w / 2, h * 0.5 - 18);
      return;
    }
    const volH = Math.round(h * 0.2), top = 10, priceBot = h - volH - 10;
    let lo = Math.min(...cs.map((c) => +c.l)), hi = Math.max(...cs.map((c) => +c.h));
    const lines = (o.lines || []).filter((l) => l && l.price != null && isFinite(+l.price));
    lines.forEach((l) => { lo = Math.min(lo, +l.price); hi = Math.max(hi, +l.price); });
    if (hi - lo <= 0) { hi = hi * 1.01 || 1; lo = lo * 0.99; }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const n = Math.max(cs.length, 24);
    const slot = (w - 56) / n, bw = Math.max(2, Math.min(10, slot * 0.66));
    const X = (i) => 4 + slot * (n - cs.length + i) + slot / 2;
    const Y = (v) => top + (1 - (v - lo) / (hi - lo)) * (priceBot - top);
    // grid baseline
    ctx.strokeStyle = C.sep; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(0, priceBot + 4.5); ctx.lineTo(w, priceBot + 4.5); ctx.stroke();
    const dv = cs.map((c) => (c.dv == null ? null : +c.dv));
    const vmax = Math.max(0, ...dv.filter((v) => v != null));
    cs.forEach((c, i) => {
      const up = +c.c >= +c.o, col = up ? C.green : C.red, x = X(i);
      ctx.strokeStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, Y(+c.h)); ctx.lineTo(x, Y(+c.l)); ctx.stroke();
      const y0 = Y(Math.max(+c.o, +c.c)), y1 = Y(Math.min(+c.o, +c.c));
      ctx.fillStyle = col; ctx.fillRect(x - bw / 2, y0, bw, Math.max(1, y1 - y0));
      if (dv[i] != null && vmax > 0) {
        const vh = (dv[i] / vmax) * (volH - 4);
        ctx.fillStyle = up ? "rgba(0,211,90,0.45)" : "rgba(255,69,58,0.45)";
        ctx.fillRect(x - bw / 2, h - vh, bw, vh);
      }
    });
    // price axis labels (right)
    ctx.fillStyle = C.ter; ctx.font = "11px " + FONT; ctx.textAlign = "right"; ctx.textBaseline = "middle";
    const fmt = o.fmtPrice || ((v) => String(v));
    [hi - pad, lo + pad].forEach((v) => ctx.fillText(fmt(v), w - 2, Y(v)));
    lines.forEach((l) => {
      const y = Math.round(Y(+l.price));
      ctx.save(); ctx.strokeStyle = l.color || C.orange; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(w - 56, y + 0.5); ctx.stroke(); ctx.restore();
      ctx.fillStyle = l.color || C.orange; ctx.font = "600 11px " + FONT; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
      ctx.fillText(l.label || "", 4, y - 3);
    });
  }

  /* ---------- Analyst score ring ---------- */
  function ring(canvas, value, minScore, accent) {
    const { ctx, w, h } = setup(canvas);
    const r = Math.min(w, h) / 2 - 7, cx = w / 2, cy = h / 2;
    ctx.lineWidth = 10; ctx.lineCap = "round";
    ctx.strokeStyle = C.card2; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    if (value == null || isNaN(+value)) {
      ctx.fillStyle = C.ter; ctx.font = "600 28px " + FONT; ctx.fillText("—", cx, cy); return;
    }
    const v = Math.max(0, Math.min(100, +value));
    ctx.strokeStyle = v >= (minScore == null ? 70 : +minScore) ? C.green : (accent || "#ffd60a");
    ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * v) / 100); ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.font = "600 30px " + FONT; ctx.fillText(String(Math.round(v)), cx, cy);
  }

  window.GBChart = { line, candles, ring };
})();
