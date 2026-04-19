import { execa } from 'execa';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import { mkdirSync } from 'fs';
import { homedir } from 'os';
import type { Platform, Mode } from './platform.js';

// execa registers SIGINT/SIGTERM listeners per subprocess and never removes
// them. Node's default limit is 10, so after ~10 downloads the
// MaxListenersExceededWarning fires. 0 = unlimited -- safe here because we
// deliberately want multiple signal handlers coexisting during batch runs.
process.setMaxListeners(0);

// -- Types ----------------------------------------------------------------
export interface DownloadOptions {
  url:            string;
  platform:       Platform;
  mode:           Mode;
  format:         string;
  quality?:       string;       // e.g. '1080', '720', '480', 'best'
  outputDir:      string;
  cookies?:       string | null;
  allowPlaylist?: boolean;
  retries?:       number;
  timeout?:       number;
  overwrite?:     boolean;
  writeInfoJson?: boolean;
  verbose?:       boolean;
  embedThumbnail?: boolean;
  subtitles?:     boolean;
  subtitleLangs?: string;
  autoSubtitles?: boolean;
}

export interface Progress {
  percent: number;
  speed:   string;
  eta:     string;
}

export interface MediaInfo {
  title:    string;
  uploader: string;
  duration: number | null;
  platform: Platform;
  formats:  FormatInfo[];
}

export interface FormatInfo {
  id:         string;
  ext:        string;
  resolution: string;
  height:     number | null;
  fps:        number | null;
  vcodec:     string;
  acodec:     string;
  filesize:   number | null;
  tbr?:       number;
  note:       string;
}

// -- Output markers -------------------------------------------------------
const PROGRESS_PREFIX = '__2JZ_PROGRESS__';
const FILE_PREFIX     = '__2JZ_FILE__';
const RE_DEST         = /\[download\] Destination: (.+)/;
const RE_MERGE        = /\[Merger\] Merging formats into "(.+)"/;
const RE_FFMPEG       = /\[(ffmpeg|ExtractAudio|ThumbnailsConvertor|EmbedThumbnail)\] Destination: (.+)/;
const RE_THUMBNAIL    = /Writing .*thumbnail(?: \d+)? to: (.+)/i;

// -- yt-dlp discovery -----------------------------------------------------
let _ytdlpPath: string | null = null;

export async function findYtDlp(): Promise<string> {
  if (_ytdlpPath) {
    try {
      await execa(_ytdlpPath, ['--version'], { reject: true });
      return _ytdlpPath;
    } catch { _ytdlpPath = null; }
  }

  const candidates = [
    'yt-dlp', 'yt_dlp', 'yt-dlp.exe',
    `${process.env.PREFIX ?? '/data/data/com.termux/files/usr'}/bin/yt-dlp`,
    `${process.env.HOME ?? ''}/.local/bin/yt-dlp`,
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
  ];

  for (const name of candidates) {
    try {
      await execa(name, ['--version'], { reject: true });
      _ytdlpPath = name;
      return _ytdlpPath;
    } catch { /* continue */ }
  }
  throw new Error('yt-dlp not found');
}

export function resetYtDlpCache(): void { _ytdlpPath = null; }

// FIX: was `reject: false` which always returned true even if ffmpeg isn't
// installed. Now properly checks exitCode AND caches the result -- previously
// this spawned a child process on every single download call.
let _hasFfmpeg: boolean | null = null;

export async function checkFfmpeg(): Promise<boolean> {
  if (_hasFfmpeg !== null) return _hasFfmpeg;
  try {
    const result = await execa('ffmpeg', ['-version'], { reject: false });
    _hasFfmpeg = result.exitCode === 0;
  } catch { _hasFfmpeg = false; }
  return _hasFfmpeg;
}

export function resetFfmpegCache(): void { _hasFfmpeg = null; }

// -- yt-dlp version & update ----------------------------------------------
export async function getYtDlpVersion(): Promise<string> {
  const bin = await findYtDlp();
  const { stdout } = await execa(bin, ['--version']);
  return stdout.trim();
}

/**
 * Check if a newer yt-dlp version is available.
 */
