import { LOG_LEVEL } from './config';

const LEVEL_ORDER: { [key: string]: number | undefined } = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = LEVEL_ORDER[LOG_LEVEL] ?? 1;

function formatData(data: { [key: string]: unknown }): string {
  const lines: string[] = [];
  for (const key of Object.keys(data)) {
    const val = typeof data[key] === 'string' ? data[key] : JSON.stringify(data[key]);
    lines.push(`  ${key}: ${val}`);
  }
  return lines.join('\n');
}

function log(level: string, levelNum: number, message: string, data?: { [key: string]: unknown }): void {
  if (levelNum < currentLevel) return;
  const tag = `[Sync] [${level.toUpperCase()}]`;
  const line = `${tag} ${message}`;
  if (levelNum >= 2) {
    // warn, error → stderr
    console.error(data ? `${line}\n${formatData(data)}` : line);
  } else {
    console.log(data ? `${line}\n${formatData(data)}` : line);
  }
}

export function debug(message: string, data?: { [key: string]: unknown }): void {
  log('debug', 0, message, data);
}

export function info(message: string, data?: { [key: string]: unknown }): void {
  log('info', 1, message, data);
}

export function warn(message: string, data?: { [key: string]: unknown }): void {
  log('warn', 2, message, data);
}

export function error(message: string, data?: { [key: string]: unknown }): void {
  log('error', 3, message, data);
}

/**
 * 두 객체의 서브키를 비교하여 달라진 키만 출력한다.
 * debug 레벨에서만 동작.
 */
export function diffObjects(
  label: string,
  oldObj: { [key: string]: unknown } | undefined,
  newObj: { [key: string]: unknown } | undefined,
): void {
  if (currentLevel > 0) return; // debug only
  const old = oldObj || {};
  const cur = newObj || {};
  const allKeys = new Set([...Object.keys(old), ...Object.keys(cur)]);
  const diffs: string[] = [];
  for (const key of allKeys) {
    const ov = JSON.stringify(old[key]);
    const nv = JSON.stringify(cur[key]);
    if (ov !== nv) {
      const truncate = (s: string | undefined): string => {
        if (!s) return 'undefined';
        return s.length > 200 ? s.slice(0, 200) + '...' : s;
      };
      diffs.push(`  ${key}: ${truncate(ov)} → ${truncate(nv)}`);
    }
  }
  if (diffs.length > 0) {
    console.log(`[Sync] [DEBUG] ${label} diff (${diffs.length} keys changed)\n${diffs.join('\n')}`);
  }
}

export const isDebug = currentLevel === 0;
