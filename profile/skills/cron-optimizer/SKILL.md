---
name: cron-optimizer
description: Cron 自优化技能 — 分析最近巡检历史，动态调整感知频率（异常密集时段加密、长期稳定降频），自主增删改 cron 任务
model: tmp
trigger: cron
---

# Cron 自优化技能 (cron-optimizer)

## 目标

分析 agentmemory 中的巡检历史，评估当前 cron 配置是否合理，输出调整建议并**自主应用**（修改 cron 配置）。

## 输入

- `agentmemory: perception/*/last_7d`（最近 7 天巡检记录）
- 当前 cron 配置（`~/.hermes/profiles/phone-doctor/cron/*.yaml`）

## 分析逻辑

### 1. 异常分布分析
- 统计过去 7 天：
  - 异常总数 / 按类型 / 按设备 / 按时间段（小时级）
  - 设备离线次数 / 服务挂掉次数 / 前台App崩溃次数
- 识别"异常密集时段"（如晚 22:00-24:00 抖音使用高峰）

### 2. 稳定性评估
- 过去 48h 无异常 → 当前频率过高，可降频
- 某设备长期稳定（7 天无异常）→ 单独降频
- 某时段异常密集 → 该时段加密

### 3. 成本评估
- 每次巡检 token 消耗（tmp-flash 便宜，但仍要控制）
- 目标：在保证异常发现率的前提下，最小化巡检次数

## 调整规则

| 条件 | 动作 |
|---|---|
| 过去 48h 全设备无异常 | 感知频率 15min → 30min |
| 过去 7 天无异常 | 30min → 1h |
| 某时段（≥2h）异常密集 | 该时段加密到 5min |
| 某设备 7 天稳定 | 该设备单独降频（独立 cron） |
| 连续 3 天异常 > 10 次/天 | 升级到 5min 全时段 + 通知用户 |
| 服务反复挂掉（同一服务 3 次+） | 触发根因分析（不只看频率） |

## 自主应用

1. 生成变更建议：
```json
{
  "changes": [
    {"action": "update", "target": "perception", "schedule": "*/30 * * * *"},
    {"action": "add", "target": "perception-intensive", "schedule": "*/5 22-23 * * *", "devices": ["pgp110"]}
  ],
  "reason": "过去48h无异常，降频；晚高峰加密",
  "confidence": 0.85
}
```

2. 应用变更（通过 skill_manage 或直接写 cron yaml）：
   - 修改 `profile/cron/perception.yaml` 的 schedule
   - 或新增 `perception-intensive.yaml`
   - 记录变更到 agentmemory `key: cron/changes/{timestamp}`

3. 通知用户（可选）：重大调整（加密/大幅降频）通过消息通道告知

## 安全边界

- 调整频率是低风险操作（可逆），自动应用
- 但以下情况只建议不自动应用：
  - 新增 cron 任务（可能重复）
  - 大幅降频（> 2 倍，可能漏检）
- 连续调整失败 2 次 → 停止自动调整，通知用户

## 输出

```
Cron 优化完成
- 分析: 7天 {n} 次巡检, {m} 次异常, 异常率 {p}%
- 变更: {changes_summary}
- 已应用 / 建议（待确认）: {applied_or_pending}
```