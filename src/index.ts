#!/usr/bin/env node
/**
 * 2jz -- media downloader CLI
 *
 * Run with no arguments for the interactive TUI menu.
 * Run with a URL for quick non-interactive mode.
 */

import { program } from 'commander';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import { readFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { createRequire } from 'module';

import { headerLine, bar as themeBar } from './ui/theme.js';
import { runInteractive } from './commands/interactive.js';
import {
  normalizeUrl, detectPlatform, validateUrlShape, defaultFormat, resolveAutoMode,
  type Mode,
} from './core/platform.js';
import {
  download, fetchInfo, findYtDlp, friendlyError,
  checkYtDlpUpdate, updateYtDlp, getYtDlpVersion,
  type DownloadOptions,
} from './core/downloader.js';
import { cfg, loadHistory, pushHistory } from './core/config.js';

// -- Process error boundaries ---------------------------------------------
// Unhandled promise rejections would otherwise dump a raw stack trace on screen.
// Real products catch these and show a clean, actionable message instead.
process.on('unhandledRejection', (reason: unknown) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  // Suppress noisy execa pipe errors that occur when the user cancels a download
  if (msg.includes('write EPIPE') || msg.includes('ERR_STREAM_DESTROYED')) return;
  console.error(chalk.red('\n  [!!]  Unexpected error:'), chalk.dim(msg));
  console.error(chalk.dim('     Run with --verbose for full details.'));
  process.exitCode = 1;
});

process.on('uncaughtException', (err: Error) => {
  // Suppress broken-pipe errors (e.g. user pipes output to `head`)
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') {
    process.exit(0);
  }
  console.error(chalk.red('\n  [!!]  Fatal error:'), chalk.dim(err.message));
  process.exit(1);
});

// Ctrl-C: restore terminal cursor, print a clean exit line, then quit.
// Without this, @clack/prompts leaves the cursor hidden on some terminals.
process.on('SIGINT', () => {
  process.stdout.write('\x1B[?25h'); // show cursor
  console.log(chalk.dim('\n  Cancelled.'));
  process.exit(0);
});

// Version is managed by release script
const version = '1.5.7';

// -- CLI definition -------------------------------------------------------
program
  .name('2jz')
  .description('Media downloader -- YouTube, Instagram, Twitter/X, TikTok, SoundCloud, Reddit & more')
  .version(
    `${version}\nNode.js ${process.version}  ${process.platform}-${process.arch}`,
    '-v, --version',
  )
  .argument('[url]', 'URL to download (omit for interactive mode)')
  .option('-m, --mode <mode>',    'video | audio | image | auto', 'auto')
  .option('-f, --format <fmt>',   'output format (mp3, mp4, mkv, flac ...)')
  .option('-q, --quality <q>',    'video quality: best | 1080p | 720p | 480p | 360p', 'best')
  .option('-o, --output <dir>',   'output directory')
  .option('--cookies <file>',     'Netscape cookies.txt file')
  .option('--allow-playlist',     'allow YouTube playlists / channels')
  .option('--overwrite',          'overwrite existing files')
  .option('--embed-thumbnail',    'embed thumbnail in audio file')
  .option('--subtitles',          'download subtitles (video mode)')
  .option('--sub-langs <langs>',  'subtitle language codes, comma-separated', 'en')
  .option('--info',               'print metadata without downloading')
  .option('--history',            'show recent download history and exit')
  .option('--batch <file>',       'download all URLs in a .txt file')
  .option('--concurrency <n>',    'parallel downloads for batch mode (default: 1)', '1')
  .option('--verbose',            'show yt-dlp debug output')
  .addHelpText('after', `
Examples:
  $ 2jz                                        interactive TUI menu
  $ 2jz https://youtu.be/dQw4w9WgXcQ          auto-detect + download
  $ 2jz URL -m audio -f mp3                   audio -> MP3
  $ 2jz URL -m video -f mp4 -q 720p           720p MP4
  $ 2jz URL -m video --subtitles              video + subtitles
  $ 2jz URL -m audio --embed-thumbnail        MP3 with cover art
  $ 2jz URL --info                            metadata only
  $ 2jz --batch urls.txt -m audio             batch audio download
  $ 2jz --batch urls.txt --concurrency 3      parallel batch (3 at once)
  $ 2jz --history                             view recent history
  `);

