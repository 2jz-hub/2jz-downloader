import Conf from 'conf';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { readFileSync, mkdirSync } from 'fs';
import { writeFileSync as atomicWrite } from 'atomically';

// -- Config ---------------------------------------------------------------
export interface Config {
  outputDir:        string;
  retries:          number;
  timeout:          number;
  writeInfoJson:    boolean;
  overwrite:        boolean;
  allowPlaylist:    boolean;
  cookies:          string | null;
  verbose:          boolean;
  embedThumbnail:   boolean;
  subtitles:        boolean;
  subtitleLangs:    string;   // comma-separated, e.g. "en,es"
  autoSubtitles:    boolean;  // include auto-generated subtitles
}

const DEFAULTS: Config = {
  outputDir:      join(homedir(), '2jz_downloads'),
  retries:        5,
  timeout:        30,
  writeInfoJson:  false,
  overwrite:      false,
  allowPlaylist:  false,
  cookies:        null,
  verbose:        false,
  embedThumbnail: false,
  subtitles:      false,
  subtitleLangs:  'en',
  autoSubtitles:  false,
};

const store = new Conf<Config>({ projectName: '2jz', defaults: DEFAULTS });

export const cfg = {
  get:  ()                                    => store.store,
  set:  <K extends keyof Config>(k: K, v: Config[K]) => store.set(k, v),
  path: ()                                    => store.path,
};

// -- Queue ----------------------------------------------------------------
export type QueueStatus = 'pending' | 'downloading' | 'done' | 'failed' | 'skipped';

export interface QueueItem {
  id:        string;
  url:       string;
  platform:  string;
  mode:      string;
  format:    string;
  quality?:  string;
  status:    QueueStatus;
  error?:    string;
  filename?: string;
  addedAt:   string;
}

const QUEUE_FILE = join(homedir(), '.2jz_queue.json');

export function loadQueue(): QueueItem[] {
  try { return JSON.parse(readFileSync(QUEUE_FILE, 'utf8')) as QueueItem[]; }
  catch { return []; }
}

export function saveQueue(queue: QueueItem[]): void {
  try {
    mkdirSync(dirname(QUEUE_FILE), { recursive: true });
    atomicWrite(QUEUE_FILE, JSON.stringify(queue, null, 2));
  } catch (e: any) {
    // Non-fatal: if we can't persist the queue, carry on -- the in-memory state
    // is still correct for the current session.
    process.stderr.write(`[2jz] Warning: could not save queue: ${e.message}\n`);
  }
}

export function clearFinishedFromQueue(): void {
  const q = loadQueue().filter((i) => i.status === 'pending' || i.status === 'downloading');
  saveQueue(q);
}

// -- History --------------------------------------------------------------
export interface HistoryEntry {
  timestamp:  string;
  url:        string;
  platform:   string;
  mode:       string;
  format:     string;
  quality?:   string;
  outputDir:  string;
  status:     'success' | 'failed';
  error?:     string;
  filename?:  string;
}

const HISTORY_FILE = join(homedir(), '.2jz_history.json');
const MAX_ENTRIES  = 200;

export function loadHistory(): HistoryEntry[] {
  try { return JSON.parse(readFileSync(HISTORY_FILE, 'utf8')) as HistoryEntry[]; }
  catch { return []; }
}

export function pushHistory(entry: HistoryEntry): void {
  try {
    const history = loadHistory();
    history.push(entry);
    mkdirSync(dirname(HISTORY_FILE), { recursive: true });
    atomicWrite(HISTORY_FILE, JSON.stringify(history.slice(-MAX_ENTRIES), null, 2));
  } catch (e: any) {
    process.stderr.write(`[2jz] Warning: could not save history: ${e.message}\n`);
  }
}
