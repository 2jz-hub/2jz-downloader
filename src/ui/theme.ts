import chalk from 'chalk';
import { createRequire } from 'module';
import type { Platform, Mode } from '../core/platform.js';

const _version = '1.5.7';

// -- Brand ------------------------------------------------------------------
export const BRAND = {
  name:    '2jz',
  tagline: 'media downloader',
  version: _version,
  url:     'https://github.com/2jz-hub/2jz-downloader',
} as const;

// -- Semantic colour palette ------------------------------------------------
export const clr = {
  accent:     (s: string) => chalk.cyan(s),
  boldAccent: (s: string) => chalk.bold.cyan(s),
  dim:        (s: string) => chalk.dim(s),
  success:    (s: string) => chalk.green(s),
  error:      (s: string) => chalk.red(s),
  warn:       (s: string) => chalk.yellow(s),
  muted:      (s: string) => chalk.gray(s),
  bold:       (s: string) => chalk.bold(s),
  info:       (s: string) => chalk.blue(s),
  white:      (s: string) => chalk.white(s),
};

// -- Platform colours & badges ---------------------------------------------
const PLATFORM_STYLES: Record<Platform, { color: (s: string) => string; badge: string }> = {
  youtube:     { color: chalk.red,            badge: chalk.bgRed.white.bold('  YT  ') },
  instagram:   { color: chalk.magenta,        badge: chalk.bgMagenta.white.bold('  IG  ') },
  twitter:     { color: chalk.blue,           badge: chalk.bgBlue.white.bold('  X   ') },
  tiktok:      { color: chalk.whiteBright,    badge: chalk.bgWhite.black.bold(' TikTok ') },
  soundcloud:  { color: chalk.yellow,         badge: chalk.bgYellow.black.bold('  SC  ') },
  reddit:      { color: chalk.hex('#FF4500'), badge: chalk.bgHex('#FF4500').white.bold(' Reddit ') },
  pinterest:   { color: chalk.red,            badge: chalk.bgRed.white.bold('  Pin ') },
  tumblr:      { color: chalk.hex('#35465C'), badge: chalk.bgHex('#35465C').white.bold(' Tumblr ') },
  vimeo:       { color: chalk.hex('#1AB7EA'), badge: chalk.bgHex('#1AB7EA').white.bold(' Vimeo  ') },
  twitch:      { color: chalk.hex('#9146FF'), badge: chalk.bgHex('#9146FF').white.bold(' Twitch ') },
  dailymotion: { color: chalk.hex('#0066DC'), badge: chalk.bgHex('#0066DC').white.bold('  DM  ') },
  facebook:    { color: chalk.hex('#1877F2'), badge: chalk.bgHex('#1877F2').white.bold('  FB  ') },
  generic:     { color: chalk.white,          badge: chalk.bgGray.white.bold('  Web ') },
};

export function platformColor(platform: Platform): (s: string) => string {
  return PLATFORM_STYLES[platform]?.color ?? chalk.white;
}

export function platformBadge(platform: Platform): string {
  return PLATFORM_STYLES[platform]?.badge ?? PLATFORM_STYLES.generic.badge;
}

// -- Mode labels -----------------------------------------------------------
const MODE_LABELS: Record<Mode, string> = {
  video: chalk.cyan('[Video]'),
  audio: chalk.magenta('[Audio]'),
  image: chalk.yellow('[Image]'),
  auto:  chalk.dim('[Auto]'),
};

export function modeLabel(mode: Mode): string {
  return MODE_LABELS[mode] ?? chalk.dim(mode);
}

// -- Status icons (ASCII-safe) --------------------------------------------
export const ICON = {
  ok:       chalk.green('[ok]'),
  fail:     chalk.red('[!!]'),
  warn:     chalk.yellow('[!]'),
  info:     chalk.blue('[i]'),
  arrow:    chalk.cyan('>'),
  dot:      chalk.dim('.'),
  download: chalk.cyan('[dl]'),
  check:    chalk.dim('-'),
} as const;

// -- Progress bar ---------------------------------------------------------
export function bar(percent: number, width = 28): string {
  const clamped = Math.max(0, Math.min(100, percent ?? 0));
  const filled  = Math.round((clamped / 100) * width);
  return chalk.cyan('#'.repeat(filled)) + chalk.dim('.'.repeat(width - filled));
}

// -- Formatters -----------------------------------------------------------
export function fmtDuration(seconds: number | undefined | null): string {
  if (seconds === null || seconds === undefined || seconds < 0) return chalk.dim('--');
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return chalk.dim('--');
  if (bytes < 1024)          return `${bytes} B`;
  if (bytes < 1_048_576)     return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
}

export function fmtTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return `${date} ${time}`;
  } catch { return iso.slice(0, 16).replace('T', ' '); }
}

export function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return iso.slice(0, 10); }
}

// -- Header ---------------------------------------------------------------
export function headerLine(): string {
  const name    = chalk.bold.cyan(BRAND.name);
  const sep     = chalk.dim('  |  ');
  const tagline = chalk.dim(BRAND.tagline);
  const ver     = chalk.dim(`v${BRAND.version}`);
  return `${name}${sep}${tagline}${sep}${ver}`;
}

