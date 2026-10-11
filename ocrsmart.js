// Lectura inteligente para fotos pequeñas o torcidas (p. ej. fotos de WhatsApp de 768 px).
// Las copias recortadas/ampliadas son SOLO para leer: la foto que se guarda no se toca.
(function (root) {
  const wordsOf = (data) => {
    const out = [];
    (data.blocks || []).forEach((b) => (b.paragraphs || []).forEach((p) => (p.lines || []).forEach((l) => (l.words || []).forEach((w) => out.push(w)))));
    return out;
  };
  const goodScore = (data) => wordsOf(data).reduce((s, w) => s + (w.confidence >= 70 ? Math.min(w.text.length, 12) : 0), 0);

  function canvasOf(src, scale, rect) {
    const sx = rect ? rect.x : 0, sy = rect ? rect.y : 0, sw = rect ? rect.w : src.width, sh = rect ? rect.h : src.height;
    const c = document.createElement('canvas');
    c.width = Math.max(8, Math.round(sw * scale)); c.height = Math.max(8, Math.round(sh * scale));
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }
  function rotate(c, deg) {
    if (!deg) return c;
    const o = document.createElement('canvas'), sw = deg === 90 || deg === 270;
    o.width = sw ? c.height : c.width; o.height = sw ? c.width : c.height;
    const g = o.getContext('2d'); g.translate(o.width / 2, o.height / 2); g.rotate((deg * Math.PI) / 180);
    g.drawImage(c, -c.width / 2, -c.height / 2); return o;
  }
  // Contraste para leer (copia de trabajo): estira niveles sin tocar la foto original
  function boost(c) {
    const g = c.getContext('2d', { willReadFrequently: true }), id = g.getImageData(0, 0, c.width, c.height), d = id.data;
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 16) hist[(d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) | 0]++;
    const tot = hist.reduce((s, v) => s + v, 0), pct = (p) => { let a = 0; for (let v = 0; v < 256; v++) { a += hist[v]; if (a >= tot * p) return v; } return 255; };
    const lo = pct(0.03), hi = Math.max(lo + 40, pct(0.85)), k = 255 / (hi - lo);
    for (let i = 0; i < d.length; i += 4) {
      let y = ((d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) - lo) * k; y = y < 0 ? 0 : y > 255 ? 255 : y;
      d[i] = d[i + 1] = d[i + 2] = y;
    }
    g.putImageData(id, 0, 0); return c;
  }


  // Umbral local (imagen integral): deja el texto negro y el papel blanco aunque haya sombras o poco contraste
  function binarize(c, k) {
    const w = c.width, h = c.height, g = c.getContext('2d', { willReadFrequently: true }), id = g.getImageData(0, 0, w, h), d = id.data;
    const gray = new Float32Array(w * h), ii = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        const v = d[(y * w + x) * 4] * 0.3 + d[(y * w + x) * 4 + 1] * 0.59 + d[(y * w + x) * 4 + 2] * 0.11;
        gray[y * w + x] = v; row += v;
        ii[(y + 1) * (w + 1) + x + 1] = ii[y * (w + 1) + x + 1] + row;
      }
    }
    const r = Math.max(10, Math.round(Math.max(w, h) / 24)), kk = k || 0.9;
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        const sum = ii[y1 * (w + 1) + x1] - ii[y0 * (w + 1) + x1] - ii[y1 * (w + 1) + x0] + ii[y0 * (w + 1) + x0];
        const mean = sum / ((x1 - x0) * (y1 - y0));
        const o = (y * w + x) * 4, v = gray[y * w + x] < mean * kk ? 0 : 255;
        d[o] = d[o + 1] = d[o + 2] = v;
      }
    }
    g.putImageData(id, 0, 0); return c;
  }
  // Inclinación del texto (grados) por perfil de proyección: la que deja las líneas más "marcadas"
  function skewDeg(bin) {
    const sc = Math.min(1, 520 / Math.max(bin.width, bin.height)), sm = canvasOf(bin, sc);
    let best = 0, bestV = -1;
    for (let a = -14; a <= 14; a += 1) {
      const r = rotateAny(sm, a), g = r.getContext('2d', { willReadFrequently: true }), d = g.getImageData(0, 0, r.width, r.height).data;
      const rows = new Float64Array(r.height);
      for (let y = 0; y < r.height; y++) { let s = 0; for (let x = 0; x < r.width; x++) if (d[(y * r.width + x) * 4] < 128) s++; rows[y] = s; }
      let m = 0; rows.forEach((v) => (m += v)); m /= rows.length;
      let v = 0; rows.forEach((x) => (v += (x - m) * (x - m)));
      if (v > bestV) { bestV = v; best = a; }
    }
    return best;
  }
  function rotateAny(c, deg) {
    const rad = (deg * Math.PI) / 180, w = c.width, h = c.height;
    const nw = Math.ceil(Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad))), nh = Math.ceil(Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad)));
    const o = document.createElement('canvas'); o.width = nw; o.height = nh;
    const g = o.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff'; g.fillRect(0, 0, nw, nh);
    g.translate(nw / 2, nh / 2); g.rotate(rad); g.drawImage(c, -w / 2, -h / 2); return o;
  }

  async function rec(worker, canvas, psm, params) {
    await worker.setParameters(Object.assign({ tessedit_pageseg_mode: String(psm), tessedit_char_whitelist: '' }, params || {}));
    const r = await worker.recognize(canvas, {}, { text: true, blocks: true });
    return r.data;
  }

  // Prepara la imagen de trabajo: gris + niveles; las pequeñas se amplían (el texto necesita ~30 px de alto)
  function prepare(src) {
    const long = Math.max(src.width, src.height);
    return boost(canvasOf(src, long < 2000 ? Math.min(3, 2000 / long) : 1));
  }

  // Lee con una imagen de trabajo dada: elige el giro y lee una vez
  async function readWith(worker, base) {
    let bestDeg = 0, bestScore = -1;
    for (const deg of [0, 90, 270, 180]) {
      const small = canvasOf(rotate(base, deg), Math.min(1, 1000 / Math.max(base.width, base.height)));
      const s = goodScore(await rec(worker, small, 3));
      if (s > bestScore) { bestScore = s; bestDeg = deg; }
      if (deg === 0 && s > 120) break;
    }
    const rot = rotate(base, bestDeg);
    const d = await rec(worker, canvasOf(rot, Math.min(1, 2000 / Math.max(rot.width, rot.height))), 3);
    return { text: d.text, deg: bestDeg, score: goodScore(d), rot, data: d };
  }

  // Lectura: primero rápida (contraste); si sale pobre, segunda vía con umbral local + enderezado
  async function read(worker, srcCanvas) {
    const base = prepare(srcCanvas);
    let res = await readWith(worker, base);
    if (res.score < 90) {
      const bin = binarize(canvasOf(base, 1), 0.9);
      const ang = skewDeg(bin);
      const straight = ang ? rotateAny(bin, -ang) : bin;
      const r2 = await readWith(worker, straight);
      r2.skew = ang;
      if (r2.score > res.score) res = r2;
    }
    return res;
  }

  // Líneas (con caja) de un resultado de Tesseract
  function linesOf(data) {
    const out = [];
    (data.blocks || []).forEach((b) => (b.paragraphs || []).forEach((p) => (p.lines || []).forEach((l) => out.push(l))));
    return out;
  }

  // Lectura a fondo del Settlement Report: varias lecturas de la misma foto (distintos recortes, ampliaciones y modos);
  // se detiene en cuanto una lectura cuadra consigo misma (facturas = subtotales = total) y si no, se queda con la más coherente.
  async function readReport(worker, rot, first, parse) {
    const quality = (text) => {
      const p = parse(text);
      return root.ReportParse ? root.ReportParse.score(p) + (p.consistent ? 1000 : 0) : p.rows.filter((r) => r.amount != null).length * 10;
    };
    let best = { text: first.text, q: quality(first.text), data: first.data };
    if (best.q >= 1000) return best;
    const tryRead = async (canvas, psm) => {
      const data = await rec(worker, canvas, psm);
      const q = quality(data.text);
      if (q > best.q) best = { text: data.text, q, data };
      return best.q >= 1000;
    };
    const full = canvasOf(rot, Math.min(1, 2400 / Math.max(rot.width, rot.height)));
    if (await tryRead(full, 6)) return best;
    // zona de texto (generosa: no se corta ninguna línea) ampliada
    const ws = wordsOf(first.data).filter((w) => w.confidence >= 45 && w.text.trim().length >= 2);
    const crops = [];
    if (ws.length >= 6) {
      const sc1 = Math.min(1, 2000 / Math.max(rot.width, rot.height));
      const x0 = Math.min(...ws.map((w) => w.bbox.x0)) / sc1, y0 = Math.min(...ws.map((w) => w.bbox.y0)) / sc1;
      const x1 = Math.max(...ws.map((w) => w.bbox.x1)) / sc1, y1 = Math.max(...ws.map((w) => w.bbox.y1)) / sc1;
      const mx = (x1 - x0) * 0.12 + 20, my = (y1 - y0) * 0.35 + 30;
      const rect = { x: Math.max(0, x0 - mx), y: Math.max(0, y0 - my) };
      rect.w = Math.min(rot.width - rect.x, x1 - x0 + 2 * mx); rect.h = Math.min(rot.height - rect.y, y1 - y0 + 2 * my);
      crops.push(canvasOf(rot, Math.min(2.0, 2400 / Math.max(rect.w, rect.h)), rect));
      crops.push(canvasOf(rot, Math.min(1.4, 2400 / Math.max(rect.w, rect.h)), rect));
    }
    for (const c of crops.slice(0, 1)) for (const psm of [3, 6]) if (await tryRead(c, psm)) return best;
    if (crops[1]) for (const psm of [3, 4]) if (await tryRead(crops[1], psm)) return best;
    // última vía: umbral local (deja el texto negro sobre blanco aunque haya sombras)
    const bin = binarize(canvasOf(crops[0] || full, 1), 0.92);
    for (const psm of [6, 3]) if (await tryRead(bin, psm)) return best;
    return best;
  }

  root.OcrSmart = { read, readReport, linesOf, wordsOf, canvasOf, rotate, prepare, rec, binarize, skewDeg, rotateAny };
})(window);
