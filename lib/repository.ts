import { seedStudies } from './seeds';
import { storage } from './supabase-storage';
import { createRepository } from './repository-core.mjs';
import { workspaceActor, sameOrigin } from './access-policy.mjs';
export const actor = (request: Request): string | null => workspaceActor(request);
export const originAllowed = sameOrigin;
export function response(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}
const repository = createRepository(storage, seedStudies);
export const { listStudies, readReviewedStudy, saveStudy, listDocuments, readDocument, saveDocument, readFile } = repository;
export async function getStudy(owner: string, id: string) { return (await listStudies(owner)).find((study: any) => study.id === id) || null; }

