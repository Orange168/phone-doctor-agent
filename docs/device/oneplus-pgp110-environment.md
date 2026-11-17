# 一加 Ace Pro (PGP110) 完整环境文档

> 版本：2026-09-02 实测
> 用途：供大模型/任务规划者理解当前设备环境、可用的工具链、通道、权限边界
> 设备角色：手机数字分身实验台（感知 + 执行 + 反检测 + 外网可达）

---

## 1. 设备基线

| 项 | 值 |
|---|---|
| 型号 | 一加 PGP110（Ace Pro / 10T 同款硬件） |
| 序列号 | **3902f377** |
| 系统 | Android 15 (SDK 35) / OxygenOS |
| 指纹 | `OnePlus/PGP110/OP5551L1:15/AP3A.240617.008/S.21c020d_2_1:user/release-keys` |
| 内核 | **5.10.236-android12-9-o-g1a59416f721e**（GKI） |
| CPU / RAM | 8 核 / 16 GB |
| 屏幕 | 1080×2412 @ 480dpi |
| 存储 | 224 GB（已用 18G） |
| 网络 | WiFi（当前 HUAWEI-18125P / 或热点 GoogleGuest） |
| ADB | prebuilts v41（`/home/master/sourceCode/rk_356x_a12/code/prebuilts/runtime/adb`） |

### Root 状态

- **KernelSU v3.2.5 (versionCode 32525)**，LKM 模块方式（`/proc/modules` 有 `kernelsu 196608`）
- `su -c id` → `uid=0(root) gid=0(root) context=u:r:ksu:s0`
- SELinux：**Enforcing**
- AVB：`verifiedbootstate=green`、`flash.locked=1`、`device_state=locked`（Tricky Store 伪造）
- **KernelSU 三件套锁定 v3.2.5（内核/ksud/Manager 一致）**，禁止单独升 Manager

---

## 2. 反检测栈（全绿）

| 组件 | 版本 | 说明 |
|---|---|---|
| KernelSU | v3.2.5 (32525) | root 提供者 |
| Zygisk Next | v1.5.0 (843) | 隐藏层引擎（memfd 匿名注入，不留文件路径） |
| HMA-OSS | oss-166 | Hide My Applist（隐藏应用列表） |
| Tricky Store | v6.0.0-235 | AVB/Keybox 伪造 |
| Violet | v1.4 | 附加模块 |
| PathMask | 2.5.0 | 路径遮罩 |
| Automatic_brick_rescue | v221204 | bootloop 自动救砖 |
| **Momo** | v4.4.1 | 反检测验收工具 |
| **Hunter** | 6.65 | 反检测验收工具 |

**验收证据**：Hunter 报 `ZYGISK NOT DETECTED - msg: 0` = 反检测成功。
（Zygisk Next memfd 匿名注入，maps 里 grep 不到 zygisk 库是正常期望，不是没工作）

**注意**：Momo/Hunter 是检测工具，属于"测试 App"，**不要**在目标 App 反检测配置里排除它们，否则自欺。

---

## 3. 设备端常驻服务（重启自启）

| 服务 | 端口 | 启动方式 | 自启脚本 | 状态 |
|---|---|---|---|---|
| Termux sshd | **8022** | u0_a355 身份 | `~/.termux/boot/start-sshd.sh` | ✅ 实测 |
| cloudflared 隧道 | 出站 | root + setsid | `/data/adb/service.d/cf-tunnel.sh` | ✅ 实测（已修复 pgrep -f 自匹配 bug） |
| frida-server | 出站 (27042) | root | `/data/adb/service.d/frida-server.sh` | ✅ 实测 |

**自启脚本位置**：
- `/data/adb/service.d/cf-tunnel.sh`（root 层，开机必跑）
- `/data/adb/service.d/frida-server.sh`（root 层，开机必跑）
- `/data/data/com.termux/files/home/.termux/boot/start-sshd.sh`（Termux boot 插件）
- `/data/data/com.termux/files/home/.termux/boot/20-cf-tunnel.sh`（备用）

