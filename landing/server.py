import http.server, json, os, urllib.error, urllib.parse, urllib.request

PORT = int(os.environ.get('FRONT_PORT', 8080))
# Используем 127.0.0.1 вместо localhost: на Windows localhost может резолвиться
# в IPv6 (::1), а бэкенд (waitress на 0.0.0.0) слушает только IPv4 — из-за чего
# прокси не мог достучаться и отдавал 502 "API недоступен (localhost:5050)".
API_UPSTREAM = os.environ.get('API_UPSTREAM', 'http://127.0.0.1:5050')

class Handler(http.server.SimpleHTTPRequestHandler):
    # Явно помечаем текстовые ресурсы как UTF-8. Иначе SimpleHTTPRequestHandler
    # отдаёт .html/.css/.js без charset, и браузер на Windows угадывает кодировку
    # как Windows-1251 — из-за чего кириллица превращается в "РћРїРёСЃР°РЅРёРµ".
    # HTTP-заголовок Content-Type имеет приоритет над <meta charset>, поэтому
    # чиним именно здесь.
    _UTF8_TEXT_TYPES = (
        'text/html', 'text/css', 'text/plain', 'text/javascript',
        'application/javascript', 'application/json', 'image/svg+xml',
    )

    def guess_type(self, path):
        ctype = super().guess_type(path)
        base = ctype.split(';', 1)[0].strip().lower()
        if base in self._UTF8_TEXT_TYPES and 'charset=' not in ctype.lower():
            return base + '; charset=utf-8'
        return ctype

    def _is_fingerprinted_next_asset(self):
        return urllib.parse.urlparse(self.path).path.startswith('/_next/static/')

    def _forward_request_headers(self, req):
        for header in ('Authorization', 'Content-Type', 'Accept', 'Cookie', 'X-CSRF-Token'):
            value = self.headers.get(header)
            if value:
                req.add_header(header, value)

    def _send_upstream_response(self, status, headers, body, default_content_type):
        self.send_response(status)
        self.send_header('Content-Type', headers.get('Content-Type', default_content_type))
        for cookie in headers.get_all('Set-Cookie', []):
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(body)

    def _proxy(self, body=None):
        upstream_url = API_UPSTREAM + self.path
        try:
            req = urllib.request.Request(upstream_url, data=body, method=self.command)
            self._forward_request_headers(req)
            with urllib.request.urlopen(req, timeout=25) as resp:
                self._send_upstream_response(resp.status, resp.headers, resp.read(), 'application/octet-stream')
        except urllib.error.HTTPError as e:
            self._send_upstream_response(e.code, e.headers, e.read(), 'application/json; charset=utf-8')
        except Exception:
            self.send_response(502)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(json.dumps({'error': 'API недоступен (localhost:5050)'}).encode())

    def _proxy_get(self):
        self._proxy()

    def _proxy_api(self):
        content_length = int(self.headers.get('Content-Length', '0'))
        body = self.rfile.read(content_length) if content_length else None
        self._proxy(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == '/admin.html':
            self.send_response(302)
            self.send_header('Location', '/admin/')
            self.end_headers()
            return

        if parsed.path in ('/admin', '/admin/') or parsed.path.startswith('/_next/'):
            self._proxy_get()
            return

        if parsed.path.startswith('/api/'):
            self._proxy_api()
            return

        return super().do_GET()

    def do_POST(self):
        self._proxy_api()

    def do_PUT(self):
        self._proxy_api()

    def do_PATCH(self):
        self._proxy_api()

    def do_DELETE(self):
        self._proxy_api()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept, X-CSRF-Token')
        self.end_headers()

    def end_headers(self):
        # The admin is served same-origin; do not add permissive CORS headers.
        if self._is_fingerprinted_next_asset():
            self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
        else:
            self.send_header('Cache-Control', 'no-store')
        super().end_headers()

if __name__ == '__main__':
    os.chdir(os.path.join(os.path.dirname(__file__)))
    server = http.server.ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    print(f'Сервер запущен на http://127.0.0.1:{PORT}')
    print(f'API прокси на {API_UPSTREAM}')
    server.serve_forever()
