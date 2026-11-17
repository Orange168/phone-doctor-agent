---
name: skill-sink
description: 技能沉淀技能 — 扫描目标栈中已完成的重复模式，自动生成新 skill（完成 3 次同一模式 → 生成 skill；失败 3 次 → 生成踩坑记录）
model: tmp
trigger: manual / cron
---

# 技能沉淀技能 (skill-sink)

## 目标

实现管家能力的“自动进化”：当同一种操作在目标栈中重复成功 3 次后，自动生成对应的 skill 文件，无需人工手动编写。

## 执行步骤

1. 读取 `profile/memories/goals-stack.json`
2. 统计 status=done 的目标，按 (type, target) 分组
3. 若某模式完成次数 ≥ 3 → 在 `profile/skills/` 下生成新 skill 目录 + SKILL.md 骨架
4. 若某模式失败次数 ≥ 3 → 生成踩坑记录（记录失败原因和重试建议）

## 阈值

- 生成 skill：同一 (type, target) 完成 ≥ 3 次
- 踩坑记录：同一 (type, target) 失败 ≥ 3 次

## 输入输出

- Consumes: `profile/memories/goals-stack.json`
- Produces: `profile/skills/<skill_name>/SKILL.md`（新 skill 文件）

## 建议 cron

每天一次：
```
0 4 * * *
```
