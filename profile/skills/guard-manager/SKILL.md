---
name: guard-manager
description: 守护进程技能 — 定时检查 frida-server / sshd / cloudflared / scrcpy 等关键进程，缺失则自动重启，与目标栈配合实现“进程保活”
model: tmp-flash
trigger: cron
---

# 守护进程技能 (guard-manager)

## 目标

让关键后台进程保持在线，实现“云手机进程保活”能力。每次检查时：
1. 遍历 GUARD_LIST 中的进程
2. 若进程未运行 → 写入目标栈 + 尝试重启 → 等待 3 秒再检查 → 标记结果
3. 若进程正常 → 仅记录运行中

## 执行步骤

1. 读取 `scripts/guard-manager.sh` 中的 GUARD_LIST（进程名|检查命令|启动命令|优先级）
2. 对每个进程，通过 adb 检查 pid 是否存在
3. 缺失时：
   - 调用 `goal-stack.sh add recover ...` 写入目标栈
   - 执行启动命令（如 `su -c '/data/adb/frida-server &'`）
   - 等待 3 秒，再次检查 pid
4. 输出检查报告（运行中/重启成功/重启失败）

## 输入输出

- Consumes: 无（通过 adb 直接检查设备）
- Produces: `profile/memories/goals-stack.json`（写入 recover 目标）、stdout 检查报告

## 与目标栈闭环

守护进程发现异常后写入目标栈，`goal-executor.sh` 会 pop 出目标并执行更完整的恢复逻辑（如 sshd 需要唤醒 Termux Activity）。两者配合：
- guard-manager：快速检测 + 简单重启
- goal-executor：完整恢复流程 + 状态跟踪

## 建议 cron

每 5 分钟一次：
```
*/5 * * * *
```
