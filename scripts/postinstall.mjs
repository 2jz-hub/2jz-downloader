#!/usr/bin/env node
/**
 * Shown once after `npm install -g 2jz-media-downloader`.
 * Must be plain JS (no TypeScript) and have zero dependencies
 * beyond Node builtins -- this runs before node_modules is ready.
 */

const reset  = '\x1b[0m';
const cyan   = '\x1b[36m';
const bold   = '\x1b[1m';
const dim    = '\x1b[2m';
const green  = '\x1b[32m';
const yellow = '\x1b[33m';

const pkg = JSON.parse(
  await import('fs').then(fs =>
    fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  )
);

console.log();
console.log(`  ${bold}${cyan}2jz${reset}  ${dim}media downloader  v${pkg.version}${reset}`);
console.log();
console.log(`  ${green}[ok]${reset}  Installation complete`);
console.log();
console.log(`  ${dim}Run${reset}  ${cyan}2jz${reset}              ${dim}for the interactive menu${reset}`);
console.log(`  ${dim}Run${reset}  ${cyan}2jz --help${reset}       ${dim}for all CLI flags${reset}`);
console.log(`  ${dim}Run${reset}  ${cyan}2jz update${reset}       ${dim}to keep yt-dlp up to date${reset}`);
console.log();
console.log(`  ${yellow}Note:${reset} 2jz requires ${bold}yt-dlp${reset} and ${bold}ffmpeg${reset}.`);
console.log(`        Run ${cyan}2jz${reset} and use ${dim}Setup${reset} to install them automatically.`);
console.log();
