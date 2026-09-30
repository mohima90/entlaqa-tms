# ADR 0012 — AI provider abstraction and governance

**Status:** Draft · **Date:** 30 Sep 2026 · **Backlog:** T-M1-B12 · **Related:** BRD §6.23 (FR-AI-01…11, principles), FR-AI-10 (M, R2), FR-AI-11 (R3), FR-ASM-09/10, FR-RPT-09/10, FR-ADM-14, FR-SUB-01, FR-AUD-01/05, §12.2 (AI processing), §14.1, RK-6, Appendix H.1; Development Plan §8.3 (AI features); ADR 0002, ADR 0003, ADR 0004, ADR 0009, ADR 0010, ADR 0011

> Draft by design (Gate G1: "ADR 12 drafted"). AI features start in R2; this ADR fixes the guardrails now so that R1 code (actions, permissions, audit, data model) does not have to change later. It is finalized before the first R2 AI story.

## Context

- R2: learner assistant (FR-AI-02), recommendations (FR-AI-04), content generation (FR-AI-05) and the **AI governance console** (FR-AI-10: toggles, provider/model per feature incl. sovereign Arabic model and in-region endpoints, BYOK, budgets, usage log, knowledge base). R3: Ops Agent (FR-AI-01), schedule optimizer, comment analysis, narratives, **MCP server** (FR-AI-11).
- BRD principles: opt-in per tenant; outputs labeled; data-changing actions need explicit human confirmation; every call logged (feature, model, tokens, cost, user); tenant data never used to train third-party models; AI respects role permissions and data scope; no cross-tenant retrieval.
- Sovereign tenants require in-country inference endpoints (FR-DEP-03).

## Options considered

1. **Single provider SDK called from features** — simplest; locks features to one vendor; no sovereign path.
2. **Hosted AI gateway service** (vendor gateway) — routing/caching features, but a non-sovereign dependency in the critical path.
3. **Own provider abstraction in `platform-ai`** with adapters, policy and metering in-app (an open-source multi-provider SDK such as the AI SDK core may be used inside adapters; no hosted gateway) — chosen.

## Decision (draft)

### 1. Provider abstraction (`packages/platform-ai`)
- Interface: `generateText`, `generateObject` (zod-validated structured output), `streamText`, `embed`, with tool-calling support; every call takes `{ tenantId, featureKey, actor, purpose }`.
- Adapters: **Anthropic (default)** via the Anthropic API or in-region cloud endpoints where the model is offered (e.g., AWS Bedrock / Google Vertex AI regions — verify per region and model); **OpenAI** (incl. Azure OpenAI regional deployments — verify); **sovereign Arabic models** (e.g., Jais in the UAE; KSA options such as ALLaM — verify availability, licence and hosting); **OpenAI-compatible endpoint** adapter for self-hosted open-weights models (e.g., served with vLLM in-country). Embeddings are a separately configurable provider/model.
- Model catalog as versioned configuration: provider, model id, regions, data-processing terms (no-training, retention), capabilities (tools, JSON, context size, Arabic quality score from §8), price table.

### 2. Tenant policy, toggles, budgets
- `platform.ai_settings` per tenant: global switch (default **off**), per-feature toggles, residency policy (`regional` / `in_country` / `byok`) derived from the tenant's data-residency label, allowed providers/models per feature, BYOK credentials (envelope-encrypted, ADR 0010), monthly budget cap and alert thresholds (50/75/90/100 %), per-user rate limits.
- Routing enforces residency: a sovereign tenant can never be routed to a non-approved region, even on fallback. Fallback providers must satisfy the same policy.
- Budgets: estimate before the call, reserve, reconcile with actual tokens after; hard stop at 100 % unless the edition allows overage; usage appears on the admin home (FR-ADM-14) and in metering (SUB-01).
- Consent where required (FR-AUD-05, e.g., AI processing of personal data or transcription) checked before calls.

### 3. Retrieval (RAG) with strict tenant isolation
- Knowledge store in PostgreSQL with `pgvector`: `platform.ai_documents` / `platform.ai_chunks` (tenant_id, source type/id, visibility/ACL attributes, embedding model id, `vector` column with HNSW index), same RLS pattern as every table (ADR 0002).
- Retrieval runs **inside `withUserTx` with the requesting user's claims**, plus the permission/scope predicates of the source type (`scopeFilter`), so the assistant sees only what the user could open in the UI. No shared or cross-tenant index; no "global" knowledge except ENTLAQA-curated public help content in a separate global table.
- Indexed sources: tenant knowledge base (policies, FAQs), catalog and session descriptions. Personal records (enrollments, certificates, compliance) are **not embedded**; they are fetched through read tools with permissions.
- Chunks carry the embedding model id; changing the model re-embeds asynchronously (jobs, ADR 0005). Source deletion removes chunks (event-driven).

