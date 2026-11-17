// device.js — 设备状态感知
import { runAdb, runAdbRoot, getProp } from './adb.js';

/**
 * 获取设备完整信息
 */
export async function getDeviceInfo() {
  const [model, version, sdk, kernel, serial, fingerprint, density, size, battery, charging, wifi, root] =
    await Promise.all([
      getProp('ro.product.model'),
      getProp('ro.build.version.release'),
      getProp('ro.build.version.sdk'),
      getProp('ro.kernel.qemu') ? null : Promise.resolve(getProp('ro.build.version.release')), // placeholder
      getProp('ro.serialno'),
      getProp('ro.build.fingerprint'),
      getProp('ro.sf.lcd_density'),
      null,
      null,
      null,
      null,
      null,
    ]);

  // 内核版本
  const kernelR = await runAdb(['shell', 'uname', '-r'], { timeout: 5000 });
  const kernelStr = kernelR.code === 0 ? kernelR.stdout.trim() : null;

  // 屏幕尺寸
  const sizeR = await runAdb(['shell', 'wm', 'size'], { timeout: 5000 });
  const sizeStr = sizeR.code === 0 ? sizeR.stdout.trim() : null;

  // 电池
  const battR = await runAdb(['shell', 'dumpsys', 'battery'], { timeout: 5000 });
  const batt = parseBattery(battR.stdout);

  // 网络
  const netR = await runAdb(['shell', 'dumpsys', 'connectivity', '|', 'grep', '-E', '"WIFI|MOBILE"'], { timeout: 5000 });
  const net = netR.code === 0 ? netR.stdout.split('\n').filter((l) => /(WIFI|MOBILE)/.test(l)).slice(0, 4).join('\n').trim() : null;

  // root 检查
  const suR = await runAdb(['shell', 'su', '-c', 'id'], { timeout: 5000 });
  const rootState = suR.code === 0 && /uid=0/.test(suR.stdout) ? 'root (KernelSU)' : 'not root';

  return {
    model,
    androidVersion: version,
    sdk,
    kernel: kernelStr,
    serial,
    fingerprint,
    density,
    screen: sizeStr,
    battery: batt,
    network: net,
    root: rootState,
  };
}

/** 解析 dumpsys battery */
function parseBattery(dump) {
  const get = (k) => {
    const m = new RegExp(`\\s+${k}:\\s+(.+)`).exec(dump || '');
    return m ? m[1].trim() : null;
  };
  return {
    level: get('level'),
    status: get('status'),
    health: get('health'),
    temperature: get('temperature'),
  };
}

/** 前台应用 */
export async function getForegroundApp() {
  const r = await runAdb(['shell', 'dumpsys', 'activity', 'activities'], { timeout: 8000 });
  if (r.code !== 0) return { ok: false, error: r.stderr.trim() };
  // 解析 mResumedActivity / topResumedActivity
  const m = /(?:mResumedActivity|topResumedActivity|ResumedActivity):\s+ActivityRecord\{[^}]+\s+([^\s/]+)\/([^\s}]+)/.exec(r.stdout);
  if (m) {
    return { ok: true, package: m[1], activity: m[2] };
  }
  // 回退：找 mCurrentFocus
  const focus = /mCurrentFocus=Window\{[^}]+\s+([^\s/]+)\/([^\s}]+)/.exec(r.stdout);
  if (focus) return { ok: true, package: focus[1], activity: focus[2] };
  return { ok: false, error: 'cannot determine foreground app', raw: r.stdout.slice(0, 500) };
}

/** 已装应用列表 */
export async function listApps(filter = '') {
  const r = await runAdb(['shell', 'pm', 'list', 'packages', '-f'], { timeout: 15000 });
  if (r.code !== 0) return { ok: false, error: r.stderr.trim() };
  const apps = r.stdout
    .split('\n')
    .map((l) => {
      const m = /^package:(.+)=(.+)$/.exec(l.trim());
      return m ? { path: m[1], package: m[2] } : null;
    })
    .filter(Boolean);
  const filtered = filter ? apps.filter((a) => a.package.includes(filter)) : apps;
  return { ok: true, count: filtered.length, apps: filtered.slice(0, 500) };
}

/** 屏幕状态 */
export async function screenStatus() {
  const r = await runAdb(['shell', 'dumpsys', 'power'], { timeout: 5000 });
  if (r.code !== 0) return { ok: false, error: r.stderr.trim() };
  const interactive = /mWakefulness=Awake/.test(r.stdout) || /mInteractive=true/.test(r.stdout);
  const displayOn = /mScreenOn=true/.test(r.stdout);
  const locked = /mDreamingLockscreen|isStatusBarKeyguard|mKeyguardShowing/.test(r.stdout);
  return { ok: true, interactive, displayOn, locked };
}

/** 唤醒/休眠 */
export async function setScreen(on) {
  const cmd = on ? 'input keyevent KEYCODE_WAKEUP' : 'input keyevent KEYCODE_SLEEP';
  const r = await runAdb(['shell', cmd], { timeout: 5000 });
  return { ok: r.code === 0, command: cmd, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
}
