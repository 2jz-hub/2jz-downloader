/**
 * test/downloader.test.ts
 *
 * Unit tests for src/core/downloader.ts
 * Run: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseVideoHeight,
  buildVideoSelector,
  buildArgs,
  friendlyError,
} from '../src/core/downloader.js';

import type { DownloadOptions } from '../src/core/downloader.js';

// -- parseVideoHeight -----------------------------------------------------
test('parseVideoHeight -- named labels', () => {
  assert.equal(parseVideoHeight('4k'),  2160);
  assert.equal(parseVideoHeight('4K'),  2160);
  assert.equal(parseVideoHeight('8k'),  4320);
  assert.equal(parseVideoHeight('2k'),  1440);
  assert.equal(parseVideoHeight('qhd'), 1440);
  assert.equal(parseVideoHeight('QHD'), 1440);
});

test('parseVideoHeight -- progressive labels (NNNp)', () => {
  assert.equal(parseVideoHeight('1080p'),    1080);
  assert.equal(parseVideoHeight('720p'),     720);
  assert.equal(parseVideoHeight('480p'),     480);
  assert.equal(parseVideoHeight('360p'),     360);
  assert.equal(parseVideoHeight('2160p'),    2160);
  // With fps suffix -- common in yt-dlp format notes
  assert.equal(parseVideoHeight('1080p60'),  1080);
  assert.equal(parseVideoHeight('720p30'),   720);
});

test('parseVideoHeight -- WxH resolution strings', () => {
  assert.equal(parseVideoHeight('1920x1080'),   1080);
  assert.equal(parseVideoHeight('2560x1440'),   1440);
  assert.equal(parseVideoHeight('1920 x 1080'), 1080);
  assert.equal(parseVideoHeight('1920 x 1080'), 1080);
  assert.equal(parseVideoHeight('3840x2160'),   2160);
  assert.equal(parseVideoHeight('640x360'),     360);
});

test('parseVideoHeight -- bare numeric strings (>=2 digits = height)', () => {
  assert.equal(parseVideoHeight('720'),  720);
  assert.equal(parseVideoHeight('1080'), 1080);
  assert.equal(parseVideoHeight('480'),  480);
  assert.equal(parseVideoHeight('100'),  100);  // valid ultra-low-res height
});

test('parseVideoHeight -- null / empty / short returns null', () => {
  assert.equal(parseVideoHeight(null),      null);
  assert.equal(parseVideoHeight(undefined), null);
  assert.equal(parseVideoHeight(''),        null);
  assert.equal(parseVideoHeight('audio only'), null);
  assert.equal(parseVideoHeight('storyboard'), null);
  // Single-digit numbers should NOT match (not valid heights)
  assert.equal(parseVideoHeight('9'), null);
});

// -- buildVideoSelector ---------------------------------------------------
test('buildVideoSelector -- best mp4 with ffmpeg', () => {
  const args = buildVideoSelector('mp4', undefined, true);
  assert.ok(args.includes('-f'));
  assert.ok(args.some((a) => a.includes('bv*') && a.includes('ext=mp4')));
  assert.ok(args.includes('--merge-output-format'));
  assert.ok(args.includes('mp4'));
});

test('buildVideoSelector -- best webm with ffmpeg', () => {
  const args = buildVideoSelector('webm', undefined, true);
  assert.ok(args.some((a) => a.includes('ext=webm')));
  assert.ok(args.includes('webm'));
});

test('buildVideoSelector -- mkv with ffmpeg', () => {
  const args = buildVideoSelector('mkv', undefined, true);
  assert.ok(args.includes('mkv'));
});

test('buildVideoSelector -- quality constraint applied (ffmpeg)', () => {
  const args = buildVideoSelector('mp4', '720p', true);
  const fmt  = args[args.indexOf('-f') + 1];
  assert.ok(fmt.includes('height<=720'), `format should include height<=720, got: ${fmt}`);
  assert.ok(fmt.includes('ext=mp4'));
});

test('buildVideoSelector -- quality constraint as WxH resolution (ffmpeg)', () => {
  const args = buildVideoSelector('mp4', '2560x1440', true);
  const fmt  = args[args.indexOf('-f') + 1];
  assert.ok(fmt.includes('height<=1440'));
});

test('buildVideoSelector -- no ffmpeg falls back to single-file formats', () => {
  const args = buildVideoSelector('mp4', '1080p', false);
  assert.deepEqual(args, ['-f', 'best[height<=1080][ext=mp4]/best[height<=1080]/best[ext=mp4]/best']);
});

test('buildVideoSelector -- no ffmpeg, no quality -> simple best', () => {
  const args = buildVideoSelector('mp4', undefined, false);
  assert.deepEqual(args, ['-f', 'best[ext=mp4]/best']);
});

test('buildVideoSelector -- no ffmpeg webm fallback', () => {
  const args = buildVideoSelector('webm', '720p', false);
  assert.deepEqual(args, ['-f', 'best[height<=720][ext=webm]/best[height<=720]/best[ext=webm]/best']);
});

test('buildVideoSelector -- throws on invalid quality string', () => {
  assert.throws(
    () => buildVideoSelector('mp4', 'ultra', true),
    /Unsupported quality/i,
  );
});

// -- buildArgs ------------------------------------------------------------
function baseOpts(overrides: Partial<DownloadOptions> = {}): DownloadOptions {
  return {
    url:       'https://youtu.be/test',
    platform:  'youtube',
    mode:      'video',
    format:    'mp4',
    outputDir: '/tmp/2jz_test',
    ...overrides,
  };
}

test('buildArgs -- always includes --no-part', () => {
  const args = buildArgs(baseOpts());
  assert.ok(args.includes('--no-part'), 'Missing --no-part flag');
});

test('buildArgs -- always includes --no-check-certificates', () => {
  const args = buildArgs(baseOpts());
  assert.ok(args.includes('--no-check-certificates'));
});

test('buildArgs -- always includes --add-metadata', () => {
  const args = buildArgs(baseOpts());
  assert.ok(args.includes('--add-metadata'));
});

test('buildArgs -- youtube playlist blocked by default', () => {
  const args = buildArgs(baseOpts({ allowPlaylist: false }));
  assert.ok(args.includes('--no-playlist'));
});

test('buildArgs -- youtube playlist allowed when set', () => {
  const args = buildArgs(baseOpts({ allowPlaylist: true }));
  assert.ok(!args.includes('--no-playlist'));
});

test('buildArgs -- video mode: includes format selector', () => {
  const args = buildArgs(baseOpts({ mode: 'video', format: 'mp4' }));
  assert.ok(args.includes('-f'));
});

test('buildArgs -- audio mode: includes -x and --audio-format', () => {
  const args = buildArgs(baseOpts({ mode: 'audio', format: 'mp3' }));
  assert.ok(args.includes('-x'));
  assert.ok(args.includes('--audio-format'));
  assert.ok(args.includes('mp3'));
});

test('buildArgs -- audio mode best: does not add -x', () => {
  const args = buildArgs(baseOpts({ mode: 'audio', format: 'best' }));
  assert.ok(!args.includes('-x'), '-x should not appear when format is "best"');
});

test('buildArgs -- image mode youtube: skip-download + write-thumbnail', () => {
  const args = buildArgs(baseOpts({ mode: 'image', platform: 'youtube', format: 'original' }));
  assert.ok(args.includes('--skip-download'));
  assert.ok(args.includes('--write-thumbnail'));
});

test('buildArgs -- embed thumbnail only added for audio with ffmpeg + valid format', () => {
  const withFfmpeg = buildArgs(baseOpts({ mode: 'audio', format: 'mp3', embedThumbnail: true }), true);
  assert.ok(withFfmpeg.includes('--embed-thumbnail'));

  const noFfmpeg = buildArgs(baseOpts({ mode: 'audio', format: 'mp3', embedThumbnail: true }), false);
  assert.ok(!noFfmpeg.includes('--embed-thumbnail'), 'Thumbnail should not be embedded without ffmpeg');

  const videoMode = buildArgs(baseOpts({ mode: 'video', format: 'mp4', embedThumbnail: true }), true);
  assert.ok(!videoMode.includes('--embed-thumbnail'), 'Thumbnail embed should not apply to video mode via audio path');
});

test('buildArgs -- subtitles only added for video mode', () => {
  const videoArgs = buildArgs(baseOpts({ mode: 'video', subtitles: true, subtitleLangs: 'en' }));
  assert.ok(videoArgs.includes('--write-subs'));
  assert.ok(videoArgs.includes('--sub-langs'));

  const audioArgs = buildArgs(baseOpts({ mode: 'audio', subtitles: true }));
  assert.ok(!audioArgs.includes('--write-subs'), 'Subtitles should not apply to audio mode');
});

test('buildArgs -- subtitles mkv embeds subs', () => {
  const args = buildArgs(baseOpts({ mode: 'video', format: 'mkv', subtitles: true, subtitleLangs: 'en,fr' }));
  assert.ok(args.includes('--embed-subs'));
});

test('buildArgs -- overwrite flag toggles correctly', () => {
  const ow  = buildArgs(baseOpts({ overwrite: true }));
  const now = buildArgs(baseOpts({ overwrite: false }));
  assert.ok(ow.includes('--force-overwrites'));
  assert.ok(now.includes('--no-overwrites'));
  assert.ok(!ow.includes('--no-overwrites'));
});

test('buildArgs -- cookies appended when provided', () => {
  const args = buildArgs(baseOpts({ cookies: '/tmp/cookies.txt' }));
  const idx  = args.indexOf('--cookies');
  assert.ok(idx !== -1, 'Missing --cookies flag');
  assert.equal(args[idx + 1], '/tmp/cookies.txt');
});

test('buildArgs -- retries and timeout values are written correctly', () => {
  // buildArgs receives whatever retries value is passed; the download() wrapper
  // is what overrides retries:1 for yt-dlp. buildArgs itself must still respect
  // the value it is given (used directly in queue/batch contexts).
  const args = buildArgs(baseOpts({ retries: 8, timeout: 60 }));
  const ri   = args.indexOf('--retries');
  const ti   = args.indexOf('--socket-timeout');
  assert.ok(ri !== -1);
  assert.ok(ti !== -1);
  assert.equal(args[ri + 1], '8');
  assert.equal(args[ti + 1], '60');
});

test('buildArgs -- verbose adds --verbose flag', () => {
  const args = buildArgs(baseOpts({ verbose: true }));
  assert.ok(args.includes('--verbose'));
});

test('buildArgs -- instagram gets referer header', () => {
  const args = buildArgs(baseOpts({ platform: 'instagram' }));
  const ri   = args.indexOf('--referer');
  assert.ok(ri !== -1);
  assert.ok(args[ri + 1].includes('instagram.com'));
});

test('buildArgs -- twitter gets referer header', () => {
  const args = buildArgs(baseOpts({ platform: 'twitter' }));
  const ri   = args.indexOf('--referer');
  assert.ok(ri !== -1);
  assert.ok(args[ri + 1].includes('twitter.com'));
});

// -- friendlyError --------------------------------------------------------
test('friendlyError -- passthrough when no hints match', () => {
  const out = friendlyError('some unknown error', 'generic', false);
  assert.equal(out, 'some unknown error');
});

test('friendlyError -- format not available hint', () => {
  const out = friendlyError('requested format is not available', 'youtube', false, 'video');
  assert.ok(out.includes('->'), 'Should include hint arrow');
  assert.ok(out.toLowerCase().includes('format'));
});

test('friendlyError -- instagram cookie hint for private content', () => {
  const out = friendlyError('login required to access this content', 'instagram', false, 'video');
  assert.ok(out.includes('cookies'), `Expected cookies hint, got: ${out}`);
});

test('friendlyError -- no cookie hint when cookies are already provided', () => {
  // If they already provided cookies, no point hinting them to provide cookies
  const out = friendlyError('login required', 'instagram', true, 'video');
  // The hint about cookies should NOT appear since they have cookies set
  // (the platform check passes but hasCookies=true blocks the hint)
  assert.ok(!out.includes('cookies'), `Should not repeat cookie hint when cookies set: ${out}`);
});

test('friendlyError -- video unavailable hint', () => {
  const out = friendlyError('video unavailable', 'youtube', false, 'video');
  assert.ok(out.includes('private') || out.includes('deleted') || out.includes('geo'));
});

test('friendlyError -- ffmpeg hint on ffmpeg error', () => {
  const out = friendlyError('ERROR: ffmpeg not found', 'youtube', false, 'video');
  assert.ok(out.toLowerCase().includes('ffmpeg'));
});

test('friendlyError -- unsupported url hint', () => {
  const out = friendlyError('unsupported url: https://example.com', 'generic', false);
  assert.ok(out.includes('direct') || out.includes('post') || out.includes('profile'));
});
