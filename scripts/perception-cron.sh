#!/bin/bash
# perception-cron.sh — 手机分身感知巡检脚本（cron no-agent 模式）
# 对 device-registry.json 中所有在线设备执行巡检，输出结构化报告
# 由 hermes cron 定时调用（--no-agent，stdout 直接投递）
# 发现异常时写入目标栈

set -e
ADB="${ADB_PATH:-/home/master/sourceCode/rk_356x_a12/code/prebuilts/runtime/adb}"
REGISTRY="/home/master/sourceCode/phone-doctor-agent/device-registry.json"
TS=$(date "+%Y-%m-%dT%H:%M:%S")

echo "=== phone-doctor 感知巡检 @ $TS ==="

# 读取设备列表（serial 字段）
SERIALS=$(python3 -c "
import json
data = json.load(open('$REGISTRY'))
for d in data.get('devices', []):
    if d.get('online', True):
        print(d['serial'])
" 2>/dev/null)

if [ -z "$SERIALS" ]; then
  echo "⚠️  无在线设备（device-registry.json）"
  exit 0
fi

ONLINE=0
TOTAL=0
ANOMALIES=""

for S in $SERIALS; do
  TOTAL=$((TOTAL+1))
  STATE=$(timeout 8 "$ADB" -s "$S" get-state 2>/dev/null || echo "offline")
  if [ "$STATE" = "device" ]; then
    ONLINE=$((ONLINE+1))
    # 前台应用
    FG=$(timeout 8 "$ADB" -s "$S" shell "dumpsys activity activities | grep -m1 mResumedActivity" 2>/dev/null | grep -oE '[a-zA-Z0-9._]+/[a-zA-Z0-9._]+' | head -1 || echo "?")
    # 电池
    BAT=$(timeout 8 "$ADB" -s "$S" shell "dumpsys battery | grep -E 'level|status'" 2>/dev/null | grep -oE '[0-9]+' | head -2 | tr '\n' '/' || echo "?")
    # frida 存活
    FRIDA=$(timeout 8 "$ADB" -s "$S" shell "su -c 'pidof frida-server'" 2>/dev/null || echo "")
    # sshd 存活
    SSHD=$(timeout 8 "$ADB" -s "$S" shell "su -c 'pidof sshd'" 2>/dev/null || echo "")
    
    DEVICE_ANOMALIES=""
    if [ -z "$FRIDA" ]; then
      DEVICE_ANOMALIES="$DEVICE_ANOMALIES\n  - $S: frida-server 未运行"
    fi
    if [ -z "$SSHD" ]; then
      DEVICE_ANOMALIES="$DEVICE_ANOMALIES\n  - $S: sshd 未运行"
    fi
    
    if [ -n "$DEVICE_ANOMALIES" ]; then
      ANOMALIES="$ANOMALIES$DEVICE_ANOMALIES"
      # 写入目标栈（recover 类型，优先级 8）
      bash /home/master/sourceCode/phone-doctor-agent/scripts/goal-stack.sh add recover "$S" "services" 8 false 2>&1 | tail -1 || true
      # 自动触发目标栈消费者（发现异常→自动恢复）
      bash /home/master/sourceCode/phone-doctor-agent/scripts/goal-executor.sh 2>&1 | tail -3 || true
    fi
    
     echo "  [$S] 在线 | 前台: $FG | 电池: $BAT"
   else
    ANOMALIES="$ANOMALIES\n  - $S: 离线 ($STATE)"
    # 离线也是异常，写目标
    bash /home/master/sourceCode/phone-doctor-agent/scripts/goal-stack.sh add recover "$S" "device-online" 10 false 2>&1 | tail -1 || true
    # 自动触发目标栈消费者
    bash /home/master/sourceCode/phone-doctor-agent/scripts/goal-executor.sh 2>&1 | tail -3 || true
    echo "  [$S] ❌ 离线 ($STATE)"
   fi
done

echo ""
echo "=== 汇总 ==="
echo "在线: $ONLINE/$TOTAL"
if [ -n "$ANOMALIES" ]; then
  echo "异常:"
  echo -e "$ANOMALIES"
else
  echo "异常: 无"
fi

# 写入 agentmemory（通过 hermes memory 或直接文件）
MEM_DIR="/home/master/sourceCode/phone-doctor-agent/profile/memories"
mkdir -p "$MEM_DIR"
cat > "$MEM_DIR/perception-last.txt" <<EOF
timestamp=$TS
online=$ONLINE/$TOTAL
anomalies=$(echo "$ANOMALIES" | tr '\n' ';' | head -c 200)
EOF

echo ""
echo "巡检记录已写入: $MEM_DIR/perception-last.txt"