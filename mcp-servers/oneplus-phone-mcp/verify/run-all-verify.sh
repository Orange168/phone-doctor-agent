#!/bin/bash
# run-all-verify.sh - 一键运行全部场景验收脚本
# 用法：./run-all-verify.sh [输出目录]
# 输出：每个场景一个 JSON 报告，控制台汇总 pass/fail

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${1:-$SCRIPT_DIR/reports}"
mkdir -p "$OUT_DIR"

echo "============================================"
echo "  OnePlus 数字分身 - 抖音视频场景验收脚本"
echo "============================================"
echo ""

# Boss 直聘先不跑（用户确认不需要）
declare -a SCRIPTS=(
  "verify-auto-nurture.sh"
  "verify-comment-mining.sh"
  "verify-xiaohongshu.sh"
)

PASS=0
FAIL=0
RESULTS=()

for script in "${SCRIPTS[@]}"; do
  echo ">>> 正在运行 $script ..."
  if bash "$SCRIPT_DIR/$script" > "$OUT_DIR/${script%.sh}.log" 2>&1; then
    echo "✅ $script 通过"
    PASS=$((PASS + 1))
    RESULTS+=("$script: PASS")
  else
    echo "❌ $script 失败"
    FAIL=$((FAIL + 1))
    RESULTS+=("$script: FAIL")
  fi
  echo ""
done

echo "============================================"
echo "  汇总结果：$PASS 通过，$FAIL 失败"
echo "============================================"
for r in "${RESULTS[@]}"; do
  echo "  - $r"
done

echo ""
echo "详细报告已保存至：$OUT_DIR/"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0