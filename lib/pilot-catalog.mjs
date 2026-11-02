// Curated starting points, reviewed 2026-11-02. The collector also checks the
// linked investor pages for newer reports; this is not an exhaustive news feed.
export const PILOT_COMPANIES = [
  {
    id: 'hmg', name: 'مجموعة الدكتور سليمان الحبيب للخدمات الطبية', ticker: '4013', sector: 'الرعاية الصحية',
    hosts: ['hmg.com', 'www.hmg.com'],
    hub: 'https://hmg.com/ir/en/Pages/home.aspx',
    sourceUrls: [
      'https://hmg.com/ir/en/Pages/home.aspx',
      'https://hmg.com/ir/en/Lists/Reports_Publications/Attachments/109/HMG%20FY%202025%20Investor%20Presentation.pdf',
    ],
    coverageNote: 'بوابة علاقات المستثمرين وعرض 2025 نقطة بداية؛ بيانات الحبيب الربعية الموجودة في المقارنة مستقلة عن الجمع الجديد. قد تحتاج التقارير الحديثة المنشورة ديناميكيًا إلى موصل إضافي.',
  },
  {
    id: 'aramco', name: 'أرامكو السعودية', ticker: '2222', sector: 'الطاقة',
    hosts: ['aramco.com', 'www.aramco.com'],
    hub: 'https://www.aramco.com/en/investors/reports-and-presentations',
    sourceUrls: [
      'https://www.aramco.com/en/investors/reports-and-presentations',
      'https://www.aramco.com/-/media/publications/corporate-reports/reports-and-presentations/2026/h1/saudi-aramco-h1-2026-interim-report-english.pdf',
    ],
    coverageNote: 'جمع محدود من بوابة التقارير؛ التقرير المرحلي للنصف الأول 2026 نقطة بداية، ولا يفترض اكتمال جميع الإيضاحات أو الأخبار.',
  },
  {
    id: 'sabic', name: 'سابك', ticker: '2010', sector: 'المواد الأساسية',
    hosts: ['sabic.com', 'www.sabic.com'],
    hub: 'https://www.sabic.com/en/investors',
    sourceUrls: [
      'https://www.sabic.com/en/investors',
      'https://www.sabic.com/en/news/51794-sabic-reports-increases-ebitda-q-o-q',
      'https://www.sabic.com/en/Images/EARNINGS-RELEASE-Q1-2026_tcm1010-51239.pdf',
    ],
    sourceHints: { 'https://www.sabic.com/en/news/51794-sabic-reports-increases-ebitda-q-o-q': 'Q3 2026 financial results' },
    coverageNote: 'تتضمن نقطة البداية بيان نتائج الربع الثالث 2026 وإصدار الربع الأول؛ مؤشرات الإدارة المعدلة لا تعادل تلقائيًا البنود المحاسبية المعلنة.',
  },
  {
    id: 'stc', name: 'الاتصالات السعودية (stc)', ticker: '7010', sector: 'الاتصالات',
    hosts: ['stc.com', 'www.stc.com'],
    hub: 'https://www.stc.com/en/investors/financial-reports/financial-statement.html',
    sourceUrls: [
      'https://www.stc.com/en/investors/financial-reports/financial-statement.html',
      'https://www.stc.com/content/dam/groupsites/en/pdf/financial-statementsQ2-2026En.pdf',
    ],
    coverageNote: 'القوائم المرحلية للربع الثاني 2026 نقطة بداية؛ يجب التمييز بين أرقام الثلاثة أشهر والأرقام التراكمية.',
  },
  {
    id: 'almarai', name: 'المراعي', ticker: '2280', sector: 'إنتاج الأغذية',
    hosts: ['almarai.com', 'www.almarai.com', 'almmedia.almarai.com'],
    hub: 'https://www.almarai.com/en/corporate/investors/press-releases',
    sourceUrls: [
      'https://www.almarai.com/en/corporate/investors/press-releases',
      'https://almmedia.almarai.com/FinancialReports/English-FS--Q31012202654628AM.pdf',
      'https://almmedia.almarai.com/FinancialReports/4417_4017_5917_ENGLISH_FS_-(1)77202672647AM.pdf',
    ],
    coverageNote: 'القوائم المرحلية للربعين الثاني والثالث 2026 نقطة بداية؛ القراءة النصية لا تمثل تحققًا من جميع خلايا الجداول.',
  },
].map(company => Object.freeze({ ...company, hosts: Object.freeze(company.hosts), sourceUrls: Object.freeze(company.sourceUrls) }));

export function getPilotCompany(id) {
  return PILOT_COMPANIES.find(company => company.id === id) ?? null;
}

export function isAllowedCompanySourceUrl(companyId, input) {
  const company = getPilotCompany(companyId);
  if (!company) return false;
  try {
    const url = new URL(input);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && company.hosts.includes(url.hostname);
  } catch { return false; }
}
