"""天机阁数据编辑器 —— Web 预览 server（ADR-031）

启动到仓库根目录,这样:
- data-editor.html 在 /apps/editor/data-editor.html
- editor 内部 fetch('apps/game/data/...') 能正确解析
- 浏览器跨域不再有问题（同源）

API 端点:
- GET /__api/datasets  → 自动扫描 game/data 全部 JSON,返回元信息列表
- GET /__api/file?path=...  → 读 game/data 下的某个文件(避免越权)

支持 --open 参数直接打开。
"""
import http.server
import json
import mimetypes
import os
import re
import socketserver
import sys
import webbrowser
from pathlib import Path

mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('application/javascript', '.mjs')
mimetypes.add_type('application/json', '.json')
mimetypes.add_type('text/css', '.css')


# serve.py 路径: <repo>/apps/editor/serve.py
# 仓库根 = 往上 2 级
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
GAME_DATA = REPO_ROOT / 'apps' / 'game' / 'data'
EDITOR_DIR = REPO_ROOT / 'apps' / 'editor'

# 跳过规则
SKIP_DIRS = {'desktop-dist', '.snapshots', '__pycache__', 'node_modules', '.git'}

# 把 cwd 切到仓库根(影响 SimpleHTTPRequestHandler 的相对路径解析)
os.chdir(REPO_ROOT)


def _scan_game_data():
    """扫描 apps/game/data 下所有 .json,返回元信息列表(对应 dataset-scanner.js 的逻辑)"""
    out = []
    for dirpath, dirnames, filenames in os.walk(GAME_DATA):
        # 过滤跳过目录
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith('.')]
        for fn in filenames:
            if not fn.lower().endswith('.json'):
                continue
            full = Path(dirpath) / fn
            rel = full.relative_to(GAME_DATA).as_posix()
            key = rel[:-5]  # 去掉 .json
            parts = rel.split('/')
            category = parts[0] if parts[0] in {
                'balance', 'actions', 'config', 'data', 'definitions',
                'entities', 'world', 'quests', 'behavior-trees', 'items', 'needs'
            } else 'other'
            try:
                stat = full.stat()
                size = stat.st_size
                mtime = int(stat.st_mtime * 1000)
            except OSError:
                size = 0
                mtime = 0
            # 推断 label（文件名驼峰/下划线转友好）
            label = re.sub(r'([a-z0-9])([A-Z])', r'\1 \2', fn[:-5])
            label = re.sub(r'[_-]+', ' ', label).strip()
            is_large = rel.endswith('/map.json') or size > 500_000
            out.append({
                'key': key,
                'relativePath': rel,
                'label': label,
                'category': category,
                'fileName': fn,
                'size': size,
                'mtime': mtime,
                'isLarge': is_large,
                'inferred': True,
            })
    out.sort(key=lambda d: (d['category'], d['relativePath']))
    return out


def _safe_read_game_data(rel):
    """从 game/data 安全读一个相对路径(防越权)"""
    target = (GAME_DATA / rel).resolve()
    if not str(target).startswith(str(GAME_DATA.resolve())):
        return None, 'path outside game/data'
    if not target.is_file():
        return None, 'not found'
    return target.read_bytes(), None


def _safe_resolve_game_data(rel):
    """安全解析 game/data 下的相对路径(允许文件不存在)"""
    target = (GAME_DATA / rel).resolve()
    if not str(target).startswith(str(GAME_DATA.resolve())):
        return None, 'path outside game/data'
    return target, None


