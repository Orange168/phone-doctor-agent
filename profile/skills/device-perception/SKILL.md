---
name: device-perception
description: 设备感知技能 — 对注册设备执行巡检，收集状态（在线/前台/电池/网络/异常/通知），写入 agentmemory，对比上次巡检提取差异
model: tmp-flash
trigger: cron
---

# 设备感知技能 (device-perception)

## 目标

对 device-registry.json 中所有在线设备执行巡检，收集结构化状态，写入 agentmemory，并对比上次巡检提取差异（新通知/前台变化/异常）。

## 执行步骤

### 1. 读取设备注册表

读取 `/home/master/sourceCode/phone-doctor-agent/device-registry.json`，获取所有在线设备列表。

### 2. 逐设备巡检

对每台设备，调用对应 MCP 服务器的感知工具：

| 工具 | 用途 |
|---|---|
| `device_status` | 在线状态 |
| `get_device_info` | 型号/Android/root/电池/网络 |
| `get_foreground_app` | 当前前台应用（包名+Activity） |
| `capture_screen` | 截图（保存到 output/perceptions/{device}/{ts}.png） |
| `get_layout_tree` | 简化布局树（判断界面内容） |
| `notification_list` | 通知列表（事件驱动感知） |

> 注意：如果 MCP 工具名带型号前缀（如 `pgp110:frida_status`），按注册表的 model 字段选择对应工具。

### 3. 结构化提取

从工具输出中提取关键状态：
- `online`: true/false
- `foreground_app`: 包名
- `battery`: 电量百分比 + 充电状态
- `network`: WiFi/移动数据/信号
- `services`: frida-server / sshd / cloudflared 存活状态
- `anomalies`: 异常列表（服务挂了/电量过低/存储不足/前台App崩溃）

### 4. 写入 agentmemory

```
key: perception/{device_id}/{timestamp}
value: {
  online, foreground_app, battery, network, services, anomalies,
  screenshot_path, layout_summary
}

key: perception/{device_id}/last    # 覆盖更新，存最近一次
value: 同上
```

### 5. 对比差异

读取 `perception/{device_id}/last`（上次），对比本次：
- **新通知** → `notifications/new`（追加）
- **前台应用变化** → `apps/foreground_changes`（追加）
- **新异常** → `anomalies/active`（覆盖）
- **服务恢复**（之前挂现在活）→ `services/recovered`（追加）

### 6. 异常升级

发现以下情况时，向 goal-manager 写入目标：
- 服务挂了（frida/sshd/cloudflared）→ `goal: recover`
- 设备离线 → `goal: recover`（检查 adb/网络）
- 前台App崩溃 → `goal: investigate`
- 电量 < 20% → `goal: charge_alert`

## 输出

巡检报告（简版）：
```
巡检完成 @ {timestamp}
- 在线: {online}/{total}
- 异常: {anomaly_count} 项
  - {device}: {anomaly_desc}
- 前台App: {app1}({device1}), {app2}({device2})
- 新通知: {new_notification_count}
```

## 注意事项

- 本 skill 用 `tmp-flash`（轻量高频），只做感知+记录，不做复杂决策
- 截图存 `output/perceptions/`，避免占用设备空间
- 巡检频率由 cron 配置（默认 15 分钟），后续由 cron-optimizer 动态调整