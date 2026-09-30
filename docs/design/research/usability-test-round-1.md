# Usability Test — Round 1 (Prototypes) — Plan & Kit

| | |
|---|---|
| **Backlog** | T-M1-A05 (usability test round 1) — this document prepares it; sessions are run by the **Product Owner** with real users (Plan §2.3: human-only work) |
| **Depends on** | T-M0-08 (design partners recruited), `../prototype/index.html` (J1–J5 + shell) |
| **Quality bars** | Plan §1 Q3: coordinator course + session ≤ 10 min without training; QR check-in ≤ 3 s; manager approval ≤ 2 taps; SUS ≥ 80 (GA target). Gate G1: core-task success **≥ 80 %** on prototypes and **all critical issues fixed in designs** |
| **Requirements** | NFR-UX-03, NFR-UX-01/02, FR-STE-08, FR-SCH-05/06/07, FR-MGR-02, FR-ENR-06, FR-ATT-02/03, FR-PLN-03, FR-CRT-04 |
| **Status** | Ready for PO review — 30 Sep 2026 |

---

## 1. Objectives

1. **Validate the five critical journeys** in Arabic with the people who will use them; measure task success, time on task, errors and taps against the targets.
2. **Validate Arabic terminology** marked 🔎 in the glossary — especially «جلسة» for *session* and «حصر الاحتياجات» for *TNA campaign* — and overall copy tone (formality, gender-neutral phrasing).
3. **Validate the suite shell**: can people find approvals, notifications, the module switcher, and change calendar (Hijri/Gregorian) and language?
4. **Validate trust signals**: do people understand conflict warnings, the check-in errors, and certificate status on the public page — and know what to do next?
5. Produce a **prioritized findings list** that updates the designs before Gate G1.

Out of scope: visual brand (colors are placeholders), performance, real integrations, accessibility conformance testing (done separately with assistive-technology users; see §3.3).

## 2. Method

| Item | Plan |
|---|---|
| Type | Moderated task-based usability test with think-aloud, in Arabic |
| Format | Remote (Microsoft Teams/Zoom with screen share) or in person at the design partner's office; mobile tasks on the participant's own phone where possible |
| Length | 45–60 min per participant |
| Moderator | Product Owner (or a delegate); one note-taker (can be Claude from the recording transcript afterwards, with consent) |
| Prototype | `docs/design/prototype/index.html` opened locally, or the published private link if the PO publishes it. Reload the page before each participant to reset state |
| Pilot | 1 pilot session with an internal ENTLAQA colleague before the first participant; fix script issues |
| Language | Arabic by default; ask each participant at the end to switch to English and comment (bilingual parity check) for 2 minutes |

## 3. Participants

### 3.1 Quotas (5–8 per persona, Plan §9)

| Persona | Count | Profile | Journeys |
|---|---|---|---|
| **Training Coordinator / Training Manager** (Omar, Nada) | 5–8 | Schedules ILT sessions at least monthly; uses Excel/e-mail or another TMS/LMS today | J1, J5, shell |
| **Line Manager / Department Head** (Fatima) | 5–8 | Manages ≥ 3 direct reports; approves training or leave requests | J2 (web + WhatsApp), J4, shell |
| **Learner** (Yousef) | 5–8 | Employee who attended classroom training in the last 12 months; include ≥ 2 field/operational staff who use mainly a phone | J3, J5 |

Mix across the quotas: at least 2 Saudi and 1 government/bank design partner (T-M0-08); at least 2 participants based in Egypt; at least 40 % women; a range of ages; at least 2 participants who normally use a phone in English.

### 3.2 Recruitment screener

Ask via the design partner's HR/L&D contact. Disqualify answers marked ✗.

