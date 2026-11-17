# 网络异常故障速查表（症状 → 根因 → 解法）

> 唯一维护点：本文件。skill `network-proxy-recovery`（SKILL.md）只做路由，细则以本文件为准。
> 用途：用户报"网络有问题"类故障时，AI 先查此表定位，再执行对应步骤。
> 设备：OnePlus PGP110（serial `3902f377`，Android 15 / OxygenOS）
> 全部案例实测于 2026-11-17，证据等级：设备实测（最高级）

---

## 0. 一句话根因图

```
抓包/VPN 调试残留 → 4 层残留
  ① settings 数据库 proxy 键          → 查 `settings list global | grep proxy`
  ② 本地代理端口监听（7890/8080）      → 查 `netstat -tlnp | grep -E '7890|8080'`
  ③ system_server 内存代理缓存         → 查 `logcat NetworkMonitor` 探测是否 8080 ← 最隐蔽
  ④ always_on_vpn_app 残留指向未授权 app → 查 `settings get secure always_on_vpn_app`
  清除顺序：① → ③（哨兵值刷新）→ ④ → ②（force-stop）→ 验证 204
```

---

## 1. 症状速查表（用户的话 → 根因 → 一行解法）

| # | 用户报的现象（表象） | 根因 | 快速解法 | 详细步骤 |
|---|---|---|---|---|
| S1 | "app 都没网络 / 刷不了，但别的能用" | 全局 proxy 键指向死代理 127.0.0.1:8080 | `settings delete global http_proxy` + 哨兵刷新 | §2 ① → §3 A → A2 |
| S2 | **"ping 域名可以，系统提示网络不稳定 / WiFi 带感叹号"** | 内存缓存残留：DB 已删 null，但 system_server 仍用旧 proxy，HTTP 204 探测全失败 → 网络被判未验证 | **写哨兵值再删**（不重启）：`settings put global http_proxy :0` → sleep 3 → `cmd connectivity reevaluate <netId>` → sleep 8 → `settings delete global http_proxy` | §2 ② → §3 判据表 → A2 |
| S3 | **"clashmi 开 VPN 报 install failed, please allow the app to install vpn configuration"** | `always_on_vpn_app=com.nebula.clashmi` 残留，但 app 未获 VPN 授权，Android 15 拒绝建 VPN | `settings delete secure always_on_vpn_app` + `always_on_vpn_lockdown`，再在 app 内正常点连接授权 | §2 ③ → A3 |
| S4 | "只有某个 app（B站）有网，其他都没网" | 该 app 被注入过 pinning bypass / TrustAll hook（抓包时留的 frida 会话），走了系统 libssl 信任 mitm 证书；其他 app 不信任 → TLS 全被拒。frida hook 是进程级的 | 强停该 app（`am force-stop <包名>`）或重启设备，hook 即消失；检查是否还有 frida-server 残留 | 检查 `frida-ps -H 127.0.0.1:27042` 是否还有注入 |
| S5 | "上了 WiFi 但登不了网页（浏览网页转圈）" | 访客/公司 WiFi 需要落地页认证（captive portal） | 打开系统浏览器访问任意 http 网站触发认证页；或手动访问该 WiFi 的认证 URL | §2 辅助查 `dumpsys wifi \| grep -i captive` |
| S6 | "关了 clashmi 但网络还是怪" | clashmi 后台进程未退 + 7890 端口仍监听 | `am force-stop com.nebula.clashmi`，确认 `netstat` 无 7890 | §2 ④ → B |
| S7 | "开了 clashmi 但上不了外网（app 全挂）" | clashmi 被 ColorOS 内存管理强杀（rss 445MB 触发 SCENE_IDLE_RECOVER），VPN 随断 | `dumpsys deviceidle whitelist +com.nebula.clashmi`（加入电池白名单防杀） | §4 案例 C |

---

## 2. 通用排查入口（任何网络故障先跑这 4 条）

