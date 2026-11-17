#!/usr/bin/env bash
# verify-mcp.sh — 一加手机 MCP 真机自动验证
# 连真机跑全部 MCP 工具，输出 JSON 报告
set -uo pipefail

cd "$(dirname "$0")/.."
SERVER="src/server.js"
OUT_JSON="/tmp/oneplus-mcp-verify.json"
ADB="${ADB_PATH:-/home/master/sourceCode/rk_356x_a12/code/prebuilts/runtime/adb}"
SERIAL="${ONEPLUS_SERIAL:-3902f377}"

echo "=== 一加手机 MCP 真机验证 ==="

# 0. 设备在线检查
$ADB -s "$SERIAL" get-state >/dev/null 2>&1
if [ $? -ne 0 ]; then
  echo "{\"ok\":false,\"error\":\"device offline: $SERIAL\"}" > "$OUT_JSON"
  cat "$OUT_JSON"
  exit 1
fi
echo "[OK] 设备在线: $SERIAL"

# 用 Node 内联 MCP 客户端跑全部工具
node --input-type=module -e '
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["src/server.js"],
  cwd: process.cwd(),
});
const client = new Client({ name: "verify", version: "1.0.0" });
await client.connect(transport);

const results = {};
const call = async (name, args = {}) => {
  try {
    const r = await client.callTool({ name, arguments: args });
    const text = r.content?.[0]?.text || JSON.stringify(r);
    const parsed = JSON.parse(text);
    // device_status 用 online 判断；其余用 ok
    const ok = name === "device_status" ? parsed.online === true : parsed.ok !== false;
    results[name] = { ok, ...parsed };
  } catch (e) {
    results[name] = { ok: false, error: e.message };
  }
};

// 设备通道
await call("device_status");
await call("get_device_info");
await call("get_foreground_app");

// 屏幕捕获
await call("capture_screen", { format: "png" });

// 布局树
await call("get_layout_tree", { save: false });
await call("get_interactive_elements");

// 输入注入（安全：HOME 键 + wake）
await call("press_key", { key: "HOME" });

// 远程共享（启动→状态→停止，短录屏）
const share = await client.callTool({ name: "start_share", arguments: { maxFps: 5, maxSize: 400, record: "/tmp/verify-share.mp4" } });
try { results.start_share = { ok: JSON.parse(share.content[0].text).ok === true }; } catch { results.start_share = { ok: false }; }
await new Promise(r => setTimeout(r, 2000));
const st = await client.callTool({ name: "share_status", arguments: {} });
try { const sp = JSON.parse(st.content[0].text); results.share_status = { ok: sp.active >= 1, active: sp.active }; } catch { results.share_status = { ok: false }; }
await call("stop_share");

// root 深度层
await call("root_check");
await call("ksu_version");
await call("run_root", { cmd: "whoami; echo ROOT_DEEP_OK" });
await call("termux_status");
await call("termux_run", { cmd: "python3 --version 2>&1" });
await call("fs_read", { path: "/system/etc/hosts" });
await call("settings_get", { namespace: "secure", key: "mock_location" });
await call("xposed_status");
await call("xposed_modules");
await call("xposed_hooks");
await call("frida_status");
await call("gps_status");

// SSH 通道（lan 需 adb forward，可能失败属预期）
await call("ssh_check", { channel: "lan" });

await client.close();

// 汇总
const allOk = Object.values(results).every(r => r.ok === true);
const summary = { ok: allOk, timestamp: new Date().toISOString(), results };
console.log("VERIFY_JSON_START");
console.log(JSON.stringify(summary, null, 2));
console.log("VERIFY_JSON_END");
' > /tmp/verify-raw.txt 2>&1

# 提取 JSON
python3 - <<'PYEOF'
import json, re
raw = open('/tmp/verify-raw.txt').read()
m = re.search(r'VERIFY_JSON_START\n(.*?)\nVERIFY_JSON_END', raw, re.S)
if not m:
    print(json.dumps({"ok": False, "error": "no JSON in verify output", "raw_tail": raw[-500:]}, indent=2))
    raise SystemExit(1)
data = json.loads(m.group(1))
print(json.dumps(data, indent=2))
open('/tmp/oneplus-mcp-verify.json', 'w').write(m.group(1))
PYEOF
