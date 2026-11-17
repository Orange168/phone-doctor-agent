# 一加 Ace Pro (PGP110) 环境清单

> 当前环境实测状态（2026-09-02 复核）
> 用途：手机数字分身实验台（root + 反检测 + 逆向 + 自动化 + 外网访问）

## 一、设备基线

| 项 | 值 | 验证命令 |
|---|---|---|
| 型号 | 一加 PGP110（Ace Pro / 10T） | `getprop ro.product.model` |
| 系统 | Android 15 (SDK 35) / OxygenOS | `getprop ro.build.version.release` |
| 指纹 | `OnePlus/PGP110/OP5551L1:15/AP3A.240617.008/S.21c020d_2_1:user/release-keys` | |
| 内核 | 5.10.236-android12-9-o-g1a59416f721e（GKI） | `uname -r` |
| 序列号 | 3902f377 | `getprop ro.serialno` |
| 内存/存储 | 16GB / 224G（data 用 18G） | `/proc/meminfo` / `df -h` |
| 屏幕 | 1080×2412 @ 480dpi | `wm size; wm density` |
| SELinux | Enforcing | `getenforce` |
| AVB | green / locked / locked | `getprop ro.boot.verifiedbootstate` |

## 二、Root 栈（已验证工作）

| 组件 | 版本 | 状态 |
|---|---|---|
| **KernelSU** | v3.2.5 (32525) | ✅ LKM 模块，`/data/adb/ksud` |
| root 能力 | `su -c id` → `u:r:ksu:s0` | ✅ |
| **版本匹配** | 内核 32525 = Manager 32525 = ksud 3.2.5 | ✅ 已修复 |

> ⚠️ 铁律：KernelSU 三件套（内核+ksud+Manager）版本必须一致。**不要单独升级 Manager**，否则报"版本不匹配"。要升级需重编内核三件套一起升。

## 三、反检测栈（全绿）

| 组件 | 版本 | 作用 |
|---|---|---|
| Zygisk Next | **1.5.0 (843)** | memfd 匿名注入，不留文件路径 |
| HMA-OSS | oss-166 | Hide My Applist（隐藏应用列表） |
| Tricky Store | v6.0.0-235 | AVB 密钥伪造（keybox + boot_hash/key） |
| Violet | v1.4 | 附加隐藏模块 |
| PathMask | 2.5.0 | 路径遮罩（内核模块 pathmask） |
| 自动救砖 | v221204 | bootloop 自愈 |
| Momo | v4.4.1 | 检测验收（已装） |
| Hunter | 6.65 | 检测验收（已装） |

**验收标准**：Hunter 报 `ZYGISK NOT DETECTED - msg: 0` = 反检测成功。

## 四、运行中服务（实测）

| 服务 | 进程 | 端口 | 说明 |
|---|---|---|---|
| frida-server | root PID 运行 | — | /data/adb/frida-server，自启 service.d |
| cloudflared | root PID 运行 | — | CF 隧道，root+setsid，service.d 自启 |
| Termux sshd | u0_a355 | **8022** | 外网/局域网 SSH 入口 |

> ⚠️ 重启后 Termux sshd 的 boot 自启**不保证生效**（termux-boot 广播时序），需手动拉起：
> `adb -s 3902f377 shell 'su u0_a355 -c "PREFIX=...; export ...; \$PREFIX/bin/sshd"'`
> （frida/cloudflared 走 KernelSU service.d，相对可靠，但重启后建议实测）

## 五、SSH 通道（全部可用）

| 别名 | 目标 | 方式 | 状态 |
|---|---|---|---|
| `ssh cf-op` | 一加 Termux | 外网 `op.linzhi.eu.cc` (CF 隧道) | ✅ |
| `ssh op_` | 一加 Termux | 局域网 `adb forward 8022` | ✅ |
| `ssh cf-root` / `cf-dev` | RK3568 | 外网域名（原有） | ✅ |
| `ssh dev` / `dev_` | RK3568 | 局域网（原有） | ✅ |

**前提**：
- `cf-op`：cloudflared 隧道在线 + 本机 `/root/.local/bin/cloudflared`
- `op_`：先 `adb -s 3902f377 forward tcp:8022 tcp:8022`（adb 重连后需重建）

## 六、Termux (ZeroTermux) 环境

| 项 | 值 |
|---|---|
| 版本 | ZeroTermux v0.118.3.64（包名 com.termux） |
| 来源 | 官方 GitHub `hanxinhao000/ZeroTermux` |
| proot | 5.1.107.92 |
| QEMU | 11.0.3 (i386/ppc/x86_64) |
| OpenSSH | 10.5p1 |
| 容器 | **Ubuntu 18.04** (216MB) + **Alpine 3.24** (17MB) |

