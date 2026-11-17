# 反检测对抗方向调研：KernelSU 升级困境与设备选型决策

> 此文档是 `phone-doctor-agent` 仓库的唯一维护版本。
> 日期：2026-08-25
> 证据等级：`research`（调研结论，含设备实测背景）
> 背景：RK3568 (A12, kernel 4.19.232) 反检测方案调研，KernelSU Next 升级 bootloop 后的方向决策

---

## 一、核心矛盾：4.19 内核无法跑新版 KernelSU

### 版本兼容性事实

| 方案 | 是否支持 4.19 非 GKI | 说明 |
|---|---|---|
| 官方 KernelSU (tiann/KernelSU) v1.0+ | ❌ | v1.0 起官方放弃非 GKI（issue #1705），只支持 GKI 5.10+ |
| 官方 KernelSU v0.9.5 | ✅ | **最后一个支持非 GKI 的版本**，纯 su，无隐藏层能力 |
| KernelSU Next legacy（社区分支） | ⚠️ 宣称支持 | 文档称 backported to 4.14+，但**实测 4.19 有兼容 bug** |
| ZygiskNext（隐藏层必需） | — | 要求 KernelSU 10940+（=v1.0+），**v0.9.5(version 16) 装不了** |

### RK3568 4.19 升级 KernelSU Next 实测（bootloop 记录）

- v1（未修复）：完全 bootloop，adb/ssh 全断
- v2（修 execve preempt）：能进 recovery，但仍未完整启动
- 已修 3 个 bug：
  1. `uapi/` 目录缺失（编译错）
  2. `ksu_input_hook` 未定义（链接错）
  3. **`sys_execve_handler_pre` 在 kprobe 原子上下文做 preempt 操作 + 调用可能睡眠的 `strncpy_from_user()` → 每次 execve 必崩 → bootloop**（对比 v0.9.5 只用 nofault 安全版确认）
- 剩余未知：selinux_hide / LSM hook / fstat kprobe 等，需串口抓日志定位

### 结论

**不是"最新版不支持 4.19"，而是"官方最新版不支持，社区版宣称支持但实测有多个兼容 bug"。** 要完整反检测（内核层 su + Zygisk），必须换 GKI 设备或继续修社区版。

---

## 二、三条可选路线

| 路线 | 工作量 | 风险 | 隐藏层能力 | 说明 |
|---|---|---|---|---|
| A. 继续修 KernelSU Next | 中 | 中（还有未知 bug） | ✅ 完整 | 保留内核层 su，但社区版维护脆弱 |
| B. 纯 Magisk + Zygisk + Shamiko | 小 | 低 | ⚠️ 用户态 su | 放弃内核层 su 优势（当初选 KernelSU 的原因） |
| C. 买二手 GKI 设备 | 小 | 低 | ✅ 完整 | 500 元左右，新 KernelSU 直接可用，社区成熟 |

**推荐：C > A > B。** 若不愿花钱且愿意再试 1-2 轮调试，选 A；接受用户态 su 的隐藏弱点才选 B。

---

## 三、反检测工具链（闲鱼晒图背后的专业术语）

### 检测工具（App 用来检测 root，你用它当"验收测试用例"）

| 工具 | 检测内容 | 用途 |
|---|---|---|
| **Momo** | su、Magisk 进程、Zygisk、Xposed、挂载、BL 锁状态、可疑 App 等 20+ 项 | 综合 root 检测，"公开版风控逻辑" |
| **Hunter（猎手）** | root + 隐藏层痕迹（Zygisk/Riru/Magisk 模块/LSPosed） | 针对隐藏层的深度检测 |
| **Memory Detector v2.1** | Xposed/Frida 等内存 hook 注入痕迹 | 检测内存级注入 |
| **AppList Detector** | 设备上可疑 App（Magisk/KernelSU Manager、Xposed、GG 助手） | 检测可疑安装列表 |

### root 方案

