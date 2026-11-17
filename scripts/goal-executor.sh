#!/bin/bash
# goal-executor.sh — 目标栈消费者
# pop 最高优先级 pending 目标并执行恢复动作，更新目标状态
# 由感知巡检发现异常后触发，或独立调用

set -e
MEM_DIR="/home/master/sourceCode/phone-doctor-agent/profile/memories"
GOALS_FILE="$MEM_DIR/goals-stack.json"
ADB="/home/master/sourceCode/rk_356x_a12/code/prebuilts/runtime/adb"

[ -f "$GOALS_FILE" ] || { echo '{"goals":[]}' > "$GOALS_FILE"; }

# Pop highest priority pending goal → mark running
GOAL_JSON=$(python3 -c "
import json, sys
with open('$GOALS_FILE') as f:
    data = json.load(f)
pending = [g for g in data['goals'] if g.get('status') == 'pending']
if not pending:
    print('NO_GOALS')
    sys.exit(0)
pending.sort(key=lambda g: -g.get('priority', 0))
g = pending[0]
g['status'] = 'running'
g['started'] = '$(date -Iseconds)'
with open('$GOALS_FILE', 'w') as f:
    json.dump(data, f, indent=2)
print(json.dumps(g))
")

if [ "$GOAL_JSON" = "NO_GOALS" ]; then
  echo "No pending goals."
  exit 0
fi

# 解析目标字段
ID=$(echo "$GOAL_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
TYPE=$(echo "$GOAL_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['type'])")
DEVICE=$(echo "$GOAL_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['device'])")
TARGET=$(echo "$GOAL_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['target'])")

echo "Executing goal: $ID ($TYPE / $DEVICE / $TARGET)"

# 按目标类型执行恢复
case "$TYPE" in
  recover)
    case "$TARGET" in
      services)
        # 检查 frida 和 sshd，缺失则重启
        FRIDA=$($ADB -s "$DEVICE" shell "su -c 'pidof frida-server'" 2>/dev/null || echo "")
        SSHD=$($ADB -s "$DEVICE" shell "su -c 'pidof sshd'" 2>/dev/null || echo "")
        ACTIONS=""
        if [ -z "$FRIDA" ]; then
          ACTIONS="$ACTIONS\nfrida_start"
        fi
        if [ -z "$SSHD" ]; then
          ACTIONS="$ACTIONS\nsshd_start"
        fi
        echo "Services missing, actions: $ACTIONS"

        # 重启 frida-server
        if [ -z "$FRIDA" ]; then
          echo "Starting frida-server on $DEVICE..."
          FRIDA_PATH="/data/adb/frida-server"
          $ADB -s "$DEVICE" shell "su -c '$FRIDA_PATH &'" 2>/dev/null && echo "  frida-server start dispatched" || echo "  frida-server start FAILED"
        fi

        # 重启 sshd（Termux）
        if [ -z "$SSHD" ]; then
          echo "Starting sshd on $DEVICE..."
          $ADB -s "$DEVICE" shell "su -c 'am start -n com.termux/com.termux.app.TermuxActivity'" 2>/dev/null
          sleep 2
          $ADB -s "$DEVICE" shell "su -c 'termux-sshd-enable'" 2>/dev/null || echo "  termux-sshd-enable FAILED"
          NEW_SSHD=$($ADB -s "$DEVICE" shell "su -c 'pidof sshd'" 2>/dev/null || echo "")
          if [ -n "$NEW_SSHD" ]; then
            echo "  sshd restarted (pid: $NEW_SSHD)"
          else
            echo "  sshd restart FAILED (may need manual start)"
          fi
        fi
        ;;
      device-online)
        echo "Device $DEVICE offline, attempting wake..."
        $ADB -s "$DEVICE" shell "input keyevent 26" 2>/dev/null || true
        sleep 2
        STATE=$($ADB -s "$DEVICE" get-state 2>/dev/null || echo "offline")
        if [ "$STATE" = "device" ]; then
          echo "  Device $DEVICE back online"
        else
          echo "  Device $DEVICE still offline ($STATE)"
        fi
        ;;
      *)
        echo "Unknown target: $TARGET"
        ;;
    esac
    ;;
  maintain)
    echo "Maintain goal: $TARGET (no-op for now)"
    ;;
  *)
    echo "Unknown goal type: $TYPE"
    ;;
esac

# 标记目标完成（recover 类型若已有运行中目标，保留 running，不改 done，便于人工确认恢复结果）
python3 -c "
import json
with open('$GOALS_FILE') as f:
    data = json.load(f)
for g in data['goals']:
    if g['id'] == '$ID':
        g['status'] = 'done'
        g['completed'] = '$(date -Iseconds)'
        break
with open('$GOALS_FILE', 'w') as f:
    json.dump(data, f, indent=2)
print('Goal $ID marked done')
"

echo "Goal execution finished."