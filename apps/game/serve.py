import http.server
import mimetypes
import socketserver
import sys
import webbrowser

mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('application/javascript', '.mjs')
mimetypes.add_type('application/json', '.json')
mimetypes.add_type('text/css', '.css')

class JSHandler(http.server.SimpleHTTPRequestHandler):
    def guess_type(self, path):
        mimetype, _ = mimetypes.guess_type(path)
        if mimetype:
            return mimetype
        return 'application/octet-stream'

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

class ThreadingTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True

PORT = 8888
URL = f"http://127.0.0.1:{PORT}/index.html"

with ThreadingTCPServer(("", PORT), JSHandler) as httpd:
    print(f"Serving game at {URL}", flush=True)
    print("Close this window to stop the game web preview.", flush=True)
    if "--open" in sys.argv:
        webbrowser.open(URL)
    httpd.serve_forever()
