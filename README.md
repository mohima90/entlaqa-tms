# Jadarat TMS

Arabic-first, multi-tenant **Training Management System** by **ENTLAQA** — the first module of the planned **Jadarat HR Suite**, also available standalone, with open integration to Jadarat LMS and other LMSs.

> **Status:** Planning complete; development starts with Milestone M0/M1. This repository currently contains documentation only.

## Documents

| Document | Purpose |
|---|---|
| [Project status](docs/delivery/STATUS.md) | Current phase, milestones, decisions, next actions |
| [Development Plan & Delivery Guide](docs/delivery/Jadarat_TMS_Development_Plan.md) | How we build: quality bars, milestones, quality gates, security and UX programs |
| [Business Requirements Document v2.1](docs/brd/Jadarat_TMS_BRD_v2.md) | What we build: requirements, releases, architecture guidance |
| [Feature List](docs/brd/TMS_Feature_List.md) | 289 features with tier, release and scope decisions |
| [Market & Regulatory Research](docs/research/TMS_Market_Comparison_vs_BRD.md) | Competitors, best practices, regulatory fact-check |
| [CLAUDE.md](CLAUDE.md) | Working rules for Claude Code sessions |

## Planned stack

Next.js (App Router, TypeScript) · Supabase (PostgreSQL, self-hostable) · Tailwind CSS + shadcn/ui (RTL-first) · next-intl (Arabic default) · deployable to regional cloud and in-country (KSA/UAE).