// -- Env status banner (shown at startup) ---------------------------------
export function envBanner(ytdlpVer: string | null, ffmpegOk: boolean): string {
  const ytIcon  = ytdlpVer ? ICON.ok : ICON.fail;
  const ytLabel = ytdlpVer
    ? `yt-dlp ${chalk.dim(ytdlpVer)}`
    : chalk.red('yt-dlp not found');
  const ffIcon  = ffmpegOk ? ICON.ok : chalk.yellow('[--]');
  const ffLabel = ffmpegOk ? 'ffmpeg' : chalk.yellow('ffmpeg not found');

  return `  ${ytIcon} ${ytLabel}   ${ffIcon} ${ffLabel}`;
}

// -- Section divider ------------------------------------------------------
export function divider(label?: string): string {
  const width = 52;
  if (!label) return chalk.dim('-'.repeat(width));
  const pad   = Math.max(0, width - label.length - 2);
  const left  = Math.floor(pad / 2);
  const right = pad - left;
  return chalk.dim(`${'-'.repeat(left)} `) + chalk.dim.bold(label) + chalk.dim(` ${'-'.repeat(right)}`);
}

// -- Media info card ------------------------------------------------------
export interface CardField { label: string; value: string; }

export function infoCard(title: string, fields: CardField[]): string {
  const lines: string[] = [];
  const titleLine = chalk.bold.white(
    title.length > 60 ? title.slice(0, 57) + '...' : title
  );
  lines.push('');
  lines.push(`  ${titleLine}`);
  lines.push('');
  for (const { label, value } of fields) {
    const padLabel = label.padEnd(12);
    lines.push(`  ${chalk.dim(padLabel)}  ${value}`);
  }
  lines.push('');
  return lines.join('\n');
}

// -- History table row ----------------------------------------------------
export function historyRow(
  index: number,
  status: 'success' | 'failed',
  timestamp: string,
  platform: string,
  url: string,
): string {
  const icon    = status === 'success' ? ICON.ok : ICON.fail;
  const ts      = chalk.dim(fmtTimestamp(timestamp));
  const badge   = chalk.dim(`[${(platform as Platform) === 'generic' ? 'web' : platform}]`);
  const shortUrl = url.length > 46 ? url.slice(0, 43) + '...' : url;
  const num     = chalk.dim(String(index + 1).padStart(3));
  return `${num}  ${icon}  ${ts}  ${badge.padEnd(13)}  ${shortUrl}`;
}

// -- Queue row ------------------------------------------------------------
export function queueRow(index: number, item: {
  status: string; platform: string; mode: string; format: string; url: string;
}): string {
  const statusColor: Record<string, (s: string) => string> = {
    pending:     chalk.dim,
    downloading: chalk.cyan,
    done:        chalk.green,
    failed:      chalk.red,
    skipped:     chalk.yellow,
  };
  const color  = statusColor[item.status] ?? chalk.white;
  const status = color(item.status.padEnd(11));
  const tag    = chalk.dim(`${item.mode}/${item.format}`);
  const num    = chalk.dim(String(index + 1).padStart(3));
  const shortUrl = item.url.length > 38 ? item.url.slice(0, 35) + '...' : item.url;
  return `${num}  ${status}  ${tag.padEnd(12)}  ${shortUrl}`;
}

// -- Summary box (shown after batch completes) ----------------------------
export function summaryBox(passed: number, failed: number, skipped: number): string {
  const total = passed + failed + skipped;
  // Build each content string at a FIXED visible width of 32 chars BEFORE
  // applying chalk colours -- padEnd counts bytes including ANSI escape codes,
  // so colouring first makes the padding always too short, breaking the border.
  const w = 32;
  const line1 = ('  Done').padEnd(w);
  const line2 = (`     ${passed} of ${total} succeeded`).padEnd(w);
  const line3 = (`     ${failed} failed`).padEnd(w);
  const line4 = (`     ${skipped} skipped`).padEnd(w);

  const lines = [
    '',
    chalk.dim('  +' + '-'.repeat(32) + '+'),
    chalk.dim('  |') + chalk.bold.white('  Download Summary               ') + chalk.dim('|'),
    chalk.dim('  +' + '-'.repeat(32) + '+'),
    chalk.dim('  |') + chalk.green(line1) + chalk.dim('|'),
    chalk.dim('  |') + (passed > 0 ? chalk.green(line2) : chalk.dim(line2)) + chalk.dim('|'),
    chalk.dim('  |') + (failed  > 0 ? chalk.red(line3)    : chalk.dim(line3))    + chalk.dim('|'),
    chalk.dim('  |') + (skipped > 0 ? chalk.yellow(line4) : chalk.dim(line4))    + chalk.dim('|'),
    chalk.dim('  +' + '-'.repeat(32) + '+'),
    '',
  ];
  return lines.join('\n');
}
