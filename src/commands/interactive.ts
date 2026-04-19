/**
 * interactive.ts -- Full TUI for 2jz
 *
 * Every flow is fully implemented. No stubs. No silent failures.
 * Flows: Download · Queue · Batch · History · Settings · Setup
 */

import * as p from '@clack/prompts';
import chalk from 'chalk';
import { readFileSync, mkdirSync, existsSync, statSync } from 'fs';
import { homedir } from 'os';
import { resolve } from 'path';
import { randomUUID } from 'crypto';

import {
  headerLine, envBanner, infoCard, historyRow, queueRow,
  summaryBox, divider, platformBadge, modeLabel,
  clr, ICON, bar, fmtDuration, fmtBytes, fmtTimestamp, fmtDate,
} from '../ui/theme.js';

import {
  detectPlatform, normalizeUrl, validateUrlShape, defaultFormat,
  platformLabel, supportsImageMode, supportsImageConversion,
  isAudioPlatform, resolveAutoMode,
  AUDIO_FORMATS, VIDEO_FORMATS, IMAGE_FORMATS,
  type Platform, type Mode,
} from '../core/platform.js';

import {
  cfg, loadHistory, pushHistory, loadQueue, saveQueue,
  clearFinishedFromQueue,
  type Config, type HistoryEntry, type QueueItem,
} from '../core/config.js';

import {
  download, fetchInfo, findYtDlp, checkFfmpeg,
  promptInstallYtDlp, promptInstallFfmpeg,
  resetYtDlpCache, resetFfmpegCache, friendlyError,
  checkYtDlpUpdate, updateYtDlp, getYtDlpVersion,
  type DownloadOptions,
} from '../core/downloader.js';

// -- Helpers --------------------------------------------------------------

/** Cancel-safe select -- returns undefined on Ctrl-C */
async function pick<T extends string>(
  message: string,
  options: { value: T; label: string; hint?: string }[],
): Promise<T | undefined> {
  const v = await p.select({ message, options } as never);
  return p.isCancel(v) ? undefined : (v as T);
}

/** Cancel-safe text -- returns undefined on Ctrl-C */
async function ask(opts: Parameters<typeof p.text>[0]): Promise<string | undefined> {
  const v = await p.text(opts);
  return p.isCancel(v) ? undefined : (v as string);
}

/** Cancel-safe confirm -- returns undefined on Ctrl-C */
async function confirm(opts: Parameters<typeof p.confirm>[0]): Promise<boolean | undefined> {
  const v = await p.confirm(opts);
  return p.isCancel(v) ? undefined : (v as boolean);
}

/** Expand ~ in a path */
function expandPath(p: string): string {
  return p.replace(/^~/, homedir());
}

// -- Entry point ----------------------------------------------------------
export async function runInteractive(): Promise<void> {
  // Clear screen for a clean start
  process.stdout.write('\x1Bc');
  p.intro(headerLine());

  // -- Environment check ----------------------------------------------------
  const envSpinner = p.spinner();
  envSpinner.start('Checking environment...');

  let ytdlpOk  = false;
  let ffmpegOk = false;
  let ytdlpVersion: string | null = null;

  try {
    ytdlpVersion = await getYtDlpVersion();
    ytdlpOk = true;
  } catch {
    ytdlpOk = false;
  }

  ffmpegOk = await checkFfmpeg();
  envSpinner.stop(envBanner(ytdlpVersion, ffmpegOk));

  // Prompt to install missing dependencies before going to the main menu
  if (!ytdlpOk) {
    p.log.warn('yt-dlp is required for all downloads.');
    const installed = await promptInstallYtDlp();
    if (installed) {
      ytdlpOk = true;
      try { ytdlpVersion = await getYtDlpVersion(); } catch { /* ok */ }
    }
  }

  if (!ffmpegOk) {
    p.log.warn('ffmpeg enables HD video, audio extraction, and thumbnail embedding.');
    ffmpegOk = await promptInstallFfmpeg();
  }

  // -- Main loop ------------------------------------------------------------
  while (true) {
    console.log();
    const action = await pick('What would you like to do?', [
      { value: 'download', label: `[dl] Download`,  hint: 'paste a URL and download' },
      { value: 'batch',    label: `[*] Batch`,     hint: 'download from a .txt file' },
      { value: 'queue',    label: `[=] Queue`,      hint: 'manage the download queue' },
      { value: 'history',  label: `[h] History`,    hint: 'browse recent downloads' },
      { value: 'settings', label: `[s] Settings`,   hint: 'configure preferences' },
      { value: 'setup',    label: `[#] Setup`,      hint: 'dependencies · versions · updates' },
      { value: 'exit',     label: `[x] Exit` },
    ]);

    if (!action || action === 'exit') break;

    if      (action === 'download') await flowDownload(ytdlpOk, ffmpegOk);
    else if (action === 'batch')    await flowBatch(ytdlpOk, ffmpegOk);
    else if (action === 'queue')    await flowQueue(ytdlpOk, ffmpegOk);
    else if (action === 'history')  await flowHistory();
    else if (action === 'settings') await flowSettings();
    else if (action === 'setup') {
      const result = await flowSetup(ytdlpVersion, ffmpegOk);
      if (result.ytdlpVersion) { ytdlpOk = true; ytdlpVersion = result.ytdlpVersion; }
      if (result.ffmpegOk)       ffmpegOk = true;
    }
  }

  p.outro(chalk.bold.cyan('Stay downloading.') + '  ' + chalk.dim('github.com/2jz-hub/2jz-downloader'));
}