**已踩坑**：service.d 脚本里 `pgrep -f cloudflared` 会匹配到脚本自身 cmdline → 误判"已运行"直接退出 → 隧道没拉起。**必须用 `pgrep -x cloudflared`（精确进程名）**。

---

## 4. SSH 通道（本机 ~/.ssh/config）

### 一加 PGP110（3902f377）

| 别名 | HostName | 端口 | 用户 | 方式 |
|---|---|---|---|---|
| **`cf-op`** | op.linzhi.eu.cc | 443 (ProxyCommand) | u0_a355 | Cloudflare 外网（任意网络可达） |
| **`op_`** | 127.0.0.1 | 8022 | u0_a355 | 局域网，需先 `adb forward tcp:8022 tcp:8022` |

### RK3568（GCD300010OA08000952）

| 别名 | HostName | 端口 | 用户 | 方式 |
|---|---|---|---|---|
| `cf-root` | root.linzhi.eu.cc | 443 | root | Cloudflare 外网 |
| `cf-dev` | dev.linzhi.eu.cc | 443 | u0_a67 | Cloudflare 外网 |
| `dev` | 192.168.3.7 | 22 | root | 局域网 |
| `dev_` | 192.168.3.7 | 2223 | root | 局域网 |

**验证命令**：
```bash
ssh cf-op 'echo OK; whoami; getprop ro.serialno'   # OK / u0_a355 / 3902f377
ssh op_ 'echo OK; whoami'                            # 局域网（先 adb forward）
```

---

## 5. Cloudflare 外网隧道（一加）

| 项 | 值 |
|---|---|
| 域名 | **op.linzhi.eu.cc** |
| 隧道名 | ssh-op |
| 映射 | `ssh://localhost:8022`（Termux sshd） |
| 状态 | healthy（4 边缘连接） |
| 设备侧 | cloudflared **2026.8.2**（Termux 版，从 RK3568 拷贝，依赖仅 liblog/libdl/libc） |
| 运行 token | `/root/.cloudflared-tokens/op.token`（本机） + `~/cf/op.token`（设备） |
| Access | 不配（开发机，仅密钥认证） |
| 客户端 | `/root/.local/bin/cloudflared` 2026.5.1 |

**关键约束**：
- cloudflared **必须用 Termux 包**（官方 arm64 二进制在 Android 上 Segfault）
- 设备侧**必须 root + setsid 启动**（Termux 身份会因 DNS 死结 + nohup 会话被杀而失败）
- 本机 SSH 必须走 `ProxyCommand cloudflared access ssh`（域名 22 端口不通，CF 只代理 443/WebSocket）

---

## 6. Termux（ZeroTermux）环境

| 项 | 值 |
|---|---|
| 应用 | ZeroTermux v0.118.3.64（国产增强版，包名 com.termux） |
| 来源 | `github.com/hanxinhao000/ZeroTermux` |
| uid | u0_a355 (10355) |
| PREFIX | `/data/data/com.termux/files/usr` |
| 预装 | proot 5.1.107.92 / QEMU 11.0.3 / openssh 10.5p1 / python3.14 / pip 26.2 |
| 预装工具 | htop / git / lsof / socat / filan / procan 等（**需属主 u0_a355**） |
| apt 源 | 官网 `packages.termux.org`（可切换国内镜像） |

### ⚠️ Termux pkg/apt DNS 死结（核心特性，必须了解）

**现象**：`pkg install xxx` 测所有镜像全 `bad`，`curl` 报 `no such host`。

**根因**：Android netd 按 SELinux 域授权 DNS。
- root（`u:r:ksu:s0`）→ DNS 正常
- `su u0_a355` / SSH 会话（uid=app 但 domain=ksu 的混合体）→ **DNS 解析失败**
- Termux app 前台（`u:r:untrusted_app_25`）→ DNS 正常
- 换源/换网络**无效**（不是镜像问题，是 netd 授权）

**解法**：`proot -i 1000:1000` 伪装 uid 为 1000（非 root），让 apt 通过 root 检查，网络走 root 上下文（DNS 正常）。

