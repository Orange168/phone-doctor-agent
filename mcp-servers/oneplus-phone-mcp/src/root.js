// root.js — KernelSU su 深度操作（root shell / 包管理 / 进程 / 文件 / 属性 / 设置）
import { runAdb, runAdbRoot, getProp } from './adb.js';

// ============ root 命令执行 ============

/**
 * 以 root 执行任意命令
 * @param {string} cmd shell 命令
 * @param {{timeout?: number}} opts
 */
export async function runRoot(cmd, opts = {}) {
  const timeout = opts.timeout || 30000;
  const r = await runAdb(['shell', 'su', '-c', cmd], { timeout, asRoot: true });
  return {
    ok: r.code === 0,
    exitCode: r.code,
    stdout: r.stdout.trim(),
    stderr: r.stderr.trim(),
  };
}

/** root 身份确认 */
export async function rootCheck() {
  const r = await runAdb(['shell', 'su', '-c', 'id'], { timeout: 5000 });
  return {
    ok: r.code === 0 && /uid=0/.test(r.stdout),
    output: r.stdout.trim() || r.stderr.trim(),
  };
}

/** KernelSU 版本 */
export async function ksuVersion() {
  const r = await runAdb(['shell', 'su', '-c', 'ksud --version'], { timeout: 8000 });
  return { ok: r.code === 0, version: r.stdout.trim() || r.stderr.trim() };
}

// ============ 包管理 ============

/** 列出已装包 */
export async function pmList(filter = '') {
  const r = await runAdb(['shell', 'pm', 'list', 'packages'], { timeout: 15000 });
  if (r.code !== 0) return { ok: false, error: r.stderr.trim() };
  const pkgs = r.stdout
    .split('\n')
    .map((l) => l.replace('package:', '').trim())
    .filter(Boolean);
  const filtered = filter ? pkgs.filter((p) => p.includes(filter)) : pkgs;
  return { ok: true, count: filtered.length, packages: filtered.slice(0, 500) };
}

/** 包 APK 路径 */
export async function pmPath(pkg) {
  const r = await runAdb(['shell', 'pm', 'path', pkg], { timeout: 8000 });
  return { ok: r.code === 0, path: r.stdout.trim() };
}

/** 清除应用数据 */
export async function pmClear(pkg) {
  const r = await runAdb(['shell', 'pm', 'clear', pkg], { timeout: 15000 });
  return { ok: r.code === 0, output: r.stdout.trim() || r.stderr.trim() };
}

/** 禁用/启用应用 */
export async function pmSetEnabled(pkg, enabled) {
  const r = await runAdb(['shell', 'pm', enabled ? 'enable' : 'disable', pkg], { timeout: 10000 });
  return { ok: r.code === 0, output: r.stdout.trim() || r.stderr.trim() };
}

// ============ 进程管理 ============

/** 列出进程 */
export async function ps(filter = '') {
  const r = await runAdb(['shell', 'ps', '-A'], { timeout: 8000 });
  if (r.code !== 0) return { ok: false, error: r.stderr.trim() };
  const lines = r.stdout.split('\n');
  const header = lines[0];
  const procs = lines
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p.length >= 9)
    .map((p) => ({
      user: p[0], pid: parseInt(p[1], 10), ppid: parseInt(p[2], 10),
      name: p[8],
    }));
  const filtered = filter ? procs.filter((p) => p.name.includes(filter)) : procs;
  return { ok: true, count: filtered.length, processes: filtered.slice(0, 200), header };
}

/** 杀进程 */
export async function killProc(pid, signal = 'KILL') {
  const r = await runAdb(['shell', 'su', '-c', `kill -${signal} ${pid}`], { timeout: 5000 });
  return { ok: r.code === 0, output: r.stdout.trim() || r.stderr.trim() };
}

/** 强停应用 */
export async function forceStop(pkg) {
  const r = await runAdb(['shell', 'am', 'force-stop', pkg], { timeout: 8000 });
  return { ok: r.code === 0, output: r.stdout.trim() || r.stderr.trim() };
}

// ============ 文件系统 ============

/** 读文件（root） */
export async function fsRead(path) {
  const r = await runAdb(['shell', 'su', '-c', `cat '${path}'`], { timeout: 10000 });
  return { ok: r.code === 0, content: r.stdout, error: r.stderr.trim() };
}

/** 写文件（root） */
export async function fsWrite(path, content) {
  // base64 传输避免 shell 转义问题（去换行防截断）
  const b64 = Buffer.from(content).toString('base64').replace(/\n/g, '');
  const r = await runAdb(['shell', 'su', '-c', `echo '${b64}' | base64 -d > '${path}'`], { timeout: 10000 });
  return { ok: r.code === 0, path, error: r.stderr.trim() };
}

/** 列目录（root） */
export async function fsList(path) {
  const r = await runAdb(['shell', 'su', '-c', `ls -la '${path}'`], { timeout: 8000 });
  return { ok: r.code === 0, output: r.stdout, error: r.stderr.trim() };
}

/** 删除（root） */
export async function fsRm(path, recursive = false) {
  const flag = recursive ? '-rf' : '-f';
  const r = await runAdb(['shell', 'su', '-c', `rm ${flag} '${path}'`], { timeout: 8000 });
  return { ok: r.code === 0, output: r.stdout.trim() || r.stderr.trim() };
}

// ============ 系统属性 ============

/** getprop */
export async function getPropVal(name) {
  return getProp(name);
}

/** setprop */
export async function setProp(name, value) {
  const r = await runAdb(['shell', 'su', '-c', `setprop '${name}' '${value}'`], { timeout: 8000 });
  return { ok: r.code === 0, output: r.stdout.trim() || r.stderr.trim() };
}

/** resetprop（改 ro. 属性） */
export async function resetProp(name, value, opts = {}) {
  const flag = opts.delete ? '-d' : '';
  const cmd = `resetprop ${flag} '${name}' '${value}'`;
  const r = await runAdb(['shell', 'su', '-c', cmd], { timeout: 8000 });
  return { ok: r.code === 0, command: cmd, output: r.stdout.trim() || r.stderr.trim() };
}

/** 列出属性 */
export async function listProps(filter = '') {
  const r = await runAdb(['shell', 'getprop'], { timeout: 8000 });
  if (r.code !== 0) return { ok: false, error: r.stderr.trim() };
  const lines = r.stdout
    .split('\n')
    .filter((l) => l.includes('[') && l.includes(']'))
    .map((l) => {
      const m = /^\[([^\]]+)\]:\s*\[([^\]]*)\]/.exec(l.trim());
      return m ? { name: m[1], value: m[2] } : null;
    })
    .filter(Boolean);
  const filtered = filter ? lines.filter((p) => p.name.includes(filter)) : lines;
  return { ok: true, count: filtered.length, props: filtered.slice(0, 300) };
}

// ============ 系统设置 ============

/** settings get */
export async function settingsGet(namespace, key) {
  const r = await runAdb(['shell', 'settings', 'get', namespace, key], { timeout: 8000 });
  return { ok: r.code === 0, value: r.stdout.trim() };
}

/** settings put */
export async function settingsPut(namespace, key, value) {
  const r = await runAdb(['shell', 'settings', 'put', namespace, key, value], { timeout: 8000 });
  return { ok: r.code === 0, output: r.stdout.trim() || r.stderr.trim() };
}