// -- FLOW: Single download ------------------------------------------------
async function flowDownload(ytdlpOk: boolean, ffmpegOk: boolean): Promise<void> {
  if (!ytdlpOk) { p.log.error('yt-dlp is not installed. Go to Setup to install it.'); return; }

  console.log();
  console.log(divider('Download'));

  // -- 1. URL input ---------------------------------------------------------
  const rawUrl = await ask({
    message: 'Paste a URL',
    placeholder: 'https://youtu.be/...  or any supported link',
    validate: (v) => {
      if (!v.trim()) return 'URL is required.';
      try { normalizeUrl(v); return undefined; }
      catch (e: any) { return e.message as string; }
    },
  });
  if (!rawUrl) return;

  let url: string;
  let platform: Platform;
  try {
    url      = normalizeUrl(rawUrl);
    platform = detectPlatform(url);
  } catch (e: any) { p.log.error(e.message); return; }

  // Show platform badge immediately so the user knows what was detected
  console.log(`\n  ${platformBadge(platform)}  ${clr.dim(platformLabel(platform))}\n`);

  const config = cfg.get();

  // Shape-validate -- catches profile links, bare /watch, etc.
  try {
    if (platform !== 'generic') {
      validateUrlShape(url, platform, config.allowPlaylist);
    }
  } catch (e: any) {
    p.log.error(e.message);
    const override = await confirm({ message: 'Try downloading anyway?', initialValue: false });
    if (!override) return;
  }

  // -- 2. Fetch metadata for a preview + quality list -----------------------
  const infoSpinner = p.spinner();
  infoSpinner.start('Fetching media info...');

  let mediaInfo: Awaited<ReturnType<typeof fetchInfo>> | null = null;
  try {
    mediaInfo = await fetchInfo(url, { platform, cookies: config.cookies ?? undefined });
    infoSpinner.stop(clr.dim('Media info fetched'));
    // Show a compact preview card
    const fields = [
      { label: 'Title',    value: chalk.white(mediaInfo.title.length > 55 ? mediaInfo.title.slice(0, 52) + '...' : mediaInfo.title) },
      { label: 'Uploader', value: clr.accent(mediaInfo.uploader) },
      { label: 'Duration', value: fmtDuration(mediaInfo.duration) },
      { label: 'Platform', value: platformLabel(platform) },
    ];
    if (mediaInfo.formats.length) {
      const resolutions = mediaInfo.formats
        .filter((f) => f.height)
        .map((f) => `${f.height}p`)
        .slice(0, 6)
        .join('  ');
      fields.push({ label: 'Resolutions', value: clr.dim(resolutions || '—') });
    }
    process.stdout.write(infoCard(mediaInfo.title, fields));
  } catch {
    infoSpinner.stop(clr.warn('Could not fetch metadata -- continuing without preview'));
  }

  // -- 3. Mode --------------------------------------------------------------
  const suggestedMode = resolveAutoMode(platform);

  const modeOptions: { value: Mode; label: string; hint?: string }[] = [];
  if (!isAudioPlatform(platform)) {
    modeOptions.push({ value: 'video', label: '[>] Video', hint: 'download video file' + (suggestedMode === 'video' ? '  <- recommended' : '') });
  }
  modeOptions.push({
    value: 'audio', label: '[~] Audio', hint: 'extract audio track' + (suggestedMode === 'audio' ? '  <- recommended' : ''),
  });
  if (supportsImageMode(platform)) {
    modeOptions.push({ value: 'image', label: '[#] Image', hint: 'thumbnail / image' + (suggestedMode === 'image' ? '  <- recommended' : '') });
  }

  const mode = await pick<Mode>('Mode', modeOptions);
  if (!mode) return;

  // -- 4. Format ------------------------------------------------------------
  let format: string = defaultFormat(mode);

  if (mode === 'video') {
    const fmtChoice = await pick('Format', [
      { value: 'mp4',  label: 'MP4',  hint: 'universal compatibility' },
      { value: 'mkv',  label: 'MKV',  hint: 'best for subtitles' },
      { value: 'webm', label: 'WebM', hint: 'open format' },
      { value: 'best', label: 'Best', hint: 'let yt-dlp decide' },
    ]);
    if (!fmtChoice) return;
    format = fmtChoice;
  } else if (mode === 'audio') {
    const fmtChoice = await pick('Format', [
      { value: 'mp3',  label: 'MP3',  hint: 'universal compatibility' },
      { value: 'm4a',  label: 'M4A',  hint: 'best with AAC stream' },
      { value: 'opus', label: 'Opus', hint: 'best quality/size ratio' },
      { value: 'flac', label: 'FLAC', hint: 'lossless' },
      { value: 'wav',  label: 'WAV',  hint: 'lossless, uncompressed' },
      { value: 'best', label: 'Best', hint: 'keep original codec' },
    ]);
    if (!fmtChoice) return;
    format = fmtChoice;
  } else if (mode === 'image') {
    const formatChoices: { value: string; label: string; hint?: string }[] = [
      { value: 'original', label: 'Original', hint: 'keep as-is' },
    ];
    if (supportsImageConversion(platform) && ffmpegOk) {
      formatChoices.push(
        { value: 'jpg',  label: 'JPG',  hint: 'convert via ffmpeg' },
        { value: 'png',  label: 'PNG',  hint: 'convert via ffmpeg' },
        { value: 'webp', label: 'WebP', hint: 'convert via ffmpeg' },
      );
    }
    const fmtChoice = await pick('Format', formatChoices);
    if (!fmtChoice) return;
    format = fmtChoice;
  }

  // -- 5. Quality (video only) ----------------------------------------------
  let quality: string | undefined;

  if (mode === 'video' && format !== 'best') {
    const qualityOpts: { value: string; label: string; hint?: string }[] = [
      { value: 'best', label: 'Best available', hint: 'recommended' },
    ];

    if (mediaInfo?.formats.length) {
      // Build quality list from actual available formats
      const seen = new Set<number>();
      for (const f of mediaInfo.formats) {
        if (!f.height || seen.has(f.height)) continue;
        seen.add(f.height);
        qualityOpts.push({
          value: `${f.height}p`,
          label: `${f.height}p`,
          hint: f.filesize ? fmtBytes(f.filesize) : f.fps ? `${f.fps}fps` : undefined,
        });
      }
    } else {
      // Fallback static list
      qualityOpts.push(
        { value: '2160p', label: '2160p (4K)' },
        { value: '1440p', label: '1440p (2K)' },
        { value: '1080p', label: '1080p (FHD)' },
        { value: '720p',  label: '720p (HD)' },
        { value: '480p',  label: '480p' },
        { value: '360p',  label: '360p' },
      );
    }

    const q = await pick('Quality', qualityOpts);
    if (!q) return;
    quality = q === 'best' ? undefined : q;
  }

  // -- 6. Extra options (subtitles, embed thumbnail) ------------------------
  let subtitles     = config.subtitles;
  let embedThumb    = config.embedThumbnail;
  let subtitleLangs = config.subtitleLangs;

  if (mode === 'video') {
    const withSubs = await confirm({
      message: `Download subtitles?${subtitles ? '  (currently on in Settings)' : ''}`,
      initialValue: subtitles,
    });
    subtitles = withSubs ?? subtitles;

    if (subtitles) {
      const langs = await ask({
        message: 'Subtitle language codes (comma-separated)',
        initialValue: subtitleLangs,
        placeholder: 'en,es,fr',
        validate: (v) => v.trim() ? undefined : 'At least one language code required.',
      });
      if (langs) subtitleLangs = langs;
    }
  }

  if (mode === 'audio' && ffmpegOk && ['mp3', 'm4a', 'flac', 'opus'].includes(format)) {
    const withThumb = await confirm({
      message: 'Embed thumbnail as cover art?',
      initialValue: embedThumb,
    });
    embedThumb = withThumb ?? embedThumb;
  }

  // -- 7. Queue or download now ---------------------------------------------
  const action = await pick('Action', [
    { value: 'now',   label: `${ICON.download}  Download now` },
    { value: 'queue', label: '[=] Add to queue',  hint: 'run later with Queue › Run' },
  ]);
  if (!action) return;

  if (action === 'queue') {
    const queue  = loadQueue();
    const item: QueueItem = {
      id:       randomUUID(),
      url, platform, mode, format, quality,
      status:  'pending',
      addedAt: new Date().toISOString(),
    };
    queue.push(item);
    saveQueue(queue);
    p.log.success(`${ICON.ok}  Added to queue  ${clr.dim(`(${queue.filter((i) => i.status === 'pending').length} pending)`)}`);
    return;
  }

  // -- 8. Execute download --------------------------------------------------
  console.log();
  await runDownload({
    url, platform, mode, format, quality,
    outputDir:     config.outputDir,
    cookies:       config.cookies ?? undefined,
    allowPlaylist: config.allowPlaylist,
    retries:       config.retries,
    timeout:       config.timeout,
    overwrite:     config.overwrite,
    writeInfoJson: config.writeInfoJson,
    verbose:       config.verbose,
    embedThumbnail: embedThumb,
    subtitles,
    subtitleLangs,
    autoSubtitles: config.autoSubtitles,
  });
}

