# إعداد الحفظ السحابي المستقل لدراسات

هذا المسار لمشروع Supabase جديد مستقل لدراسات. لا تُنفّذ SQL في مشروع بديهة أو تطبيق آخر. الكود لا ينشئ المشروع ولا يعدّل قاعدة بعيدة تلقائيًا.

1. في المشروع المستقل نفّذ [setup.sql](../supabase/setup.sql) في SQL Editor. يمكن إعادة التنفيذ؛ لا يحذف بيانات الدراسات أو المهام أو الملفات.
2. على خادم **Vercel / drast فقط** أضف `SUPABASE_URL` بقيمة `https://<project-ref>.supabase.co` و`SUPABASE_SECRET_KEY` بمفتاح `sb_secret_...`. لا تستخدم بادئة `NEXT_PUBLIC_` لمفتاح خدمة. يقبل المتغير أيضًا مفتاح JWT القديم بشرط أن يكون `service_role`، ويدعم الاسم القديم `SUPABASE_SERVICE_ROLE_KEY`. مفاتيح `anon` و`sb_publishable` لا تكفي لهذا المسار الخادمي.
3. أبقِ Vercel Authentication لجميع عمليات النشر و`DRAST_PRIVATE_WORKSPACE=enabled`. التطبيق مساحة واحدة للمصرح لهم بحماية Vercel؛ لا ينشئ حسابات Supabase Auth ولا تسجيل دخول إضافيًا.
4. أعد النشر بعد إضافة المتغيرات. وجود المتغيرات يثبت التهيئة فقط. مسار مساحة العمل يتحقق من الجدول والحاوية فعليًا، ويعرض معرّف المشروع دون المفتاح حتى عند فشل الفحص.

## البيانات والصلاحيات

- `public.drast_records`: سجلات JSON للدراسات المعدلة ونصوص المستندات وبياناتها الوصفية، بمفتاح `owner,pathname`.
- `public.research_jobs`: المهام والأدلة والمسودات، ومفتاح `version` من نوع UUID للمقارنة عند الحفظ ومنع الكتابة فوق تعديل متزامن. يحدّث التطبيق `updated_at` و`version` مع كل كتابة.
- `drast-documents`: حاوية خاصة وحد الملف 15 ميجابايت. التنزيل يمر عبر مسار خادم محمي يبحث بمعرّف مستند مسجل، ولا يُصدر رابط قراءة عامًا.
- RLS مفعّل وصلاحيات `anon` و`authenticated` مسحوبة من الجدولين. مفتاح الخدمة على الخادم يتجاوز RLS؛ لذلك تظل حراسة مساحة العمل وOrigin إلزامية قبل الكتابة.
- لا يمنح الإعداد قراءة عامة. سياسة Storage المقيدة تمنع أدوار المتصفح من الحاوية، وتبقى الحاويات الأخرى دون تغيير.
- يجب أن تبقى Data API مفعلة و`public` ضمن المخططات المعروضة، مع وصول `service_role` إلى الجدولين. لا تمنح أدوار المتصفح وصولًا لحل خطأ اتصال.

## رفع المستندات

`POST /api/uploads` يستقبل JSON `{pathname,contentType,size}` بعد التحقق من مساحة Vercel وOrigin. المسار ناتج `documentPath()` ويخص UUIDv4 جديدًا داخل `drast/private-workspace/files/` فقط. الملفات المسموحة PDF/TXT/CSV/JSON. الحجم المعلن 1–15 ميجابايت، ويفرض حد الحجم الحقيقي في الحاوية وعند تسجيل المستند.

الاستجابة `{uploadUrl,method:"PUT",pathname,headers,maxFileBytes,expiresIn}` تمنح رفعًا إلى مسار واحد دون استبدال. ينفّذ المتصفح `fetch(uploadUrl,{method,headers,body:file})` مباشرة لتجنب سقف طلب Vercel. الرابط صالح ساعتين وفق واجهة Supabase الحالية؛ لا تسجله في السجلات أو تقارير الدراسات. لا يحتوي مفتاح الخدمة ولا يمنح قراءة الملفات.

بعد الرفع، يرسل المتصفح بيانات المستند ونصه إلى `POST /api/documents`. الخادم يقرأ الحجم وMIME من Storage ويهمل الحجم وMIME المدعيين من المتصفح. فشل تسجيل البيانات قد يترك ملفًا دون سجل؛ احتفظ بالمعرّف لإعادة التسجيل قبل رفع نسخة جديدة. لا توجد مهمة تنظيف تلقائية في هذه النسخة.

