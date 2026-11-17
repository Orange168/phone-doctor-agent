---
name: recover_services
description: 自动沉淀技能 — 基于重复操作模式生成（recover/services 完成 8 次）
model: tmp-flash
trigger: manual
---

# recover_services (自动沉淀)

## 来源

由 skill-sink.sh 自动生成，基于目标栈中已完成的 recover/services 目标（共 8 次）。

## 目标

封装重复的 recover 操作（target: services）为可复用技能。

## 执行步骤

1. 读取上下文参数（设备 serial、操作目标等）
2. 执行具体操作（参考目标栈中已完成的 8 次记录）
3. 验证结果，标记成功/失败
4. 写入 data_record（数据飞轮）

## 输入输出

- Consumes: 设备 serial、操作参数
- Produces: 操作结果，写入 profile/memories/goals-stack.json

## 生成时间

2026-11-17T21:04:08.657545