// -- FLOW: Batch ----------------------------------------------------------
async function flowBatch(ytdlpOk: boolean, ffmpegOk: boolean): Promise<void> {
  if (!ytdlpOk) { p.log.error('yt-dlp is not installed. Go to Setup to install it.'); return; }

  console.log();
  console.log(divider('Batch Download'));

  const inputMethod = await pick('Input method', [
    { value: 'file',   label: 'Load from .txt file', hint: 'one URL per line, # = comment' },
    { value: 'manual', label: 'Enter URLs manually',  hint: 'type or paste one at a time' },
  ]);
  if (!inputMethod) return;

  let lines: string[] = [];

  if (inputMethod === 'file') {
    const filePath = await ask({
      message: 'Path to .txt file',
      placeholder: '~/urls.txt',
      validate: (v) => {
        if (!v.trim()) return 'File path is required.';
        const resolved = expandPath(v.trim());
        if (!existsSync(resolved)) return `File not found: ${resolved}`;
        try {
          const stat = statSync(resolved);
          if (!stat.isFile()) return 'Path is not a file.';
        } catch (e: any) { return e.message; }
        return undefined;
      },
    });
    if (!filePath) return;

    try {
      const raw = readFileSync(expandPath(filePath), 'utf8');
      lines = raw.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    } catch (e: any) { p.log.error(`Cannot read file: ${e.message}`); return; }

    if (!lines.length) { p.log.warn('File is empty or contains no valid URLs.'); return; }
    p.log.info(`${ICON.ok}  Loaded ${chalk.bold(String(lines.length))} URLs from file`);

  } else {
    // Manual entry -- keep asking until the user submits a blank line
    p.log.info('Enter one URL per prompt. Press Enter on a blank line when done.');
    let idx = 1;
    while (true) {
      const entry = await ask({
        message: `URL ${idx} (blank to finish)`,
        placeholder: 'https://...',
      });
      if (!entry || !entry.trim()) break;
      try {
        normalizeUrl(entry.trim());
        lines.push(entry.trim());
        idx++;
      } catch (e: any) {
        p.log.warn(`Skipping invalid URL: ${e.message}`);
      }
    }
    if (!lines.length) { p.log.warn('No URLs entered.'); return; }
    p.log.info(`${ICON.ok}  ${lines.length} URL${lines.length !== 1 ? 's' : ''} ready`);
  }

  // -- Mode & format for the whole batch ------------------------------------
  const batchMode = await pick<Mode>('Mode for all URLs', [
    { value: 'auto',  label: '[*] Auto',  hint: 'detect best mode per URL (smart)' },
    { value: 'video', label: '[>] Video', hint: 'mp4' },
    { value: 'audio', label: '[~] Audio', hint: 'mp3' },
  ]);
  if (!batchMode) return;

  let batchFormat = defaultFormat(batchMode);
  if (batchMode === 'video') {
    const f = await pick('Video format', [
      { value: 'mp4',  label: 'MP4' },
      { value: 'mkv',  label: 'MKV' },
      { value: 'best', label: 'Best' },
    ]);
    if (!f) return;
    batchFormat = f;
  } else if (batchMode === 'audio') {
    const f = await pick('Audio format', [
      { value: 'mp3',  label: 'MP3' },
      { value: 'm4a',  label: 'M4A' },
      { value: 'opus', label: 'Opus' },
      { value: 'best', label: 'Best' },
    ]);
    if (!f) return;
    batchFormat = f;
  }

  const skipOnFailAnswer = await confirm({
    message: 'Skip failed URLs and continue?',
    initialValue: true,
  });
  // If the user cancels (Ctrl-C), default to true so the batch doesn't stop
  // on the first failure -- aborting the confirm is not the same as opting to halt.
  const skipOnFail = skipOnFailAnswer ?? true;

  const config = cfg.get();
  console.log();
  console.log(divider());

  let passed = 0, failed = 0, skipped = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawUrl = lines[i];
    const prefix = chalk.dim(`[${i + 1}/${lines.length}]`);
    let normUrl: string;
    let platform: Platform;

    try {
      normUrl  = normalizeUrl(rawUrl);
      platform = detectPlatform(normUrl);
    } catch (e: any) {
      console.log(`${prefix}  ${ICON.warn}  ${clr.warn('Invalid URL -- skipping')}`);
      p.log.warn(e.message);
      skipped++;
      continue;
    }

    // Smart auto-mode per URL
    const resolvedMode   = batchMode === 'auto' ? resolveAutoMode(platform) : batchMode;
    const resolvedFormat = batchMode === 'auto' ? defaultFormat(resolvedMode) : batchFormat;

    console.log(`${prefix}  ${platformBadge(platform)}  ${clr.dim(normUrl.slice(0, 52) + (normUrl.length > 52 ? '...' : ''))}`);

    try {
      await runDownload({
        url: normUrl, platform,
        mode:   resolvedMode,
        format: resolvedFormat,
        outputDir:     config.outputDir,
        cookies:       config.cookies ?? undefined,
        retries:       config.retries,
        timeout:       config.timeout,
        overwrite:     config.overwrite,
        embedThumbnail: config.embedThumbnail,
        subtitles:     config.subtitles,
        subtitleLangs: config.subtitleLangs,
        autoSubtitles: config.autoSubtitles,
      });
      passed++;
    } catch (e: any) {
      failed++;
      if (!skipOnFail) {
        p.log.error(`Stopping batch -- ${e.message}`);
        break;
      }
    }
    console.log();
  }

  process.stdout.write(summaryBox(passed, failed, skipped));
}