## استيراد سجل الحقائق المالية

1. ارفع PDF من «تقاريرك المرفوعة» برمز الشركة والفترة الربعية. معرّف الملف هو قيمة `id` في رابط «فتح الملف».
2. جهّز JSON بالأرقام بعد مراجعة الخلايا بصريًا. المثال التالي اصطناعي ويحتاج إلى استبدال المصدر ومعرّف الملف والبيانات.
3. اختر «استيراد دراسة» وأكد مراجعة المستندات. تظهر الخلايا المراجعة في تبويب الأرقام وتقرير الطباعة، وتحفظ كل عملية اعتماد لقطة مستقلة في `drast_records`.

```json
{
  "id": "reviewed-quarter",
  "company": "المراعي",
  "ticker": "2280",
  "year": 2026,
  "asOf": "2026-11-03",
  "financialFactsVersion": 1,
  "statementScope": "consolidated",
  "sources": [{
    "id": "quarter-report",
    "title": "إفصاح تجريبي",
    "url": "https://www.almarai.com/",
    "publishedAt": "2026-10-15"
  }],
  "financialFacts": [{
    "ticker": "2280",
    "metric": "revenue",
    "period": "2026-Q3",
    "scope": "consolidated",
    "basis": "standalone_quarter",
    "rawValue": "1200000",
    "currency": "SAR",
    "scale": 3,
    "sourceId": "quarter-report",
    "documentId": "250b425e-75aa-4e4d-85b7-61a31924dada",
    "cell": {
      "page": 2,
      "table": "قائمة الدخل",
      "row": "الإيرادات",
      "column": "الربع المستقل"
    }
  }]
}
```

المقاييس المدعومة `revenue` و`grossProfit` و`operatingProfit` و`netProfit` (العائد للمساهمين) و`operatingCashFlow` و`cash` و`totalDebt`. اختر `closing_balance` لآخر مقياسين، و`standalone_quarter` لبقية المقاييس. يدعم النطاق `consolidated` أو `standalone`، والمقياس 0 للريال أو 3 للألف أو 6 للمليون. للمقارنة السنوية أدرج حقيقة الربع المماثل من السنة السابقة. إذا وردت في العمود المقارن في ملف الربع الحالي، سجّل فترة الملف في `documentPeriod` وفترة الرقم في `period` وحدد العمود المقارن في `cell.column`. استخدم رقم صفحة PDF الفعلي عند تحديد موضع الخلية، وقد يختلف عن رقم الصفحة المطبوع داخل التقرير.

يتحقق الخادم من شكل الحقول وتطابق بيانات الملف ويحسب بصمة SHA-256. المطابقة البصرية لمحتوى الخلية مسؤولية المراجع. هوية الاعتماد هي مساحة العمل المشتركة خلف حماية Vercel. يعتمد هذا المسار على إعداد التخزين الحالي ولا يتطلب SQL إضافيًا.

## التحقق بعد الربط

اختبر تعديل دراسة ثم إعادة فتح المتصفح، ورفع PDF وتنزيله، ورفض API من Origin مختلف، وتعارض حفظ مهمتين متزامنتين. راجع Supabase Advisors بعد SQL. الاختبارات المعزولة لا تثبت إنشاء المشروع أو صلاحية المفتاح أو CORS أو Storage الحي.

لا تُرحّل سجلات IndexedDB أو Blob القديمة تلقائيًا. استيراد النسخة الاحتياطية وظيفة مستقلة في الواجهة؛ راجع كل نتيجة حفظ قبل مسح نسخة محلية.

## المراجع المراجعة

- [Changelog](https://supabase.com/changelog.md) و[تغيير TLS](https://supabase.com/changelog/cbc-tls-ciphers-deprecated)؛ الخادم يستخدم Node الحديث وHTTPS دون تعطيل التحقق.
- [مفاتيح API](https://supabase.com/docs/guides/getting-started/api-keys): مفتاح `sb_secret` في `apikey` على الخادم، وليس JWT مستخدم.
- [Storage access control](https://supabase.com/docs/guides/storage/security/access-control).
- [Signed upload URL](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl) و[uploadToSignedUrl](https://supabase.com/docs/reference/javascript/storage-from-uploadtosignedurl).