### 已装工具（Termux 用户 u0_a355）
`sshd / proot / cloudflared / htop 3.5.3 / git 2.55 / socat 1.8.1 / lsof / filan / procan`

### ⚠️ 预装工具属主修复记录
ZeroTermux 预装工具（htop/socat/filan/procan）原属主 root:root 权限 700 → 已 `chown u0_a355:u0_a355` 修复。

## 七、Termux pkg 安装（DNS 死结解法）

**问题**：Termux SSH 会话（ksu 域）的进程 DNS 解析失效 → `pkg/apt` 全 bad。
**根因**：`su u0_a355` 产生 uid=app + domain=ksu 混合进程，Android netd 拒绝其 DNS（root 正常，Termux app 前台正常）。

**万能包装器** `/data/local/tmp/termux-pkg.sh`（以 root 跑）：
```sh
# 原理: proot -i 1000:1000 伪装 uid 1000(非root) → apt 不拒绝; 网络走 root 上下文 → DNS 正常
sh /data/local/tmp/termux-pkg.sh update
sh /data/local/tmp/termux-pkg.sh install nmap
sh /data/local/tmp/termux-pkg.sh install python3
```

## 八、Cloudflare 外网隧道

| 项 | 值 |
|---|---|
| 域名 | `op.linzhi.eu.cc` → 一加 Termux 8022 |
| 隧道 | ssh-op（healthy，多边缘连接） |
| 运行 token | `/root/.cloudflared-tokens/op.token`（本机）+ 设备 `~/cf/op.token` |
| 设备二进制 | cloudflared 2026.8.2（Termux 版，从 RK3568 拷贝） |
| 自启 | `/data/adb/service.d/cf-tunnel.sh`（root+setsid） |

## 九、本机（WSL）工具链

| 工具 | 版本 | 用途 | 备注 |
|---|---|---|---|
| frida / frida-tools | 16.7.19 | 动态 hook | 17.x 需 Python 3.11+，本机 3.10 用 16.x |
| frida-server | 16.7.19 | 设备端注入 | 与 frida 版本必须一致 |
| objection | 1.12.5 | frida 快捷 | |
| jadx | 1.5.6 | APK 反编译 | |
| apktool | 2.5.0 | APK 解包 | |
| mitmproxy | 11.0.2 | HTTPS 抓包 | |
| scrcpy | 4.1 | 投屏 | 需 `export ADB=/usr/bin/adb` |
| sqlite3 | 3.37.2 | 数据库 | |
| cloudflared | 2026.5.1 | CF 客户端 | access ssh 用 |
| adb | AOSP v41 | 设备控制 | 用 `/home/master/sourceCode/rk_356x_a12/code/prebuilts/runtime/adb` |

## 十、常用操作速查

```bash
# 设备
adb -s 3902f377 shell 'su -c id'                    # root
adb -s 3902f377 shell 'su -c "/data/adb/ksud -V"'   # ksud 版本

# SSH
adb -s 3902f377 forward tcp:8022 tcp:8022           # 建局域网通道
ssh op_                                             # 局域网 Termux
ssh cf-op                                           # 外网 Termux

# 装包（DNS 死结绕过）
adb -s 3902f377 shell 'su -c "sh /data/local/tmp/termux-pkg.sh install nmap"'

# 容器
adb -s 3902f377 shell "su -c '... proot -0 -r <rootfs> ...'"   # 见笔记 07

# 反检测验证
adb -s 3902f377 shell 'am start -n com.zhenxi.hunter/.MainActivity'
# 看 logcat: ZYGISK NOT DETECTED

# 目标 App
adb -s 3902f377 shell 'am start -n com.ss.android.ugc.aweme/.main.MainActivity'
```

## 十一、目标 App（已装）

| App | 包名 | 版本 |
|---|---|---|
| 抖音 | com.ss.android.ugc.aweme | 17.6.2 |
| 淘宝 | com.taobao.taobao | 已装 |
| KernelSU | me.weishu.kernelsu | v3.2.5 |
| Hunter | com.zhenxi.hunter | 6.65 |
| Momo | io.github.vvb2060.mahoshojo | 4.4.1 |

## 十二、已知问题 / 待办

- [ ] 重启后 Termux sshd 需手动拉起（boot 自启时序不可靠）
- [ ] 重启后 frida-server / cloudflared 自启需实测（service.d）
- [ ] jadx 报 JNI error（JDK 环境问题，重装或设 JAVA_HOME）
- [ ] Cloudflare API token 用完建议撤销
- [ ] nmap 未装（可用 termux-pkg.sh 装）