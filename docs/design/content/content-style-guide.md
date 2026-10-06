# Jadarat Content Style Guide — Arabic & English (v1)

| | |
|---|---|
| **Backlog** | T-M1-A06 |
| **Requirements** | NFR-L10N-01, -03, -04, -09, -11, -13; NFR-UX-04; FR-NTF-02/03/07; Development Plan §1 Q4 and §9 |
| **Status** | Draft v1 — 30 Sep 2026; notification examples to be reviewed with design partners |
| **Companion** | `glossary-ar-en.md` (terms), `../design-principles.md` (dates, numerals, bidi) |

Arabic is written first. English is written by the same writer as a peer version with the same meaning and tone, not a literal translation of the Arabic (and never the other way round).

---

## 1. Voice

Jadarat sounds like **a capable colleague in the training department**: professional, respectful, brief and precise.

| We are | We are not |
|---|---|
| Professional — correct MSA, consistent terms | Stiff or bureaucratic («نحيطكم علمًا بأنه قد تم…») |
| Respectful — we assume users are busy and competent | Over-familiar («يا بطل»، «عزيزي») or apologetic in every line |
| Concise — the point first, detail after | Chatty, promotional, exclamation marks |
| Specific — names, dates, numbers, next step | Vague («حدث خطأ ما») |
| Calm — even for errors and deadlines | Alarming («تحذير!!»), blaming the user («أدخلت بيانات خاطئة») |

### Tone by context
| Context | Tone | Example (AR) | Example (EN) |
|---|---|---|---|
| Routine confirmation | Neutral, short | «حُفظت الجلسة كمسودة.» | "Session saved as draft." |
| Success of a meaningful task | Warm, still brief | «تم تسجيل حضورك. نتمنى لك يومًا تدريبيًا مفيدًا.» | "You're checked in. Have a good training day." |
| Warning | Direct, with the choice | «تتداخل الجلسة مع صلاة الظهر (11:36 ص). يمكنك إضافة استراحة أو تعديل الوقت.» | "The session overlaps Dhuhr prayer (11:36 AM). Add a break or change the time." |
| Blocking error | Clear cause + fix | «المدرب خالد العتيبي محجوز في الوقت نفسه يوم الاثنين 2 نوفمبر. يمكنك اختيار مدرب متاح أو تغيير الوقت.» | "Khalid Al-Otaibi is already booked on Mon 2 Nov at this time. Choose an available instructor or change the time." |
| Compliance / deadlines | Factual, no guilt | «تنتهي شهادة الإسعافات الأولية خلال 30 يومًا (1 نوفمبر 2026).» | "Your First Aid certificate expires in 30 days (1 Nov 2026)." |
| Public pages (verification) | Formal, neutral, third person | «هذه الشهادة سارية وصادرة عن شركة الراية للخدمات اللوجستية.» | "This certificate is valid and was issued by Al-Raya Logistics." |

## 2. Formality and language level

- **Modern Standard Arabic**, simplified: common vocabulary, short sentences (≤ 20 words), active verbs. No dialect in the product UI (Gulf or Egyptian). Dialect may appear only in marketing that is written separately.
- Address the user in the **second person singular**, implied through context; never «حضرتك» (Egyptian colloquial politeness) or «سيادتكم».
- The system speaks in the **first person plural** when it acts on the user's behalf: «أرسلنا رمز التحقق إلى جوالك.» / "We sent a code to your phone."
- For third parties, use their name and role: «بانتظار موافقة فاطمة الزهراني (المدير المباشر).»
- Honorifics: none in UI lists. Formal letters and certificates follow the tenant template (e.g., «الأستاذ/»، «المهندس») only if the tenant configures them.
- Religious phrases: not used in system copy (e.g., no «إن شاء الله» on schedules). Seasonal greetings (Ramadan, Eid, National Day) are tenant-configurable content, not product copy.
- English: plain, sentence case, contractions allowed in learner-facing copy ("You're checked in"), avoided in formal/public pages.

## 3. Structure and mechanics