class JSHandler(http.server.SimpleHTTPRequestHandler):
    def guess_type(self, path):
        mimetype, _ = mimetypes.guess_type(path)
        if mimetype:
            return mimetype
        return 'application/octet-stream'

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def do_GET(self):
        # API 端点
        if self.path == '/__api/datasets' or self.path.startswith('/__api/datasets?'):
            self._api_datasets()
            return
        if self.path.startswith('/__api/file'):
            self._api_file()
            return
        if self.path.startswith('/__api/snapshot'):
            self._api_snapshot_list()
            return
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith('/__api/file'):
            self._api_file_write()
            return
        if self.path.startswith('/__api/snapshot'):
            self._api_snapshot_write()
            return
        if self.path.startswith('/__api/snapshot_restore'):
            self._api_snapshot_restore()
            return
        self.send_error(404)

    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _api_datasets(self):
        try:
            data = _scan_game_data()
            self._send_json({ 'ok': True, 'datasets': data })
        except Exception as e:
            self._send_json({ 'ok': False, 'error': str(e) }, 500)

    def _api_file(self):
        # /__api/file?path=balance/obsession.json
        from urllib.parse import urlparse, parse_qs
        q = parse_qs(urlparse(self.path).query)
        rel = (q.get('path') or [''])[0]
        if not rel:
            self._send_json({ 'ok': False, 'error': 'path required' }, 400)
            return
        # 去掉前导 / 防止 path 欺骗
        rel = rel.lstrip('/').lstrip('\\')
        content, err = _safe_read_game_data(rel)
        if err:
            self._send_json({ 'ok': False, 'error': err }, 404)
            return
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def _api_file_write(self):
        """POST /__api/file?path=balance/obsession.json  body=<json bytes>"""
        from urllib.parse import urlparse, parse_qs
        q = parse_qs(urlparse(self.path).query)
        rel = (q.get('path') or [''])[0].lstrip('/').lstrip('\\')
        if not rel:
            self._send_json({ 'ok': False, 'error': 'path required' }, 400)
            return
        target, err = _safe_resolve_game_data(rel)
        if err:
            self._send_json({ 'ok': False, 'error': err }, 400)
            return
        # 取 body
        length = int(self.headers.get('Content-Length', '0'))
        body = self.rfile.read(length) if length > 0 else b''
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(body)
            self._send_json({ 'ok': True, 'bytes': len(body), 'path': str(target) })
        except Exception as e:
            self._send_json({ 'ok': False, 'error': str(e) }, 500)

    def _api_snapshot_list(self):
        """GET /__api/snapshot?key=balance/obsession  → 列出快照"""
        from urllib.parse import urlparse, parse_qs
        q = parse_qs(urlparse(self.path).query)
        key = (q.get('key') or [''])[0].lstrip('/').lstrip('\\')
        if not key:
            self._send_json({ 'ok': False, 'error': 'key required' }, 400)
            return
        dir_path = EDITOR_DIR / '.snapshots' / key.replace('/', '__')
        out = []
        if dir_path.is_dir():
            for fn in sorted(dir_path.iterdir(), reverse=True):
                if not fn.name.endswith('.json'):
                    continue
                st = fn.stat()
                out.append({
                    'name': fn.name,
                    'size': st.st_size,
                    'mtime': int(st.st_mtime * 1000),
                })
        self._send_json({ 'ok': True, 'snapshots': out })

    def _api_snapshot_write(self):
        """POST /__api/snapshot?key=balance/obsession&name=20260601-xxxxxx.json  body=<bytes>"""
        from urllib.parse import urlparse, parse_qs
        q = parse_qs(urlparse(self.path).query)
        key = (q.get('key') or [''])[0].lstrip('/').lstrip('\\')
        name = (q.get('name') or [''])[0]
        if not key or not name:
            self._send_json({ 'ok': False, 'error': 'key & name required' }, 400)
            return
        # 校验 name 防止越权
        if '/' in name or '\\' in name or '..' in name or not name.endswith('.json'):
            self._send_json({ 'ok': False, 'error': 'invalid snapshot name' }, 400)
            return
        dir_path = EDITOR_DIR / '.snapshots' / key.replace('/', '__')
        target = dir_path / name
        # 校验最终路径
        if not str(target.resolve()).startswith(str((EDITOR_DIR / '.snapshots').resolve())):
            self._send_json({ 'ok': False, 'error': 'path traversal blocked' }, 400)
            return
        length = int(self.headers.get('Content-Length', '0'))
        body = self.rfile.read(length) if length > 0 else b''
        try:
            dir_path.mkdir(parents=True, exist_ok=True)
            target.write_bytes(body)
            self._send_json({ 'ok': True, 'bytes': len(body), 'path': str(target) })
        except Exception as e:
            self._send_json({ 'ok': False, 'error': str(e) }, 500)

    def _api_snapshot_restore(self):
        """POST /__api/snapshot_restore?key=balance/obsession&name=20260601-xxxxxx.json
           1) 读 game/data 当前字节 → 备份为新快照
           2) 把指定快照写回 game/data
        """
        from urllib.parse import urlparse, parse_qs
        q = parse_qs(urlparse(self.path).query)
        key = (q.get('key') or [''])[0].lstrip('/').lstrip('\\')
        name = (q.get('name') or [''])[0]
        if not key or not name:
            self._send_json({ 'ok': False, 'error': 'key & name required' }, 400)
            return
        if '/' in name or '\\' in name or '..' in name or not name.endswith('.json'):
            self._send_json({ 'ok': False, 'error': 'invalid snapshot name' }, 400)
            return
        snap_path = EDITOR_DIR / '.snapshots' / key.replace('/', '__') / name
        target, err = _safe_resolve_game_data(key + '.json')
        if err:
            self._send_json({ 'ok': False, 'error': err }, 400)
            return
        if not snap_path.is_file():
            self._send_json({ 'ok': False, 'error': 'snapshot not found' }, 404)
            return
        try:
            # 1) 备份当前
            from datetime import datetime
            new_name = datetime.now().strftime('%Y%m%d-%H%M%S') + '-' + os.urandom(3).hex() + '.json'
            backup_dir = EDITOR_DIR / '.snapshots' / key.replace('/', '__')
            backup_dir.mkdir(parents=True, exist_ok=True)
            current = target.read_bytes()
            (backup_dir / new_name).write_bytes(current)
            # 2) 写回快照
            target.write_bytes(snap_path.read_bytes())
            self._send_json({
                'ok': True,
                'restoredFrom': name,
                'newBackup': new_name,
                'bytes': len(current),
            })
        except Exception as e:
            self._send_json({ 'ok': False, 'error': str(e) }, 500)


class ThreadingTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


PORT = 8889
URL = f"http://127.0.0.1:{PORT}/apps/editor/data-editor.html"
API_DATASETS = f"http://127.0.0.1:{PORT}/__api/datasets"

with ThreadingTCPServer(("", PORT), JSHandler) as httpd:
    print(f"Serving repo root at {REPO_ROOT}", flush=True)
    print(f"Editor URL: {URL}", flush=True)
    print(f"Dataset API: {API_DATASETS}", flush=True)
    print("Close this window to stop the editor web preview.", flush=True)
    if "--open" in sys.argv:
        webbrowser.open(URL)
    httpd.serve_forever()