// -- FLOW: Queue ----------------------------------------------------------
async function flowQueue(ytdlpOk: boolean, ffmpegOk: boolean): Promise<void> {
  while (true) {
    const queue   = loadQueue();
    const pending = queue.filter((i) => i.status === 'pending').length;
    const done    = queue.filter((i) => i.status === 'done').length;
    const failed  = queue.filter((i) => i.status === 'failed').length;
    const summary = queue.length
      ? clr.dim(`${pending} pending · ${done} done · ${failed} failed`)
      : clr.dim('empty');

    console.log();
    console.log(divider('Queue'));
    console.log(`  ${summary}`);

    const action = await pick('Queue action', [
      { value: 'view',   label: '[=] View all items',     hint: `${queue.length} total` },
      { value: 'run',    label: `${ICON.download}  Run queue now`,     hint: `${pending} pending` },
      { value: 'retry',  label: '[r]  Retry failed',        hint: `${failed} failed` },
      { value: 'clear',  label: '⌫  Clear finished/failed' },
      { value: 'back',   label: '<- Back' },
    ]);
    if (!action || action === 'back') break;

    if (action === 'view') {
      if (!queue.length) { p.log.info('Queue is empty.'); continue; }
      console.log();
      console.log(divider());
      queue.forEach((item, i) => console.log(queueRow(i, item)));
      console.log();
      await ask({ message: 'Press Enter to continue...', placeholder: '' });

    } else if (action === 'run') {
      if (!ytdlpOk) { p.log.error('yt-dlp is not installed.'); continue; }
      const toRun = queue.filter((i) => i.status === 'pending');
      if (!toRun.length) { p.log.info('No pending items.'); continue; }

      p.log.info(`Running ${toRun.length} pending downloads...`);
      console.log();

      const config = cfg.get();
      for (let i = 0; i < toRun.length; i++) {
        const item   = toRun[i];
        const prefix = chalk.dim(`[${i + 1}/${toRun.length}]`);
        console.log(`${prefix}  ${platformBadge(item.platform as Platform)}  ${clr.dim(item.url.length > 50 ? item.url.slice(0, 50) + '...' : item.url)}`);

        // Mark as downloading
        const q = loadQueue();
        const idx = q.findIndex((x) => x.id === item.id);
        if (idx !== -1) { q[idx].status = 'downloading'; saveQueue(q); }

        try {
          const filename = await runDownloadSilent({
            url:      item.url,
            platform: item.platform as Platform,
            mode:     item.mode    as Mode,
            format:   item.format,
            quality:  item.quality,
            outputDir:     config.outputDir,
            cookies:       config.cookies ?? undefined,
            retries:       config.retries,
            timeout:       config.timeout,
            overwrite:     config.overwrite,
            embedThumbnail: config.embedThumbnail,
            subtitles:     config.subtitles,
            subtitleLangs: config.subtitleLangs,
            autoSubtitles: config.autoSubtitles,
          });
          const q2 = loadQueue();
          const i2 = q2.findIndex((x) => x.id === item.id);
          if (i2 !== -1) { q2[i2].status = 'done'; q2[i2].filename = filename; saveQueue(q2); }
          console.log(`  ${ICON.ok}  Done`);
        } catch (e: any) {
          const q2 = loadQueue();
          const i2 = q2.findIndex((x) => x.id === item.id);
          if (i2 !== -1) { q2[i2].status = 'failed'; q2[i2].error = e.message; saveQueue(q2); }
          p.log.error(friendlyError(e.message, item.platform, !!config.cookies, item.mode as Mode));
        }
        console.log();
      }
      p.log.success('Queue run complete.');

    } else if (action === 'retry') {
      const q = loadQueue();
      let count = 0;
      for (const item of q) {
        if (item.status === 'failed') { item.status = 'pending'; item.error = undefined; count++; }
      }
      saveQueue(q);
      if (count) p.log.success(`Reset ${count} failed item${count !== 1 ? 's' : ''} to pending.`);
      else        p.log.info('No failed items to retry.');

    } else if (action === 'clear') {
      const before = loadQueue().length;
      clearFinishedFromQueue();
      const after  = loadQueue().length;
      p.log.success(`Cleared ${before - after} finished/failed item${before - after !== 1 ? 's' : ''}.`);
    }
  }
}