| # | Question (AR) | Question (EN) | Qualify |
|---|---|---|---|
| S1 | ما دورك الحالي في العمل؟ | What is your current role? | Coordinator/Training Manager, people manager, or employee (assign persona) |
| S2 | هل تعمل في شركة تقدم برمجيات إدارة التدريب أو الموارد البشرية؟ | Do you work for a company that sells training or HR software? | ✗ if yes |
| S3 | (المنسقون) كم جلسة تدريبية تجدول شهريًا تقريبًا؟ | (Coordinators) About how many training sessions do you schedule per month? | ≥ 1 |
| S4 | (المديرون) كم موظفًا يتبع لك مباشرة؟ | (Managers) How many direct reports do you have? | ≥ 3 |
| S5 | (المتدربون) هل حضرت تدريبًا حضوريًا خلال آخر 12 شهرًا؟ | (Learners) Did you attend classroom training in the last 12 months? | Yes |
| S6 | ما اللغة التي تستخدم بها الأنظمة في عملك عادة؟ | Which language do you normally use work systems in? | Any (record; balance quotas) |
| S7 | هل تستخدم واتساب في العمل؟ | Do you use WhatsApp for work? | Record (needed for J2 mock realism) |
| S8 | هل شاركت في اختبار لهذا المنتج من قبل؟ | Have you taken part in a test of this product before? | ✗ if yes |
| S9 | هل تستخدم قارئ شاشة أو تقنية مساعدة؟ | Do you use a screen reader or other assistive technology? | Record; invite 1–2 to the separate accessibility session (§3.3) |
| S10 | هل يمكنك تخصيص 60 دقيقة عبر اتصال فيديو أو حضوريًا؟ | Can you give 60 minutes by video call or in person? | Yes |

### 3.3 Accessibility participants (recommended)
Run 1–2 extra sessions with Arabic screen-reader users (VoiceOver iOS or TalkBack) on J3 and J2. These do not count toward the success-rate quotas; findings feed the accessibility backlog (Q5).

## 4. Consent

Read aloud and obtain agreement **before** recording. Store signed/recorded consent with the session notes. Recordings contain personal data: store them in the ENTLAQA-approved location only, never in the repository, and delete them **90 days** after the findings report (or earlier on request). Follow the applicable data-protection law (KSA PDPL; Egypt PDPL; UAE PDPL) — PO to confirm wording with legal.

### 4.1 Arabic

> نشكرك على مشاركتك. تعمل شركة «انطلاقة» على تطوير نظام «جدارات» لإدارة التدريب، ونرغب في معرفة مدى سهولة استخدام نموذج أولي منه.
>
> - سنطلب منك تنفيذ بعض المهام على النموذج والتفكير بصوت مرتفع أثناء ذلك. نحن نختبر النظام، ولا نختبرك أنت؛ لا توجد إجابات صحيحة أو خاطئة.
> - تستغرق الجلسة نحو 60 دقيقة.
> - نود تسجيل الشاشة والصوت (والصورة إذا وافقت) لمراجعة الملاحظات لاحقًا. يطلع على التسجيل فريق المنتج فقط، ولن يُستخدم لأي غرض آخر، وسيُحذف خلال 90 يومًا من إعداد التقرير.
> - لن نذكر اسمك أو اسم جهة عملك في أي تقرير. قد نقتبس عبارات قلتها دون ذكر هويتك.
> - مشاركتك اختيارية، ويمكنك التوقف في أي وقت أو طلب حذف التسجيل دون إبداء أسباب.
> - البيانات في النموذج تجريبية؛ يُرجى عدم إدخال أي بيانات شخصية حقيقية.
>
> هل توافق على المشاركة؟ ☐ نعم ☐ لا — هل توافق على تسجيل الشاشة والصوت؟ ☐ نعم ☐ لا — هل توافق على تسجيل الصورة؟ ☐ نعم ☐ لا
>
> للتواصل بشأن بياناتك: [اسم مالك المنتج والبريد الإلكتروني]

### 4.2 English

> Thank you for taking part. ENTLAQA is developing Jadarat, a training management system, and we want to learn how easy a prototype of it is to use.
>
> - We'll ask you to do some tasks and think aloud while you work. We're testing the system, not you; there are no right or wrong answers.
> - The session takes about 60 minutes.
> - We'd like to record the screen and audio (and video if you agree) so we can review our notes. Only the product team will see the recording; it won't be used for anything else and will be deleted within 90 days of the report.
> - We won't name you or your organization in any report. We may quote what you said without identifying you.
> - Taking part is voluntary. You can stop at any time or ask us to delete the recording without giving a reason.
> - The prototype contains sample data; please don't enter any real personal data.
>
> Do you agree to take part? ☐ Yes ☐ No — Record screen and audio? ☐ Yes ☐ No — Record video? ☐ Yes ☐ No
>
> Contact about your data: [Product Owner name and e-mail]

