// dev/serve-web.mjs - 离线版本地预览：静态服务 web/（无后端，数据走云端导入 + localStorage）
// 用法: node dev/serve-web.mjs  → http://localhost:8124
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../web/', import.meta.url));
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
};

const NATIVE_STUB = `<script>
window.Capacitor = { Plugins: { LocalNotifications: {
  checkPermissions: async () => ({ display: 'denied' }),
  requestPermissions: async () => ({ display: 'denied' }),
  createChannel: async () => ({}),
  listChannels: async () => ({ channels: [] }),
  getPendingNotificationInfos: async () => ({ pendingNotificationInfos: [] }),
  getDeliveredNotifications: async () => ({ notifications: [] }),
  cancel: async () => ({}),
  schedule: async () => ({}),
} } };
</script>`;

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  console.log(`${req.method} ${path}`);

  let file = path === '/' ? '/index.html' : path;
  try {
    let content = await readFile(normalize(join(ROOT, file)));
    if (file === '/index.html' && url.searchParams.get('native') === '1') {
      content = Buffer.from(content.toString('utf8').replace('<script type="module"', NATIVE_STUB + '\n<script type="module"'));
    }
    res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(content);
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
}).listen(8124, () => console.log('static preview on http://localhost:8124'));