// -- FLOW: History --------------------------------------------------------
async function flowHistory(): Promise<void> {
  const history = loadHistory();

  if (!history.length) {
    p.log.info('No download history yet. Start downloading to build history.');
    return;
  }

  while (true) {
    // Group by date for display
    const recent = [...history].reverse().slice(0, 50);

    console.log();
    console.log(divider('History'));
    console.log(clr.dim(`  ${history.length} total downloads\n`));

    let currentDate = '';
    recent.forEach((e, i) => {
      const date = fmtDate(e.timestamp);
      if (date !== currentDate) {
        if (i > 0) console.log();
        console.log(clr.dim(`  ${date}`));
        currentDate = date;
      }
      console.log(historyRow(i, e.status, e.timestamp, e.platform, e.url));
    });

    console.log();

    const action = await pick('History action', [
      { value: 'redownload', label: '[r]  Re-download an entry' },
      { value: 'clear',      label: '⌫  Clear all history' },
      { value: 'back',       label: '<- Back' },
    ]);
    if (!action || action === 'back') break;

    if (action === 'redownload') {
      const indexStr = await ask({
        message: 'Enter entry number to re-download',
        placeholder: '1',
        validate: (v) => {
          const n = Number(v);
          if (!Number.isInteger(n) || n < 1 || n > recent.length) {
            return `Enter a number between 1 and ${recent.length}.`;
          }
          return undefined;
        },
      });
      if (!indexStr) continue;

      const entry  = recent[Number(indexStr) - 1];
      const config = cfg.get();
      console.log(`\n  ${ICON.info}  Re-downloading: ${clr.dim(entry.url)}\n`);
      await runDownload({
        url:      entry.url,
        platform: entry.platform as Platform,
        mode:     entry.mode     as Mode,
        format:   entry.format,
        quality:  entry.quality,
        outputDir:     config.outputDir,
        cookies:       config.cookies ?? undefined,
        retries:       config.retries,
        timeout:       config.timeout,
        overwrite:     true,
        embedThumbnail: config.embedThumbnail,
        subtitles:     config.subtitles,
        subtitleLangs: config.subtitleLangs,
        autoSubtitles: config.autoSubtitles,
      });

    } else if (action === 'clear') {
      const sure = await confirm({
        message: `Clear all ${history.length} history entries? This cannot be undone.`,
        initialValue: false,
      });
      if (sure) {
        try {
          const { join: jn } = await import('path');
          const { homedir: hd } = await import('os');
          const { writeFileSync: wf } = await import('fs');
          wf(jn(hd(), '.2jz_history.json'), '[]', 'utf8');
          p.log.success('History cleared.');
        } catch (e: any) { p.log.error(`Could not clear history: ${e.message}`); }
        break;
      }
    }
  }
}