| Topic | Arabic rule | English rule |
|---|---|---|
| Capitalization | — | Sentence case for everything (titles, buttons, menu items) |
| Punctuation | Arabic comma «،», semicolon «؛», question mark «؟»; full stop in sentences, none in buttons/labels/titles | Standard; no full stop in buttons/labels/titles |
| Quotes | «…» for quoted names/terms | "…" |
| Numbers in text | Digits for all counts (3 أيام), words only for one/two when natural (يوم واحد، يومان) | Digits for all counts |
| Plurals | ICU plural rules: 0 «لا توجد جلسات»، 1 «جلسة واحدة»، 2 «جلستان»، 3–10 «3 جلسات»، 11–99 «11 جلسة»، 100+ «100 جلسة» | one/other |
| Tanween | Add tanween on accusative indefinite endings that users see often: «يومًا»، «مقعدًا» | — |
| Abbreviations | Avoid; expand once if needed: «تحليل الاحتياجات التدريبية» not «TNA» | Expand acronyms except well-known (QR, PDF) |
| Diacritics | Only to remove ambiguity («المُعتمِد» vs «المُعتمَد») | — |
| Latin terms inside Arabic | Keep product/brand/standard names in Latin (Zoom, QR, PDF), wrapped as LTR | — |
| Length | UI strings may differ ±30% between languages; never shorten Arabic by removing meaning | — |

## 4. Gender-inclusive Arabic

Arabic grammar marks gender on verbs, adjectives and pronouns. The UI is used by women and men; we write so that neither is excluded and the text still reads naturally.

### 4.1 Strategies (in order of preference)
| # | Strategy | Instead of | Write |
|---|---|---|---|
| 1 | **Verbal noun (masdar) for actions and statuses** | «احفظ»، «أرسِل»، «أنت حاضر» | «حفظ»، «إرسال»، «الحالة: حضور» |
| 2 | **«يمكنك» + verbal noun for guidance** | «اختر مدربًا آخر» (masc. imperative) | «يمكنك اختيار مدرب آخر» |
| 3 | **Passive or result phrasing for outcomes** | «أنت مسجَّل في الجلسة» | «تم تسجيلك في الجلسة» / «تسجيلك مؤكد» |
| 4 | **System voice (we)** | «لقد أرسلتَ الطلب» | «أرسلنا طلبك إلى المدير المباشر» |
| 5 | **Unvocalized pronoun suffixes** (read naturally by both genders) | «طلبكِ / طلبكَ» | «طلبك»، «جلستك» |
| 6 | **Name the person instead of a gendered noun** in notifications | «عزيزي المتدرب» | «مرحبًا يوسف،» |
| 7 | **Plural for groups** | «على كل متدرب» | «على جميع المشاركين» |

### 4.2 When gendered forms are unavoidable
- Role labels (متدرب، مدرب، المدير المباشر) use the conventional generic form, consistent with BRD §4.2.
- For personal, high-emotion messages (certificate issued, welcome), we may use the recipient's **preferred form of address** if the tenant enables a profile field «صيغة المخاطبة» (masculine / feminine / neutral). This is separate from the HR gender field (FR-IAM-02), which is restricted. *Open item for the PO.*
- Never use slash forms («المتدرب/ة») or parentheses («سجّل(ي)») in the UI. They are allowed only in legal documents if legal requires.

### 4.3 Imperatives
Short masculine imperatives are the accepted generic in a few places where a verbal noun would be awkward: search placeholders («ابحث في جدارات…»), and camera instructions («وجّه الكاميرا نحو الرمز»). Keep these to hints and placeholders; never in error messages directed at the person.

## 5. Error messages

**Pattern:** *What happened* → *why (if it helps)* → *how to fix*. Specific nouns, no blame, no apology unless the system is at fault.

