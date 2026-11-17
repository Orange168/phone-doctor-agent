# phone-doctor-agent

> 手机数字分身管家 — 一个 Hermes Agent 智能体，自主管理多台 MCP 改造的手机，实现"发送一个命令，Agent 控制手机完成任务"。

## 这是什么

`phone-doctor-agent` 是一个 **Hermes Agent profile**（独立智能体），它的职责是：

- **感知**：定时巡检所有纳管设备（在线/前台App/电池/网络/服务/通知）
- **决策**：自主规划任务、管理目标栈、动态调整巡检频率
- **执行**：通过 MCP 调用手机能力（截图/点击/root/frida/GPS/...）
- **进化**：把重复操作沉淀成 skill，数据飞轮记录每次操作

**核心特性**：它是"活的"——通过 cron 自主巡检、自主优化、自主恢复异常，不需要你每次触发。

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│              phone-doctor-agent (管家智能体)                  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐ │
│  │  自主感知层   │  │  自主目标层   │  │   自主时间层        │ │
│  │  cron 15min  │  │  目标栈管理   │  │  cron 自优化        │ │
│  │  巡检设备     │  │  优先级调度   │  │  频率动态调整        │ │
│  └──────┬───────┘  └──────┬───────┘  └─────────┬──────────┘ │
│         └─────────────────┼────────────────────┘            │
│                           ▼                                  │
│              执行引擎 (skills + MCP servers)                  │
│              device-perception / goal-manager /              │
│              cron-optimizer / (future: task-planner)         │
└─────────────────────────────────────────────────────────────┘
          │ MCP (stdio)                    │ MCP (stdio)
          ▼                                ▼
  ┌───────────────┐              ┌─────────────────┐
  │ oneplus-phone-│              │  rk3326-mcp     │
  │ mcp (PGP110)  │              │  (future)       │
  │  63 工具       │              │                 │
  └───────────────┘              └─────────────────┘
```

## 目录结构

```
phone-doctor-agent/
├── profile/                          # Hermes profile（软链到 ~/.hermes/profiles/phone-doctor）
│   ├── config.yaml                   # 模型路由（tmp/tmp-flash）/ 工具 / 护栏
│   ├── skills/
│   │   ├── device-perception/        # 感知技能（巡检设备）
│   │   ├── goal-manager/             # 目标技能（目标栈调度）
│   │   └── cron-optimizer/           # 优化技能（cron 自调整）
│   ├── cron/
│   │   ├── perception.yaml           # 感知定时任务（*/15 * * * *）
│   │   └── cron-optimizer.yaml       # 优化定时任务（0 3 * * *）
│   └── memories/                     # agentmemory 运行时数据（gitignore）
├── mcp-servers/                      # MCP 服务器代码
│   └── (oneplus-phone-mcp 软链或未来扩展)
├── device-registry.json              # 设备注册表（管家事实源）
├── scripts/
│   ├── setup-profile.sh              # 一键部署
│   └── verify-agent.sh               # 验证脚本
└── README.md
```

## 快速开始

### 1. 部署

```bash
cd /home/master/sourceCode/phone-doctor-agent

# 一键部署（软链 profile 到 Hermes）
bash scripts/setup-profile.sh
```

### 2. 验证

```bash
# 验证部署完整性
bash scripts/verify-agent.sh

# 验证 Hermes 识别 profile
hermes profile list | grep phone-doctor
```

### 3. 注册 MCP 服务器

确保 `oneplus-phone-mcp` 已注册到 Hermes（主 profile 或 phone-doctor profile）：

```bash
hermes mcp add oneplus-phone-mcp \
  --command "node /home/master/sourceCode/rk_356x_a12/code/oneplus-phone-mcp/src/server.js" \
  --connect-timeout 30

# 验证
hermes mcp test oneplus-phone-mcp
# 应显示 ✓ Connected + 63 tools
```

### 4. 测试感知

```bash
# 手动触发一次巡检
hermes run --profile phone-doctor --skill device-perception

# 查看 agentmemory
hermes memory list --profile phone-doctor
# 应看到 perception/pgp110/{timestamp}
```

### 5. 启动常驻服务（可选）

```bash
# 启动 gateway（7×24 在线，接收 delegate/消息）
hermes gateway run --profile phone-doctor

# 查看 cron 任务
hermes cron list --profile phone-doctor
```

## 模型路由

用户锁定使用 **litellm 的 `tmp` 和 `tmp-flash`**：

| 任务层 | 模型 | 用途 |
|---|---|---|
| 感知层 | `tmp-flash` | 高频巡检（每 15 分钟），轻量低成本 |
| 决策层 | `tmp` | 目标规划、cron 优化，复杂推理 |
| 执行层 | `tmp-flash` | 简单工具调用 |

## 设备注册表

`device-registry.json` 是管家的**事实源**，描述所有纳管设备：

```json
{
  "devices": [
    {
      "id": "pgp110",
      "name": "OnePlus PGP110 (Ace Pro / 10T)",
      "serial": "3902f377",
      "model": "pgp110",
      "mcp_server": "oneplus-phone-mcp",
      "capabilities": ["basic", "root", "termux", "xposed", "frida", "scrcpy"]
    }
  ]
}
```

添加新设备：在 `devices` 数组追加条目，配置对应 MCP server，重启管家即可。

## 护栏（安全边界）

`profile/config.yaml` 定义操作护栏：

- **forbidden**：永不执行（bootloader 解锁、分区写入、清数据）
- **require_confirmation**：需用户确认（resetprop、一键新机、禁用系统应用）
- **auto_backup_before**：操作前自动备份

## 主动性机制（"活"的原理）

管家不是"你触发才动"，而是三层自主循环：

1. **感知层**：cron `*/15 * * * *` 自主巡检 → 发现异常写目标栈
2. **目标层**：goal-manager 自主调度目标（恢复/维护/优化）
3. **时间层**：cron-optimizer 每天凌晨分析历史 → 自主调整巡检频率

你只需要在需要决策时（不可逆操作/目标冲突）通过消息通道介入，其余全自动。

## 环境要求

- Hermes Agent（支持 profile / cron / agentmemory）
- Node.js（MCP server 运行时）
- adb（设备连接）
- 已 root 的 Android 设备（可选，root 深度能力）

## License

MIT