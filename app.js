(function () {
  const $ = (id) => document.getElementById(id);
  let toastT = 0;
  const msg = (t) => {
    $('msg').textContent = t; const el = $('toast');
    el.classList.toggle('show', !!t); clearTimeout(toastT);
    if (t && !/…$/.test(t)) toastT = setTimeout(() => el.classList.remove('show'), 6000);
  };
  const ic = (n, c = '') => `<svg class="ic ${c}"><use href="#i-${n}"/></svg>`;
  const DEF = { week: '', route: '708-100', ibp: 'RIVMAR GROUP LLC', fullInvoice: false };
  let state = { cfg: { ...DEF }, days: [], seen: [] };
  const NATIVE = !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
  const P = (n) => (window.Capacitor && Capacitor.Plugins ? Capacitor.Plugins[n] : null);
  const TYPES = { settle: 'Settlement', invoice: 'Invoice', pod: 'POD', other: 'Otro' };
  const uid = () => Math.random().toString(36).slice(2, 9);

  // ---------- Persistencia (IndexedDB, un registro, guardado con retraso) ----------
  const idb = () => new Promise((res, rej) => {
    const r = indexedDB.open('rutadsd', 3);
    r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv'); if (!db.objectStoreNames.contains('src')) db.createObjectStore('src'); if (!db.objectStoreNames.contains('dpdf')) db.createObjectStore('dpdf'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  let saveT = null;
  function save() {
    clearTimeout(saveT);
    saveT = setTimeout(async () => {
      try { (await idb()).transaction('kv', 'readwrite').objectStore('kv').put(state, 'state'); } catch (e) { /* sin persistencia */ }
    }, 400);
  }
  async function putSrc(id, url) { try { (await idb()).transaction('src', 'readwrite').objectStore('src').put(url, id); } catch (e) { /* ignore */ } }
  async function getSrc(id) {
    try { const db = await idb(); return await new Promise((res) => { const q = db.transaction('src').objectStore('src').get(id); q.onsuccess = () => res(q.result); q.onerror = () => res(null); }); } catch (e) { return null; }
  }
  // PDF ya armado de cada día guardado (se reutiliza al finalizar la semana)
  async function putDpdf(id, bytes) { try { (await idb()).transaction('dpdf', 'readwrite').objectStore('dpdf').put(bytes, id); } catch (e) { /* ignore */ } }
  async function getDpdf(id) {
    try { const db = await idb(); return await new Promise((res) => { const q = db.transaction('dpdf').objectStore('dpdf').get(id); q.onsuccess = () => res(q.result); q.onerror = () => res(null); }); } catch (e) { return null; }
  }
  // borra los PDF de días; las semanas finalizadas (clave 'wk:...') se conservan
  async function clearDpdf() {
    try { const st = (await idb()).transaction('dpdf', 'readwrite').objectStore('dpdf'); st.openCursor().onsuccess = (e) => { const c = e.target.result; if (c) { if (!String(c.key).startsWith('wk:')) c.delete(); c.continue(); } }; } catch (e) { /* ignore */ }
  }
  async function load() {
    try {
      const db = await idb();
      const v = await new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get('state'); q.onsuccess = () => res(q.result); q.onerror = () => res(null); });
      if (v) { state = { cfg: { ...DEF, ...v.cfg }, days: v.days || [], seen: v.seen || [] }; delete state.cfg.useAI; delete state.cfg.aiKey; delete state.cfg.aiModel; }
    } catch (e) { /* ignore */ }
  }

  // ---------- Imágenes ----------
  function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
  async function fileToCanvas(file, maxSide) {
    const url = URL.createObjectURL(file);
    const img = await loadImg(url);
    const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    return c;
  }
  function scaleCanvas(c, maxSide) {
    const s = Math.min(1, maxSide / Math.max(c.width, c.height));
    if (s === 1) return c;
    const o = document.createElement('canvas'); o.width = Math.round(c.width * s); o.height = Math.round(c.height * s);
    const g = o.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(c, 0, 0, o.width, o.height);
    return o;
  }
  // Limpieza suave: gris + estirar niveles (sin dividir por un fondo estimado: eso dejaba manchas fantasma)
  function flatten(c) {
    const g = c.getContext('2d', { willReadFrequently: true }), id = g.getImageData(0, 0, c.width, c.height), d = id.data;
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 28) hist[(d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) | 0]++;
    const total = hist.reduce((s, v) => s + v, 0);
    const pct = (p) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * p) return v; } return 255; };
    const lo = pct(0.02), hi = Math.max(lo + 40, pct(0.8));
    const k = 255 / (hi - lo);
    for (let i = 0; i < d.length; i += 4) {
      let y = ((d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) - lo) * k;
      y = y < 0 ? 0 : y > 255 ? 255 : y;
      d[i] = d[i + 1] = d[i + 2] = y > 215 ? 255 : y;
    }
    g.putImageData(id, 0, 0);
    return c;
  }
  function gray(c) {
    const g = c.getContext('2d', { willReadFrequently: true }), id = g.getImageData(0, 0, c.width, c.height), d = id.data;
    for (let i = 0; i < d.length; i += 4) { const y = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) | 0; d[i] = d[i + 1] = d[i + 2] = y; }
    g.putImageData(id, 0, 0); return c;
  }
  function rotateCanvas(c, deg) {
    const q = ((deg % 360) + 360) % 360; if (!q) return c;
    const o = document.createElement('canvas'), sw = q === 90 || q === 270;
    o.width = sw ? c.height : c.width; o.height = sw ? c.width : c.height;
    const g = o.getContext('2d'); g.translate(o.width / 2, o.height / 2); g.rotate((q * Math.PI) / 180);
    g.drawImage(c, -c.width / 2, -c.height / 2); return o;
  }
  const toJpeg = (c, q = 0.62) => c.toDataURL('image/jpeg', q);

  // ---------- OCR ----------
  const workers = [];
  async function getWorkers(n) {
    if (workers.length < n) msg('Cargando lector (1ª vez tarda)…');
    while (workers.length < n) workers.push(await Tesseract.createWorker('eng', 1, { workerPath: 'lib/worker.min.js', corePath: 'lib/', langPath: 'lib/', gzip: true }));
    return workers.slice(0, n);
  }
  const getWorker = async () => (await getWorkers(1))[0];
  // OCR nativo (ML Kit): reconstruye filas por posición para no perder columnas (invoice ... $ monto)
  function rowsFromBlocks(res) {
    const L = [];
    (res.blocks || []).forEach((b) => (b.lines || []).forEach((l) => { const bb = l.boundingBox; if (bb) L.push({ t: l.text, x: bb.left, cy: (bb.top + bb.bottom) / 2, h: Math.max(1, bb.bottom - bb.top) }); }));
    L.sort((p, q) => p.cy - q.cy);
    const rows = [];
    L.forEach((l) => { const r = rows.find((x) => Math.abs(x.cy - l.cy) < 0.5 * Math.max(x.h, l.h)); if (r) { r.items.push(l); r.cy = (r.cy + l.cy) / 2; } else rows.push({ cy: l.cy, h: l.h, items: [l] }); });
    return rows.map((r) => r.items.sort((p, q) => p.x - q.x).map((i) => i.t).join(' ')).join('\n');
  }
  async function ocrTess(canvas, w) { const r = await (w || await getWorker()).recognize(canvas); return { text: r.data.text, conf: r.data.confidence }; }
  async function ocr(canvas) {
    const ML = NATIVE && P('CapacitorPluginMlKitTextRecognition');
    if (ML) {
      try {
        const c = scaleCanvas(canvas, 1800);
        const r = await ML.detectText({ base64Image: c.toDataURL('image/jpeg', 0.85).split(',')[1], rotation: 0 });
        return { text: rowsFromBlocks(r), conf: 100 };
      } catch (e) { console.warn('ML Kit falló, uso Tesseract', e); }
    }
    return ocrTess(canvas);
  }

  // ¿El texto tiene la forma de un Settlement Report? (facturas con monto y un total)
  function looksLikeReport(text) {
    const t = text || '';
    // facturas, POD y settlements de inicio NO son el reporte aunque traigan un código y un monto
    if (/customer|dso\s*number|net\s*30|store\s*copy|proof|supplier|receiving|total\s*to\s*pay|inventory|collected/i.test(t)) return false;
    if (!/s[ec]ttl|variety|invoice\s*code|sub-?\s*total|\bamout\b/i.test(t)) return false;
    const p = Parser.parseSettlement(t);
    return p.rows.filter((x) => x.amount != null).length >= 1 && (p.total != null || p.blocks.some((b) => b.sub != null));
  }

  // Texto que sugiere un Settlement Report aunque el lector lo haya leído a medias
  const reportHint = (t) => /s[ec]ttl|variety|invoice\s*code|sub-?\s*total/i.test(t || '');

  // Lee la foto. La imagen que se guarda es la foto COMPLETA en blanco y negro (sin recortar);
  // para leer se usan copias ampliadas/recortadas que no se guardan.
  // Página que se guarda en el PDF. Con "recortar" activo busca el papel (método de DocScanner, MIT) y lo endereza; si no lo
  // encuentra deja la foto completa. La lectura de números NO depende de este recorte (siempre se lee la foto original).
  async function makeOut(file, color) {
    let base = color, quadN = null, srcUrl = null;
    if (!file.__native && state.cfg.autoCrop !== false) {
      try {
        srcUrl = toJpeg(scaleCanvas(color, 2000), 0.75);
        const quad = await DocScan.findDocSquares(color);
        if (quad) { quadN = quad.map((p) => [p[0] / color.width, p[1] / color.height]); base = await DocScan.tightCrop(await DocScan.warp(color, quad)); }
      } catch (e) { console.warn('recorte automático falló', e); }
    }
    const s2 = Math.min(1, 2000 / Math.max(base.width, base.height));
    const out = document.createElement('canvas');
    out.width = Math.max(8, Math.round(base.width * s2)); out.height = Math.max(8, Math.round(base.height * s2));
    out.getContext('2d').drawImage(base, 0, 0, out.width, out.height);
    let res = out;
    if (!file.__native) {
      // limpieza tipo escáner (papel blanco parejo, sin sombras); si OpenCV no está disponible, la limpieza simple de siempre
      try { res = state.cfg.autoCrop !== false ? await DocScan.cleanScan(out) : flatten(out); } catch (e) { res = flatten(out); }
    }
    return { out: res, quadN, srcUrl };
  }
  // Las primeras fotos de cada lote (reporte, settlement) traen todos los datos: solo esas se leen con OCR.
  const OCR_FIRST = 3;
  // El resto de las fotos del día solo se limpian para el PDF, sin OCR
  async function lightPhoto(file) {
    const color = await fileToCanvas(file, 2600);
    const mk = await makeOut(file, color);
    return { canvas: mk.out, text: '', conf: 0, type: 'other', rot: 0, srcUrl: mk.srcUrl, quadN: mk.quadN, light: true };
  }
  const pcStats = { n: 0, err: 0 };
  async function readPhoto(file, w) {
    const color = await fileToCanvas(file, 2600);          // original en color: para leer
    const mk = await makeOut(file, color);                  // la que se guarda: recortada (si está activado) y limpia
    let out = mk.out;
    let text = '', conf = 0, type = 'other', rot = 0;
    // 0) Lector de la PC (PaddleOCR local, gratis): el más exacto con fotos de celular
    if (PcOcr.available && !file.__skipPc) {
      try {
        const d = await PcOcr.read(color, file);
        pcStats.n++;
        let t = Parser.classify(d.text);
        if (t === 'other' && looksLikeReport(d.text)) t = 'report';
        const pdeg = d.deg || 0;
        return { canvas: pdeg ? rotateCanvas(out, pdeg) : out, text: d.text, conf: 100, type: t, rot: pdeg, srcUrl: mk.srcUrl, quadN: mk.quadN, pc: true };
      } catch (e) {
        pcStats.err++;
        console.warn('Lector de la PC falló, uso el lector del teléfono', e);
      }
    }
    const ML = NATIVE && P('CapacitorPluginMlKitTextRecognition');
    // 1) Nativo: ML Kit (rápido), probando giros
    if (ML) {
      for (const deg of [0, 90, 270, 180]) {
        const rc = rotateCanvas(color, deg), r = await ocr(rc), t = Parser.classify(r.text);
        if (deg === 0 || t !== 'other') { text = r.text; type = t; rot = deg; }
        if (t !== 'other') break;
      }
    }
    const weak = type === 'other' || (type === 'report' && !Parser.parseSettlement(text).consistent);
    // 2) Sin reconocer, o reporte que no cuadra: lectura inteligente con Tesseract (amplía, prueba giros, umbral local)
    if (weak) {
      const tw = w || await getWorker();
      const f = await OcrSmart.read(tw, color);
      let t2 = f.text, ty2 = Parser.classify(t2);
      // 3) Reporte (o algo que lo parece): lectura a fondo para no perder facturas ni montos
      if (ty2 === 'report' || reportHint(t2)) {
        const b = await OcrSmart.readReport(tw, f.rot, f, Parser.parseSettlement);
        t2 = b.text; ty2 = Parser.classify(t2);
        if (ty2 === 'other' && looksLikeReport(t2)) ty2 = 'report';
      }
      // se queda con la lectura más coherente
      const s1 = type === 'report' ? ReportParse.score(Parser.parseSettlement(text)) + (Parser.parseSettlement(text).consistent ? 100 : 0) : -1;
      const s2 = ty2 === 'report' ? ReportParse.score(Parser.parseSettlement(t2)) + (Parser.parseSettlement(t2).consistent ? 100 : 0) : (ty2 !== 'other' ? 0 : -2);
      if (!ML || type === 'other' || s2 > s1) { text = t2; type = ty2; rot = f.deg; }
    }
    if (type === 'other' && looksLikeReport(text)) type = 'report';
    if (rot) out = rotateCanvas(out, rot);
    return { canvas: out, text, conf, type, rot, srcUrl: mk.srcUrl, quadN: mk.quadN };
  }

  // ---------- Modelo de días ----------
  const newDay = (date = '') => ({ id: uid(), date, settleNo: '', cash: {}, rows: [], total: null, hasReport: false, reportThumb: '', pages: [] });
  // Si el usuario corrige filas, el total del día (y de la hoja del PDF) pasa a ser la suma de las filas
  // Credit = monto negativo; Charge/Cash = positivo. El teclado numérico del teléfono no trae el signo menos: la columna lo decide
  const fixSign = (r) => { if (r.amount == null || isNaN(r.amount)) return; if (r.col === 6) r.amount = -Math.abs(r.amount); else if (r.col === 4 || r.col === 5) r.amount = Math.abs(r.amount); };
  const recalcTotal = (d) => { d.total = Math.round(sumDay(d) * 100) / 100; d.totalDerived = true; d.reportOk = true; };
  const sumDay = (d) => d.rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const money = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function applyReport(day, text, thumb) {
    const p = Parser.parseSettlement(text);
    day.rows = p.rows.map((r) => ({ store: r.store, invoice: r.invoice, amount: r.amount }));
    day.total = p.total; day.hasReport = true; day.reportThumb = thumb; day.reportOk = !!p.consistent; day.fixes = p.fixed || 0; day.totalDerived = !!p.totalDerived;
    if (!day.date && p.date) day.date = p.date;
    day.reportDate = p.date;
    markCash(day); analyze(day);
  }
  function markCash(day) {
    day.rows.forEach((r) => delete r.col);
    const idx = Parser.cashSubset(day.rows, day.cash && day.cash.cashSales);
    if (idx) idx.forEach((i) => (day.rows[i].col = 4));
  }
  // Empareja cada foto con su fila del reporte y verifica el total impreso
  function analyze(day) {
    day.pages.forEach((p) => {
      p.row = -1; p.warn = '';
      if (p.type !== 'invoice' && p.type !== 'pod') return;
      p.row = Parser.matchInvoice(p.text || '', day.rows); // solo para ordenar; el settlement manda
    });
  }
  function sortByReport(day) {
    // Orden del día: settlement primero; luego por factura en el orden del reporte (invoice, después su POD).
    // Una foto sin factura reconocida se queda pegada a la anterior.
    let prev = -1;
    const items = day.pages.map((p, i) => {
      const matched = p.type !== 'settle' && p.row >= 0;
      const rank = p.type === 'settle' ? -1 : matched ? p.row : prev;
      prev = rank;
      return { p, i, rank, t: matched ? (p.type === 'invoice' ? 0 : 1) : 2 };
    });
    items.sort((a, b) => a.rank - b.rank || a.t - b.t || a.i - b.i);
    day.pages = items.map((x) => x.p);
  }

  // ---------- Fotos repetidas, días y reconciliación ----------
  // Huella de 16x16 (256 bits): dos fotos casi iguales quedan a pocos bits de distancia
  function fingerprint(c) {
    const s = document.createElement('canvas'); s.width = s.height = 16;
    const g = s.getContext('2d', { willReadFrequently: true }); g.drawImage(c, 0, 0, 16, 16);
    const d = g.getImageData(0, 0, 16, 16).data, v = [];
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) { const y = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; v.push(y); sum += y; }
    const avg = sum / v.length;
    return v.map((y) => (y > avg ? '1' : '0')).join('');
  }
  const hamming = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };
  const fileKey = (f) => (f.lastModified && f.size && !/^(scan|cam)-/.test(f.name) ? f.name + '|' + f.size + '|' + f.lastModified : null);
  // Dos hojas distintas con el mismo formato (otro día, otra factura) se parecen en la huella: además
  // deben compartir los números largos leídos (invoice, fecha, montos) para contar como repetidas.
  const sigOfText = (t) => new Set(String(t || '').match(/\d{4,}/g) || []);
  function sameText(a, b) {
    if (!a.size || !b.size) return true;                    // sin números legibles: manda la huella
    let n = 0; a.forEach((x) => { if (b.has(x)) n++; });
    return n / Math.min(a.size, b.size) >= 0.7;
  }
  function isDuplicate(fp, text) {
    const sg = sigOfText(text);
    for (const d of state.days) {
      if (d.reportFp && hamming(d.reportFp, fp) <= 6 && sameText(sg, new Set(d.reportSig || []))) return true;
      for (const p of d.pages) if (p.fp && hamming(p.fp, fp) <= 6 && sameText(sg, sigOfText(p.text))) return true;
    }
    return false;
  }
  const dayByDate = (date) => (date ? state.days.find((d) => d.date === date) : null);
  const compatible = (d, date) => !d.date || !date || d.date === date;

  // Une los días con la misma fecha (un solo día por fecha; un solo reporte y un solo settlement)
  function mergeSameDate() {
    const seen = {};
    state.days = state.days.filter((d) => {
      if (!d.date) return true;
      const a = seen[d.date];
      if (!a) { seen[d.date] = d; return true; }
      if (d.hasReport && (!a.hasReport || d.rows.length > a.rows.length)) { a.rows = d.rows; a.total = d.total; a.hasReport = true; a.reportThumb = d.reportThumb; a.reportFp = d.reportFp; a.reportSig = d.reportSig; }
      if (!a.settleNo) a.settleNo = d.settleNo;
      if (!(a.cash && a.cash.cashSales != null)) a.cash = d.cash;
      d.pages.forEach((p) => {
        if (p.type === 'settle' && a.pages.some((q) => q.type === 'settle')) return;
        if (p.fp && a.pages.some((q) => q.fp && hamming(q.fp, p.fp) <= 6 && sameText(sigOfText(q.text), sigOfText(p.text)))) return;
        a.pages.push(p);
      });
      return false;
    });
  }
  // Una foto de invoice/POD que pertenece a las facturas de otro día se mueve a ese día
  function reconcile() {
    for (const d of state.days) {
      for (const p of [...d.pages]) {
        if (p.type !== 'invoice' && p.type !== 'pod') continue;
        if (Parser.matchInvoice(p.text || '', d.rows) >= 0) continue;
        const owners = state.days.filter((x) => x !== d && x.rows.length && Parser.matchInvoice(p.text || '', x.rows) >= 0);
        if (owners.length === 1) { d.pages.splice(d.pages.indexOf(p), 1); owners[0].pages.push(p); }
      }
    }
  }

  // Los códigos de factura de un reporte son consecutivos: uno repetido o que pertenece a otro día
  // (error de lectura, p. ej. 5748 leído como 5743) se sustituye por el único número que falta
  function repairCodes() {
    const days = state.days.filter((d) => d.hasReport && d.rows.length);
    for (const d of days) {
      const others = new Set(days.filter((x) => x !== d).flatMap((x) => x.rows.map((r) => String(r.invoice))));
      const seen = new Set(), bad = [];
      d.rows.forEach((r, i) => { const k = String(r.invoice); if (!k || others.has(k) || seen.has(k)) bad.push(i); else seen.add(k); });
      if (bad.length !== 1) continue;
      const nums = [...seen].map(Number).filter(Number.isFinite);
      if (nums.length < 2) continue;
      const lo = Math.min(...nums), hi = Math.max(...nums), missing = [];
      for (let n = lo; n <= hi; n++) if (!seen.has(String(n)) && !others.has(String(n))) missing.push(n);
      if (missing.length === 1) d.rows[bad[0]].invoice = String(missing[0]);
    }
  }

  // Las importaciones se encadenan: nunca se pierde un lote porque haya otro en curso
  let chain = Promise.resolve();
  function importPhotos(files) {
    chain = chain.then(() => importNow(files)).catch((e) => console.error(e));
    return chain;
  }
  async function importNow(files) {
    state.seen = state.seen || [];
    let skipped = 0;
    try {
      // Lectura en paralelo con varios lectores; la asignación a días sigue en el orden de las fotos
      pcStats.n = pcStats.err = 0;
      const usePc = PcOcr.available;
      const lanes = usePc ? 3 : NATIVE ? 2 : Math.min(3, Math.max(1, (navigator.hardwareConcurrency || 4) - 1));
      const pool = usePc ? Array.from({ length: lanes }, () => null) : await getWorkers(lanes);
      const todo = files.map((f) => ({ f, key: fileKey(f), skip: false, p: null, res: null }));
      todo.forEach((t) => { if (t.key && state.seen.includes(t.key)) t.skip = true; });
      let nextRead = 0, consumed = 0, batchCur = null;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const lane = async (w) => {
        for (;;) {
          const i = nextRead++;
          if (i >= todo.length) return;
          while (i - consumed > lanes + 1) await sleep(60);           // no se adelanta demasiado (memoria)
          const t = todo[i];
          if (t.skip) { t.res = Promise.resolve(null); continue; }
          t.res = (i < OCR_FIRST ? readPhoto(t.f, w) : lightPhoto(t.f)).catch((e) => { console.error(e); return { error: e }; });
          await t.res;
        }
      };
      const lanesP = pool.map((w) => lane(w));
      let n = 0;
      for (const t of todo) {
        n++; $('prog').textContent = `Foto ${n}/${files.length}…`; msg(`Leyendo foto ${n}/${files.length}…`);
        while (!t.res) await sleep(40);
        const f = t.f, key = t.key;
        if (t.skip) { skipped++; consumed++; continue; }
        const r = await t.res;
        consumed++;
        if (!r || r.error) { skipped++; continue; }
        const big = r.canvas, fp = fingerprint(big);
        if (key) state.seen.push(key);
        if (r.light) {
          let target = batchCur || state.days[state.days.length - 1];
          if (!target) { target = newDay(''); state.days.push(target); }
          const pid = uid(); if (r.srcUrl) await putSrc(pid, r.srcUrl);
          target.pages.push({ id: pid, dataUrl: toJpeg(gray(scaleCanvas(big, 1500))), type: 'other', text: '', rot: 0, fp, quadN: r.quadN });
          continue;
        }
        if (isDuplicate(fp, r.text)) { skipped++; continue; }
        // Un "reporte" sin ningún invoice con monto no es reporte: nunca crea día
        if (r.type === 'report' && !Parser.parseSettlement(r.text).rows.some((x) => x.amount != null)) r.type = 'other';
        const photoUrl = toJpeg(gray(scaleCanvas(big, 1500)));
        let cur = state.days[state.days.length - 1];
        if (r.type === 'settle') {
          const m = Parser.parseMarker(r.text);
          let target = dayByDate(m.date);
          if (target && target.pages.some((p) => p.type === 'settle')) { skipped++; continue; } // ese día ya tiene su settlement
          if (!target && cur && cur.hasReport && !cur.pages.length && compatible(cur, m.date)) target = cur;
          if (target) { target.settleNo = m.settleNo; target.cash = m.cash; if (!target.date) target.date = m.date; }
          else { target = newDay(m.date); target.settleNo = m.settleNo; target.cash = m.cash; state.days.push(target); }
          { const pid = uid(); if (r.srcUrl) await putSrc(pid, r.srcUrl); target.pages.push({ id: pid, dataUrl: photoUrl, type: 'settle', text: r.text.slice(0, 4000), rot: r.rot, fp, quadN: r.quadN }); }
          cur = target;
        } else if (r.type === 'report') {
          const thumb = toJpeg(gray(scaleCanvas(big, 1300)), 0.6);
          const parsed = Parser.parseSettlement(r.text), rd = parsed.date;
          let target = dayByDate(rd)
            || (cur && !cur.hasReport && compatible(cur, rd) ? cur : null)
            || state.days.find((d) => !d.hasReport && compatible(d, rd));
          if (!target) { target = newDay(rd); state.days.push(target); }
          // Un reporte ya leído solo se reemplaza por otro con igual o más facturas (mejor lectura)
          if (!target.hasReport || parsed.rows.length >= target.rows.length) { applyReport(target, r.text, thumb); target.reportFp = fp; target.reportSig = [...sigOfText(r.text)]; }
          else skipped++;
          cur = target;
        } else {
          let target = cur;
          if (r.type === 'invoice' || r.type === 'pod') {
            const owners = state.days.filter((d) => d.rows.length && Parser.matchInvoice(r.text, d.rows) >= 0);
            if (owners.length === 1) target = owners[0];
          }
          if (!target) { target = newDay(''); state.days.push(target); }
          { const pid = uid(); if (r.srcUrl) await putSrc(pid, r.srcUrl); target.pages.push({ id: pid, dataUrl: photoUrl, type: r.type, text: r.text.slice(0, 4000), rot: r.rot, fp, quadN: r.quadN }); }
          cur = target;
        }
        batchCur = cur;
      }
      await Promise.all(lanesP);
      mergeSameDate(); repairCodes(); reconcile();
      if (batchCur) openDays.add(batchCur.id);
      state.days.forEach((d) => { markCash(d); analyze(d); sortByReport(d); });
      let extra = '';
      if (pcStats.n) extra += ` Lector de la PC: ${pcStats.n} foto(s)` + (pcStats.err ? `, ${pcStats.err} con el lector del teléfono.` : '.');
      msg(`${files.length - skipped} foto(s) procesadas` + (skipped ? `, ${skipped} repetida(s) omitida(s).` : '.') + extra); $('prog').textContent = '';
    } catch (e) { console.error(e); msg('Error: ' + e.message); }
    render(); save();
  }
  // Vuelve a leer una foto ya subida (después de girarla o corregirla) y actualiza el día
  async function rereadPage(day, i) {
    const pg = day.pages[i];
    if (!pg) return;
    msg('Releyendo la foto…');
    const img = await loadImg(pg.dataUrl);
    const base = document.createElement('canvas'); base.width = img.naturalWidth; base.height = img.naturalHeight;
    base.getContext('2d').drawImage(img, 0, 0);
    let best = null;
    const engines = NATIVE ? [ocr, ocrTess] : [ocr];
    for (const eng of engines) {
      for (const deg of [0, 90, 270, 180]) {
        const rc = rotateCanvas(base, deg), r = await eng(rc);
        let type = Parser.classify(r.text);
        if (type === 'other' && looksLikeReport(r.text)) type = 'report';
        const score = type === 'report' ? (Parser.parseSettlement(r.text).rows.length + 100) : type !== 'other' ? 50 : 0;
        if (!best || score > best.score) best = { score, type, text: r.text, deg, canvas: rc };
        if (score >= 100 || (type !== 'other' && type !== 'report')) break;
      }
      if (best && best.score >= 50) break;
    }
    if (best.type === 'report' && Parser.parseSettlement(best.text).rows.some((x) => x.amount != null)) {
      applyReport(day, best.text, toJpeg(gray(scaleCanvas(best.canvas, 1300)), 0.6));
      day.reportFp = pg.fp || fingerprint(best.canvas);
      day.pages.splice(i, 1);
      msg('Reporte leído: ' + day.rows.length + ' facturas.');
    } else {
      if (best.deg) { pg.dataUrl = toJpeg(gray(scaleCanvas(best.canvas, 1500))); pg.rot = ((pg.rot || 0) + best.deg) % 360; }
      pg.type = best.type === 'report' ? 'other' : best.type; pg.text = best.text.slice(0, 4000);
      analyze(day); sortByReport(day);
      msg(best.type === 'other' ? 'No pude reconocer esta foto. Revisa que se vea completa, o cambia su tipo con "tipo".' : 'Foto reconocida como ' + (TYPES[pg.type] || pg.type) + '.');
    }
    render(); save();
  }

  async function rotatePage(day, i, deg = 90) {
    const pg = day.pages[i], img = await loadImg(pg.dataUrl);
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0); pg.dataUrl = toJpeg(rotateCanvas(c, deg)); pg.rot = ((pg.rot || 0) + deg) % 360; render(); save();
    if (pg.type === 'other') await rereadPage(day, i); // al girar una foto no reconocida, se vuelve a leer sola
  }

  // ---------- Archivo: PDF de días y semanas guardados en la app; el usuario decide cuándo borrarlos ----------
  let arch = [];
  async function loadArch() {
    try {
      const db = await idb();
      const v = await new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get('archive'); q.onsuccess = () => res(q.result); q.onerror = () => res(null); });
      if (Array.isArray(v)) arch = v;
    } catch (e) { /* ignore */ }
  }
  async function saveArch() { try { (await idb()).transaction('kv', 'readwrite').objectStore('kv').put(arch, 'archive'); } catch (e) { /* ignore */ } }
  const fmtDate = (t) => new Date(t).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' });
  function renderArchive() {
    const box = $('archive'), saved = state.days.filter((d) => d.savedSig).sort((a, b) => PdfGen.dateKey(a.date) - PdfGen.dateKey(b.date));
    box.hidden = !saved.length && !arch.length;
    const f = (icon, name, meta, dl, del) => `<div class="f"><span class="f-ic">${ic(icon)}</span><span class="f-main"><div class="f-name">${name}</div><div class="f-meta">${meta}</div></span>
      <button class="iconbtn" ${dl} aria-label="Descargar">${ic('download', 'sm')}</button><button class="iconbtn bad" ${del} aria-label="Borrar">${ic('trash', 'sm')}</button></div>`;
    const rows = [];
    saved.forEach((d) => rows.push(f('doc', dayFile(d), 'PDF del día · guardado en la app', `data-a="dl-day" data-id="${d.id}"`, `data-a="del-day" data-id="${d.id}"`)));
    arch.forEach((w) => rows.push(f('stack', w.name, `Semana finalizada · ${fmtDate(w.ts)} · ${(w.size / 1048576).toFixed(1)} MB`, `data-a="dl-week" data-id="${w.id}"`, `data-a="del-week" data-id="${w.id}"`)));
    box.innerHTML = `<h2>Archivos guardados</h2><p style="margin:0 0 6px;color:var(--mut);font-size:13px">Nada se borra solo: tú decides cuándo.</p>${rows.join('')}`;
  }
  $('archive').addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const a = b.dataset.a, id = b.dataset.id;
    if (a === 'dl-day') { const d = state.days.find((x) => x.id === id), by = await getDpdf(id); if (d && by) await savePdf(by, dayFile(d)); }
    else if (a === 'del-day') { const d = state.days.find((x) => x.id === id); if (!d || !confirm('¿Borrar el PDF guardado de este día? El día y sus fotos siguen en pantalla.')) return; await putDpdf(id, null); delete d.savedSig; save(); render(); }
    else if (a === 'dl-week') { const w = arch.find((x) => x.id === id), by = await getDpdf('wk:' + id); if (w && by) await savePdf(by, w.name); else msg('No encuentro ese archivo.'); }
    else if (a === 'del-week') { const w = arch.find((x) => x.id === id); if (!w || !confirm('¿Borrar "' + w.name + '" de la app?')) return; await putDpdf('wk:' + id, null); arch = arch.filter((x) => x.id !== id); await saveArch(); renderArchive(); }
    else if (a === 'clear-days') {
      if (!confirm('¿Borrar TODOS los días, fotos y PDF de días de la pantalla? Los PDF de semanas finalizadas no se tocan.')) return;
      for (const d of state.days) await putDpdf(d.id, null);
      state = { cfg: { ...state.cfg, week: '' }, days: [], seen: [] }; render(); save(); msg('Semana nueva lista.');
    }
  });

  // Firma del contenido de un día: si cambia después de guardarlo, hay que guardarlo de nuevo
  const hash = (str) => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return String(h); };
  function sigOf(d) {
    const p = activeProf(), t = (k) => { const x = p[k]; return [x.on, x.builtin, x.adj, x.layout, x.img ? x.img.length : 0]; };
    const c = state.cfg;
    return hash(JSON.stringify([d.date, d.total, d.rows, d.pages.map((g) => [g.id, g.dataUrl.length]), t('sheet'), c.week, c.route, c.ibp, c.fullInvoice]));
  }
  const dayFile = (d) => 'Day ' + (d.date || 'XX').slice(0, 5).replace('/', '-') + ' – Route # ' + (state.cfg.route || '').split('-')[0] + '.pdf';
  async function saveDay(d) {
    if (!d.rows.length && !d.pages.length) return msg('Este día está vacío.');
    if (!d.hasReport && !confirm('Este día no tiene la foto del Settlement Report (la hoja saldrá vacía). ¿Guardar igual?')) return;
    try {
      msg('Armando el PDF del día…');
      const bytes = await PdfGen.buildDay(state.cfg, d, { cover: null, sheet: await getTpl('sheet') });
      await putDpdf(d.id, bytes); d.savedSig = sigOf(d); save(); render();
      await savePdf(bytes, dayFile(d));
      msg('Día guardado: ' + dayFile(d) + '. Cuando termines todos los días toca Finalizar semana.');
    } catch (e) { console.error(e); msg('Error guardando el día: ' + e.message); }
  }

  // ---------- Render ----------
  const esc = (s) => String(s ?? '').replace(/"/g, '&quot;');
  const openDays = new Set();
  let openInit = false;
  const WD = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'], MO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  function dayTitle(date) {
    const m = String(date || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return date || '(sin fecha)';
    const dt = new Date(+m[3], +m[1] - 1, +m[2]);
    if (isNaN(dt)) return date;
    const w = WD[dt.getDay()];
    return w.charAt(0).toUpperCase() + w.slice(1) + ' ' + dt.getDate() + ' ' + MO[dt.getMonth()] + (dt.getFullYear() !== new Date().getFullYear() ? ' ' + dt.getFullYear() : '');
  }
  function render() {
    $('week').value = state.cfg.week; $('route').value = state.cfg.route; $('ibp').value = state.cfg.ibp; $('fullInv').checked = !!state.cfg.fullInvoice;
    $('hdrSub').textContent = [state.cfg.week ? 'Semana ' + state.cfg.week : '', state.cfg.route].filter(Boolean).join(' · ') || 'Armar semana';
    renderProfiles(); renderArchive();
    $('ocrServer').value = state.cfg.ocrServer || ''; $('autoCrop').checked = state.cfg.autoCrop !== false;
    const box = $('days'); box.innerHTML = '';
    const days = [...state.days].sort((a, b) => PdfGen.dateKey(a.date) - PdfGen.dateKey(b.date));
    if (!openInit && days.length) { openDays.add(days[days.length - 1].id); openInit = true; }
    let week = 0;
    days.forEach((d) => {
      const t = sumDay(d); const dayTot = d.total != null ? d.total : t; week += dayTot;
      const inv = d.pages.filter((p) => p.type === 'invoice').length, pod = d.pages.filter((p) => p.type === 'pod').length;
      const open = openDays.has(d.id);
      const saved = d.savedSig && d.savedSig === sigOf(d), changed = d.savedSig && !saved;
      const pill = !d.hasReport ? '<span class="pill warn">Falta reporte</span>' : changed ? '<span class="pill warn">Cambió</span>' : saved ? `<span class="pill ok">${ic('check', 'sm')}Guardado</span>` : '<span class="pill">Sin guardar</span>';
      const thumb = d.pages[0] ? `<img src="${d.pages[0].dataUrl}" alt="">` : d.reportThumb ? `<img src="${d.reportThumb}" alt="">` : ic('doc');
      const meta = (d.pages.length ? `${d.pages.length} págs` : 'sin fotos') + (inv ? ` · ${inv} inv` : '') + (pod ? ` · ${pod} POD` : '') + (d.rows.length ? ` · ${d.rows.length} facturas` : '');
      const el = document.createElement('article'); el.className = 'day' + (open ? ' open' : '');
      el.innerHTML = `
        <button class="day-head" data-act="toggle" aria-expanded="${open}">
          <span class="day-thumb">${thumb}</span>
          <span class="day-main"><span class="day-title">${dayTitle(d.date)}</span><span class="day-sub">${meta}</span></span>
          <span class="day-side"><span class="day-total">$${money(dayTot)}</span>${pill}</span>
          ${ic('chev', 'chev')}
        </button>
        <div class="day-body" ${open ? '' : 'hidden'}>
          <div class="actions">
            <button class="primary" data-act="saveday">${ic('doc')}Guardar día (PDF)</button>
            ${d.reportThumb ? `<button class="ghost sm" data-act="viewrep">${ic('eye', 'sm')}Ver reporte</button>` : ''}
            <button class="ghost sm" data-act="sort">${ic('sort', 'sm')}Ordenar fotos</button>
          </div>
          ${d.hasReport ? '' : `<div class="note warn">${ic('alert', 'sm')}<span>Falta la foto del Settlement Report de este día: de ahí salen los datos de la hoja.</span></div>`}
          ${changed ? `<div class="note warn">${ic('info', 'sm')}<span>Cambió desde que lo guardaste. Guárdalo de nuevo.</span></div>` : ''}
          <div class="row" style="align-items:flex-end;margin-top:4px">
            <div class="grow"><label>Fecha (MM/DD/AAAA)</label><input type="text" data-f="date" value="${esc(d.date)}" placeholder="10/06/2026" inputmode="numeric"></div>
            ${d.cash && d.cash.cashSales > 0 ? `<span class="pill" style="margin-bottom:10px">Efectivo $${money(d.cash.cashSales)}</span>` : ''}
          </div>
          <h3>Facturas</h3>
          <table><thead><tr><th>Invoice #</th><th>Monto</th><th>Col.</th><th></th></tr></thead><tbody></tbody></table>
          <button class="sec sm" data-act="addrow">${ic('plus', 'sm')}Agregar fila</button>
          <div class="tot"><span>Total del día</span><span>$${money(dayTot)}</span></div>
          ${d.hasReport && d.reportOk === false && !d.totalDerived ? `<div class="note bad">${ic('alert', 'sm')}<span>Este reporte no cuadra consigo mismo: puede faltar una factura o haber un número mal leído. Compáralo con la foto (Ver reporte) y corrige la tabla.</span></div>` : ''}
          ${d.hasReport && d.totalDerived ? `<div class="note">${ic('info', 'sm')}<span>El total sale de sumar las facturas. Confirma con la foto que estén todas.</span></div>` : ''}
          ${d.hasReport && d.fixes ? `<div class="note">${ic('info', 'sm')}<span>Corregí ${d.fixes} valor(es) con las sumas del propio reporte.</span></div>` : ''}
          <h3>Páginas${d.pages.length ? ' · ' + d.pages.length : ''}</h3>
          <div class="thumbs"></div>
          <button class="danger linkdel" data-act="delday">${ic('trash', 'sm')}Borrar este día</button>
        </div>`;
      const tb = el.querySelector('tbody');
      d.rows.forEach((r, i) => {
        const tr = document.createElement('tr'), col = r.col ?? (r.amount < 0 ? 6 : 5);
        tr.innerHTML = `<td><input type="text" inputmode="numeric" data-r="${i}" data-k="invoice" value="${esc(r.invoice)}" aria-label="Invoice"></td>
          <td style="width:84px"><input type="text" class="num" inputmode="decimal" data-r="${i}" data-k="amount" value="${r.amount ?? ''}" aria-label="Monto"></td>
          <td style="width:74px"><select data-r="${i}" data-k="col" aria-label="Columna"><option value="5"${col === 5 ? ' selected' : ''}>Charge</option><option value="4"${col === 4 ? ' selected' : ''}>Cash</option><option value="6"${col === 6 ? ' selected' : ''}>Credit</option></select></td>
          <td><button class="danger del" data-act="delrow" data-r="${i}" aria-label="Quitar fila">${ic('close', 'sm')}</button></td>`;
        tb.appendChild(tr);
      });
      const th = el.querySelector('.thumbs');
      d.pages.forEach((p, i) => {
        const x = document.createElement('button'); x.className = 'th'; x.dataset.act = 'page'; x.dataset.i = i; x.dataset.type = p.type; x.setAttribute('aria-label', 'Página ' + (i + 1) + ': ' + (TYPES[p.type] || p.type));
        x.innerHTML = `<img src="${p.dataUrl}" alt=""><span class="num">${i + 1}</span><span class="badge">${TYPES[p.type] || p.type}${p.row >= 0 ? ' #' + (p.row + 1) : ''}</span>`;
        th.appendChild(x);
      });
      el.addEventListener('input', (e) => {
        const f = e.target.dataset.f, k = e.target.dataset.k;
        if (f === 'date') d.date = e.target.value.trim();
        if (k && k !== 'col') {
          const r = d.rows[+e.target.dataset.r];
          r[k] = k === 'amount' ? (e.target.value === '' ? null : parseFloat(e.target.value.replace(/[$,]/g, ''))) : e.target.value;
        }
        save();
      });
      el.addEventListener('change', (e) => {
        const k = e.target.dataset.k, r = k ? d.rows[+e.target.dataset.r] : null;
        if (k === 'col') { r.col = +e.target.value; fixSign(r); recalcTotal(d); analyze(d); render(); save(); return; }
        if (k === 'amount') fixSign(r);
        if (['amount', 'invoice'].includes(k) || e.target.dataset.f === 'date') { if (e.target.dataset.f === 'date') mergeSameDate(); if (k === 'amount') recalcTotal(d); analyze(d); render(); }
        save();
      });
      el.addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        const act = b.dataset.act, i = +b.dataset.i;
        if (act === 'toggle') { if (openDays.has(d.id)) openDays.delete(d.id); else openDays.add(d.id); render(); return; }
        if (act === 'saveday') { saveDay(d); return; }
        if (act === 'page') { openPageSheet(d, i); return; }
        if (act === 'delday') { if (!confirm('¿Borrar este día?')) return; putDpdf(d.id, null); state.days = state.days.filter((x) => x !== d); state.seen = []; }
        else if (act === 'addrow') d.rows.push({ store: '', invoice: '', amount: null });
        else if (act === 'delrow') { d.rows.splice(+b.dataset.r, 1); recalcTotal(d); }
        else if (act === 'sort') { analyze(d); sortByReport(d); }
        else if (act === 'viewrep') { openViewer(d.reportThumb, 'Settlement Report · ' + dayTitle(d.date)); return; }
        else return;
        analyze(d); render(); save();
      });
      box.appendChild(el);
    });
    $('empty').hidden = days.length > 0; $('daysFoot').hidden = false;
    const wb = $('weekBar'); wb.hidden = !days.length;
    if (days.length) {
      const nSaved = days.filter((d) => d.savedSig && d.savedSig === sigOf(d)).length;
      wb.innerHTML = `<div class="k"><b>Total semana</b>${days.length} ${days.length === 1 ? 'día' : 'días'} · ${nSaved} guardado${nSaved === 1 ? '' : 's'}</div><div class="v">$${money(week)}</div>`;
    }
    refreshSheet();
  }

  // ---------- Hoja de herramientas de una página ----------
  let ps = null; // { day, id } o { viewer: true }
  function openViewer(url, title) {
    ps = { viewer: true };
    $('psTitle').textContent = title; $('psImg').src = url; $('psPanel').hidden = true; $('pageSheet').hidden = false;
  }
  function openPageSheet(day, i) {
    ps = { day, id: day.pages[i].id };
    $('psPanel').hidden = false; $('pageSheet').hidden = false; refreshSheet();
  }
  function closeSheet() { ps = null; $('pageSheet').hidden = true; $('psImg').classList.remove('loading'); }
  function refreshSheet() {
    if (!ps || ps.viewer) return;
    if (!state.days.includes(ps.day)) return closeSheet();
    const i = ps.day.pages.findIndex((p) => p.id === ps.id);
    if (i < 0) return closeSheet();
    const pg = ps.day.pages[i];
    $('psTitle').textContent = 'Página ' + (i + 1) + ' de ' + ps.day.pages.length;
    $('psImg').src = pg.dataUrl; $('psImg').classList.remove('loading');
    [...$('psType').children].forEach((b) => b.classList.toggle('on', b.dataset.t === pg.type));
    [...$('psFilter').children].forEach((b) => b.classList.toggle('on', b.dataset.f === (pg.filter || 'bw')));
    const tl = (n) => $('pageSheet').querySelector('[data-p="' + n + '"]');
    tl('left').disabled = i === 0; tl('right').disabled = i === ps.day.pages.length - 1;
    getSrc(pg.id).then((u) => { if (ps && ps.id === pg.id) { tl('crop').disabled = !u; [...$('psFilter').children].forEach((b) => (b.disabled = !u)); } });
  }
  // Filtro de la página a partir del original guardado: B/N limpio, gris o color
  async function applyFilter(day, pg, mode) {
    const url = await getSrc(pg.id);
    if (!url) return msg('Esta foto no tiene el original guardado.');
    msg('Aplicando filtro…'); $('psImg').classList.add('loading');
    try {
      const img = await loadImg(url), W = img.naturalWidth, H = img.naturalHeight;
      const c0 = document.createElement('canvas'); c0.width = W; c0.height = H; c0.getContext('2d').drawImage(img, 0, 0);
      let c = pg.quadN ? await DocScan.warp(c0, pg.quadN.map((p) => [p[0] * W, p[1] * H])) : c0;
      c = scaleCanvas(c, 2000);
      if (mode === 'bw') { try { c = await DocScan.cleanScan(c); } catch (e) { c = flatten(c); } }
      c = rotateCanvas(c, pg.rot || 0);
      const out = scaleCanvas(c, 1500);
      pg.dataUrl = toJpeg(mode === 'color' ? out : gray(out)); pg.filter = mode;
      msg('Filtro aplicado.');
    } catch (e) { console.error(e); msg('No pude aplicar el filtro: ' + (e.message || e)); }
    render(); save();
  }
  $('psClose').addEventListener('click', closeSheet);
  $('psType').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || !ps || ps.viewer) return;
    const pg = ps.day.pages.find((p) => p.id === ps.id); if (!pg) return;
    pg.type = b.dataset.t; analyze(ps.day); render(); save();
  });
  $('psFilter').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || !ps || ps.viewer) return;
    const pg = ps.day.pages.find((p) => p.id === ps.id); if (pg && (pg.filter || 'bw') !== b.dataset.f) applyFilter(ps.day, pg, b.dataset.f);
  });
  $('psPanel').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-p]'); if (!b || !ps || ps.viewer) return;
    const day = ps.day, i = day.pages.findIndex((p) => p.id === ps.id); if (i < 0) return;
    const a = b.dataset.p;
    if (a === 'crop') { await editCrop(day, i); return; }
    if (a === 'rotl') { await rotatePage(day, i, 270); return; }
    if (a === 'rotr') { await rotatePage(day, i, 90); return; }
    if (a === 'reread') { await rereadPage(day, i); return; }
    if (a === 'left' && i > 0) [day.pages[i - 1], day.pages[i]] = [day.pages[i], day.pages[i - 1]];
    else if (a === 'right' && i < day.pages.length - 1) [day.pages[i + 1], day.pages[i]] = [day.pages[i], day.pages[i + 1]];
    else if (a === 'del') { if (!confirm('¿Eliminar esta página?')) return; day.pages.splice(i, 1); analyze(day); closeSheet(); }
    render(); save();
  });
  // Ajustes
  $('cfgBtn').addEventListener('click', () => { $('cfgSheet').hidden = false; });
  $('cfgClose').addEventListener('click', () => { $('cfgSheet').hidden = true; });
  $('camDone').addEventListener('click', () => $('camClose').click());


  // ---------- Editor de recorte (4 esquinas arrastrables) ----------
  async function editCrop(day, i) {
    const pg = day.pages[i], url = await getSrc(pg.id);
    if (!url) return msg('No hay original guardado de esta foto.');
    const img = await loadImg(url), W = img.naturalWidth, H = img.naturalHeight;
    const box = $('editor'), cv = $('edc'), g = cv.getContext('2d');
    const maxW = Math.min(window.innerWidth - 24, 900), maxH = window.innerHeight - 190;
    const s = Math.min(maxW / W, maxH / H);
    cv.width = Math.round(W * s); cv.height = Math.round(H * s);
    let q = (pg.quadN || [[0.05, 0.05], [0.95, 0.05], [0.95, 0.95], [0.05, 0.95]]).map((p) => [p[0] * cv.width, p[1] * cv.height]);
    let drag = -1;
    const draw = () => {
      g.clearRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0, cv.width, cv.height);
      g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.rect(0, 0, cv.width, cv.height);
      g.moveTo(q[0][0], q[0][1]); q.slice(1).forEach((p) => g.lineTo(p[0], p[1])); g.closePath(); g.fill('evenodd');
      g.strokeStyle = '#ff8f1f'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(q[0][0], q[0][1]); q.slice(1).forEach((p) => g.lineTo(p[0], p[1])); g.closePath(); g.stroke();
      q.forEach((p) => { g.fillStyle = '#ff8f1f'; g.beginPath(); g.arc(p[0], p[1], 14, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); });
    };
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * (cv.width / r.width), (e.clientY - r.top) * (cv.height / r.height)]; };
    cv.onpointerdown = (e) => { const p = pos(e); let b = 1e9; q.forEach((v, k) => { const d = Math.hypot(v[0] - p[0], v[1] - p[1]); if (d < b) { b = d; drag = k; } }); if (b > 60) drag = -1; else cv.setPointerCapture(e.pointerId); };
    cv.onpointermove = (e) => { if (drag < 0) return; const p = pos(e); q[drag] = [Math.max(0, Math.min(cv.width, p[0])), Math.max(0, Math.min(cv.height, p[1]))]; draw(); };
    cv.onpointerup = () => { drag = -1; };
    box.hidden = false; draw();
    const close = () => { box.hidden = true; };
    $('edCancel').onclick = close;
    $('edFull').onclick = () => { q = [[0, 0], [cv.width, 0], [cv.width, cv.height], [0, cv.height]]; draw(); };
    $('edOk').onclick = async () => {
      msg('Aplicando recorte…');
      const c0 = document.createElement('canvas'); c0.width = W; c0.height = H; c0.getContext('2d').drawImage(img, 0, 0);
      const qq = q.map((p) => [p[0] / cv.width * W, p[1] / cv.height * H]);
      let c = await DocScan.warp(c0, qq);
      let cl; try { cl = await DocScan.cleanScan(scaleCanvas(c, 2000)); } catch (e) { cl = flatten(c); }
      c = rotateCanvas(cl, pg.rot || 0);
      pg.dataUrl = toJpeg(gray(scaleCanvas(c, 1500)));
      pg.quadN = q.map((p) => [p[0] / cv.width, p[1] / cv.height]);
      close(); render(); save(); msg('Recorte aplicado.');
    };
  }


  // ---------- Escáner nativo (ML Kit Document Scanner) ----------
  async function scanNative() {
    const DS = P('DocumentScanner');
    if (!DS) return msg('El escáner nativo no está disponible.');
    try {
      const res = await DS.scanDocument({ maxNumDocuments: 24, responseType: 'imageFilePath', scannerMode: 'base_with_filter', croppedImageQuality: 90, letUserAdjustCrop: true });
      if (res.status !== 'success' || !(res.scannedImages || []).length) return;
      msg('Leyendo ' + res.scannedImages.length + ' página(s)…');
      const files = [];
      for (const p of res.scannedImages) {
        const b = await (await fetch(Capacitor.convertFileSrc(p))).blob();
        const f = new File([b], 'scan-' + Date.now() + '.jpg', { type: 'image/jpeg' }); f.__native = true; files.push(f);
      }
      await importPhotos(files);
      msg('Listo. Toca Escanear para seguir con más páginas.');
    } catch (e) { console.error(e); msg('Escáner: ' + (e.message || e)); }
  }
  $('scanBtn').addEventListener('click', scanNative);
  if (NATIVE) { $('scanBtn').hidden = false; $('camBtn').hidden = true; }

  async function savePdf(bytes, name) {
    if (NATIVE && P('Filesystem') && P('Share')) {
      let s = ''; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
      const w = await P('Filesystem').writeFile({ path: name, data: btoa(s), directory: 'CACHE' });
      await P('Share').share({ title: name, dialogTitle: 'Compartir o guardar el PDF', url: w.uri });
      return;
    }
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ---------- Perfiles de ruta y planillas propias ----------
  const BUILT = LayoutDetect.BUILTIN;
  let profs = { list: [], active: '' };
  const activeProf = () => profs.list.find((x) => x.id === profs.active) || profs.list[0];
  async function saveProfs() { try { (await idb()).transaction('kv', 'readwrite').objectStore('kv').put(profs, 'profiles'); } catch (e) { /* sin persistencia */ } }
  async function loadProfs() {
    try {
      const db = await idb();
      const v = await new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get('profiles'); q.onsuccess = () => res(q.result); q.onerror = () => res(null); });
      if (v && v.list && v.list.length) profs = v;
    } catch (e) { /* ignore */ }
    if (!profs.list.length) {
      profs.list.push({ id: 'p708', name: 'Ruta ' + (state.cfg.route || '708-100').split('-')[0] + ' · ' + (state.cfg.ibp || ''), route: state.cfg.route, ibp: state.cfg.ibp, cover: { on: true, builtin: true }, sheet: { on: true, builtin: true } });
      profs.active = 'p708'; saveProfs();
    }
    if (!profs.list.some((x) => x.id === profs.active)) profs.active = profs.list[0].id;
    const a = activeProf(); state.cfg.route = a.route; state.cfg.ibp = a.ibp;
  }
  const KIND = { cover: 'Portada semanal (total de cada día)', sheet: 'Daily Invoice Sequence Sheet (hoja de cada día)' };
  const layoutOf = (p, kind) => { const t = p[kind]; return t.builtin ? Object.assign({}, BUILT[kind], { adj: t.adj || { dx: 0, dy: 0, k: 1 }, fa: t.fa || {} }) : t.layout; };
  async function getTpl(kind) {
    const t = activeProf()[kind];
    if (!t.on) return null;
    if (t.builtin) { const r = await fetch('templates/' + kind + '.jpeg'); if (!r.ok) return {}; return { bytes: new Uint8Array(await r.arrayBuffer()), layout: layoutOf(activeProf(), kind) }; }
    if (t.img && t.layout) return { bytes: new Uint8Array(await (await fetch(t.img)).arrayBuffer()), layout: t.layout };
    return {}; // sin planilla subida: la app dibuja una hoja simple
  }
  function renderProfiles() {
    const sel = $('profSel'); sel.innerHTML = '';
    profs.list.forEach((x) => { const o = document.createElement('option'); o.value = x.id; o.textContent = x.name || '(sin nombre)'; sel.appendChild(o); });
    sel.value = profs.active; $('profName').value = activeProf().name || '';
    const box = $('tplBox'); box.innerHTML = '';
    const a = activeProf();
    ['cover', 'sheet'].forEach((kind) => {
      const t = a[kind], d = document.createElement('div'); d.className = 'card'; d.style.margin = '0 0 8px';
      const st = !t.on ? 'No se incluye en el PDF.' : t.builtin ? 'Usando la planilla de ejemplo de la ruta 708.' : t.img ? 'Planilla subida y detectada (' + t.layout.rows.n + ' filas' + (kind === 'sheet' ? ', ' + (t.layout.xs.length - 1) + ' columnas' : '') + ').' : 'Sin planilla subida: la app dibuja una hoja simple.';
      d.innerHTML = `<label style="display:flex;gap:8px;color:var(--ink);font-size:14px;font-weight:600"><input type="checkbox" data-k="${kind}" data-a="on" ${t.on ? 'checked' : ''}>${KIND[kind]}</label>
        <div style="font-size:12px;color:var(--mut);margin:4px 0">${st}</div>
        <div class="row" ${t.on ? '' : 'hidden'}><label class="btn sec sm" style="margin:0">Subir planilla en blanco<input type="file" accept="image/*" data-k="${kind}" data-a="up" hidden></label>
        <button class="sec sm" data-k="${kind}" data-a="prev" ${t.builtin || t.img ? '' : 'hidden'}>Ver / ajustar</button>
        <button class="danger sm" data-k="${kind}" data-a="clear" ${t.builtin || t.img ? '' : 'hidden'}>Quitar planilla</button></div>`;
      box.appendChild(d);
    });
  }
  const ocrWords = async (canvas) => OcrSmart.wordsOf(await OcrSmart.rec(await getWorker(), canvas, 3));
  async function uploadTpl(kind, file) {
    try {
      msg('Analizando la planilla… (la 1ª vez carga el lector)');
      const url = URL.createObjectURL(file);
      const cv = await LayoutDetect.prepare(url); URL.revokeObjectURL(url);
      const r = await LayoutDetect.analyze(kind, cv, ocrWords);
      if (r.err) { msg(r.err); alert(r.err); return; }
      const t = activeProf()[kind];
      delete t.builtin; delete t.adj; t.img = cv.toDataURL('image/jpeg', 0.88); t.layout = r.layout; t.on = true;
      await saveProfs(); renderProfiles(); msg('Planilla detectada. Revisa la vista previa.');
      openLay(kind);
    } catch (e) { console.error(e); msg('No pude analizar la planilla: ' + (e.message || e)); }
  }

  // Vista previa con datos de ejemplo y ajuste fino
  let layWork = null, layKind = '';
  async function openLay(kind) {
    const p = activeProf(), t = p[kind]; layKind = kind;
    layWork = JSON.parse(JSON.stringify(layoutOf(p, kind)));
    layWork.adj = layWork.adj || { dx: 0, dy: 0, k: 1 };
    layWork.__img = await loadImg(t.builtin ? 'templates/' + kind + '.jpeg' : t.img);
    $('layTitle').textContent = 'Vista previa · ' + KIND[kind];
    $('layNotes').innerHTML = (layWork.notes || []).map((n) => '⚠ ' + n).join('<br>');
    const rowsBox = $('layRows'); rowsBox.innerHTML = '';
    if (!layWork.rowYs && !t.builtin) rowsBox.innerHTML = `Filas de la tabla: <input type="number" id="layN" min="1" max="60" value="${layWork.rows.n}">`;
    const colBox = $('layCols'); colBox.innerHTML = '';
    if (kind === 'sheet' && !t.builtin) {
      const N = layWork.xs.length - 1, opt = (v) => Array.from({ length: N }, (_, i) => `<option value="${i}"${i === v ? ' selected' : ''}>Col ${i + 1}</option>`).join('');
      colBox.innerHTML = [['inv', 'Invoice #'], ['cash', 'Cash'], ['charge', 'Charge'], ['credit', 'Credit charge']].map(([k, n]) => `${n} <select data-c="${k}">${opt(layWork.cols[k])}</select>`).join(' ');
    }
    layWork.fa = layWork.fa || {};
    const G = kind === 'cover' ? [['all', 'Todo junto'], ['week', 'Semana'], ['route', 'Ruta'], ['ibp', 'Compañía'], ['dates', 'Fechas de los días'], ['totals', 'Total de cada día'], ['totweek', 'Total semana']]
      : [['all', 'Todo junto'], ['week', 'Semana'], ['route', 'Ruta'], ['ibp', 'Compañía'], ['date', 'Fecha'], ['rows', 'Invoices'], ['amounts', 'Montos'], ['totals', 'Totales de columnas'], ['totalSales', 'Total Sales'], ['invCount', 'Nº de invoices']];
    $('layGrp').innerHTML = G.map(([v, n]) => `<option value="${v}">${n}</option>`).join('');
    $('layDateMode').value = layWork.dateMode || (layWork.dateParts ? 'parts' : 'text');
    $('lay').hidden = false; drawLay();
  }
  const layTarget = () => { const g = $('layGrp').value; if (g === 'all') return layWork.adj; return (layWork.fa[g] = layWork.fa[g] || { dx: 0, dy: 0, k: 1 }); };
  function drawLay() {
    const L = layWork, cv = $('layCv'), sc = Math.min(1.4, (Math.min(window.innerWidth, 900) - 44) / L.page.w);
    cv.width = Math.round(L.page.w * sc); cv.height = Math.round(L.page.h * sc);
    const g = cv.getContext('2d'); g.drawImage(L.__img, 0, 0, cv.width, cv.height);
    const cfg = Object.assign({}, state.cfg, { week: state.cfg.week || '41' }), t = PdfGen.canvasTarget(g, sc);
    if (layKind === 'cover') PdfGen.drawCoverL(t, L, cfg, PdfGen.SAMPLE.days); else PdfGen.drawSheetL(t, L, cfg, PdfGen.SAMPLE.day);
    const a = layTarget();
    $('layAdj').textContent = `x ${a.dx} · y ${a.dy} · letra ${Math.round(a.k * 100)}%`;
    $('layDate').hidden = layKind !== 'sheet' || !L.fields.date && !L.dateParts;
  }
  $('lay').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-n]'); if (!b || !layWork) return;
    const n = b.dataset.n, v = +b.dataset.v;
    if (n === 'sp') { layWork.dateSpread = +((layWork.dateSpread != null ? layWork.dateSpread : (layWork.dateParts ? 0 : 40)) + v).toFixed(1); drawLay(); return; }
    const a = layTarget(); a[n] = +(a[n] + v).toFixed(2); drawLay();
  });
  $('lay').addEventListener('change', (e) => {
    if (!layWork) return;
    if (e.target.id === 'layGrp') drawLay();
    if (e.target.id === 'layDateMode') { layWork.dateMode = e.target.value; if (e.target.value === 'text') delete layWork.dateParts; drawLay(); }
    if (e.target.id === 'layN') { layWork.rows.n = Math.max(1, Math.min(60, +e.target.value || 1)); drawLay(); }
    if (e.target.dataset.c) { layWork.cols[e.target.dataset.c] = +e.target.value; drawLay(); }
  });
  $('layCancel').addEventListener('click', () => { $('lay').hidden = true; layWork = null; });
  $('layReset').addEventListener('click', () => { layWork.adj = { dx: 0, dy: 0, k: 1 }; layWork.fa = {}; drawLay(); });
  $('laySave').addEventListener('click', async () => {
    const t = activeProf()[layKind], w = layWork; delete w.__img;
    if (t.builtin) { t.adj = w.adj; t.fa = w.fa; } else t.layout = w;
    layWork = null; $('lay').hidden = true; await saveProfs(); renderProfiles(); msg('Planilla guardada.');
  });
  $('tplBox').addEventListener('change', async (e) => {
    const k = e.target.dataset.k, a = e.target.dataset.a; if (!k) return;
    const t = activeProf()[k];
    if (a === 'on') { t.on = e.target.checked; await saveProfs(); renderProfiles(); }
    if (a === 'up' && e.target.files[0]) { const f = e.target.files[0]; e.target.value = ''; await uploadTpl(k, f); }
  });
  $('tplBox').addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const k = b.dataset.k, t = activeProf()[k];
    if (b.dataset.a === 'prev') openLay(k);
    if (b.dataset.a === 'clear') { if (!confirm('¿Quitar esta planilla? Se usará una hoja simple dibujada por la app.')) return; delete t.builtin; delete t.img; delete t.layout; delete t.adj; await saveProfs(); renderProfiles(); }
  });
  async function switchProf(id) {
    if (id === profs.active) return;
    if (state.days.length && !confirm('Cambiar de ruta borra los días de la semana en pantalla. ¿Continuar?')) { $('profSel').value = profs.active; return; }
    profs.active = id; const a = activeProf();
    state = { cfg: { ...state.cfg, week: '', route: a.route, ibp: a.ibp }, days: [], seen: [] };
    await saveProfs(); save(); render();
  }
  $('profSel').addEventListener('change', (e) => switchProf(e.target.value));
  $('profName').addEventListener('input', (e) => { activeProf().name = e.target.value; saveProfs(); const o = $('profSel').selectedOptions[0]; if (o) o.textContent = e.target.value || '(sin nombre)'; });
  $('profNew').addEventListener('click', async () => {
    const name = prompt('Nombre de la nueva ruta (ej. Ruta 710 · Mi compañía)'); if (!name) return;
    if (state.days.length && !confirm('Cambiar de ruta borra los días de la semana en pantalla. ¿Continuar?')) return;
    const np = { id: uid(), name, route: '', ibp: '', cover: { on: true }, sheet: { on: true } };
    profs.list.push(np); profs.active = np.id;
    state = { cfg: { ...state.cfg, week: '', route: '', ibp: '' }, days: [], seen: [] };
    await saveProfs(); save(); render();
  });
  $('profDel').addEventListener('click', async () => {
    if (profs.list.length < 2) return alert('Debe quedar al menos una ruta.');
    if (!confirm('¿Borrar la ruta "' + activeProf().name + '" y sus planillas?')) return;
    profs.list = profs.list.filter((x) => x.id !== profs.active); profs.active = profs.list[0].id;
    const a = activeProf(); state = { cfg: { ...state.cfg, week: '', route: a.route, ibp: a.ibp }, days: [], seen: [] };
    await saveProfs(); save(); render();
  });

  // ---------- Eventos ----------
  ['week', 'route', 'ibp'].forEach((k) => $(k).addEventListener('input', (e) => { state.cfg[k] = e.target.value; if (k !== 'week') { activeProf()[k] = e.target.value; saveProfs(); } save(); }));
  $('fullInv').addEventListener('change', (e) => { state.cfg.fullInvoice = e.target.checked; save(); });
  const pcStatus = () => { $('pcState').textContent = PcOcr.available ? '✓ Lector de la PC conectado (gratis, local)' : '✗ Sin conexión con el lector de la PC'; };
  async function pcConnect() {
    const custom = (state.cfg.ocrServer || '').trim();
    // primero la misma dirección que sirve la app; si no, la dirección escrita (app de Android)
    if (!(await PcOcr.probe(''))) { if (custom) await PcOcr.probe(custom); }
    pcStatus();
  }
  $('ocrServer').addEventListener('change', async (e) => { state.cfg.ocrServer = e.target.value.trim(); save(); msg('Buscando el lector de la PC…'); await pcConnect(); msg(PcOcr.available ? 'Lector de la PC conectado.' : 'No encuentro el lector de la PC en esa dirección.'); });
  $('autoCrop').addEventListener('change', (e) => { state.cfg.autoCrop = e.target.checked; save(); });
  // Cola: se juntan fotos una tras otra y se procesan todas al final
  let queue = [];
  function renderQueue() {
    const q = $('queue'); q.innerHTML = '';
    queue.forEach((it, i) => {
      const d = document.createElement('div'); d.className = 'th';
      d.innerHTML = `<img src="${it.url}" alt=""><span class="num">${i + 1}</span><button class="del" data-i="${i}" aria-label="Quitar foto">${ic('close', 'sm')}</button>`;
      q.appendChild(d);
    });
    $('qbar').hidden = !queue.length;
    document.body.classList.toggle('has-tray', queue.length > 0);
    $('qcount').textContent = queue.length + (queue.length === 1 ? ' foto lista' : ' fotos listas');
    q.scrollLeft = q.scrollWidth;
  }
  function enqueue(files) {
    files.forEach((f) => queue.push({ file: f, url: URL.createObjectURL(f) }));
    renderQueue(); msg(queue.length + ' foto(s) lista(s). Sigue agregando o toca Procesar todo.');
  }
  $('queue').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || !queue[+b.dataset.i]) return;
    URL.revokeObjectURL(queue[+b.dataset.i].url); queue.splice(+b.dataset.i, 1); renderQueue();
  });
  $('qclear').addEventListener('click', () => { queue.forEach((x) => URL.revokeObjectURL(x.url)); queue = []; renderQueue(); });
  $('qgo').addEventListener('click', async () => {
    const files = queue.map((x) => x.file); queue.forEach((x) => URL.revokeObjectURL(x.url)); queue = []; renderQueue();
    await importPhotos(files);
  });

  // ---------- Cámara continua (varias fotos seguidas sin salir) ----------
  let camStream = null, camShots = 0;
  async function openCamera() {
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.isSecureContext)) {
      msg('La cámara continua necesita HTTPS. Uso la cámara normal (una foto por vez).'); $('camIn').click(); return;
    }
    try {
      camStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 4096 }, height: { ideal: 3072 } } });
    } catch (e) { msg('No pude abrir la cámara (' + e.name + '). Uso la cámara normal.'); $('camIn').click(); return; }
    camShots = 0; $('camCount').textContent = '0'; $('camThumb').style.backgroundImage = '';
    $('camV').srcObject = camStream; $('camera').hidden = false;
    try { await $('camV').play(); } catch (e) { /* autoplay */ }
  }
  function closeCamera() {
    if (camStream) camStream.getTracks().forEach((t) => t.stop());
    camStream = null; $('camV').srcObject = null; $('camera').hidden = true;
    if (camShots) msg(queue.length + ' foto(s) en cola. Toca Procesar todo cuando termines.');
  }
  async function shoot() {
    const v = $('camV'); if (!v.videoWidth) return;
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    const f = $('camFlash'); f.style.opacity = '.8'; setTimeout(() => (f.style.opacity = '0'), 90);
    if (navigator.vibrate) navigator.vibrate(20);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92));
    enqueue([new File([blob], 'cam-' + Date.now() + '.jpg', { type: 'image/jpeg' })]);
    $('camCount').textContent = String(++camShots); $('camThumb').style.backgroundImage = 'url(' + queue[queue.length - 1].url + ')';
  }
  $('camBtn').addEventListener('click', openCamera);
  $('camClose').addEventListener('click', closeCamera);
  $('camShot').addEventListener('click', shoot);

  // Galería: ordenar por hora de captura (el selector no garantiza el orden)
  $('photoIn').addEventListener('change', (e) => {
    const pre = $('preScanned') && $('preScanned').checked;
    const fs = [...e.target.files].sort((a, b) => (a.lastModified - b.lastModified) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    e.target.value = ''; if (pre) fs.forEach((f) => (f.__scanned = true)); if (fs.length) enqueue(fs);
  });
  $('camIn').addEventListener('change', (e) => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) enqueue(fs); });
  $('manualDay').addEventListener('click', () => { state.days.push(newDay('')); render(); save(); });
  $('resetBtn').addEventListener('click', () => {
    if (!confirm('¿Borrar TODOS los días y fotos?')) return;
    state = { cfg: { ...state.cfg, week: '' }, days: [], seen: [] }; clearDpdf(); render(); save();
  });
  $('genBtn').addEventListener('click', async () => {
    const days = state.days.filter((d) => d.rows.length || d.pages.length);
    if (!days.length) return msg('Agrega al menos un día.');
    const probs = days.filter((d) => !d.hasReport);
    if (probs.length && !confirm(`${probs.length} día(s) sin foto del Settlement Report (la hoja saldrá vacía). ¿Finalizar igual?`)) return;
    const pend = days.filter((d) => d.savedSig !== sigOf(d));
    if (pend.length && !confirm(`${pend.length} día(s) sin guardar o con cambios: se arman ahora con lo que tienen en pantalla. ¿Finalizar la semana?`)) return;
    try {
      msg('Uniendo los días…');
      const cache = {};
      for (const d of days) if (d.savedSig === sigOf(d)) { const b = await getDpdf(d.id); if (b) cache[d.id] = b; }
      const tpl = { cover: await getTpl('cover'), sheet: await getTpl('sheet') };
      const bytes = await PdfGen.buildPdf(state.cfg, days, (p) => msg('Uniendo los días… ' + Math.round(p * 100) + '%'), tpl, cache);
      const name = 'Week ' + (state.cfg.week || 'XX') + ' – Route # ' + state.cfg.route.split('-')[0] + '.pdf';
      const wid = uid(); await putDpdf('wk:' + wid, bytes); arch.unshift({ id: wid, name, ts: Date.now(), size: bytes.length }); await saveArch();
      renderArchive();
      await savePdf(bytes, name);
      msg('Semana finalizada y guardada en la app: ' + name + ' (' + (bytes.length / 1048576).toFixed(1) + ' MB). Los días siguen guardados hasta que tú los borres.');
    } catch (e) { console.error(e); msg('Error armando PDF: ' + e.message); }
  });

  // PWA (iPhone/Android desde el navegador): funciona sin internet después de la 1ª vez. En localhost no, para no servir archivos viejos al programar.
  if ('serviceWorker' in navigator && !NATIVE && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__app = { get state() { return state; }, importPhotos, render, readPhoto };
  load().then(loadProfs).then(loadArch).then(async () => { render(); await pcConnect(); });
})();
