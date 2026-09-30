# Jadarat Terminology Glossary — Arabic / English (v1)

| | |
|---|---|
| **Backlog** | T-M1-A06 (AR/EN glossary & content style guide) |
| **Requirements** | NFR-L10N-13 (in-product glossary, no machine-only translation), Development Plan §9 (glossary enforced), ADM-12 (terminology overrides, R2) |
| **Status** | Draft v1 — 30 Sep 2026. Terms marked 🔎 are to be validated in usability round 1 |
| **Companion** | `content-style-guide.md` |

**Scope.** Modern Standard Arabic (MSA) suitable for enterprise users in Saudi Arabia, the other Gulf states and Egypt. Where Gulf and Egyptian usage differ, the Gulf/Saudi institutional term is chosen (largest early market) and the Egyptian variant is noted; tenants can override display terms from R2 (ADM-12) without changing the glossary IDs.

**How to use.** Use the *chosen* term everywhere: UI, notifications, PDFs, help, API error messages and marketing. Do not use rejected alternatives even as synonyms, because two words for one concept make users think there are two concepts. Role names follow BRD §4.2 exactly.

**Gender-neutral strategy (summary; details in the style guide §4).** Role nouns keep the conventional generic masculine (متدرب، مدرب، المدير المباشر) as in BRD §4.2, because they are labels of roles, not addresses to a person. When the UI *speaks to* the user we avoid gender marking: verbal nouns on buttons (حفظ، إرسال)، «يمكنك + verbal noun» in guidance, unvocalized pronoun suffixes (طلبك), and passive or first-person-plural system voice (أرسلنا، تم الحفظ). Slash forms such as «المتدرب/ة» are not used in the UI.

Legend — **Form**: n = noun, v = verb/action (button form given as a verbal noun), adj = adjective/status.

---

## 1. Product, suite and organization

| # | English | Arabic (chosen) | Rejected alternatives — why | Notes |
|---|---|---|---|---|
| 1 | Training Management System (TMS) | نظام إدارة التدريب | «نظام إدارة التدريبات» — plural is unnatural for a discipline; «منصة التدريب» — vague | Keep "TMS" only in technical/API text |
| 2 | Jadarat HR Suite | منظومة جدارات للموارد البشرية | «حزمة» — sounds like a software bundle/package; «جناح» — literal calque of *suite* | Short form: «منظومة جدارات» |
| 3 | Module (suite module) | وحدة | «تطبيق» — suggests separate app; «موديول» — loanword | "Module switcher" → «الوحدات» (button label) |
| 4 | Training (module name) | التدريب | «إدارة التدريب» — long in header | Header: «جدارات · التدريب» |
| 5 | Tenant (customer organization) | المنشأة | «المستأجر» — literal, meaningless to users; «العميل» — ambiguous with provider clients | Matches BRD role «مدير المنشأة»; "tenant" never appears in UI |
| 6 | Branch | فرع | «موقع» — collides with location/website | «فرع الرياض» |
| 7 | Department | القسم | «الإدارة» — also means "management"; used in many Gulf orgs for larger units — allowed as tenant override | Matches BRD «رئيس القسم» |
| 8 | Cost center | مركز التكلفة | «مركز التكاليف» — acceptable but less common in Gulf finance | Plural: مراكز التكلفة |
| 9 | Legal entity | الكيان القانوني | «الشركة» — not every entity is a company | R3 |
| 10 | User | مستخدم | — | |
| 11 | Employee | موظف | «عامل» — blue-collar connotation | |
| 12 | Role | دور | «وظيفة» — means job title | «الأدوار والصلاحيات» |
| 13 | Permission | صلاحية | «إذن» — means leave/permit in HR | |
| 14 | Job title | المسمى الوظيفي | «الوظيفة» — ambiguous with position | |
| 15 | Settings | الإعدادات | «الضبط» — less common | |
| 16 | Dashboard | لوحة المعلومات | «لوحة التحكم» — implies control, used for admin consoles; «داشبورد» — loanword | "Home" page label is «الرئيسية» |
| 17 | Subscription / license | الاشتراك | «الترخيص» — legal licence connotation | "Not licensed" → «غير مشمول في اشتراك منشأتكم» |