- **SuKiSU Ultra**：韩国开发者的 KernelSU 分支/替代品，主打更强隐藏 + 内置反检测，对 Momo 等隐藏效果在圈内评价较高
- KernelSU Next / Magisk：主流方案

### 圈内"验收标准"

```
设备 root + 隐藏层配好 → 跑 Momo/Hunter/MemoryDetector/AppListDetector
→ 全部通过（0 检出）→ 证明隐藏层合格，可跑普通风控 App
```

这相当于"测试用例"验证 root 藏得好不好——正是本方向要沉淀的能力。

---

## 四、设备选型（GKI 5.10+，可解锁 BL）

| 设备 | 内核 | 闲鱼参考价 | 优势 |
|---|---|---|---|
| **红米 Note 12 Turbo**（骁龙7+Gen2） | 5.10 GKI | 500-700 元 | 社区方案最多，KernelSU 教程标杆机 |
| 一加 9 / 9R（骁龙888/870） | 5.10 GKI | 400-600 元 | 解锁政策友好 |
| Pixel 6/6a（Tensor） | 5.10 GKI | 300-500 元 | BL 解锁最简单 |
| 红米 K50/K60（骁龙8+） | 5.10/5.15 | 600-900 元 | 性能强 |
| 一加 8T/9RT | 5.10 GKI | 300-500 元 | 便宜 |

**注意**：小米 2024 后 BL 解锁收紧；一加 ColorOS 14+ 可解锁；Pixel 最省心。**必须确认内核 ≥5.10**。

---

## 五、重要纠偏：root 手机 ≠ 游戏手机

- 红米 Note 12 硬件能玩中端游戏（原神中画质 45-60 帧，会发热降频）
- **但 root + 热门游戏 = 高风险**：原神/星铁/王者等反作弊检测 root，可能直接封号
- 游戏 App 不是"烧录"的，是正常安装，客户端破解无意义（服务端验证）
- **root 设备的正确应用场景**：

```
✅ App 自动化数据采集（uiautomator2 + root）
✅ Frida 逆向 / 抓包分析（SSL unpinning）
✅ 多账号批量操作（root 沙箱）
✅ 反风控对抗实验台（测隐藏层能力，跑 Momo/Hunter 等）
✅ Agent 自动化宿主（采集数据推后台）
❌ 玩热门游戏（封号雷区）
```

**两台设备应分开**：root 实验机做采集，游戏机保持干净不 root。

---

## 六、最终选型（2026-08-25 确定）

**选定：一加 Ace Pro 16+256（国行，= 国际版一加 10T）**

### 选型理由

| 维度 | 评估 |
|---|---|
| 芯片 | 骁龙 8+ Gen 1（台积电工艺，比 8 Gen 1 凉快、续航好） |
| 内核 | **5.10 GKI**（KernelSU Next 直接可用，不用修 4.19 的坑） |
| KernelSU 适配 | ✅ **Action-KernelSU-Next 项目专门适配**（含一加AcePro/10T），支持 Susfs |
| 内核源码 | ✅ OnePlusOSS 官方发布（可改内核做 L3 拟人点击） |
| 刷国际版系统 | ✅ 可刷 OxygenOS（= 一加 10T 国际版固件） |
| 内存 | 16GB，跑 mobile-agent + AI 应用绰绰有余 |
| 闲鱼参考价 | 800-1200 元 |

### 为什么不是其他选择

- **红米 Note 12**：社区成熟但无内核源码（L3 定制受限），且是热门 root 机型易被风控标记
- **一加 10 Pro**：8 Gen 1（三星工艺，发热大）；方案成熟但硬件不如 Ace Pro
- **一加 9**：最便宜但 888 老、发热
- **RK3568**：4.19 跑不了新版 KernelSU（已实测 bootloop），保留做学习设备

### 落地路径（等设备到货后执行）

