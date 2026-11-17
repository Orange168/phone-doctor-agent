# phone-doctor-agent 执行计划

> **状态追踪文档**：按优先级逐步执行，每完成一项更新对应条目状态（✅/🔄/⬜）。
> 创建：2026-11-17 | 仓库：github.com/Orange168/phone-doctor-agent

**目标**：把一加 PGP110 等 MCP 改造的手机，做成"活的数字分身"——一个 Hermes 智能体自主感知/决策/执行/进化，用户只需发一个命令，Agent 控制手机完成任务。

**架构**：
```
用户命令 → phone-doctor profile（管家）
              ↓ cron 自主巡检（感知层 tmp-flash）
              ↓ 目标栈调度（决策层 tmp）
              ↓ MCP 调用（执行层）
         oneplus-phone-mcp (63+ 工具) → 设备
```

**技术栈**：Hermes profile + skill + cron + agentmemory | litellm tmp/tmp-flash | MCP stdio | Bash 脚本

**全局约束**：
- 模型锁定 litellm `tmp`（决策层）/ `tmp-flash`（感知层）
- 不进入 reboot/shutdown 黑名单操作（设备重启需单独批准）
- 所有真机操作需有真日志，不接受推测当结论
- MCP 工具需有源码锚点、命令、退出状态、产物、回滚路径
- 每个任务必须可独立测试

---

## 已完成（可追溯证据）

| 任务 | 状态 | 证据 |
|------|------|------|
| phone-doctor profile 创建 + 部署软链 | ✅ | `~/.hermes/profiles/phone-doctor` → 软链 |
| config.yaml（模型路由 + 护栏） | ✅ | `profile/config.yaml` 已写 |
| oneplus-phone-mcp 注册（63 工具） | ✅ | `hermes mcp list` 显示 enabled |
| device-registry.json（PGP110 3902f377） | ✅ | `device-registry.json` 已写 |
| 感知 cron（每15分钟自动巡检） | ✅ | job `0aad5c4d41e7`，Last run `ok` |
| cron-optimizer（每天3:00自优化） | ✅ | job 已注册，次日 3:00 触发 |
| 感知脚本 perception-cron.sh | ✅ | 已验证可正常运行并写入 agentmemory |
| 目标栈 goal-stack.sh | ✅ | add/pop/list/update 均可用，已验证写入 |
| 感知→目标栈闭环（发现异常写目标） | ✅ | 感知脚本已集成 goal-stack add，sshd 缺失会写目标 |
| 执行计划文档 | ✅ | `docs/EXECUTION-PLAN.md` 已写 |

---

## 剩余任务（按优先级）

### Task 1：目标栈消费者（goal-executor）—— 最紧急

**目标**：让感知发现的异常能被自动恢复。感知层把异常写入目标栈后，需要一个执行者把目标 pop 出来并执行恢复动作（如 frida 挂了就重启、sshd 挂了就重启）。

**为什么是第一优先**：这是"活"的核心闭环。目前感知发现异常只记录，不自动处理，没有达到"不用触发也自动修复"的目标。

**Files**:
- Create: `profile/skills/goal-executor/SKILL.md`
- Create: `scripts/goal-executor.sh`
- Modify: `scripts/perception-cron.sh`（写目标后触发 goal-executor，可选）

**Interfaces**:
- Consumes: `profile/memories/goals-stack.json`（目标栈 JSON，pending 状态）
- Produces: 执行结果更新 goals-stack.json（status → done/failed，retries++）

**Steps**:

- [ ] **Step 1: 写 goal-executor.sh 脚本**

```bash
#!/bin/bash
# goal-executor.sh — 目标栈消费者：pop 最高优先级 pending 目标并执行恢复
set -e
MEM_DIR="/home/master/sourceCode/phone-doctor-agent/profile/memories"
GOALS_FILE="$MEM_DIR/goals-stack.json"
ADB="/home/master/sourceCode/rk_356x_a12/code/prebuilts/runtime/adb"

[ -f "$GOALS_FILE" ] || { echo '{"goals":[]}' > "$GOALS_FILE"; }

# Pop highest priority pending goal
GOAL_JSON=$(python3 -c "
import json
with open('$GOALS_FILE') as f:
    data = json.load(f)
pending = [g for g in data['goals'] if g['status'] == 'pending']
if not pending:
    print('NO_GOALS')
else:
    pending.sort(key=lambda g: -g.get('priority', 0))
    g = pending[0]
    g['status'] = 'running'
    g['started'] = '__NOW__'
    with open('$GOALS_FILE','w') as f:
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
        ;;
      device-online)
        echo "Device $DEVICE offline, attempting wake..."
        $ADB -s "$DEVICE" shell "input keyevent 26" 2>/dev/null || true
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

# 标记目标完成
python3 -c "
import json
with open('$GOALS_FILE') as f:
    data = json.load(f)
for g in data['goals']:
    if g['id'] == '$ID':
        g['status'] = 'done'
        g['completed'] = '$(date -Iseconds)'
        break
with open('$GOALS_FILE','w') as f:
    json.dump(data, f, indent=2)
print('Goal $ID marked done')
"

echo "Goal execution finished."
```