// -- FLOW: Settings -------------------------------------------------------
async function flowSettings(): Promise<void> {
  while (true) {
    const config = cfg.get();
    console.log();
    console.log(divider('Settings'));

    const key = await pick('Choose a setting to change', [
      // -- Download
      { value: 'outputDir',      label: 'Output directory',      hint: config.outputDir },
      { value: 'overwrite',      label: 'Overwrite existing',    hint: config.overwrite     ? chalk.green('on') : chalk.dim('off') },
      { value: 'allowPlaylist',  label: 'Allow playlists',        hint: config.allowPlaylist ? chalk.green('on') : chalk.dim('off') },
      // -- Content
      { value: 'embedThumbnail', label: 'Embed thumbnail',       hint: config.embedThumbnail ? chalk.green('on') : chalk.dim('off') },
      { value: 'subtitles',      label: 'Download subtitles',    hint: config.subtitles      ? chalk.green('on') : chalk.dim('off') },
      { value: 'subtitleLangs',  label: 'Subtitle languages',    hint: clr.dim(config.subtitleLangs) },
      { value: 'autoSubtitles',  label: 'Auto-generated subs',   hint: config.autoSubtitles  ? chalk.green('on') : chalk.dim('off') },
      { value: 'writeInfoJson',  label: 'Save .info.json',       hint: config.writeInfoJson  ? chalk.green('on') : chalk.dim('off') },
      // -- Network
      { value: 'cookies',        label: 'Cookies file',          hint: config.cookies ? clr.dim(config.cookies) : clr.dim('not set') },
      { value: 'retries',        label: 'Retry attempts',        hint: clr.dim(String(config.retries)) },
      { value: 'timeout',        label: 'Socket timeout (s)',    hint: clr.dim(String(config.timeout)) },
      // -- Debug
      { value: 'verbose',        label: 'Verbose output',        hint: config.verbose ? chalk.yellow('on') : chalk.dim('off') },
      // -- Actions
      { value: 'reset',          label: '[r]  Reset to defaults' },
      { value: 'show',           label: '  Show config file path' },
      { value: 'back',           label: '<- Back' },
    ]);

    if (!key || key === 'back') break;

    if (key === 'show') {
      p.log.info(`Config file: ${clr.accent(cfg.path())}`);
      continue;
    }

    if (key === 'reset') {
      const sure = await confirm({
        message: 'Reset all settings to defaults?',
        initialValue: false,
      });
      if (sure) {
        const { join: jn } = await import('path');
        const defaults: Config = {
          outputDir:     jn(homedir(), '2jz_downloads'),
          retries:        5, timeout: 30, writeInfoJson: false, overwrite: false,
          allowPlaylist: false, cookies: null, verbose: false, embedThumbnail: false,
          subtitles: false, subtitleLangs: 'en', autoSubtitles: false,
        };
        for (const [k, v] of Object.entries(defaults) as [keyof Config, Config[keyof Config]][]) {
          cfg.set(k, v as never);
        }
        p.log.success('Settings reset to defaults.');
      }
      continue;
    }

    // -- Boolean toggles ------------------------------------------------------
    const boolKeys: (keyof Config)[] = [
      'overwrite', 'allowPlaylist', 'embedThumbnail', 'subtitles',
      'autoSubtitles', 'writeInfoJson', 'verbose',
    ];
    if (boolKeys.includes(key as keyof Config)) {
      const current = Boolean((config as unknown as Record<string, unknown>)[key]);
      const v = await confirm({
        message: `${key} -- currently ${current ? chalk.green('on') : chalk.dim('off')}. Toggle?`,
        initialValue: !current,
      });
      if (v !== undefined) {
        cfg.set(key as keyof Config, v as never);
        p.log.success(`${key} -> ${v ? chalk.green('on') : chalk.dim('off')}`);
      }
      continue;
    }

    // -- Text / numeric fields ------------------------------------------------
    if (key === 'outputDir') {
      const v = await ask({
        message: 'Output directory path (~ is expanded)',
        initialValue: config.outputDir,
        validate: (s) => s.trim() ? undefined : 'Path cannot be empty.',
      });
      if (v) {
        const expanded = expandPath(v.trim());
        try { mkdirSync(expanded, { recursive: true }); } catch { /* ok */ }
        cfg.set('outputDir', expanded);
        p.log.success(`Output directory -> ${clr.accent(expanded)}`);
      }

    } else if (key === 'subtitleLangs') {
      const v = await ask({
        message: 'Language codes (comma-separated, e.g. en,es,fr,de)',
        initialValue: config.subtitleLangs,
        placeholder: 'en',
        validate: (s) => s.trim() ? undefined : 'At least one language code is required.',
      });
      if (v) { cfg.set('subtitleLangs', v.trim()); p.log.success(`Subtitle languages -> ${v.trim()}`); }

    } else if (key === 'cookies') {
      const v = await ask({
        message: 'Path to Netscape cookies.txt (blank to clear)',
        initialValue: config.cookies ?? '',
        placeholder: '~/cookies.txt',
      });
      if (v !== undefined) {
        const val = v.trim() ? expandPath(v.trim()) : null;
        if (val && !existsSync(val)) {
          p.log.warn(`File not found: ${val}. Saved anyway -- check the path.`);
        }
        cfg.set('cookies', val);
        p.log.success(val ? `Cookies file -> ${clr.accent(val)}` : 'Cookies cleared.');
      }

    } else if (key === 'retries') {
      const v = await ask({
        message: 'Retry attempts per fragment (1–20)',
        initialValue: String(config.retries),
        validate: (s) => {
          const n = Number(s);
          return Number.isInteger(n) && n >= 1 && n <= 20 ? undefined : 'Enter a whole number between 1 and 20.';
        },
      });
      if (v) { cfg.set('retries', Number(v)); p.log.success(`Retries -> ${v}`); }

    } else if (key === 'timeout') {
      const v = await ask({
        message: 'Socket timeout in seconds (5–120)',
        initialValue: String(config.timeout),
        validate: (s) => {
          const n = Number(s);
          return Number.isInteger(n) && n >= 5 && n <= 120 ? undefined : 'Enter a whole number between 5 and 120.';
        },
      });
      if (v) { cfg.set('timeout', Number(v)); p.log.success(`Timeout -> ${v}s`); }
    }
  }
}