```
一加 Ace Pro 16+256
  → 0. ⚠️ 买前/到手先确认：
       - 是否已解锁 BL（已解最好，到手直接刷）
       - 当前 ColorOS 版本（出厂 C15 之前可直接解；C15.0.0.1301+ 强制防回滚+要先降级，降级可能黑砖）
       - 是否升级过系统（升到 C15.0.0.1301+ 的谨慎，可能黑砖风险）
       - 没解锁的：若在可解版本，按 fastboot flashing unlock 流程解
  → 1. 确认/解锁 Bootloader（国行 ColorOS 解锁政策，买前确认）
  → 2. 刷国际版 OxygenOS（= 一加 10T 固件，处理 ocdt 分区兼容）
       ⚠️ ocdt 必须刷国际版，否则花屏/无法激活
       ⚠️ 内核源码按系统版本对齐（OxygenOS 13 用对应 5.10 分支）
  → 3. 刷 Action-KernelSU-Next 定制内核（含 KernelSU Next + Susfs）
       ⚠️ 升级系统后要重刷内核
  → 4. 配 ZygiskNext + 隐藏层
  → 5. 验收：Momo + Hunter + MemoryDetector + AppListDetector 全过
  → 6. 内核源码定制：改 input 子系统做 L3 拟人点击（mobile-agent 深度定制）
  → 7. 跑 mobile-agent 自动化 + 数据采集
```

### ⚠️ BL 解锁风险提示（2026-06 查证）

- 一加 Ace Pro 是 2022 老机型，出厂 ColorOS 12/13，多数二手在可解锁版本
- **但**：升级到 ColorOS 15.0.0.1301+ 会强制防回滚 + 解锁要先降级（降级可能黑砖）
- 2026 收紧的是出厂 ColorOS 16 的新机型（Ace Pro 不在列，但仍需防已升级的二手）
- **买二手务必确认：已解锁？当前版本？是否升过级？**

### 核心能力确认（回答"定制内核 + 刷国际版"）

- ✅ **定制内核**：OnePlusOSS 内核源码 → 改 input 子系统 / 加 KernelSU / Susfs → 编译刷入
- ✅ **刷国际版**：ColorOS → OxygenOS（一加 10T 固件）
- **顺序**：先定系统（国际版）→ 再做内核定制（内核源码按系统版本对齐）
- **RK3568 定位**：保留做 AOSP 编译/Perfetto/系统优化学习设备（v0.9.5 纯 su 可用）

---

## 七、待办 / 下一步

### 已完成

- [x] 调研 KernelSU 版本兼容性（官方 v1.0+ 弃非 GKI，v0.9.5 最后支持 4.19）
- [x] 调研 RK3568 4.19 升级 KernelSU Next 可行性（实测 bootloop，已修 3 bug 仍有未知）
- [x] 调研反检测工具链（Momo/Hunter/MemoryDetector/AppListDetector/SuKiSU Ultra）
- [x] 调研设备选型（红米 → 一加 9/10 Pro → **最终：一加 Ace Pro 16+256**）
- [x] 确认一加 Ace Pro KernelSU 适配（Action-KernelSU-Next 项目专门支持 + Susfs）

### 待设备到货后

- [ ] 确认/解锁 Bootloader（国行 ColorOS 政策）
- [ ] 刷国际版 OxygenOS（一加 10T 固件，处理 ocdt）
- [ ] 刷 Action-KernelSU-Next 定制内核（KernelSU Next + Susfs）
- [ ] 配 ZygiskNext + 隐藏层，Momo/Hunter 等验收全过
- [ ] OnePlusOSS 内核源码定制（L3 拟人点击 for mobile-agent）
- [ ] mobile-agent 自动化落地

### 备选（RK3568 侧，不阻塞）

- [ ] 串口抓日志定位 KernelSU Next v2 剩余 panic 点（如确需在 4.19 继续）
- [ ] RK3568 保留做 AOSP 编译/Perfetto/系统优化学习（v0.9.5 纯 su 可用）