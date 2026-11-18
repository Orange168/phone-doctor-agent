#!/usr/bin/env python3
# phone-http-server.py — 手机端 HTTP 服务（方案 B：MCP 能力 HTTP 化）
# 在 Termux 中运行，监听 0.0.0.0:8899，把手机能力封装为 REST API
# 电脑端通过 adb forward tcp:8899 tcp:8899 访问，脱离数据线

import json
import subprocess
import os
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

# 设备命令封装：所有命令通过 su -c 在设备本地执行（不依赖 adb）
def run_local(cmd, timeout=15):
    """在设备本地执行 shell 命令（通过 su）"""
    try:
        r = subprocess.run(
            ['su', '-c', cmd],
            capture_output=True, text=True, timeout=timeout
        )
        return {
            'ok': r.returncode == 0,
            'code': r.returncode,
            'stdout': r.stdout.strip(),
            'stderr': r.stderr.strip(),
        }
    except subprocess.TimeoutExpired:
        return {'ok': False, 'code': -1, 'stdout': '', 'stderr': 'timeout'}
    except Exception as e:
        return {'ok': False, 'code': -1, 'stdout': '', 'stderr': str(e)}

def run_termux(cmd, timeout=15):
    """在 Termux 用户环境执行命令"""
    try:
        r = subprocess.run(
            ['su', '-c', f'su u0_a355 -c "{cmd}"'],
            capture_output=True, text=True, timeout=timeout
        )
        return {
            'ok': r.returncode == 0,
            'code': r.returncode,
            'stdout': r.stdout.strip(),
            'stderr': r.stderr.strip(),
        }
    except subprocess.TimeoutExpired:
        return {'ok': False, 'code': -1, 'stdout': '', 'stderr': 'timeout'}
    except Exception as e:
        return {'ok': False, 'code': -1, 'stdout': '', 'stderr': str(e)}

# ============ 工具实现（对应 MCP 工具） ============

def device_status():
    return {'ok': True, 'device': 'PGP110', 'serial': '3902f377',
            'online': True, 'kernel': '5.10.236'}

def device_info():
    r = run_local('getprop ro.product.model')
    model = r['stdout'] if r['ok'] else '?'
    r2 = run_local('getprop ro.build.version.release')
    android = r2['stdout'] if r2['ok'] else '?'
    r3 = run_local('dumpsys battery | grep -E "level|status"')
    battery = r3['stdout'] if r3['ok'] else '?'
    return {'ok': True, 'model': model, 'android': android, 'battery': battery}

def capture_screen():
    out = '/data/local/tmp/phone_screen.png'
    r = run_local(f'screencap -p {out}')
    return {'ok': r['ok'], 'file': out, 'code': r['code'], 'stderr': r['stderr']}

def get_foreground_app():
    r = run_local('dumpsys activity activities | grep -m1 mResumedActivity')
    return {'ok': r['ok'], 'foreground': r['stdout'][:200]}

def get_layout_tree():
    out = '/data/local/tmp/layout.xml'
    r = run_local(f'uiautomator dump {out}')
    if r['ok'] and os.path.exists(out):
        with open(out) as f:
            content = f.read()
        return {'ok': True, 'file': out, 'size': len(content), 'preview': content[:500]}
    return {'ok': False, 'file': out, 'stderr': r['stderr']}

def tap(x, y):
    r = run_local(f'input tap {x} {y}')
    return {'ok': r['ok'], 'action': f'tap({x},{y})', 'code': r['code']}

def swipe(x1, y1, x2, y2, duration=300):
    r = run_local(f'input swipe {x1} {y1} {x2} {y2} {duration}')
    return {'ok': r['ok'], 'action': f'swipe({x1},{y1},{x2},{y2})', 'code': r['code']}

def input_text(text):
    escaped = text.replace(' ', '%s').replace("'", "\\'")
    r = run_local(f"input text '{escaped}'")
    return {'ok': r['ok'], 'action': 'input_text', 'text': text, 'code': r['code']}

def press_key(keycode):
    r = run_local(f'input keyevent {keycode}')
    return {'ok': r['ok'], 'action': f'press_key({keycode})', 'code': r['code']}

def screen_status():
    r = run_local('dumpsys power | grep -E "mWakefulness|mScreenOn"')
    return {'ok': r['ok'], 'status': r['stdout']}