// -- FLOW: Setup ----------------------------------------------------------
async function flowSetup(
  currentYtdlpVersion: string | null,
  currentFfmpegOk: boolean,
): Promise<{ ytdlpVersion: string | null; ffmpegOk: boolean }> {

  let ytdlpVersion = currentYtdlpVersion;
  let ffmpegOk     = currentFfmpegOk;

  while (true) {
    console.log();
    console.log(divider('Setup & Dependencies'));

    // Live status on each loop iteration
    const ytStatus  = ytdlpVersion ? `${ICON.ok} yt-dlp ${chalk.green(ytdlpVersion)}` : `${ICON.fail} yt-dlp ${chalk.red('not installed')}`;
    const ffStatus  = ffmpegOk     ? `${ICON.ok} ffmpeg installed` : `${chalk.yellow('[--]')} ffmpeg ${chalk.yellow('not installed')}`;
    const ffNote    = ffmpegOk ? '' : clr.dim('  (optional -- needed for HD video, audio conversion, thumbnails)');
    console.log(`\n  ${ytStatus}`);
    console.log(`  ${ffStatus}${ffNote}\n`);

    const options: { value: string; label: string; hint?: string }[] = [];

    if (!ytdlpVersion) {
      options.push({ value: 'install_ytdlp', label: `${ICON.download}  Install yt-dlp`, hint: 'required' });
    } else {
      options.push({ value: 'update_ytdlp',  label: '[^] Check for yt-dlp update' });
    }
    if (!ffmpegOk) {
      options.push({ value: 'install_ffmpeg', label: `${ICON.download}  Install ffmpeg`, hint: 'optional but recommended' });
    }
    options.push({ value: 'recheck', label: '[r]  Re-check environment' });
    options.push({ value: 'back',    label: '<- Back' });

    const action = await pick('Setup action', options);
    if (!action || action === 'back') break;

    if (action === 'install_ytdlp') {
      const ok = await promptInstallYtDlp();
      if (ok) {
        resetYtDlpCache();
        try { ytdlpVersion = await getYtDlpVersion(); } catch { ytdlpVersion = null; }
        if (ytdlpVersion) p.log.success(`yt-dlp ${ytdlpVersion} ready.`);
      }

    } else if (action === 'install_ffmpeg') {
      const ok = await promptInstallFfmpeg();
      if (ok) {
        resetFfmpegCache();
        ffmpegOk = await checkFfmpeg();
        if (ffmpegOk) p.log.success('ffmpeg ready.');
      }

    } else if (action === 'update_ytdlp') {
      const s = p.spinner();
      s.start('Checking for yt-dlp updates...');
      const info = await checkYtDlpUpdate();
      if (!info) {
        s.stop(clr.warn('Could not reach GitHub. Check your internet connection.'));
      } else if (!info.hasUpdate) {
        s.stop(`${ICON.ok}  yt-dlp is up to date  ${clr.dim(`(${info.current})`)}`);
      } else {
        s.stop(
          `${ICON.warn}  Update available: ` +
          chalk.dim(info.current) + ' -> ' + chalk.bold.green(info.latest)
        );
        const doUpdate = await confirm({ message: 'Update now?', initialValue: true });
        if (doUpdate) {
          const us = p.spinner();
          us.start('Updating yt-dlp...');
          const ok = await updateYtDlp();
          if (ok) {
            resetYtDlpCache();
            try { ytdlpVersion = await getYtDlpVersion(); } catch { ytdlpVersion = info.latest; }
            us.stop(`${ICON.ok}  Updated to ${chalk.bold.green(ytdlpVersion ?? info.latest)}`);
          } else {
            us.stop(`${ICON.fail}  Update failed. Try running the update manually.`);
          }
        }
      }

    } else if (action === 'recheck') {
      resetYtDlpCache();
      resetFfmpegCache();
      const s = p.spinner();
      s.start('Re-checking environment...');
      try { ytdlpVersion = await getYtDlpVersion(); } catch { ytdlpVersion = null; }
      ffmpegOk = await checkFfmpeg();
      s.stop(envBanner(ytdlpVersion, ffmpegOk));
    }
  }

  return { ytdlpVersion, ffmpegOk };
}

