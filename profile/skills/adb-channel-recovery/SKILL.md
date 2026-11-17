---
name: adb-channel-recovery
description: adb 命令全部超时/设备列表为空时，排查并恢复 adb 通道 — QtScrcpy 等第三方 adb 抢占 5037 端口的检测与清理，server 残留进程清理
model: tmp-flash
trigger: cron
---

# adb 通道冲突恢复技能

## 触发条件

- `adb devices` 返回空但 Windows 侧 USB 正常
- adb 命令全部超时（`echo ok` 都无响应）
- 之前 adb 正常，突然全部失联

## 根因（实测案例，2026-11-17）

**QtScrcpy（或任何带 adb 的第三方工具）启动时拉起自己的 adb.exe 并监听 5037**，与本机 platform-tools adb 冲突。表现：

1. WSL 侧 `adb.exe devices` 无输出/超时
2. `adb.exe` 进程在跑但 5037 端口状态 `CloseWait`
3. Windows 设备管理器 USB 正常（`Get-PnpDevice` 显示 ADB Interface OK）

## 恢复步骤

### 1. 确认根因：查 5037 占用

```bash
PS="/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
$PS "Get-NetTCPConnection -LocalPort 5037 -ErrorAction SilentlyContinue | Select-Object State,OwningProcess | Format-Table -AutoSize"
$PS "Get-Process adb -ErrorAction SilentlyContinue | Select-Object Id,Path | Format-Table -AutoSize"
```

判定：如果 adb 进程路径是 `D:\Android\tools\QtScrcpy-...\adb.exe`（不是 platform-tools）→ 冲突确认。

### 2. 杀掉全部 adb 进程（含 QtScrcpy 拉起的）

```bash
$PS "Get-Process adb -ErrorAction SilentlyContinue | Stop-Process -Force"
# QtScrcpy 主程序可能守护 adb，一并杀（可选，避免它再拉起）
$PS "Get-Process | Where-Object { \$_.Path -match 'QtScrcpy' } | Stop-Process -Force -ErrorAction SilentlyContinue"
```

### 3. 重启 platform-tools server

```bash
ADB="/mnt/d/Android/sdk/platform-tools/adb.exe"
$ADB kill-server 2>&1 || true
sleep 2
$ADB start-server
$ADB devices -l
```

成功标志：`3902f377    device product:PGP110 model:PGP110 ...`

### 4. 稳定性验证（防复发误判）

```bash
for i in 1 2 3; do $ADB shell "echo ok$i"; done   # 连续 3 次响应才算恢复
```

## 复发预防

- 用 QtScrcpy 前先杀干净 adb，或让 QtScrcpy 用独立的 `ADB_SERVER_PORT`（如 5038）
- 每次 adb 异常先查 5037 占用，不要先怀疑设备/USB 线
- 设备本身死没死：Windows `Get-PnpDevice` 显示 OK 就大概率是 adb 层问题，不是设备问题

## 注意

- 串口工具（wsl-serial）不依赖 adb，adb 挂了串口仍可用——两条通道独立排查
- 不要直接删 `~/.android/adbkey` 之类的密钥文件（会导致设备弹窗重新授权）