```bash
ADB="/mnt/d/Android/sdk/platform-tools/adb.exe -s 3902f377"

# ① 代理键（S1）
$ADB shell settings list global | grep -iE proxy

# ② 内存缓存残留（S2，关键判据）
$ADB logcat -c; $ADB shell "settings get global http_proxy"   # null ≠ 干净！
$ADB shell cmd connectivity reevaluate 105; sleep 8
$ADB logcat -d | grep -E "NetworkMonitor/105.*(PROBE_HTTP|PROBE_HTTPS)" | tail -6
#   ret=204 → 正常；Failed to connect to /127.0.0.1:8080 → 内存缓存残留，走 A2

# ③ always-on VPN（S3）
$ADB shell "settings get secure always_on_vpn_app; settings get secure always_on_vpn_lockdown"

# ④ 端口/进程（S6）
$ADB shell netstat -tlnp 2>/dev/null | grep -E "7890|8080"
$ADB shell ps -A | grep -iE "clash|mitm|frida"
```

网络编号（reevaluate 的参数，105/100/…）从 `dumpsys connectivity | grep "Active default"` 取当前值，不要照抄 105。

## 3. 恢复步骤与判据（决定走哪条路）

### 3.1 判据表（观测 → 结论 → 走向）

| 观测 | 结论 | 走向 |
|---|---|---|
| `settings get global http_proxy` = `127.0.0.1:8080` | 数据库层有残留 | 步骤 A |
| 上面 null，但 logcat 探测 = `Failed to connect to /127.0.0.1:8080` | **内存缓存残留** | **步骤 A2（哨兵值）** |
| logcat 探测 = `ret=204` 且 `validation passed` | 系统网络正常 | 排查应用层/其他 |
| `always_on_vpn_app` 非空 | VPN 冲突 | 步骤 A3 |
| `tun0` 存在 + `ACTIVATE_VPN: allow` + clashmi 进程在 | VPN 正常，问题在节点/订阅 | clashmi app 内查 |
| 设备 ping/curl 直连正常，仅 clashmi 开时挂 | clashmi 被杀 | 案例 C（S7）白名单 |

### 步骤 A：删除系统全局代理键（S1）

```bash
$ADB -s 3902f377 shell settings delete global http_proxy
$ADB -s 3902f377 shell settings delete global global_proxy
$ADB -s 3902f377 shell settings delete global global_proxy_pac
$ADB -s 3902f377 shell settings delete global global_http_proxy_host
$ADB -s 3902f377 shell settings delete global global_http_proxy_port
```

注意：`settings put global xxx ""` 空字符串写入会失败，必须用 `settings delete` 移除键。

### 步骤 A2：⚠ 清理系统内存代理缓存（2026-11-17 实测有效方案）

删除数据库键后，若 logcat 仍见 `Failed to connect to /127.0.0.1:8080`（§2 ②），说明 system_server 的 ProxyTracker 内存缓存未刷新。**不需要重启**，用哨兵值触发 ContentObserver：

```bash
$ADB -s 3902f377 shell "settings put global http_proxy :0"   # 写哨兵值 → 系统收到变更通知，缓存刷新
sleep 3
$ADB -s 3902f377 shell "cmd connectivity reevaluate 105"     # 触发重新验证（105 换成实际 netId）
sleep 8
$ADB -s 3902f377 shell "settings delete global http_proxy"   # 删掉哨兵，恢复 null
# 验证：logcat 出现 PROBE_HTTP ret=204 + ConnectivityService "validation passed"
```

关键点：
- `:0` 是 Android settings 哨兵值（"无代理"），不会真的建连接
- `settings delete` 不产生变更通知（ContentObserver 不触发）→ 缓存不会刷新，这正是坑所在
- 顺序必须是 写哨兵 → 等 3s → 删哨兵，颠倒无效

### 步骤 A3：清理 always-on VPN 残留（S3）

```bash
$ADB -s 3902f377 shell "settings delete secure always_on_vpn_app"
$ADB -s 3902f377 shell "settings delete secure always_on_vpn_lockdown"
```

