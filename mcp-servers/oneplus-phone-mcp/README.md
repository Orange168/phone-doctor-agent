# oneplus-phone-mcp

一加 PGP110（Ace Pro / 10T）手机能力 MCP 服务器。把手机的**感知与执行能力**封装为标准 MCP 工具，供 Hermes / Claude Code / 任何 MCP 客户端调用。

> 基于 `docs/device/oneplus-pgp110-environment.md`（环境文档）与 `docs/agent/system/phone-digital-twin-agent.md`（数字分身设计）实现。

## 工具清单（63 个）

### 设备通道（基础层）
| 工具 | 说明 |
|---|---|
| `device_status` | 检查设备是否在线（adb get-state） |
| `get_device_info` | 完整设备信息（型号/Android/内核/电池/网络/root） |
| `get_foreground_app` | 当前前台应用（包名 + Activity） |
| `list_apps` | 已装应用列表（可 filter） |
| `screen_status` | 屏幕亮灭/锁定状态 |
| `wake_screen` / `sleep_screen` | 唤醒 / 熄灭屏幕 |

### 屏幕捕获（感知）
| 工具 | 说明 |
|---|---|
| `capture_screen` | 截屏 PNG/JPEG，返回文件路径（Agent 视觉理解） |

### 布局树（辅助功能，简化版）
| 工具 | 说明 |
|---|---|
| `get_layout_tree` | 简化布局树（uiautomator dump → JSON，过滤纯容器） |
| `get_interactive_elements` | 可交互元素列表（含 center 坐标，直接用于点击） |

### 输入注入（执行）
| 工具 | 说明 |
|---|---|
| `tap` | 点击（x,y，duration_ms 长按，randomize 拟人抖动） |
| `swipe` | 滑动（x1,y1 → x2,y2） |
| `input_text` | 输入文本（自动转义，clear_first 先清空） |
| `press_key` | 按键（KEYCODE 名称/数字，如 HOME/BACK/APP_SWITCH） |

### 远程共享（scrcpy）
| 工具 | 说明 |
|---|---|
| `start_share` | 启动无头屏幕流录制（`--no-window --no-audio`，可 record mp4） |
| `share_status` | 共享会话状态 |
| `stop_share` | 停止共享 |
| `scrcpy_available` | scrcpy 可用性检查 |

### SSH 通道
| 工具 | 说明 |
|---|---|
| `ssh_check` | 探测 SSH 通道（lan=`op_` 局域网 / wan=`cf-op` 外网） |

### KernelSU su 深度操作（root 深度层）
| 工具 | 说明 |
|---|---|
| `root_check` / `ksu_version` | root 状态 / KernelSU 版本 |
| `run_root` | **任意 root 命令执行**（su -c） |
| `pm_list` / `pm_path` / `pm_clear` / `pm_set_enabled` | 包管理（root） |
| `ps_list` / `kill_proc` / `force_stop` | 进程管理（root） |
| `fs_read` / `fs_write` / `fs_list` / `fs_rm` | 文件系统（root，可访问 /data/data） |
| `setprop` / `resetprop` / `list_props` | 系统属性（resetprop 可改 ro.） |
| `settings_get` / `settings_put` | 系统设置读写 |

### Termux 集成（root 深度层）
| 工具 | 说明 |
|---|---|
| `termux_run` | **Termux 命令执行**（python3/gcc/git 等工具链） |
| `termux_status` / `termux_sshd_status` / `termux_sshd_start` | Termux / sshd 管理 |
| `termux_apt_install` | Termux apt 安装（绕 DNS 死结） |
| `termux_container` / `termux_container_list` | proot 容器（Ubuntu/Alpine） |

### GPS 模拟（root 深度层）
| 工具 | 说明 |
|---|---|
| `gps_authorize` | 授权应用使用模拟位置（appops mock_location） |
| `gps_set` | 设置模拟坐标（lat/lng，jitter 抖动） |
| `gps_status` / `gps_clear` | 状态查询 / 清除模拟 |

### Xposed 注入（root 深度层）
| 工具 | 说明 |
|---|---|
| `xposed_status` | LSPosed 框架状态 |
| `xposed_modules` | 列出 Xposed 模块（LSPosed db） |
| `xposed_hooks` | 枚举 hook 框架能力（LSPosed/Zygisk/Frida） |
| `xposed_set_module` / `xposed_inject` / `xposed_verify` | 模块管理 / 注入 / 验证 |
| `xposed_manager` | 启动 LSPosed Manager |

### 逆向工具（root 深度层）
| 工具 | 说明 |
|---|---|
| `frida_status` / `frida_start` / `frida_stop` | frida-server 管理 |
| `frida_ps` | 设备进程列表 |
| `frida_inject` / `frida_spawn` | **注入 frida 脚本**（hook 任意方法） |
| `frida_remote` | frida 远程通道（adb forward 27042） |

## 快速开始

```bash
# 1. 安装依赖
cd oneplus-phone-mcp
npm install

# 2. 真机验证（需要设备 adb 在线）
bash scripts/verify-mcp.sh

# 3. 离线结构验证（无设备）
bash scripts/verify-offline.sh

# 4. 注册进 Hermes（已注册）
hermes mcp add oneplus-phone-mcp --command "node /abs/path/server.js" --connect-timeout 30
hermes mcp test oneplus-phone-mcp
```

## 配置

环境变量（`.env` 或 shell）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `ONEPLUS_SERIAL` | `3902f377` | 设备序列号 |
| `ADB_PATH` | `.../prebuilts/runtime/adb` | adb 路径 |
| `SCRCPY_PATH` | `/usr/local/bin/scrcpy` | scrcpy 路径 |
| `ONEPLUS_OUTPUT` | `./output` | 截图/录制输出目录 |

## 架构

```
oneplus-phone-mcp/
├── src/
│   ├── server.js     # MCP server 入口（19 工具注册）
│   ├── config.js     # 统一配置
│   ├── adb.js        # adb 通道（统一 -s serial）
│   ├── screen.js     # 截图
│   ├── layout.js     # 布局树解析（uiautomator → 简化 JSON）
│   ├── input.js      # 输入注入（tap/swipe/text/key）
│   ├── scrcpy.js     # 屏幕流（无头录制）
│   ├── ssh.js        # SSH 通道探测
│   └── device.js     # 设备信息
├── scripts/
│   ├── verify-mcp.sh      # 真机全工具验证
│   └── verify-offline.sh  # 离线结构验证
└── output/           # 截图/录制输出
```

## 参考 scrcpy（Genymobile）

屏幕流能力参考 [scrcpy](https://github.com/Genymobile/scrcpy)（v4.1）实现：
- 无头模式：`--no-window --no-audio`（WSL/服务器无显示器/音频）
- 录制：`--record file.mp4`（h264）
- 输入：scrcpy `input` 优先，回退 adb `input`

## 已知限制

- **SSH 通道**：`op_` 需先 `adb forward tcp:8022 tcp:8022`；Termux sshd 重启后需手动启动（`/data/data/com.termux/files/home/.termux/boot/start-sshd.sh`）
- **布局树**：走 uiautomator dump（约 1-3s），无障得服务通道待后续
- **远程共享**：MVP 为本机录制/预览；外网实时帧流（WebSocket）待 M2
