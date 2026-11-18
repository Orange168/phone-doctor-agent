# phone-http-server — 手机端 HTTP 服务（方案 B：脱离数据线）

> 把手机能力封装为 HTTP REST API，跑在**手机 Termux** 里，电脑端通过 `adb forward` 访问。
> 手机只需连一次 USB 配 forward，之后 HTTP 调用**不依赖数据线传输**（走 USB 转发通道，稳定）。

## 架构

```
电脑 Agent ──HTTP──> adb forward(USB) ──> 手机 Termux python3 HTTP 服务 ──> su 本地命令
```

- **手机端**：`phone-http-server.py`（Python 3.14，监听 0.0.0.0:8899）
- **电脑端**：`adb forward tcp:8899 tcp:8899` + `curl http://127.0.0.1:8899/...`
- **命令执行**：手机端通过 `su -c` 本地执行（input/screencap/uiautomator/dumpsys），不依赖 adb

## 快速开始

```bash
# 启动（推送 + 启动服务 + 配 forward + 验证）
bash phone-http-server.sh start

# 测试
bash phone-http-server.sh test

# 查看状态
bash phone-http-server.sh status

# 停止
bash phone-http-server.sh stop
```

## API 列表

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/status` | 设备在线状态 |
| GET | `/device_info` | 型号/Android/电池 |
| GET | `/foreground` | 前台应用 |
| GET | `/capture_screen` | 截图（保存到 /data/local/tmp/phone_screen.png） |
| GET | `/layout` | 布局树（uiautomator dump） |
| GET | `/sensor_status` | 传感器列表 |
| GET | `/frida_status` | frida-server 状态 |
| GET | `/sshd_status` | sshd 状态 |
| GET | `/wake` | 唤醒屏幕 |
| GET | `/sleep` | 熄屏 |
| GET | `/screen_status` | 屏幕状态 |
| GET | `/tap?x=540&y=1200` | 点击 |
| GET | `/swipe?x1=..&y1=..&x2=..&y2=..&duration=300` | 滑动 |
| GET | `/input_text?text=hello` | 输入文本 |
| GET | `/press_key?key=KEYCODE_HOME` | 按键 |
| POST | `/exec` `{"cmd":"..."}` | 执行任意 shell 命令（su） |
| GET | `/list` | 工具列表 |

## 真机验证（2026-11-18）

- ✅ `/status` → `{"ok": true, "device": "PGP110", "serial": "3902f377"}`
- ✅ `/device_info` → `PGP110 / Android 15 / 电池 96%`
- ✅ `/frida_status` → `running: true, pid: 21822`
- ✅ `/capture_screen` → 截图成功
- ✅ `/tap` POST → 点击注入成功

## 与 MCP 的关系

- 现有 `oneplus-phone-mcp`（80 工具）走 **stdio + adb**，是 Hermes Agent 的 MCP 接口
- 本 HTTP 服务是**补充通道**：任何程序（非 Agent）都能通过 HTTP 调用手机，且配置一次后脱离数据线束缚
- 两者可共存：Agent 用 MCP，外部程序用 HTTP