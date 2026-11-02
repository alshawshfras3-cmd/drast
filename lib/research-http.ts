import { actor, originAllowed, response } from './repository';

export function researchAccess(request: Request, write = false) {
  if (!actor(request)) return response({ error: 'هذه مساحة عمل خاصة.' }, 401);
  if (write && !originAllowed(request)) return response({ error: 'مصدر الطلب غير مسموح.' }, 403);
  return null;
}

export async function researchBody(request: Request, maxBytes: number) {
  if (Number(request.headers.get('content-length') || 0) > maxBytes) throw new Error('BODY_TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('EMPTY_BODY');
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error('BODY_TOO_LARGE'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
