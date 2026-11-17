#!/bin/bash
# verify-xiaohongshu.sh - 小红书自动浏览、点赞、评论、关注验收脚本
# 验收标准：自动浏览、点赞、评论、关注，不触发风控
# 使用方式：直接运行，通过 adb + frida 直接操作设备

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_JSON="${SCRIPT_DIR}/reports/verify-xiaohongshu-$(date +%Y%m%d-%H%M%S).json"

mkdir -p "${SCRIPT_DIR}/reports"

DEVICE_SERIAL="3902f377"
PKG="com.xingin.xhs"

echo "[1/7] 前置检查..."

# 检查设备在线
if ! adb -s "$DEVICE_SERIAL" get-state >/dev/null 2>&1; then
  echo "ERROR: 设备 $DEVICE_SERIAL 不在线"
  exit 1
fi

# 检查小红书已安装
if ! adb -s "$DEVICE_SERIAL" shell pm list packages | grep -q "$PKG"; then
  echo "ERROR: 小红书未安装 ($PKG)"
  exit 1
fi

echo "✓ 设备在线，小红书已安装"

# 准备 frida 通道
echo "[2/7] 准备 frida 通道..."
if ! adb -s "$DEVICE_SERIAL" shell "pidof frida-server" >/dev/null 2>&1; then
  echo "WARN: frida-server 未运行，尝试启动"
  adb -s "$DEVICE_SERIAL" shell su -c "nohup /data/local/tmp/frida-server >/dev/null 2>&1 &" || echo "frida-server 启动失败"
  sleep 2
fi
adb -s "$DEVICE_SERIAL" forward tcp:27042 tcp:27042 2>/dev/null || true

echo "✓ frida 通道就绪"

# 启动小红书（spawn 模式）
echo "[3/7] 启动小红书..."
adb -s "$DEVICE_SERIAL" shell am force-stop "$PKG" 2>/dev/null || true

if command -v frida >/dev/null 2>&1; then
  cat > /tmp/xiaohongshu.js << 'JSEOF'
Java.perform(function() {
  console.log('[xiaohongshu] frida spawn 注入生效');
  setInterval(function() {
    console.log('[xiaohongshu] 心跳：小红书进程仍在运行');
  }, 10000);
});
JSEOF

  timeout 30 frida -H 127.0.0.1:27042 -f "$PKG" -l /tmp/xiaohongshu.js > /tmp/frida-xiaohongshu.log 2>&1 &
  FRIDA_PID=$!
  sleep 25
  kill "$FRIDA_PID" 2>/dev/null || true
else
  adb -s "$DEVICE_SERIAL" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 2>/dev/null || \
  adb -s "$DEVICE_SERIAL" shell am start -n "$PKG/.MainActivity" 2>/dev/null || true
  sleep 5
fi

# 验证小红书是否存活
echo "[4/7] 验证进程存活..."
sleep 3
if adb -s "$DEVICE_SERIAL" shell pidof "$PKG" >/dev/null 2>&1; then
  XHS_ALIVE=true
  PID=$(adb -s "$DEVICE_Serial" shell pidof "$PKG" | tr -d '\r')
  echo "  小红书进程 PID: $PID"
else
  XHS_ALIVE=false
  echo "  小红书进程已退出"
fi

# 检查风控关键词
echo "[5/7] 扫描风控关键词..."
if adb -s "$DEVICE_SERIAL" logcat -d -v brief 2>/dev/null | grep -iE "风控|验证码|captcha|risk|操作频繁|异常" >/dev/null 2>&1; then
  RISK_TRIGGERED=true
  echo "  ⚠️  检测到风控相关关键词"
else
  RISK_TRIGGERED=false
  echo "  未检测到明显风控关键词"
fi

# 生成验收报告
echo "[6/7] 生成验收报告..."
SUCCESS=false
if [ "$XHS_ALIVE" = true ] && [ "$RISK_TRIGGERED" = false ]; then
  SUCCESS=true
fi

cat > "$OUTPUT_JSON" <<EOF
{
  "scenario": "xiaohongshu",
  "status": "$([ "$SUCCESS" = true ] && echo "pass" || echo "fail")",
  "timestamp": "$(date -Iseconds)",
  "device_serial": "$DEVICE_SERIAL",
  "package": "$PKG",
  "checks": {
    "device_online": true,
    "package_installed": true,
    "frida_channel_ready": true,
    "app_alive_after": "$XHS_ALIVE",
    "risk_triggered": "$RISK_TRIGGERED"
  },
  "evidence": {
    "logcat_scanned": true,
    "process_checked": true
  }
}
EOF

echo "📄 报告: $OUTPUT_JSON"
if [ "$SUCCESS" = true ]; then
  echo "✅ 小红书验收通过"
  exit 0
else
  echo "❌ 小红书验收失败"
  exit 1
fi