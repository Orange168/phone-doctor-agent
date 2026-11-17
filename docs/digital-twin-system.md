# 手机数字分身系统设计（子系统）

> 状态：项目设计（立项）
> 来源：`rk_356x_a12/code/docs/agent/system/phone-digital-twin-agent.md`（原设计文档，251 行）
> 本仓库：`phone-doctor-agent`（Hermes profile，负责管家执行）
> 连通关系：本仓库负责"管"（自主感知/决策/执行/进化），rk_356x_a12/code 负责"设计与原型"（系统设计、反检测理论、MCP 工具集 63 个）。两者通过 device-registry.json + MCP 双向连通。

---

## 一、愿景（一句话）

把一部真实手机的感知与执行能力交给本地 AI 模型，让它成为"另一个有手机的自己"——7×24 在线、能决策、能进化、能处理真实业务。

本仓库（phone-doctor-agent）是该系统的**管家智能体**（Hermes profile），负责自主巡检、目标栈调度、MCP 调用手机能力、把重复操作沉淀成 skill。

---

## 二、四层闭环架构

```
┌─────────────────────────────────────────────────────────────┐
│ 进化层：数据飞轮（失败/成功数据沉淀 → LoRA 微调 → 命中率↑）   │
│   数据集：(screenshot, ui_tree, action, result, error)      │
└─────────────────────────────────────────────────────────────┘
                            │ 数据集
┌─────────────────────────────────────────────────────────────┐
│ 决策层：本地模型（视觉理解 + 动作规划）                        │
│   Qwen2.5-VL / InternVL + 决策模型（3×4070 Super 48G）      │
└─────────────────────────────────────────────────────────────┘
                            │ 动作指令（点击/滑动/输入）
┌─────────────────────────────────────────────────────────────┐
│ 执行层：手机深度权限（KernelSU + Susfs 隐藏）                  │
│   屏幕流（scrcpy）/ 内核级触摸注入（拟人化）/ UI 树（uiautomator）│
└─────────────────────────────────────────────────────────────┘
                            │ 屏幕画面 / UI树 / 执行结果
┌─────────────────────────────────────────────────────────────┐
│ 感知层：手机端                                                │
│   截屏 / UI树 / 事件回调（界面变化、通知、弹窗）                │
└─────────────────────────────────────────────────────────────┘
```

---

## 三、与本仓库（phone-doctor-agent）的连通映射

| 数字分身架构层 | 本仓库落地方位 | 状态 |
|---|---|---|
| 感知层 | `profile/skills/device-perception/` + `profile/cron/perception.yaml`（*/15 巡检） | ✅ 完成 |
| 决策层 | `profile/skills/goal-manager/`（目标栈、优先级、护栏） | ✅ 完成 |
| 执行层 | `oneplus-phone-mcp`（63 工具，MCP stdio）→ 设备 | ✅ 完成（验收全绿） |
| 进化层 | `profile/skills/cron-optimizer/`（cron 自优化） + skill 沉淀 | 🔄 部分完成 |
| 反检测栈 | 第 IV 节（检测面清单 + 干预边界，源自 Verticalsky 案例） | ✅ 已迁移 |

设备注册表 `device-registry.json` 是事实源：当前注册 `pgp110`（OnePlus PGP110 / Ace Pro / 10T，KernelSU 3.2.5，root 深度层完整）。

---

## IV、反检测与系统透明度（核心原则）

以下内容源自 Verticalsky 客户 APK so 冲突案例（session 3ba9515491f4），适用于数字分身所有系统级干预。

### IV.1 app 知不知道，取决于"它有没有检测引擎"，不是"技术上能不能知道"

- 打印 app（没检测引擎）→ 改文件、hook 它都不知情，不是藏得好，是**没人查**
- 抖音（每层都有引擎）→ hook 会被发现

**对数字分身**：别赌"藏得深"。先**逆向目标 app 到底查什么**（检测面清单），对着清单精准打。没写检测的不用防，写了检测的重点防——资源不浪费。

### IV.2 系统级干预的作用域铁律：只做目标进程，不要全局替换系统库

案例中系统 libcrypto.so 一个字节没动，因为全局替换会波及 system_server/keystore/TLS，直接 Boot loop。

**对数字分身**：hook/注入/属性伪造永远只做目标 app 进程内（zygisk 按包名白名单、frida 按 target 注入、resetprop 仅在目标命名空间生效）。不要全局替换 `/system/lib` 里的库，不要全局 hook 系统 so。这是全局风险的底线。

### IV.3 竞品 A/B 对照法：遇到差异问题，两台设备对照，差异点就是根因

案例最终根因不是"客户 so 坏了"，而是"一处 namespace 差异"（竞品 data app ISOLATED 命名空间 vs 系统 app SHARED 共享命名空间）。

