// Shared harness for the motion reel: own Vite server + GPU Chromium, frozen rAF loop,
// frame-stepped camera moves captured straight off the WebGL canvas.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export async function startServer() {
  const server = await createServer({
    root,
    configFile: resolve(root, 'vite.config.ts'),
    logLevel: 'error',
    clearScreen: false,
    cacheDir: resolve(tmpdir(), `hearthvale-reel-${process.pid}`),
    server: { port: 0, host: '127.0.0.1', strictPort: false, hmr: false, watch: null },
  });
  await server.listen();
  const addr = server.httpServer.address();
  return { server, port: addr.port };
}

export async function launchGpu() {
  const args = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--enable-gpu-rasterization', '--disable-gpu-sandbox'];
  try {
    return await chromium.launch({ headless: true, args, channel: 'chromium' });
  } catch {
    return await chromium.launch({ headless: true, args });
  }
}
