// A single team workspace behind Vercel Deployment Protection.
// Sites identity headers are never trusted on independent hosting.
export function workspaceActor(request, configuration = process.env) {
  const hostname = new URL(`https://${request.headers.get('host') || new URL(request.url).host}`).hostname;
  if (configuration.NODE_ENV === 'development' && ['localhost', '127.0.0.1', 'terminal.local'].includes(hostname)) return 'private-workspace';
  if (configuration.VERCEL !== '1' || configuration.DRAST_PRIVATE_WORKSPACE !== 'enabled') return null;
  const hosts = [configuration.VERCEL_URL, configuration.VERCEL_BRANCH_URL, configuration.VERCEL_PROJECT_PRODUCTION_URL,
    'drast-frias-projects12.vercel.app', 'drast-git-main-frias-projects12.vercel.app'].filter(Boolean);
  return hosts.includes(hostname) && hostname.endsWith('.vercel.app') ? 'private-workspace' : null;
}
export function sameOrigin(request) {
  const internal = new URL(request.url);
  // Next.js can use an internal URL behind the Vercel TLS proxy.
  const protocol = request.headers.get('x-forwarded-proto') === 'https' ? 'https:' : internal.protocol;
  const expected = new URL(`${protocol}//${request.headers.get('host') || internal.host}`);
  return request.headers.get('origin') === expected.origin;
}
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_TEXT_BYTES = 3 * 1024 * 1024;
export function documentPath(id, extension) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id) || !/^(pdf|txt|csv|json)$/.test(extension)) throw Error('معرّف الملف أو نوعه غير صالح.');
  return `drast/private-workspace/files/${id}.${extension}`;
}
export function validateUploadPath(pathname) {
  const match = /^drast\/private-workspace\/files\/([^/]+)\.(pdf|txt|csv|json)$/.exec(pathname);
  if (!match || documentPath(match[1], match[2]) !== pathname) throw Error('مسار رفع غير مسموح.');
  return { id: match[1], extension: match[2] };
}