// -- Parse & dispatch -----------------------------------------------------
program.action(async (url: string | undefined, opts: {
  mode:            Mode;
  format?:         string;
  quality:         string;
  output?:         string;
  cookies?:        string;
  // Commander sets boolean flags to `true` when present, `undefined` when absent.
  // Use `?? false` everywhere to normalise the type to boolean.
  allowPlaylist?:  boolean;
  overwrite?:      boolean;
  embedThumbnail?: boolean;
  subtitles?:      boolean;
  subLangs:        string;
  info?:           boolean;
  history?:        boolean;
  batch?:          string;
  concurrency:     string;
  verbose?:        boolean;
}) => {
  // -- --history flag -------------------------------------------------------
  if (opts.history) {
    const history = loadHistory().slice(-25).reverse();
    if (!history.length) { console.log(chalk.dim('No download history yet.')); return; }
    for (const e of history) {
      const mark = e.status === 'success' ? chalk.green('[ok]') : chalk.red('[!!]');
      console.log(`${mark}  ${chalk.dim(e.timestamp.slice(0, 16).replace('T', ' '))}  ${e.url}`);
    }
    return;
  }

  // -- No URL and no batch -> interactive TUI --------------------------------
  if (!url && !opts.batch) { await runInteractive(); return; }

  const config  = cfg.get();
  const outDir  = opts.output  ?? config.outputDir;
  const cookies = opts.cookies ?? config.cookies ?? undefined;

  try { mkdirSync(outDir, { recursive: true }); } catch { /* fine */ }

  // -- --batch FILE ---------------------------------------------------------
  if (opts.batch) {
    const batchPath = opts.batch.replace(/^~/, homedir());
    let lines: string[];
    try {
      lines = readFileSync(batchPath, 'utf8')
        .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    } catch (e: any) { console.error(chalk.red(`Cannot read batch file: ${e.message}`)); process.exit(1); }

    const concurrency = Math.max(1, Math.min(10, Number.parseInt(opts.concurrency, 10) || 1));
    console.log(headerLine());
    console.log(chalk.dim(`Batch: ${lines.length} URLs · concurrency ${concurrency}\n`));

    let passed = 0, failed = 0;

    for (let i = 0; i < lines.length; i += concurrency) {
      const chunk = lines.slice(i, i + concurrency);
      const results = await Promise.allSettled(chunk.map(async (rawUrl, j) => {
        const idx = i + j + 1;
        console.log(chalk.dim(`[${idx}/${lines.length}]`) + `  ${rawUrl}`);
        const normUrl  = normalizeUrl(rawUrl);
        const platform = detectPlatform(normUrl);
        const rawMode  = opts.mode;
        const mode     = rawMode === 'auto' ? resolveAutoMode(platform) : rawMode;
        const format   = opts.format ?? defaultFormat(mode);
        await downloadNonInteractive({
          url: normUrl, platform, mode, format, quality: opts.quality,
          outputDir: outDir, cookies, retries: config.retries, timeout: config.timeout,
          overwrite:      opts.overwrite      ?? false,
          allowPlaylist:  opts.allowPlaylist   ?? config.allowPlaylist,
          embedThumbnail: opts.embedThumbnail  ?? false,
          subtitles:      opts.subtitles       ?? false,
          subtitleLangs:  opts.subLangs,
          autoSubtitles:  config.autoSubtitles,
          verbose:        opts.verbose         ?? false,
        });
      }));

      for (const r of results) {
        if (r.status === 'fulfilled') passed++;
        else { console.error(chalk.red(`  [!!]  ${r.reason?.message ?? r.reason}`)); failed++; }
      }
    }

    console.log(`\n${chalk.green(String(passed))} succeeded  ·  ${chalk.red(String(failed))} failed`);
    return;
  }

  // -- Single URL mode ------------------------------------------------------
  let normUrl!: string;
  let platform!: ReturnType<typeof detectPlatform>;

  try {
    normUrl  = normalizeUrl(url!);
    platform = detectPlatform(normUrl);
    if (platform !== 'generic') {
      validateUrlShape(normUrl, platform, opts.allowPlaylist ?? config.allowPlaylist);
    }
  } catch (e: any) { console.error(chalk.red(`[!!]  ${e.message}`)); process.exit(1); }

  const rawMode = opts.mode;
  // Smart auto-mode: resolve 'auto' -> concrete mode based on platform semantics
  // (SoundCloud -> audio, Pinterest -> image, everything else -> video)
  const mode   = rawMode === 'auto' ? resolveAutoMode(platform) : rawMode;
  const format = opts.format ?? defaultFormat(mode);
  console.log(headerLine());

  if (opts.info) {
    try {
      const info = await fetchInfo(normUrl, { platform, cookies });
      console.log(`\n  ${chalk.bold(info.title)}`);
      console.log(`  ${chalk.dim('Platform')}  ${platform}`);
      console.log(`  ${chalk.dim('Uploader')}  ${info.uploader}`);
      console.log(`  ${chalk.dim('Duration')}  ${info.duration ?? 'unknown'}`);
      if (info.formats.length) {
        console.log(`  ${chalk.dim('Formats')}   ${info.formats.map((f) => f.resolution).join(', ')}`);
      }
      console.log();
    } catch (e: any) { console.error(chalk.red(`[!!]  ${e.message}`)); process.exit(1); }
    return;
  }

  await downloadNonInteractive({
    url:            normUrl,
    platform,
    mode,
    format,
    quality:        opts.quality,
    outputDir:      outDir,
    cookies,
    retries:        config.retries,
    timeout:        config.timeout,
    overwrite:      opts.overwrite      ?? false,
    writeInfoJson:  config.writeInfoJson,
    allowPlaylist:  opts.allowPlaylist   ?? config.allowPlaylist,
    verbose:        opts.verbose         ?? false,
    embedThumbnail: opts.embedThumbnail  ?? false,
    subtitles:      opts.subtitles       ?? false,
    subtitleLangs:  opts.subLangs,
    autoSubtitles:  config.autoSubtitles,
  });
});

