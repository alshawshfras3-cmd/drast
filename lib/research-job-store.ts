import { randomUUID } from 'node:crypto';
import { PILOT_COMPANIES } from './pilot-catalog.mjs';
import { validateResearchJobPayload, type ResearchJob, type CloudJobSummary, type TaskStatus } from '../app/pilot-browser-store';
import { storageReady, supabaseFetch, supabaseProjectRef, storageConfigurationMessage } from './supabase-storage';

export class ResearchCloudError extends Error {
  constructor(message:string, public status=503, public code='cloud_unavailable'){super(message);this.name='ResearchCloudError';}
}
const ID=/^[a-zA-Z0-9-]{1,80}$/;
const VERSION=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const PAGE=20;
const allowedCompanies=PILOT_COMPANIES.map(company=>company.id);
function ownerKey(owner:string){if(!/^[a-zA-Z0-9_-]{1,128}$/.test(owner))throw new ResearchCloudError('مساحة غير مصرح بها.',403,'forbidden');return owner;}
function jobKey(id:string){if(!ID.test(id))throw new ResearchCloudError('معرّف المهمة غير صالح.',400,'invalid_job');return id;}
function versionKey(version:unknown){if(typeof version!=='string'||!VERSION.test(version))throw new ResearchCloudError('رقم النسخة السحابية غير صالح.',400,'invalid_version');return version;}
function path(owner:string, parameters:Record<string,string>){return `/rest/v1/research_jobs?${new URLSearchParams({owner:`eq.${ownerKey(owner)}`,...parameters})}`;}
function dateValue(value:unknown){return typeof value==='string'&&Number.isFinite(Date.parse(value));}
export function cloudJobPayload(value:unknown):ResearchJob {
  let job:ResearchJob;try{job=validateResearchJobPayload(value,allowedCompanies);}catch{throw new ResearchCloudError('بنية المهمة أو أدلتها غير صالحة للحفظ.',400,'invalid_job');}
  const reportText=job.report?[job.report.title,job.report.summary,...job.report.sections.flatMap(section=>[section.title,section.body]),...job.report.limitations,...job.report.nextWatch].join(''):'';
  if(reportText.length>300000||[job.stage,job.error].some(text=>text&&text.length>2000)||job.model&&job.model.length>300)throw new ResearchCloudError('حجم نص المهمة يتجاوز الحد المسموح.',413,'job_too_large');
  if(Buffer.byteLength(JSON.stringify(job),'utf8')>1900000)throw new ResearchCloudError('حجم المهمة يتجاوز الحد المسموح.',413,'job_too_large');
  return job;
}
type Dependencies={ready:()=>boolean;request:(path:string,init?:RequestInit)=>Promise<Response>;now:()=>string;uuid:()=>string;projectRef:()=>string|null};
export function createResearchJobStore(dependencies:Partial<Dependencies>={}){
  const ready=dependencies.ready||storageReady,request=dependencies.request||supabaseFetch,now=dependencies.now||(()=>new Date().toISOString()),uuid=dependencies.uuid||randomUUID,projectRef=dependencies.projectRef||supabaseProjectRef;
  function configured(){if(!ready())throw new ResearchCloudError('الحفظ السحابي غير مهيّأ. أضف إعدادات Supabase الخاصة بهذا المشروع أولًا.',503,'cloud_unconfigured');}
  async function rows(response:Response){if(!response.ok)throw new ResearchCloudError('تعذّر الوصول إلى جدول مهام Supabase. تحقق من الاتصال والمفاتيح وتهيئة الجدول.');let value:unknown;try{value=await response.json();}catch{throw new ResearchCloudError('استجابة قاعدة البيانات غير مكتملة.');}if(!Array.isArray(value))throw new ResearchCloudError('استجابة قاعدة البيانات غير صالحة.');return value as Record<string,any>[];}
  async function status(owner:string){ownerKey(owner);if(!ready())return{configured:false,connected:false,projectRef:projectRef(),message:storageConfigurationMessage()};try{await rows(await request(path(owner,{select:'id',limit:'1'})));return{configured:true,connected:true,projectRef:projectRef()};}catch{return{configured:true,connected:false,projectRef:projectRef(),message:'إعدادات Supabase موجودة، لكن لم ينجح الوصول إلى جدول المهام. لم يتأكد أي حفظ سحابي.'};}}
  async function list(owner:string,offset=0){
    configured();if(!Number.isSafeInteger(offset)||offset<0||offset>1000)throw new ResearchCloudError('صفحة المهام غير صالحة.',400,'invalid_page');
    const records=await rows(await request(path(owner,{select:'id,version,updated_at,jobUpdatedAt:payload->>updatedAt,question:payload->>question,status:payload->>status,companyIds:payload->companyIds',order:'updated_at.desc,id.asc',limit:String(PAGE+1),offset:String(offset)})));
    const jobs:CloudJobSummary[]=records.slice(0,PAGE).map(row=>{jobKey(row.id);versionKey(row.version);if(!dateValue(row.updated_at))throw new ResearchCloudError('بيانات نسخة سحابية غير صالحة.');return{id:row.id,version:row.version,updatedAt:row.updated_at,jobUpdatedAt:dateValue(row.jobUpdatedAt)?row.jobUpdatedAt:undefined,question:typeof row.question==='string'?row.question.slice(0,2000):undefined,status:['queued','collecting','drafting','paused','ready','sources_only','blocked','failed','no_change'].includes(row.status)?row.status as TaskStatus:undefined,companyIds:Array.isArray(row.companyIds)?row.companyIds.filter((id:unknown)=>typeof id==='string'&&allowedCompanies.includes(id)):[]};});
    return{configured:true,connected:true,projectRef:projectRef(),jobs,nextOffset:records.length>PAGE?offset+PAGE:null};
  }
  async function read(owner:string,id:string){configured();jobKey(id);const result=await rows(await request(path(owner,{id:`eq.${id}`,select:'id,payload,version,updated_at',limit:'1'})));if(!result[0])throw new ResearchCloudError('النسخة السحابية غير موجودة في هذه المساحة.',404,'not_found');const row=result[0],job=cloudJobPayload(row.payload);if(row.id!==id||job.id!==id||!dateValue(row.updated_at))throw new ResearchCloudError('بيانات النسخة السحابية غير متسقة.');return{job,version:versionKey(row.version),updatedAt:row.updated_at};}
  async function save(owner:string,input:unknown,expectedVersion:unknown){
    configured();ownerKey(owner);const job=cloudJobPayload(input);jobKey(job.id);if(expectedVersion!==null)versionKey(expectedVersion);const version=uuid(),updatedAt=now();
    const updating=expectedVersion!==null;
    const response=await request(updating?path(owner,{id:`eq.${job.id}`,version:`eq.${expectedVersion}`,select:'id,version,updated_at'}):'/rest/v1/research_jobs',{
      method:updating?'PATCH':'POST',headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify(updating?{payload:job,version,updated_at:updatedAt}:{owner,id:job.id,payload:job,version,updated_at:updatedAt})
    });
    if(response.status===409)throw new ResearchCloudError('توجد نسخة سحابية مختلفة لهذه المهمة. لم تُستبدل؛ استعدها كنسخة مستقلة للمراجعة.',409,'conflict');
    const result=await rows(response);if(!result.length&&updating)throw new ResearchCloudError('تغيرت النسخة السحابية منذ آخر حفظ. لم تُستبدل تعديلات أي جهاز.',409,'conflict');
    const row=result[0];if(!row||row.id!==job.id||row.version!==version||!dateValue(row.updated_at))throw new ResearchCloudError('لم يتأكد حفظ النسخة السحابية. بقيت النسخة المحلية محفوظة.');
    return{id:job.id,version:row.version,updatedAt:row.updated_at};
  }
  return{status,list,read,save};
}
export const researchJobStore=createResearchJobStore();
