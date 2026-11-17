---
name: frida-ssl-bypass
description: 对目标 App 执行 SSL pinning 绕过并抓包 — 三层 hook（Java/native/binary patch）+ spawn-only 注入 + mitmproxy 抓包链路。用于管家需要分析目标 App 网络行为（接口清单/风控上报/指纹字段）时
model: tmp
trigger: user_task
---

# frida SSL pinning 绕过与抓包技能

## 目标

对设备上的目标 App（如抖音）绕过 SSL pinning，用 mitmproxy 解密其 HTTPS 流量，提取接口清单与指纹字段。

## 前置条件

- 设备已 root（KernelSU/Magisk）+ frida-server 在 `/data/local/tmp/`
- WSL 侧：frida CLI、mitmproxy 已装
- adb 通道正常（连不上时先走 `adb-channel-recovery` 技能）

## 执行步骤

### 1. 建立通道

```bash
ADB="/mnt/d/Android/sdk/platform-tools/adb.exe -s <serial>"
$ADB forward tcp:27042 tcp:27042     # frida 端口
$ADB reverse tcp:8080 tcp:8080       # 代理回传（绕开 WiFi 防火墙）
$ADB shell "settings put global http_proxy 127.0.0.1:8080"
$ADB shell "su -c 'nohup /data/local/tmp/frida-server >/dev/null 2>&1 &'"
```

### 2. 证书注入（系统 CA 目录）

```bash
# mitmproxy CA 转 PEM 并算 hash
openssl x509 -inform PEM -subject_hash_old -in ~/.mitmproxy/mitmproxy-ca-cert.pem | head -1
# 如 c8750f0d
$ADB shell "su -c 'mount -o bind /system/etc/security/cacerts /system/etc/security/cacerts'"
# 或逐个 bind 证书文件（release 版 /system 只读时）
```

### 3. spawn 注入（红线：禁止 attach）

```bash
# ✅ 正确：spawn 模式，抖音可存活
frida -H 127.0.0.1:27042 -f com.ss.android.ugc.aweme -l scripts/hook-pinning2.js -l scripts/hook-native-pinning3.js

# ❌ 错误：attach 模式必触发抖音自杀（实测 3s 内退出）
frida -H 127.0.0.1:27042 -n com.ss.android.ugc.aweme -l ...
```

### 4. 三层 hook（按顺序加载）

| 层 | 脚本要点 | 作用 |
|---|---|---|
| Java | `Java.perform`：SSLContext.init 注入 TrustAll；OkHttp CertificatePinner 三方法 no-op | 系统 TLS + OkHttp |
| Native | 枚举模块找 `SSL_set_custom_verify`/`SSL_get_verify_result`，hook 回调强返 0（`ssl_verify_ok`）；**全局去重 flag 防重复 attach** | libttboringssl（字节自研）等 |
| Capture | `__system_property_read` 过滤 dump；`getaddrinfo` onLeave 读 hostent 拿明文域名；netlink `sendmsg` 强返 0 | 证据采集 + 反检测绕过 |

**关键实现细节**（抖音实测）：
- hook 时机：libttboringssl 启动 4-6s 后才加载，需延迟重试（每 2s，最多 30 次）
- `SSL_set_custom_verify` 只是存回调（ctx+0xe8 mode / ctx+0x30 callback），真正校验在回调里 → 替换回调为 `return 0` 即可
- 去重：JS 对象记 `module!function`，已 hook 的不再 attach（否则会 hook 十几次）
- 代理设 `127.0.0.1:8080`（经 adb reverse），不要设局域网 IP（设备侧连不到）

### 5. 抓包与提取

```bash
# mitmproxy 后台
mitmdump -p 8080 -w capture-$(date +%H%M%S).mitm

# 提取请求 URL
mitmdump -nr capture-*.mitm --set flow_detail=3 | grep -oE "(GET|POST) https://[^/]+/[^ ]*" | sort | uniq -c

# 提取域名分布
grep -oE "server connect [a-z0-9.-]+" mitmdump.log | awk '{print $3}' | sort | uniq -c | sort -rn
```

## 失败模式与对策

| 现象 | 根因 | 对策 |
|---|---|---|
| 抖音进程 3s 内消失 | attach 触发反调试 | 改 spawn `-f` |
| `Failed to spawn: timed out` | 设备锁屏（keyguard） | 先 `input keyevent KEYCODE_WAKEUP` + 上滑解锁 |
| 业务域名 TLS `certificate unknown` | 该域走独立 TLS 栈（如 metasec 风控），hook 无效 | hook 该 so 的 connect/sendto，或放弃该域（业务 API 已够） |
| mitm 日志无新流量 | mitmproxy 挂了 | `ss -tlnp \| grep 8080` 确认监听，挂了重启 |
| `Client TLS handshake failed` 但业务成功 | 客户端主动断开重连（正常） | 忽略，看 server connect 数量 |
| frida 连不上 27042 | frida-server 挂了 | 重启 frida-server 再 forward |

## 产出标准

- 抓包文件（.mitm）+ mitmdump.log 留在产物目录
- 接口清单：域名 → 次数 → 用途，200 OK 才算解密成功
- 检测面证据（sysprop dump / netlink 行为）落盘到 reports/hook-logs/
- 不搬原始 APK/so 进仓库（几百 MB），只留路径索引

## 参考

- 完整实测案例：`phone-doctor-agent/docs/douyin-detection-map.md`（抖音 41.1.0）
- 原始脚本：`/home/master/reverse/douyin/scripts/hook-pinning2.js`、`hook-native-pinning3.js`、`hook-capture.js`