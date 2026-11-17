// xposed.js — LSPosed / Xposed 框架管理与注入能力
import { runAdb, runAdbRoot } from './adb.js';

const LSPD_DIR = '/data/adb/lspd';
const LSPD_CONFIG = '/data/adb/lspd/config';
const LSPD_DB = `${LSPD_CONFIG}/modules_config.db`;
const LSPOSED_MANAGER = 'org.lsposed.manager';

// ============ 框架状态 ============

/** LSPosed 框架状态 */
export async function xposedStatus() {
  const dbR = await runAdb(['shell', 'su', '-c', `ls -la ${LSPD_DB}`], { timeout: 5000 });
  const dirR = await runAdb(['shell', 'su', '-c', `ls -la ${LSPD_DIR}`], { timeout: 5000 });
  const managerR = await runAdb(['shell', 'pm', 'list', 'packages'], { timeout: 8000 });
  const managerInstalled = managerR.code === 0 && managerR.stdout.includes(LSPOSED_MANAGER);

  return {
    ok: true,
    framework: {
      installed: dirR.code === 0,
      dbExists: dbR.code === 0,
      dbPath: LSPD_DB,
      dir: dirR.stdout.trim() || null,
    },
    manager: {
      installed: managerInstalled,
      package: LSPOSED_MANAGER,
    },
    zygiskDetected: await checkZygisk(),
  };
}

async function checkZygisk() {
  const r = await runAdb(['shell', 'su', '-c', 'ls /data/adb/modules/ | grep -iE "zygisk|lsp"'], { timeout: 5000 });
  return r.code === 0 ? r.stdout.trim().split('\n').filter(Boolean) : [];
}

/** 启动 LSPosed Manager */
export async function xposedManager() {
  const r = await runAdb(['shell', 'am', 'start', '-n', `${LSPOSED_MANAGER}/.ui.activity.MainActivity`], { timeout: 8000 });
  return { ok: r.code === 0, output: r.stdout.trim() || r.stderr.trim() };
}

// ============ 模块管理 ============

/** 列出 Xposed 模块（从 LSPosed 数据库解析） */
export async function xposedModules() {
  // 1. root 复制 db 到 /sdcard（adb pull 可读）
  const tmpRemote = '/sdcard/lspd_tmp.db';
  const tmpLocal = '/tmp/lspd-mcp.db';
  const cpR = await runAdb(['shell', 'su', '-c', `cp ${LSPD_DB} ${tmpRemote}`], { timeout: 8000 });
  if (cpR.code !== 0) return { ok: false, error: 'cannot copy lspd db: ' + cpR.stderr.trim() };
  // 2. pull 到本机
  const pullR = await runAdb(['pull', tmpRemote, tmpLocal], { timeout: 8000 });
  if (pullR.code !== 0) return { ok: false, error: 'cannot pull lspd db: ' + pullR.stderr.trim() };
  // 3. python3 读 sqlite
  const { execFile } = await import('node:child_process');
  const py = `import sqlite3,json
con=sqlite3.connect('${tmpLocal}')
cur=con.cursor()
tables=[r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'")]
mods=[]
for r in cur.execute("SELECT m.module_pkg_name, m.apk_path, COALESCE(s.enabled,0) FROM modules m LEFT JOIN modules_state s ON m.module_pkg_name=s.module_pkg_name"):
    mods.append({'package':r[0],'apkPath':r[1],'enabled':r[2]==1})
print(json.dumps({'tables':tables,'modules':mods}))`;
  return new Promise((resolve) => {
    execFile('python3', ['-c', py], { timeout: 8000 }, (err, stdout, stderr) => {
      if (err) return resolve({ ok: false, error: 'python3 parse failed: ' + (stderr || err.message).trim() });
      try {
        const data = JSON.parse(stdout.trim().split('\n').pop());
        resolve({ ok: true, ...data });
      } catch (e) {
        resolve({ ok: false, error: 'json parse failed: ' + e.message });
      }
    });
  });
}

/** 启用/禁用模块 */
export async function xposedSetModule(pkg, enabled) {
  // 直接改 LSPosed db（需要停止 zygote 重载？一般重启作用域 App 生效）
  const val = enabled ? '1' : '0';
  const r = await runAdb([
    'shell', 'su', '-c',
    `sqlite3 ${LSPD_DB} "UPDATE modules SET enabled=${val} WHERE module_pkg_name='${pkg}'"`,
  ], { timeout: 8000 });
  return { ok: r.code === 0, output: r.stdout.trim() || r.stderr.trim() };
}

// ============ Hook 能力枚举 ============

/** 枚举设备上可用的 hook 框架能力 */
export async function xposedHooks() {
  const zygisk = await checkZygisk();
  const lspdR = await runAdb(['shell', 'su', '-c', `ls ${LSPD_DIR}`], { timeout: 5000 });

  const capabilities = [];
  if (zygisk.length > 0) {
    capabilities.push({
      framework: 'Zygisk Next',
      api: 'zygisk',
      hookTypes: ['native', 'zygote-injection'],
      status: 'active',
      modules: zygisk,
    });
  }
  if (lspdR.code === 0) {
    capabilities.push({
      framework: 'LSPosed',
      api: 'xposed',
      hookTypes: ['method', 'constructor', 'field', 'class-load'],
      status: lspdR.stdout.includes('config') ? 'configured' : 'partial',
    });
  }
  // frida 是独立注入通道
  capabilities.push({
    framework: 'Frida (frida-server)',
    api: 'frida-gum',
    hookTypes: ['method', 'native', 'interceptor', 'memory'],
    status: 'available',
  });

  return { ok: true, count: capabilities.length, capabilities };
}

// ============ 注入任意 App ============

/**
 * 将已启用模块注入目标 App（重启 App 生效）
 * @param {string} pkg 目标 App 包名
 * @param {string} modulePkg 模块包名（可选，不传则列出可用模块）
 */
export async function xposedInject(pkg, modulePkg = '') {
  // 1. 校验 pkg 已装
  const pmR = await runAdb(['shell', 'pm', 'path', pkg], { timeout: 8000 });
  if (pmR.code !== 0 || !pmR.stdout.trim()) {
    return { ok: false, error: `app not installed: ${pkg}` };
  }
  // 2. 重启目标 App（force-stop + start）
  const stopR = await runAdb(['shell', 'am', 'force-stop', pkg], { timeout: 8000 });
  const startR = await runAdb(['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'], { timeout: 10000 });
  return {
    ok: true,
    package: pkg,
    module: modulePkg || 'all-enabled',
    restarted: stopR.code === 0,
    launched: startR.code === 0,
    note: 'module will apply on next process start (LSPosed scope must include this app)',
  };
}

/** 验证模块在目标 App 进程生效 */
export async function xposedVerify(pkg) {
  // 检查进程是否加载了 lspd 相关库
  const r = await runAdb([
    'shell', 'su', '-c',
    `for p in $(pgrep -f ${pkg}); do echo "PID $p:"; grep -cE "lspd|dex2oat|xposed" /proc/$p/maps 2>/dev/null; done`,
  ], { timeout: 8000 });
  return {
    ok: r.code === 0,
    output: r.stdout.trim() || 'no process found (app not running)',
  };
}
