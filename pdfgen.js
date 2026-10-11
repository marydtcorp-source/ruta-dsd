// Genera el PDF semanal: portada + por día (Daily Invoice Sequence Sheet + fotos adjuntas).
(function (root) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const PW = 612, PH = 792; // Letter

  const fmt = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num2 = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const shortDate = (d) => { // MM/DD/YYYY -> MM/DD/YY
    const m = (d || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
    return m ? m[1].padStart(2, '0') + '/' + m[2].padStart(2, '0') + '/' + m[3].slice(-2) : d || '';
  };
  const dayTotal = (day) => (day.total != null ? Number(day.total) : day.rows.reduce((s, r) => s + (Number(r.amount) || 0), 0));

  function box(page, x, y, w, h, bw = 1) {
    page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0, 0, 0), borderWidth: bw });
  }
  function line(page, x1, y1, x2, y2, t = 0.7) {
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: t, color: rgb(0, 0, 0) });
  }
  function textR(page, s, xRight, y, font, size) {
    page.drawText(s, { x: xRight - font.widthOfTextAtSize(s, size), y, size, font });
  }
  function textC(page, s, xc, y, font, size) {
    page.drawText(s, { x: xc - font.widthOfTextAtSize(s, size) / 2, y, size, font });
  }

  function drawCover(pdf, fonts, cfg, days) {
    const page = pdf.addPage([PW, PH]);
    const { reg, bold } = fonts;
    const x = 60, w = 330, top = PH - 70;
    // Cabecera
    box(page, x, top - 150, w, 150);
    page.drawText('LAKELAND, FL.', { x: x + 6, y: top - 26, size: 17, font: reg });
    page.drawText('RT#: ' + cfg.route, { x: x + 6, y: top - 66, size: 14, font: reg });
    page.drawText('IBP NAME: ' + cfg.ibp, { x: x + 6, y: top - 92, size: 14, font: reg });
    page.drawText('WK# ' + cfg.week, { x: x + 6, y: top - 120, size: 14, font: reg });
    // Tabla
    const rowH = 23, rows = 8;
    const ty = top - 150 - 20;
    const th = rowH * (rows + 2);
    box(page, x, ty - th, w, th);
    const c2 = x + 90;
    line(page, c2, ty, c2, ty - th);
    for (let i = 1; i <= rows + 1; i++) line(page, x, ty - i * rowH, x + w, ty - i * rowH);
    page.drawText('DATE', { x: x + 4, y: ty - rowH + 7, size: 12, font: reg });
    page.drawText('TOTAL', { x: c2 + 4, y: ty - rowH + 7, size: 12, font: reg });
    let week = 0;
    days.forEach((d, i) => {
      if (i >= rows) return;
      const t = dayTotal(d); week += t;
      const yy = ty - (i + 2) * rowH + 7;
      page.drawText(shortDate(d.date), { x: x + 6, y: yy, size: 12, font: reg });
      page.drawText(fmt(t), { x: c2 + 6, y: yy, size: 12, font: reg });
    });
    const yy = ty - th + 7;
    page.drawText('TOTAL WEEK $', { x: x + 4, y: yy, size: 11, font: bold });
    page.drawText(fmt(week).slice(1), { x: c2 + 6, y: yy, size: 12, font: bold });
    return week;
  }

  function drawSheet(pdf, fonts, cfg, day) {
    const page = pdf.addPage([PW, PH]);
    const { reg, bold } = fonts;
    const L = 36, R = PW - 36, W = R - L;
    const top = PH - 70;

    // Cabecera
    page.drawText('Name: ' + cfg.ibp, { x: L, y: top + 8, size: 7, font: bold });
    page.drawText('WK: ' + cfg.week, { x: L + 150, y: top + 8, size: 8, font: reg });
    page.drawText('Rte# IBP ' + cfg.route, { x: L + 235, y: top + 8, size: 9, font: reg });
    page.drawText('Start date:', { x: L + 340, y: top + 8, size: 7, font: reg });
    page.drawText('Ending :', { x: L + 410, y: top + 8, size: 7, font: reg });

    // Título
    const titleH = 24;
    box(page, L, top - titleH, W, titleH, 1.2);
    page.drawText('DAILY INVOICE SEQUENCE SHEET', { x: L + 14, y: top - 18, size: 15, font: bold });
    const dx = L + 340;
    line(page, dx - 8, top, dx - 8, top - titleH);
    page.drawText('DATE ' + day.date, { x: dx, y: top - 16, size: 10, font: reg });

    // Columnas
    const cols = [
      ['INVOICE #', 56], ['TARGET PO#', 42], ['CHECK #', 42], ['CK AMOUNT', 42], ['CASH', 36],
      ['CHARGE / 7DAYS', 58], ['CREDIT CHARGE', 52], ['CREDIT PAID', 44], ['PYMNT CHECK', 46], ['PYMNT CASH', 46],
    ];
    const sum = cols.reduce((s, c) => s + c[1], 0);
    const scale = W / sum;
    const xs = [L];
    cols.forEach((c) => xs.push(xs[xs.length - 1] + c[1] * scale));
    const headH = 16;
    const hy = top - titleH;
    box(page, L, hy - headH, W, headH);
    cols.forEach((c, i) => {
      if (i > 0) line(page, xs[i], hy, xs[i], hy - headH - ROWS * ROW_H - ROW_H);
      textC(page, c[0], (xs[i] + xs[i + 1]) / 2, hy - 11, bold, 5.2);
    });

    // Filas
    const body = hy - headH;
    for (let i = 0; i < ROWS; i++) {
      line(page, L, body - (i + 1) * ROW_H, R, body - (i + 1) * ROW_H, 0.5);
    }
    // Fila TOTAL
    const ty = body - ROWS * ROW_H;
    page.drawRectangle({ x: L, y: ty - ROW_H, width: xs[1] - L, height: ROW_H, color: rgb(0, 0, 0) });
    page.drawText('TOTAL', { x: L + 6, y: ty - ROW_H + 7, size: 11, font: bold, color: rgb(1, 1, 1) });
    line(page, L, ty - ROW_H, R, ty - ROW_H, 1);
    box(page, L, ty - ROW_H, W, ROW_H + ROWS * ROW_H + headH, 1.2);

    let tot = 0;
    day.rows.slice(0, ROWS).forEach((r, i) => {
      const y = body - (i + 1) * ROW_H + 6;
      let inv = String(r.invoice || '');
      if (!cfg.fullInvoice && i > 0) inv = inv.slice(-4);
      page.drawText(inv, { x: xs[0] + 4, y, size: 9, font: reg });
      const amt = Number(r.amount) || 0;
      tot += amt;
      const colIdx = r.col == null ? ((Number(r.amount) || 0) < 0 ? 6 : 5) : r.col;
      if (r.amount != null) textR(page, num2(amt), xs[colIdx + 1] - 4, y, reg, 9);
    });
    textR(page, num2(tot), xs[6] - 4, ty - ROW_H + 7, bold, 10);

    // Total Sales
    page.drawText('Total Sales $', { x: L + 220, y: ty - ROW_H - 26, size: 11, font: reg });
    page.drawText(num2(tot), { x: L + 305, y: ty - ROW_H - 26, size: 11, font: bold });
    line(page, L + 300, ty - ROW_H - 29, L + 400, ty - ROW_H - 29);
    return page;
  }

  // ---- Versión sobre las planillas del usuario, guiada por un layout (puntos PDF, origen arriba-izquierda) ----
  // t = destino con text(s, x, y, {size, bold, align, maxW}); sirve igual para el PDF y para la vista previa en pantalla.
  // Ajuste global (L.adj) + ajuste propio de cada grupo de texto (L.fa[grupo]): la fecha, la semana, los montos... se mueven por separado
  function withAdj(t, L, grp) {
    const a = L.adj || { dx: 0, dy: 0, k: 1 }, b = (grp && L.fa && L.fa[grp]) || { dx: 0, dy: 0, k: 1 };
    const k = (a.k || 1) * (b.k || 1);
    return { text: (s, x, y, o) => t.text(s, x + a.dx + b.dx, y + a.dy + b.dy, Object.assign({}, o, { size: o.size * k, maxW: o.maxW && o.maxW * k })) };
  }
  function drawFields(t0, L, cfg, names) {
    names.forEach((n) => { const f = L.fields && L.fields[n], v = cfg[n]; if (f && v) withAdj(t0, L, n).text(String(v), f.x, f.y, { size: f.s, maxW: f.maxW, align: f.align }); });
  }
  function coverRowY(L, i) { return L.rowYs ? L.rowYs[i] : L.rows.y0 + (i + 1) * ((L.rows.y1 - L.rows.y0) / L.rows.n) - 0.28 * ((L.rows.y1 - L.rows.y0) / L.rows.n); }
  function drawCoverL(t0, L, cfg, days) {
    const n = L.rowYs ? L.rowYs.length : L.rows.n, td = withAdj(t0, L, 'dates'), tt = withAdj(t0, L, 'totals'), tw = withAdj(t0, L, 'totweek');
    drawFields(t0, L, cfg, ['week', 'route', 'ibp']);
    let week = 0;
    days.forEach((d, i) => {
      const tot = dayTotal(d); week += tot;
      if (i >= n) return;
      const y = coverRowY(L, i);
      td.text(shortDate(d.date), L.dateX, y, { size: L.size });
      tt.text(fmt(tot), L.totX, y + (L.totDy || 0), { size: L.size });
    });
    tw.text(fmt(week), L.totX, L.totY, { size: L.size, bold: true });
    return week;
  }
  function drawSheetL(t0, L, cfg, day) {
    const xs = L.xs, c = L.cols, pitch = (L.rows.y1 - L.rows.y0) / L.rows.n, pad = Math.min(6, pitch * 0.3);
    const ti = withAdj(t0, L, 'rows'), ta = withAdj(t0, L, 'amounts'), tt = withAdj(t0, L, 'totals'), td = withAdj(t0, L, 'date'), ts = withAdj(t0, L, 'totalSales');
    drawFields(t0, L, cfg, ['week', 'route', 'ibp']);
    const m = (day.date || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
    if (m) {
      const sp = L.dateSpread, vals = [m[1].padStart(2, '0'), m[2].padStart(2, '0'), m[3].slice(-2)], fd = L.fields.date;
      if (L.dateParts) vals.forEach((v, i) => td.text(v, L.dateParts[i].x + i * (sp || 0), L.dateParts[i].y, { size: L.dateSize || L.size }));
      else if (fd && L.dateMode === 'parts') vals.forEach((v, i) => td.text(v, fd.x + i * (sp != null ? sp : 40), fd.y, { size: fd.s }));
      else if (fd) td.text(vals.join('/'), fd.x, fd.y, { size: fd.s, maxW: fd.maxW, align: fd.align });
    }
    const colMap = { 4: c.cash, 5: c.charge, 6: c.credit }, colTot = {};
    let tot = 0;
    day.rows.slice(0, L.rows.n).forEach((r, i) => {
      const y = L.rows.y0 + (i + 1) * pitch - (L.rowDy != null ? L.rowDy : 0.28 * pitch);
      let inv = String(r.invoice || '');
      if (!cfg.fullInvoice && i > 0) inv = inv.slice(-4);
      ti.text(inv, xs[c.inv] + pad, y, { size: L.size, maxW: xs[c.inv + 1] - xs[c.inv] - 2 * pad });
      const amt = Number(r.amount) || 0, ci = colMap[r.col == null ? (amt < 0 ? 6 : 5) : r.col];
      tot += amt; colTot[ci] = (colTot[ci] || 0) + amt;
      if (r.amount != null) ta.text(num2(amt), xs[ci + 1] - pad, y, { size: L.size, align: 'right', maxW: xs[ci + 1] - xs[ci] - 2 * pad }); // monto no leído: casilla vacía
    });
    Object.keys(colTot).forEach((ci) => tt.text(num2(colTot[ci]), xs[+ci + 1] - pad, L.totY, { size: L.size, bold: true, align: 'right', maxW: xs[+ci + 1] - xs[+ci] - 2 * pad }));
    const f = L.fields.totalSales;
    if (!day.more && f) ts.text(num2(day.total != null ? day.total : tot), f.x, f.y, { size: f.s, bold: true, maxW: f.maxW, align: f.align });
    const fc = L.fields.invCount;
    if (!day.more && fc && day.rows.length) withAdj(t0, L, 'invCount').text(String(day.rows.length), fc.x, fc.y, { size: fc.s, bold: true, maxW: fc.maxW, align: fc.align });
  }
  const pdfTarget = (page, fonts, H) => ({
    text(s, x, y, o) {
      const f = o.bold ? fonts.bold : fonts.reg; let size = o.size;
      if (o.maxW) { const w0 = f.widthOfTextAtSize(s, size); if (w0 > o.maxW) size *= o.maxW / w0; }
      const w = f.widthOfTextAtSize(s, size);
      page.drawText(s, { x: o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x, y: H - y, size, font: f });
    },
  });
  // Vista previa en un canvas (px = pt * scale)
  function canvasTarget(g, scale) {
    return {
      text(s, x, y, o) {
        let size = o.size; const font = (sz) => (o.bold ? 'bold ' : '') + sz * scale + 'px Helvetica, Arial, sans-serif';
        g.font = font(size);
        if (o.maxW) { const w0 = g.measureText(s).width / scale; if (w0 > o.maxW) { size *= o.maxW / w0; g.font = font(size); } }
        g.fillStyle = '#0a2fd0'; g.textAlign = o.align === 'right' ? 'right' : o.align === 'center' ? 'center' : 'left'; g.fillText(s, x * scale, y * scale);
      },
    };
  }
  const SAMPLE = {
    days: [['10/03/2026', 1937.84], ['10/05/2026', 1936.6], ['10/06/2026', 836.96], ['10/07/2026', 1948.08], ['10/09/2026', 19.42]].map(([date, total]) => ({ date, total, rows: [] })),
    day: { date: '10/03/2026', total: 1937.84, rows: [['7082605739', 273.16], ['5740', -19.05], ['5743', 297.14], ['5741', 347.62], ['5742', 596.19], ['5744', 442.78], ['5746', 120.5]].map(([invoice, amount]) => ({ invoice, amount, col: invoice === '5746' ? 4 : undefined })) },
  };

  function drawCoverT(pdf, fonts, cfg, days, tp) {
    const L = tp.layout, page = pdf.addPage([L.page.w, L.page.h]);
    page.drawImage(tp.img, { x: 0, y: 0, width: L.page.w, height: L.page.h });
    return drawCoverL(pdfTarget(page, fonts, L.page.h), L, cfg, days);
  }
  function drawSheetT(pdf, fonts, cfg, day, tp) {
    const L = tp.layout, page = pdf.addPage([L.page.w, L.page.h]);
    page.drawImage(tp.img, { x: 0, y: 0, width: L.page.w, height: L.page.h });
    drawSheetL(pdfTarget(page, fonts, L.page.h), L, cfg, day);
    return page;
  }

  const ROWS = 18, ROW_H = 26.5;

  async function addImagePage(pdf, att) {
    const bytes = new Uint8Array(await (await fetch(att.dataUrl)).arrayBuffer());
    const img = att.dataUrl.startsWith('data:image/png') ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    const sw = img.width, sh = img.height;
    const m = 18;
    const s = Math.min((PW - 2 * m) / sw, (PH - 2 * m) / sh);
    const page = pdf.addPage([PW, PH]);
    page.drawImage(img, { x: (PW - sw * s) / 2, y: (PH - sh * s) / 2, width: sw * s, height: sh * s });
  }

  // Semanas de sábado a viernes; la semana 40 empezó el 26/09/2026
  function weekFromDate(d) {
    const m = (d || '').match(/^(\d\d)\/(\d\d)\/(\d{4})$/);
    if (!m) return '';
    const t = Date.UTC(+m[3], +m[1] - 1, +m[2]), a = Date.UTC(2026, 8, 26);
    return String(40 + Math.floor((t - a) / (7 * 86400000)));
  }

  const withWeek = (cfg, days) => (cfg.week ? cfg : Object.assign({}, cfg, { week: weekFromDate(days.map((d) => d.date).filter(Boolean).sort((x, y) => dateKey(x) - dateKey(y))[0]) }));
  // tpl.cover / tpl.sheet: null = no se incluye; {} = versión tipeada por la app; {bytes, layout} = sobre la planilla del usuario
  async function setup(pdf, tpl) {
    const T = {};
    for (const k of ['cover', 'sheet']) if (tpl && tpl[k] && tpl[k].bytes) T[k] = { img: await pdf.embedJpg(tpl[k].bytes), layout: tpl[k].layout };
    return { T, want: { cover: !tpl || tpl.cover !== null, sheet: !tpl || tpl.sheet !== null },
      fonts: { reg: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) } };
  }
  // Hoja(s) del día + fotos. Más filas que las del formato: la hoja continúa en otra página (nunca se pierden facturas)
  async function addDay(pdf, cx, cfg, d, onImg) {
    const { T, want, fonts } = cx;
    const per = T.sheet ? T.sheet.layout.rows.n : ROWS, rows = d.rows || [], parts = [];
    for (let k = 0; k < Math.max(1, rows.length); k += per) parts.push(rows.slice(k, k + per));
    if (want.sheet) parts.forEach((part, k) => {
      const last = k === parts.length - 1;
      (T.sheet ? drawSheetT : drawSheet)(pdf, fonts, cfg, Object.assign({}, d, { rows: part, total: last ? d.total : null, more: !last }), T.sheet);
    });
    for (const att of d.pages) { await addImagePage(pdf, att); onImg && onImg(); }
  }
  // PDF de UN día (hoja diaria + fotos), sin portada
  async function buildDay(cfg, day, tpl, onImg) {
    cfg = withWeek(cfg, [day]);
    const pdf = await PDFDocument.create(), cx = await setup(pdf, tpl);
    await addDay(pdf, cx, cfg, day, onImg);
    return pdf.save();
  }
  // Semana: portada (si la ruta la usa) + cada día. cache[day.id] = PDF del día ya guardado (se reutiliza tal cual)
  async function buildPdf(cfg, days, onProgress, tpl, cache) {
    cfg = withWeek(cfg, days);
    const pdf = await PDFDocument.create(), cx = await setup(pdf, tpl);
    const sorted = [...days].sort((a, b) => dateKey(a.date) - dateKey(b.date));
    if (cx.want.cover) (cx.T.cover ? drawCoverT : drawCover)(pdf, cx.fonts, cfg, sorted, cx.T.cover);
    let done = 0;
    for (const d of sorted) {
      if (cache && cache[d.id]) {
        const src = await PDFDocument.load(cache[d.id]);
        (await pdf.copyPages(src, src.getPageIndices())).forEach((pg) => pdf.addPage(pg));
      } else await addDay(pdf, cx, cfg, d);
      onProgress && onProgress(++done / sorted.length);
    }
    return pdf.save();
  }
  function dateKey(d) {
    const m = (d || '').match(/^(\d\d)\/(\d\d)\/(\d{4})$/);
    return m ? +(m[3] + m[1] + m[2]) : 0;
  }

  root.PdfGen = { buildPdf, buildDay, drawCoverL, drawSheetL, canvasTarget, SAMPLE, dayTotal, dateKey, fmt, shortDate };
})(window);