## 5. Tasks, success criteria and targets

Give each scenario as written, in Arabic (English for the parity check). Do not use the words on the buttons in the scenario (avoid leading). Start each task from the route in *Start*; the moderator navigates there before handing over.

| ID | Persona | Journey | Start | Scenario (AR) | Scenario (EN) | Success criteria | Target |
|---|---|---|---|---|---|---|---|
| T1 | Coordinator | J1 | `#shell` (role: coordinator) | «طلب منك مدير التدريب تنظيم دورة للمشرفين الجدد في الرياض مدتها ثلاثة أيام تبدأ الأحد 1 نوفمبر، باستخدام القالب المعتاد، في قاعة الياسمين، مع المدرب خالد العتيبي. نظّم ذلك في النظام.» | "Your training manager asked you to set up a 3-day course for new supervisors in Riyadh starting Sunday 1 November, using the usual template, in the Jasmine room, with Khalid Al-Otaibi. Set it up in the system." | Session scheduled (done page) with room + instructor; the instructor conflict resolved by choosing an available instructor **or** moving the day; the prayer overlap handled (break or reason) | **≤ 10 min** (NFR-UX-03); no moderator help |
| T2 | Coordinator | Shell | `#shell` | «تفضّل رؤية التواريخ بالتقويم الهجري فقط. غيّر ذلك.» | "You prefer to see dates in the Hijri calendar only. Change that." | Calendar set to Hijri from the user menu | ≤ 60 s |
| T3 | Line manager | J2 | `#shell` (role: manager) | «وصلك إشعار بأن أحد أعضاء فريقك يطلب حضور دورة. اتخذ قرارك بالموافقة عليه.» | "You got a notification that a team member wants to attend a course. Approve it." | Yousef's request approved | **≤ 2 taps** from the notification (count); ≤ 60 s |
| T4 | Line manager | J2 | `#j2` | «لا ترى أن طلب ريم العنزي مناسب في هذا الوقت. ارفضه وأبلغها بالسبب.» | "Reem Al-Anazi's request doesn't fit right now. Reject it and tell her why." | Rejected with a reason | ≤ 90 s |
| T5 | Line manager | J2 (WhatsApp) | `#j2-wa` | «وصلتك هذه الرسالة على واتساب. وافق على الطلب من هنا.» | "You received this WhatsApp message. Approve the request from here." | Approved in the mock; participant can say what happens next | ≤ 2 taps; ≤ 30 s |
| T6 | Line manager | J4 | `#shell` | «بدأ حصر الاحتياجات التدريبية لعام 2027. أحمد عبدالعزيز يحتاج بشكل عاجل إلى دورة القيادة لأنه سيقود فريق الصيانة في الربع الثاني. أضف ذلك، ثم أرسل نموذج فريقك.» | "The 2027 training needs analysis has started. Ahmed Abdelaziz urgently needs the leadership course because he'll lead the maintenance team in Q2. Add it, then submit your team form." | Need added for Ahmed with **critical/high** priority, Q2, justification; form submitted | ≤ 8 min (proposed; no BRD target) |
| T7 | Line manager | J4 | `#j4` (fresh) | «ترى أن يوسف لا يحتاج إلى دورة السلامة هذا العام. ماذا ستفعل؟» | "You think Yousef doesn't need the safety course this year. What would you do?" | Understands a mandatory need needs a reason and that it is visible to L&D; completes or explains | Observation (no time target) |
| T8 | Learner | J3 | `#j3` (role: learner) | «وصلت إلى قاعة التدريب صباح اليوم. سجّل حضورك.» (moderator then taps "رمز صالح" when the participant points the camera) | "You've arrived at the training room this morning. Check in." | Reaches the success screen | Task ≤ 30 s; system response ≤ 3 s |
| T9 | Learner | J3 | `#j3-expired` | «ظهرت لك هذه الرسالة بعد أن مسحت صورة للرمز أرسلها لك زميل. ماذا تعني؟ وماذا ستفعل؟» | "You scanned a photo of the code a colleague sent you and got this. What does it mean? What will you do?" | Explains the code expired and chooses to scan the live code | Comprehension (correct explanation) |
| T10 | Learner | J3 | `#j3-range` | «ظهرت لك هذه الرسالة وأنت في مواقف السيارات. ماذا حدث؟ هل سُجّل حضورك؟» | "You got this message in the car park. What happened? Were you checked in?" | Understands the instructor will review, and that re-scanning at the venue is the fix | Comprehension |
| T11 | All | J5 | `#home` → tap the certificate QR | «أرسل لك أحدهم شهادة تدريب. امسح الرمز الموجود عليها وأخبرنا: هل يمكن الاعتماد عليها؟» (repeat with the expired and revoked states via the prototype control) | "Someone sent you a training certificate. Scan its code and tell us: can you rely on it?" | States valid/expired/revoked correctly for each state and names the issuer | **≤ 30 s** per state (proposed) |

