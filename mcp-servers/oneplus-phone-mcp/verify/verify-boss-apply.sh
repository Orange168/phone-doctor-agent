#!/bin/bash
# verify-boss-apply.sh - Boss直聘自动投简历+回消息验收脚本
# 验收标准：自动投递简历、自动回复HR消息，不触发风控

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_JSON="${SCRIPT_DIR}/reports/verify-boss-apply-$(date +%Y%m%d-%H%M%S).json"

mkdir -p "${SCRIPT_DIR}/reports"

echo "[1/6] 前置检查..."
DEVICE_SERIAL="3902f377"
MCP_ENDPOINT="http://localhost:8080"

if ! adb -s "$DEVICE_SERIAL" get-state >/dev/null 2>&1; then
  echo "ERROR: 设备 $DEVICE_SERIAL 不在线"
  exit 1
fi

# Boss直聘包名（需提前确认）
BOSS_PACKAGE="com.hpbr.bosszhipin"

if ! adb -s "$DEVICE_SERIAL" shell pm list packages | grep -q "$BOSS_PACKAGE"; then
  echo "ERROR: Boss直聘未安装"
  exit 1
fi

echo "✓ 设备在线，Boss直聘已安装"

echo "[2/6] 启动 Boss 自动投递任务（MCP）..."
BOSS_APPLY_RESULT=$(curl -s -X POST "${MCP_ENDPOINT}/tools/boss_apply" \
  -H "Content-Type: application/json" \
  -d '{
    "package": "'"$BOSS_PACKAGE"'",
    "keywords": ["Android开发", "系统工程师", "驱动开发"],
    "max_apply": 10,
    "auto_reply": true,
    "reply_template": "您好，我对这个职位很感兴趣，方便详细聊聊吗？"
  }' 2>/dev/null || echo "MCP_CALL_FAILED")

if [ "$BOSS_APPLY_RESULT" = "MCP_CALL_FAILED" ]; then
  echo "ERROR: MCP Boss投递调用失败"
  cat > "$OUTPUT_JSON" <<EOF
{
  "scenario": "boss_apply",
  "status": "failed",
  "timestamp": "$(date -Iseconds)",
  "error": "MCP call failed"
}
EOF
  exit 1
fi

echo "✓ MCP Boss 投递任务已启动"

echo "[3/6] 等待任务执行（60秒，投递+回复较慢）..."
sleep 60

echo "[4/6] 验证执行结果..."
if adb -s "$DEVICE_SERIAL" shell pidof "$BOSS_PACKAGE" >/dev/null; then
  BOSS_ALIVE=true
else
  BOSS_ALIVE=false
fi

if adb -s "$DEVICE_SERIAL" logcat -d -v brief | grep -iE "风控|验证码|操作频繁|限制" >/dev/null 2>&1; then
  RISK_TRIGGERED=true
else
  RISK_TRIGGERED=false
fi

APPLY_COUNT=$(echo "$BOSS_APPLY_RESULT" | jq -r '.apply_count // 0' 2>/dev/null || echo "0")
REPLY_COUNT=$(echo "$BOSS_APPLY_RESULT" | jq -r '.reply_count // 0' 2>/dev/null || echo "0")

echo "  投递数量: $APPLY_COUNT, 回复数量: $REPLY_COUNT"

echo "[5/6] 生成验收报告..."
SUCCESS=false
if [ "$BOSS_ALIVE" = true ] && [ "$RISK_TRIGGERED" = false ] && [ "$APPLY_COUNT" -gt 0 ]; then
  SUCCESS=true
fi

cat > "$OUTPUT_JSON" <<EOF
{
  "scenario": "boss_apply",
  "status": "$([ "$SUCCESS" = true ] && echo "pass" || echo "fail")",
  "timestamp": "$(date -Iseconds)",
  "checks": {
    "device_online": true,
    "boss_installed": true,
    "boss_alive_after": "$BOSS_ALIVE",
    "risk_triggered": "$RISK_TRIGGERED",
    "apply_count": $APPLY_COUNT,
    "reply_count": $REPLY_COUNT
  },
  "mcp_response": $(echo "$BOSS_APPLY_RESULT" | jq -c . 2>/dev/null || echo "{}")
}
EOF

echo "[6/6] 验收完成: $OUTPUT_JSON"
if [ "$SUCCESS" = true ]; then
  echo "✅ Boss自动投递验收通过"
  exit 0
else
  echo "❌ Boss自动投递验收失败"
  exit 1
fi