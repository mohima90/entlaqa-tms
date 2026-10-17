# How to start — a Claude account picking up a work package

> For every Claude session that joins the work, in particular a **second Claude account** working in parallel (PO decision «Work organized by role», 17 Oct 2026). Short on purpose: the rules themselves live in `CLAUDE.md` and the Development Plan; this page says what to read, how to take a work package without colliding with the other account, and how to hand it back.

---

## 1. Read first (in this order)

1. **`CLAUDE.md`** — the project, the non-negotiables, the PO's working rules.
2. **`docs/delivery/STATUS.md` → «Current state by role»** (top of the file): where each role stands, the next three actions, what waits on the PO. Then the latest rows of the **Decisions log** (§2) — never ask the PO something already decided there.
3. **`docs/delivery/ROADMAP-by-role.md`** — §1 summary, §5 order of the work packages, and the row of the WP you take (§4: goal, features, flow, dependencies, code areas, migration range).
4. **`docs/delivery/BACKLOG.md`** — your WP's section: its tasks, their history and notes.
5. **The WP's business flow** in `docs/business-flows/` — it must say **Agreed (PO, <date>)** before you build. Also the BRD requirements it names (`docs/brd/Jadarat_TMS_BRD_v2.md`, FR-* IDs).
6. **Kawadir first:** `docs/design/kawadir-alignment.md`, then how Kawadir ATS (`ENTLAQA-UAE/kawadir-ats`) does the same thing **in its code** — copy it, with the Jadarat palette by default.
7. **How we build:** `docs/engineering/README.md` (running the gates), `docs/architecture/migration-conventions.md`, Development Plan §4.2 (Definition of Done) and §2.4 (lighter process).

## 2. What a work package is

- **One WP = one complete feature area = one branch = one PR.** Its features, dependencies and code areas are in the roadmap (§4).
- A WP that needs a business flow starts with the task «Business flow agreed with the PO»; nothing else in it starts before the PO agrees.
- **No screen approval** (PO, 17 Oct 2026): once the flow is agreed, build the screens directly in the Kawadir layout; the PO sees them in the product.

## 3. Pick and claim a WP

1. **Which one:** the first WP in roadmap §5 that is **unclaimed**, whose **flow is Agreed** (or needs none) and whose **dependencies are merged**. If none is ready, take the next WP whose flow is *not written* and write that flow (template `docs/business-flows/README.md`) — then bring it to the PO.
2. **Is it free?** The branch name is the lock. Run `git fetch origin` and `git ls-remote --heads origin 'claude/wp-*'`: a WP with a branch is taken. Also check the «Claimed by» cells on `origin/main`.
3. **Claim it — as your first commit, on its own branch:**
   - `git switch -c claude/<wp-id>-<short> origin/main` — lower case, e.g. `claude/wp-adm-02-branding`;
   - write your session / account name and the date in the WP's **«Claimed by»** cell in `ROADMAP-by-role.md` §4 **and** on its **«Claimed by:»** line in `BACKLOG.md`; set its first task to 🔵;
   - commit only that (`docs(backlog): claim WP-ADM-02`) and push the branch;
   - run `git ls-remote --heads origin 'claude/wp-*'` again: if another branch for the same WP appeared first, delete yours and pick another WP.
4. Tell the PO in one plain line which WP you took and what it will give them.

## 4. Branch and migration rules

- Work only on your WP branch. **Never push to `main`, never force-push a shared branch, never merge a PR** — the PO merges.
- **Merge `origin/main` into your branch often** (at the start of every session and right before the PR), then re-run the gates.
- Commit messages: conventional commits naming the WP and the requirement IDs, e.g. `feat(branding): logo and colours (WP-ADM-02, FR-ADM-07)`, ending with the attribution lines of your session.
- **Migrations — only in your WP's reserved range** (roadmap §4, column «Migrations»). Example: WP-ADM-01 owns `202610221xxxxx` = 22 Oct 2026, 10:00:00–19:59:59 UTC, so its files are named `20261022100000_<schema>__<description>.sql`, `20261022100100_…`. Use valid times only (minutes and seconds below 60). Need more room or a new WP? The tech lead adds a range in the roadmap first.
- The ranges only stop two accounts from picking the same timestamp. On `main`, timestamps must keep increasing (`migration-conventions.md`): **before your PR, if `main` already holds a migration later than yours, rename yours (`git mv`) to follow `main`'s newest one, keeping their order**, and re-run the database gates.
- Never edit a migration that is on `main` — it is already live (automatic DB deploy after every merge). Write migrations **expand-first**: the app and the database deploy in parallel.
- Every new table: RLS and a cross-tenant pgTAP test; pass `pnpm db:test` **and** `pnpm db:test:hosted-sim` (hosted `postgres` is not a superuser).