| Type | Arabic | English |
|---|---|---|
| Validation (field) | «يتكون رقم الجوال السعودي من 9 أرقام ويبدأ بالرقم 5.» | "Enter a 9-digit Saudi mobile number starting with 5." |
| Required | «اسم الدورة بالعربية مطلوب.» | "Course name in Arabic is required." |
| Conflict (blocking) | «لا يمكن حفظ الجلسة: القاعة «الياسمين» محجوزة يوم الأحد 1 نوفمبر من 9:00 ص إلى 12:00 م. يمكنك اختيار قاعة أخرى أو تغيير الوقت.» | "Can't save the session: Jasmine room is booked on Sun 1 Nov, 9:00 AM–12:00 PM. Choose another room or change the time." |
| Permission | «ليست لديك صلاحية لاعتماد الخطة. يمكنك إرسالها إلى مدير التدريب.» | "You don't have permission to approve the plan. Send it to the Training Manager." |
| Expired QR | «انتهت صلاحية هذا الرمز. يمكنك مسح الرمز المعروض الآن على شاشة المدرب.» | "This code has expired. Scan the code on the instructor's screen now." |
| Out of range | «أنت خارج نطاق مقر التدريب (على بُعد 1.4 كم تقريبًا). أرسلنا طلبك إلى المدرب لمراجعته.» | "You're outside the venue range (about 1.4 km away). We've sent your check-in to the instructor to review." |
| System fault | «تعذّر حفظ التغييرات بسبب خلل لدينا. لم نفقد بياناتك؛ يمكنك إعادة المحاولة. المرجع: 7F3A-21» | "We couldn't save your changes because of a problem on our side. Your data is safe; try again. Reference: 7F3A-21" |
| Offline | «أنت غير متصل. سنرسل تسجيل الحضور تلقائيًا عند عودة الاتصال.» | "You're offline. We'll send your check-in when you're back online." |

Don'ts: «حدث خطأ ما»، «خطأ 500»، «بيانات غير صالحة»، «عملية غير مسموح بها», technical stack traces, blaming wording («أدخلت»), exclamation marks.

## 6. Buttons and actions

- Arabic buttons use **verbal nouns** (gender-neutral, standard in Arabic software). English buttons use **imperative verbs**.
- A button names the result: «جدولة جلسة» not «متابعة» when the next screen is the scheduler.
- The primary button repeats the dialog title's verb: title «حذف القالب؟» → buttons «حذف القالب» / «رجوع».
- **«إلغاء» is reserved for cancelling a record** (a session, an enrollment). To dismiss a dialog or leave a form without saving, use **«رجوع»** / "Go back" (or «إغلاق» / "Close" for read-only dialogs). This avoids "Cancel the cancellation" confusion.

| Action | Arabic | English |
|---|---|---|
| Create | إنشاء دورة | Create course |
| Create from template | إنشاء من قالب | Create from template |
| Schedule | جدولة جلسة | Schedule session |
| Save / save as draft | حفظ / حفظ كمسودة | Save / Save as draft |
| Publish | نشر | Publish |
| Submit | إرسال | Submit |
| Approve / reject | موافقة / رفض | Approve / Reject |
| Approve (formal plan/budget) | اعتماد | Approve |
| Nominate | ترشيح | Nominate |
| Enroll | تسجيل | Enroll |
| Check in | تسجيل الحضور | Check in |
| Scan again | مسح الرمز مجددًا | Scan again |
| Add need | إضافة احتياج | Add need |
| Resolve conflict | حل التعارض | Resolve conflict |
| Undo | تراجع | Undo |
| Dismiss dialog | رجوع | Go back |
| Delete (destructive) | حذف | Delete |
| Cancel a session (destructive) | إلغاء الجلسة | Cancel session |
| View details | عرض التفاصيل | View details |
| Download certificate | تنزيل الشهادة | Download certificate |
| Verify | تحقق | Verify |

## 7. Notifications and WhatsApp

