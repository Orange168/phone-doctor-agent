#!/bin/bash
# cron-optimizer.sh — 分析感知历史，输出 cron 调整建议
# 由 hermes cron 每天凌晨 3 点调用（no-agent 模式）

set -e
MEM_DIR="/home/master/sourceCode/phone-doctor-agent/profile/memories"
TS=$(date "+%Y-%m-%dT%H:%M:%S")

echo "=== phone-doctor Cron 优化分析 @ $TS ==="

# 读取 perception 记录
PERC_FILES=$(ls -t "$MEM_DIR"/perception-*.txt 2>/dev/null | head -100 || true)
if [ -z "$PERC_FILES" ]; then
  echo "无 perception 历史记录，跳过优化"
  exit 0
fi

# 统计最近 7 天（假设每次巡检间隔 15min，7天 ≈ 672 次）
RECENT=0
ANOMALIES=0
declare -A HOUR_ANOMALY

for f in $PERC_FILES; do
  # 文件名含时间戳或内容含 timestamp
  if grep -q "anomalies=" "$f"; then
    REA=$(grep "anomalies=" "$f" | cut -d= -f2)
    if [ "$REA" != "" ] && [ "$REA" != ";" ]; then
      ANOMALIES=$((ANOMALIES+1))
    fi
  fi
  REA=$(grep "timestamp=" "$f" | cut -d= -f2 | cut -dT -f2 | cut -d: -f1 || true)
  if [ -n "$REA" ]; then
    HOUR_ANOMALY["$REA"]=$((${HOUR_ANOMALY["$REA"]:-0}+1))
  fi
  RECENT=$((RECENT+1))
  [ $RECENT -ge 672 ] && break
done

echo "最近 $RECENT 次巡检"
echo "异常次数: $ANOMALIES"

# 识别异常密集时段
echo ""
echo "按小时异常分布:"
for h in "${!HOUR_ANOMALY[@]}"; do
  echo "  ${h}:00 -> ${HOUR_ANOMALY[$h]} 次"
done | sort

# 判断是否需要调整
CURRENT_SCHEDULE="*/15 * * * *"
SUGGEST_SCHEDULE="$CURRENT_SCHEDULE"
REASON=""

if [ "$ANOMALIES" -eq 0 ] && [ "$RECENT" -gt 200 ]; then
  SUGGEST_SCHEDULE="*/30 * * * *"
  REASON="过去 ${RECENT} 次巡检无异常，降频到 30 分钟"
elif [ "$ANOMALIES" -gt 20 ] && [ "$RECENT" -lt 200 ]; then
  SUGGEST_SCHEDULE="*/5 * * * *"
  REASON="异常密集（$ANOMALIES 次），加密到 5 分钟"
fi

echo ""
echo "=== 优化建议 ==="
echo "当前: $CURRENT_SCHEDULE"
echo "建议: $SUGGEST_SCHEDULE"
echo "理由: ${REASON:-"维持现状"}"

# 写入优化记录
cat > "$MEM_DIR/cron-optimizer-last.txt" <<EOF
timestamp=$TS
recent=$RECENT
anomalies=$ANOMALIES
current=$CURRENT_SCHEDULE
suggested=$SUGGEST_SCHEDULE
reason=$REASON
EOF

echo "记录已写入: $MEM_DIR/cron-optimizer-last.txt"