## 5. Shared files — small additive edits only

Both accounts touch these files. Keep each edit small and additive, never reorder or reformat them, and merge `origin/main` often so conflicts stay tiny.

| Shared file / area | Etiquette |
|---|---|
| i18n messages `packages/platform-i18n/messages/en.json` and `ar.json` | Add your keys under **your own namespace** (one new top-level key for your area); English first (default language), Arabic from `docs/design/content/glossary-ar-en.md` and the content style guide — no machine translation; never rename others' keys |
| Permission catalogue | New permissions only through a migration in **your** range (pattern `platform__add_<area>_permissions`) plus the code catalogue (`modules/tms/src/permissions.ts`, `packages/platform-rbac/src/`); append, never renumber or rename; grants to standard roles in the same migration; deny by default |
| Navigation `apps/suite/src/lib/suite-navigation.ts` | Add your entry in one place; turn a «Coming soon» (`soon(...)`) entry into a page only for your own WP |
| Test fixtures: `supabase/tests/` (pgTAP), `apps/suite/e2e/` helpers (`sign-in.ts`, `tables.ts`), `infra/docker/seed-users.sql` | Create your own files with your area in the name (e.g. `99_branding_*.sql`, `branding.spec.ts`); add to shared helpers and seeds, never change what others rely on |
| `packages/ui` components | Add new components with stories (axe in Arabic/English × light/dark); change an existing component's API only when needed and mention it in your PR |
| `STATUS.md`, `BACKLOG.md`, `ROADMAP-by-role.md` | Change only your WP's rows, your role's line in «Current state by role» and one session-log line; on a merge conflict keep **both** sides' lines |

## 6. Working with the PO (from `CLAUDE.md`)

- **Plain, short language** — what was done, what it means for them, the one thing needed from them. Show progress with screenshots or side-by-side comparisons rather than descriptions.
- **One action per message** (exact click / field), then wait for «done».
- For every value the PO must enter, say up front whether it is **secret** or **config**; never ask for keys or passwords in chat.
- **Business flow first**: no screens and no code before the flow is agreed and recorded in STATUS.
- **Kawadir first**; product settings live inside the product, never as GitHub / Vercel / Supabase configuration.
- **No screen approvals** any more; the PO looks at the product.
- **The PO says «yes» before each PR**, and **the PO merges**. Do what you can yourself (GitHub workflows, reading their logs); the PO only does what needs their accounts.
- The PO talks to each session separately: check the decisions log first, and do not repeat a question the other account already asked.

## 7. Done and hand back

1. **Definition of Done** (Development Plan §4.2): RLS and authorization-negative tests, Arabic + English E2E, accessibility checks, audit events. Full gates green: `pnpm check:all`, `pnpm check:licenses`, `pnpm db:test`, `pnpm db:test:hosted-sim`, `pnpm test:integration`, `pnpm build`, E2E (`pnpm --filter @jadarat/suite e2e`). Never skip or weaken a test or gate.
2. **One independent review** of the PR (a separate sub-agent), plus a **security review** when the change touches access, data scope, secrets or sign-in; fix Critical/High findings and get a confirmation look.
3. **Update the docs** on your branch: roadmap §3 statuses and §1 counts, your WP's «Claimed by» → «PR #NN»; BACKLOG task statuses and notes; STATUS «Current state by role» line, a session-log row, decisions with their date. The Stop hook checks that `STATUS.md` changed.
4. **Ask the PO for a «yes»** in plain language (what the PR gives them, what to try). After the yes, open the PR with the template (`.github/pull_request_template.md`, Development Plan Appendix B), ending with your session's attribution.
5. After the PO merges: check the **DB deploy (after merge)** run (`db-deploy-auto.yml`) and tell the PO the result; set «Claimed by» to «merged #NN».
6. **Stopping midway** (session limit): commit your work to the WP branch and push it, and write the resume point in your task's notes — the next session (or the other account, if the PO asks) continues from there.