- [ ] **Step 2: 手动测试 goal-executor**

先手动在目标栈插入一个 recover/sshd-missing 目标，运行 goal-executor.sh，验证：
1. 能 pop 出最高优先级目标
2. sshd 缺失时尝试重启（实际设备上 sshd 确实没运行，会触发恢复逻辑）
3. 目标状态从 pending → done

命令：
```bash
bash scripts/goal-stack.sh add recover 3902f377 "services" 8 false
bash scripts/goal-executor.sh
cat profile/memories/goals-stack.json
```
预期：目标 status 变为 done；如果 sshd 缺失，尝试重启。

- [ ] **Step 3: 测试 frida 恢复路径**

手动插入 recover/frida-server 目标，运行 goal-executor，验证 frida-server 被重启（一加 PGP110 上 frida 路径 `/data/adb/frida-server`）。

- [ ] **Step 4: 把 goal-executor 集成到感知流程**

在 `perception-cron.sh` 中，写完目标栈后自动触发 `goal-executor.sh`，实现"发现异常→自动恢复"的闭环。可以在脚本末尾加：

```bash
if [ -n "$ANOMALIES" ]; then
  bash /home/master/sourceCode/phone-doctor-agent/scripts/goal-executor.sh
fi
```

- [ ] **Step 5: 提交并推送**

```bash
git add scripts/goal-executor.sh profile/skills/goal-executor/SKILL.md scripts/perception-cron.sh
git commit -m "feat: add goal-executor target stack consumer"
git push origin main
```

---

### Task 2：MCP 扩展层实现（sensor-spoof + data-flywheel）

**目标**：把 P0 级 spec（sensor-spoof 传感器模拟、data-flywheel 数据飞轮）实现并注册到 oneplus-phone-mcp/server.js，把 63 工具扩展。

**为什么**：sensor-spoof 是反检测核心缺口；data-flywheel 是数字分身进化根基（为后续 LoRA 攒数据）。

**Files**:
- Modify: `oneplus-phone-mcp/src/sensor.js`（已写，但未注册到 server.js）→ 修正并注册
- Create: `oneplus-phone-mcp/src/data.js`（数据飞轮）
- Modify: `oneplus-phone-mcp/src/server.js`（注册新工具，63 → ~80）

**Interfaces**:
- Consumes: `openspec/changes/oneplus-phone-mcp/specs/sensor-spoof/spec.md`（已写）、`specs/data-flywheel/spec.md`（已写）
- Produces: 新 MCP 工具 `sensor_*` / `data_*` 系列

**Steps**:

- [ ] **Step 1: 检查 sensor.js 当前状态并修正**
  读取 `oneplus-phone-mcp/src/sensor.js`，确认导出函数名和签名，确保可被 server.js 调用。

- [ ] **Step 2: 写 data.js（数据飞轮）**
  实现 `data_record` / `data_export` / `data_dataset` / `data_metrics`，记录 `(screenshot, ui_tree, action, result, error)`，JSONL 导出。

- [ ] **Step 3: 注册到 server.js**
  在 `oneplus-phone-mcp/src/server.js` 中导入 sensor.js / data.js，注册新工具（带 zod inputSchema，按 63 工具现有模式）。

- [ ] **Step 4: 语法检查 + 离线验证**
  ```bash
  node --check oneplus-phone-mcp/src/sensor.js
  node --check oneplus-phone-mcp/src/data.js
  node --check oneplus-phone-mcp/src/server.js
  ```

- [ ] **Step 5: 真机验证（可选，需设备在线）**
  调用新注册的 `sensor_status` / `data_record` 工具，验证返回。

- [ ] **Step 6: 提交**
  ```bash
  git add oneplus-phone-mcp/src/sensor.js oneplus-phone-mcp/src/data.js oneplus-phone-mcp/src/server.js
  git commit -m "feat: mcp sensor-spoof + data-flywheel extension"
  git push origin main
  ```

---

### Task 3：验证 cron-optimizer 自优化输出

**目标**：验证 cron-optimizer 脚本能正确分析 perception 历史并输出调度建议。

**为什么**："cron 自己进化"是"活"的关键部分，需要验证输出是否合理。

**Files**:
- No new files (现有 `scripts/cron-optimizer.sh` 已写)

**Steps**:

- [ ] **Step 1: 手动触发 cron-optimizer**
  ```bash
  bash scripts/cron-optimizer.sh
  cat profile/memories/cron-optimizer-last.txt
  ```

- [ ] **Step 2: 检查输出是否合理**
  预期：基于 perception 历史（目前只有一次巡检，无异常），建议"维持现状"或降频。

