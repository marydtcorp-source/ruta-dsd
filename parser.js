// Parser del "Settlement Report" (texto OCR) de la ruta DSD.
// Devuelve { date:'MM/DD/YYYY'|'', total:Number|null, rows:[{store,invoice,amount}] }
(function (root) {
  function money(s) {
    const m = String(s).replace(/,/g, '').match(/(\d+)[.,](\d\d)\b/);
    return m ? parseFloat(m[1] + '.' + m[2]) : null;
  }

  const RP = typeof module !== 'undefined' ? require('./reportparse') : root.ReportParse;
  const lastSigned = RP.lastSigned, parseSettlement = RP.parseSettlement, fixYear = RP.fixDate;

  const api = { parseSettlement, money, fixYear, lastSigned };
  if (typeof module !== 'undefined') module.exports = api;
  else root.Parser = api;
})(typeof window !== 'undefined' ? window : globalThis);

// ---- Clasificación de páginas y datos extra ----
(function (root) {
  const P = root.Parser || (typeof module !== 'undefined' ? module.exports : {});
  const amt = (s) => { const m = String(s).replace(/,/g, '').match(/(\d+)[.,](\d\d)\b/); return m ? parseFloat(m[1] + '.' + m[2]) : null; };

  // 'report' = Settlement Report (datos, no va en PDF); 'settle' = settlement de inicio de día;
  // 'pod' = Proof of Delivery; 'invoice' = invoice KSales; 'other'
  function classify(text) {
    const t = text || '';
    const notReport = /proof\s*of\s*deli|total\s*to\s*pay|store\s*copy|discount\s*total|inventory\s*products|total\s*collected/i.test(t);
    const invCodes = (t.match(/\b0{2,3}7\d{9,10}\b/g) || []).length;
    // Settlement Report: título o columnas "Variety/Amout", o varios códigos de invoice con "Sub-Total"
    if (!notReport && (/s[ec]ttl\w*\s*rep|\bvariety\b|invoice\s*code/i.test(t)
      || (/sub-?\s*total/i.test(t) && invCodes >= 1 && /\bp[xk]\s*\d{3,4}\s*-\s*\d+/i.test(t))
      || (invCodes >= 2 && /invoice\s*\S{0,3}\s*[-$(]/i.test(t) && /\btotal\b/i.test(t) && !/customer|store\s*copy|supplier/i.test(t)))) return 'report';
    if (/proof\s*of\s*deli/i.test(t) || /supplier\s*name/i.test(t) || /receiving\s*method/i.test(t)) return 'pod';
    if (/inventory\s*products/i.test(t) || /total\s*collected/i.test(t) || /remain\s*am/i.test(t) || /credit\s*products/i.test(t)) return 'settle';
    if (/total\s*to\s*pay/i.test(t) || /store\s*copy\s*of\s*the\s*invoice/i.test(t) || (/invoice/i.test(t) && /customer/i.test(t)) || /ksales|dso\s*number|net\s*30\s*days|gross\s*sub|discount\s*total/i.test(t)) return 'invoice';
    return 'other';
  }

  function parseMarker(text) {
    const out = { date: '', settleNo: '', cash: {} };
    const d = text.match(/(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(20\d\d)/);
    if (d) out.date = P.fixYear(d[1].padStart(2, '0') + '/' + d[2].padStart(2, '0') + '/' + d[3]);
    const s = text.match(/settlement\s*[:;]\s*(\d{2,6})/i);
    if (s) out.settleNo = s[1];
    const keys = { cashSales: /cash\s*sales[^\n]*?([\d,]*\d[.,]\d\d)/i, collected: /collected\s*charge[^\n]*?([\d,]*\d[.,]\d\d)/i,
      advance: /in\s*advance[^\n]*?([\d,]*\d[.,]\d\d)/i, expenses: /expenses[^\n]*?([\d,]*\d[.,]\d\d)/i,
      lack: /lack[^\n]*?([\d,]*\d[.,]\d\d)/i, driverPay: /driver\s*pay[^\n]*?([\d,]*\d[.,]\d\d)/i, toPay: /total\s*to\s*pay[^\n]*?([\d,]*\d[.,]\d\d)/i };
    for (const k in keys) { const m = text.match(keys[k]); if (m) out.cash[k] = amt(m[1]); }
    return out;
  }

  // Total impreso en invoice ("TOTAL TO PAY: $368.04") o POD ("Final Total: $368.04")
  function docTotal(text) {
    const m = text.match(/(total\s*to\s*pay|final\s*total)([^\d\n]*)([\d,]*\d[.,]\d\d)/i);
    if (!m) return null;
    const v = amt(m[3]);
    return v != null && /[-(]/.test(m[2]) ? -v : v;
  }

  // Busca a qué fila del reporte pertenece el texto (invoice completo o últimos 5 dígitos)
  function matchInvoice(text, rows) {
    const digits = text.replace(/[^\d\n ]/g, ' ');
    for (let i = 0; i < rows.length; i++) {
      const inv = String(rows[i].invoice || '');
      if (inv.length >= 6 && digits.replace(/\s/g, '').includes(inv)) return i;
    }
    for (let i = 0; i < rows.length; i++) {
      const inv = String(rows[i].invoice || '');
      if (inv.length >= 5 && new RegExp('\\b0*\\d*' + inv.slice(-5) + '\\b').test(digits)) return i;
    }
    return -1;
  }

  // Subconjunto de filas cuya suma = efectivo (para marcar columna CASH)
  function cashSubset(rows, cash) {
    if (!cash || cash <= 0 || rows.length > 20) return null;
    const a = rows.map((r) => Math.round((Number(r.amount) || 0) * 100)), target = Math.round(cash * 100);
    const n = a.length;
    for (let m = 1; m < 1 << n; m++) {
      let s = 0; for (let i = 0; i < n; i++) if (m & (1 << i)) s += a[i];
      if (s === target) { const idx = []; for (let i = 0; i < n; i++) if (m & (1 << i)) idx.push(i); return idx; }
    }
    return null;
  }

  Object.assign(P, { classify, parseMarker, docTotal, matchInvoice, cashSubset });
  if (!root.Parser && typeof module === 'undefined') root.Parser = P;
})(typeof window !== 'undefined' ? window : globalThis);
