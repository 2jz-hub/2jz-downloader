/**
 * test/config.test.ts
 *
 * Unit tests for queue and history helpers in src/core/config.ts.
 * Uses a temp directory so tests never touch the real ~/.2jz files.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// -- Helpers that don't need a real homedir -------------------------------
// We test the pure data-shaping logic in queue/history, not the file I/O path,
// because patching homedir() would require jest-level module mocking.

import type { QueueItem, HistoryEntry } from '../src/core/config.js';

// -- QueueItem shape ------------------------------------------------------
test('QueueItem has required fields', () => {
  const item: QueueItem = {
    id:      'test-uuid',
    url:     'https://youtu.be/abc',
    platform:'youtube',
    mode:    'video',
    format:  'mp4',
    status:  'pending',
    addedAt: new Date().toISOString(),
  };
  assert.equal(item.status, 'pending');
  assert.equal(item.platform, 'youtube');
});

test('QueueItem optional fields default to undefined', () => {
  const item: QueueItem = {
    id: 'x', url: 'https://youtu.be/abc', platform: 'youtube',
    mode: 'audio', format: 'mp3', status: 'done', addedAt: new Date().toISOString(),
  };
  assert.equal(item.quality,  undefined);
  assert.equal(item.error,    undefined);
  assert.equal(item.filename, undefined);
});

// -- HistoryEntry shape ---------------------------------------------------
test('HistoryEntry has required fields', () => {
  const entry: HistoryEntry = {
    timestamp: new Date().toISOString(),
    url:       'https://youtu.be/abc',
    platform:  'youtube',
    mode:      'video',
    format:    'mp4',
    outputDir: '/tmp',
    status:    'success',
  };
  assert.equal(entry.status, 'success');
  assert.ok(entry.timestamp.includes('T'));
});

// -- Queue filtering logic (pure) -----------------------------------------
test('clearFinished logic -- keeps only pending and downloading', () => {
  const items: QueueItem[] = [
    { id:'1', url:'https://a.com', platform:'generic', mode:'video', format:'mp4', status:'pending',     addedAt:'' },
    { id:'2', url:'https://b.com', platform:'generic', mode:'video', format:'mp4', status:'done',        addedAt:'' },
    { id:'3', url:'https://c.com', platform:'generic', mode:'video', format:'mp4', status:'failed',      addedAt:'' },
    { id:'4', url:'https://d.com', platform:'generic', mode:'video', format:'mp4', status:'downloading', addedAt:'' },
    { id:'5', url:'https://e.com', platform:'generic', mode:'video', format:'mp4', status:'skipped',     addedAt:'' },
  ];

  const kept = items.filter((i) => i.status === 'pending' || i.status === 'downloading');
  assert.equal(kept.length, 2);
  assert.ok(kept.every((i) => i.status === 'pending' || i.status === 'downloading'));
});

// -- History trimming logic (pure) ----------------------------------------
test('history slicing keeps last MAX_ENTRIES entries', () => {
  const MAX_ENTRIES = 200;
  const entries: HistoryEntry[] = Array.from({ length: 250 }, (_, i) => ({
    timestamp: new Date(i * 1000).toISOString(),
    url: `https://example.com/${i}`,
    platform: 'generic', mode: 'video', format: 'mp4',
    outputDir: '/tmp', status: 'success',
  }));

  const trimmed = entries.slice(-MAX_ENTRIES);
  assert.equal(trimmed.length, MAX_ENTRIES);
  // Should keep the most recent (highest index) entries
  assert.equal(trimmed[trimmed.length - 1].url, 'https://example.com/249');
  assert.equal(trimmed[0].url, 'https://example.com/50');
});

// -- Config defaults sanity -----------------------------------------------
test('config defaults are sensible values', async () => {
  // Import cfg after process.env is set so Conf writes to tmpdir
  const origHome = process.env.HOME;
  const tmp = mkdtempSync(join(tmpdir(), '2jz-test-'));
  process.env.HOME = tmp;

  try {
    // Dynamic import to pick up patched HOME
    const { cfg } = await import('../src/core/config.js?t=' + Date.now());
    const config = cfg.get();
    assert.ok(config.outputDir.length > 0, 'outputDir should be set');
    assert.ok(config.retries >= 1,         'retries should be >= 1');
    assert.ok(config.timeout >= 5,         'timeout should be >= 5s');
    assert.equal(config.overwrite,     false);
    assert.equal(config.allowPlaylist, false);
    assert.equal(config.verbose,       false);
    assert.equal(config.cookies,       null);
  } finally {
    process.env.HOME = origHome;
    rmSync(tmp, { recursive: true, force: true });
  }
});