**对数字分身**：遇到"为什么 A 平台能跑、B 平台不能"、"为什么抖音正常、快手检测到 root"，不要猜，**两台设备/两个场景做 A/B 对照，差异点就是根因**。对 root 隐藏、传感器伪造、namespace 隔离都适用。

### IV.4 检测面清单（抖音为主，持续更新）

逆向目标 APK（jadx + Frida + AI）→ 提取它到底检测什么，只针对性模拟：

```
root 痕迹（su/路径/进程） → Susfs 内核隐藏
系统属性（Build/secure/调试标志） → resetprop 改
文件/挂载 → Susfs 伪造
包名/进程 → 隐藏列表
传感器异常（长期不动/无变化） → 内核伪造读数（真实数据回放）
屏幕/状态（方向/亮度/前台） → 高权限模拟
行为特征（点击轨迹/频率/时序） → 拟人化执行（数字分身核心）
```

**2026-11-17 更新**：抖音 41.1.0 实测版检测面清单已落盘 → `docs/douyin-detection-map.md`（七维度 + 证据等级 + 对数字分身的行动映射）。关键实测结论：

- 抖音检测真身 = libmetasec_ml.so（新版 APK 内置），读取 **34 个 sysprop key**（已 dump 全量清单）
- frida **attach 必自杀，spawn 存活**——动态分析基线
- SSL pinning 三层：Java（可绕）/ libttboringssl（可绕，回调强返 0）/ mssdk3 风控域（独立 TLS，未攻克）
- frida 绕过脚本已固化为技能：`profile/skills/frida-ssl-bypass/`

第三方 App 拿不到（不需要模拟）：基站 Cell ID/信号强度（Android 10+ 权限限制）、全局触摸事件（非 root/无障碍拿不到）。

---

## V、数据飞轮格式（统一）

```
(screenshot.png, ui_tree.xml, action, result, error, timestamp)
```

- 失败分类：界面变化 / 点错 / 风控拦截 / 超时
- 标注：界面 → 语义（发布页/评论区/推荐流），操作 → 意图
- 投喂小模型：学会"真人在这种界面怎么操作" → 生成拟人行为
- 回放输出（高权限）：内核伪造传感器读数 / 屏幕状态模拟 / 行为基线

---

## VI、落地里程碑与任务映射

| 里程碑 | 内容 | 本仓库对应任务 |
|---|---|---|
| M0 设备准备 | 一加 10 Pro root（KernelSU Next + Susfs）、scrcpy 验证、uiautomator 验证 | 设备注册表 pgp110，oneplus-phone-mcp 63 工具验收 |
| M1 MVP 闭环 | 本地 Qwen2.5-VL-7B，mobile-agent 接屏幕流，抖音发布单任务，记录数据 | goal-manager 目标栈，MCP 执行 |
| M2 数据飞轮 | 沉淀 500+ 条操作数据，失败分类清洗，LoRA 微调，命中率对比 | agentmemory 数据沉淀，skill 沉淀 |
| M3 拟人化增强 + 逆向对抗 | 逆向抖音检测面，内核级触摸注入，环境状态模拟，Momo 等验证 | 第 IV 节检测面 + 干预边界，oneplus-phone-mcp root 深度层 |
| M4 多业务扩展 | 抖音发布/评论/播放监控，其他 App 自动化，后台 Agent 决策 | cron 巡检 + 目标栈 + 多设备 MCP |

---

## VII、交叉引用

- `rk_356x_a12/code/docs/agent/system/phone-digital-twin-agent.md` —— 原设计文档完整版（含 MCP 63 工具表、验收证据、后续计划）
- `rk_356x_a12/code/vendor/rockchip/common/apps/Verticalsky/SOLUTION_DOC.md` —— 案例源（so 冲突、重命名+重定向、namespace 隔离）
- `phone-doctor-agent/device-registry.json` —— 设备注册表（管家事实源，pgp110）
- `phone-doctor-agent/profile/skills/` —— 管家技能（device-perception/goal-manager/cron-optimizer）
- `phone-doctor-agent/profile/cron/` —— 定时任务（perception.yaml / cron-optimizer.yaml）
- `phone-doctor-agent/scripts/perception-cron.sh` —— 感知执行脚本（no-agent，零 token）
- `phone-doctor-agent/docs/EXECUTION-PLAN.md` —— 阶段任务状态追踪

---

## VIII、一句话总结

这不是"买台手机刷 root 跑自动化"，而是一个"真实设备 + 智能决策 + 数据进化"的数字分身系统。一加 10 Pro 提供深度权限（手），本地模型提供决策（脑），数据飞轮提供记忆（进化），逆向检测面提供"精准对抗"（怎么藏），三者闭环，能处理抖音、电商、社交等真实业务。`phone-doctor-agent` 作为管家 profile 负责让这个系统"活"起来——自主感知、自主决策、自主执行、自主进化。