**万能包装器**（已部署 `/data/local/tmp/termux-pkg.sh`，以 root 跑）：
```sh
#!/system/bin/sh
PREFIX=/data/data/com.termux/files/usr
PROOT=$PREFIX/bin/proot
$PROOT -i 1000:1000 -b /proc -b /dev -b /sys \
  $PREFIX/bin/sh -c "export PATH=$PREFIX/bin:\$PATH; \
  export HOME=/data/data/com.termux/files/home; \
  export LD_LIBRARY_PATH=$PREFIX/lib; \
  export TMPDIR=$PREFIX/tmp; \
  apt-get --reinstall $@"
```

**用法**：
```sh
adb -s 3902f377 shell 'su -c "sh /data/local/tmp/termux-pkg.sh install nmap python3"'
```

**已装包（验证过）**：htop 3.5.3、socat 1.8.1.3、git 2.55.0

**陷阱**：
- `pkg` 和 `apt` 都硬编码拒绝 root（`Ability to run as root disabled`）→ proot 伪装 uid
- proot 伪装选项是 `-i uid:gid`（`--change-id`），不是 `--puid`（不存在）
- `apt-get install` 在 proot 下可能报 `0 newly installed`（dpkg 状态不一致）→ 加 `--reinstall`
- 装完二进制属主是 root → `chown u0_a355:u0_a355` 才能被 Termux 用户执行

---

## 7. 容器（proot 根文件系统）

| 容器 | 路径 | 大小 | 包管理器 |
|---|---|---|---|
| **Ubuntu 18.04** | `~/Termux-Linux/Ubuntu/ubuntu-fs` | 216 MB | apt |
| **Alpine 3.24** | `/data/local/tmp/alpine` | 17 MB | apk |

**进入 Ubuntu（一键脚本，已验证）**：`/home/master/sourceCode/rk_356x_a12/code/ubuntu-adb.sh`
```bash
./ubuntu-adb.sh                         # 交互式
./ubuntu-adb.sh "apt update && apt install -y python3"   # 单命令
```

**关键**：容器内有自己的 `/etc/resolv.conf`（Linux getaddrinfo 读它）→ **容器内 apt/apk 网络完全正常**（绕过 Termux DNS 死结）。容器内可做：爬虫、服务器、逆向工具链、渗透测试。

---

## 8. 本机（WSL）工具链

| 工具 | 版本 | 用途 | 备注 |
|---|---|---|---|
| frida / frida-tools | 16.7.19 | 动态 hook | 17.x 需 py3.11+，本机 py3.10 用 16.x |
| frida-server | 16.7.19 (arm64) | 设备端注入 | `/data/adb/frida-server` |
| objection | 1.12.5 | frida 快捷 | |
| jadx / jadx-gui | 1.5.6 | 反编译 | 下载用具体版本号（latest 404） |
| apktool | 2.5.0 | APK 解包 | |
| mitmproxy / mitmdump | 11.0.2 | HTTPS 抓包 | |
| scrcpy | 4.1 | 投屏 | 需 `export ADB=/usr/bin/adb`；1.21 不兼容 Android 15 |
| sqlite3 | 3.37.2 | 数据库 | |
| python3 / pip3 | 3.10 | 脚本 | |
| node / java | 20 / 11 | 运行环境 | |
| cloudflared | 2026.5.1 | CF 客户端 | `/root/.local/bin/cloudflared` |
| nmap / tcpdump | 7.80 | 网络 | |
| ADB | prebuilts v41 | 设备控制 | 不要用系统 v39（冲突） |

**frida 使用**：
```bash
frida-ps -U                          # 列设备进程（验证 frida-server 连接）
frida -U -f com.ss.android.ugc.aweme -l script.js   # hook 抖音
```

**scrcpy 使用**：
```bash
export ADB=/usr/bin/adb
scrcpy -s 3902f377 --max-size 800 --max-fps 10    # 投屏（本地）
# 外网投屏需后续扩展（走 CF 隧道转发 adb 或 scrcpy TCP）
```

---

## 9. 目标 App（逆向/自动化对象）

