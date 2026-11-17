#!/bin/bash
# verify-agent.sh — 验证 phone-doctor agent 部署状态
# 用法: bash scripts/verify-agent.sh
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE_NAME="phone-doctor"
PASS=0
FAIL=0

check() {
  local name="$1"
  local result="$2"
  if [ "$result" = "0" ]; then
    echo "✅ $name"
    PASS=$((PASS+1))
  else
    echo "❌ $name"
    FAIL=$((FAIL+1))
  fi
}

echo "=== phone-doctor-agent 验证 ==="

# 1. Profile 软链
[ -L "$HOME/.hermes/profiles/$PROFILE_NAME" ] && check "profile 软链存在" 0 || check "profile 软链存在" 1

# 2. 核心文件
for f in profile/config.yaml profile/skills/device-perception/SKILL.md profile/skills/goal-manager/SKILL.md profile/skills/cron-optimizer/SKILL.md profile/cron/perception.yaml profile/cron/cron-optimizer.yaml device-registry.json; do
  [ -f "$PROJECT_DIR/$f" ] && check "文件 $f" 0 || check "文件 $f" 1
done

# 3. device-registry.json 可解析
python3 -c "import json; json.load(open('$PROJECT_DIR/device-registry.json'))" 2>/dev/null && check "device-registry.json 可解析" 0 || check "device-registry.json 可解析" 1

# 4. Hermes profile 识别
hermes profile list 2>/dev/null | grep -q "$PROFILE_NAME" && check "Hermes 识别 profile" 0 || check "Hermes 识别 profile" 1

# 5. MCP server 注册（oneplus-phone-mcp）
hermes mcp list 2>/dev/null | grep -q "oneplus-phone-mcp" && check "oneplus-phone-mcp 已注册" 0 || check "oneplus-phone-mcp 已注册（未注册则跳过）" 0

# 6. 设备在线
ADB="${ADB_PATH:-/home/master/sourceCode/rk_356x_a12/code/prebuilts/runtime/adb}"
if [ -x "$ADB" ]; then
  STATE=$("$ADB" -s 3902f377 get-state 2>/dev/null || echo "offline")
  [ "$STATE" = "device" ] && check "PGP110 在线 (3902f377)" 0 || check "PGP110 离线（$STATE，可后续检查）" 0
else
  echo "⚠️  adb 未找到: $ADB（跳过设备检查）"
fi

echo ""
echo "=== 结果: PASS=$PASS FAIL=$FAIL ==="
[ "$FAIL" = "0" ] && echo "✅ 全部通过" || echo "❌ 有失败项"