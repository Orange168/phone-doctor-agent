#!/bin/bash
# phone-http-server.sh — 电脑端管理手机 HTTP 服务
# 功能：启动手机端 HTTP 服务 + 配置 adb forward，实现脱离数据线的 HTTP 调用
# 用法: bash phone-http-server.sh [start|stop|status|test]

set -e
ADB="${ADB_PATH:-/home/master/sourceCode/rk_356x_a12/code/prebuilts/runtime/adb}"
SERIAL="${ADB_SERIAL:-3902f377}"
PHONE_SCRIPT="/data/data/com.termux/files/home/phone-http-server.py"
LOCAL_SCRIPT="/home/master/sourceCode/phone-doctor-agent/mcp-servers/phone-http-server/phone-http-server.py"
HTTP_PORT=8899

start() {
  echo "[1/4] 推送 HTTP 服务到手机..."
  $ADB -s "$SERIAL" push "$LOCAL_SCRIPT" /data/local/tmp/phone-http-server.py
  $ADB -s "$SERIAL" shell "su -c 'cp /data/local/tmp/phone-http-server.py $PHONE_SCRIPT && chown u0_a355:u0_a355 $PHONE_SCRIPT && chmod +x $PHONE_SCRIPT'"

  echo "[2/4] 启动手机端 HTTP 服务（setsid 后台，完全脱离 adb shell）..."
  # 用 nohup + setsid + 完全重定向 stdin/stdout/stderr，避免 adb shell 挂起等待
  timeout 8 $ADB -s "$SERIAL" shell "su -c 'setsid /data/data/com.termux/files/usr/bin/python3 $PHONE_SCRIPT </dev/null >/dev/null 2>&1 &'" 2>&1 || true
  sleep 3

  echo "[3/4] 配置 adb forward tcp:$HTTP_PORT..."
  $ADB -s "$SERIAL" forward "tcp:$HTTP_PORT" "tcp:$HTTP_PORT"

  echo "[4/4] 验证 HTTP 服务..."
  if curl -sS --max-time 5 "http://127.0.0.1:$HTTP_PORT/status" | grep -q '"ok": true'; then
    echo "✅ HTTP 服务已启动: http://127.0.0.1:$HTTP_PORT"
    echo "   设备: $($ADB -s "$SERIAL" shell getprop ro.product.model)"
    echo "   工具列表: curl http://127.0.0.1:$HTTP_PORT/list"
  else
    echo "❌ HTTP 服务启动失败，查看日志:"
    $ADB -s "$SERIAL" shell "su -c 'cat /data/local/tmp/http-server.log'" 2>&1 | tail -10
    exit 1
  fi
}

stop() {
  echo "停止手机端 HTTP 服务..."
  $ADB -s "$SERIAL" shell "su -c 'pkill -f phone-http-server.py'" 2>&1 || true
  $ADB -s "$SERIAL" forward --remove "tcp:$HTTP_PORT" 2>&1 || true
  echo "✅ 已停止"
}

status() {
  echo "=== 手机 HTTP 服务状态 ==="
  $ADB -s "$SERIAL" shell "su -c 'ps -A | grep python3'" 2>&1 | grep -q 8899 && echo "  进程: 运行中" || $ADB -s "$SERIAL" shell "su -c 'netstat -tlnp 2>/dev/null | grep 8899'" 2>&1 | grep -q python3 && echo "  进程: 运行中 (python3)" || echo "  进程: 未运行"
  echo ""
  $ADB -s "$SERIAL" shell "su -c 'netstat -tlnp 2>/dev/null | grep 8899'" 2>&1 | grep LISTEN | head -1 || echo "  端口: 未监听"
  echo ""
  echo "=== adb forward ==="
  $ADB forward --list 2>&1 | grep 8899 || echo "  forward: 未配置"
}

test() {
  echo "=== HTTP 工具测试 ==="
  for ep in status device_info foreground frida_status sshd_status; do
    echo -n "  /$ep: "
    curl -sS --max-time 5 "http://127.0.0.1:$HTTP_PORT/$ep" 2>&1 | head -c 120
    echo ""
  done
  echo -n "  /capture_screen: "
  curl -sS --max-time 8 "http://127.0.0.1:$HTTP_PORT/capture_screen" 2>&1 | head -c 120
  echo ""
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  test) test ;;
  *) echo "用法: $0 [start|stop|status|test]"; exit 1 ;;
esac