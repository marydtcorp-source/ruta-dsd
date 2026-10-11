// Lector del texto del "Settlement Report" (salida de OCR, con errores) y reparación con las sumas del propio reporte.
// El reporte trae redundancia: por tienda, facturas y Sub-Total; al final, el Total. Eso permite:
//  - recuperar montos que el OCR no leyó (monto = Sub-Total - resto)
//  - corregir un signo perdido o falso (la suma solo cuadra con el signo correcto)
//  - corregir el Total mal leído (si todas las tiendas cuadran, el Total es la suma de ellas)
(function (root) {
  const cents = (n) => Math.round(n * 100);

  function money(s) {
    const m = String(s).replace(/,/g, '').match(/(\d+)[.,](\d\d)\b/);
    return m ? parseFloat(m[1] + '.' + m[2]) : null;
  }
  // Monto con signo: "$ -45.08", "-$45.08", "(45.08)", "$ 1,936.60"
  const AMT_RE = /(-|\()?\s*\$?\s*(-)?\s*(\d[\d,]*[.,]\d\d)\)?/g;
  function lastSigned(str) {
    const all = [...String(str).matchAll(AMT_RE)];
    if (!all.length) return null;
    const m = all[all.length - 1], v = money(m[3]);
    return v == null ? null : (m[1] || m[2] ? -v : v);
  }
  // El OCR confunde el año ("2006" por "2026"): se fuerza al año actual si queda lejos
  function fixYear(d) {
    const m = (d || '').match(/^(\d\d)\/(\d\d)\/(\d{4})$/);
    if (!m) return d || '';
    const now = new Date().getFullYear();
    return Math.abs(+m[3] - now) > 1 ? m[1] + '/' + m[2] + '/' + now : d;
  }

  // Fecha válida y cercana a hoy: si el OCR la leyó mal ("00/07", "18/85", "16/07") se busca la fecha cercana
  // que más se parezca (cambiando dígitos que el OCR confunde)
  const CONF = { 0: '861', 1: '07', 2: '7', 3: '8', 5: '68', 6: '085', 7: '12', 8: '0365', 9: '08' };
  function fixDate(d) {
    d = fixYear(d);
    const m = (d || '').match(/^(\d\d)\/(\d\d)\/(\d{4})$/);
    if (!m) return d || '';
    const y = +m[3], now = new Date(), lo = new Date(now.getTime() - 30 * 86400000), hi = new Date(now.getTime() + 3 * 86400000);
    const ok = (mm, dd) => { const t = new Date(y, mm - 1, dd); return mm >= 1 && mm <= 12 && dd >= 1 && t.getMonth() === mm - 1 && t >= lo && t <= hi; };
    if (ok(+m[1], +m[2])) return d;
    const digs = (m[1] + m[2]).split('');
    let best = null;
    const tryVariant = (v, edits) => {
      const mm = +(v[0] + v[1]), dd = +(v[2] + v[3]);
      if (!ok(mm, dd)) return;
      const dist = Math.abs(new Date(y, mm - 1, dd) - now);
      if (!best || edits < best.edits || (edits === best.edits && dist < best.dist)) best = { v, edits, dist };
    };
    for (let i = 0; i < 4; i++) for (const a of (CONF[digs[i]] || '')) {
      const v1 = digs.slice(); v1[i] = a; tryVariant(v1, 1);
      for (let j = i + 1; j < 4; j++) for (const b of (CONF[digs[j]] || '')) { const v2 = v1.slice(); v2[j] = b; tryVariant(v2, 2); }
    }
    return best ? best.v[0] + best.v[1] + '/' + best.v[2] + best.v[3] + '/' + y : d;
  }

  // Código de factura: 10 dígitos "7082605xxx" (el OCR mete espacios, cambia el 0 inicial por otro dígito o lo parte en dos líneas)
  function codeOf(line) {
    const cleaned = line.replace(/[^\d\s]/g, ' ');
    const m = cleaned.match(/\d(?:\s?\d){5,13}/);
    if (!m) return null;
    const digits = m[0].replace(/\s/g, '');
    if (digits.length >= 10 && /^708\d{7}$/.test(digits.slice(-10))) return { code: digits.slice(-10), at: m.index };
    if (digits.length >= 10 && digits.length <= 13 && /inv|nvo|ivo|oice/i.test(line)) return { code: digits.slice(-10), at: m.index };
    if (digits.length >= 6 && digits.length <= 9 && /inv|nvo|ivo/i.test(line)) return { code: '7082' + digits.slice(-6), at: m.index };
    return null;
  }

  const STORE_RE = /^\W*(?:p[xk]|w[mn]|[oq]x|bo?x)\s*\d{3,4}\s*[-–—]\s*\d{2,3}/i;
  const SUB_RE = /sub-?\s*t?o?t?a?l|^\W*ota\b/i;

  // Estructura: bloques por tienda { items:[{invoice,amount}], sub }
  function parseReport(text) {
    let lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    // une un código partido en dos líneas ("0007082" + "605749 Invoice $ 200.66")
    const merged = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/^\D{0,3}\d{5,9}\D{0,3}$/.test(l) && lines[i + 1] && /^\D{0,3}\d{3,}/.test(lines[i + 1])) { merged.push(l.replace(/\D+$/, '') + ' ' + lines[i + 1]); i++; } else merged.push(l);
    }
    lines = merged;
    const out = { date: '', total: null, blocks: [], rows: [] };
    let cur = null;
    const newBlock = (store) => { cur = { store, items: [], sub: null, amts: [] }; out.blocks.push(cur); return cur; };

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!out.date) {
        const d = l.match(/(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{4})/);
        if (d) out.date = d[1].padStart(2, '0') + '/' + d[2].padStart(2, '0') + '/' + d[3];
      }
      if (STORE_RE.test(l)) {
        const nm = l.match(/#\s*(\d{3,4})/), st = l.match(/(\d{3,4})\s*[-–—]\s*\d{2,3}/);
        newBlock(nm ? nm[1].padStart(4, '0') : st ? st[1].padStart(4, '0') : '');
        // a veces el monto de la primera factura cae en la línea de la tienda
        { const hv = lastSigned(l.replace(/\d{3,4}\s*[-–—]\s*\d{2,3}/, ' ')); if (hv != null) cur.amts.push(hv); }
        continue;
      }
      if (SUB_RE.test(l)) {
        const v = lastSigned(l);
        if (cur && v != null) { cur.sub = v; cur.amts.push(v); }
        continue;
      }
      // Total general
      if (/^\W*total\b/i.test(l) || (/\d,\d{3}[.,]\d\d/.test(l) && !codeOf(l))) {
        const v = lastSigned(l);
        if (v != null && !/remain|collected|pay/i.test(l)) out.total = v;
        continue;
      }
      const c = codeOf(l);
      if (c) {
        if (!cur) newBlock('');
        const av = lastSigned(l.replace(/\d(?:\s?\d){5,13}/, ' '));
        cur.items.push({ invoice: c.code, amount: av });
        if (av != null) cur.amts.push(av);
        continue;
      }
      // monto suelto justo después del encabezado de la tienda (la foto torcida lo separa de su factura): se guarda en orden
      if (cur && !cur.items.length) {
        const v0 = lastSigned(l);
        if (v0 != null && !/route|date|time|phone|fax|rivmar|total/i.test(l)) { cur.amts.push(v0); continue; }
      }
      // línea sin código con un monto justo después de una factura sin monto: es su monto
      if (cur && cur.items.length && cur.items[cur.items.length - 1].amount == null) {
        const v = lastSigned(l);
        if (v != null && !/total/i.test(l)) { cur.items[cur.items.length - 1].amount = v; cur.amts.push(v); continue; }
      }
      // Sub-Total mal leído (por ejemplo "ota $ 217.16"): monto suelto tras una factura
      if (cur && cur.items.length && cur.sub == null) {
        const v = lastSigned(l);
        if (v != null && !/route|date|time|phone|fax|rivmar/i.test(l)) { cur.sub = v; cur.amts.push(v); }
      }
    }
    out.blocks = out.blocks.filter((b) => b.items.length);
    // el prefijo (primeros 7 dígitos) es el mismo en todo el reporte: un código con un dígito distinto se corrige
    const pref = {};
    out.blocks.forEach((b) => b.items.forEach((it) => { const k = it.invoice.slice(0, 7); pref[k] = (pref[k] || 0) + 1; }));
    const mode = Object.keys(pref).sort((a, b) => pref[b] - pref[a])[0];
    if (mode && pref[mode] >= 2) out.blocks.forEach((b) => b.items.forEach((it) => {
      const k = it.invoice.slice(0, 7);
      if (k !== mode && [...k].filter((ch, i) => ch !== mode[i]).length <= 2) it.invoice = mode + it.invoice.slice(7);
    }));
    out.rows = out.blocks.flatMap((b) => b.items.map((it) => ({ store: b.store, invoice: it.invoice, amount: it.amount })));
    return out;
  }

  // Cuánto de coherente es la lectura (sirve para elegir entre varias lecturas de la misma foto)
  function score(p) {
    let s = 0;
    for (const b of p.blocks) {
      for (const it of b.items) if (it.amount != null) s += 10;
      if (b.sub != null && b.items.every((i) => i.amount != null)) {
        const sum = b.items.reduce((t, i) => t + cents(i.amount), 0);
        if (sum === cents(b.sub)) s += 15;
      }
    }
    if (p.total != null) {
      s += 10;
      const S = p.blocks.reduce((t, b) => t + b.items.reduce((u, i) => u + cents(i.amount || 0), 0), 0);
      if (S === cents(p.total)) s += 40;
    }
    return s;
  }

  // Repara con las sumas del reporte. Devuelve { fixed: n, consistent: bool }
  function repair(p) {
    let fixed = 0, allOk = true;
    for (const b of p.blocks) {
      // Si la foto está inclinada, los montos pueden caer una línea arriba o abajo de su factura. Los montos del bloque,
      // en orden de lectura, son: cada factura y luego el Sub-Total. Si así la suma cuadra, esa es la asignación correcta.
      const n = b.items.length;
      const lineOk = b.items.every((i) => i.amount != null) && (b.sub != null ? b.items.reduce((t, i) => t + cents(i.amount), 0) === cents(b.sub) : !(b.amts && b.amts.length === n + 1));
      if (!lineOk && b.amts && b.amts.length === n + 1) {
        const first = b.amts.slice(0, n).reduce((t, x) => t + cents(x), 0);
        if (first === cents(b.amts[n])) { b.items.forEach((it, i) => { it.amount = b.amts[i]; }); b.sub = b.amts[n]; fixed++; }
      }
      if (b.sub == null) { if (b.items.some((i) => i.amount == null)) allOk = false; continue; }
      const nulls = b.items.filter((i) => i.amount == null);
      const sumKnown = () => b.items.reduce((t, i) => t + cents(i.amount || 0), 0);
      if (nulls.length === 1) { nulls[0].amount = (cents(b.sub) - sumKnown()) / 100; fixed++; continue; }
      if (nulls.length > 1) { allOk = false; continue; }
      if (sumKnown() === cents(b.sub)) continue;
      // un signo mal: al invertir una factura la suma cuadra
      let done = false;
      for (const it of b.items) {
        if (sumKnown() - 2 * cents(it.amount) === cents(b.sub)) { it.amount = -it.amount; fixed++; done = true; break; }
      }
      if (done) continue;
      // el Sub-Total mal leído: si todas las facturas de otra forma son coherentes con el Total se corrige abajo
      allOk = false;
    }
    const S = p.blocks.reduce((t, b) => t + b.items.reduce((u, i) => u + cents(i.amount || 0), 0), 0);
    p.sum = S / 100;
    // Coherente = el Total impreso (bien leído) es la suma de las facturas, y cada tienda cuadra con su Sub-Total.
    // Un Total que difiere en UN dígito confundible (3/8, 5/6, 0/8...) es mala lectura del Total: se corrige.
    // Un Total muy distinto indica facturas que no se leyeron: NO se toca y el reporte queda marcado como dudoso.
    const sameLen = (a, b) => { const x = String(Math.abs(a)), y = String(Math.abs(b)); return x.length === y.length ? [x, y] : null; };
    const oneDigitOff = (a, b) => {
      const s = sameLen(a, b); if (!s) return false;
      let d = 0, ok = true;
      for (let k = 0; k < s[0].length; k++) if (s[0][k] !== s[1][k]) { d++; if (!(CONF[s[0][k]] || '').includes(s[1][k])) ok = false; }
      return d === 1 && ok;
    };
    p.totalDerived = false;
    let consistent = false;
    if (allOk && p.blocks.length) {
      if (p.total != null) {
        if (cents(p.total) === S) consistent = true;
        else if (oneDigitOff(cents(p.total), S)) { p.total = S / 100; fixed++; consistent = true; }
      } else { p.total = S / 100; p.totalDerived = true; }
    }
    p.rows = p.blocks.flatMap((b) => b.items.map((it) => ({ store: b.store, invoice: it.invoice, amount: it.amount })));
    p.fixed = fixed;
    p.consistent = consistent;
    return p;
  }

  function parseSettlement(text) {
    const p = repair(parseReport(text));
    p.date = fixDate(p.date);
    return p;
  }

  const api = { parseSettlement, parseReport, repair, score, money, lastSigned, fixYear, fixDate };
  if (typeof module !== 'undefined') module.exports = api;
  else root.ReportParse = api;
})(typeof window !== 'undefined' ? window : globalThis);
