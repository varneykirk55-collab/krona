import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import chromium from '@sparticuz/chromium';
mkdirSync('.data', { recursive: true });
// npm-distributed Chromium keeps browser testing feasible without access to browser download CDNs.
// Do NOT disable web security: CSRF and cookie tests must use genuine browser isolation.
const args = chromium.args.filter(
  (a) =>
    !a.includes('disable-web-security') &&
    !a.includes('disable-site-isolation-trials') &&
    !a.includes('allow-running-insecure-content') &&
    !a.includes('single-process'),
);
let executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  libPath = process.env.LD_LIBRARY_PATH || '';
if (!executablePath) {
  executablePath = await chromium.executablePath();
  const libs = resolve('.data/browser-libs');
  mkdirSync(libs, { recursive: true });
  writeFileSync(
    '.data/browser-libs.tar',
    brotliDecompressSync(readFileSync('node_modules/@sparticuz/chromium/bin/al2023.tar.br')),
  );
  execFileSync('tar', ['-xf', '.data/browser-libs.tar', '-C', libs]);
  libPath = resolve(libs, 'lib') + (libPath ? ':' + libPath : '');
}
writeFileSync('.data/browser-config.json', JSON.stringify({ executablePath, libPath, args }));
console.log('Browser ready for isolated local E2E tests. Live providers remain disabled.');
