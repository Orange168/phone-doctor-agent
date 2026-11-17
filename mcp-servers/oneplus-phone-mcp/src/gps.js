// gps.js — GPS 模拟定位（appops 授权 + mock location 设置）
import { runAdb, runAdbRoot } from './adb.js';

/**
 * 授权应用使用模拟位置（appops mock_location allow）
 * @param {string} pkg 目标应用包名
 */
export async function gpsAuthorize(pkg) {
  // 1. 开启系统 mock location 开关
  const settingR = await runAdb(['shell', 'settings', 'put', 'secure', 'mock_location', '1'], { timeout: 8000 });
  // 2. appops 授权
  const opsR = await runAdb(['shell', 'su', '-c', `appops set ${pkg} android:mock_location allow`], { timeout: 8000 });
  // 3. 校验
  const checkR = await runAdb(['shell', 'su', '-c', `appops get ${pkg} android:mock_location`], { timeout: 8000 });
  return {
    ok: opsR.code === 0,
    setting: settingR.stdout.trim() || settingR.stderr.trim(),
    appops: checkR.stdout.trim() || checkR.stderr.trim(),
    error: !opsR.ok ? opsR.stderr.trim() : null,
  };
}

/** 撤销模拟位置授权 */
export async function gpsRevoke(pkg) {
  const r = await runAdb(['shell', 'su', '-c', `appops set ${pkg} android:mock_location deny`], { timeout: 8000 });
  return { ok: r.code === 0, output: r.stdout.trim() || r.stderr.trim() };
}

/**
 * 设置模拟位置（通过 mock location provider）
 * 核心原理：启动一个 mock location app 或直接调用 location service 注入坐标
 * 方案 A（推荐）：用 `am broadcast` 或直接写 GPS 节点
 * 方案 B：启动 Fake Location App 并传坐标
 *
 * 当前实现：检查是否已装 mock app；若装有则启动之；否则用 root 写 gps 节点
 */
export async function gpsSet(lat, lng, opts = {}) {
  const { pkg = '', jitter = 0, app = '' } = opts;
  // 校验坐标
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return { ok: false, error: 'lat/lng must be numbers' };
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { ok: false, error: `invalid coords: ${lat},${lng}` };
  }

  // 抖动：在半径内随机偏移（模拟真实移动）
  let finalLat = lat, finalLng = lng;
  if (jitter > 0) {
    // 1 度 ≈ 111km，抖动半径米 → 度
    const degPerMeter = 1 / 111000;
    finalLat = lat + (Math.random() - 0.5) * 2 * jitter * degPerMeter;
    finalLng = lng + (Math.random() - 0.5) * 2 * jitter * degPerMeter / Math.max(0.1, Math.cos(lat * Math.PI / 180));
  }

  // 检查 mock app
  const mockApps = await findMockApps();
  if (mockApps.length > 0) {
    // 启动 mock app 并注入坐标（通过 am start + extra）
    const mockApp = mockApps[0];
    const startR = await runAdb([
      'shell', 'am', 'start',
      '-n', `${mockApp}/.MainActivity`,
      '--el', 'com.oneplus.mock.lat', Math.round(finalLat * 1e7),
      '--el', 'com.oneplus.mock.lng', Math.round(finalLng * 1e7),
    ], { timeout: 8000 });
    return {
      ok: startR.code === 0,
      method: 'mock-app',
      mockApp,
      coords: { lat: Number(finalLat.toFixed(6)), lng: Number(finalLng.toFixed(6)) },
      note: 'mock app launched with coords (需 mock app 支持 intent extra)',
    };
  }

  // 回退：直接写 mock location provider（root）
  // Android 15 不允许直接写，提示用户安装 mock app
  return {
    ok: false,
    error: 'no mock location app installed; install Fake Location (com.incorporateapps.fakegps.fre) and re-authorize',
    coords: { lat: Number(finalLat.toFixed(6)), lng: Number(finalLng.toFixed(6)) },
  };
}

/** 查找已装 mock location app */
async function findMockApps() {
  const candidates = [
    'com.incorporateapps.fakegps.fre',
    'com.lexa.fakegps',
    'com.rong.xposed.fakelocation',
    'com.dimon4u.fakelocation',
  ];
  const r = await runAdb(['shell', 'pm', 'list', 'packages'], { timeout: 10000 });
  if (r.code !== 0) return [];
  const installed = new Set(r.stdout.split('\n').map((l) => l.replace('package:', '').trim()).filter(Boolean));
  return candidates.filter((c) => installed.has(c));
}

/** 读取当前模拟位置状态 */
export async function gpsStatus() {
  const mockSetting = await runAdb(['shell', 'settings', 'get', 'secure', 'mock_location'], { timeout: 5000 });
  // 尝试读取当前 GPS 位置（dumpsys location）
  const dumpsysR = await runAdb(['shell', 'dumpsys', 'location'], { timeout: 8000 });
  const lastLocation = /last location=Location\[fused[^\]]*lat=([\d.-]+)[^\]]*lng=([\d.-]+)/.exec(dumpsysR.stdout);
  return {
    ok: true,
    mockLocationEnabled: mockSetting.stdout.trim() === '1',
    lastLocation: lastLocation
      ? { lat: parseFloat(lastLocation[1]), lng: parseFloat(lastLocation[2]) }
      : null,
  };
}

/** 清除模拟位置 */
export async function gpsClear() {
  const r = await runAdb(['shell', 'settings', 'put', 'secure', 'mock_location', '0'], { timeout: 8000 });
  return { ok: r.code === 0, output: r.stdout.trim() || r.stderr.trim() };
}
