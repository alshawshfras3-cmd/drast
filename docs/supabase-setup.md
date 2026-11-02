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

## التحقق بعد الربط

اختبر تعديل دراسة ثم إعادة فتح المتصفح، ورفع PDF وتنزيله، ورفض API من Origin مختلف، وتعارض حفظ مهمتين متزامنتين. راجع Supabase Advisors بعد SQL. الاختبارات المعزولة لا تثبت إنشاء المشروع أو صلاحية المفتاح أو CORS أو Storage الحي.

لا تُرحّل سجلات IndexedDB أو Blob القديمة تلقائيًا. استيراد النسخة الاحتياطية وظيفة مستقلة في الواجهة؛ راجع كل نتيجة حفظ قبل مسح نسخة محلية.

## المراجع المراجعة

- [Changelog](https://supabase.com/changelog.md) و[تغيير TLS](https://supabase.com/changelog/cbc-tls-ciphers-deprecated)؛ الخادم يستخدم Node الحديث وHTTPS دون تعطيل التحقق.
- [مفاتيح API](https://supabase.com/docs/guides/getting-started/api-keys): مفتاح `sb_secret` في `apikey` على الخادم، وليس JWT مستخدم.
- [Storage access control](https://supabase.com/docs/guides/storage/security/access-control).
- [Signed upload URL](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl) و[uploadToSignedUrl](https://supabase.com/docs/reference/javascript/storage-from-uploadtosignedurl).
