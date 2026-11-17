# phone-doctor-agent 执行计划

> **状态追踪文档**：每完成一项任务，更新对应条目的状态（✅/🔄/⬜）和证据。
> 创建：2026-11-17 | 仓库：github.com/Orange168/phone-doctor-agent

**目标**：把一加 PGP110 等 MCP 改造的手机，做成"活的数字分身"——一个 Hermes 智能体自主感知/决策/执行/进化，用户只需发一个命令，Agent 控制手机完成任务。

**架构**：
```
用户命令 → phone-doctor profile（管家）
              ↓ cron 自主巡检（感知层 tmp-flash）
              ↓ 目标栈调度（决策层 tmp）
              ↓ MCP 调用（执行层）
         oneplus-phone-mcp (63 工具) → 设备
```

**技术栈**：Hermes profile + skill + cron + agentmemory | litellm tmp/tmp-flash | MCP stdio

---

## 当前完成度总览

| 阶段 | 任务数 | 完成 | 状态 |
|---|---|---|---|
| 阶段 1：基础设施 | 3 | 3 | ✅ 完成 |
| 阶段 2：核心 Skill | 3 | 3 | ✅ 完成（cron-optimizer 待加） |
| 阶段 3：Cron 配置 | 2 | 2 | ✅ 完成 |
| 阶段 4：验证 | 3 | 1 | 🔄 进行中 |
| 阶段 5：主动性增强 | 4 | 0 | ⬜ 待做 |

## M3 逆向对抗（2026-11-17 更新）

| 项 | 状态 | 说明 |
|---|---|---|
| 抖音 41.1.0 检测面清单 | ✅ 完成 | `docs/douyin-detection-map.md`（七维度，L1+L2 证据） |
| SSL pinning 三层结构 | ✅ 已测绘 | Java/libttboringssl 可绕，mssdk3 风控域独立 TLS 未攻克 |
| frida 绕过技能 | ✅ 沉淀 | `profile/skills/frida-ssl-bypass/` |
| adb 通道恢复技能 | ✅ 沉淀 | `profile/skills/adb-channel-recovery/`（QtScrcpy 抢 5037 实测案例） |
| Susfs 对抗 34 sysprop | ⬜ 待做 | 清单已 dump，待 resetprop 定向修改 |
| mssdk3 风控域 | ⬜ 待攻坚 | hook metasec connect/sendto 或静态分析 libmetasec_ml |

---

## 阶段 1：基础设施

### Task 1.1: 创建 phone-doctor profile
- **状态**：✅ 完成
- **证据**：`hermes profile list` 显示 `phone-doctor`；`~/.hermes/profiles/phone-doctor` → 软链到 `/home/master/sourceCode/phone-doctor-agent/profile`
- **验证命令**：`hermes profile list | grep phone-doctor`

### Task 1.2: 配置模型路由（config.yaml）
- **状态**：✅ 完成
- **文件**：`profile/config.yaml`
- **内容**：`models.default=tmp-flash`，routing: perception=tmp-flash / planning=tmp / optimization=tmp；tools.mcp_servers 注册 oneplus-phone-mcp；guardrails 护栏配置
- **验证**：`grep -A5 "models:" profile/config.yaml`

### Task 1.3: 注册 oneplus-phone-mcp
- **状态**：✅ 完成
- **证据**：`hermes mcp list` 显示 `oneplus-phone-mcp ... ✓ enabled`（63 工具），写入 `~/.hermes/config.yaml`
- **验证命令**：`hermes mcp list | grep oneplus`

---

## 阶段 2：核心 Skill

### Task 2.1: device-perception skill（感知层，tmp-flash）
- **状态**：✅ 完成
- **文件**：`profile/skills/device-perception/SKILL.md`
- **功能**：读取 device-registry → 逐设备调用 MCP 感知工具（device_status/get_device_info/get_foreground_app/capture_screen/get_layout_tree/notification_list）→ 结构化提取 → 写 agentmemory → 对比差异 → 异常升级到 goal-manager
- **验证**：文件存在且含 6 个感知工具调用步骤

### Task 2.2: goal-manager skill（目标层，tmp）
- **状态**：✅ 完成
- **文件**：`profile/skills/goal-manager/SKILL.md`
- **功能**：目标栈（agentmemory goals/stack）增删查改；类型 recover/maintain/optimize/user_task；优先级调度；护栏集成（forbidden/require_confirmation/auto_backup）
- **验证**：文件存在且含 add_goal/pop_goal/update_goal 定义

### Task 2.3: cron-optimizer skill（时间层，tmp）
- **状态**：⬜ 待做（skill 文件已写，但未加入 cron 且未在 config 声明独立）
- **文件**：`profile/skills/cron-optimizer/SKILL.md`（已写）
- **功能**：分析 7 天巡检历史 → 动态调整感知频率 → 自主增删改 cron
- **待办**：确认 skill 被 cron 正确引用（见 Task 3.2）

---

## 阶段 3：Cron 配置

