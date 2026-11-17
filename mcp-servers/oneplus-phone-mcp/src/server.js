// server.js — oneplus-phone-mcp MCP server 入口
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { config, ensureDirs } from './config.js';
import { runAdb, isDeviceOnline, listDevices, getProp } from './adb.js';
import { captureScreen } from './screen.js';
import { dumpLayoutTree, extractInteractive } from './layout.js';
import { tap, swipe, inputText, pressKey } from './input.js';
import { startScrcpy, stopScrcpy, scrcpyStatus, scrcpyAvailable } from './scrcpy.js';
import { sshCheck } from './ssh.js';
import {
  getDeviceInfo,
  getForegroundApp,
  listApps,
  screenStatus,
  setScreen,
} from './device.js';
import {
  sensorStatus,
  sensorRead,
  sensorSpoof,
  sensorRecord,
  sensorReplay,
  sensorVerify,
} from './sensor.js';
import {
  dataRecord,
  dataDataset,
  dataExport,
  dataMetrics,
  replayActions,
  dataVerify,
} from './data.js';

const server = new McpServer({
  name: 'oneplus-phone-mcp',
  version: '1.0.0',
});

// ============ 设备通道 ============

server.tool('device_status', '检查一加 PGP110 是否在线（adb get-state）', async () => {
  const online = await isDeviceOnline();
  const devices = await listDevices();
  return {
    content: [{ type: 'text', text: JSON.stringify({ online, serial: config.serial, devices }, null, 2) }],
  };
});

server.tool(
  'get_device_info',
  '获取一加 PGP110 完整设备信息（型号/Android/内核/电池/网络/root 状态）',
  async () => {
    const info = await getDeviceInfo();
    return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] };
  }
);

server.tool('get_foreground_app', '获取当前前台应用（包名 + Activity）', async () => {
  const fg = await getForegroundApp();
  return { content: [{ type: 'text', text: JSON.stringify(fg, null, 2) }] };
});

