import hmg from '@/data/hmg.json';

// Watchlist entries are empty research dossiers, never invented financial results.
const watchlist = [
  {researchCompanyId:'aramco', company:'أرامكو السعودية', ticker:'2222', sector:'الطاقة', url:'https://www.aramco.com/en/investors/reports-and-presentations'},
  {researchCompanyId:'sabic', company:'الشركة السعودية للصناعات الأساسية — سابك', ticker:'2010', sector:'المواد الأساسية', url:'https://www.sabic.com/en/investors'},
  {researchCompanyId:'stc', company:'شركة الاتصالات السعودية — stc', ticker:'7010', sector:'الاتصالات', url:'https://www.stc.com/en/investors/financial-reports/financial-statement.html'},
  {researchCompanyId:'almarai', company:'شركة المراعي', ticker:'2280', sector:'إنتاج الأغذية', url:'https://www.almarai.com/en/corporate/investors/press-releases'},
];
export const seedStudies:any[] = [
  {...hmg, researchCompanyId:'hmg'},
  ...watchlist.map(({url,...company}) => ({
    ...company, id:`${company.researchCompanyId}-watchlist`, year:2026, asOf:'2026-11-02', status:'draft',
    coverage:'ملف متابعة جديد. شغّل مهمة بحث لجمع المصادر؛ لم تُعتمد أرقام مالية لهذه الشركة بعد.',
    sources:[{id:`${company.researchCompanyId}-ir`,title:'علاقات المستثمرين — نقطة بدء البحث',url,publishedAt:null,documentType:'فهرس مصادر',verification:'رابط فهرسة؛ لا يُعد دليلًا على رقم مالي أو اكتمال الإفصاحات.'}],
    quarters:[], findings:[],
    limitations:['هذا ملف متابعة غير مكتمل. البيانات غير المتاحة لا تعني صفرًا.','تُجمع الأدلة في مكتب الأبحاث، وتبقى الأرقام المالية خارج المقارنة إلى أن تُراجع فترتها ووحدتها ومصدرها.'],
    nextWatch:['تشغيل جمع المصادر الرسمية ومراجعة أحدث القوائم والإيضاحات.'],
  })),
];