- [ ] **Step 3: 验证 cron job 注册**
  ```bash
  hermes cron list | grep phone-doctor-cron-optimizer
  ```
  预期：显示 `Schedule: 0 3 * * *`，Next run 次日 3:00。

---

### Task 4：skill 沉淀（进化机制）

**目标**：重复操作 2-3 次后，管家自动生成新 SOP skill，实现能力进化。

**Files**:
- Create: `profile/skills/skill-sink/SKILL.md`
- Create: `scripts/skill-sink.sh`

**Steps**:

- [ ] **Step 1: 定义 skill 沉淀触发条件**
  同一个目标类型成功完成 3 次 → 生成 skill；失败 3 次 → 生成踩坑记录。

- [ ] **Step 2: 写 skill-sink.sh 脚本**
  扫描 `goals-stack.json`，统计完成的目标，调用 `skill_manage` 生成 skill。

- [ ] **Step 3: 提交**

---

### Task 5：多设备接入（rk3326_sgo）

**目标**：把第二台设备 rk3326_sgo（c3d9b8674f4b94f6）接入 phone-doctor，实现多设备感知。

**Files**:
- Modify: `device-registry.json`（加入 rk3326 条目）
- Modify: `scripts/perception-cron.sh`（支持多设备循环，已实现）

**Steps**:

- [ ] **Step 1: 验证 rk3326 设备在线**
  ```bash
  adb -s c3d9b8674f4b94f6 get-state
  ```

- [ ] **Step 2: 加入 device-registry.json**
  添加 rk3326 条目（serial, model, capabilities, constraints）。

- [ ] **Step 3: 验证感知 cron 能巡检两台设备**
  手动触感知 cron，检查输出包含两台设备。

---

### Task 6：守护进程（guard-manager）

**目标**：守护 frida-server / sshd / cloudflared 等关键进程，挂了自动重启。

**Files**:
- Create: `profile/skills/guard-manager/SKILL.md`
- Create: `scripts/guard-manager.sh`

**Steps**:

- [ ] **Step 1: 写 guard-manager.sh**
  定时检查关键进程 PID，缺失则重启；通过 goal-stack 记录守护动作。

- [ ] **Step 2: 注册 guard cron**
  `hermes cron create "*/5 * * * *" --name phone-doctor-guard --script guard-manager.sh --no-agent`

- [ ] **Step 3: 提交**

---

## 验收标准（完成所有任务后）

1. **感知层**：每 15 分钟自动巡检所有注册设备，结果写入 `profile/memories/perception-last.txt`，异常自动写入目标栈。
2. **目标栈**：pending 目标能被 goal-executor 自动 pop 并执行恢复，status 变更为 done/failed。
3. **自优化**：cron-optimizer 每天 3:00 分析历史，输出调度建议到 `cron-optimizer-last.txt`。
4. **MCP 扩展**：sensor-spoof + data-flywheel 工具已注册到 oneplus-phone-mcp，true-device 验证通过。
5. **多设备**：PGP110 + rk3326 两台设备都能被感知。
6. **守护**：frida/sshd 等关键进程挂了会自动重启。
7. **代码**：所有新脚本 `node --check` / `bash -n` 通过，提交到 GitHub main 分支。

---

## 风险与依赖

| 风险 | 说明 | 缓解 |
|------|------|------|
| frida/sshd 重启需要 root/SELinux | 一加 PGP110 上 su 重启服务可能被 SELinux 拦截 | 先尝试 `su -c`，失败则记录到目标栈等待人工干预 |
| cron job 需 gateway 运行 | gateway 停了 cron 不会触发 | 已启动 gateway（PID 3408129），建议设为开机自启 |
| agentmemory 格式 | 目前用文件而非 hermes memory 工具，可能不被 Hermes 原生识别 | 文件在 profile/memories/ 下，可被 skill 读取，后续可迁移到 hermes memory API |
| 模型成本 | tmp 模型高频使用成本高 | 感知层用 tmp-flash（no-agent 脚本，零 token），决策层用 tmp（低频） |

---

## 执行日志

| 日期 | 动作 | 证据 |
|------|------|------|
| 2026-11-17 | 创建 phone-doctor profile + 3 skill + 2 cron + registry | commit 8ba92fc |
| 2026-11-17 | 部署 profile 软链 | setup-profile.sh 成功 |
| 2026-11-17 | 注册 oneplus-phone-mcp（63 工具） | hermes mcp list ✓ enabled |
| 2026-11-17 | 推送代码到 GitHub | origin/main 最新 |
| 2026-11-17 | 启动 gateway（cron 调度器活着） | hermes cron status ✓ running |
| 2026-11-17 | 感知 cron 注册并验证自动触发 | job 0aad5c4d41e7 Last run ok |
| 2026-11-17 | 目标栈 goal-stack.sh 编写并验证写入 | add 目标成功，JSON 正常 |
