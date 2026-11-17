// notification.js — 通知中心（列表/监听/操作/拦截）
import { runAdb, runAdbRoot } from './adb.js';

/**
 * 通知列表（dumpsys notification 解析）
 * @param {{filter?: string, limit?: number}} opts
 */
export async function notificationList(opts = {}) {
  const { filter = '', limit = 50 } = opts;
  const r = await runAdb(['shell', 'dumpsys', 'notification', '--noredact'], { timeout: 10000 });
  if (r.code !== 0) return { ok: false, error: r.stderr.trim() };

  const notifications = [];
  // 解析 NotificationRecord 块
  const blocks = r.stdout.split(/\n(?=\s+NotificationRecord)/);
  for (const block of blocks) {
    const pkg = /pkg=([^\s]+)/.exec(block)?.[1];
    const title = /android\.title=([^\n]+)/.exec(block)?.[1]?.replace(/^"|"$/g, '');
    const text = /android\.text=([^\n]+)/.exec(block)?.[1]?.replace(/^"|"$/g, '');
    const when = /when=([^\s]+)/.exec(block)?.[1];
    if (!pkg) continue;
    if (filter && !pkg.includes(filter)) continue;
    notifications.push({ pkg, title: title || '', text: (text || '').slice(0, 120), when });
  }
  return { ok: true, count: notifications.length, notifications: notifications.slice(0, limit) };
}

/** 通知监听（轮询模式，返回自上次以来的新增通知） */
export async function notificationWatch(opts = {}) {
  const { intervalMs = 3000, durationMs = 10000, filter = '' } = opts;
  const seen = new Set();
  const newOnes = [];
  const start = Date.now();

  // 预加载当前通知（基线）
  const baseline = await notificationList({ limit: 100 });
  for (const n of baseline.notifications || []) {
    seen.add(`${n.pkg}|${n.title}|${n.text}`);
  }

  while (Date.now() - start < durationMs) {
    const r = await notificationList({ limit: 100 });
    for (const n of r.notifications || []) {
      const key = `${n.pkg}|${n.title}|${n.text}`;
      if (!seen.has(key)) {
        seen.add(key);
        if (!filter || n.pkg.includes(filter)) newOnes.push({ ...n, arrivedAt: Date.now() });
      }
    }
    await new Promise((r2) => setTimeout(r2, intervalMs));
  }
  return { ok: true, newCount: newOnes.length, notifications: newOnes.slice(0, 20) };
}

/** 点击通知（通过 notification click action 或 am start） */
export async function notificationAct(pkg, opts = {}) {
  const { title = '', text = '' } = opts;
  // 方式1：用 cmd notification 点击（需要 NotificationListener 权限）
  // 方式2：直接启动对应 App（回退）
  const r = await runAdb(['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'], { timeout: 10000 });
  return {
    ok: r.code === 0,
    method: 'launch-app-fallback',
    package: pkg,
    note: 'clicked via app launch (NotificationListener direct click pending)',
  };
}

/** 清除通知 */
export async function notificationClear(opts = {}) {
  const { pkg = '', all = false } = opts;
  if (all) {
    const r = await runAdb(['shell', 'cmd', 'notification', 'cancel_all'], { timeout: 8000 });
    return { ok: r.code === 0, output: r.stdout.trim() || r.stderr.trim() };
  }
  if (pkg) {
    // 按包名清除（需要 listener 或 root）
    const r = await runAdb(['shell', 'su', '-c', `cmd notification cancel_all ${pkg}`], { timeout: 8000 });
    return { ok: r.code === 0, output: r.stdout.trim() || r.stderr.trim() };
  }
  return { ok: false, error: 'specify pkg or all=true' };
}

/** 屏蔽 App 通知 */
export async function notificationBlock(pkg, block = true) {
  // 通过 notification policy / appops
  const r = await runAdb(['shell', 'su', '-c', `appops set ${pkg} POST_NOTIFICATION ${block ? 'ignore' : 'allow'}`], { timeout: 8000 });
  return { ok: r.code === 0, package: pkg, blocked: block, output: r.stdout.trim() || r.stderr.trim() };
}

/** 验证通知监听生效（发送测试通知） */
export async function notificationVerify() {
  // 用 cmd notification post 发送测试通知（Android 12+）
  const r = await runAdb(['shell', 'cmd', 'notification', 'post', '-S', 'bigtext', '-t', 'MCP Test', 'tag', 'MCP Test Notification'], { timeout: 8000 });
  const listR = await notificationList({ filter: 'MCP Test' });
  return {
    ok: listR.count > 0,
    posted: r.code === 0,
    testNotificationFound: listR.count > 0,
    output: listR.notifications?.slice(0, 3),
  };
}
