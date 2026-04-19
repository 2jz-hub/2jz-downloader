// -- Types ----------------------------------------------------------------
export type Platform =
  | 'youtube' | 'instagram' | 'twitter' | 'tiktok'
  | 'soundcloud' | 'reddit' | 'pinterest'
  | 'tumblr' | 'vimeo' | 'twitch' | 'dailymotion' | 'facebook'
  | 'generic';
export type Mode     = 'video' | 'audio' | 'image' | 'auto';

export const AUDIO_FORMATS = ['mp3', 'm4a', 'wav', 'flac', 'opus', 'best'] as const;
export const VIDEO_FORMATS = ['mp4', 'mkv', 'webm', 'best']                as const;
export const IMAGE_FORMATS = ['original', 'jpg', 'png', 'webp']            as const;

// -- Domain map -----------------------------------------------------------
const DOMAINS: Record<Exclude<Platform, 'generic'>, string[]> = {
  youtube:     ['youtube.com', 'youtu.be', 'music.youtube.com'],
  instagram:   ['instagram.com'],
  twitter:     ['twitter.com', 'x.com'],
  tiktok:      ['tiktok.com', 'vm.tiktok.com'],
  soundcloud:  ['soundcloud.com', 'on.soundcloud.com'],
  reddit:      ['reddit.com', 'redd.it', 'v.redd.it'],
  pinterest:   ['pinterest.com', 'pin.it'],
  tumblr:      ['tumblr.com'],
  vimeo:       ['vimeo.com'],
  twitch:      ['twitch.tv', 'clips.twitch.tv'],
  dailymotion: ['dailymotion.com', 'dai.ly'],
  facebook:    ['facebook.com', 'fb.com', 'fb.watch'],
};

// -- URL helpers ----------------------------------------------------------
export function normalizeUrl(raw: string): string {
  const s = raw.trim();
  if (!s) throw new Error('URL cannot be empty.');
  const withScheme = s.includes('://') ? s : `https://${s}`;
  let parsed: URL;
  try { parsed = new URL(withScheme); } catch {
    throw new Error(`Invalid URL: "${s}"`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol))
    throw new Error('URL must use http or https.');
  return withScheme;
}

export function detectPlatform(url: string): Platform {
  const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  for (const [platform, domains] of Object.entries(DOMAINS) as [Platform, string[]][]) {
    if (domains.some((d) => hostname === d || hostname.endsWith(`.${d}`)))
      return platform;
  }
  return 'generic';
}

export function validateUrlShape(url: string, platform: Platform, allowPlaylist: boolean): void {
  const { hostname, pathname, searchParams } = new URL(url);
  const path = pathname.replace(/\/$/, '') || '/';

  if (platform === 'youtube') {
    // music.youtube.com has its own URL conventions (watch, playlist, browse)
    // that differ from youtube.com -- skip shape validation entirely for it.
    if (hostname.replace(/^www\./, '') === 'music.youtube.com') return;
    if (allowPlaylist) return;
    if (path === '/playlist')
      throw new Error('YouTube playlists require Allow playlists in Settings.');
    if (/^\/(channel|c|user)\/.+/.test(path) || path.startsWith('/@'))
      throw new Error('YouTube channels require Allow playlists in Settings.');
    if (path === '/watch' && !searchParams.has('v'))
      throw new Error('YouTube /watch URL is missing ?v= parameter.');
    if (path === '/' || path === '')
      throw new Error('YouTube URL must point to a video or short.');
  } else if (platform === 'instagram') {
    if (!/^\/(p|reel|tv|stories)\//.test(path))
      throw new Error('Instagram URL must point to a post, reel, IGTV, or story.');
  } else if (platform === 'twitter') {
    if (!path.includes('/status/') && !path.includes('/i/web/status/'))
      throw new Error('Twitter/X URL must point to a tweet (must include /status/).');
  }
  // tiktok, soundcloud, reddit, generic: no shape validation
}

export function defaultFormat(mode: Mode): string {
  return { video: 'mp4', audio: 'mp3', image: 'original', auto: 'best' }[mode];
}

export function platformLabel(platform: Platform): string {
  return {
    youtube:     'YouTube',
    instagram:   'Instagram',
    twitter:     'Twitter/X',
    tiktok:      'TikTok',
    soundcloud:  'SoundCloud',
    reddit:      'Reddit',
    pinterest:   'Pinterest',
    tumblr:      'Tumblr',
    vimeo:       'Vimeo',
    twitch:      'Twitch',
    dailymotion: 'Dailymotion',
    facebook:    'Facebook',
    generic:     'Web',
  }[platform];
}

/** Platforms where image/thumbnail download makes sense */
export function supportsImageMode(platform: Platform): boolean {
  return ['youtube', 'instagram', 'twitter', 'reddit', 'pinterest', 'tumblr', 'facebook'].includes(platform);
}

/**
 * Platforms where the downloaded image can be converted via --convert-thumbnails.
 */
export function supportsImageConversion(platform: Platform): boolean {
  return ['youtube', 'instagram', 'twitter'].includes(platform);
}

/** Platforms that are primarily audio */
export function isAudioPlatform(platform: Platform): boolean {
  return platform === 'soundcloud';
}

/**
 * Smart auto-mode resolution: picks the best mode per platform.
 * SoundCloud -> audio, Pinterest/Tumblr image posts -> image, else -> video.
 */
export function resolveAutoMode(platform: Platform): Exclude<Mode, 'auto'> {
  if (isAudioPlatform(platform)) return 'audio';
  if (platform === 'pinterest')  return 'image';
  return 'video';
}
