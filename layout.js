// Planillas propias de cada ruta: endereza la foto, detecta la tabla (líneas) y las etiquetas (OCR) y devuelve un "layout"
// = dónde escribir cada número. Todas las coordenadas del layout están en puntos PDF, con origen ARRIBA-izquierda.
(function (root) {
  const OS = () => root.OcrSmart;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('No pude abrir la imagen')); i.src = src; }); }

  // ---------- Preparar la imagen: tamaño de trabajo y enderezado ----------
  function estimateSkew(c) {
    const small = OS().canvasOf(c, Math.min(1, 900 / Math.max(c.width, c.height)));
    const bin = OS().binarize(small, 0.9);
    const score = (a) => {
      const r = a ? OS().rotateAny(bin, a) : bin, d = r.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, r.width, r.height).data;
      const rows = new Float64Array(r.height);
      for (let y = 0; y < r.height; y++) { let s = 0; for (let x = 0; x < r.width; x++) if (d[(y * r.width + x) * 4] < 128) s++; rows[y] = s; }
      let m = 0; rows.forEach((v) => (m += v)); m /= rows.length;
      let v = 0; rows.forEach((x) => (v += (x - m) * (x - m)));
      return v / r.height;
    };
    let best = 0, bv = -1;
    for (let a = -5; a <= 5.001; a += 0.5) { const v = score(a); if (v > bv) { bv = v; best = a; } }
    const c0 = best;
    for (let a = c0 - 0.4; a <= c0 + 0.401; a += 0.1) { const v = score(a); if (v > bv) { bv = v; best = a; } }
    return Math.abs(best) < 0.15 ? 0 : best;
  }

  async function prepare(src) {
    const img = await loadImg(src), long = Math.max(img.naturalWidth, img.naturalHeight);
    const s = long < 1800 ? 2000 / long : Math.min(1, 2200 / long);
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    const ang = estimateSkew(c);
    const out = ang ? OS().rotateAny(c, ang) : c;
    out.skew = ang;
    return out;
  }

  // ---------- Líneas de la tabla ----------
  function inkOf(canvas) {
    const W = canvas.width, H = canvas.height;
    const gd = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    const bd = OS().binarize(OS().canvasOf(canvas, 1), 0.9).getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    const ink = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) ink[i] = bd[i * 4] < 128 || gd[i * 4] * 0.3 + gd[i * 4 + 1] * 0.59 + gd[i * 4 + 2] * 0.11 < 70 ? 1 : 0;
    return ink;
  }
  // Tramos continuos de tinta (tolera huecos de 2 px y líneas con 1 px de temblor). vert=false: líneas horizontales (índice = y)
  function scan(ink, W, H, vert, minLen) {
    const A = vert ? W : H, B = vert ? H : W;
    const at = (a, b) => (a < 0 || a >= A ? 0 : ink[vert ? b * W + a : a * W + b]);
    const cnt = new Float64Array(A), runs = new Array(A).fill(null);
    for (let a = 0; a < A; a++) {
      let start = -1, last = -1, gap = 0;
      const flush = () => { if (start >= 0 && last - start + 1 >= minLen) { cnt[a] += last - start + 1; (runs[a] || (runs[a] = [])).push([start, last]); } start = -1; };
      for (let b = 0; b < B; b++) {
        if (at(a - 1, b) | at(a, b) | at(a + 1, b)) { if (start < 0) start = b; last = b; gap = 0; } else if (start >= 0 && ++gap > 2) flush();
      }
      flush();
    }
    return { cnt, runs, A, B };
  }
  function groupLines(sc, frac) {
    const mx = Math.max(...sc.cnt, 1), thr = frac * mx, out = [];
    let cur = null;
    for (let a = 0; a < sc.A; a++) {
      if (sc.cnt[a] >= thr) {
        if (cur && a - cur.last <= 2) { cur.last = a; cur.rows.push(a); } else { cur = { first: a, last: a, rows: [a] }; out.push(cur); }
      }
    }
    return out.map((g) => {
      let sw = 0, sp = 0, e0 = 1e9, e1 = -1;
      g.rows.forEach((a) => { sw += sc.cnt[a]; sp += sc.cnt[a] * a; (sc.runs[a] || []).forEach((r) => { e0 = Math.min(e0, r[0]); e1 = Math.max(e1, r[1]); }); });
      return { pos: sp / sw, e0, e1, len: e1 - e0, thick: g.last - g.first + 1 };
    });
  }
  function maskOf(sc, W, H, vert) {
    const m = new Uint8Array(W * H);
    for (let a = 0; a < sc.A; a++) (sc.runs[a] || []).forEach((r) => {
      for (let da = -2; da <= 2; da++) { const aa = a + da; if (aa < 0 || aa >= sc.A) continue; for (let b = r[0]; b <= r[1]; b++) m[vert ? b * W + aa : aa * W + b] = 1; }
    });
    return m;
  }

  // ---------- Palabras (OCR) ----------
  const norm = (t) => String(t || '').toUpperCase().replace(/\s+/g, '');
  function prep(words) {
    return words.map((w) => ({ t: norm(w.text), raw: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, h: w.bbox.y1 - w.bbox.y0, cy: (w.bbox.y0 + w.bbox.y1) / 2, conf: w.confidence }));
  }
  const findW = (ws, re, pred) => ws.filter((w) => re.test(w.t) && (!pred || pred(w))).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  // Siguiente palabra con letras o números en la misma línea, a la derecha
  function nextOnLine(ws, w) {
    let best = null;
    ws.forEach((o) => { if (o !== w && /[A-Z0-9]/.test(o.t) && Math.abs(o.cy - w.cy) < 0.6 * Math.max(o.h, w.h) && o.x0 >= w.x1 - 3 && (!best || o.x0 < best.x0)) best = o; });
    return best;
  }

  // ---------- Detección de la tabla ----------
  function findTable(canvas, ink) {
    const W = canvas.width, H = canvas.height, notes = [];
    const sh = scan(ink, W, H, false, Math.round(W * 0.1)), sv = scan(ink, W, H, true, Math.round(H * 0.025));
    let lines = groupLines(sh, 0.5);
    if (lines.length < 4) { lines = groupLines(sh, 0.3); }
    if (lines.length < 4) return { err: 'No encontré las líneas de la tabla. Usa una imagen de la planilla EN BLANCO, recta y con buena luz.' };
    // cúmulo de líneas con el mismo largo/posición horizontal = la tabla
    let bestC = [];
    lines.forEach((l) => {
      const c = lines.filter((m) => Math.abs(m.e0 - l.e0) < 0.04 * W && Math.abs(m.e1 - l.e1) < 0.04 * W);
      if (c.length > bestC.length) bestC = c;
    });
    bestC.sort((a, b) => a.pos - b.pos);
    const med = (arr) => arr.slice().sort((a, b) => a - b)[Math.floor(arr.length / 2)];
    const tx0 = med(bestC.map((l) => l.e0)), tx1 = med(bestC.map((l) => l.e1));
    // tinta de texto = tinta que no es línea
    const hm = maskOf(sh, W, H, false), vm = maskOf(sv, W, H, true);
    const dens = (ya, yb) => {
      const y0 = Math.round(ya + 4), y1 = Math.round(yb - 4), x0 = Math.round(tx0 + 6), x1 = Math.round(tx1 - 6);
      if (y1 <= y0 || x1 <= x0) return 0;
      let n = 0; for (let y = y0; y < y1; y++) for (let x = x0, i = y * W + x0; x < x1; x++, i++) if (ink[i] && !hm[i] && !vm[i]) n++;
      return n / ((y1 - y0) * (x1 - x0));
    };
    const iv = [];
    for (let i = 0; i + 1 < bestC.length; i++) iv.push({ a: bestC[i].pos, b: bestC[i + 1].pos, h: bestC[i + 1].pos - bestC[i].pos, d: dens(bestC[i].pos, bestC[i + 1].pos) });
    const empt = iv.filter((v) => v.d < 0.012);
    if (empt.length < 2) return { err: 'La tabla de la planilla no está en blanco o no se ve bien. Sube la planilla vacía (sin números escritos).' };
    const mh = med(empt.map((v) => v.h));
    let bestRun = [], run = [];
    iv.forEach((v) => {
      if (v.d < 0.012 && v.h > 0.6 * mh && v.h < 1.6 * mh) run.push(v); else run = [];
      if (run.length > bestRun.length) bestRun = run.slice();
    });
    if (bestRun.length < 2) return { err: 'No pude distinguir las filas de la tabla.' };
    const first = bestRun[0], last = bestRun[bestRun.length - 1];
    const idx = iv.indexOf(first), idxL = iv.indexOf(last);
    const header = idx > 0 ? iv[idx - 1] : null, total = idxL + 1 < iv.length ? iv[idxL + 1] : null;
    // columnas: líneas verticales que cruzan todo el cuerpo
    const y0 = first.a + 4, y1 = last.b - 4, need = 0.85 * (y1 - y0), cov = new Float64Array(W);
    for (let x = 0; x < W; x++) (sv.runs[x] || []).forEach((r) => { cov[x] += Math.max(0, Math.min(r[1], y1) - Math.max(r[0], y0)); });
    const xsRaw = [];
    let cur = null;
    for (let x = Math.max(0, Math.floor(tx0 - 0.03 * W)); x < Math.min(W, Math.ceil(tx1 + 0.03 * W)); x++) {
      if (cov[x] >= need) { if (cur && x - cur.last <= 3) { cur.last = x; cur.sw += cov[x]; cur.sp += cov[x] * x; } else { cur = { last: x, sw: cov[x], sp: cov[x] * x }; xsRaw.push(cur); } }
    }
    const xs = xsRaw.map((g) => g.sp / g.sw);
    if (xs.length < 2) { xs.length = 0; xs.push(tx0, tx1); notes.push('No vi las líneas verticales: revisa las columnas.'); }
    return { W, H, tx0, tx1, body: { y0: first.a, y1: last.b, n: bestRun.length }, header, total, xs, notes };
  }

  // ---------- Armado del layout ----------
  const field = (px, k) => px && Object.assign({ x: +(px.x * k).toFixed(2), y: +(px.y * k).toFixed(2), s: +clamp(px.s * k, 6, 14).toFixed(1), maxW: +(px.maxW * k).toFixed(1) }, px.align ? { align: px.align } : {});
  // Raya (línea horizontal de tinta) para escribir encima: la más cercana a yRef dentro de la ventana, a la derecha de xMin.
  // Devuelve { xa, xb, y } o null. Escribir centrado sobre la raya evita que el texto caiga corrido.
  // ¿La línea termina en una esquina de caja (hay un lado vertical pegado a su extremo)? Una raya suelta no lo tiene
  function boxEdge(ink, W, H, xa, xb, y) {
    const vert = (x) => { let up = 0, dn = 0; for (let d = 6; d <= 26; d++) { if (y - d >= 0 && ink[(y - d) * W + x]) up++; if (y + d < H && ink[(y + d) * W + x]) dn++; } return up >= 15 || dn >= 15; };
    for (let d = -9; d <= 3; d++) if (xa + d >= 0 && vert(xa + d)) return true;
    for (let d = -3; d <= 9; d++) if (xb + d < W && vert(xb + d)) return true;
    return false;
  }
  // Rayas sueltas de una banda de la página (encabezado), de arriba abajo; cada grupo = una fila de rayas, de izquierda a derecha
  function headerLines(ink, W, H, yEnd, minLen, tol) {
    const found = [];
    for (let y = 2; y < yEnd; y++) {
      let start = -1, last = -1, gap = 0;
      const flush = () => { if (start >= 0 && last - start + 1 >= minLen && !boxEdge(ink, W, H, start, last, y)) found.push({ xa: start, xb: last, y }); start = -1; };
      for (let x = 0; x < W; x++) { if (ink[y * W + x]) { if (start < 0) start = x; last = x; gap = 0; } else if (start >= 0 && ++gap > 3) flush(); }
      flush();
    }
    const cl = []; // junta las filas de píxeles de una misma raya (grosor)
    found.sort((a, b) => a.y - b.y || a.xa - b.xa).forEach((r) => { const c = cl.find((q) => Math.abs(q.y - r.y) <= 3 && Math.abs(q.xa - r.xa) < 0.02 * W && Math.abs(q.xb - r.xb) < 0.02 * W); if (c) { c.y = (c.y + r.y) / 2; } else cl.push({ ...r }); });
    const groups = [];
    cl.sort((a, b) => a.y - b.y).forEach((r) => { const g = groups.find((q) => Math.abs(q.y - r.y) < tol); if (g) g.items.push(r); else groups.push({ y: r.y, items: [r] }); });
    return groups.map((g) => g.items.sort((a, b) => a.xa - b.xa));
  }
  function underline(ink, W, H, xMin, xMax, yRef, up, down, minLen) {
    let best = null;
    for (let y = Math.max(0, Math.round(yRef - up)); y <= Math.min(H - 1, Math.round(yRef + down)); y++) {
      let start = -1, last = -1, gap = 0;
      const flush = () => { if (start >= 0 && last - start + 1 >= minLen && !boxEdge(ink, W, H, start, last, y)) { const c = { xa: start, xb: last, y, d: Math.abs(y - yRef), len: last - start + 1 }; if (!best || c.d < best.d - 1 || (Math.abs(c.d - best.d) <= 1 && c.len > best.len)) best = c; } start = -1; };
      for (let x = Math.max(0, Math.round(xMin)); x < Math.min(W, Math.round(xMax)); x++) {
        const on = ink[y * W + x] | ink[Math.min(H - 1, y + 1) * W + x];
        if (on) { if (start < 0) start = x; last = x; gap = 0; } else if (start >= 0 && ++gap > 3) flush();
      }
      flush();
    }
    return best;
  }
  function labelField(ws, w, tx1) { // sitio de escritura a la derecha de una etiqueta; null si ya trae algo escrito
    const nx = nextOnLine(ws, w);
    if (nx && nx.x0 - w.x1 < 2.5 * w.h) return null; // ya hay texto pegado a la etiqueta
    const gapMax = nx ? nx.x0 - w.x1 - 0.6 * w.h : tx1 - w.x1;
    return { x: w.x1 + 0.5 * w.h, y: w.y1 - 0.18 * w.h, s: w.h * 0.9, maxW: Math.max(40, gapMax) };
  }

  async function analyze(kind, canvas, ocrWords, pageMax) {
    const ink = inkOf(canvas);
    const T = findTable(canvas, ink);
    if (T.err) return { err: T.err };
    const W = canvas.width, H = canvas.height;
    const maxW = (pageMax && pageMax.w) || 612, maxH = (pageMax && pageMax.h) || 792;
    const k = Math.min(maxW / W, maxH / H);
    const page = { w: +(W * k).toFixed(2), h: +(H * k).toFixed(2) };
    let ws = [];
    try { ws = prep(await ocrWords(canvas)); } catch (e) { T.notes.push('No pude leer los textos de la planilla (' + (e.message || e) + '): ajusta a mano.'); }
    const pitch = (T.body.y1 - T.body.y0) / T.body.n;
    const L = { kind, page, rows: { y0: +(T.body.y0 * k).toFixed(2), y1: +(T.body.y1 * k).toFixed(2), n: T.body.n }, fields: {}, adj: { dx: 0, dy: 0, k: 1 }, notes: T.notes };
    const rowBase = (T.body.y1 - 0.28 * pitch) * k;
    if (kind === 'cover') {
      if (T.xs.length < 3) L.notes.push('La portada debería tener 2 columnas (fecha y total): revisa.');
      const c0 = T.xs[0], c1 = T.xs.length >= 3 ? T.xs[1] : (T.xs[0] + T.xs[T.xs.length - 1]) / 2, c2 = T.xs[T.xs.length - 1];
      L.dateX = +((c0 + 0.05 * (c1 - c0)) * k).toFixed(2); L.totX = +((c1 + 0.05 * (c2 - c1)) * k).toFixed(2);
      L.size = +clamp(pitch * k * 0.62, 7, 14).toFixed(1);
      L.totY = T.total ? +((T.total.b - 0.28 * (T.total.b - T.total.a)) * k).toFixed(2) : +(rowBase + pitch * k * 1.3).toFixed(2);
      if (!T.total) L.notes.push('No encontré la fila de TOTAL WEEK: el total semanal se escribirá debajo de la tabla.');
      const wk = findW(ws, /^WK\W*$/)[0], rt = findW(ws, /^RT\W*$/)[0];
      const ib = findW(ws, /^NAME\W*$/, (w) => ws.some((o) => o.t === 'IBP' && Math.abs(o.cy - w.cy) < w.h))[0];
      const ib0 = ws.find((o) => o.t === 'IBP');
      if (wk) L.fields.week = field(labelField(ws, wk, T.tx1), k);
      else if (rt && ib0 && ib0.cy > rt.cy) { // "WK#____" se lee mal por la raya: va una línea debajo de IBP, con el mismo espaciado
        L.fields.week = field({ x: ib0.x0 + 2.9 * ib0.h, y: ib0.y1 + (ib0.y1 - rt.y1) * 0.97, s: ib0.h * 0.9, maxW: 150 }, k);
        L.notes.push('No leí "WK#": puse la semana debajo de IBP NAME; confírmalo en la vista previa.');
      } else L.notes.push('No encontré "WK#" en la portada: la semana no se escribirá (puedes dejarla impresa).');
      if (rt) { const f = labelField(ws, rt, T.tx1); if (f) L.fields.route = field(f, k); }
      if (ib) { const f = labelField(ws, ib, T.tx1); if (f) L.fields.ibp = field(f, k); }
    } else {
      L.xs = T.xs.map((x) => +(x * k).toFixed(2));
      L.size = +clamp(pitch * k * 0.55, 7, 12).toFixed(1);
      L.totY = T.total ? +((T.total.b - 0.28 * (T.total.b - T.total.a)) * k).toFixed(2) : +(rowBase + pitch * k).toFixed(2);
      // qué columna es cuál: por el encabezado leído; si no, formato estándar de 10 columnas
      const cols = { inv: 0, cash: 4, charge: 5, credit: 6 }, nCols = T.xs.length - 1;
      const colOf = (w) => { const cx = (w.x0 + w.x1) / 2; for (let i = 0; i < nCols; i++) if (cx >= T.xs[i] - 4 && cx <= T.xs[i + 1] + 4) return i; return -1; };
      const hy = T.header ? T.header.a : T.body.y0 - 2 * pitch, hb = T.body.y0;
      const hw = ws.filter((w) => w.cy > hy - 6 && w.cy < hb + 6);
      const cash = hw.filter((w) => /^CASH$/.test(w.t)).sort((a, b) => a.x0 - b.x0)[0]; // la 1ª (la otra es PYMNT CASH)
      const chg = hw.filter((w) => /^CHARGE/.test(w.t)).sort((a, b) => a.x0 - b.x0)[0]; // la 1ª (la otra es CREDIT CHARGE)
      const crd = hw.filter((w) => /^CREDIT$/.test(w.t) && hw.some((o) => /^CHARGE/.test(o.t) && o.x0 >= w.x1 - 4 && o.x0 - w.x1 < 3 * w.h && Math.abs(o.cy - w.cy) < w.h)).sort((a, b) => a.x0 - b.x0)[0];
      const read = { cash: cash && colOf(cash), charge: chg && colOf(chg), credit: crd && colOf(crd) };
      Object.keys(read).forEach((n) => { if (read[n] >= 0 && read[n] != null && (nCols !== 10 || read[n] !== cols[n])) cols[n] = read[n]; });
      if (nCols !== 10 && read.cash == null) L.notes.push('La hoja tiene ' + nCols + ' columnas (la estándar tiene 10): elige abajo cuál es Invoice, Cash, Charge y Credit.');
      cols.inv = clamp(cols.inv, 0, nCols - 1); ['cash', 'charge', 'credit'].forEach((n) => (cols[n] = clamp(cols[n], 0, nCols - 1)));
      L.cols = cols;
      const wk = findW(ws, /^WK\W*$/)[0], rt = findW(ws, /^RTE\W*$/)[0], nm = findW(ws, /^NAME\W*$/)[0], dt = findW(ws, /^\W*[DP]ATE/).sort((a, b) => b.h - a.h)[0]; // la más grande (la otra es "Start date:"); puede venir pegada a sus rayas
      if (wk) L.fields.week = field(labelField(ws, wk, T.tx1), k); else L.notes.push('No encontré "WK:" en la hoja diaria.');
      if (rt) { const ibp = ws.find((o) => o.t === 'IBP' && Math.abs(o.cy - rt.cy) < rt.h && o.x0 >= rt.x1 - 3); const f = labelField(ws, ibp || rt, T.tx1); if (f) L.fields.route = field(f, k); }
      if (nm) { const f = labelField(ws, nm, T.tx1); if (f) L.fields.ibp = field(f, k); }
      if (dt && /\//.test(dt.t)) { // "DATE__/__/__" leído como una sola palabra: tres casillas MM / DD / YY a la derecha
        const x0 = dt.x0 + (dt.x1 - dt.x0) * 0.36, x1 = T.tx1 - 0.02 * W, th = (x1 - x0) / 3;
        L.dateParts = [0, 1, 2].map((i) => ({ x: +((x0 + i * th + 0.12 * th) * k).toFixed(2), y: +((dt.y1 - 0.18 * dt.h) * k).toFixed(2) })); L.dateSize = +clamp(dt.h * k * 0.9, 7, 14).toFixed(1);
        L.notes.push('La fecha se escribió en 3 casillas: confirma en la vista previa que caigan sobre las rayas.');
      } else if (dt) {
        // una sola raya: la fecha va centrada sobre la raya (si no se ve la raya, a la derecha de la etiqueta)
        const ul = underline(ink, W, H, dt.x0, W, dt.y1, 0.3 * dt.h, 1.0 * dt.h, Math.max(30, 0.06 * W));
        if (ul) L.fields.date = field({ x: (ul.xa + ul.xb) / 2, y: ul.y - 0.25 * dt.h, s: dt.h * 0.9, maxW: (ul.xb - ul.xa) * 0.92, align: 'center' }, k);
        else { const f = labelField(ws, dt, T.tx1); if (f) L.fields.date = field(f, k); else L.notes.push('La fecha de la hoja ya trae algo escrito o no la pude ubicar.'); }
      } else L.notes.push('No encontré "DATE" en la hoja diaria: la fecha no se escribirá.');
      if (!L.fields.date || !L.fields.week) { // el OCR no leyó la etiqueta: se usan las rayas de arriba (fecha) y de la fila de Driver / ID / WK#
        const hl = headerLines(ink, W, H, Math.round(T.header ? T.header.a : T.body.y0 - 2 * pitch) - 4, Math.max(30, 0.05 * W), 0.6 * pitch);
        const sz = pitch * 0.5, put = (r) => ({ x: (r.xa + r.xb) / 2, y: r.y - 0.28 * sz * 1.5, s: sz, maxW: (r.xb - r.xa) * 0.92, align: 'center' });
        if (!L.fields.date && !L.dateParts && hl.length && hl[0].length === 1 && hl[0][0].xa > 0.45 * W) { L.fields.date = field(put(hl[0][0]), k); L.notes.push('Fecha ubicada por la raya (el lector no vio la etiqueta): confirma en la vista previa.'); }
        const row = hl.length > 1 ? hl[hl.length - 1] : null;
        if (!L.fields.week && row && row.length === 3) { L.fields.week = field(put(row[2]), k); L.notes.push('Semana (WK#) ubicada por la raya: confirma en la vista previa.'); }
        L.notes = L.notes.filter((n) => !((L.fields.date && /"DATE"/.test(n)) || (L.fields.week && /"WK:"/.test(n))));
      }
      const ts = findW(ws, /^SALES\W*$/, (w) => w.cy > T.body.y1)[0];
      if (ts) {
        const dol = ws.find((o) => /^[$§S]$/.test(o.t) && Math.abs(o.cy - ts.cy) < ts.h && o.x0 >= ts.x1 - 3 && o.x0 - ts.x1 < 3 * ts.h), base = dol || ts;
        const ul = underline(ink, W, H, base.x1, W, ts.y1, 0.3 * ts.h, 1.6 * ts.h, Math.max(30, 0.05 * W));
        L.fields.totalSales = ul
          ? field({ x: ul.xa + 0.5 * ts.h, y: ul.y - 0.25 * ts.h, s: Math.max(ts.h * 0.9, pitch * 0.5), maxW: (ul.xb - ul.xa) * 0.92 }, k)
          : field({ x: base.x1 + 0.5 * ts.h, y: ts.y1 - 0.18 * ts.h, s: ts.h * 0.9, maxW: 160 }, k);
      }
      else L.notes.push('No encontré "Total Sales $" en la hoja: no se escribirá (puedes dejarlo a mano).');
      // NO. OF INVOICES (abajo, al centro): el número de invoices del día va centrado sobre su raya
      let ni = findW(ws, /INVOICES\W*$/, (w) => w.cy > T.body.y1 + 0.5 * pitch)[0];
      if (!ni) { // el OCR de la página completa se salta las cajas pequeñas: se lee solo la franja de abajo
        try {
          const y0 = Math.round(T.body.y1 + pitch), c = document.createElement('canvas'); c.width = W; c.height = H - y0;
          c.getContext('2d').drawImage(canvas, 0, y0, W, H - y0, 0, 0, W, H - y0);
          const w2 = prep(await ocrWords(c)).map((w) => ({ ...w, y0: w.y0 + y0, y1: w.y1 + y0, cy: w.cy + y0 }));
          ni = findW(w2, /INVOICES\W*$/)[0];
        } catch (e) { /* se queda sin número de invoices */ }
      }
      if (ni) {
        const ul = underline(ink, W, H, ni.x0 - 0.02 * W, ni.x1 + 0.1 * W, ni.y1 + 0.3 * ni.h, 0, 4 * ni.h, Math.max(24, 0.04 * W));
        L.fields.invCount = ul && ul.y > ni.y1
          ? field({ x: (ul.xa + ul.xb) / 2, y: ul.y - 0.25 * ni.h, s: Math.max(ni.h, pitch * 0.5), maxW: (ul.xb - ul.xa) * 0.9, align: 'center' }, k)
          : field({ x: (ni.x0 + ni.x1) / 2, y: ni.y1 + 2.2 * ni.h, s: Math.max(ni.h, pitch * 0.5), maxW: (ni.x1 - ni.x0), align: 'center' }, k);
      }
    }
    return { layout: L, canvas };
  }

  // ---------- Layouts de las planillas que ya vienen calibradas (ruta 708) ----------
  const BUILTIN = (() => {
    const zc = 2.008, zs = 1.822, f = (v, z) => +(v / z).toFixed(2);
    const base = [382, 425, 468, 511, 555, 598, 643];
    const cover = { kind: 'cover', page: { w: 595.44, h: 697.12 }, builtin: true, size: 14, totDy: +(3 / zc).toFixed(2),
      rowYs: base.map((v) => f(v, zc)), dateX: f(120, zc), totX: f(345, zc), totY: f(693, zc), fields: { week: { x: f(215, zc), y: f(238, zc), s: 14, maxW: 80 } }, adj: { dx: 0, dy: 0, k: 1 }, notes: [] };
    const xs = [40, 165, 274, 364, 464, 543, 656, 764, 853, 947, 1045].map((v) => f(v, zs));
    const sheet = { kind: 'sheet', page: { w: 595.44, h: 768.49 }, builtin: true, size: 12, xs, rows: { y0: f(290, zs), y1: f(1077, zs), n: 20 }, totY: f(1107, zs), cols: { inv: 0, cash: 4, charge: 5, credit: 6 },
      fields: { week: { x: f(342, zs), y: f(197, zs), s: 10, maxW: 60 }, totalSales: { x: f(545, zs), y: f(1186, zs), s: 13, maxW: 140 } },
      dateParts: [{ x: f(838, zs), y: f(244, zs) }, { x: f(890, zs), y: f(244, zs) }, { x: f(940, zs), y: f(244, zs) }], dateSize: 13, rowDy: f(11, zs), adj: { dx: 0, dy: 0, k: 1 }, notes: [] };
    return { cover, sheet };
  })();

  root.LayoutDetect = { prepare, analyze, BUILTIN };
})(window);
