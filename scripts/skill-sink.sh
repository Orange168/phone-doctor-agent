#!/bin/bash
# skill-sink.sh — 技能沉淀机制（壳脚本，调用 skill-sink.py）
# 扫描 goals-stack.json 中已完成的目标，识别重复模式，自动生成新 skill

set -e
MEM_DIR="/home/master/sourceCode/phone-doctor-agent/profile/memories"
GOALS_FILE="$MEM_DIR/goals-stack.json"
SKILL_DIR="/home/master/sourceCode/phone-doctor-agent/profile/skills"
TS=$(date -Iseconds)

[ -f "$GOALS_FILE" ] || { echo '{"goals":[]}' > "$GOALS_FILE"; }

echo "=== phone-doctor 技能沉淀 @ $TS ==="

python3 /home/master/sourceCode/phone-doctor-agent/scripts/skill-sink.py 2>&1

echo ""
echo "技能沉淀执行完毕。"