export async function checkYtDlpUpdate(): Promise<{
  current: string;
  latest: string;
  hasUpdate: boolean;
} | null> {
  try {
    const current = await getYtDlpVersion();
    const res = await fetch(
      'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest',
      { headers: { 'User-Agent': '2jz-downloader' }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data = await res.json() as { tag_name: string };
    const latest = data.tag_name.replace(/^v/, '');
    // yt-dlp versions are date-based (YYYY.MM.DD). Compare each segment as an
    // integer so "2025.04.01" > "2025.3.31" (month 4 > month 3, not "4" < "31").
    const parseVer = (v: string) => v.split('.').map((n) => Number.parseInt(n, 10));
    const latestParts  = parseVer(latest);
    const currentParts = parseVer(current);
    let hasUpdate = false;
    for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
      const l = latestParts[i]  ?? 0;
      const c = currentParts[i] ?? 0;
      if (l > c) { hasUpdate = true;  break; }
      if (l < c) { hasUpdate = false; break; }
    }
    return { current, latest, hasUpdate };
  } catch { return null; }
}

async function getYtDlpUpdateCommandParts(): Promise<string[]> {
  const bin = await findYtDlp();
  const isTermux = !!process.env.PREFIX?.includes('com.termux');
  const isWin    = process.platform === 'win32';
  const isMac    = process.platform === 'darwin';
  const homeBin  = `${homedir()}/.local/bin/`;

  if (isTermux) return ['pkg', 'upgrade', '-y', 'yt-dlp'];
  if (isWin)    return ['winget', 'upgrade', '--id', 'yt-dlp.yt-dlp', '-e'];
  if (isMac)    return ['brew', 'upgrade', 'yt-dlp'];
  if (bin.startsWith(homeBin)) return ['pip', 'install', '-U', '--user', 'yt-dlp'];
  return [bin, '--update'];
}

export async function getYtDlpUpdateCommand(): Promise<string> {
  return (await getYtDlpUpdateCommandParts()).join(' ');
}

export async function autoInstallDependencies(): Promise<boolean> {
  const os = process.platform;
  const isTermux = !!process.env.PREFIX?.includes('com.termux');

  try {
    if (isTermux) {
      await execa('pkg', ['install', '-y', 'yt-dlp', 'ffmpeg']);
    } else if (os === 'darwin') {
      await execa('brew', ['install', 'yt-dlp', 'ffmpeg', '--quiet']);
    } else if (os === 'linux') {
      // Try apt first (Debian/Ubuntu). Fall back to pip for yt-dlp if apt fails.
      let ytdlpInstalled = false;
      try {
        await execa('sudo', ['apt-get', 'update', '-y', '--quiet']);
        await execa('sudo', ['apt-get', 'install', '-y', 'yt-dlp', 'ffmpeg', '--quiet']);
        ytdlpInstalled = true;
      } catch {
        // apt failed -- try pip for yt-dlp (widely available on Linux)
        try {
          await execa('pip', ['install', '--user', '--quiet', 'yt-dlp']);
          ytdlpInstalled = true;
        } catch {
          throw new Error('Could not install yt-dlp via apt or pip. Install manually: https://github.com/yt-dlp/yt-dlp#installation');
        }
      }
      if (!ytdlpInstalled) {
        throw new Error('yt-dlp installation failed on Linux.');
      }
    } else if (os === 'win32') {
      await execa('winget', ['install', '--silent', 'yt-dlp.yt-dlp', 'ffmpeg.ffmpeg']);
    } else {
      throw new Error(`Unsupported platform: ${os}. Install yt-dlp and ffmpeg manually.`);
    }
    // Bust caches so the new binaries are discovered immediately
    resetYtDlpCache();
    resetFfmpegCache();
    return true;
  } catch (e: any) {
    throw new Error(`Auto-install failed: ${e.message}`);
  }
}

/**
 * Update yt-dlp using the same installation method we know how to suggest.
 */
export async function updateYtDlp(): Promise<boolean> {
  const parts = await getYtDlpUpdateCommandParts();
  try {
    await execa(parts[0], parts.slice(1), { stdio: 'pipe' });
    resetYtDlpCache();
    return true;
  } catch { return false; }
}

// -- Auto-install helpers (Legacy UI prompt) ------------------------------
function detectInstallCommands(): { ytdlp: string[]; ffmpeg: string[] } {
  const isTermux = !!process.env.PREFIX?.includes('com.termux');
  const isWin    = process.platform === 'win32';
  const isMac    = process.platform === 'darwin';
  if (isTermux) return {
    ytdlp:  ['pkg', 'install', '-y', 'yt-dlp'],
    ffmpeg: ['pkg', 'install', '-y', 'ffmpeg'],
  };
  if (isWin) return {
    ytdlp:  ['winget', 'install', 'yt-dlp.yt-dlp'],
    ffmpeg: ['winget', 'install', 'ffmpeg.ffmpeg'],
  };
  if (isMac) return {
    ytdlp:  ['brew', 'install', 'yt-dlp'],
    ffmpeg: ['brew', 'install', 'ffmpeg'],
  };
  return {
    ytdlp:  ['pip', 'install', '--user', 'yt-dlp'],
    ffmpeg: ['apt-get', 'install', '-y', 'ffmpeg'],
  };
}

export async function promptInstallYtDlp(): Promise<boolean> {
  const { ytdlp } = detectInstallCommands();
  const cmdStr    = ytdlp.join(' ');
  p.log.warn('yt-dlp is not installed -- it is required for all downloads.');
  const answer = await p.confirm({
    message: `Install it now with: ${chalk.cyan(cmdStr)}`,
    initialValue: true,
  });
  if (p.isCancel(answer) || !answer) return false;
  const s = p.spinner();
  s.start(`Installing yt-dlp`);
  try {
    await execa(ytdlp[0], ytdlp.slice(1), { stdio: 'pipe' });
    resetYtDlpCache();
    s.stop(chalk.green('[ok]') + '  yt-dlp installed');
    return true;
  } catch { s.stop(chalk.red('[!!]') + '  Install failed'); return false; }
}

export async function promptInstallFfmpeg(): Promise<boolean> {
  const { ffmpeg } = detectInstallCommands();
  const cmdStr     = ffmpeg.join(' ');
  p.log.warn('ffmpeg is not installed -- required for audio and high-quality video.');
  const answer = await p.confirm({
    message: `Install it now with: ${chalk.cyan(cmdStr)}`,
    initialValue: true,
  });
  if (p.isCancel(answer) || !answer) return false;
  const s = p.spinner();
  s.start(`Installing ffmpeg`);
  try {
    await execa(ffmpeg[0], ffmpeg.slice(1), { stdio: 'pipe' });
    resetFfmpegCache();
    s.stop(chalk.green('[ok]') + '  ffmpeg installed');
    return true;
  } catch { s.stop(chalk.red('[!!]') + '  Install failed'); return false; }
}

// -- Fetch metadata + available formats -----------------------------------
export async function fetchInfo(
  url: string,
  options: Partial<DownloadOptions> = {},
): Promise<MediaInfo> {
  const bin  = await findYtDlp();
  const args = [url, '--dump-json', '--quiet', '--no-warnings'];
  // --no-playlist is YouTube-specific -- don't apply it to other platforms
  if ((options.platform ?? 'generic') === 'youtube' && !options.allowPlaylist) {
    args.push('--no-playlist');
  }
  appendPlatformArgs(args, (options.platform ?? 'generic') as Platform);
  if (options.cookies) args.push('--cookies', options.cookies);

  const { stdout } = await execa(bin, args, { timeout: 30_000 });
  const d = JSON.parse(stdout) as Record<string, unknown>;

  const rawFormats = Array.isArray(d.formats) ? d.formats as Record<string, unknown>[] : [];

  // FIX: was filter(f => f.vcodec !== 'none') which dropped audio-only content
  // (SoundCloud tracks, music streams) entirely. Now we keep video streams for
  // video mode info, but audio-only streams are relevant too.
  const formats: FormatInfo[] = rawFormats
    .filter((f) => {
      // Keep formats that have either video or audio (not storyboard/thumbnails)
      const hasVideo = f.vcodec && f.vcodec !== 'none';
      const hasAudio = f.acodec && f.acodec !== 'none';
      const isStoryboard = String(f.format_note ?? '').toLowerCase().includes('storyboard');
      return (hasVideo || hasAudio) && !isStoryboard;
    })
    .map((f) => {
      const resolution = String(f.resolution ?? f.format_note ?? '');
      const note       = String(f.format_note ?? '');
      const height     = parseVideoHeight(resolution) ?? parseVideoHeight(note);
      return {
        id:         String(f.format_id ?? ''),
        ext:        String(f.ext ?? ''),
        resolution,
        height,
        fps:        typeof f.fps === 'number' ? f.fps : null,
        vcodec:     String(f.vcodec ?? ''),
        acodec:     String(f.acodec ?? ''),
        filesize:   typeof f.filesize === 'number' ? f.filesize : (typeof f.filesize_approx === 'number' ? f.filesize_approx : null),
        tbr:        typeof f.tbr === 'number' ? f.tbr : 0,
        note,
      };
    })
    .sort((a, b) => {
      if ((b.height ?? 0) !== (a.height ?? 0)) return (b.height ?? 0) - (a.height ?? 0);
      if (b.tbr !== a.tbr) return b.tbr! - a.tbr!;
      return (b.filesize ?? 0) - (a.filesize ?? 0);
    })
    .filter((f, i, arr) => {
      // Audio-only formats (no video stream) are all distinct -- never dedup them,
      // since the caller wants to see all available bitrates/codecs.
      const isAudioOnly = f.height === null && f.vcodec === 'none';
      if (isAudioOnly) return true;
      // For video formats, dedup by height so the list stays concise.
      const key = f.height ?? f.resolution;
      return arr.findIndex((x) => {
        const xIsAudioOnly = x.height === null && x.vcodec === 'none';
        if (xIsAudioOnly) return false;
        return (x.height ?? x.resolution) === key;
      }) === i;
    });

  return {
    title:    String(d.title    ?? 'Unknown'),
    uploader: String(d.uploader ?? d.channel ?? d.creator ?? 'Unknown'),
    duration: typeof d.duration === 'number' ? d.duration : null,
    platform: (options.platform ?? 'youtube') as Platform,
    formats,
  };
}

export function parseVideoHeight(value: string | undefined | null): number | null {
  if (!value) return null;
  const s = value.trim().toLowerCase();
  if (s === '4k') return 2160;
  if (s === '2k') return 1440;
  if (s === '8k') return 4320;
  if (s === 'qhd') return 1440;
  const resMatch = s.match(/(\d{2,5})\s*[x]\s*(\d{2,5})/);
  if (resMatch) return Number.parseInt(resMatch[2], 10);
  const progMatch = s.match(/(\d{3,4})p/);
  if (progMatch) return Number.parseInt(progMatch[1], 10);
  const bareMatch = s.match(/^(\d{2,4})$/);
  if (bareMatch) return Number.parseInt(bareMatch[1], 10);
  return null;
}

function getHeightLimit(quality: string): number {
  const height = parseVideoHeight(quality);
  if (height) return height;
  throw new Error(`Unsupported quality "${quality}". Use best or a height like 1080p, 720p, or 480p.`);
}

export function buildVideoSelector(format: string, quality?: string, hasFfmpeg = true): string[] {
  if (quality && quality !== 'best') {
    const h = String(getHeightLimit(quality));
    if (!hasFfmpeg) {
      if (format === 'mp4') return ['-f', `best[height<=${h}][ext=mp4]/best[height<=${h}]/best[ext=mp4]/best`];
      if (format === 'webm') return ['-f', `best[height<=${h}][ext=webm]/best[height<=${h}]/best[ext=webm]/best`];
      return ['-f', `best[height<=${h}]/best`];
    }
    if (format === 'mp4') {
      return [
        '-f', `(bv*[height<=${h}][ext=mp4]+ba[ext=m4a]/bv*[height<=${h}]+ba/b[height<=${h}][ext=mp4]/b[height<=${h}]/bv*+ba/b)`,
        '--merge-output-format', 'mp4',
      ];
    }
    if (format === 'webm') {
      return [
        '-f', `(bv*[height<=${h}][ext=webm]+ba[ext=webm]/bv*[height<=${h}]+ba/b[height<=${h}][ext=webm]/b[height<=${h}]/bv*+ba/b)`,
        '--merge-output-format', 'webm',
      ];
    }
    if (format === 'best') return ['-f', `(bv*[height<=${h}]+ba/b[height<=${h}]/bv*+ba/b)`];
    return [
      '-f', `(bv*[height<=${h}]+ba/b[height<=${h}]/bv*+ba/b)`,
      '--merge-output-format', format === 'mkv' ? 'mkv' : 'mp4',
    ];
  }

  if (!hasFfmpeg) {
    if (format === 'mp4') return ['-f', 'best[ext=mp4]/best'];
    if (format === 'webm') return ['-f', 'best[ext=webm]/best'];
    return ['-f', 'best'];
  }
  if (format === 'mp4') return ['-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b', '--merge-output-format', 'mp4'];
  if (format === 'webm') return ['-f', 'bv*[ext=webm]+ba[ext=webm]/b[ext=webm]/bv*+ba/b', '--merge-output-format', 'webm'];
  if (format === 'mkv') return ['-f', 'bv*+ba/b', '--merge-output-format', 'mkv'];
  return ['-f', 'bv*+ba/b'];
}

// -- Build yt-dlp arg list ------------------------------------------------
export function buildArgs(o: DownloadOptions, hasFfmpeg = true): string[] {
  const {
    url, mode, format, quality, outputDir, cookies,
    allowPlaylist = false, retries = 5, timeout = 30,
    overwrite = false, writeInfoJson = false, verbose = false,
    embedThumbnail = false, subtitles = false,
    subtitleLangs = 'en', autoSubtitles = false,
  } = o;

  const out  = `${outputDir}/%(title)s.%(ext)s`;
  const args = [url];

  appendPlatformArgs(args, o.platform);

  // FIX: removed '--all-subs' and '--embed-subs' from the base args -- they
  // caused yt-dlp warnings and errors for audio and image downloads.
  // Subtitle flags are now only added conditionally in the subtitles block below.
  // '--no-part' prevents .part garbage files when a download is interrupted.
  args.push(
    '--no-check-certificates',
    '--prefer-free-formats',
    '--add-metadata',
    '--fixup', 'warn',
    '--no-part',
  );

  if (mode === 'video') {
    args.push(...buildVideoSelector(format, quality, hasFfmpeg));
  } else if (mode === 'audio') {
    args.push('-f', 'bestaudio/best');
    if (format && format !== 'best') args.push('-x', '--audio-format', format, '--audio-quality', '0');
    // Only embed thumbnail in audio if ffmpeg is available (required for the conversion)
    if (embedThumbnail && hasFfmpeg && ['mp3', 'm4a', 'flac', 'opus'].includes(format)) {
      args.push('--embed-thumbnail');
    }
  } else if (mode === 'image') {
    if (o.platform === 'youtube') {
      // YouTube: thumbnail is a separate track -- use skip-download + write-thumbnail
      args.push('--skip-download', '--write-thumbnail');
      if (format && format !== 'original') args.push('--convert-thumbnails', format);
    } else if (o.platform === 'instagram' || o.platform === 'twitter') {
      // Instagram & Twitter: attempt to grab the thumbnail/image first.
      // --write-thumbnail writes the image; --skip-download avoids pulling the
      // full video when only an image is wanted. For carousels/stories that are
      // genuinely video-only, yt-dlp will still succeed with the thumbnail.
      args.push('--write-thumbnail', '--skip-download');
      if (format && format !== 'original') args.push('--convert-thumbnails', format);
    } else if (o.platform === 'reddit') {
      // Reddit: galleries and image posts are handled by yt-dlp's extractor.
      // A format selector would break multi-image galleries; let yt-dlp decide.
      args.push('-f', 'best');
    } else {
      // Pinterest, Tumblr, and all generics: yt-dlp's extractor exposes images
      // directly -- passing ANY -f selector causes "No video formats found".
      // No format flag = yt-dlp picks the best available representation.
    }
  }

  // Subtitles: only applies to video mode (not audio or image)
  if (subtitles && mode !== 'audio' && mode !== 'image') {
    args.push('--write-subs', '--sub-langs', subtitleLangs);
    if (autoSubtitles) args.push('--write-auto-subs');
    // FIX: was pushed twice before (once unconditionally, once here). Now only here.
    if (format === 'mkv') args.push('--embed-subs');
  }

  args.push(
    '-o', out,
    '--retries', String(retries),
    '--fragment-retries', String(retries),
    '--socket-timeout', String(timeout),
    '--progress',
    '--newline',
    '--progress-template', `download:${PROGRESS_PREFIX}%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s`,
    '--print', `after_move:${FILE_PREFIX}%(filepath)s`,
  );

  if (!verbose) args.push('--no-warnings');
  if (overwrite) args.push('--force-overwrites'); else args.push('--no-overwrites');
  if (writeInfoJson) args.push('--write-info-json');
  if (cookies) args.push('--cookies', cookies);
  // --no-playlist is YouTube-specific. Applying it to other platforms blocks
  // multi-image posts (Reddit galleries, Tumblr blogs, Pinterest boards).
  if (o.platform === 'youtube' && !allowPlaylist) args.push('--no-playlist');
  if (verbose) args.push('--verbose');

  return args;
}

function appendPlatformArgs(args: string[], platform: Platform): void {
  // Referer headers reduce 403s on platforms that check the origin of requests.
  const referers: Partial<Record<Platform, string>> = {
    instagram:   'https://www.instagram.com/',
    twitter:     'https://twitter.com/',
    tiktok:      'https://www.tiktok.com/',
    reddit:      'https://www.reddit.com/',
    pinterest:   'https://www.pinterest.com/',
    tumblr:      'https://www.tumblr.com/',
    vimeo:       'https://vimeo.com/',
    twitch:      'https://www.twitch.tv/',
    dailymotion: 'https://www.dailymotion.com/',
    facebook:    'https://www.facebook.com/',
  };
  const referer = referers[platform];
  if (referer) args.push('--referer', referer);
}

// -- Main download function -----------------------------------------------
const activeProcesses = new Set<any>();

function cleanupProcesses() {
  for (const proc of activeProcesses) {
    try { proc.kill('SIGKILL'); } catch { /* ignore */ }
  }
  activeProcesses.clear();
}

// Ensure cleanup on various termination signals
process.on('exit', cleanupProcesses);
process.on('SIGINT', () => { cleanupProcesses(); process.exit(0); });
process.on('SIGTERM', () => { cleanupProcesses(); process.exit(0); });

export async function download(
  options: DownloadOptions,
  onProgress: (prog: Progress) => void,
): Promise<string | undefined> {
  // Guard: Check disk space
  const free = await getFreeSpace(options.outputDir);
  if (free < 100 * 1024 * 1024) { // 100MB
    throw new Error('Critically low disk space (< 100MB). Free up some space before downloading.');
  }

  const maxRetries = options.retries ?? 3;
  const execOptions: DownloadOptions = { ...options, retries: 1 };
  let lastError: any;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await execDownload(execOptions, onProgress);
    } catch (e: any) {
      lastError = e;
      const msg = e.message.toLowerCase();
      if (
        msg.includes('format is not available') ||
        msg.includes('unsupported url') ||
        msg.includes('private video') ||
        msg.includes('video unavailable')
      ) {
        throw e;
      }
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10_000);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

async function execDownload(
  options: DownloadOptions,
  onProgress: (prog: Progress) => void,
): Promise<string | undefined> {
  const bin = await findYtDlp();
  const hasFfmpeg = await checkFfmpeg();

  return new Promise((resolve, reject) => {
    try { mkdirSync(options.outputDir, { recursive: true }); } catch { /* ok */ }

    let args: string[];
    try {
      args = buildArgs(options, hasFfmpeg);
    } catch (e) {
      reject(e);
      return;
    }

    const proc = execa(bin, args, { reject: false, all: true });
    activeProcesses.add(proc);

    let lastFile     = '';
    let mergedBuf    = '';
    let mergedOutput = '';

    proc.all?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      mergedOutput += text;
      mergedBuf    += text;
      const lines = mergedBuf.split('\n');
      mergedBuf    = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (!line) continue;

        if (line.startsWith(PROGRESS_PREFIX)) {
          const [percentRaw = '0', speedRaw = 'Unknown B/s', etaRaw = 'Unknown'] =
            line.slice(PROGRESS_PREFIX.length).split('|');
          const percent = Number.parseFloat(percentRaw.replace('%', '').trim());
          onProgress({
            percent: Number.isFinite(percent) ? percent : 0,
            speed:   speedRaw.trim() || 'Unknown B/s',
            eta:     etaRaw.trim()   || 'Unknown',
          });
          continue;
        }

        if (line.startsWith(FILE_PREFIX)) {
          lastFile = line.slice(FILE_PREFIX.length).trim();
          continue;
        }

        const dest = line.match(RE_DEST);
        if (dest)  { lastFile = dest[1].trim();  continue; }
        const merge = line.match(RE_MERGE);
        if (merge) { lastFile = merge[1].trim(); continue; }
        const ff = line.match(RE_FFMPEG);
        if (ff)    { lastFile = ff[2].trim();    continue; }
        const thumb = line.match(RE_THUMBNAIL);
        if (thumb) { lastFile = thumb[1].trim(); }
      }
    });

    proc.then((result) => {
      activeProcesses.delete(proc);
      if (mergedBuf.trim()) {
        const line = mergedBuf.trimEnd();
        if (line.startsWith(FILE_PREFIX)) {
          lastFile = line.slice(FILE_PREFIX.length).trim();
        } else {
          const dest  = line.match(RE_DEST);
          if (dest)  lastFile = dest[1].trim();
          const merge = line.match(RE_MERGE);
          if (merge) lastFile = merge[1].trim();
          const ff    = line.match(RE_FFMPEG);
          if (ff)    lastFile = ff[2].trim();
          const thumb = line.match(RE_THUMBNAIL);
          if (thumb) lastFile = thumb[1].trim();
        }
        mergedOutput += mergedBuf;
        mergedBuf = '';
      }
      if (result.exitCode === 0) {
        resolve(lastFile || undefined);
      } else {
        reject(new Error(cleanError(mergedOutput || `yt-dlp exited with code ${result.exitCode}.`)));
      }
    }).catch((err) => {
      activeProcesses.delete(proc);
      reject(new Error(cleanError(mergedOutput || err.message)));
    });
  });
}