server.tool(
  'list_apps',
  '列出已装应用（可选 filter 过滤包名）',
  { filter: z.string().optional().describe('包名关键词过滤') },
  async (params) => {
    const filter = (params && params.filter) || '';
    const r = await listApps(filter);
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool('screen_status', '查询屏幕亮灭/锁定状态', async () => {
  const s = await screenStatus();
  return { content: [{ type: 'text', text: JSON.stringify(s, null, 2) }] };
});

server.tool('wake_screen', '唤醒屏幕（KEYCODE_WAKEUP）', async () => {
  const r = await setScreen(true);
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
});

server.tool('sleep_screen', '熄灭屏幕（KEYCODE_SLEEP）', async () => {
  const r = await setScreen(false);
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
});

// ============ 屏幕捕获 ============

server.tool(
  'capture_screen',
  '截取设备屏幕，返回 PNG/JPEG 文件路径（Agent 可用视觉理解）',
  {
    format: z.enum(['png', 'jpeg']).optional().describe('输出格式，默认 png'),
    quality: z.number().int().min(1).max(100).optional().describe('JPEG 质量（1-100）'),
    max_size: z.number().int().min(100).optional().describe('最大边长缩放'),
  },
  async (params) => {
    const p = params || {};
    const r = await captureScreen({ format: p.format || 'png', quality: p.quality, max_size: p.max_size });
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

// ============ 布局树 ============

server.tool(
  'get_layout_tree',
  '获取当前界面简化布局树（uiautomator dump → JSON，过滤纯容器节点）',
  { save: z.boolean().optional().describe('是否保存原始 XML，默认 true') },
  async (params) => {
    const r = await dumpLayoutTree({ save: (params && params.save) !== false });
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool(
  'get_interactive_elements',
  '获取当前界面可交互元素列表（含 center 坐标，可直接用于点击）',
  async (params) => {
    const layout = await dumpLayoutTree({ save: false });
    const r = extractInteractive(layout);
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

// ============ 输入注入 ============

server.tool(
  'tap',
  '点击屏幕坐标（x,y），duration_ms>0 为长按，randomize 增加拟人抖动',
  {
    x: z.number().describe('X 坐标（像素）'),
    y: z.number().describe('Y 坐标（像素）'),
    duration_ms: z.number().int().min(0).optional().describe('长按时长（毫秒）'),
    randomize: z.boolean().optional().describe('拟人随机抖动'),
  },
  async (params) => {
    const p = params || {};
    const r = await tap({ x: p.x, y: p.y, duration_ms: p.duration_ms || 0, randomize: p.randomize || false });
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool(
  'swipe',
  '滑动（x1,y1 → x2,y2，duration_ms 毫秒，steps 可选）',
  {
    x1: z.number().describe('起点 X'),
    y1: z.number().describe('起点 Y'),
    x2: z.number().describe('终点 X'),
    y2: z.number().describe('终点 Y'),
    duration_ms: z.number().int().min(0).optional().describe('滑动时长（毫秒）'),
    steps: z.number().int().min(1).optional().describe('滑动步数'),
  },
  async (params) => {
    const p = params || {};
    const r = await swipe({ x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2, duration_ms: p.duration_ms || 300, steps: p.steps });
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool(
  'input_text',
  '输入文本（自动转义；clear_first 先全选删除）',
  {
    text: z.string().describe('要输入的文本'),
    clear_first: z.boolean().optional().describe('先全选删除再输入'),
  },
  async (params) => {
    const p = params || {};
    const r = await inputText({ text: p.text, clear_first: p.clear_first || false });
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool(
  'press_key',
  '按键（KEYCODE 名称或数字，如 HOME/BACK/APP_SWITCH/ENTER；repeat 重复次数）',
  {
    key: z.string().describe('KEYCODE 名称或数字'),
    repeat: z.number().int().min(1).optional().describe('重复次数'),
  },
  async (params) => {
    const p = params || {};
    const r = await pressKey({ key: p.key, repeat: p.repeat || 1 });
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

// ============ 远程共享 ============

server.tool(
  'start_share',
  '启动 scrcpy 屏幕共享（无头录制模式；maxFps/maxSize 可调；record 指定 mp4 输出路径；control=true 可注入）',
  {
    maxFps: z.number().int().min(1).max(60).optional().describe('最大帧率'),
    maxSize: z.number().int().min(100).optional().describe('最大边长'),
    control: z.boolean().optional().describe('是否允许控制（注入）'),
    title: z.string().optional().describe('窗口标题'),
    record: z.string().optional().describe('录制到 mp4 文件路径（headless 默认录制）'),
    headless: z.boolean().optional().describe('无头模式（默认 true）'),
    audio: z.boolean().optional().describe('是否启用音频（默认 false）'),
  },
  async (params) => {
    const p = params || {};
    const r = await startScrcpy({
      maxFps: p.maxFps || 10,
      maxSize: p.maxSize || 800,
      control: p.control || false,
      title: p.title || 'oneplus-pgp110',
      record: p.record || null,
      headless: p.headless !== false,
      audio: p.audio || false,
    });
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool('share_status', '查询当前屏幕共享会话状态', async () => {
  const r = scrcpyStatus();
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
});

server.tool(
  'stop_share',
  '停止屏幕共享（可指定 sessionId，默认全部）',
  { sessionId: z.string().optional().describe('会话 ID，默认全部') },
  async (params) => {
    const p = params || {};
    const r = await stopScrcpy(p.sessionId || null);
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool('scrcpy_available', '检查 scrcpy 是否可用', async () => {
  const r = await scrcpyAvailable();
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
});

// ============ SSH 通道 ============

server.tool(
  'ssh_check',
  '探测 SSH 通道连通性（lan=op_ 局域网 / wan=cf-op 外网）',
  { channel: z.enum(['lan', 'wan']).optional().describe('通道类型') },
  async (params) => {
    const p = params || {};
    const r = await sshCheck(p.channel || 'lan');
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

// ============ root 深度层（KernelSU + Termux + GPS + Xposed + 逆向） ============

import {
  runRoot, rootCheck, ksuVersion,
  pmList, pmPath, pmClear, pmSetEnabled,
  ps, killProc, forceStop,
  fsRead, fsWrite, fsList, fsRm,
  getPropVal, setProp, resetProp, listProps,
  settingsGet, settingsPut,
} from './root.js';
import {
  termuxRun, termuxStatus, termuxSshdStatus, termuxSshdStart,
  termuxAptInstall, termuxContainer, termuxContainerList,
} from './termux.js';
import { gpsAuthorize, gpsRevoke, gpsSet, gpsStatus, gpsClear } from './gps.js';
import { xposedStatus, xposedManager, xposedModules, xposedSetModule, xposedHooks, xposedInject, xposedVerify } from './xposed.js';
import { fridaStatus, fridaStart, fridaStop, fridaPs, fridaInject, fridaSpawn, fridaRemote } from './frida.js';

// ---- KernelSU su 深度操作 ----

server.tool('root_check', '检查 KernelSU root 状态（su -c id）', async () => {
  const r = await rootCheck();
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
});

server.tool('ksu_version', '获取 KernelSU 版本', async () => {
  const r = await ksuVersion();
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
});

server.tool(
  'run_root',
  '以 root 执行任意 shell 命令（KernelSU su），返回 stdout/stderr/exit',
  { cmd: z.string().describe('shell 命令'), timeout: z.number().int().min(1000).max(120000).optional().describe('超时 ms，默认 30000') },
  async (params) => {
    const r = await runRoot(params.cmd, { timeout: params.timeout });
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool(
  'pm_list',
  '列出已装应用（root），可选 filter',
  { filter: z.string().optional().describe('包名关键词过滤') },
  async (params) => {
    const r = await pmList((params && params.filter) || '');
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool(
  'pm_path',
  '查询应用 APK 路径（root）',
  { pkg: z.string().describe('包名') },
  async (params) => {
    const r = await pmPath(params.pkg);
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool(
  'pm_clear',
  '清除应用数据（root，A2 权限）',
  { pkg: z.string().describe('包名') },
  async (params) => {
    const r = await pmClear(params.pkg);
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool(
  'pm_set_enabled',
  '启用/禁用应用（root，A2 权限）',
  { pkg: z.string().describe('包名'), enabled: z.boolean().describe('true=启用 false=禁用') },
  async (params) => {
    const r = await pmSetEnabled(params.pkg, params.enabled);
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool(
  'ps_list',
  '列出设备进程（root）',
  { filter: z.string().optional().describe('进程名关键词过滤') },
  async (params) => {
    const r = await ps((params && params.filter) || '');
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool(
  'kill_proc',
  '杀进程（root，A2 权限）',
  { pid: z.number().int().describe('进程 PID'), signal: z.string().optional().describe('信号，默认 KILL') },
  async (params) => {
    const r = await killProc(params.pid, (params && params.signal) || 'KILL');
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool(
  'force_stop',
  '强停应用（am force-stop）',
  { pkg: z.string().describe('包名') },
  async (params) => {
    const r = await forceStop(params.pkg);
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool(
  'fs_read',
  '读取文件（root，可访问 /data/data）',
  { path: z.string().describe('文件路径') },
  async (params) => {
    const r = await fsRead(params.path);
    return { content: [{ type: 'text', text: JSON.stringify({ ok: r.ok, size: r.content.length, content: r.content.slice(0, 8000), truncated: r.content.length > 8000, error: r.error }, null, 2) }] };
  }
);

server.tool(
  'fs_write',
  '写入文件（root，A2 权限）',
  { path: z.string().describe('文件路径'), content: z.string().describe('文件内容') },
  async (params) => {
    const r = await fsWrite(params.path, params.content);
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool(
  'fs_list',
  '列目录（root）',
  { path: z.string().describe('目录路径') },
  async (params) => {
    const r = await fsList(params.path);
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool(
  'fs_rm',
  '删除文件/目录（root，A2 权限）',
  { path: z.string().describe('路径'), recursive: z.boolean().optional().describe('递归删除目录') },
  async (params) => {
    const r = await fsRm(params.path, (params && params.recursive) || false);
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool(
  'setprop',
  '设置系统属性（root）',
  { name: z.string().describe('属性名'), value: z.string().describe('属性值') },
  async (params) => {
    const r = await setProp(params.name, params.value);
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool(
  'resetprop',
  '重置系统属性（root，可改 ro. 只读属性，A2 权限）',
  { name: z.string().describe('属性名'), value: z.string().describe('属性值'), delete: z.boolean().optional().describe('删除属性') },
  async (params) => {
    const r = await resetProp(params.name, params.value, { delete: (params && params.delete) || false });
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool(
  'list_props',
  '列出系统属性（可 filter）',
  { filter: z.string().optional().describe('属性名前缀过滤') },
  async (params) => {
    const r = await listProps((params && params.filter) || '');
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool(
  'settings_get',
  '读取系统设置（system/global/secure）',
  { namespace: z.enum(['system', 'global', 'secure']).describe('命名空间'), key: z.string().describe('设置键') },
  async (params) => {
    const r = await settingsGet(params.namespace, params.key);
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool(
  'settings_put',
  '写入系统设置（root，A2 权限）',
  { namespace: z.enum(['system', 'global', 'secure']).describe('命名空间'), key: z.string().describe('设置键'), value: z.string().describe('值') },
  async (params) => {
    const r = await settingsPut(params.namespace, params.key, params.value);
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

// ---- Termux 集成 ----

server.tool(
  'termux_run',
  '以 Termux 用户执行命令（工具链：gcc/clang/python/apt）',
  { cmd: z.string().describe('Termux 命令'), timeout: z.number().int().min(1000).max(120000).optional() },
  async (params) => {
    const r = await termuxRun(params.cmd, { timeout: params.timeout });
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool('termux_status', 'Termux 安装状态', async () => {
  const r = await termuxStatus();
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
});

server.tool('termux_sshd_status', 'Termux sshd 状态（8022）', async () => {
  const r = await termuxSshdStatus();
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
});

server.tool('termux_sshd_start', '启动 Termux sshd（root）', async () => {
  const r = await termuxSshdStart();
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
});

server.tool(
  'termux_apt_install',
  'Termux apt 安装包（万能包装器绕 DNS 死结，A2 权限）',
  { packages: z.string().describe('包名（空格分隔）'), timeout: z.number().int().optional() },
  async (params) => {
    const r = await termuxAptInstall(params.packages, { timeout: params.timeout });
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool(
  'termux_container',
  '进入 proot 容器执行命令（Ubuntu/Alpine，容器内网络正常）',
  { container: z.enum(['ubuntu', 'alpine']).describe('容器名'), cmd: z.string().describe('容器内命令'), timeout: z.number().int().optional() },
  async (params) => {
    const r = await termuxContainer(params.container, params.cmd, { timeout: params.timeout });
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool('termux_container_list', '列出可用 proot 容器', async () => {
  const r = await termuxContainerList();
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
});

// ---- GPS 模拟 ----

server.tool(
  'gps_authorize',
  '授权应用使用模拟位置（appops mock_location，A2 权限）',
  { pkg: z.string().describe('目标应用包名') },
  async (params) => {
    const r = await gpsAuthorize(params.pkg);
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool(
  'gps_set',
  '设置模拟 GPS 坐标（需先 gps_authorize，A2 权限）',
  { lat: z.number().min(-90).max(90).describe('纬度'), lng: z.number().min(-180).max(180).describe('经度'), jitter: z.number().min(0).optional().describe('周边抖动半径（米）'), pkg: z.string().optional().describe('目标应用包名') },
  async (params) => {
    const r = await gpsSet(params.lat, params.lng, { jitter: params.jitter || 0, pkg: params.pkg || '' });
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool('gps_status', '当前 GPS/模拟位置状态', async () => {
  const r = await gpsStatus();
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
});

server.tool('gps_clear', '清除模拟位置，恢复真实 GPS（A2 权限）', async () => {
  const r = await gpsClear();
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
});

// ---- Xposed / LSPosed ----

server.tool('xposed_status', 'LSPosed 框架状态（框架/管理器/Zygisk）', async () => {
  const r = await xposedStatus();
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
});

server.tool('xposed_manager', '启动 LSPosed Manager', async () => {
  const r = await xposedManager();
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
});

server.tool('xposed_modules', '列出 Xposed 模块（LSPosed db）', async () => {
  const r = await xposedModules();
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
});

server.tool(
  'xposed_set_module',
  '启用/禁用 Xposed 模块（A3 权限）',
  { pkg: z.string().describe('模块包名'), enabled: z.boolean().describe('true=启用') },
  async (params) => {
    const r = await xposedSetModule(params.pkg, params.enabled);
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool('xposed_hooks', '枚举设备可用的 hook 框架能力（LSPosed/Frida/Zygisk）', async () => {
  const r = await xposedHooks();
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
});

server.tool(
  'xposed_inject',
  '将已启用模块注入目标 App（重启生效，A3 权限）',
  { pkg: z.string().describe('目标 App 包名'), module: z.string().optional().describe('模块包名（默认全部启用）') },
  async (params) => {
    const r = await xposedInject(params.pkg, (params && params.module) || '');
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool(
  'xposed_verify',
  '验证模块在目标 App 进程生效',
  { pkg: z.string().describe('目标 App 包名') },
  async (params) => {
    const r = await xposedVerify(params.pkg);
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

// ---- 逆向工具（frida） ----

server.tool('frida_status', 'frida-server 状态', async () => {
  const r = await fridaStatus();
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
});

server.tool('frida_start', '启动 frida-server（root，A2 权限）', async () => {
  const r = await fridaStart();
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
});

server.tool('frida_stop', '停止 frida-server（root）', async () => {
  const r = await fridaStop();
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
});

server.tool('frida_ps', '列出设备进程（frida-ps 等价）', async () => {
  const r = await fridaPs();
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
});

server.tool(
  'frida_inject',
  '向进程注入 frida 脚本（A3 权限）',
  { target: z.string().describe('进程名/包名/PID'), script: z.string().describe('frida JS 脚本内容'), timeout: z.number().int().optional() },
  async (params) => {
    const r = await fridaInject(params.target, params.script, { timeout: params.timeout });
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool(
  'frida_spawn',
  '以 spawn 模式启动 App 并注入脚本（A3 权限）',
  { pkg: z.string().describe('包名'), script: z.string().describe('frida JS 脚本内容'), timeout: z.number().int().optional() },
  async (params) => {
    const r = await fridaSpawn(params.pkg, params.script, { timeout: params.timeout });
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool('frida_remote', '准备 frida 远程注入通道（adb forward 27042）', async () => {
  const r = await fridaRemote();
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
});

// ============ sensor-spoof（传感器模拟，P0，反检测核心） ============

server.tool('sensor_status', '列出设备全部传感器（类型/名称/厂商/版本）', async () => {
  const r = await sensorStatus();
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
});

server.tool(
  'sensor_read',
  '读取当前传感器值（dumpsys sensorservice 最近值）',
  { type: z.string().optional().describe('传感器类型，默认 all') },
  async (params) => {
    const r = await sensorRead(params.type || 'all');
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool(
  'sensor_spoof',
  '伪造传感器值（生成拟人数据流，保存为可回放 JSON；实际注入通道待 Xposed hook）',
  {
    type: z.string().describe('传感器类型'),
    x: z.number().optional().describe('X 值，默认 0'),
    y: z.number().optional().describe('Y 值，默认 0'),
    z: z.number().optional().describe('Z 值，默认 0'),
    jitter: z.number().optional().describe('抖动幅度，默认 0'),
    stream: z.string().optional().describe('数据流字符串，如 \"1,2,3;4,5,6\"'),
    duration: z.number().optional().describe('持续秒数，默认 10'),
    intervalMs: z.number().optional().describe('采样间隔 ms，默认 100'),
  },
  async (params) => {
    const r = await sensorSpoof(params.type, {
      x: params.x, y: params.y, z: params.z, jitter: params.jitter,
      stream: params.stream, duration: params.duration, intervalMs: params.intervalMs,
    });
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool(
  'sensor_record',
  '采集真人传感器数据（dumpsys 轮询，保存 JSON）',
  {
    type: z.string().describe('传感器类型'),
    duration: z.number().optional().describe('采集秒数，默认 5'),
    intervalMs: z.number().optional().describe('采样间隔 ms，默认 100'),
  },
  async (params) => {
    const r = await sensorRecord(params.type, {
      duration: params.duration, intervalMs: params.intervalMs,
    });
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool(
  'sensor_replay',
  '回放采集的数据流（提示注入通道）',
  { file: z.string().describe('回放文件路径') },
  async (params) => {
    const r = await sensorReplay(params.file);
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool('sensor_verify', '验证传感器伪造是否生效（对比读取值）', { type: z.string().describe('传感器类型') }, async (params) => {
  const r = await sensorVerify(params.type);
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
});

// ============ data-flywheel（数据飞轮，P0，数字分身进化根基） ============

server.tool(
  'data_record',
  '记录一次操作（统一格式：app/action/result/error/screenshot/ui_tree/screen_label）',
  {
    app: z.string().optional().describe('应用包名'),
    action: z.string().optional().describe('操作名称'),
    result: z.string().optional().describe('操作结果'),
    error: z.string().optional().describe('错误信息'),
    screenshot: z.string().optional().describe('截图路径'),
    ui_tree: z.string().optional().describe('布局树路径'),
    screen_label: z.string().optional().describe('屏幕标签'),
  },
  async (params) => {
    const r = await dataRecord(params);
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool('data_dataset', '数据集概览（按应用/结果分组统计）', async () => {
  const r = await dataDataset();
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
});

server.tool(
  'data_export',
  '导出数据集（JSONL）到本机',
  { app: z.string().optional().describe('按应用过滤'), format: z.string().optional().describe('输出格式，默认 jsonl') },
  async (params) => {
    const r = await dataExport({ app: params.app, format: params.format || 'jsonl' });
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool('data_metrics', '统计指标（成功率/失败类型）', async () => {
  const r = await dataMetrics();
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
});

server.tool(
  'replay_actions',
  '回放操作序列（准备动作，实际执行通过 input 工具）',
  { file: z.string().optional().describe('回放文件路径'), speed: z.number().optional().describe('回放速度倍数，默认 1') },
  async (params) => {
    const r = await replayActions({ file: params.file, speed: params.speed });
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  }
);

server.tool('data_verify', '验证数据集完整性', async () => {
  const r = await dataVerify();
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
});

// ============ 启动 ============

ensureDirs();
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('oneplus-phone-mcp server running (stdio)');