### Task 3.1: 感知 cron（perception.yaml）
- **状态**：✅ 完成（已注册为 Hermes cron job `ffff309f443c`）
- **文件**：`profile/cron/perception.yaml`（设计文档）+ `scripts/perception-cron.sh`（实际执行脚本）
- **注册方式**：`hermes cron create "*/15 * * * *" --name phone-doctor-perception --script scripts/perception-cron.sh --no-agent --workdir /home/master/sourceCode/phone-doctor-agent`
- **内容**：每 15 分钟执行感知脚本（no-agent 模式，零 token），巡检设备写 agentmemory
- **⚠️ 依赖**：需 gateway 运行才会自动触发（见 Task 4.3）
- **验证**：`hermes cron list` 显示 job，下次 run 16:15

### Task 3.2: 优化 cron（cron-optimizer.yaml）
- **状态**：✅ 完成（文件已写，待注册为 cron job）
- **文件**：`profile/cron/cron-optimizer.yaml`
- **内容**：`schedule: "0 3 * * *"`, `skills: [cron-optimizer]`, `model: tmp`, `enabled: true`
- **待办**：用 `hermes cron create` 注册（需 gateway 运行）

---

## 阶段 4：验证

### Task 4.1: 部署 profile（软链）
- **状态**：✅ 完成
- **证据**：`scripts/setup-profile.sh` 执行成功，软链创建
- **验证**：`ls -la ~/.hermes/profiles/phone-doctor`

### Task 4.2: 手动触发一次巡检
- **状态**：✅ 完成
- **证据**：`hermes cron run 0aad5c4d41e7` → `Ran now: succeeded`
- **验证**：`hermes cron list` 显示 `Last run: ... ok`

### Task 4.3: 验证 cron 自动触发 + agentmemory
- **状态**：✅ 完成
- **证据**：`phone-doctor-perception` job 17:36 自动触发 ok；`phone-doctor-cron-optimizer` 已注册次日 3:00
- **agentmemory**：`profile/memories/perception-last.txt` 有最新巡检记录
- **验证**：`hermes cron list` / `cat profile/memories/perception-last.txt`

---

## 阶段 5：主动性增强（"活"的核心）

### Task 5.1: 验证 agentmemory 写入完整性
- **状态**：✅ 完成（感知脚本已写入 perception-last.txt，cron-optimizer 写 cron-optimizer-last.txt）
- **目标**：确认感知/优化结果真正写入 agentmemory 文件
- **验证**：`cat profile/memories/perception-last.txt` / `cat profile/memories/cron-optimizer-last.txt`

### Task 5.2: 目标栈闭环
- **状态**：⬜ 待做
- **目标**：goal-manager 能被异常触发（感知发现服务挂 → 写目标 → goal-manager 恢复）
- **验证**：手动制造异常（停 frida）→ 巡检发现 → 目标栈出现 recover → 执行恢复

### Task 5.3: cron 自优化闭环
- **状态**：⬜ 待做
- **目标**：cron-optimizer 分析历史 → 自主调整 perception 频率（修改 job schedule）
- **验证**：`cron/changes/{timestamp}` 出现变更记录，或 job schedule 被动态更新

### Task 5.4: 沉淀 skill（进化）
- **状态**：✅ 已完成 1 个
- **目标**：重复操作 2-3 次后，管家用 skill_manage 生成新 SOP skill
- **已沉淀**：`profile/skills/network-proxy-recovery/SKILL.md`（App 无网/代理残留恢复 SOP，2026-11-17 实测案例）
- **验证**：`profile/skills/` 出现 network-proxy-recovery 目录，含完整排查/恢复/验证步骤

---

## 关键决策记录

| 决策 | 选择 | 理由 |
|---|---|---|
| 管家形态 | 独立 Hermes profile（phone-doctor） | 记忆/skill/cron 独立，可积累 |
| 交互方式 | delegate + cron + gateway（分阶段） | 近期委派，远期常驻 |
| 多设备 MCP | 型号驱动单 server + 命名空间 | 通用工具复用，型号能力隔离 |
| 模型路由 | tmp-flash（感知）/ tmp（决策） | 成本 vs 能力平衡 |
| 主动性 | cron 感知 + 目标栈 + cron 自优化 | 三层自主循环 |

## 风险与待确认

1. **cron 是否被 Hermes 加载**：profile 的 cron/*.yaml 需确认 Hermes 会自动加载（还是要 `hermes cron add`）
2. **hermes run --skill 用法**：需确认是触发 skill 还是传 prompt
3. **agentmemory 持久化**：device-perception 写 memory 的实际 API（memory_save 工具 vs 文件）
4. **gateway 常驻**：phone-doctor profile 的 gateway 尚未启动（7×24 在线的前提）

---

## 执行日志

| 日期 | 动作 | 证据 |
|---|---|---|
| 2026-11-17 | 创建 phone-doctor profile + 3 skill + 2 cron + registry | commit 8ba92fc |
| 2026-11-17 | 部署 profile 软链 | setup-profile.sh 成功 |
| 2026-11-17 | 注册 oneplus-phone-mcp（63 工具） | hermes mcp list ✓ enabled |
| 2026-11-17 | 推送代码到 GitHub | origin/main 最新 |