Success scoring per task: **1** = completed without help, **0.5** = completed with a hint or with a non-critical error, **0** = failed/gave up/moderator completed. Task success rate = mean score. Gate G1 needs **≥ 80 %** on T1, T3, T6, T8, T11 (the core tasks).

After each task ask the **Single Ease Question**: «بشكل عام، ما مدى سهولة أو صعوبة هذه المهمة؟» 1 (صعبة جدًا) – 7 (سهلة جدًا) / "Overall, how difficult or easy was this task?" 1 (very difficult) – 7 (very easy).

## 6. Moderator script

### 6.1 Arabic

**الترحيب (3 دقائق)**
> أهلًا بك، وشكرًا لوقتك. اسمي … وأعمل مع فريق «جدارات». سنجرب اليوم نموذجًا أوليًا لنظام إدارة التدريب. النموذج غير مكتمل وبعض الأزرار لا تعمل، وهذا طبيعي. قبل أن نبدأ، سأقرأ عليك نص الموافقة. [اقرأ §4.1 وسجّل الموافقة]

**أسئلة تمهيدية (5 دقائق)**
> - حدّثني عن دورك الحالي وعلاقتك بالتدريب في عملك.
> - آخر مرة نظّمت فيها تدريبًا / وافقت على طلب تدريب / حضرت تدريبًا، كيف تمت العملية؟ ما الذي أزعجك فيها؟
> - ما الأنظمة التي تستخدمها لذلك اليوم؟

**شرح التفكير بصوت مرتفع**
> سأعطيك بعض المهام. أرجو أن تقول ما تفكر فيه أثناء العمل: ما الذي تبحث عنه، وما تتوقع أن يحدث، وما يربكك. إذا سألتني سؤالًا فقد أعيده إليك، لأننا نريد أن نعرف كيف ستتصرف لو كنت وحدك. يمكنك التوقف متى شئت.

**المهام (30–35 دقيقة)** — اقرأ السيناريو من §5، ثم التزم الصمت. عبارات محايدة للتدخل:
> - «ماذا تتوقع أن يحدث إذا ضغطت هنا؟»
> - «ما الذي تبحث عنه الآن؟»
> - «ماذا تعني لك هذه الرسالة؟»
> - «كيف ستعرف أنك انتهيت؟»
> - إذا تعثّر المشارك لأكثر من دقيقتين: «ماذا كنت ستفعل لو كنت في عملك الآن؟» ثم تلميح واحد، وسجّل المهمة 0.5.

تجنّب: شرح الواجهة، أو قول «صحيح/خطأ»، أو استخدام كلمات الأزرار.

**بعد كل مهمة** — سؤال السهولة (SEQ) من §5.

**المصطلحات (5 دقائق)**
> - ماذا تسمي في عملك موعد انعقاد الدورة بتاريخه ومكانه ومدربه؟ (تحقق من «جلسة» / «دورة» / «دفعة»)
> - ماذا تعني لك عبارة «حصر الاحتياجات التدريبية»؟
> - هل لاحظت كلمات غير واضحة أو غير مألوفة؟

**التكافؤ اللغوي (دقيقتان)** — بدّل الواجهة إلى الإنجليزية: «ألقِ نظرة سريعة. هل هناك ما يختلف أو يبدو أوضح أو أقل وضوحًا؟»

**الاستبيان الختامي** — استبيان SUS من §7.

