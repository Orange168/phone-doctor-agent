# 抖音检测面实战清单（douyin-detection-map）

> 状态：M3 逆向对抗实战数据（2026-11-17）
> 逆向对象：抖音 17.6.2（旧版）→ 41.1.0（新版，365MB / 57 dex / 268 so）
> 设备：OnePlus PGP110（serial 3902f377，KernelSU root，frida-server 16.7.19）
> 证据等级：L1 静态（jadx/Ghidra/readelf）+ L2 动态（frida hook 实测 + mitmproxy 抓包）
> 原始产物：`/home/master/reverse/douyin/`（不进本仓库，见 §七 证据索引）

本文件回答数字分身的核心问题：**抖音到底检测什么，我们怎么精准模拟/对抗，什么不用防**。

---

## 一、版本差异（为什么重新逆向）

| 项 | 旧版 17.6.2 | 新版 41.1.0 |
|---|---|---|
| APK | 70MB / 14 dex / 7 so | 365MB / 57 dex / 268 so |
| libmetasec_ml.so | 运行时下发（检测真身） | **APK 内置**（3.5MB） |
| libsscronet.so | 运行时下发 | **APK 内置**（5.1MB，cronet 网络栈） |
| libttboringssl.so | 运行时下发 | **APK 内置**（367KB，字节自研 BoringSSL） |
| 检测强度 | frida spawn 存活 80s+ | spawn 存活，但 native pinning 更强 |

新版把检测真身（metasec）和网络栈（cronet/boringssl）全部内置 → **静态分析可行性大增**，不再依赖运行时 pull。

---

## 二、检测面清单（七维度，全部有证据）

### 2.1 root 痕迹检测

| 检测项 | 证据 | 对抗手段 |
|---|---|---|
| `su_kpbs_daemon`（KernelSU 专属进程名） | L1：libmetasec_ml 字符串 | Susfs 内核隐藏 / 进程名伪造 |
| su 二进制路径（8 个常见路径） | L1：路径字符串枚举 | Susfs / 路径重定向 |
| `ro.secure` / `ro.debuggable` | L2：frida hook __system_property_read 命中 | resetprop（仅目标进程命名空间） |
| Xposed / Magisk 包名（7 个） | L1：包名字符串 | 隐藏列表 |
| Substrate / hook 框架 maps 特征 | L1：libbytehook PLT 防护 + maps 扫描 | Susfs maps 伪造 |

### 2.2 系统属性读取（34 个 key，L2 实测）

frida hook `__system_property_read` dump 出 metasec 全量读取的 33 个 key：

```
ro.product.*（brand/device/model/manufacturer/name）
ro.build.*（fingerprint/id/tags/type/user/host）
ro.serialno / ro.boot.serialno / ro.bootloader
ro.hardware / ro.board.platform / soc.manufacturer / soc.model
persist.*（sys.timezone / locale / usb.*）
wifi.interface / gsm.version.baseband / ril.* 等
```

**对抗**：resetprop 精确改这 33 个 key（只改目标 app 看到的，不全局改——全局改会破坏系统）。

### 2.3 网络检测

| 检测项 | 证据 | 对抗 |
|---|---|---|
| netlink 路由/网卡枚举（tun0/ppp0 等 VPN 特征） | L2：hook `sendmsg`/`recvmsg` 命中 netlink socket，函数替换 ret=0 后抖音正常 | 关闭 VPN 或伪造 netlink 响应 |
| getaddrinfo DNS 查询明文 | L2：hook 捕获 `vcl-brain.ndcpp.com`、`127.0.0.1` 等查询 | 域名白名单/伪造 DNS |
| /proc/net 解析 | L1：so 内字符串 | 伪造只读文件 |

### 2.4 调试与注入检测

| 检测项 | 证据 | 对抗 |
|---|---|---|
| frida 默认端口 27042 探测 | L1（frida-server 检测类） | frida 改端口 + gadget 模式 |
| fork 看门狗（反调试） | L1：libc fork + waitpid 监控 | 不 attach，spawn-only |
| PLT hook 防护（libbytehook） | L1：so 依赖 | 不 hook 被监控函数 |
| 进程 maps 扫描（Substrate 特征） | L1 | Susfs |

**关键结论（实测）**：frida attach 抖音必触发自杀（进程 3s 内退出）；**spawn 模式（`frida -f`）可存活**。这是抖音对抗的基线事实，任何动态分析必须 spawn-only。

### 2.5 SIM / USB / 传感器

| 检测项 | 证据 | 对抗 |
|---|---|---|
| SIM 卡状态（hasSimCard 聚合判定） | L1：telephony 相关调用 | 真实插卡或伪造 |
| USB 充电状态（isUsbCharging） | L1 | 状态模拟 |
| 传感器读数真实性（长期不动/无变化 = 模拟器） | L1：传感器相关逻辑 | **内核级真实数据回放**（数据飞轮） |

### 2.6 模拟器 / 虚拟环境

检测特征字符串（L1 实测）：`vbox86` / `droid4x` / `noxd` / `qemud` / `microvirtd` / `xxkmsg` / `io.va.exposed` 等 → 真机 + Susfs 天然规避。

### 2.7 不检测/拿不到的（不用防）

- 基站 Cell ID / 信号强度（Android 10+ 权限限制，第三方 app 拿不到）
- 全局触摸事件（需 root/无障碍）

---

## 三、SSL Pinning 结构（新版 41.1.0 实测）

抖音的 TLS 信任链**分两层 + 一个独立域**：

