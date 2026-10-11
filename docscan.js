// Detección y recorte automático del documento (OpenCV.js, carga perezosa).
(function (root) {
  const BASE = document.currentScript.src.replace(/[^/]*$/, '');
  let cvP = null;
  function loadCV() {
    if (cvP) return cvP;
    cvP = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = BASE + 'lib/opencv.js';
      s.onerror = () => reject(new Error('No cargó opencv.js'));
      s.onload = async () => {
        try {
          let c = root.cv;
          if (c instanceof Promise) c = await c;
          if (c && c.Mat) return resolve(c);
          c.onRuntimeInitialized = () => resolve(root.cv);
        } catch (e) { reject(e); }
      };
      document.head.appendChild(s);
    });
    return cvP;
  }

  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  // Orden: arriba-izq, arriba-der, abajo-der, abajo-izq
  function orderQuad(p) {
    const cx = p.reduce((s, q) => s + q[0], 0) / p.length, cy = p.reduce((s, q) => s + q[1], 0) / p.length;
    const o = [...p].sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx)); // horario en pantalla
    let i0 = 0, best = Infinity;
    o.forEach((q, i) => { const v = q[0] + q[1]; if (v < best) { best = v; i0 = i; } });
    return [0, 1, 2, 3].map((k) => o[(i0 + k) % 4]);
  }
  const polyArea = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const j = (i + 1) % p.length; a += p[i][0] * p[j][1] - p[j][0] * p[i][1]; } return Math.abs(a) / 2; };

  // Mejor cuadrilátero del documento en coordenadas del canvas, o null
  async function findDoc(canvas) {
    const cv = await loadCV();
    const S = 640 / Math.max(canvas.width, canvas.height);
    const tw = Math.round(canvas.width * S), th = Math.round(canvas.height * S);
    const t = document.createElement('canvas'); t.width = tw; t.height = th;
    t.getContext('2d').drawImage(canvas, 0, 0, tw, th);
    const src = cv.imread(t), gray = new cv.Mat(), blur = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(7, 7), 0);
    const cands = [];
    const frame = tw * th;
    const consider = (mask) => {
      const cs = new cv.MatVector(), hier = new cv.Mat();
      cv.findContours(mask, cs, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      for (let i = 0; i < cs.size(); i++) {
        const c = cs.get(i), area = cv.contourArea(c);
        if (area < 0.12 * frame) { c.delete(); continue; }
        const hull = new cv.Mat(); cv.convexHull(c, hull);
        const hullArea = cv.contourArea(hull), peri = cv.arcLength(hull, true);
        const ap = new cv.Mat(); cv.approxPolyDP(hull, ap, 0.02 * peri, true);
        let pts = [];
        if (ap.rows === 4) for (let k = 0; k < 4; k++) pts.push([ap.data32S[k * 2], ap.data32S[k * 2 + 1]]);
        else {
          const r = cv.minAreaRect(hull), v = cv.RotatedRect.points(r);
          pts = v.map((q) => [q.x, q.y]);
        }
        const qa = polyArea(pts);
        const minEdge = Math.min(dist(pts[0], pts[1]), dist(pts[1], pts[2]), dist(pts[2], pts[3]), dist(pts[3], pts[0]));
        if (new Set(pts.map((p) => p.join())).size < 4 || minEdge < 0.08 * Math.max(tw, th)) { c.delete(); hull.delete(); ap.delete(); continue; }
        const fill = hullArea / Math.max(qa, 1); // cerca de 1 = el contorno es casi un cuadrilátero
        const fit = Math.min(fill, 1 / fill);
        cands.push({ pts: orderQuad(pts), score: (qa / frame) * fit * fit * (qa / frame > 0.97 ? 0.5 : 1) });
        c.delete(); hull.delete(); ap.delete();
      }
      cs.delete(); hier.delete();
    };
    const k = (n) => cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(n, n));
    // Estrategia A: papel = zona clara (Otsu)
    const m1 = new cv.Mat();
    const th0 = cv.threshold(blur, m1, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    cv.threshold(blur, m1, th0 * 0.9, 255, cv.THRESH_BINARY);
    cv.morphologyEx(m1, m1, cv.MORPH_CLOSE, k(25));
    cv.morphologyEx(m1, m1, cv.MORPH_OPEN, k(15));
    consider(m1);
    const m1b = new cv.Mat();
    cv.morphologyEx(m1, m1b, cv.MORPH_OPEN, k(51));
    consider(m1b);
    // Estrategia B: bordes
    const m2 = new cv.Mat();
    cv.Canny(blur, m2, 40, 120);
    cv.dilate(m2, m2, k(7)); cv.morphologyEx(m2, m2, cv.MORPH_CLOSE, k(21));
    consider(m2);
    src.delete(); gray.delete(); blur.delete(); m1.delete(); m1b.delete(); m2.delete();
    if (!cands.length) return null;
    cands.sort((a, b) => b.score - a.score);
    const best = cands[0];
    if (best.score < 0.1) return null;
    return best.pts.map((p) => [p[0] / S, p[1] / S]);
  }

  // Endereza el documento al rectángulo definido por quad
  async function warp(canvas, quad) {
    const cv = await loadCV();
    const q = quad;
    const w = Math.round(Math.max(dist(q[0], q[1]), dist(q[3], q[2]))), h = Math.round(Math.max(dist(q[0], q[3]), dist(q[1], q[2])));
    const src = cv.imread(canvas), dst = new cv.Mat();
    const from = cv.matFromArray(4, 1, cv.CV_32FC2, q.flat());
    const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);
    const M = cv.getPerspectiveTransform(from, to);
    cv.warpPerspective(src, dst, M, new cv.Size(w, h), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    cv.imshow(out, dst);
    src.delete(); dst.delete(); from.delete(); to.delete(); M.delete();
    return out;
  }


  // Método clásico de DocScanner / ScanLibrary (MIT, Fahad Habib; basado en el ejemplo "squares" de OpenCV):
  // desenfoque de mediana, bordes Canny por canal de color, y se toma el cuadrilátero convexo de ángulos casi rectos más grande.
  async function findDocSquares(canvas, opts) {
    opts = opts || {};
    const cv = await loadCV();
    const S = 600 / Math.max(canvas.width, canvas.height);
    const tw = Math.round(canvas.width * Math.min(1, S)), th = Math.round(canvas.height * Math.min(1, S)), sc = tw / canvas.width;
    const t = document.createElement('canvas'); t.width = tw; t.height = th;
    t.getContext('2d').drawImage(canvas, 0, 0, tw, th);
    const src = cv.imread(t), rgb = new cv.Mat(), blur = new cv.Mat();
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
    cv.medianBlur(rgb, blur, 9);
    const frame = tw * th, found = [];
    const chans = new cv.MatVector(); cv.split(blur, chans);
    const cosAt = (p0, p1, p2) => { const dx1 = p1[0] - p0[0], dy1 = p1[1] - p0[1], dx2 = p2[0] - p0[0], dy2 = p2[1] - p0[1]; return (dx1 * dx2 + dy1 * dy2) / Math.sqrt((dx1 * dx1 + dy1 * dy1) * (dx2 * dx2 + dy2 * dy2) + 1e-10); };
    const consider = (bin) => {
      const cs = new cv.MatVector(), hier = new cv.Mat();
      cv.findContours(bin, cs, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      for (let i = 0; i < cs.size(); i++) {
        const c = cs.get(i), ap = new cv.Mat();
        cv.approxPolyDP(c, ap, cv.arcLength(c, true) * 0.02, true);
        if (ap.rows === 4 && cv.isContourConvex(ap)) {
          const area = Math.abs(cv.contourArea(ap));
          if (area > 0.12 * frame && area < 0.995 * frame) {
            const p = []; for (let k = 0; k < 4; k++) p.push([ap.data32S[k * 2], ap.data32S[k * 2 + 1]]);
            let mc = 0; for (let j = 0; j < 4; j++) mc = Math.max(mc, Math.abs(cosAt(p[j], p[(j + 1) % 4], p[(j + 3) % 4])));
            if (mc < (opts.maxCos || 0.3)) found.push({ pts: orderQuad(p), area });
          }
        }
        c.delete(); ap.delete();
      }
      cs.delete(); hier.delete();
    };
    for (let ch = 0; ch < 3; ch++) {
      const g = chans.get(ch), edges = new cv.Mat(), thr = new cv.Mat();
      cv.Canny(g, edges, 10, 20, 3); cv.dilate(edges, edges, new cv.Mat()); consider(edges);
      cv.threshold(g, thr, 127, 255, cv.THRESH_BINARY); consider(thr);
      g.delete(); edges.delete(); thr.delete();
    }
    chans.delete(); src.delete(); rgb.delete(); blur.delete();
    if (!found.length) return null;
    found.sort((a, b) => b.area - a.area);
    return found[0].pts.map((p) => [p[0] / sc, p[1] / sc]);
  }


  // Limpieza tipo escáner: el papel (con sombras) se estima con un cierre morfológico grande y se divide la imagen entre él:
  // el papel queda blanco parejo y el texto negro, sin las manchas de las sombras.
  async function cleanScan(canvas) {
    const cv = await loadCV();
    const src = cv.imread(canvas), gray = new cv.Mat(), bg = new cv.Mat(), out = new cv.Mat(), small = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    // El fondo (papel con sombras) es suave: se estima en una copia pequeña (máx. 500 px) y se amplía.
    // Igual resultado que a tamaño completo, mucho más rápido en el teléfono.
    const f = Math.min(1, 500 / Math.max(canvas.width, canvas.height));
    cv.resize(gray, small, new cv.Size(Math.max(8, Math.round(canvas.width * f)), Math.max(8, Math.round(canvas.height * f))), 0, 0, cv.INTER_AREA);
    const k = Math.max(7, Math.round(Math.max(small.cols, small.rows) / 30)) | 1;
    cv.morphologyEx(small, small, cv.MORPH_CLOSE, cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(k, k)));
    cv.GaussianBlur(small, small, new cv.Size(k, k), 0);
    cv.resize(small, bg, new cv.Size(canvas.width, canvas.height), 0, 0, cv.INTER_LINEAR);
    cv.divide(gray, bg, out, 255);
    // un poco más de contraste: lo casi blanco pasa a blanco
    const lut = new cv.Mat(1, 256, cv.CV_8U);
    for (let i = 0; i < 256; i++) lut.data[i] = Math.max(0, Math.min(255, Math.round((i - 40) * (255 / (225 - 40)))));
    cv.LUT(out, lut, out);
    const rgba = new cv.Mat(); cv.cvtColor(out, rgba, cv.COLOR_GRAY2RGBA);
    const res = document.createElement('canvas'); res.width = canvas.width; res.height = canvas.height; cv.imshow(res, rgba);
    src.delete(); gray.delete(); bg.delete(); out.delete(); small.delete(); lut.delete(); rgba.delete();
    return res;
  }


  // Ajuste fino: si el recorte dejó borde de mesa, se achica hasta el papel (el papel es bastante más claro que el borde).
  async function tightCrop(canvas) {
    const cv = await loadCV();
    const w0 = canvas.width, h0 = canvas.height, S = Math.min(1, 500 / Math.max(w0, h0));
    const t = document.createElement('canvas'); t.width = Math.round(w0 * S); t.height = Math.round(h0 * S);
    t.getContext('2d').drawImage(canvas, 0, 0, t.width, t.height);
    const src = cv.imread(t), gray = new cv.Mat(), mask = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY); cv.GaussianBlur(gray, gray, new cv.Size(7, 7), 0);
    const W = gray.cols, H = gray.rows, med = (arr) => { arr.sort((a, b) => a - b); return arr[arr.length >> 1]; };
    const border = [], center = [], bw = Math.max(2, Math.round(Math.min(W, H) * 0.04));
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
      const v = gray.data[y * W + x];
      if (x < bw || y < bw || x >= W - bw || y >= H - bw) border.push(v);
      else if (x > W * 0.3 && x < W * 0.7 && y > H * 0.3 && y < H * 0.7) center.push(v);
    }
    const bb = med(border), cc = med(center);
    let result = canvas;
    if (cc - bb >= 25) {
      cv.threshold(gray, mask, (bb + cc) / 2, 255, cv.THRESH_BINARY);
      cv.morphologyEx(mask, mask, cv.MORPH_OPEN, cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5)));
      cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(25, 25)));
      const cs = new cv.MatVector(), hier = new cv.Mat();
      cv.findContours(mask, cs, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      let best = null, bestA = 0;
      for (let i = 0; i < cs.size(); i++) { const a = cv.contourArea(cs.get(i)); if (a > bestA) { bestA = a; best = cs.get(i); } }
      if (best && bestA > 0.08 * W * H) {
        // rectángulo mínimo (inclinado): sigue la orientación del papel, así no quedan triángulos de mesa en las esquinas
        const rr = cv.minAreaRect(best), v = cv.RotatedRect.points(rr);
        const grow = 1.02, cx = rr.center.x, cy = rr.center.y;
        const pts = orderQuad(v.map((p) => [(cx + (p.x - cx) * grow) / S, (cy + (p.y - cy) * grow) / S]));
        if (rr.size.width * rr.size.height < 0.97 * W * H) result = await warp(canvas, pts);
      }
      cs.delete(); hier.delete();
    }
    src.delete(); gray.delete(); mask.delete();
    return result;
  }

  root.DocScan = { loadCV, findDoc, findDocSquares, warp, cleanScan, tightCrop };
})(window);