| App | 包名 | 版本 | 状态 |
|---|---|---|---|
| **抖音** | com.ss.android.ugc.aweme | 17.6.2 | ✅ 已安装，target.txt 反检测名单内 |
| 淘宝 | com.taobao.taobao | — | ✅ 已安装 |
| 支付宝 | com.eg.android.AlipayGphone | — | ✅ 已安装 |
| KernelSU Manager | me.weishu.kernelsu | v3.2.5 | ✅ |
| Hunter | com.zhenxi.hunter | 6.65 | ✅ 验收工具 |
| Momo | io.github.vvb2060.mahoshojo | 4.4.1 | ✅ 验收工具 |

**抖音进程注入验证**（Zygisk/HMA 是否生效）：
```bash
# 启动抖音后，检查其 maps 无 zygisk/zn_ 痕迹（HMA 隐藏成功）
adb -s 3902f377 shell 'su -c "for p in $(pgrep -f aweme); do grep -ciE \"zygisk|zn_\" /proc/$p/maps 2>/dev/null; done"'
# 期望输出 0（隐藏成功）
```

---

## 10. 常用操作速查

### 设备控制
```bash
ADB=/home/master/sourceCode/rk_356x_a12/code/prebuilts/runtime/adb
$ADB -s 3902f377 shell 'su -c "..."'     # root 命令
$ADB -s 3902f377 forward tcp:8022 tcp:8022   # SSH 桥接（断连后需重建）
ssh op_                                   # 局域网 Termux
ssh cf-op                                 # 外网 Termux
```

### 装包（Termux，绕 DNS 死结）
```bash
adb -s 3902f377 shell 'su -c "sh /data/local/tmp/termux-pkg.sh install <pkg>"'
```

### 进容器
```bash
./ubuntu-adb.sh "apt install -y python3-pip"
```

### 反检测验证
```bash
# 启动 Hunter 看 ZYGISK NOT DETECTED
adb -s 3902f377 shell 'am start -n com.zhenxi.hunter/.MainActivity'
adb -s 3902f377 shell 'logcat -d | grep -E "Final detection result|ZYGISK"'
```

### 服务状态
```bash
adb -s 3902f377 shell 'su -c "ps -A | grep -E \"sshd|cloudflared|frida-server\"; ss -tln | grep 8022"'
```

---

## 11. 权限与边界

| 操作 | 等级 | 说明 |
|---|---|---|
| 读取设备 / root 命令 / frida / scrcpy | A0/A1 | 自动可执行 |
| 装 Termux 包 / 容器操作 | A1/A2 | 用 termux-pkg.sh / 容器脚本 |
| 修改系统文件 / remount | A2/A3 | 需评估 |
| 刷机 / 内核 / bootloader | A4 | 需明确授权 |
| KernelSU 升级 | ⚠️ 禁止单独升 | 三件套锁定 v3.2.5 |

---

## 12. 已知问题 / 待办

- [x] cloudflared 自启 `pgrep -f` 自匹配 bug → 已修为 `pgrep -x`
- [x] frida-server 自启 → 已配置 `/data/adb/service.d/frida-server.sh`，实测在跑
- [x] Termux pkg DNS 死结 → termux-pkg.sh 包装器解决
- [ ] 外网实时 scrcpy 投屏（当前本地可用，外网需走 CF 转发扩展）
- [ ] Cloudflare API token 用完建议撤销
- [ ] Termux boot 脚本（~/.termux/boot）与 KernelSU service.d 双保险，重启实测
- [ ] 抖音深度逆向（jadx 反编译 / frida hook / mitmproxy 抓包）未开始

---

## 13. 参考链接

- 详细排障笔记：`docs/book/12-设备定制与Framework/07-一加AcePro-环境搭建与排障.md`
- 手机数字分身设计：`docs/agent/system/phone-digital-twin-agent.md`
- 反检测 skill：`android-root-integration`
- Cloudflare 隧道 skill：`android-cloudflare-tunnel-ssh`
- Termux 还原 skill：`android-ssh-env-restore`
- 设备工具编排 skill：`android-device-tool-orchestrator`