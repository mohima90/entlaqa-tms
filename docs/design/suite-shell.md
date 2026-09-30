# Jadarat Suite Shell — Design Specification (v1)

| | |
|---|---|
| **Backlog** | T-M1-A03 (suite shell design) |
| **Requirement** | FR-STE-08 (M, R1): one navigation shell, module switcher, unified notification inbox, unified search, one approvals inbox across modules, one installable PWA with module sections — designed in R1 even when only TMS is licensed |
| **Also** | FR-NTF-01 (notification center), FR-MGR-02 (approvals inbox), FR-LRN-04 (PWA), FR-LRN-07 (preferences), CAT-10 (Arabic search), NFR-UX-01…04, NFR-L10N-01…13, SUB-01 (feature gating), DEP-05 (Arabic-only mode) |
| **Status** | Draft v1 — 30 Sep 2026; interactive reference in `prototype/index.html` (shell on every signed-in screen) |
| **Owner** | Platform (`packages/platform-*`, `packages/ui`) — not the TMS module |

The shell is a **platform component**. Modules register their navigation, search providers, notification types and approval types with the shell; they never render their own header or side navigation (Development Plan §1 Q9, BRD Appendix H.5).

---

## 1. Anatomy

Desktop (≥ 1200 px), Arabic RTL. The side navigation sits at the inline-start edge, which is the **right** in Arabic and the left in English.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [نموذج أولي] … (prototype marker; not in product)                            │
├──────────────────────────────────────────────────────────────────────────────┤
│ جدارات · التدريب  [▦ الوحدات]   [🔍 ابحث في جدارات…  Ctrl K]   [✓3] [🔔5] [شركة الراية · الرياض ▾] [ن ▾] │  ← header 56 px
├───────────────┬──────────────────────────────────────────────────────────────┤
│ الرئيسية      │  Breadcrumb › Page title                    [Primary action] │
│ التقويم       │                                                              │
│ الجلسات   ●   │  Content (max 1280 px, centred)                             │
│ الدورات       │                                                              │
│ …             │                                                              │
│───────────────│                                                              │
│ الإعدادات     │                                                              │
│ المساعدة      │                                                              │
└───────────────┴──────────────────────────────────────────────────────────────┘
   side nav 264 px (inline-start)
