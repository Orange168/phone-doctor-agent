#!/usr/bin/env python3
# skill-sink.py — 技能沉淀机制（python 实现）
# 扫描 goals-stack.json 中已完成的目标，识别重复模式，自动生成新 skill
# 触发条件：同一目标类型+target 成功完成 3 次 → 生成 skill；失败 3 次 → 生成踩坑记录

import json
import os
from collections import Counter

MEM_DIR = "/home/master/sourceCode/phone-doctor-agent/profile/memories"
GOALS_FILE = os.path.join(MEM_DIR, "goals-stack.json")
SKILL_DIR = "/home/master/sourceCode/phone-doctor-agent/profile/skills"
from datetime import datetime
TS = datetime.now().isoformat()

THRESHOLD = 3

print(f"=== phone-doctor 技能沉淀 @ {TS} ===")

if not os.path.exists(GOALS_FILE):
    print("无目标栈文件，跳过沉淀")
    with open(GOALS_FILE, "w") as f:
        json.dump({"goals": []}, f)
    exit(0)

with open(GOALS_FILE) as f:
    data = json.load(f)

done = [g for g in data["goals"] if g.get("status") == "done"]
if not done:
    print("无已完成目标，跳过沉淀")
    exit(0)

# 按 (type, target) 分组统计
pattern_counter = Counter((g["type"], g.get("target", "")) for g in done)
fail_counter = Counter((g["type"], g.get("target", "")) for g in data["goals"] if g.get("status") == "failed")

print("已完成目标重复模式:")
for (t, target), count in pattern_counter.most_common():
    print(f"  {t}/{target}: {count} 次完成")

print()
print("失败目标:")
for (t, target), count in fail_counter.most_common():
    print(f"  {t}/{target}: {count} 次失败")

generated = []
for (t, target), count in pattern_counter.items():
    if count >= THRESHOLD:
        skill_name = f"{t}-{target}".replace("-", "_").replace("/", "_")
        skill_path = os.path.join(SKILL_DIR, skill_name)
        if not os.path.exists(skill_path):
            generated.append((skill_name, t, target, count))
            print(f"  >> 触发 skill 生成: {skill_name} (完成 {count} 次)")

if not generated:
    print("未达到 skill 生成阈值（需连续完成 3 次同一模式）")
    exit(0)

for skill_name, t, target, count in generated:
    skill_dir = os.path.join(SKILL_DIR, skill_name)
    os.makedirs(skill_dir, exist_ok=True)
    skill_md = os.path.join(skill_dir, "SKILL.md")
    content = f"""---
name: {skill_name}
description: 自动沉淀技能 — 基于重复操作模式生成（{t}/{target} 完成 {count} 次）
model: tmp-flash
trigger: manual
---

# {skill_name} (自动沉淀)

## 来源

由 skill-sink.sh 自动生成，基于目标栈中已完成的 {t}/{target} 目标（共 {count} 次）。

## 目标

封装重复的 {t} 操作（target: {target}）为可复用技能。

## 执行步骤

1. 读取上下文参数（设备 serial、操作目标等）
2. 执行具体操作（参考目标栈中已完成的 {count} 次记录）
3. 验证结果，标记成功/失败
4. 写入 data_record（数据飞轮）

## 输入输出

- Consumes: 设备 serial、操作参数
- Produces: 操作结果，写入 profile/memories/goals-stack.json

## 生成时间

{TS}
"""
    with open(skill_md, "w") as f:
        f.write(content)
    print(f"  已生成: {skill_md}")

print()
print("技能沉淀完成。")
