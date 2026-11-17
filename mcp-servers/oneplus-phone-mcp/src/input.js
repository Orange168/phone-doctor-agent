// input.js — 输入事件注入（scrcpy input 优先，回退 adb input）
import { runAdb } from './adb.js';
import { config } from './config.js';

const KEYCODE_MAP = {
  HOME: 3, BACK: 4, CALL: 5, ENDCALL: 6, '0': 7, '1': 8, '2': 9, '3': 10,
  '4': 11, '5': 12, '6': 13, '7': 14, '8': 15, '9': 16, STAR: 17, POUND: 18,
  DPAD_UP: 19, DPAD_DOWN: 20, DPAD_LEFT: 21, DPAD_RIGHT: 22, DPAD_CENTER: 23,
  VOLUME_UP: 24, VOLUME_DOWN: 25, POWER: 26, CAMERA: 27, CLEAR: 28,
  A: 29, B: 30, C: 31, D: 32, E: 33, F: 34, G: 35, H: 36, I: 37, J: 38,
  K: 39, L: 40, M: 41, N: 42, O: 43, P: 44, Q: 45, R: 46, S: 47, T: 48,
  U: 49, V: 50, W: 51, X: 52, Y: 53, Z: 54, COMMA: 55, PERIOD: 56,
  ALT_LEFT: 57, ALT_RIGHT: 58, SHIFT_LEFT: 59, SHIFT_RIGHT: 60, TAB: 61,
  SPACE: 62, ENTER: 66, DEL: 67, MENU: 82, SEARCH: 84, APP_SWITCH: 187,
  ESCAPE: 111, FORWARD_DEL: 112, CTRL_LEFT: 113, CTRL_RIGHT: 114,
  CAPS_LOCK: 115, SCROLL_LOCK: 116, META_LEFT: 117, META_RIGHT: 118,
  MOVE_HOME: 122, MOVE_END: 123, FOCUS_UP: 125, FOCUS_DOWN: 126,
  SYM: 63, NUM_LOCK: 143, EXPLORER: 64, ENVELOPE: 65, GRAVE: 68,
  MINUS: 69, EQUALS: 70, LEFT_BRACKET: 71, RIGHT_BRACKET: 72,
  BACKSLASH: 73, SEMICOLON: 74, APOSTROPHE: 75, SLASH: 76, AT: 77,
  NUMPAD_0: 144, NUMPAD_1: 145, NUMPAD_2: 146, NUMPAD_3: 147,
  NUMPAD_4: 148, NUMPAD_5: 149, NUMPAD_6: 150, NUMPAD_7: 151,
  NUMPAD_8: 152, NUMPAD_9: 153, NUMPAD_DIVIDE: 154, NUMPAD_MULTIPLY: 155,
  NUMPAD_SUBTRACT: 156, NUMPAD_ADD: 157, NUMPAD_DOT: 158, NUMPAD_COMMA: 159,
  NUMPAD_ENTER: 160, NUMPAD_EQUALS: 161, NUMPAD_LEFT_PAREN: 162,
  NUMPAD_RIGHT_PAREN: 163, MEDIA_PLAY_PAUSE: 85, MEDIA_STOP: 86,
  MEDIA_NEXT: 87, MEDIA_PREVIOUS: 88, MEDIA_REWIND: 89, MEDIA_FAST_FORWARD: 90,
  BRIGHTNESS_UP: 220, BRIGHTNESS_DOWN: 221,
};

/** 转义 adb input text 特殊字符 */
export function escapeAdbText(text) {
  // adb shell input text: 空格转 %s，特殊 shell 字符转义
  return text
    .replace(/\s/g, '%s')
    .replace(/([\\'"$`;|&<>()*?\[\]#~{}!])/g, '\\$1');
}

/** 解析 keycode：数字或名称 */
export function resolveKeycode(key) {
  if (/^\d+$/.test(String(key))) return parseInt(key, 10);
  const name = String(key).toUpperCase().replace(/^KEY_/, '');
  return KEYCODE_MAP[name] ?? null;
}

/**
 * 注入点击
 * @param {{x: number, y: number, duration_ms?: number, randomize?: boolean}} p
 */
export async function tap(p) {
  let { x, y } = p;
  if (p.randomize) {
    const jitter = 4;
    x += Math.round((Math.random() - 0.5) * 2 * jitter);
    y += Math.round((Math.random() - 0.5) * 2 * jitter);
  }
  const dur = p.duration_ms || 0;
  // scrcpy 无 control 会话时用 adb input
  const cmd = dur > 0
    ? `input swipe ${x} ${y} ${x} ${y} ${dur}`
    : `input tap ${x} ${y}`;
  const r = await runAdb(['shell', cmd], { timeout: 8000 });
  return { ok: r.code === 0, command: cmd, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
}

/**
 * 注入滑动
 * @param {{x1,y1,x2,y2,duration_ms?,steps?}} p
 */
export async function swipe(p) {
  const dur = p.duration_ms || 300;
  const steps = p.steps ? ` ${p.steps}` : '';
  const cmd = `input swipe ${p.x1} ${p.y1} ${p.x2} ${p.y2} ${dur}${steps}`;
  const r = await runAdb(['shell', cmd], { timeout: 8000 });
  return { ok: r.code === 0, command: cmd, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
}

/**
 * 输入文本
 * @param {{text: string, clear_first?: boolean}} p
 */
export async function inputText(p) {
  const results = [];
  if (p.clear_first) {
    // 全选删除
    const seq = ['input keyevent 113', 'input keyevent 113', 'input keyevent 67', 'input keyevent 67'];
    for (const cmd of seq) {
      const r = await runAdb(['shell', cmd], { timeout: 5000 });
      results.push({ command: cmd, ok: r.code === 0 });
    }
  }
  const escaped = escapeAdbText(p.text);
  const cmd = `input text ${escaped}`;
  const r = await runAdb(['shell', cmd], { timeout: 10000 });
  results.push({ command: cmd, ok: r.code === 0, stdout: r.stdout.trim(), stderr: r.stderr.trim() });
  return { ok: results.every((x) => x.ok), results };
}

/**
 * 按键
 * @param {{key: string|number, repeat?: number}} p
 */
export async function pressKey(p) {
  const code = resolveKeycode(p.key);
  if (code === null) return { ok: false, error: `unknown key: ${p.key}` };
  const repeat = p.repeat || 1;
  const cmds = [];
  for (let i = 0; i < repeat; i++) {
    const cmd = `input keyevent ${code}`;
    const r = await runAdb(['shell', cmd], { timeout: 5000 });
    cmds.push({ command: cmd, ok: r.code === 0, stderr: r.stderr.trim() });
  }
  return { ok: cmds.every((c) => c.ok), keycode: code, results: cmds };
}
