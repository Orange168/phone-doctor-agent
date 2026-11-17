#!/usr/bin/env bash
# verify-offline.sh — 一加手机 MCP 无设备结构验证
# 无真机时：语法检查 + 模块加载 + MCP 工具发现 + 布局解析单元测试
set -uo pipefail

cd "$(dirname "$0")/.."
OUT_JSON="/tmp/oneplus-mcp-offline.json"
PASS=0
FAIL=0

echo "=== 一加手机 MCP 离线结构验证 ==="

# 1. 语法检查
SYNTAX_OK=1
for f in src/*.js; do
  if ! node --check "$f" 2>/dev/null; then
    echo "[FAIL] 语法: $f"
    SYNTAX_OK=0
    FAIL=$((FAIL+1))
  fi
done
if [ $SYNTAX_OK -eq 1 ]; then echo "[OK] 语法检查全部通过"; PASS=$((PASS+1)); fi

# 2. 模块加载
MOD_OK=$(node --input-type=module -e "
import('./src/config.js').then(() => import('./src/adb.js')).then(() => import('./src/input.js')).then(() => import('./src/layout.js')).then(() => import('./src/device.js')).then(() => import('./src/screen.js')).then(() => import('./src/scrcpy.js')).then(() => import('./src/ssh.js')).then(() => { console.log('OK'); }).catch(e => { console.error('FAIL', e.message); process.exit(1); });
" 2>&1)
if [ "$MOD_OK" = "OK" ]; then echo "[OK] 模块加载"; PASS=$((PASS+1)); else echo "[FAIL] 模块加载: $MOD_OK"; FAIL=$((FAIL+1)); fi

# 3. MCP 工具发现（63 个工具）
TOOLS=$(node --input-type=module -e "
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const t = new StdioClientTransport({ command: process.execPath, args: ['src/server.js'], cwd: process.cwd() });
const c = new Client({ name: 'offline', version: '1.0.0' });
await c.connect(t);
const tools = await c.listTools();
console.log(tools.tools.length);
await c.close();
" 2>/dev/null | tail -1)
if [ "$TOOLS" = "63" ]; then echo "[OK] MCP 工具发现: 63"; PASS=$((PASS+1)); else echo "[FAIL] MCP 工具发现: got '$TOOLS' (expect 63)"; FAIL=$((FAIL+1)); fi

# 4. 布局解析单元测试（模拟 XML）
LAYOUT=$(node --input-type=module -e "
import { parseXmlSimple, simplifyNode, extractInteractive } from './src/layout.js';
const xml = \`<hierarchy><node index='0' text='' resource-id='' class='android.widget.FrameLayout' bounds='[0,0][1080,2412]' clickable='false' focusable='false'><node index='1' text='Hello' resource-id='com.example:id/t' class='android.widget.TextView' bounds='[50,200][500,300]' clickable='false' focusable='false'/><node index='2' text='' resource-id='com.example:id/b' class='android.widget.Button' content-desc='Click' bounds='[50,400][400,520]' clickable='true' focusable='true'/></node></hierarchy>\`;
const root = parseXmlSimple(xml);
const tree = simplifyNode(root);
const inter = extractInteractive({ok:true, tree});
console.log(JSON.stringify({rootTag: root.tag, children: tree.children.length, interactive: inter.count}));
" 2>&1 | tail -1)
echo "[INFO] 布局单元测试: $LAYOUT"
if echo "$LAYOUT" | grep -q '"interactive":1'; then echo "[OK] 布局解析"; PASS=$((PASS+1)); else echo "[FAIL] 布局解析: $LAYOUT"; FAIL=$((FAIL+1)); fi

# 汇总
cat > "$OUT_JSON" <<EOF
{
  "ok": $([ $FAIL -eq 0 ] && echo true || echo false),
  "pass": $PASS,
  "fail": $FAIL,
  "timestamp": "$(date -Iseconds)"
}
EOF
echo ""
echo "=== 结果: PASS=$PASS FAIL=$FAIL ==="
cat "$OUT_JSON"
[ $FAIL -eq 0 ] && exit 0 || exit 1
