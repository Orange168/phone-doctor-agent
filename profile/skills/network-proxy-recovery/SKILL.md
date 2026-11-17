---
name: network-proxy-recovery
description: 手机 App 无网络/网络超时时，排查并清理残留的系统全局代理、内存代理缓存与 always-on VPN（Clash Mi 等），恢复直连上网
model: tmp-flash
trigger: manual
---

# 网络代理恢复技能（App 无网排查 SOP）

> 唯一维护点：`docs/troubleshooting/network-issues-quickref.md`（症状速查表 + 排查/恢复步骤 + 判据 + 案例 + 防复发铁律）。本文件只做路由，细则不在此重复。

## 触发条件

- 设备 ping/curl 底层网络通，但 App（抖音、淘宝、微信等）提示"无网络"或请求超时
- ping 域名正常但系统提示"网络不稳定" / WiFi 图标带感叹号
- clashmi 等 VPN/代理 App 启动报 "install failed, please allow VPN configuration"
- 刚取消过抓包代理（Charles/Fiddler/mitmproxy/Clash 等）或关闭过 VPN
- 设备 serial 当前为 `3902f377`（OnePlus PGP110）

## 根因四层（按隐蔽度递增）

1. settings 数据库 proxy 键残留（`http_proxy=127.0.0.1:8080` 等）
2. 本地代理端口仍监听（7890/8080）
3. **system_server 内存代理缓存残留**——`settings delete` 只删 DB，ContentObserver 不触发缓存刷新；`settings get` 显示 null ≠ 系统在用 null
4. `always_on_vpn_app` 指向未授权 app → VPN 拒绝建立

## 路由表（症状 → 去向）

| 症状 | 去向 |
|---|---|
| 全 App 无网 / 刷不了 | quickref §1 S1 + §2 跑 4 条 + §3 步骤 A → A2 → B |
| ping 通但"网络不稳定"（WiFi 感叹号） | quickref §1 S2 + §3 判据表 → **A2 哨兵值刷新** |
| clashmi 报 install failed / VPN 建不起来 | quickref §1 S3 + §3 判据表 → **A3** |
| clashmi 开了但外网很快挂 | quickref §4 案例 C（ColorOS 杀后台，加电池白名单） |
| 关了代理仍怪 / 端口残留 | quickref §1 S6 + §2 步骤 ④ + §3 步骤 B |
| 只有个别 app 有网（frida hook 残留） | quickref §1 S4 |

## 两条铁律（违反必返工）

- 删代理键后**必须**按 quickref §5 验证 `ret=204` + `validation passed`，只删不验证 = 没删干净
- 永远不用 `am start -a android.net.VpnService` 触发授权（Service 不是 Activity，必然报 unable to resolve）；让 VPN app 自己 `VpnService.prepare()`

## 证据等级

- 静态/设置结论（`settings list` 有代理键）：A0
- 端口监听结论（`netstat` 7890/8080）：A0
- 恢复验证（logcat `ret=204` + `validation passed` + 浏览器实测）：设备实测，最高等级