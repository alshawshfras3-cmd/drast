import { handleUploadPresigned, type HandleUploadPresignedBody } from '@vercel/blob/client';
import { issueSignedToken } from '@vercel/blob';
import { actor, originAllowed, response } from '@/lib/repository';
import { storageReady, STORAGE_MESSAGE } from '@/lib/blob-storage';
import { validateUploadPath, MAX_FILE_BYTES } from '@/lib/access-policy.mjs';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  if (!actor(request)) return response({ error: 'يلزم الدخول إلى المساحة المحمية.' },401);
  if (!originAllowed(request)) return response({ error: 'مصدر الطلب غير مسموح.' },403);
  if (!storageReady()) return response({ error: STORAGE_MESSAGE },503);
  try {
    const body = await request.json() as HandleUploadPresignedBody;
    // The authenticated browser finalizes uploads; no public webhook is needed.
    if (body.type !== 'blob.generate-presigned-url') return response({error:'طلب غير مسموح.'},400);
    return response(await handleUploadPresigned({
      body, request,
      getSignedToken: async (pathname, _payload, multipart) => {
        validateUploadPath(pathname);
        if (multipart) throw Error('Multipart is not needed for these reports.');
        const constraints = { pathname, maximumSizeInBytes: MAX_FILE_BYTES,
          allowedContentTypes: ['application/pdf','text/plain','text/csv','application/json','application/octet-stream','application/vnd.ms-excel'],
          validUntil: Date.now() + 15 * 60 * 1000,
        };
        return { token: await issueSignedToken({ ...constraints, operations: ['put'] }),
          urlOptions: { ...constraints, addRandomSuffix: false, allowOverwrite: false } };
      },
    }));
  } catch { console.error('upload_token_failed'); return response({ error: 'تعذّر إصدار إذن الرفع. تحقق من التخزين الخاص.' },400); }
}
