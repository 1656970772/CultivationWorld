import http.server
import json
import mimetypes
import os
import re
import socketserver
import sys
import time
import webbrowser

mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('application/javascript', '.mjs')
mimetypes.add_type('application/json', '.json')
mimetypes.add_type('text/css', '.css')

# 日志/重放落盘根目录（相对 serve.py 所在目录）。浏览器无法直接写本地磁盘，
# 故由本静态服务器接收 POST 落盘，实现「日志落盘 + 重放」需要的本地持久化。
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RUNS_DIR = os.path.join(BASE_DIR, 'runs')

# 安全：runId / 文件名只允许字母数字/下划线/连字符/点，防止路径穿越。
_SAFE = re.compile(r'^[A-Za-z0-9_.-]+$')


def _safe_name(name, fallback):
    name = str(name or '').strip()
    return name if _SAFE.match(name) else fallback


class JSHandler(http.server.SimpleHTTPRequestHandler):
    def guess_type(self, path):
        mimetype, _ = mimetypes.guess_type(path)
        if mimetype:
            return mimetype
        return 'application/octet-stream'

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def _send_json(self, status, obj):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        length = int(self.headers.get('Content-Length', 0) or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode('utf-8'))

    def do_POST(self):
        try:
            # /api/log  —— 追加一批日志行到 runs/<runId>/log.jsonl
            if self.path == '/api/log':
                data = self._read_json_body()
                run_id = _safe_name(data.get('runId'), 'default')
                lines = data.get('lines') or []
                run_dir = os.path.join(RUNS_DIR, run_id)
                os.makedirs(run_dir, exist_ok=True)
                path = os.path.join(run_dir, 'log.jsonl')
                with open(path, 'a', encoding='utf-8') as f:
                    for line in lines:
                        f.write(json.dumps(line, ensure_ascii=False))
                        f.write('\n')
                self._send_json(200, {'ok': True, 'written': len(lines)})
                return

            # /api/replay  —— 整体写入一份重放文件 runs/<runId>/replay.json
            if self.path == '/api/replay':
                data = self._read_json_body()
                run_id = _safe_name(data.get('runId'), 'default')
                replay = data.get('replay') or {}
                run_dir = os.path.join(RUNS_DIR, run_id)
                os.makedirs(run_dir, exist_ok=True)
                path = os.path.join(run_dir, 'replay.json')
                with open(path, 'w', encoding='utf-8') as f:
                    json.dump(replay, f, ensure_ascii=False)
                self._send_json(200, {'ok': True, 'path': f'runs/{run_id}/replay.json'})
                return

            self._send_json(404, {'ok': False, 'error': 'unknown endpoint'})
        except Exception as exc:  # noqa: BLE001 —— 落盘失败不应影响游戏，返回错误即可。
            self._send_json(500, {'ok': False, 'error': str(exc)})


class ThreadingTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


PORT = 8888
URL = f"http://127.0.0.1:{PORT}/index.html"

with ThreadingTCPServer(("", PORT), JSHandler) as httpd:
    os.makedirs(RUNS_DIR, exist_ok=True)
    print(f"Serving game at {URL}", flush=True)
    print(f"Run logs/replays will be saved under {RUNS_DIR}", flush=True)
    print("Close this window to stop the game web preview.", flush=True)
    if "--open" in sys.argv:
        webbrowser.open(URL)
    httpd.serve_forever()