function cleanError(raw: string): string {
  const lines = raw.split('\n');
  const errorLines = lines.filter((l) => /error|failed|unable|blocked/i.test(l) || l.startsWith('ERROR'));
  if (errorLines.length > 0) {
    return errorLines
      .map((l) => l.replace(/^ERROR:\s*/i, '').trim())
      .filter(Boolean)
      .join(' -- ');
  }
  return raw.trim().split('\n').pop() || 'Unknown error';
}

export function friendlyError(msg: string, platform: string, hasCookies: boolean, mode?: Mode): string {
  const low = msg.toLowerCase();
  const hints: string[] = [];

  if (low.includes('no video formats found'))
    hints.push('yt-dlp found no downloadable formats. Try updating yt-dlp in Setup, or the content may be behind a login.');
  if (low.includes('requested format is not available') || low.includes('invalid filter specification'))
    hints.push('Format or quality unavailable for this media. Try Auto mode or a lower quality.');
  if (mode === 'image' && low.includes('no video formats found'))
    hints.push('For image-only content, try Auto mode -- yt-dlp sometimes needs to decide the format itself.');
  if (!hasCookies && ['instagram', 'twitter', 'tiktok', 'pinterest', 'facebook', 'tumblr'].includes(platform)) {
    if (/private|login|cookie|sign in|age.restrict|rate.limit|403/.test(low))
      hints.push('Content may be restricted. Export cookies from your browser and set the path in Settings -> Cookies file.');
  }
  if (platform === 'pinterest' && (low.includes('403') || low.includes('no video formats')))
    hints.push('Pinterest blocks some downloads. Run: yt-dlp -U to update yt-dlp, then retry.');
  if (platform === 'facebook' && (low.includes('login') || low.includes('private')))
    hints.push('Facebook requires cookies for most videos. Export cookies from a logged-in browser session.');
  if (low.includes('video unavailable') || low.includes('has been removed'))
    hints.push('Content may be private, deleted, or geo-blocked.');
  if (low.includes('unsupported url'))
    hints.push('Make sure this is a direct post/video URL -- not a profile, search page, or homepage.');
  if (low.includes('ffmpeg'))
    hints.push('ffmpeg is required for this operation. Install it via Setup.');
  if (low.includes('network') || low.includes('connection') || low.includes('timed out'))
    hints.push('Network issue. Check your connection and try again, or increase the timeout in Settings.');
  if (/supported javascript runtime|yt-dlp-ejs/.test(low))
    hints.push('Update yt-dlp via Setup -> Check for yt-dlp update.');

  return hints.length
    ? `${msg}\n\n${hints.map((h) => `  -> ${h}`).join('\n')}`
    : msg;
}

/**
 * Get free disk space in bytes for a given path.
 */
export async function getFreeSpace(path: string): Promise<number> {
  const isWin = process.platform === 'win32';
  try {
    if (isWin) {
      const { stdout } = await execa('powershell', ['-Command', `(Get-PSDrive -Name $((Get-Item "${path}").PSDrive.Name)).Free`], { reject: false });
      return Number.parseInt(stdout.trim(), 10) || Infinity;
    } else {
      const { stdout } = await execa('df', ['-Pk', path], { reject: false });
      const lines = stdout.trim().split('\n');
      if (lines.length < 2) return Infinity;
      const parts = lines[1].split(/\s+/);
      return (Number.parseInt(parts[3], 10) * 1024) || Infinity; // df -k is in KB
    }
  } catch { return Infinity; }
}
