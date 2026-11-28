// update.mjs - Android 更新清单与短期下载地址
const MANIFEST_PATH = 'updates/android/latest.json';
const MANIFEST_MAX_BYTES = 64 * 1024;
const PUBLIC_ORIGIN = 'https://gjq-schedule-2026-8ahpb1ikp5c.qoder.zone';
const APK_PATH_RE = /^updates\/android\/[A-Za-z0-9._-]+\.apk$/;
const SHA256_RE = /^[a-f0-9]{64}$/i;

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'Content-Type, Accept',
  'access-control-max-age': '86400',
};

const json = (body, status = 200, extraHeaders = {}) => Response.json(body, {
  status,
  headers: { 'cache-control': 'no-store', ...extraHeaders },
});
const corsJson = (body, status = 200) => json(body, status, CORS_HEADERS);

async function readLimited(response, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('empty_manifest');
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('manifest_too_large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function validManifest(m) {
  return m
    && Number.isInteger(m.versionCode)
    && m.versionCode > 0
    && typeof m.versionName === 'string'
    && m.versionName.length > 0
    && m.versionName.length <= 32
    && typeof m.notes === 'string'
    && m.notes.length <= 2000
    && typeof m.apkObjectPath === 'string'
    && APK_PATH_RE.test(m.apkObjectPath)
    && typeof m.sha256 === 'string'
    && SHA256_RE.test(m.sha256);
}

export async function handleUpdate(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== 'GET') return corsJson({ error: 'method_not_allowed' }, 405);

  const currentCode = Number(new URL(request.url).searchParams.get('versionCode'));
  if (!Number.isInteger(currentCode) || currentCode < 0) return corsJson({ error: 'invalid_version' }, 400);

  try {
    const { storage } = await import('./_qoder/storage.mjs');
    const manifestRes = await storage.download(MANIFEST_PATH);
    const manifest = JSON.parse(await readLimited(manifestRes, MANIFEST_MAX_BYTES));
    if (!validManifest(manifest)) return corsJson({ error: 'invalid_manifest' }, 503);
    if (manifest.versionCode <= currentCode) return corsJson({ update: false });

    const signed = await storage.createSignedUrl(manifest.apkObjectPath, 3600);
    if (!signed?.signedUrl) return corsJson({ error: 'download_unavailable' }, 503);
    const signedUrl = new URL(signed.signedUrl, PUBLIC_ORIGIN);
    const downloadUrl = new URL(signedUrl.pathname + signedUrl.search, PUBLIC_ORIGIN).toString();

    return corsJson({
      update: true,
      latest: {
        versionCode: manifest.versionCode,
        versionName: manifest.versionName,
        notes: manifest.notes,
        sha256: manifest.sha256.toLowerCase(),
        size: Number.isInteger(manifest.size) ? manifest.size : null,
        publishedAt: typeof manifest.publishedAt === 'string' ? manifest.publishedAt : null,
        downloadUrl,
      },
    });
  } catch {
    return corsJson({ error: 'update_unavailable' }, 503);
  }
}