```
┌─────────────────────────────────────────────────────┐
│ Java 层：OkHttp / Conscrypt（系统 TLS）              │
│   → hook SSLContext.init TrustAll + CertificatePinner│
│   → 已绕过 ✅（业务 API 解密成功）                     │
├─────────────────────────────────────────────────────┤
│ Native 层：libttboringssl.so（字节自研 BoringSSL）    │
│   → SSL_set_custom_verify @0x149db8 仅存回调指针      │
│     （SSL_CTX+0xe8 = mode, +0x30 = callback）        │
│   → hook 回调强返 0（ssl_verify_ok）→ 已绕过 ✅      │
├─────────────────────────────────────────────────────┤
│ 独立域：mssdk3-normal-hj.zijieapi.com（风控上报）     │
│   → libmetasec_ml.so 自带 TLS 实现                   │
│   → 147 个 UND 符号无 SSL_*（只有 connect/sendto/    │
│     recvfrom）→ 不经过 libttboringssl ❌ frida 无效   │
│   → 需 hook metasec 内部 connect/sendto 或静态分析    │
└─────────────────────────────────────────────────────┘
```

### Ghidra 反编译证据（libttboringssl.so）

```c
// SSL_set_custom_verify @0x149db8 — 只存回调，不做校验
void SSL_set_custom_verify(long ssl, undefined1 mode, undefined8 callback)
{
  long ctx = *(long *)(ssl + 8);
  if (ctx != 0) {
    *(undefined1 *)(ctx + 0xe8) = mode;      // 验证模式
    *(undefined8 *)(ctx + 0x30) = callback;  // 回调指针
  }
}

// SSL_get_verify_result @0x150834 — 返回 session 存的验证结果
long SSL_get_verify_result(SSL *ssl)
{
  SSL_SESSION *s = SSL_get_session(ssl);
  if (s == NULL) return 0x41;               // 失败
  return *(long *)(s + 0x28);               // 存储的结果
}
```

**绕过原理**：hook `SSL_set_custom_verify` 的 callback 参数，替换为永远返回 `ssl_verify_ok(0)` 的 NativeCallback → 业务主 API 全部解密成功（实测 740 连接，tnc/mon/snssdk/api5 全 200 OK）。

---

## 四、对数字分身的行动映射

| 检测面 | 数字分身对抗动作 | 状态 |
|---|---|---|
| root 痕迹 | Susfs 内核隐藏（su_kpbs_daemon 等进程名） | ⬜ 待部署验证 |
| 34 个 sysprop | resetprop 按清单精确改（仅目标 app 命名空间） | ⬜ 清单已有 |
| netlink/VPN | 不用 VPN 或伪造 netlink 响应 | ⬜ |
| frida 检测 | spawn-only（attach 必自杀）+ 端口改非 27042 | ✅ 基线确认 |
| native pinning | frida hook SSL_set_custom_verify 回调（已验证） | ✅ 脚本就绪 |
| mssdk3 风控域 | hook metasec connect/sendto（未攻克，见 §六） | ⬜ 待攻坚 |
| 传感器真实性 | 内核级真实数据回放（数据飞轮） | ⬜ |
| 行为特征 | 拟人化执行（点击轨迹/频率/时序） | ⬜ 数据飞轮 |

---

## 五、可复用技能

| 技能 | 位置 | 内容 |
|---|---|---|
| frida SSL pinning 绕过 | `profile/skills/frida-ssl-bypass/` | 三层 hook 脚本 + spawn-only 基线 + 抓包链路 |
| adb 通道冲突恢复 | `profile/skills/adb-channel-recovery/` | QtScrcpy/其他 adb 抢占 5037 的检测与恢复 |

原始 hook 脚本（可复制使用）：`/home/master/reverse/douyin/scripts/`
- `hook-pinning2.js`：Java 层（TrustAll + OkHttp + libssl）
- `hook-native-pinning3.js`：native 层（libttboringssl SSL_set_custom_verify → accept，去重版）
- `hook-capture.js`：sysprop dump + netlink 强返 0 + getaddrinfo 捕获

---

## 六、遗留问题

1. **mssdk3 风控域未攻克**：libmetasec_ml 自带 TLS（无 SSL_* UND），frida hook libttboringssl 无效。需要：
   - 方案 A：hook metasec 的 `connect`/`sendto`（UND 符号存在）拦截 TLS 前流量
   - 方案 B：Ghidra 静态分析 libmetasec_ml（3.5MB）的证书校验函数
2. **X509_verify_cert 反编译为 bad instruction data**（`0x15ac60`/`0x166b20`），疑似代码混淆，需手动汇编分析
3. frida hook 只覆盖了 libssl/libttboringssl；抖音若还有第三套网络栈（如系统 cronet）未确认

---

## 七、证据索引（原始产物，不进本仓库）

| 证据 | 路径 |
|---|---|
| 新版 APK（41.1.0） | `/home/master/reverse/douyin/apk/aweme-new.apk` |
| 抓包（845KB，业务 API 全解密） | `/home/reverse/douyin/mitmproxy/capture-new-150725.mitm` |
| Pinning 函数反编译 | `/home/master/reverse/douyin/reports/boringssl-pin-final.txt` |
| 完整逆向报告 | `/home/master/reverse/douyin/reports/NEW-41.1.0-REPORT.md` |
| metasec hook 日志（33 sysprop dump） | `/home/master/reverse/douyin/reports/hook-logs/` |
| jadx 全量反编译（61315 Java） | `/home/master/reverse/douyin/jadx/` |