// -- Non-interactive download runner --------------------------------------
async function downloadNonInteractive(options: DownloadOptions): Promise<void> {
  const s = p.spinner();
  s.start('Downloading');

  try {
    const saved = await download(options, (prog) => {
      const pct = Math.round(prog.percent);
      s.message(`${themeBar(pct)}  ${String(pct).padStart(3)}%  ·  ${prog.speed}  ·  ETA ${prog.eta}`);
    });

    s.stop(chalk.green('[ok]') + '  Done');
    if (saved) console.log(`  ${chalk.dim('Saved')}  ${saved}`);

    pushHistory({
      timestamp: new Date().toISOString(),
      url: options.url, platform: options.platform,
      mode: options.mode, format: options.format,
      quality: options.quality,
      outputDir: options.outputDir, status: 'success', filename: saved ?? undefined,
    });
  } catch (e: any) {
    s.stop(chalk.red('[!!]') + '  Failed');
    const msg = friendlyError(e.message, options.platform, !!options.cookies, options.mode);
    console.error(`\n  ${chalk.red(msg)}\n`);
    pushHistory({
      timestamp: new Date().toISOString(),
      url: options.url, platform: options.platform,
      mode: options.mode, format: options.format,
      quality: options.quality,
      outputDir: options.outputDir, status: 'failed', error: e.message,
    });
    process.exitCode = 1;
    throw e; // re-throw so batch runner counts failures correctly
  }
}

// -- 2jz update -----------------------------------------------------------
program
  .command('update')
  .description('Check for and apply yt-dlp updates, and check for 2jz updates')
  .action(async () => {
    console.log(headerLine());
    console.log();

    // -- Check 2jz itself -----------------------------------------------------
    const selfSpinner = p.spinner();
    selfSpinner.start('Checking for 2jz updates...');
    try {
      const res  = await fetch(`https://registry.npmjs.org/2jz-media-downloader/latest`,
        { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const data   = await res.json() as { version: string };
        const latest = data.version;
        // Semver: compare each segment (major.minor.patch) as integers.
        // localeCompare with numeric:true mishandles zero-padded segments.
        const parseV = (v: string) => v.replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10));
        const lp = parseV(latest), cp = parseV(version);
        let isNewer = false;
        for (let i = 0; i < Math.max(lp.length, cp.length); i++) {
          const l = lp[i] ?? 0, c = cp[i] ?? 0;
          if (l > c) { isNewer = true;  break; }
          if (l < c) { isNewer = false; break; }
        }
        if (isNewer) {
          selfSpinner.stop(chalk.yellow('[^]') + `  2jz update available: ${chalk.dim(version)} -> ${chalk.bold.green(latest)}`);
          console.log(chalk.dim(`     npm install -g 2jz-media-downloader@${latest}`));
        } else {
          selfSpinner.stop(chalk.green('[ok]') + `  2jz is up to date  ${chalk.dim(`(v${version})`)}`);
        }
      } else {
        selfSpinner.stop(chalk.dim('Could not reach npm registry.'));
      }
    } catch {
      selfSpinner.stop(chalk.dim('Could not reach npm registry.'));
    }

    console.log();

    // -- Check yt-dlp ---------------------------------------------------------
    const s = p.spinner();
    s.start('Checking yt-dlp version...');

    let current: string;
    try {
      current = await getYtDlpVersion();
    } catch {
      s.stop(chalk.red('[!!]  yt-dlp not found. Run 2jz and use Setup to install it.'));
      process.exitCode = 1;
      return;
    }

    const info = await checkYtDlpUpdate();
    if (!info) {
      s.stop(chalk.dim(`Current: ${current}  ·  Could not reach GitHub to check for updates.`));
      return;
    }

    if (!info.hasUpdate) {
      s.stop(chalk.green('[ok]') + `  yt-dlp is up to date  ${chalk.dim(`(${info.current})`)}`);
      return;
    }

    s.stop(
      chalk.yellow('[^]') +
      `  yt-dlp update available: ${chalk.dim(info.current)} -> ${chalk.bold.green(info.latest)}`
    );

    const confirmed = await p.confirm({ message: 'Update yt-dlp now?', initialValue: true });
    if (p.isCancel(confirmed) || !confirmed) return;

    const us = p.spinner();
    us.start('Updating yt-dlp...');
    const ok = await updateYtDlp();
    if (ok) {
      const newVer = await getYtDlpVersion().catch(() => info.latest);
      us.stop(chalk.green('[ok]') + `  yt-dlp updated to ${chalk.bold(newVer)}`);
    } else {
      us.stop(chalk.red('[!!]  Update failed. Try running the update command manually.'));
      process.exitCode = 1;
    }
  });

program.parse();
