/**
 * Download queue manager.
 *
 * Items are persisted to ~/.2jz_queue.json so the queue survives restarts.
 * The runner processes items one at a time (sequential) with the option
 * to cancel the current download via Ctrl+C during the run loop.
 */

import * as p from '@clack/prompts';
import chalk from 'chalk';
import { randomUUID } from 'crypto';

import { bar, clr } from '../ui/theme.js';
import { cfg, loadQueue, saveQueue, pushHistory, type QueueItem } from './config.js';
import { download, friendlyError, type DownloadOptions } from './downloader.js';
import { detectPlatform, normalizeUrl, type Platform, type Mode } from './platform.js';

// -- Add to queue ---------------------------------------------------------
export function enqueue(item: Omit<QueueItem, 'id' | 'addedAt' | 'status'>): QueueItem {
  const queue = loadQueue();
  const entry: QueueItem = {
    ...item,
    id:      randomUUID(),
    status:  'pending',
    addedAt: new Date().toISOString(),
  };
  queue.push(entry);
  saveQueue(queue);
  return entry;
}

// -- Remove from queue ----------------------------------------------------
export function dequeue(id: string): void {
  const queue = loadQueue().filter((i) => i.id !== id);
  saveQueue(queue);
}

// -- Process the queue ----------------------------------------------------
export async function runQueue(): Promise<void> {
  const queue = loadQueue();
  const pending = queue.filter((i) => i.status === 'pending');

  if (!pending.length) {
    p.log.info('Queue is empty. Add items with the Download option -> "Add to queue".');
    return;
  }

  p.log.info(`Processing ${pending.length} item${pending.length > 1 ? 's' : ''} in queue...`);
  console.log();

  const config = cfg.get();
  let passed = 0, failed = 0;

  for (let i = 0; i < pending.length; i++) {
    const item = pending[i];
    const label = item.url.length > 60 ? item.url.slice(0, 57) + '...' : item.url;
    p.log.info(`[${i + 1}/${pending.length}]  ${clr.dim(label)}`);

    // Mark as downloading
    updateQueueItem(item.id, { status: 'downloading' });

    let url: string;
    let platform: Platform;
    try {
      url      = normalizeUrl(item.url);
      platform = detectPlatform(url);
    } catch (e: any) {
      p.log.error(e.message);
      updateQueueItem(item.id, { status: 'failed', error: e.message });
      failed++;
      continue;
    }

    const opts: DownloadOptions = {
      url,
      platform,
      mode:          item.mode as Mode,
      format:        item.format,
      quality:       item.quality,
      outputDir:     config.outputDir,
      cookies:       config.cookies ?? undefined,
      retries:       config.retries,
      timeout:       config.timeout,
      overwrite:     config.overwrite,
      embedThumbnail: config.embedThumbnail,
      subtitles:     config.subtitles,
      subtitleLangs: config.subtitleLangs,
      autoSubtitles: config.autoSubtitles,
    };

    const s = p.spinner();
    s.start(clr.dim('Downloading'));

    try {
      const saved = await download(opts, (prog) => {
        const pct  = Math.round(prog.percent);
        s.message(`${bar(prog.percent)}  ${String(pct).padStart(3)}%  ·  ${prog.speed}  ·  ETA ${prog.eta}`);
      });

      s.stop(`${clr.success('[ok]')}  Done`);
      if (saved) p.log.success(`Saved  ${clr.dim(saved)}`);

      updateQueueItem(item.id, { status: 'done', filename: saved || undefined });
      pushHistory({
        timestamp: new Date().toISOString(), url: item.url, platform,
        mode: item.mode, format: item.format, quality: item.quality,
        outputDir: config.outputDir,
        status: 'success', filename: saved || undefined,
      });
      passed++;
    } catch (e: any) {
      s.stop(`${clr.error('[!!]')}  Failed`);
      const msg = friendlyError(e.message, platform, !!config.cookies);
      p.log.error(msg);
      updateQueueItem(item.id, { status: 'failed', error: e.message });
      pushHistory({
        timestamp: new Date().toISOString(), url: item.url, platform,
        mode: item.mode, format: item.format, quality: item.quality,
        outputDir: config.outputDir,
        status: 'failed', error: e.message,
      });
      failed++;
    }

    console.log();
  }

  p.log.success(
    `Queue finished  --  ${clr.success(String(passed))} done  ·  ` +
    `${failed ? clr.error(String(failed)) : '0'} failed`
  );
}

// -- Show queue contents --------------------------------------------------
export function displayQueue(): void {
  const queue = loadQueue();
  if (!queue.length) {
    p.log.info('Queue is empty.');
    return;
  }

  const statusIcon = (s: QueueItem['status']) =>
    ({ pending: '[-]', downloading: '[>]', done: clr.success('[ok]'), failed: clr.error('[!!]'), skipped: clr.warn('–') }[s]);

  const rows = queue.map((item, i) => {
    const icon  = statusIcon(item.status);
    const url   = item.url.length > 55 ? item.url.slice(0, 52) + '...' : item.url;
    const meta  = clr.dim(`${item.mode}  ${item.format}${item.quality ? `  ${item.quality}` : ''}`);
    return `  ${icon}  ${String(i + 1).padStart(2)}.  ${url}  ${meta}`;
  });

  p.note(rows.join('\n'), `Queue (${queue.length} items)`);
}

// -- Clear finished items -------------------------------------------------
export function clearFinished(): void {
  const queue   = loadQueue();
  const before  = queue.length;
  const after   = queue.filter((i) => i.status === 'pending' || i.status === 'downloading');
  saveQueue(after);
  const removed = before - after.length;
  p.log.info(`Removed ${removed} finished item${removed !== 1 ? 's' : ''} from queue.`);
}

// -- Internal helper ------------------------------------------------------
function updateQueueItem(id: string, patch: Partial<QueueItem>): void {
  const queue = loadQueue().map((i) => i.id === id ? { ...i, ...patch } : i);
  saveQueue(queue);
}