def wake_screen():
    r = run_local('input keyevent KEYCODE_WAKEUP')
    return {'ok': r['ok'], 'action': 'wake_screen'}

def sleep_screen():
    r = run_local('input keyevent KEYCODE_SLEEP')
    return {'ok': r['ok'], 'action': 'sleep_screen'}

def sensor_status():
    r = run_local('dumpsys sensorservice')
    lines = [l for l in r['stdout'].split('\n') if 'name=' in l and 'vendor=' in l][:20]
    return {'ok': r['ok'], 'count': len(lines), 'sensors': lines}

def frida_status():
    r = run_local('pidof frida-server')
    return {'ok': r['ok'], 'running': bool(r['stdout']), 'pid': r['stdout']}

def sshd_status():
    r = run_local('pidof sshd')
    return {'ok': r['ok'], 'running': bool(r['stdout']), 'pid': r['stdout']}

def run_command(cmd):
    r = run_local(cmd)
    return r

# ============ HTTP 路由 ============

ROUTES = {
    '/status': device_status,
    '/device_info': device_info,
    '/capture_screen': capture_screen,
    '/foreground': get_foreground_app,
    '/layout': get_layout_tree,
    '/sensor_status': sensor_status,
    '/frida_status': frida_status,
    '/sshd_status': sshd_status,
    '/wake': wake_screen,
    '/sleep': sleep_screen,
    '/screen_status': screen_status,
}

class Handler(BaseHTTPRequestHandler):
    def _send(self, data, code=200):
        body = json.dumps(data, ensure_ascii=False, indent=2).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        # 简洁日志
        print(f"[{time.strftime('%H:%M:%S')}] {args[0]}")

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        # 根路径 → 工具列表
        if path == '/' or path == '/list':
            tools = [{'name': k, 'path': k} for k in ROUTES]
            self._send({'ok': True, 'tools': tools, 'count': len(tools)})
            return

        # 匹配路由
        if path in ROUTES:
            try:
                result = ROUTES[path]()
                self._send(result)
            except Exception as e:
                self._send({'ok': False, 'error': str(e)}, 500)
            return

        # 带参数的路由
        if path == '/tap':
            x = qs.get('x', ['0'])[0]
            y = qs.get('y', ['0'])[0]
            self._send(tap(int(x), int(y)))
            return
        if path == '/swipe':
            x1 = qs.get('x1', ['0'])[0]
            y1 = qs.get('y1', ['0'])[0]
            x2 = qs.get('x2', ['0'])[0]
            y2 = qs.get('y2', ['0'])[0]
            dur = qs.get('duration', ['300'])[0]
            self._send(swipe(int(x1), int(y1), int(x2), int(y2), int(dur)))
            return
        if path == '/input_text':
            text = qs.get('text', [''])[0]
            self._send(input_text(text))
            return
        if path == '/press_key':
            key = qs.get('key', ['0'])[0]
            self._send(press_key(key))
            return

        self._send({'ok': False, 'error': f'unknown path: {path}'}, 404)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length) if length > 0 else b'{}'

        try:
            data = json.loads(body) if body else {}
        except json.JSONDecodeError:
            data = {}

        if path == '/tap':
            self._send(tap(int(data.get('x', 0)), int(data.get('y', 0))))
            return
        if path == '/swipe':
            self._send(swipe(
                int(data.get('x1', 0)), int(data.get('y1', 0)),
                int(data.get('x2', 0)), int(data.get('y2', 0)),
                int(data.get('duration', 300))
            ))
            return
        if path == '/input_text':
            self._send(input_text(data.get('text', '')))
            return
        if path == '/press_key':
            self._send(press_key(data.get('key', '0')))
            return
        if path == '/exec':
            cmd = data.get('cmd', '')
            if not cmd:
                self._send({'ok': False, 'error': 'missing cmd'}, 400)
                return
            self._send(run_command(cmd))
            return

        self._send({'ok': False, 'error': f'unknown POST path: {path}'}, 404)

def main():
    port = 8899
    server = HTTPServer(('0.0.0.0', port), Handler)
    print(f"phone-http-server listening on 0.0.0.0:{port}")
    print(f"tools: {len(ROUTES) + 5} routes available")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down")
        server.server_close()

if __name__ == '__main__':
    main()