**الختام (3 دقائق)**
> - ما أكثر شيء أعجبك؟ وما أكثر شيء أزعجك؟
> - لو استطعت تغيير شيء واحد، ماذا سيكون؟
> شكرًا جزيلًا لك. ملاحظاتك ستؤثر مباشرة في تصميم النظام.

### 6.2 English

**Welcome (3 min)**
> Hello, and thank you for your time. My name is … and I work with the Jadarat team. Today we'll try a prototype of a training management system. It's unfinished and some buttons don't work; that's expected. Before we start, I'll read the consent text. [Read §4.2 and record consent]

**Warm-up (5 min)**
> - Tell me about your role and how training fits into your work.
> - The last time you organized training / approved a training request / attended training, how did it work? What annoyed you?
> - Which systems do you use for this today?

**Think-aloud briefing**
> I'll give you some tasks. Please say what you're thinking as you go: what you're looking for, what you expect to happen, what confuses you. If you ask me something I may turn it back to you, because we want to see what you'd do on your own. You can stop at any time.

**Tasks (30–35 min)** — read the scenario from §5, then stay quiet. Neutral prompts:
> - "What do you expect will happen if you tap there?"
> - "What are you looking for right now?"
> - "What does this message mean to you?"
> - "How will you know you're done?"
> - If stuck for more than 2 minutes: "What would you do if you were at work right now?", then one hint; score the task 0.5.

Avoid: explaining the UI, saying "right/wrong", or using button labels.

**After each task** — SEQ (§5).

**Terminology (5 min)**
> - At work, what do you call a scheduled run of a course with its date, place and trainer? (probe «جلسة» / «دورة» / «دفعة»)
> - What does «حصر الاحتياجات التدريبية» mean to you?
> - Did you notice any unclear or unfamiliar words?

**Language parity (2 min)** — switch to Arabic/English: "Take a quick look. Is anything different, clearer or less clear?"

**Closing questionnaire** — SUS (§7).

**Wrap-up (3 min)**
> - What did you like most? What annoyed you most?
> - If you could change one thing, what would it be?
> Thank you very much. Your feedback directly shapes the product.

## 7. System Usability Scale (SUS) — Arabic and English

Scale for every item: **1 = أعارض بشدة / Strongly disagree … 5 = أوافق بشدة / Strongly agree**. Items use first-person verbs, which are gender-neutral in Arabic. A published Arabic adaptation of SUS exists (AlGhannam et al., 2018); the PO may substitute its validated wording — record which version was used so scores stay comparable across rounds.

| # | العبارة (AR) | Statement (EN) |
|---|---|---|
| 1 | أعتقد أنني سأرغب في استخدام هذا النظام بشكل متكرر. | I think that I would like to use this system frequently. |
| 2 | وجدت النظام معقدًا دون داعٍ. | I found the system unnecessarily complex. |
| 3 | وجدت النظام سهل الاستخدام. | I thought the system was easy to use. |
| 4 | أعتقد أنني سأحتاج إلى مساعدة شخص متخصص تقنيًا لأتمكن من استخدام هذا النظام. | I think that I would need the support of a technical person to be able to use this system. |
| 5 | وجدت أن وظائف النظام المختلفة متكاملة بشكل جيد. | I found the various functions in this system were well integrated. |
| 6 | وجدت في النظام قدرًا كبيرًا من عدم الاتساق. | I thought there was too much inconsistency in this system. |
| 7 | أتوقع أن معظم الناس سيتعلمون استخدام هذا النظام بسرعة كبيرة. | I would imagine that most people would learn to use this system very quickly. |
| 8 | وجدت النظام مرهقًا جدًا في الاستخدام. | I found the system very cumbersome to use. |
| 9 | شعرت بثقة كبيرة أثناء استخدام النظام. | I felt very confident using the system. |
| 10 | احتجت إلى تعلّم أشياء كثيرة قبل أن أتمكن من البدء في استخدام هذا النظام. | I needed to learn a lot of things before I could get going with this system. |

**Scoring:** odd items: score − 1; even items: 5 − score; sum × 2.5 → 0–100. Report mean, median and range per persona. Round-1 prototype scores are a baseline; the SUS ≥ 80 target applies at GA (Q3), but a score below 68 on any persona is flagged to the PO as a risk.