```

Mobile (< 900 px), learner/instructor/manager:

```
┌──────────────────────────────┐
│ ☰  جدارات · التدريب  [✓][🔔][ن] │  header 56 px (search as icon)
├──────────────────────────────┤
│                              │
│  Page content (single column)│
│                              │
├──────────────────────────────┤
│ الرئيسية التقويم [مسح] الشهادات المزيد │  bottom nav 64 px + safe-area inset
└──────────────────────────────┘
```

Landmarks: `<header role="banner">`, `<nav aria-label="التنقل الرئيسي">`, `<main id="main">`, `<nav aria-label="التنقل السفلي">` on mobile. A "تخطَّ إلى المحتوى / Skip to content" link is the first focusable element.

## 2. Responsive behavior

| Width | Side navigation | Search | Bottom navigation |
|---|---|---|---|
| ≥ 1200 px | Expanded (264 px), user can collapse to rail (72 px); choice remembered per user | Full field in header | — |
| 900–1199 px | Rail (72 px) with tooltips; expands as overlay on hover/focus of the toggle | Field (shorter) | — |
| 600–899 px | Hidden; opens as drawer from the inline-start edge (☰) | Icon → full-width overlay | Learner, instructor, manager roles |
| < 600 px (min 360) | Drawer | Icon → full-screen search | Learner, instructor, manager roles |

Coordinator, Training Manager and Tenant Admin roles are desktop-first but fully responsive (drawer + header on mobile; no bottom navigation, because their navigation is too wide for 5 slots).

## 3. App header (56 px, sticky, `--z-header`)

Order in reading direction (start → end):

| # | Element | Behavior |
|---|---|---|
| 1 | Menu button (☰) | Mobile/tablet only. Opens the navigation drawer. `aria-expanded`, `aria-controls`. |
| 2 | Suite wordmark + current module | "جدارات · التدريب" / "Jadarat · Training". Links to the module home. Tenant logo replaces the wordmark when branding is configured (ADM-07); "Powered by Jadarat" stays in the user menu. |
| 3 | Module switcher | See §4. |
| 4 | Global search | See §7. Shortcut `Ctrl K` / `⌘ K` and `/`. |
| 5 | Approvals inbox | Check-list icon with count of pending items assigned to me. Opens the approvals panel (§6). Hidden for users who can never approve (e.g., learner-only). |
| 6 | Notifications | Bell icon with unread count (max "99+"). Opens the notification panel (§5). |
| 7 | Tenant / branch context | "شركة الراية · فرع الرياض". See §9. Collapses into the user menu below 900 px. |
| 8 | User menu | Avatar with initials (Arabic initial for Arabic names). See §10. |

Counts are announced ("5 إشعارات غير مقروءة") and use `aria-live="polite"` only when they increase while the user is on the page (not on first load).

## 4. Module switcher

A menu button (grid icon + "الوحدات" / "Modules") opening a grid of suite modules. It exists from R1 even with one module, so suite customers never have to relearn navigation.

| Module (AR) | Module (EN) | R1 state | States |
|---|---|---|---|
| التدريب | Training (TMS) | Active | Current module (check mark, `aria-current="true"`) |
| الموارد البشرية الأساسية | Core HR | Not available | "قريبًا" / "Coming soon" |
| الرواتب والوقت | Payroll & Time | Not available | "قريبًا" |
| الأداء والمهارات | Performance & Skills | Not available | "قريبًا" |
| التوظيف والتهيئة | Recruitment & Onboarding | Not available | "قريبًا" |
| التعلّم الإلكتروني (جدارات LMS) | Jadarat LMS | Linked if the LMS connector is configured (LMS-02/03) | Opens LMS via SSO deep link in a new tab, marked "يفتح في نافذة جديدة" |

States
- **Licensed:** normal item, opens the module.
- **Available but not licensed:** lock icon + "غير مشمول في اشتراك منشأتكم" and, for Tenant Admins only, "تواصل مع فريق جدارات" (link to the subscription page). Non-admins see no sales prompt.
- **Coming soon:** muted item with "قريبًا"; not focusable as a link (rendered as text with `aria-disabled="true"`), announced as "قريبًا".
- Tenant Admin setting: *Show unlicensed modules in the switcher* (default on for commercial tenants, off for government tenants).

Keyboard: Enter/Space opens; arrow keys move within the grid; Esc closes and returns focus to the button.

## 5. Unified notification inbox (FR-NTF-01, FR-STE-08)

One inbox for all modules. Desktop: panel (400 px) anchored to the bell; "عرض الكل" opens the full page. Mobile: full page.

| Part | Spec |
|---|---|
| Tabs | الكل · غير المقروءة · (per-module filter when > 1 module licensed) |
| Grouping | اليوم · أمس · هذا الأسبوع · أقدم |
| Item | Module icon · title (bold when unread) · one-line summary · relative time · optional inline action (e.g., "فتح رمز الحضور", "عرض الشهادة") |
| Actions | Mark as read (per item, on open), "تعليم الكل كمقروء", bulk select on the full page |
| Real-time | New items appear at the top with a subtle highlight; focus is never moved; counts update |
| Deep links | Every item links to its object; if the object was deleted or access was revoked, show "لم يعد هذا العنصر متاحًا" |
| Preferences | Link to notification preferences (channels, language, quiet hours — FR-LRN-07, NTF-07) |
| Empty | "لا توجد إشعارات جديدة. سنُعلمك هنا عند وجود ما يحتاج انتباهك." |
| Retention | Show 90 days in the panel; older via the full page (message log retention 12 months, BR-NTF-2) |

## 6. Unified approvals inbox (FR-MGR-02, FR-STE-08)

One queue of everything waiting for *my* decision across modules (R1: training requests, enrollment approvals, external certificate verification; later: plan lines, invoices, OJT sign-offs, leave from Core HR, etc.).

| Part | Spec |
|---|---|
| Entry points | Header icon (count), side nav "الموافقات", notification and WhatsApp/e-mail deep links (open the item directly) |
| List item | Requester (name, job title) · request type · object (course/session with dates) · **context**: cost and budget impact, conflict with team calendar, requested date, due-by / SLA · two inline buttons: **موافقة** (primary) and **رفض** |
| 2-tap target | From a notification: tap 1 opens the item, tap 2 approves. In the list: one tap on "موافقة". |
| Reject | Requires a reason (preset reasons + free text), shown in a sheet/dialog; the reason goes to the requester |
| Undo | After approve/reject a toast shows "تمت الموافقة على طلب … · تراجع" for 10 s. Outbound notifications are held for those 10 s so undo leaves no trace except the audit entry |
| Bulk | Select multiple → "موافقة على المحدد (3)"; items needing a reason are excluded with a note |
| Filters | النوع · الفريق · الأقدم أولًا / الأقرب استحقاقًا |
| Delegation | Banner when acting as a delegate (FR-IAM-14, R2): "تعمل نيابة عن فاطمة الزهراني حتى 15 أكتوبر" |
| Audit | Every decision records channel (web, mobile, e-mail link, WhatsApp), actor, time (FR-ENR-06) |
| Empty | "لا توجد طلبات بانتظار موافقتك." with a link to decisions history |

## 7. Global search (unified)

| Part | Spec |
|---|---|
| Scope | All licensed modules, trimmed by permissions and data scope; results never reveal existence of records the user cannot open |
| Groups | الإجراءات (e.g., "جدولة جلسة") · الأشخاص · الدورات · الجلسات · الشهادات · الصفحات |
| Arabic handling | Normalize alef/hamza forms, ى/ي, ة/ه, tatweel and diacritics; tolerate «عبد الله/عبدالله»; match Latin transliterations of names; light stemming (CAT-10) |
| Keyboard | `Ctrl K`/`⌘ K`/`/` focuses; ↑↓ moves; Enter opens; Esc closes; results are a `listbox` with `aria-activedescendant` |
| Recent | Last 5 searches and recently opened items when the field is empty |
| Codes | Exact code match (session code, certificate number, employee ID) jumps to the record |
| No results | "لا توجد نتائج لـ «…». جرّب كلمة أقصر أو ابحث بالرمز." |

## 8. Mobile bottom navigation (NFR-UX-02, FR-LRN-04)

Shown below 900 px for roles whose primary work is on the phone. Max 5 items, icon + label (labels always visible), 64 px + safe-area inset, active item uses `--color-primary` and `aria-current="page"`.

| Role | 1 | 2 | 3 (centre action) | 4 | 5 |
|---|---|---|---|---|---|
| Learner | الرئيسية (تعلّمي) | التقويم | **تسجيل الحضور** (QR scan) | الشهادات | المزيد |
| Instructor | جلساتي | الحضور | **عرض رمز الحضور** | المواد | المزيد |
| Line Manager | الرئيسية | الموافقات (badge) | **ترشيح** | فريقي | المزيد |

Users with several roles (BR-IAM-1) get the bar of their primary role; "المزيد" opens the full navigation. One PWA for all modules: module sections appear under "المزيد" when more modules are licensed.

## 9. Tenant and branch context

- The chip shows the tenant display name and the current branch filter: "شركة الراية · فرع الرياض".
- Users whose data scope covers several branches can switch "كل الفروع / فرع الرياض / فرع جدة"; the choice filters lists and dashboards and is shown in page headers ("تعرض بيانات: فرع جدة").
- Users with access to more than one tenant (e.g., external instructors working for two clients, IAM-15 R2) switch tenant here; switching reloads the shell and the language/branding of that tenant.
- A sandbox/test tenant shows a persistent colored strip "بيئة تجريبية" at the top (ADM-15, R3).
- Tenant is never taken from the URL or client for authorization; the chip is display only (CLAUDE.md non-negotiable).

## 10. User menu

| Item | Options |
|---|---|
| Profile | Name, role(s), branch; link to "ملفي" |
| اللغة / Language | العربية · English (hidden in Arabic-only tenants, DEP-05) |
| التقويم / Calendar | ميلادي · هجري · كلاهما (FR-SCH-07; default from tenant) |
| الأرقام / Numerals | 0–9 · ٠–٩ (Arabic UI only; NFR-L10N-03) |
| المظهر / Theme | النظام · فاتح · داكن |
| Notification preferences | Channels, quiet hours (FR-LRN-07) |
| Help | Help center, keyboard shortcuts, "What's new" |
| تسجيل الخروج / Sign out | Ends the session; returns to sign-in |

Preferences apply immediately without reload, are stored on the user profile (not only in the browser) and follow the user across devices.

## 11. Navigation IA by role — R1 TMS

Items labeled *(R2)* are shown to the roles below only when the feature ships; they are listed so the IA does not change shape later. Items appear only when the user's permissions allow (Appendix B); the list is the union of the user's roles (BR-IAM-1).

### 11.1 Training Coordinator / Training Manager (desktop-first)
| Group | Item (AR) | Item (EN) | Features |
|---|---|---|---|
| — | الرئيسية | Home | Today's sessions, tasks due, conflicts, sessions under minimum (SCH-08) |
| العمليات | التقويم | Calendar | SCH-03, SCH-07 |
| | الجلسات | Sessions | SCH-01/02/05, FIN-03 cost model, LOG-01 tasks |
| | التسجيلات | Enrollments | ENR-01/02/03, ENR-13 |
| | الحضور | Attendance | ATT-01…04, ATT-11 |
| | المهام | Tasks | LOG-01/02 |
| الدليل | الدورات والبرامج | Courses & programs | CAT-01/03/05/06/10 |
| | القوالب | Templates | CAT-02 |
| الموارد | المدربون | Instructors | INS-01…05 |
| | المقرات والقاعات | Venues & rooms | RES-01/02/03/07 |
| التقييم والاعتماد | الاختبارات والاستبيانات | Tests & surveys | ASM-01/02/04/05/08 |
| | الشهادات | Certificates | CRT-01…06 |
| | الامتثال | Compliance | CRT-07/08, REG-01 |
| التخطيط | طلبات التدريب | Training requests | PLN-01 |
| | الخطة التدريبية *(R2)* | Training plan | PLN-02…12 |
| | حصر الاحتياجات *(R2)* | Needs analysis (TNA) | PLN-02/03 |
| — | التقارير | Reports | RPT-01/02 |
| — | الموافقات | Approvals | MGR-02 (shared inbox) |

### 11.2 Line Manager / Department Head (mobile-first)
| Item (AR) | Item (EN) | Features |
|---|---|---|
| الرئيسية | Home (team dashboard) | MGR-01 |
| الموافقات | Approvals | MGR-02 |
| فريقي | My team (compliance, certificates) | MGR-01, CRT-08 |
| تقويم الفريق | Team calendar | MGR-03 |
| ترشيح | Nominate | MGR-04, ENR-02 |
| طلبات التدريب | Training requests | PLN-01 |
| حصر الاحتياجات *(R2)* | Needs analysis | MGR-05, PLN-03 |
| تعلّمي | My learning | LRN-01 (managers are learners too) |
| التقارير | Reports (team) | RPT-01 scoped |

### 11.3 Learner (mobile-first)
| Item (AR) | Item (EN) | Features |
|---|---|---|
| تعلّمي | My learning | LRN-01 |
| دليل الدورات | Catalog | CAT-10, ENR-01 |
| التقويم | Calendar | LRN-03 |
| تسجيل الحضور | Check in | ATT-02/03 |
| شهاداتي | My certificates | CRT-03/04/06 |
| طلباتي | My requests | PLN-01 |
| الإعدادات | Preferences | LRN-07 |

### 11.4 Instructor (internal / external)
| Item (AR) | Item (EN) | Features |
|---|---|---|
| جلساتي | My sessions | INS-05 |
| الحضور | Attendance (roster, show QR) | ATT-01/02/04 |
| المواد | Materials | CAT-06 |
| التصحيح والتقييم | Grading | ASM-04 |
| توفّري | My availability | INS-04 |
| ملفي ومؤهلاتي | Profile & qualifications | INS-01/02 |

External instructors see only assigned sessions and no directory data (Appendix B).

### 11.5 Tenant Admin
| Item (AR) | Item (EN) | Features |
|---|---|---|
| نظرة عامة | Overview | ADM-14 |
| بيانات المنشأة | Organization (profile, branches, departments, cost centers) | ADM-02/04/05 |
| المستخدمون | Users (directory, invitations, import) | IAM-01…05 |
| الأدوار والصلاحيات | Roles & permissions | IAM-07 |
| الهوية البصرية | Branding | ADM-07 |
| الحقول المخصصة | Custom fields | ADM-11 |
| الإشعارات | Notifications (event catalog, templates) | NTF-02/07/08 |
| التكاملات | Integrations (LMS connector) | LMS-01…10 |
| الأمان | Security (MFA, password policy, sessions) | IAM-12/13 |
| الموافقات والخصوصية | Consent & privacy | AUD-05 |
| سجل التدقيق | Audit log | AUD-01 |
| الاشتراك | Subscription & features | SUB-01, ADM-13 |

## 12. System states (shared)

| State | Pattern | Copy (AR / EN) |
|---|---|---|
| Empty (first use) | Illustration-free: icon + title + one sentence + primary action | «لا توجد جلسات مجدولة بعد» + «جدولة جلسة» / "No sessions scheduled yet" + "Schedule a session" |
| Empty (filtered) | Explain the filter and offer "مسح عوامل التصفية" | «لا توجد نتائج تطابق عوامل التصفية» |
| Loading | Skeleton rows/cards in the final layout after 300 ms; `aria-busy="true"` on the region; announce "جارٍ التحميل" once | — |
| Error (recoverable) | Inline alert in the region with "إعادة المحاولة" and a support reference | «تعذّر تحميل الجلسات. تحقق من الاتصال ثم أعد المحاولة. (المرجع: 7F3A-21)» |
| Offline (PWA) | Top banner; cached content marked; queued actions listed | «أنت غير متصل. سنرسل تسجيل الحضور عند عودة الاتصال.» |
| No permission (403) | Full-page message, no data leaked; link to home and to "طلب صلاحية" if configured | «ليست لديك صلاحية لعرض هذه الصفحة.» |
| Not found (404) | Search field + home link | «لم نعثر على هذه الصفحة.» |
| Module not licensed | Switcher lock state (§4) | «غير مشمول في اشتراك منشأتكم» |
| Session expiring | Dialog 2 min before timeout with "متابعة الجلسة" (SC 2.2.1) | «ستنتهي جلستك خلال دقيقتين.» |

## 13. Accessibility checklist for the shell
- Skip link; landmarks named in both languages; `aria-current="page"` on the active nav item.
- Popovers (switcher, notifications, approvals, user menu) are dialogs or menus with focus moved in, Esc to close, focus returned to the trigger.
- Sticky header and bottom bar never obscure focused elements (`scroll-padding-block` = header / bottom-nav heights; SC 2.4.11).
- Icon-only buttons have text labels (`aria-label`) and tooltips; badges' counts are included in the accessible name.
- All shell text uses tokens; contrast verified (`tokens/contrast-report.md`).
- Tested with VoiceOver (iOS, Arabic voice), TalkBack (Arabic), NVDA (Arabic + English) before G1.

## 14. Open questions
1. Show unlicensed modules to non-admin users at all? (Current proposal: yes as "قريبًا" for commercial tenants; hidden for government.)
2. Arabic time axis direction in charts — validate in usability round 1.
3. Whether Line Managers want "تعلّمي" in the bottom bar instead of "فريقي".
4. Suite wordmark and module names await ENTLAQA brand guidelines.
