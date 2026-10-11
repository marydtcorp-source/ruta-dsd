// Lector de fotos en la PC (PaddleOCR local, gratis): la app manda la foto al servidor de esta PC (server.py) y recibe el texto.
// Las fotos no salen de tu red. Si el servidor no está, la app lee con sus lectores normales.
(function (root) {
  const PcOcr = {
    base: '',
    available: false,
    // base: '' = mismo servidor que sirve la app; o 'http://192.168.0.100:8765' desde la app de Android
    async probe(base) {
      this.base = (base || '').replace(/\/+$/, '');
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 2500);
        const r = await fetch(this.base + '/ocr/health', { cache: 'no-store', signal: ctrl.signal });
        clearTimeout(t);
        const j = r.ok ? await r.json() : null;
        this.available = !!(j && j.ok);
      } catch (e) { this.available = false; }
      return this.available;
    },
    // canvas -> { text, deg }
    // file: la foto original (se manda tal cual, sin volver a comprimir, para no perder detalle)
    async read(canvas, file) {
      if (file && /^image\/(jpeg|png)$/.test(file.type) && file.size < 12e6) {
        const r0 = await fetch(this.base + '/ocr', { method: 'POST', body: file, headers: { 'Content-Type': file.type } });
        if (!r0.ok) throw new Error('OCR de la PC: HTTP ' + r0.status);
        const j0 = await r0.json();
        if (j0.error) throw new Error(j0.error);
        return j0;
      }
      const long = Math.max(canvas.width, canvas.height), s = Math.min(1, 2000 / long);
      let c = canvas;
      if (s < 1) { c = document.createElement('canvas'); c.width = Math.round(canvas.width * s); c.height = Math.round(canvas.height * s); c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height); }
      const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92));
      const r = await fetch(this.base + '/ocr', { method: 'POST', body: blob, headers: { 'Content-Type': 'image/jpeg' } });
      if (!r.ok) throw new Error('OCR de la PC: HTTP ' + r.status);
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      return j;
    },
  };
  root.PcOcr = PcOcr;
})(window);
