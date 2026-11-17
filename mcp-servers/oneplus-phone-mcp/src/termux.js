// termux.js — Termux 工具链集成（命令执行 / 工具链 / proot 容器 / apt）
import { runAdb, runAdbRoot } from './adb.js';
import { config } from './config.js';

const TERMUX_PREFIX = '/data/data/com.termux/files/usr';
const TERMUX_HOME = '/data/data/com.termux/files/home';
const TERMUX_USER = 'u0_a355';
const TERMUX_UID = '10355';
const PKG_WRAPPER = '/data/local/tmp/termux-pkg.sh'; // 万能 apt 包装器（绕 DNS 死结）

/**
 * 以 Termux 用户执行命令（root 提升后切换身份）
 * @param {string} cmd 命令（Termux PATH 内）
 * @param {{timeout?: number}} opts
 */
export async function termuxRun(cmd, opts = {}) {
  const timeout = opts.timeout || 30000;
  // 直接 su -c 执行：命令前 export PATH（Termux bin 前置）
  // ⚠️ execFile 传参时 adb 按空格拆分，必须给整条命令加引号，否则 su -c 只拿到第一个词
  const prefixed = `export PATH=${TERMUX_PREFIX}/bin:/system/bin:/system/xbin; export LD_LIBRARY_PATH=${TERMUX_PREFIX}/lib; export HOME=${TERMUX_HOME}; export TMPDIR=${TERMUX_PREFIX}/tmp; cd ${TERMUX_HOME}; ${cmd}`;
  const quoted = `"${prefixed.replace(/"/g, '\\"')}"`;
  const r = await runAdb(['shell', 'su', '-c', quoted], { timeout, asRoot: true });
  return { ok: r.code === 0, exitCode: r.code, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
}

/**
 * 执行 Termux 工具（自动加绝对路径前缀）
 * @param {string} tool 工具名（如 python3 / gcc / git）
 * @param {string[]} args 工具参数
 */
export async function termuxTool(tool, args = [], opts = {}) {
  const timeout = opts.timeout || 30000;
  const full = [`${TERMUX_PREFIX}/bin/${tool}`, ...args].join(' ');
  const r = await runAdb(['shell', 'su', '-c', full], { timeout, asRoot: true });
  return { ok: r.code === 0, exitCode: r.code, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
}

/**
 * 直接以 Termux 用户执行（SSH 通道场景已切好用户时）
 */
export async function termuxRunDirect(cmd, opts = {}) {
  const timeout = opts.timeout || 30000;
  const full = [
    `export PATH=${TERMUX_PREFIX}/bin:$PATH`,
    `export HOME=${TERMUX_HOME}`,
    `export LD_LIBRARY_PATH=${TERMUX_PREFIX}/lib`,
    `export TMPDIR=${TERMUX_PREFIX}/tmp`,
    cmd,
  ].join('; ');
  const r = await runAdb(['shell', full], { timeout });
  return { ok: r.code === 0, exitCode: r.code, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
}

/** Termux 是否安装 */
export async function termuxStatus() {
  const r = await runAdb(['shell', 'su', '-c', `ls ${TERMUX_PREFIX}/bin/ | head -5`], { timeout: 5000 });
  return {
    ok: r.code === 0,
    prefix: TERMUX_PREFIX,
    hasBin: r.code === 0,
    sample: r.stdout.trim().split('\n').slice(0, 5),
    error: r.code !== 0 ? r.stderr.trim() : null,
  };
}

/** Termux sshd 状态 */
export async function termuxSshdStatus() {
  const r = await runAdb(['shell', 'su', '-c', 'ss -tln | grep 8022'], { timeout: 5000 });
  return { ok: r.code === 0 && r.stdout.includes('8022'), listening: r.stdout.trim() };
}

/** 启动 Termux sshd */
export async function termuxSshdStart() {
  const r = await runAdb(
    ['shell', 'su', '-c', `sh ${TERMUX_HOME}/.termux/boot/start-sshd.sh`],
    { timeout: 10000 }
  );
  // 启动后确认
  await new Promise((r2) => setTimeout(r2, 1500));
  const check = await termuxSshdStatus();
  return { ok: check.ok, output: check.listening, startError: r.stderr.trim() };
}

/**
 * Termux apt 安装（用万能包装器绕 DNS 死结）
 * @param {string[]} pkgs
 */
export async function termuxAptInstall(pkgs, opts = {}) {
  const install = Array.isArray(pkgs) ? pkgs.join(' ') : pkgs;
  const timeout = opts.timeout || 120000;
  const cmd = `sh ${PKG_WRAPPER} install ${install}`;
  const r = await runAdb(['shell', 'su', '-c', cmd], { timeout, asRoot: true });
  return { ok: r.code === 0, stdout: r.stdout.slice(-2000), stderr: r.stderr.slice(-500) };
}

/**
 * proot 容器命令执行（Ubuntu/Alpine）
 * @param {string} container 容器名（ubuntu/alpine）
 * @param {string} cmd 容器内命令
 */
export async function termuxContainer(container, cmd, opts = {}) {
  const timeout = opts.timeout || 60000;
  const paths = {
    ubuntu: `${TERMUX_HOME}/Termux-Linux/Ubuntu/ubuntu-fs`,
    alpine: '/data/local/tmp/alpine',
  };
  const rootfs = paths[container];
  if (!rootfs) return { ok: false, error: `unknown container: ${container} (ubuntu/alpine)` };

  // 容器内执行（proot 伪装 root + 绑挂系统目录）
  const prootCmd = [
    `${TERMUX_PREFIX}/bin/proot`,
    `-0`, // 模拟 root
    `-r`, rootfs,
    `-b`, '/dev', `-b`, '/proc', `-b`, '/sys',
    `/bin/sh`, '-c', `export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin; ${cmd}`,
  ].join(' ');

  const full = [
    `export PATH=${TERMUX_PREFIX}/bin:$PATH`,
    `export HOME=${TERMUX_HOME}`,
    `su ${TERMUX_USER} -c "cd ${TERMUX_HOME} && ${prootCmd}"`,
  ].join('; ');

  const r = await runAdb(['shell', 'su', '-c', full], { timeout, asRoot: true });
  return { ok: r.code === 0, stdout: r.stdout.slice(-3000), stderr: r.stderr.slice(-500) };
}

/** 检查容器是否存在 */
export async function termuxContainerList() {
  const r = await runAdb(['shell', 'su', '-c', `ls -d ${TERMUX_HOME}/Termux-Linux/*/ 2>/dev/null; ls -d /data/local/tmp/*/ 2>/dev/null`], { timeout: 5000 });
  return { ok: r.code === 0, containers: r.stdout.split('\n').filter(Boolean) };
}