## 8. Note-taking template

One sheet per participant (copy into a spreadsheet; no names — use participant codes P01–P24).

| Field | Entry |
|---|---|
| Participant | P__ · persona · country · device (phone/desktop) · language usually used |
| Date / moderator / note-taker | |
| Consent recorded (screen / audio / video) | ☐ / ☐ / ☐ |

| Task | Score (1 / 0.5 / 0) | Time (mm:ss) | Taps (T3, T5, T8) | Errors / wrong paths | Quotes (verbatim, AR) | Observations | SEQ (1–7) |
|---|---|---|---|---|---|---|---|
| T1 | | | — | | | | |
| T2 | | | — | | | | |
| … | | | | | | | |

| Terminology probe | Answer |
|---|---|
| Word for *session* | |
| Understanding of «حصر الاحتياجات» | |
| Unclear words noticed | |

SUS item scores (1–10): __ __ __ __ __ __ __ __ __ __ → SUS = ___

## 9. Analysis and severity rubric

1. **Within 48 h of each session:** note-taker completes the template; PO shares notes (or consented transcripts) with Claude.
2. **After each persona batch:** Claude clusters observations into findings (affinity by task and screen), computes task success, time and SUS, and drafts the findings report.
3. **Severity** (per finding, highest applicable):

| Severity | Definition | Examples | Required action |
|---|---|---|---|
| **4 — Critical** | Prevents task completion for ≥ 2 participants, or causes a wrong outcome the user doesn't notice (e.g., approves the wrong request, believes they're checked in when not) | Cannot find how to resolve the instructor conflict | **Fix in designs before Gate G1**; re-test with 2–3 users |
| **3 — Major** | Significant delay/errors for ≥ 2 participants, or task completed only with a hint | Misreads «ملغاة» as "cancelled session" | Fix before the milestone that builds the screen (DoR for its stories) |
| **2 — Minor** | Hesitation or cosmetic confusion; recovers alone | Unsure where the Hijri date is | Backlog; fix when the component is built |
| **1 — Cosmetic / suggestion** | Preference or polish | Wants a bigger check-in button | Log; decide at design review |
| **Terminology** | Word misunderstood or a better word proposed by ≥ 2 participants | «جلسة» understood as a single lecture | Update the glossary (and the BRD Arabic labels if affected) via PO decision |

Frequency × impact decides ties. Positive findings (what worked) are recorded too, so they are not "fixed" away.

## 10. How findings flow into the backlog

| Step | Output | Owner |
|---|---|---|
| 1 | `docs/design/research/usability-round-1-findings.md` — summary metrics per task and persona, SUS, findings with ID `UXR1-###`, severity, evidence (participant codes, quotes), recommendation, affected requirement IDs | Claude (from PO's notes) |
| 2 | Design updates to `prototype/index.html`, `suite-shell.md`, glossary and style guide for all **critical** and agreed **major** findings; each change references its `UXR1-###` | Claude |
| 3 | Backlog: new tasks under M1 Track A for critical fixes (e.g., `T-M1-A04a — Fix UXR1-003`); major/minor findings attached as acceptance criteria to the stories of the milestone that builds the screen (M2–M5) | Claude drafts, PO approves |
| 4 | Glossary/BRD terminology changes proposed as a PO decision; recorded in `docs/delivery/STATUS.md` decisions table; if the BRD's Arabic labels change, BRD version incremented with the feature list | PO decides, Claude edits |
| 5 | Re-test of critical fixes with 2–3 participants; Gate G1 evidence: success ≥ 80 % on core tasks, no open critical findings | PO runs, Claude analyses |
| 6 | Research repository: anonymized notes only (no recordings, no names) linked from the findings file | PO |

## 11. Logistics checklist (PO)

- [ ] Design partners confirmed (T-M0-08) and participant list per quota (§3.1)
- [ ] Consent wording confirmed with legal (§4)
- [ ] Incentive decided (if any) and approved by partners
- [ ] Pilot session done; script adjusted
- [ ] Prototype reset (reload) before each session; mobile tasks tested on iOS Safari and Android Chrome
- [ ] Recording storage location agreed; deletion date set (90 days after report)
- [ ] Notes shared with Claude within 48 h of each session
