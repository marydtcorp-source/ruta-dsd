"""Servidor local de Ruta DSD: sirve la app y lee las fotos con PaddleOCR (RapidOCR, ONNX). Gratis y 100 % local.

Uso:  python server.py [puerto]
  GET  /ocr/health        -> {"ok": true}
  POST /ocr (JPEG/PNG)    -> {"text": "...", "deg": 0, "ms": 1234}   (texto en filas, listo para el lector de reportes)
Las fotos no salen de tu red: se procesan en esta PC.
"""
import io, json, math, os, queue, statistics, sys, threading, time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
from PIL import Image, ImageOps
from rapidocr_onnxruntime import RapidOCR

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
POOL = int(os.environ.get('OCR_WORKERS', '3'))
KEYWORDS = ('settlement', 'proof of delivery', 'invoice', 'total', 'variety', 'supplier', 'inventory')

engines = queue.Queue()
for _ in range(POOL):
    engines.put(RapidOCR(det_limit_side_len=1280))


def rows_from(res):
    """Cajas del OCR -> texto por filas. Corrige la inclinación del papel antes de agrupar."""
    boxes = []
    for box, text, score in res or []:
        (x0, y0), (x1, y1), (x2, y2), (x3, y3) = box
        w = math.hypot(x1 - x0, y1 - y0); h = math.hypot(x3 - x0, y3 - y0)
        boxes.append(dict(cx=(x0 + x1 + x2 + x3) / 4, cy=(y0 + y1 + y2 + y3) / 4, w=w, h=max(h, 1), ang=math.atan2(y1 - y0, x1 - x0), t=text, s=float(score)))
    if not boxes:
        return '', 0.0
    wide = [b['ang'] for b in boxes if b['w'] > 2.2 * b['h']] or [0.0]
    th = statistics.median(wide)
    c, s = math.cos(-th), math.sin(-th)
    for b in boxes:
        b['X'] = b['cx'] * c - b['cy'] * s
        b['Y'] = b['cx'] * s + b['cy'] * c
    mh = statistics.median([b['h'] for b in boxes])
    boxes.sort(key=lambda b: b['Y'])
    rows = []
    for b in boxes:
        if rows and abs(rows[-1]['Y'] - b['Y']) < 0.55 * mh:
            rows[-1]['items'].append(b)
            rows[-1]['Y'] = sum(i['Y'] for i in rows[-1]['items']) / len(rows[-1]['items'])
        else:
            rows.append(dict(Y=b['Y'], items=[b]))
    text = '\n'.join(' '.join(i['t'] for i in sorted(r['items'], key=lambda i: i['X'])) for r in rows)
    quality = sum(len(b['t']) * b['s'] for b in boxes if b['s'] > 0.5)
    return text, quality


def read_image(img):
    """Prueba 0° y, si no se reconoce el documento, los otros giros; devuelve la mejor lectura."""
    eng = engines.get()
    try:
        best = None
        for deg in (0, 90, 270, 180):
            im = img if deg == 0 else img.rotate(-deg, expand=True)  # giro horario
            res, _ = eng(np.asarray(im))
            text, q = rows_from(res)
            if best is None or q > best[1]:
                best = (text, q, deg)
            low = text.lower()
            # derecha y legible (o ya es un documento conocido): no se pierde tiempo probando giros
            if deg == 0 and (q > 300 or sum(k in low for k in KEYWORDS) >= 2):
                break
            if deg != 0 and q > 300:
                break
        return best
    finally:
        engines.put(eng)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if self.path.startswith('/ocr/health'):
            return self._json({'ok': True, 'engine': 'rapidocr', 'workers': POOL})
        if self.path.startswith('/favicon.ico'):  # el navegador siempre lo pide; no hay ícono
            self.send_response(204)
            self.end_headers()
            return
        return super().do_GET()

    def do_POST(self):
        if not self.path.startswith('/ocr'):
            return self._json({'error': 'ruta no válida'}, 404)
        try:
            n = int(self.headers.get('Content-Length', 0))
            img = ImageOps.exif_transpose(Image.open(io.BytesIO(self.rfile.read(n)))).convert('RGB')
            t0 = time.time()
            text, q, deg = read_image(img)
            self._json({'text': text, 'deg': deg, 'quality': q, 'ms': int((time.time() - t0) * 1000)})
        except Exception as e:  # noqa: BLE001
            self._json({'error': str(e)}, 500)

    def log_message(self, fmt, *args):
        # args[0] puede ser un HTTPStatus (errores 404...), no siempre texto
        first = str(args[0]) if args else ''
        if '/ocr' in first:
            sys.stderr.write('OCR %s\n' % first)


if __name__ == '__main__':
    print(f'Ruta DSD en http://0.0.0.0:{PORT}  (lectura de fotos con PaddleOCR local, {POOL} lectores)')
    ThreadingHTTPServer(('0.0.0.0', PORT), Handler).serve_forever()
