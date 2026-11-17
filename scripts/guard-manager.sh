#!/bin/bash
# guard-manager.sh — 守护进程管理器
# 定时检查关键进程（frida-server / sshd / cloudflared / scrcpy），缺失则自动重启
# 与 goal-executor 配合：守护动作写入目标栈，执行恢复

set -e
MEM_DIR="/home/master/sourceCode/phone-doctor-agent/profile/memories"
GOALS_FILE="$MEM_DIR/goals-stack.json"
ADB="${ADB_PATH:-/home/master/sourceCode/rk_356x_a12/code/prebuilts/runtime/adb}"
SERIAL="${ADB_SERIAL:-3902f377}"

# 关键进程定义：名称 | 检查命令 | 启动命令 | 优先级
declare -a GUARD_LIST=(
  "frida-server|su -c 'pidof frida-server'|su -c '/data/adb/frida-server &'|8"
  "sshd|su -c 'pidof sshd'|am start -n com.termux/com.termux.app.TermuxActivity|10"
)

[ -f "$GOALS_FILE" ] || { echo '{"goals":[]}' > "$GOALS_FILE"; }

TS=$(date -Iseconds)
echo "=== phone-doctor 守护进程检查 @ $TS ==="

for entry in "${GUARD_LIST[@]}"; do
  IFS='|' read -r proc_name check_cmd start_cmd priority <<< "$entry"

  # 检查进程是否运行
  pid=$($ADB -s "$SERIAL" shell "$check_cmd" 2>/dev/null | tr -d '\r\n' || echo "")

  if [ -n "$pid" ]; then
    echo "  [$proc_name] 运行中 (pid: $pid)"
  else
    echo "  [$proc_name] ❌ 未运行，准备重启..."

    # 写入目标栈（供 goal-executor 执行恢复，或者这里直接尝试启动）
    bash /home/master/sourceCode/phone-doctor-agent/scripts/goal-stack.sh add recover "$SERIAL" "$proc_name" "$priority" false 2>&1 | tail -1

    # 直接尝试启动（不等 goal-executor，提高恢复速度）
    echo "  [$proc_name] 执行启动命令: $start_cmd"
    $ADB -s "$SERIAL" shell "$start_cmd" 2>/dev/null || echo "  [$proc_name] 启动命令执行失败"

    # 等待后再次检查
    sleep 3
    new_pid=$($ADB -s "$SERIAL" shell "$check_cmd" 2>/dev/null | tr -d '\r\n' || echo "")
    if [ -n "$new_pid" ]; then
      echo "  [$proc_name] ✅ 重启成功 (pid: $new_pid)"
    else
      echo "  [$proc_name] ⚠️  重启失败，需人工介入"
    fi
  fi
done

echo ""
echo "守护检查完成。"
