---
name: goal-executor
description: 目标栈消费者 — pop 最高优先级 pending 目标并执行恢复动作（重启 frida/sshd、唤醒离线设备），更新目标状态。与 device-perception 感知层配对，形成“发现异常→自动恢复”闭环。
model: tmp-flash
trigger: perception-anomaly / manual
---

# 目标栈消费者技能 (goal-executor)

## 目标

把感知层发现的设备异常自动恢复，不需要用户手动触发。消费 `goals-stack.json` 中的 pending 目标，按目标类型执行对应的恢复动作，更新状态为 done/failed。

## 执行步骤

1. **读取目标栈**：`profile/memories/goals-stack.json`，找出 status=pending 的目标。
2. **选最高优先级**：按 `priority` 降序排列，pop 第一个，标记 status=running。
3. **按类型执行恢复**：
   - `recover` + `services`：检查 frida-server / sshd，缺失则尝试重启（`su -c '/data/adb/frida-server &'` / Termux sshd 启动）。
   - `recover` + `device-online`：向设备发电源键唤醒，再检查 `adb get-state`。
   - 其他：记录 Unknown target。
4. **更新状态**：执行完成后标记 status=done，写入 completed 时间戳；如需重试则 retries++ 并保持 pending（max_retries=3）。
5. **输出**：执行结果摘要（成功/失败/原因）。

## 输入输出

- Consumes: `profile/memories/goals-stack.json`（目标栈 JSON）
- Produces: 同文件中目标状态更新（done/failed），以及 stdout 执行日志

## 与感知层的闭环

`perception-cron.sh` 发现异常后，会：
1. 调用 `goal-stack.sh add recover ...` 写入目标栈
2. 立即调用 `goal-executor.sh` 尝试自动恢复

形成：巡检 → 发现异常 → 写目标 → 自动恢复 → 状态标记，无需用户触发。
