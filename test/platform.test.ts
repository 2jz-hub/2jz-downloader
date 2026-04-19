/**
 * test/platform.test.ts
 *
 * Unit tests for src/core/platform.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeUrl,
  detectPlatform,
  validateUrlShape,
  defaultFormat,
  resolveAutoMode,
  isAudioPlatform,
  supportsImageMode,
  supportsImageConversion,
  platformLabel,
} from '../src/core/platform.js';

// -- normalizeUrl ---------------------------------------------------------
test('normalizeUrl -- adds https:// when scheme missing', () => {
  assert.equal(normalizeUrl('youtu.be/abc'), 'https://youtu.be/abc');
});

test('normalizeUrl -- passes through valid https URL unchanged', () => {
  const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  assert.equal(normalizeUrl(url), url);
});

test('normalizeUrl -- trims whitespace', () => {
  assert.equal(normalizeUrl('  https://youtu.be/abc  '), 'https://youtu.be/abc');
});

test('normalizeUrl -- throws on empty string', () => {
  assert.throws(() => normalizeUrl(''), /empty/i);
});

test('normalizeUrl -- throws on clearly invalid URL', () => {
  assert.throws(() => normalizeUrl('not a url at all!!'), /Invalid URL/i);
});

test('normalizeUrl -- throws on non-http scheme', () => {
  assert.throws(() => normalizeUrl('ftp://example.com'), /http/i);
});

// -- detectPlatform -------------------------------------------------------
test('detectPlatform -- youtube.com', () => {
  assert.equal(detectPlatform('https://www.youtube.com/watch?v=abc'), 'youtube');
});

test('detectPlatform -- youtu.be shortlink', () => {
  assert.equal(detectPlatform('https://youtu.be/abc'), 'youtube');
});

test('detectPlatform -- music.youtube.com', () => {
  assert.equal(detectPlatform('https://music.youtube.com/watch?v=abc'), 'youtube');
});

test('detectPlatform -- instagram', () => {
  assert.equal(detectPlatform('https://www.instagram.com/p/abc123/'), 'instagram');
  assert.equal(detectPlatform('https://instagram.com/reel/xyz/'), 'instagram');
});

test('detectPlatform -- twitter.com and x.com', () => {
  assert.equal(detectPlatform('https://twitter.com/user/status/123'), 'twitter');
  assert.equal(detectPlatform('https://x.com/user/status/456'), 'twitter');
});

test('detectPlatform -- tiktok', () => {
  assert.equal(detectPlatform('https://www.tiktok.com/@user/video/123'), 'tiktok');
  assert.equal(detectPlatform('https://vm.tiktok.com/abc'), 'tiktok');
});

test('detectPlatform -- soundcloud', () => {
  assert.equal(detectPlatform('https://soundcloud.com/artist/track'), 'soundcloud');
  assert.equal(detectPlatform('https://on.soundcloud.com/abc'), 'soundcloud');
});

test('detectPlatform -- reddit', () => {
  assert.equal(detectPlatform('https://www.reddit.com/r/sub/comments/abc'), 'reddit');
  assert.equal(detectPlatform('https://v.redd.it/abc'), 'reddit');
  assert.equal(detectPlatform('https://redd.it/abc'), 'reddit');
});

test('detectPlatform -- pinterest', () => {
  assert.equal(detectPlatform('https://www.pinterest.com/pin/123/'), 'pinterest');
  assert.equal(detectPlatform('https://pin.it/abc'), 'pinterest');
});

test('detectPlatform -- tumblr', () => {
  assert.equal(detectPlatform('https://ccomputerbird.tumblr.com/post/123'), 'tumblr');
  assert.equal(detectPlatform('https://www.tumblr.com/ccomputerbird/123'), 'tumblr');
});

test('detectPlatform -- vimeo', () => {
  assert.equal(detectPlatform('https://vimeo.com/123456789'), 'vimeo');
});

test('detectPlatform -- twitch', () => {
  assert.equal(detectPlatform('https://www.twitch.tv/someuser/clip/abc'), 'twitch');
  assert.equal(detectPlatform('https://clips.twitch.tv/abc'), 'twitch');
});

test('detectPlatform -- dailymotion', () => {
  assert.equal(detectPlatform('https://www.dailymotion.com/video/x8abc'), 'dailymotion');
  assert.equal(detectPlatform('https://dai.ly/x8abc'), 'dailymotion');
});

test('detectPlatform -- facebook', () => {
  assert.equal(detectPlatform('https://www.facebook.com/watch?v=123'), 'facebook');
  assert.equal(detectPlatform('https://fb.watch/abc123/'), 'facebook');
});

test('detectPlatform -- unknown domain -> generic', () => {
  assert.equal(detectPlatform('https://example.com/video'), 'generic');
});

test('detectPlatform -- subdomain does not falsely match (e.g. notyoutube.com)', () => {
  assert.equal(detectPlatform('https://notyoutube.com/watch?v=abc'), 'generic');
});

// -- validateUrlShape -----------------------------------------------------
test('validateUrlShape -- valid YouTube video URL passes', () => {
  assert.doesNotThrow(() =>
    validateUrlShape('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube', false)
  );
});

test('validateUrlShape -- youtu.be shortlinks pass', () => {
  assert.doesNotThrow(() =>
    validateUrlShape('https://youtu.be/dQw4w9WgXcQ', 'youtube', false)
  );
});

test('validateUrlShape -- YouTube Shorts pass', () => {
  assert.doesNotThrow(() =>
    validateUrlShape('https://www.youtube.com/shorts/abc123', 'youtube', false)
  );
});

test('validateUrlShape -- YouTube /watch without ?v= throws', () => {
  assert.throws(
    () => validateUrlShape('https://www.youtube.com/watch', 'youtube', false),
    /v=/i,
  );
});

test('validateUrlShape -- YouTube playlist throws without allowPlaylist', () => {
  assert.throws(
    () => validateUrlShape('https://www.youtube.com/playlist?list=abc', 'youtube', false),
    /playlist/i,
  );
});

test('validateUrlShape -- YouTube playlist allowed when allowPlaylist=true', () => {
  assert.doesNotThrow(() =>
    validateUrlShape('https://www.youtube.com/playlist?list=abc', 'youtube', true)
  );
});

test('validateUrlShape -- YouTube channel URL throws without allowPlaylist', () => {
  assert.throws(
    () => validateUrlShape('https://www.youtube.com/@channelname', 'youtube', false),
    /channel|playlist/i,
  );
  assert.throws(
    () => validateUrlShape('https://www.youtube.com/c/ChannelName', 'youtube', false),
    /channel|playlist/i,
  );
});

test('validateUrlShape -- Instagram valid post passes', () => {
  assert.doesNotThrow(() =>
    validateUrlShape('https://www.instagram.com/p/abc123/', 'instagram', false)
  );
});

test('validateUrlShape -- Instagram reel passes', () => {
  assert.doesNotThrow(() =>
    validateUrlShape('https://www.instagram.com/reel/xyz/', 'instagram', false)
  );
});

test('validateUrlShape -- Instagram profile page throws', () => {
  assert.throws(
    () => validateUrlShape('https://www.instagram.com/someuser/', 'instagram', false),
    /post|reel|story/i,
  );
});

test('validateUrlShape -- Twitter status URL passes', () => {
  assert.doesNotThrow(() =>
    validateUrlShape('https://twitter.com/user/status/123456', 'twitter', false)
  );
});

test('validateUrlShape -- Twitter profile (no /status/) throws', () => {
  assert.throws(
    () => validateUrlShape('https://twitter.com/username', 'twitter', false),
    /status/i,
  );
});

// -- defaultFormat --------------------------------------------------------
test('defaultFormat -- mode mappings', () => {
  assert.equal(defaultFormat('video'), 'mp4');
  assert.equal(defaultFormat('audio'), 'mp3');
  assert.equal(defaultFormat('image'), 'original');
  assert.equal(defaultFormat('auto'),  'best');
});

// -- resolveAutoMode ------------------------------------------------------
test('resolveAutoMode -- soundcloud -> audio', () => {
  assert.equal(resolveAutoMode('soundcloud'), 'audio');
});

test('resolveAutoMode -- pinterest -> image', () => {
  assert.equal(resolveAutoMode('pinterest'), 'image');
});

test('resolveAutoMode -- youtube -> video', () => {
  assert.equal(resolveAutoMode('youtube'), 'video');
});

test('resolveAutoMode -- instagram -> video', () => {
  assert.equal(resolveAutoMode('instagram'), 'video');
});

test('resolveAutoMode -- generic -> video', () => {
  assert.equal(resolveAutoMode('generic'), 'video');
});

// -- Helper predicates ----------------------------------------------------
test('isAudioPlatform -- only soundcloud', () => {
  assert.equal(isAudioPlatform('soundcloud'), true);
  assert.equal(isAudioPlatform('youtube'),    false);
  assert.equal(isAudioPlatform('instagram'),  false);
});

test('supportsImageMode -- expected platforms', () => {
  assert.equal(supportsImageMode('youtube'),   true);
  assert.equal(supportsImageMode('instagram'), true);
  assert.equal(supportsImageMode('twitter'),   true);
  assert.equal(supportsImageMode('reddit'),    true);
  assert.equal(supportsImageMode('pinterest'), true);
  assert.equal(supportsImageMode('tiktok'),    false);
  assert.equal(supportsImageMode('soundcloud'),false);
});

test('supportsImageConversion -- expected platforms', () => {
  assert.equal(supportsImageConversion('youtube'),   true);
  assert.equal(supportsImageConversion('instagram'), true);
  assert.equal(supportsImageConversion('twitter'),   true);
  assert.equal(supportsImageConversion('reddit'),    false);
  assert.equal(supportsImageConversion('tiktok'),    false);
});

test('platformLabel -- returns human-readable label for all platforms', () => {
  const platforms = [
    'youtube','instagram','twitter','tiktok','soundcloud',
    'reddit','pinterest','tumblr','vimeo','twitch','dailymotion','facebook','generic',
  ] as const;
  for (const platform of platforms) {
    const label = platformLabel(platform);
    assert.ok(typeof label === 'string' && label.length > 0, `Missing label for platform: ${platform}`);
  }
});