// -- Download runners -----------------------------------------------------

/**
 * Full interactive download runner -- shows a live progress bar with
 * percent, speed, ETA, and saves history.
 */
async function runDownload(options: DownloadOptions): Promise<string | undefined> {
  const s = p.spinner();
  s.start(`${modeLabel(options.mode)}  ${clr.dim('Preparing...')}`);

  let saved: string | undefined;
  try {
    saved = await download(options, (prog) => {
      const pct  = Math.round(prog.percent ?? 0);
      const fill = bar(pct);
      s.message(`${fill}  ${String(pct).padStart(3)}%  ${clr.dim('·')}  ${prog.speed}  ${clr.dim('·')}  ETA ${prog.eta}`);
    });

    s.stop(`${ICON.ok}  ${chalk.green('Download complete')}`);
    if (saved) {
      p.log.info(`${clr.dim('Saved to')}  ${clr.accent(saved)}`);
    }

    pushHistory({
      timestamp: new Date().toISOString(),
      url: options.url, platform: options.platform,
      mode: options.mode, format: options.format,
      quality: options.quality,
      outputDir: options.outputDir, status: 'success', filename: saved,
    });
  } catch (e: any) {
    s.stop(`${ICON.fail}  ${chalk.red('Download failed')}`);
    const msg = friendlyError(e.message, options.platform, !!options.cookies, options.mode);
    p.log.error(msg);

    pushHistory({
      timestamp: new Date().toISOString(),
      url: options.url, platform: options.platform,
      mode: options.mode, format: options.format,
      quality: options.quality,
      outputDir: options.outputDir, status: 'failed', error: e.message,
    });

    throw e; // re-throw so callers (batch, queue) can count failures
  }

  return saved;
}

/**
 * Silent download runner for queue/batch contexts where a spinner per URL
 * would be too noisy. Still shows the progress bar -- just no "Preparing" prefix.
 */
async function runDownloadSilent(options: DownloadOptions): Promise<string | undefined> {
  const s = p.spinner();
  s.start(clr.dim('Downloading...'));
  try {
    const saved = await download(options, (prog) => {
      const pct = Math.round(prog.percent ?? 0);
      s.message(`${bar(pct)}  ${String(pct).padStart(3)}%  ${clr.dim('·')}  ${prog.speed}  ${clr.dim('·')}  ETA ${prog.eta}`);
    });
    s.stop(`${ICON.ok}  Done${saved ? `  ${clr.dim(saved)}` : ''}`);
    return saved ?? undefined;
  } catch (e: any) {
    s.stop(`${ICON.fail}  Failed`);
    throw e;
  }
}