## 2. Roles and people (BRD §4.2)

| # | English | Arabic (chosen) | Rejected alternatives — why | Notes |
|---|---|---|---|---|
| 18 | Tenant Admin | مدير المنشأة | «مسؤول النظام» — IT connotation | BRD label |
| 19 | Training Manager | مدير التدريب | — | BRD label |
| 20 | Training Coordinator | منسق التدريب | «منظم التدريب» — sounds like event organizer | BRD label |
| 21 | Line manager | المدير المباشر | «المشرف» — lower supervisory level; «الرئيس المباشر» — acceptable in Egypt, kept as override | BRD label |
| 22 | Department head | رئيس القسم | «مدير الإدارة» — see #7 | BRD label |
| 23 | Learner / trainee | متدرب | «متعلم» — used for e-learning (LMS) and schools; «طالب» — academic | BRD label. Plural «المتدربون» (nominative) / «المتدربين» |
| 24 | Instructor / trainer | مدرب | «محاضر» — academic lecturer; «مدرِّس» — school teacher; «مُيسِّر» — facilitator, narrower | One term for both *instructor* and *trainer*. Internal/external: «مدرب داخلي / مدرب خارجي» |
| 25 | Training provider | جهة التدريب | «مزود التدريب» — calque; «مورّد» — procurement term (kept for #72) | BRD «مسؤول جهة التدريب» |
| 26 | Mentor | مرشد | «موجّه» — acceptable, less common in Gulf OJT programs | BRD «مرشد / مقيّم» |
| 27 | Assessor | مُقيِّم | «مُمتحِن» — exam-only | |
| 28 | Approver | المُعتمِد | «الموافِق» — awkward as a noun; «صاحب الصلاحية» — long | Tashkeel on مِ when ambiguous with «المُعتمَد» (approved) |
| 29 | Requester | مقدِّم الطلب | «الطالب» — means student | |
| 30 | Team (my team) | فريقي | «موظفيّ» — possessive of people sounds odd | Manager nav item |
| 31 | Auditor | مدقق | «مراجع» — Egyptian usage for auditor, ambiguous with "reviewer" | BRD label |

## 3. Catalog and courses

| # | English | Arabic (chosen) | Rejected alternatives — why | Notes |
|---|---|---|---|---|
| 32 | Course | دورة تدريبية (short: دورة) | «كورس» — colloquial loanword; «مقرر» — university course; «برنامج» — reserved for #33 | «الدورات» in nav |
| 33 | Program | برنامج تدريبي | «مسار» — reserved for learning path (R2); «منهج» — curriculum | Blended programs combine TMS sessions + LMS modules |
| 34 | Course template | قالب دورة | «نموذج» — reserved for forms (#90) | «إنشاء من قالب» |
| 35 | Catalog | دليل الدورات | «كتالوج» — loanword; «فهرس» — index | |
| 36 | Course code | رمز الدورة | «كود» — colloquial; «الرقم» — codes are alphanumeric | Always LTR: ‎LEAD-101‎ |
| 37 | Category | التصنيف | «الفئة» — used for audience/employee category | |
| 38 | Learning objective | هدف تدريبي | «هدف تعليمي» — academic | |
| 39 | Prerequisite | متطلب سابق | «شرط مسبق» — acceptable, less standard | |
| 40 | Target audience | الفئة المستهدفة | «الجمهور» — media connotation | |
| 41 | Delivery type | نمط التقديم | «طريقة التدريب» — ambiguous with method | Values #42–46 |
| 42 | Classroom / ILT | حضوري | «وجاهي» — used in Levant, less in Gulf/Egypt; «في القاعة» — excludes off-site | |
| 43 | Virtual / VILT | افتراضي | «عن بُعد» — acceptable, used in Egypt; «أونلاين» — colloquial | «جلسة افتراضية» |
| 44 | Blended | مدمج | «مختلط» — implies mixed-gender | |
| 45 | Hybrid (in-room + remote at once) | هجين | «مدمج» — reserved for blended (#44) | Explain in tooltip: «حضوري وافتراضي في الوقت نفسه» |
| 46 | On-the-job training (OJT) | التدريب على رأس العمل | «التدريب أثناء العمل» — Egyptian usage, kept as override; «التدريب الميداني» — field/internship training | Short label: «على رأس العمل» |
| 47 | Training materials | المواد التدريبية | «المحتوى» — reserved for LMS content | |
| 48 | Training hours | ساعات التدريب | «الساعات التدريبية» — also fine; keep one | Unit «ساعة» with Arabic plural rules |
| 49 | Competency | جدارة (plural: جدارات) | «كفاءة» — means efficiency/proficiency; common in Egypt but ambiguous; «مهارة» — narrower (#50) | Aligns with the product name *Jadarat* |
| 50 | Skill | مهارة | — | |
| 51 | Proficiency level | مستوى الإتقان | «مستوى الكفاءة» — see #49 | |

## 4. Scheduling, venues and resources

| # | English | Arabic (chosen) | Rejected alternatives — why | Notes |
|---|---|---|---|---|
| 52 | Session (a scheduled run of a course, one or more days) 🔎 | جلسة تدريبية (short: جلسة) | «دفعة» — denotes the cohort of people, not the scheduled event; «موعد» — too generic; «انعقاد» — formal, rarely used as a noun in lists | Validate in round 1: some users call a scheduled run «دورة». Session code: «رمز الجلسة» |
| 53 | Session day | يوم الجلسة (plural: أيام الجلسة) | «محاضرة» — lecture; «حصة» — school period | «اليوم 2 من 3» |
| 54 | Schedule (verb) | جدولة | «برمجة» — Maghrebi usage; «تحديد موعد» — long | Button: «جدولة جلسة» |
| 55 | Calendar | التقويم | «الرزنامة» — Levantine/dated | |
| 56 | Hijri / Gregorian | هجري / ميلادي | «جريجوري» — technical transliteration unfamiliar to users | Suffixes هـ / م |
| 57 | Venue | مقر التدريب (short: المقر) | «المكان» — too generic; «الموقع» — collides with GPS location and website | «مقر التدريب: برج الراية – الرياض» |
| 58 | Room | قاعة | «غرفة» — domestic; «فصل» — school classroom | «قاعة الياسمين (24 مقعدًا)» |
| 59 | Capacity | السعة | «الطاقة الاستيعابية» — correct but long; used in tooltips | «السعة: 24» |
| 60 | Seat | مقعد | «مكان» — generic | «مقعدان متبقيان» |
| 61 | Equipment | التجهيزات | «المعدات» — heavy machinery connotation | |
| 62 | Conflict | تعارض | «تضارب» — acceptable; keep one; «تداخل» — used for time overlap only (#63) | «تعارض في جدول المدرب» |
| 63 | Overlap (time) | تداخل | — | «تتداخل الجلسة مع وقت صلاة الظهر» |
| 64 | Double-booked | محجوز في الوقت نفسه | «حجز مزدوج» — calque, unclear | «المدرب محجوز في الوقت نفسه لجلسة أخرى» |
| 65 | Availability | التوفّر | «الإتاحة» — used for system availability | «توفّر المدرب» |
| 66 | Prayer time | وقت الصلاة | — | Name the prayer: «صلاة الظهر» |
| 67 | Break | استراحة | «فسحة» — school/colloquial | «إضافة استراحة للصلاة» |
| 68 | Public holiday | إجازة رسمية | «عطلة رسمية» — also correct; Gulf HR uses «إجازة» | |
| 69 | Weekend | عطلة نهاية الأسبوع | — | |
| 70 | Session statuses | مسودة · مجدولة · مؤكدة · جارية · مكتملة · ملغاة · مؤجلة | «قيد التنفيذ» for In progress — long in badges; «منتهية» for Completed — ambiguous with expired | Feminine agreement with «جلسة» |
| 71 | Joining instructions | تعليمات الحضور | «معلومات الانضمام» — calque | Includes map, parking, dress code, prayer room |
| 72 | Vendor / supplier | مورِّد | — | Finance/procurement contexts only |
| 73 | Task checklist | قائمة المهام | «قائمة التحقق» — used for audits | LOG-01 |

## 5. Enrollment, approvals and requests

| # | English | Arabic (chosen) | Rejected alternatives — why | Notes |
|---|---|---|---|---|
| 74 | Enrollment | تسجيل (في جلسة) | «التحاق» — academic admission; «قيد» — registry/records | Status «مسجَّل»; do not confuse with #92 (check-in), always qualified: «التسجيل في الجلسة» |
| 75 | Self-enrollment | التسجيل الذاتي | — | |
| 76 | Waitlist | قائمة الانتظار | «لائحة الانتظار» — Levantine | «ترتيبك في قائمة الانتظار: 2» |
| 77 | Nomination / nominate | ترشيح | «تعيين» — means appointment/assignment (#78) | Button: «ترشيح» |
| 78 | Assign (training) | إسناد | «تكليف» — acceptable; keep one; «تعيين» — HR appointment | «إسناد دورة إلزامية» |
| 79 | Training request | طلب تدريب | «طلب دورة» — excludes external/new training | |
| 80 | Approval | موافقة | «اعتماد» — reserved for formal sign-off of plans and budgets (#81) | Button: «موافقة» |
| 81 | Approve (plan, budget, certificate issuance) | اعتماد | «مصادقة» — legal/notarial | «اعتماد الخطة» |
| 82 | Reject | رفض | «عدم الموافقة» — long | Button «رفض», requires reason |
| 83 | Pending approval | بانتظار الموافقة | «معلّق» — also means suspended; «قيد الانتظار» — generic | |
| 84 | Approvals inbox | صندوق الموافقات | «الموافقات المعلّقة» — see #83 | Nav label: «الموافقات» |
| 85 | Delegate / delegation | تفويض | «توكيل» — legal power of attorney | R2 |
| 86 | Escalation | تصعيد | — | |
| 87 | Justification | المبرر | «السبب» — reserved for rejection/cancel reasons | «مبرر الطلب» |
| 88 | Cancellation / cancel | إلغاء | — | Button «إلغاء» only for cancelling a record; dialog dismiss = «رجوع» (see style guide §6) |
| 89 | Transfer (to another session) | نقل | «تحويل» — financial transfer | |

## 6. Delivery, attendance and assessment

| # | English | Arabic (chosen) | Rejected alternatives — why | Notes |
|---|---|---|---|---|
| 90 | Form | نموذج | «استمارة» — acceptable in Egypt, bureaucratic | |
| 91 | Attendance | الحضور | — | |
| 92 | Check-in | تسجيل الحضور | «تسجيل الدخول» — means sign in (#130); «إثبات الحضور» — long | Mobile button: «تسجيل الحضور» |
| 93 | Check-out | تسجيل الانصراف | «تسجيل الخروج» — means sign out | |
| 94 | QR code | رمز QR | «رمز الاستجابة السريعة» — long and unfamiliar; «باركود» — different code type | Keep "QR" in Latin, wrapped as LTR |
| 95 | Geofence / venue range | نطاق مقر التدريب | «السياج الجغرافي» — technical calque | «أنت خارج نطاق مقر التدريب» |
| 96 | Attendance statuses | حضور · غياب · تأخّر · غياب بعذر · حضور جزئي · لم يُسجَّل | «حاضر/غائب» — adjectives are gendered | Verbal nouns keep them gender-neutral |
| 97 | No-show | عدم حضور | «متغيّب» — gendered adjective | |
| 98 | Sign-in sheet | كشف الحضور | «ورقة التوقيع» — literal | Printable fallback (ATT-11) |
| 99 | Assessment (tests) | اختبار | «امتحان» — school exams | Pre-test «اختبار قبلي», post-test «اختبار بعدي» |
| 100 | Evaluation (survey) | استبيان تقييم | «استطلاع» — polls/opinion surveys | L1: «استبيان رضا المتدربين» |
| 101 | Score / grade | الدرجة | «العلامة» — Levantine; «النتيجة» — reserved for pass/fail outcome | «درجة النجاح: 70%» |
| 102 | Pass / fail | اجتياز / عدم اجتياز | «ناجح / راسب» — gendered adjectives, and «راسب» is harsh with a school connotation | «النتيجة: اجتياز» |
| 103 | Completion | إتمام | «إكمال» — also correct; keep one | Status «مكتمل» for records |
| 104 | Transcript | السجل التدريبي | «كشف الدرجات» — academic | |

## 7. Certification and compliance

| # | English | Arabic (chosen) | Rejected alternatives — why | Notes |
|---|---|---|---|---|
| 105 | Certificate | شهادة | «إفادة» — letter of attestation | |
| 106 | Certificate number | رقم الشهادة | «رمز الشهادة» — codes vs numbers; the value is a number sequence with prefix | LTR |
| 107 | Issue (a certificate) | إصدار | «منح» — used on the certificate wording itself («مُنحت هذه الشهادة»), not in UI actions | |
| 108 | Valid (certificate) | سارية | «صالحة» — acceptable; «فعّالة» — software connotation | Verification page: «شهادة سارية» |
| 109 | Expiring soon | تنتهي قريبًا | «على وشك الانتهاء» — long | Badge with days: «تنتهي خلال 30 يومًا» |
| 110 | Expired | منتهية الصلاحية | «منتهية» alone — ambiguous with completed | |
| 111 | Revoked | ملغاة | «مسحوبة» — literal; «موقوفة» — means suspended | Show reason category and date |
| 112 | Verification | التحقق | «التوثيق» — means notarization/documentation | «التحقق من الشهادة» |
| 113 | Recertification / renewal | تجديد الشهادة | «إعادة الاعتماد» — accreditation of institutions; «إعادة التأهيل» — rehabilitation | |
| 114 | Compliance | الامتثال | «الالتزام» — also means commitment (finance #125) | BRD «مسؤول الامتثال» |
| 115 | Mandatory training | تدريب إلزامي | «تدريب إجباري» — harsh | |
| 116 | Due / overdue | مستحق / متأخر | «مطلوب» — generic | «متأخر منذ 12 يومًا» |
| 117 | External certification | شهادة خارجية | «رخصة» — only for licences, which are listed separately as «رخصة مهنية» | CRT-06 |

## 8. Planning and finance

| # | English | Arabic (chosen) | Rejected alternatives — why | Notes |
|---|---|---|---|---|
| 118 | Training needs analysis (TNA) | تحليل الاحتياجات التدريبية | «تقييم الاحتياجات» — acceptable, less common | Acronym TNA not shown in Arabic UI |
| 119 | TNA campaign 🔎 | حملة حصر الاحتياجات التدريبية (short: حصر الاحتياجات) | «استبيان الاحتياجات» — it is not a survey; «دورة التخطيط» — collides with #32 | «حصر الاحتياجات» is the established term in Saudi government and enterprise HR |
| 120 | Training plan | الخطة التدريبية | «خطة التدريب» — also fine; keep one | «اعتماد الخطة التدريبية» |
| 121 | Priority (critical / high / medium / low) | الأولوية: حرجة · عالية · متوسطة · منخفضة | «عاجلة» for critical — urgency ≠ criticality | Feminine agreement with «أولوية» |
| 122 | Preferred quarter | الربع المفضّل | «الفصل» — academic term | «الربع الأول 2027» |
| 123 | Budget | الميزانية | «الموازنة» — government and Egyptian usage; available as tenant override | |
| 124 | Budget envelope | سقف الميزانية | «مظروف» — literal calque | |
| 125 | Planned / committed / actual (cost) | مخطط · مُلتزَم به · فعلي | «محجوز» for committed — ambiguous with room booking | BR-PLN-2 |
| 126 | Estimated cost | التكلفة التقديرية | «التكلفة المتوقعة» — acceptable; keep one | |
| 127 | Purchase order (PO) | أمر شراء | «طلب شراء» — that is a purchase *request* | |
| 128 | Invoice | فاتورة | — | |
| 129 | Chargeback | تحميل التكلفة على مركز التكلفة | «استرداد» — refund | Short in tables: «التحميل» |

## 9. Platform and interface

| # | English | Arabic (chosen) | Rejected alternatives — why | Notes |
|---|---|---|---|---|
| 130 | Sign in / sign out | تسجيل الدخول / تسجيل الخروج | «الدخول» alone — ambiguous | Contrast with check-in / check-out (#92–93) |
| 131 | Notification | إشعار | «تنبيه» — reserved for alerts/warnings | «الإشعارات» |
| 132 | Reminder | تذكير | — | |
| 133 | Search | بحث | — | Placeholder: «ابحث في جدارات…» (imperative accepted in placeholders; see style guide §4.3) |
| 134 | Filter | تصفية | «فلترة» — colloquial | |
| 135 | Export / import | تصدير / استيراد | — | |
| 136 | Upload / download | رفع / تنزيل | «تحميل» — ambiguous (means both upload and download in common use) | |
| 137 | Draft | مسودة | — | «حُفظت كمسودة» |
| 138 | Save / submit | حفظ / إرسال | «تقديم» for submit — acceptable for applications; keep «إرسال» | |
| 139 | Undo | تراجع | «إلغاء» — reserved (#88) | Toast action |
| 140 | Audit log | سجل التدقيق | «سجل المراجعة» — see #31 | |
| 141 | Multi-factor authentication | التحقق متعدد العوامل | «المصادقة الثنائية» — only covers 2 factors | UI short: «رمز التحقق» for OTP |
| 142 | Single sign-on (SSO) | الدخول الموحّد | «تسجيل الدخول الأحادي» — calque | |
| 143 | Learning Management System (LMS) | نظام إدارة التعلّم | «منصة التعليم الإلكتروني» — narrower | Jadarat LMS: «جدارات للتعلّم الإلكتروني» pending brand |
| 144 | Prototype — sample data | نموذج أولي — بيانات تجريبية | «بيانات وهمية» — "fake" sounds untrustworthy | Marker on all prototypes |

**Count:** 144 entries (more than the 80 required), several of which group closely related values (statuses, priorities).

## 10. Words we do not use in the UI

| Avoid | Use instead | Why |
|---|---|---|
| كورس، سيشن، داشبورد، فلترة، كود | دورة، جلسة، لوحة المعلومات، تصفية، رمز | Colloquial loanwords reduce formality and are inconsistent across dialects |
| المستأجر (tenant) | المنشأة | Internal architecture term |
| عذرًا، نأسف جدًا (in every error) | State the problem and the fix | See style guide §5 |
| المتدرب/ة، عزيزي/عزيزتي | Neutral constructions | See style guide §4 |
| تم + masdar everywhere («تم الحفظ بنجاح») | Short passive or result: «حُفظت التغييرات» | Wordy; "بنجاح" is implied |