之后在 clashmi App 内重新点"启动/连接"，正常授权即可。注意：永远不要用 `am start -a android.net.VpnService` 触发授权——VpnService 是 Service 不是 Activity，必然报 `unable to resolve`；授权由 VPN app 自己调用 `VpnService.prepare()` 完成。

### 步骤 B：停止代理/VPN 进程（S6）

```bash
$ADB -s 3902f377 shell am force-stop com.nebula.clashmi
```

如有其他代理 App（Charles、Fiddler、其他 VPN），按包名同样 `am force-stop <包名>`。

---

## 4. 三个经典案例（完整对照）

### 案例 A：全 App 无网（残留代理键）
- 表象：抖音/淘宝全部"无网络"
- 根因：`global_http_proxy_host=127.0.0.1` + `port=8080` + clashmi 7890 端口残留
- 解法：删 4 个 proxy 键 + force-stop clashmi → curl baidu/taobao 200 ✓

### 案例 B：ping 通但"网络不稳定"（内存缓存 + always-on VPN）← 最隐蔽
- 表象：ping 域名通，但 WiFi 图标感叹号，系统提示网络不稳定；clashmi 报 install failed
- 根因：
  1. `settings delete` 只删 DB，**ProxyTracker 内存缓存仍持 127.0.0.1:8080**，204 探测全失败 → 网络未验证
  2. `always_on_vpn_app=com.nebula.clashmi`（未授权）残留 → VPN 拒绝建立
- 解法：
  ```bash
  settings put global http_proxy :0        # 哨兵值触发刷新
  sleep 3; cmd connectivity reevaluate 105; sleep 8
  settings delete global http_proxy
  settings delete secure always_on_vpn_app
  settings delete secure always_on_vpn_lockdown
  ```
- 验证：`PROBE_HTTP ret=204` + `ConnectivityService: validation passed` + `+IS_VALIDATED` ✓

### 案例 C：clashmi 开了但外网挂（ColorOS 杀后台）
- 表象：开代理后能连上但很快断，app 外网全挂
- 根因：clashmi rss 445MB，ColorOS `SCENE_IDLE_RECOVER`（内存压力场景）强杀进程，VPN 随断
- 解法：`dumpsys deviceidle whitelist +com.nebula.clashmi`（加入电池优化白名单）
- 验证：clashmi 长时间存活，tun0 保持 ✓

---

## 5. 修复后验证清单（全部满足才算解决）

- [ ] `settings list global | grep proxy` 只剩 exclusion_list / pac_url（或空）
- [ ] `logcat NetworkMonitor` 探测 `ret=204`，`ConnectivityService: validation passed`
- [ ] `dumpsys wifi` → `isValidated=true`，WiFi 图标无感叹号
- [ ] `settings get secure always_on_vpn_app` = null
- [ ] `netstat` 无 7890/8080 监听
- [ ] 设备上打开浏览器/常用 app 实测可联网（设备实测为最高证据等级）

---

## 6. 防复发规则（给 AI 的铁律）

1. **抓包/代理调试结束时必做清理**：force-stop 代理 app → 删 proxy 键 → **哨兵值刷新（A2）** → 验证 `ret=204`。只删不验证 = 没删干净（案例 B 的坑）。
2. **永远不要用 `am start -a android.net.VpnService` 触发授权** —— VpnService 是 Service 不是 Activity，必然报 `unable to resolve`，正确做法是让 VPN app 自己调用 `VpnService.prepare()`。
3. **`settings get` 返回 null ≠ 系统在用 null**：判断系统真实代理必须看 `logcat NetworkMonitor` 的探测目标（本例全部指向 127.0.0.1:8080）。
4. **settings delete 不触发 ContentObserver** → 内存缓存不刷新；必须 `put` 哨兵值再 `delete`。
5. **clashmi 场景先查电池白名单**（S7），ColorOS 内存管理会杀 rss > 400MB 的 VPN app。