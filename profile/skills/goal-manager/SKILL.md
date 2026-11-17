---
name: goal-manager
description: 目标栈管理技能 — 维护设备操作目标栈（recover/maintain/optimize/user_task），按优先级调度执行，需用户确认的走 clarify
model: tmp
trigger: manual / perception-anomaly
---

# 目标管理技能 (goal-manager)

## 目标

维护"设备操作目标栈"，把感知层发现的异常、用户委派的任务、定时维护任务统一排队，按优先级调度执行。

## 目标栈结构

存储在 agentmemory `key: goals/stack`：

```json
{
  "goals": [
    {
      "id": "g-{timestamp}-{rand}",
      "type": "recover | maintain | optimize | user_task",
      "device": "pgp110 | all | device_id",
      "target": "具体操作对象",
      "priority": 1-10,
      "created": "ISO timestamp",
      "status": "pending | running | done | failed | cancelled",
      "retries": 0,
      "max_retries": 3,
      "requires_confirmation": false
    }
  ]
}
```

## 操作命令

### add_goal(type, device, target, priority, requires_confirmation)
- 加入目标栈
- 自动分配 id
- 返回 goal_id

### pop_goal()
- 弹出最高优先级 pending 目标
- 标记为 running
- 返回目标详情

### list_goals(status?)
- 按状态筛选列出目标

### update_goal(id, status, result?)
- 更新目标状态
- 记录执行结果

## 目标类型与执行策略

### recover（恢复异常）
- 例：frida-server 挂了 → 调 `pgp110:guard_start` 或 `pgp110:frida_start`
- 例：sshd 挂了 → 重启 sshd
- 执行后验证：调对应 status 工具确认恢复

### maintain（维护健康）
- 例：定时清理截图缓存、检查磁盘空间
- 例：验证反检测栈仍生效（logcat 查 ZYGISK NOT DETECTED）

### optimize（优化）
- 例：cron 频率调整建议 → 交给 cron-optimizer
- 例：前台App使用时长统计

### user_task（用户委派）
- 来源：主 agent delegate / 用户直接消息
- 执行：task-planner 拆解步骤 → 调 MCP 工具 → 验证

## 执行逻辑

```
1. pop_goal()
2. 判断 requires_confirmation（或命中 config.yaml guardrails.require_confirmation）
   → 是：调用 clarify 询问用户，等待确认
   → 否：继续
3. 选择执行 skill/工具：
   - recover → guard-manager / 对应 status 工具
   - maintain → device-perception / 维护工具
   - optimize → cron-optimizer
   - user_task → task-planner
4. 执行 + 验证
5. update_goal(status=done/failed)
6. 失败：retries < max_retries → 重新入队（priority+1）；否则标记 failed 并通知用户
7. 记录到 flywheel：data_record(action=goal.id, result=...)
```

## 护栏集成

执行任何目标前，检查 config.yaml 的 guardrails：
- `forbidden` 列表中的操作 → 拒绝执行，通知用户
- `require_confirmation` 列表中的操作 → clarify 确认
- `auto_backup_before` 列表中的操作 → 先备份再执行

## 输出

每次执行返回：
```
目标 {id} ({type}) 执行完成
- 设备: {device}
- 结果: {success/fail}
- 验证: {verification_output}
- 耗时: {duration}
```