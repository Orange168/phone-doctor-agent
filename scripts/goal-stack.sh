#!/bin/bash
# goal-stack.sh — 目标栈管理工具（供感知/其它脚本调用）
# 用法: goal-stack.sh add|pop|list|update <params>

set -e
MEM_DIR="/home/master/sourceCode/phone-doctor-agent/profile/memories"
GOALS_FILE="$MEM_DIR/goals-stack.json"

# 初始化
init_stack() {
  if [ ! -f "$GOALS_FILE" ]; then
    echo '{"goals":[]}' > "$GOALS_FILE"
  fi
}

# 添加目标
add_goal() {
  local type="$1"
  local device="$2"
  local target="$3"
  local priority="${4:-5}"
  local requires_confirmation="${5:-false}"

  init_stack
  local id="g-$(date +%s)-$RANDOM"
  local created=$(date -Iseconds)

  # 用 python 操作 JSON（避免 bash 处理 JSON 的痛苦）
  python3 -c "
import json, sys
with open('$GOALS_FILE', 'r') as f:
    data = json.load(f)
goal = {
    'id': '$id',
    'type': '$type',
    'device': '$device',
    'target': '$target',
    'priority': $priority,
    'created': '$created',
    'status': 'pending',
    'retries': 0,
    'max_retries': 3,
    'requires_confirmation': '$requires_confirmation' == 'true'
}
data['goals'].append(goal)
with open('$GOALS_FILE', 'w') as f:
    json.dump(data, f, indent=2)
print('Goal added:', goal['id'])
"
}

# 弹出最高优先级 pending 目标
pop_goal() {
  init_stack
  python3 -c "
import json
with open('$GOALS_FILE', 'r') as f:
    data = json.load(f)
pending = [g for g in data['goals'] if g['status'] == 'pending']
if not pending:
    print('NO_GOALS')
    sys.exit(0)
# 按优先级降序
pending.sort(key=lambda g: -g['priority'])
goal = pending[0]
goal['status'] = 'running'
goal['started'] = '$(date -Iseconds)'
with open('$GOALS_FILE', 'w') as f:
    json.dump(data, f, indent=2)
print(json.dumps(goal))
"
}

# 列出目标
list_goals() {
  init_stack
  python3 -c "
import json, sys
status_filter = sys.argv[1] if len(sys.argv) > 1 else None
with open('$GOALS_FILE', 'r') as f:
    data = json.load(f)
goals = data['goals']
if status_filter:
    goals = [g for g in goals if g['status'] == status_filter]
for g in sorted(goals, key=lambda x: (-x['priority'], x['created'])):
    print(f\"{g['id']} | {g['type']} | {g['device']} | {g['target']} | p{g['priority']} | {g['status']} | retries:{g['retries']}\")
"
}

# 更新目标状态
update_goal() {
  local id="$1"
  local status="$2"
  local result="${3:-}"

  init_stack
  python3 -c "
import json
with open('$GOALS_FILE', 'r') as f:
    data = json.load(f)
for g in data['goals']:
    if g['id'] == '$id':
        g['status'] = '$status'
        if '$result':
            g['result'] = '$result'
        if '$status' == 'done':
            g['completed'] = '$(date -Iseconds)'
        elif '$status' == 'failed':
            g['retries'] = g.get('retries', 0) + 1
            if g['retries'] < g.get('max_retries', 3):
                g['status'] = 'pending'
                g['priority'] = g.get('priority', 5) + 1
        break
with open('$GOALS_FILE', 'w') as f:
    json.dump(data, f, indent=2)
print('Goal updated:', '$id', '->', '$status')
"
}

# 主入口
case "${1:-}" in
  add)
    add_goal "$2" "$3" "$4" "${5:-5}" "${6:-false}"
    ;;
  pop)
    pop_goal
    ;;
  list)
    list_goals "$2"
    ;;
  update)
    update_goal "$2" "$3" "$4"
    ;;
  *)
    echo "用法: $0 add|pop|list|update ..."
    exit 1
    ;;
esac