### 7.1 Rules
- **Recipient locale** decides the language (NFR-L10N-11). One language per message; no bilingual stacking except in e-mail footers for legal text. **Exception:** e-mails to people whose language is not known yet — the invitation (approved screen 7) — carry the chosen language first and the other below.
- Lead with the **action or the fact**; the name of the organization appears in the sender, not repeated in the first line.
- Include the **who / what / when / where** needed to act without opening the app.
- Dates: weekday + primary calendar; times with ص / م; session codes in LTR.
- WhatsApp: use approved **Utility** templates; body ≤ 1,024 characters (we target ≤ 300); quick-reply buttons ≤ 20 characters each; max 3 quick replies; variables numbered `{{1}}`; no URLs shortened by third-party shorteners (use the tenant domain).
- Quiet hours respect prayer times and weekends (FR-NTF-07); urgent operational messages (session cancelled today) may bypass quiet hours by tenant policy.
- Every interactive action (approve/reject) is authenticated and audited (FR-ENR-06); the reply confirms the result.
- Opt-out text on marketing-like messages is not needed because we send utility messages only; opt-in is captured by the tenant (AUD-05).

### 7.2 Templates (examples)

**A. Enrollment approval request (to line manager) — WhatsApp interactive**

AR:
```
طلب تسجيل بانتظار موافقتك
{{1}} يطلب التسجيل في «{{2}}».
المواعيد: {{3}}
المقر: {{4}}
التكلفة: {{5}} — ضمن ميزانية القسم المتبقية ({{6}}).
[موافقة] [رفض] [عرض التفاصيل]
```
Example: «يوسف الشمري يطلب التسجيل في «أساسيات السلامة المهنية». المواعيد: الأحد 1 – الثلاثاء 3 نوفمبر 2026، 9:00 ص – 2:00 م. المقر: برج الراية – الرياض. التكلفة: 1,800 ر.س — ضمن ميزانية القسم المتبقية (42,300 ر.س).»

> Note: «يطلب» is masculine; the template engine selects «تطلب» when the requester's form of address is feminine, else uses the neutral construction «طلب تسجيل من {{1}} في «{{2}}».» — the neutral construction is the default.

EN:
```
Enrollment request awaiting your approval
{{1}} requested a seat in "{{2}}".
Dates: {{3}}
Venue: {{4}}
Cost: {{5}} — within your department's remaining budget ({{6}}).
[Approve] [Reject] [View details]
```

Reply after "موافقة": «تمت الموافقة على طلب يوسف الشمري. أبلغناه بذلك وأرسلنا له دعوة التقويم.» / "Approved. We've told Yousef and sent him the calendar invitation."

Reply after "رفض": «يرجى كتابة سبب الرفض في رسالة واحدة، أو اختيار «عرض التفاصيل» لاختياره من القائمة.» / "Reply with the reason for rejecting, or tap View details to pick one."

**B. Session reminder (T-1 day) — learner**

AR: «تذكير: تبدأ جلسة «أساسيات السلامة المهنية» غدًا الأحد 1 نوفمبر الساعة 9:00 ص في برج الراية – الرياض، قاعة الياسمين. يتم تسجيل الحضور برمز QR المعروض في القاعة.» Buttons: [تعليمات الحضور] [الاعتذار عن الحضور]