### 4. Tools and actions (Ops Agent, MCP)
- AI tools are derived from the `defineAction` registry: an action opts in with `ai: { description_ar, description_en, mode: 'read' | 'propose' }`. The tool list offered to a model is filtered by the current user's effective grants — the model never sees tools the user cannot use.
- `read` tools execute directly with the user's context. Mutating tools only produce a **plan** (proposed actions with a preview/diff); execution requires explicit **human confirmation** in the UI, then runs through the normal `defineAction` path (permission, scope, AAL2, separation of duties, validation). Audit entries are tagged `ai_assisted = true` with the confirming user (FR-AI-01 acceptance criteria).
- **Undo:** mutating actions exposed to AI must declare a compensating action; the Ops Agent records `platform.ai_agent_runs` / `ai_agent_actions` and offers undo of a confirmed plan within 24 h if no dependent actions occurred.
- **MCP server (R3):** `/api/mcp` (Streamable HTTP transport) exposing the same registry; OAuth 2.1 authorization-code + PKCE per the MCP authorization spec (verify spec version at implementation) with user-delegated, scoped tokens; mutating tools require a two-step `propose` → `confirm` with a single-use confirmation token, and tenant admins control which tools and scopes are exposed. Delegated MCP/API tokens are not GoTrue sessions, so their database claims need the additional claim kind proposed in ADR 0011 §4 (extension of ADR 0002 §6a).

### 5. Prompt-injection and output defenses
- System prompts and tool definitions are fixed server-side, versioned in the repo, never tenant-editable (tenants configure tone/formality through parameters).
- Retrieved content and tool outputs are wrapped and labeled as untrusted data; instructions inside them are never followed for tool selection; no tool performs arbitrary outbound HTTP or reads arbitrary URLs.
- Output handling: structured outputs validated by zod; rendered markdown is sanitized with **no remote images or auto-loaded links** (prevents exfiltration via URLs); AI output is labeled in the UI; content generation passes a review gate before publishing (FR-AI-05, FR-ASM-10).
- Data minimization in prompts (IDs and needed fields only); secrets never in prompts.
- Red-team suite in Arabic (MSA and Gulf/Egyptian dialect) and English: injection via course descriptions, uploaded materials, names, chat; cross-tenant and out-of-scope retrieval attempts (Plan §8.3).

### 6. Logging and retention
- `platform.ai_interactions`: tenant, user (actor), feature, provider, model, region, tokens in/out, cost, latency, status, tool calls, plan confirmation id, safety flags. Prompts and outputs stored **encrypted**, per tenant retention (BRD §12.2), readable only by roles with AI-log permission (Auditor view in Appendix B) — never in operational logs (ADR 0009).
- Metrics: cost per tenant/feature, error rates, budget anomalies (NFR-OBS-02).

### 7. No training on customer data
Only providers/contracts that contractually exclude training on API inputs/outputs are allowed (verify terms per provider; prefer zero-data-retention options where offered); listed as sub-processors; BYOK tenants are informed that their own provider terms apply. ENTLAQA does not fine-tune shared models on tenant data; any tenant-specific tuning would be opt-in, tenant-isolated and contractually agreed (out of scope for R2).

### 8. Evaluation suite
- Per feature: golden datasets in Arabic and English (catalog Q&A, policy questions, schedule requests, content drafting), rubric-based and reference-based metrics (task success, groundedness/citation correctness, refusal correctness, Arabic language quality scored by reviewers, injection resistance, latency, cost).
- Runs on every change of prompt, model, provider or retrieval settings; results gate enabling a model for a feature (including each sovereign model) and are recorded in the model catalog.

## Consequences

**Positive:** vendor- and region-neutral; permissions, audit and undo reuse the existing action model; sovereign tenants get in-country inference by policy, not by code fork.

**Negative / costs:** adapter maintenance across providers; Arabic evaluation needs curated datasets and human reviewers; budget reservation adds latency; sovereign model quality may lag (feature availability may differ per tenant).

## Security impact
Implements Plan §8.3 "AI features": permission-bounded tools, human confirmation, no cross-tenant retrieval (RLS + user claims), injection defenses, output filtering, full logging, red-team tests. Main residual risk: indirect prompt injection influencing *proposals* — mitigated because nothing mutates without confirmation and the preview shows exact changes.

## Sovereign deployment impact
In-country endpoints (regional cloud offerings or self-hosted open-weights models) selected by tenant policy; embeddings and vector search run in the in-country PostgreSQL; no hosted gateway.

## Suite impact
`platform-ai` and the governance console are shared by all suite modules; each module contributes tools through its `defineAction` registry and knowledge sources through events.

## Verification
1. Unit tests: routing never violates residency policy (including fallback); budget stop at cap.
2. RLS/pgTAP tests on AI tables; retrieval tests proving out-of-scope and cross-tenant chunks are never returned.
3. Tool-filter tests per default role; confirmation required for every mutating tool; undo within 24 h.
4. Nightly evaluation + red-team runs; release gate on regressions.

## Open points (to close before R2)
Default embedding model for Arabic; sovereign model shortlist per country; AI credit pricing (§14.2); whether FR-AI-02 over WhatsApp is allowed for sovereign tenants.
