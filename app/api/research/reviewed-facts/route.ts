import { reviewedFactAnswer } from '@/lib/finance/reviewed-fact-answer.mjs';
import { actor, originAllowed, readReviewedStudy, response } from '@/lib/repository';
import { researchBody } from '@/lib/research-http';

export async function POST(request: Request) {
  const owner = actor(request);
  if (!owner) return response({error:'هذه مساحة عمل خاصة.'}, 401);
  if (!originAllowed(request)) return response({error:'مصدر الطلب غير مسموح.'}, 403);

  let body;
  try {
    body = await researchBody(request, 4096);
  } catch (error) {
    if (error instanceof Error && error.message === 'BODY_TOO_LARGE') {
      return response({error:'الطلب أكبر من الحد المسموح.'}, 413);
    }
    return response({error:'بنية الطلب غير صالحة.'}, 400);
  }
  const {studyId, question} = body ?? {};
  if (typeof studyId !== 'string' || typeof question !== 'string' || !question.trim() || question.length > 300) {
    return response({error:'حدد الدراسة واكتب سؤالًا قصيرًا.'}, 400);
  }
  try {
    const study = await readReviewedStudy(owner, studyId);
    if (!study) return response({error:'الدراسة المراجعة غير موجودة.'}, 404);
    return response(reviewedFactAnswer(study, question));
  } catch {
    return response({error:'تعذّرت قراءة سجل الدراسة. أعد المحاولة.'}, 503);
  }
}