EN: "Reminder: Occupational Safety Basics starts tomorrow, Sun 1 Nov at 9:00 AM, Al-Raya Tower – Riyadh, Jasmine room. Check in with the QR code shown in the room." Buttons: [Joining instructions] [Can't attend]

**C. Certificate issued**

AR: «تهانينا يوسف، صدرت شهادتك في «أساسيات السلامة المهنية». رقم الشهادة: ‎RAYA-1448-000123‎. [عرض الشهادة]»
EN: "Congratulations, Yousef. Your certificate for Occupational Safety Basics is ready. Certificate no. RAYA-1448-000123. [View certificate]"

**D. TNA campaign opened (to manager)**

AR: «بدأ حصر الاحتياجات التدريبية لعام 2027. نموذج فريقك (6 موظفين) جاهز ومعبأ مسبقًا بالتدريب الإلزامي والشهادات التي تنتهي خلال العام. آخر موعد: الخميس 15 أكتوبر 2026. [فتح النموذج]»
EN: "Training needs analysis for 2027 is open. Your team form (6 employees) is pre-filled with mandatory training and certificates expiring next year. Deadline: Thu 15 Oct 2026. [Open form]"

**E. Session changed**

AR: «تغيّر موعد جلسة «مهارات القيادة للمشرفين الجدد»: أصبحت يوم الاثنين 2 نوفمبر من 10:00 ص إلى 3:00 م (بدلًا من 9:00 ص). المقر لم يتغير. [عرض التفاصيل]»
EN: "Time change for New Supervisors' Leadership Skills: now Mon 2 Nov, 10:00 AM–3:00 PM (was 9:00 AM). Venue unchanged. [View details]"

### 7.3 In-app notification titles
≤ 60 characters, fact first: «تمت الموافقة على تسجيلك في «مهارات القيادة»» / "Your enrollment in Leadership Skills was approved".

## 8. Dates, numbers and currency (summary)

Full rules: `../design-principles.md` §2.3 and §3.

| Item | Arabic | English |
|---|---|---|
| Date (dual) | الأحد 1 نوفمبر 2026 · 21 جمادى الأولى 1448 هـ | Sun 1 Nov 2026 · 21 Jumada I 1448 AH |
| Date (list) | الأحد 1 نوفمبر 2026 | Sun 1 Nov 2026 |
| Range | 1 – 3 نوفمبر 2026 | 1–3 Nov 2026 |
| Time | 9:00 ص – 2:00 م | 9:00 AM – 2:00 PM |
| Duration | 3 أيام · 15 ساعة | 3 days · 15 hours |
| Relative | قبل 5 دقائق · بعد يومين | 5 minutes ago · in 2 days |
| Percent | 80% (no space; Arabic percent sign ٪ only with Eastern digits) | 80% |
| Currency SAR | 12,500.00 ر.س | SAR 12,500.00 |
| Currency EGP | 45,000.00 ج.م | EGP 45,000.00 |
| Currency KWD/OMR/BHD | 1,250.500 د.ك (3 decimals) | KWD 1,250.500 |
| Phone | ‎+966 55 123 4567‎ (always LTR) | +966 55 123 4567 |
| Eastern digits (if enabled) | ١ نوفمبر ٢٠٢٦ · ١٢٬٥٠٠٫٠٠ ر.س | — |

## 9. Accessibility copy
- Every icon-only button has a label in both languages: «الإشعارات، 5 غير مقروءة» / "Notifications, 5 unread".
- Alt text describes purpose, not appearance: certificate QR → «رمز QR للتحقق من الشهادة».
- `aria-live` announcements are short and final: «تم تسجيل حضورك، اليوم 2 من 3.»
- Link text makes sense alone: «عرض تفاصيل الجلسة» not «اضغط هنا».
- Do not rely on color words («الزر الأخضر») or position words that flip with direction («على اليمين»); use names («زر موافقة»).

## 10. Do / Don't

| Don't | Do | Why |
|---|---|---|
| «تم الحفظ بنجاح!» | «حُفظت التغييرات.» | Shorter; success implied; no exclamation |
| «حدث خطأ ما، يرجى المحاولة لاحقًا» | «تعذّر تحميل الجلسات. تحقق من الاتصال ثم أعد المحاولة. (المرجع: 7F3A-21)» | Specific cause and next step |
| «عزيزي المتدرب، يرجى الحضور…» | «مرحبًا يوسف، تبدأ جلستك غدًا…» | Personal and gender-neutral |
| «هل أنت متأكد؟» [نعم] [لا] | «إلغاء الجلسة وإشعار 18 مشاركًا؟» [إلغاء الجلسة] [رجوع] | Names the consequence; button repeats the action |
| «اضغط هنا» | «عرض الشهادة» | Link purpose is clear |
| «كورس القيادة – سيشن 3» | «دورة القيادة – الجلسة 3» | Glossary terms, no loanwords |
| «يرجى إدخال التاريخ بصيغة DD/MM/YYYY» | Date picker + «مثال: 1 نوفمبر 2026» | Forgiving input |
| "Please kindly note that the session has been cancelled." | "Session cancelled: Leadership Skills, Sun 1 Nov." | Plain English, fact first |
| Arabic generated from the English string | Arabic written first, English written as a peer | Q4 quality bar |
