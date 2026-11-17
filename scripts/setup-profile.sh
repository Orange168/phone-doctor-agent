#!/bin/bash
# setup-profile.sh — 一键部署 phone-doctor profile 到 Hermes
# 用法: bash scripts/setup-profile.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PROFILE_NAME="phone-doctor"
HERMES_PROFILES_DIR="$HOME/.hermes/profiles"

echo "=== phone-doctor-agent 部署 ==="
echo "项目目录: $PROJECT_DIR"
echo "目标 profile: $HERMES_PROFILES_DIR/$PROFILE_NAME"

# 1. 确保 Hermes profiles 目录存在
mkdir -p "$HERMES_PROFILES_DIR"

# 2. 如果 profile 已存在（真实目录），备份
if [ -d "$HERMES_PROFILES_DIR/$PROFILE_NAME" ] && [ ! -L "$HERMES_PROFILES_DIR/$PROFILE_NAME" ]; then
  BACKUP="$HERMES_PROFILES_DIR/${PROFILE_NAME}.backup.$(date +%Y%m%d%H%M%S)"
  echo "⚠️  profile 已存在，备份到: $BACKUP"
  mv "$HERMES_PROFILES_DIR/$PROFILE_NAME" "$BACKUP"
fi

# 3. 创建软链
if [ -L "$HERMES_PROFILES_DIR/$PROFILE_NAME" ]; then
  echo "软链已存在，先删除"
  rm "$HERMES_PROFILES_DIR/$PROFILE_NAME"
fi

ln -s "$PROJECT_DIR/profile" "$HERMES_PROFILES_DIR/$PROFILE_NAME"
echo "✅ 软链创建: $HERMES_PROFILES_DIR/$PROFILE_NAME -> $PROJECT_DIR/profile"

# 4. 验证
echo ""
echo "=== 验证 ==="
ls -la "$HERMES_PROFILES_DIR/$PROFILE_NAME"
echo ""
echo "profile 内容:"
ls -la "$HERMES_PROFILES_DIR/$PROFILE_NAME"/

# 5. 提示
echo ""
echo "✅ 部署完成！"
echo ""
echo "下一步:"
echo "  1. 验证 profile: hermes profile list | grep phone-doctor"
echo "  2. 测试感知: hermes run --profile phone-doctor --skill device-perception"
echo "  3. 查看 cron: hermes cron list --profile phone-doctor"
echo ""
echo "注意: 首次运行前确保:"
echo "  - oneplus-phone-mcp 已注册: hermes mcp list"
echo "  - 设备在线: adb -s 3902f377 get-state"