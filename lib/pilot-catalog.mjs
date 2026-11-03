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
  {
    id: 'baan', name: 'شركة مجموعة بان القابضة', ticker: '1820', sector: 'الخدمات الاستهلاكية',
    hosts: ['baanholding.com', 'www.baanholding.com', 'www.saudiexchange.sa', 'alhokair.argaam-ir.com'],
    hub: 'https://www.baanholding.com/AR/investors.html',
    designatedIrPortal: 'https://alhokair.argaam-ir.com/?lang=ar',
    identityUrl: 'https://www.baanholding.com/AR/who_we_are.html',
    sourceUrls: [
      'https://www.baanholding.com/AR/investors.html',
      'https://www.saudiexchange.sa/Resources/fsPdf/28593_604_2026-08-11_09-08-23_en.pdf',
    ],
    coverageNote: 'بان القابضة (1820)، عبدالمحسن الحكير للسياحة والتنمية سابقًا. القوائم المنشورة للستة أشهر المنتهية في 30 يونيو 2026 نقطة بداية؛ لم يُثبت جمع الربع الثالث. بوابة علاقات المستثمرين المعيّنة من الشركة تعمل لدى alhokair.argaam-ir.com، ولا يعني ذلك ربط منصة أرقام عمومًا أو وجود API مرخّصة لتداول.',
  },
  {
    id: 'alrajhi', name: 'مصرف الراجحي', ticker: '1120', sector: 'البنوك',
    hosts: ['www.alrajhibank.com.sa', 'alrajhibank.com.sa'],
    hub: 'https://www.alrajhibank.com.sa/en/About-alrajhi-bank/Investor-Relations',
    sourceUrls: [
      'https://www.alrajhibank.com.sa/-/media/Project/AlRajhi/ARBRevamp/Investor-Relation/Financial-Materials/2026/Q3/ARB-3Q2026-Earnings-Release.pdf',
      'https://www.alrajhibank.com.sa/en/About-alrajhi-bank/Investor-Relations',
    ],
    coverageNote: 'بيان النتائج العام للربع الثالث 2026 نقطة بداية. افصل أرقام الربع عن التسعة أشهر وسمِّ مؤشرات المصرف كما وردت في البيان.',
  },
  {
    id: 'kafd', name: 'مركز الملك عبدالله المالي — كافد', ticker: null, entityKind: 'project', sector: 'التطوير العقاري والوجهات متعددة الاستخدامات',
    hosts: ['www.kafd.sa', 'kafd.sa', 'www.pif.gov.sa', 'pif.gov.sa'],
    hub: 'https://www.kafd.sa/en/kafd-dmc',
    sourceUrls: [
      'https://www.kafd.sa/en/media-centre/KAFD_DMC_Secures_SAR_12_Billion_Facility_as_Further_Development_Marches_Ahead',
      'https://www.pif.gov.sa/en/our-investments/our-portfolio/king-abdullah-financial-district/',
      'https://www.kafd.sa/en/faq',
    ],
    coverageNote: 'كافد مشروع وجهة ومشغل عقاري؛ المصادر استراتيجية وتشغيلية معلنة، ولا تمثل قوائم مستقلة أو إثباتًا للإشغال أو الربحية أو سحب كامل تسهيلات التمويل.',
  },
  {
    id: 'humain', name: 'HUMAIN — هيوماين', ticker: null, entityKind: 'private_company', sector: 'الذكاء الاصطناعي والبنية التحتية الرقمية',
    hosts: ['www.humain.com', 'humain.com', 'node.humain.com', 'www.pif.gov.sa', 'pif.gov.sa', 'newsroom.amd.com', 'www.neom.com'],
    hub: 'https://www.humain.com/en/core',
    sourceUrls: [
      'https://www.pif.gov.sa/en/news-and-insights/press-releases/2026/pif-and-aramco-close-humain-transaction-to-accelerate-humain-global-growth/',
      'https://newsroom.amd.com/news/amd-cisco-humain-expand-saudi-arabia-ai-infrastructure/',
      'https://www.humain.com/en/core',
    ],
    coverageNote: 'HUMAIN شركة خاصة في هذا النطاق؛ يميز البحث التمويل والملكية والأهداف المخططة عن الإيرادات والقدرة المسلمة، ولا توجد قوائم مالية مستقلة معتمدة في هذه التجربة.',
  },
].map(company => Object.freeze({ entityKind: 'listed_company', ...company, hosts: Object.freeze(company.hosts), sourceUrls: Object.freeze(company.sourceUrls) }));

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

