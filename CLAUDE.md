# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Growth MVP (v2.0) is a Next.js-based strategic planning platform designed to guide companies through a multi-stage growth strategy development process. The application uses AI to generate strategic insights and support business planning across six stages (STAGE0-6).

**Key Tech Stack:**
- Next.js 15 with App Router
- TypeScript (strict mode)
- Tailwind CSS + Radix UI
- Supabase (auth & PostgreSQL database)
- OpenAI API (gpt-4o series)
- Zustand for state management
- Vercel deployment

## Quick Start Commands

```bash
# Development
npm run dev              # Start dev server on :3000
npm run dev:3001        # Alternative ports for parallel instances
npm run dev:lan         # LAN-accessible server (0.0.0.0)

# Build & Deploy
npm run build           # Build (runs model config validation first)
npm run start           # Serve production build
npm run type-check      # Run TypeScript check without emit

# Code Quality
npm lint               # ESLint check (ignores build errors in next.config.js)

# Testing & Diagnostics
npm run stage3:smoke           # STAGE3 smoke test
npm run rbac:check             # RBAC rule validation
npm run rbac:e2e:min           # RBAC end-to-end minimal test

# Playwright E2E tests exist (see package.json devDependencies)
```

## Architecture & Directory Structure

### Core Directories

```
/app                   # Next.js app router (pages and API routes)
  ├── /api             # API endpoints (see API Pattern below)
  │   ├── /stage[0-6]/  # Stage-specific routes
  │   ├── /generate-*  # AI generation routes
  │   └── /org-alignment/  # Org alignment features
  ├── /stage[0-6]/      # Stage UI pages
  ├── /report/          # Report/export pages
  └── layout.tsx        # Root layout with auth

/components            # React components
  ├── /pages/          # Page-level component compositions
  ├── /org-alignment/  # Org transformation UI
  ├── /org-transformation/  # Related to org change
  ├── /stage2/         # STAGE2-specific components
  └── /ui/             # Reusable UI primitives

/lib                   # Shared utilities and services
  ├── modelConfig.ts   # OpenAI model & process config (JSON-driven)
  ├── authUtils.ts     # JWT verification & auth helpers
  ├── rbac.ts          # Role-based access control
  ├── inputGuardLogger.ts  # Security: suspicious keyword detection
  ├── /supabase/       # Supabase client & server utilities
  ├── /server/         # Server-only utilities (auth guard, audit logs)
  ├── /rag/            # RAG (retrieval-augmented generation) utilities
  └── /utils/          # General utilities (dates, formatting, etc.)

/store                 # Zustand state management stores
  ├── strategyStore.ts  # Core strategy state (answers12, mvv, swot, etc.)
  ├── storyStore.ts     # Story/narrative state
  ├── userStore.ts      # User & company context
  └── ...               # Other domain stores

/hooks                 # Custom React hooks
  ├── useStage[0-4]PdfExport.ts  # Stage-specific PDF export
  ├── useAutoSave.ts    # Auto-save to localStorage + Supabase
  └── ...               # Other domain hooks

/types                 # TypeScript type definitions
  └── strategy.ts       # Core strategy types (Stage2Answer, Stage2State, OKR, etc.)

/utils                 # Client utilities
  ├── /persist/        # Save/restore with audit trails
  ├── /supabase/       # Supabase data access (CRUD)
  ├── stageSnapshot.ts  # localStorage snapshot management
  └── ...

/config                # Configuration files
  └── models.json       # AI model definitions & process configs (used by modelConfig.ts)

/scripts               # Build & CI scripts
  ├── validate-models.mjs  # Check models.json format before build
  └── ...
```

### Key Type Definitions (`/types/strategy.ts`)

The entire data model is defined in a single file with extensive comments on backward compatibility:

- **`Stage2Answer`**: Represents a single response to one of 12 strategic questions
  - `id`: Question ID (e.g., 'ch0-q1', 'ch1-q1', etc.)
  - `question?`, `answer?`, `required?`: Question text, user answer, required flag
  - Future: `deepDive?` field for multi-turn questioning (currently being implemented)

- **`Stage2State`**: Complete STAGE2 state including all 12 answers
  - `answers12?`: Array of 12 `Stage2Answer` (fixed length, index-based)
  - `mvv`: Mission/Vision/Value section
  - `swot`: Strengths/Weaknesses/Opportunities/Threats
  - `storyDraft?`, `finalStory?`: Generated narratives in 4-chapter format

- **`OKR`** (evolving): Objectives & Key Results with strategy extensions
  - `track?`: 'EVOLVE' (optimize existing) vs 'EXPLORE' (new initiatives)
  - `hypothesis?`, `probability?`, `impact?`: Strategic reasoning

## STAGE System (Multi-Stage Planning)

The app guides users through 6 stages of strategic planning:

- **STAGE0**: User onboarding & company context
- **STAGE1**: Issue/metric analysis (financial data, key problems)
- **STAGE2**: Strategic questions (12-question framework for strategy clarity)
  - Includes Draft generation (AI outline) and Final generation (polished narrative)
  - **Current work**: Adding AI deep-dive questions to 4 specific questions
- **STAGE3**: Strategic bridge (connect strategy to execution)
- **STAGE4**: OKRs & quarterly execution
- **STAGE5**: Monthly reporting (not yet fully implemented)
- **STAGE6**: Complex scenario planning & financial simulation

## State Management Pattern

**Zustand stores** (`/store/strategyStore.ts` is the main one):
- Stores loaded when needed, persisted to Supabase & localStorage
- **localStorage snapshots** (`stageSnapshot.ts`): Lightweight snapshots for offline editing
- **Supabase**: Full persistent storage via `getFullStrategyDataByCompany()`
- **Auto-save**: `useAutoSave()` hook syncs changes back to Supabase

Critical: **answers12 maintains fixed array length (12) and index order** — do not add/remove elements from this array, only mutate values within existing slots.

## API Pattern (Server-Side AI & Data Routes)

All API routes follow a consistent pattern:

```
/app/api/<domain>/<feature>/route.ts
```

**Common imports & patterns:**
```typescript
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Adjust as needed

// 1. Auth guard
const userId = await getAuthUserIdFromBearer(req);
if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

// 2. RBAC check (if needed)
await requireMembership(userId, companyId);
await assertMinRole(userId, companyId, 'MEMBER'); // ADMIN, MEMBER, VIEWER

// 3. Zod schema validation
const body = InputSchema.parse(await req.json());

// 4. Call OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const params = getOpenAIModelParamsForProcess('draft_story'); // Key-based config
const response = await openai.chat.completions.create({
  ...params,
  messages: [...]
});

// 5. Audit log (recommended)
await logAuditEvent(userId, 'GENERATE_DRAFT', { companyId, ... });

// 6. Return JSON
return NextResponse.json({ result: ... });
```

**Model configuration** is loaded from `/config/models.json` (not hardcoded):
- Defines `ai_models.reasoning`, `ai_models.lightweight`, and `process_configs`
- `getOpenAIModelParamsForProcess(processKey)` builds OpenAI params with correct model, token limits, reasoning_effort, etc.
- Supports gpt-5.6-* (Luna) with automatic reasoning_effort handling

**STAGE2 AI routes:**
- `POST /api/stage2/generate-draft` — Creates story outline from answers
- `POST /api/stage2/generate-final` — Polishes draft into final narrative
- **New (in progress)**: `POST /api/stage2/deep-dive` — Single follow-up question for 4 target questions

## Database Schema (Supabase)

The main table for strategic data is `growth_strategies` (JSONB storage):
- Stores strategy state per company
- Uses JSONB for flexibility (no strict schema migrations)
- `answers12` is a 12-element JSONB array, indexed by position
- Scripts/routes access via `utils/supabase/strategy.ts`

**Important:** No schema migrations planned for deep-dive feature (Version 1). The `deepDive` field will be added as an optional sub-object within each `Stage2Answer`.

## Auth & RBAC

- **Auth**: Supabase Auth (JWT tokens) with magic link & OAuth support
- **Headers**: All API calls require `Authorization: Bearer <token>`
- **RBAC levels**: ADMIN > MEMBER > VIEWER (defined in roles table)
- **Guards**: `getAuthUserIdFromBearer()` verifies JWT, `requireMembership()` checks company access

## Security Best Practices

1. **Input validation**: Use Zod schemas in all API routes
2. **Keyword detection**: `checkSuspiciousKeywords()` flags prompt injection attempts
3. **Audit logging**: Log sensitive operations with `logAuditEvent()`
4. **Server-only code**: Mark utility files with `'use server'` / `'server-only'` as appropriate
5. **CSP headers**: Set in `next.config.js` (allows OpenAI, Supabase, Stripe APIs)

## Common Dev Tasks

### Adding a new API route

1. Create `/app/api/<domain>/<feature>/route.ts`
2. Import auth guards and Zod
3. Validate input, check auth, call OpenAI if needed
4. Log audit event
5. Return JSON response with proper status codes

### Updating STAGE2 types or questions

1. Modify `TEMPLATE12` in `/app/stage2/page.tsx` (12-question template)
2. Update types in `/types/strategy.ts` if changing `Stage2Answer` or `Stage2State`
3. Ensure `answers12` array length stays at 12 (immutable)
4. Test with `/npm run stage3:smoke` to validate downstream stages

### Saving data to Supabase

Use `updateAnswer12(id, updates)` from `strategyStore.ts` which calls the Supabase utility:
```typescript
await updateAnswer12('ch0-q1', {
  answer: userInput,
  deepDive: { question: '...', answer: '...' } // optional new field
});
```

### Exporting to PDF

Use stage-specific hooks: `useStage2PdfExport()`, `useStage3PdfExport()`, etc.
These rely on `html2pdf.js` and component refs, called from report pages.

## Important Constraints & Non-Negotiables

1. **answers12 immutability**: Do NOT add/remove elements. Only mutate within existing 12 slots.
2. **Backward compatibility**: All new fields must be optional (`?`) to support existing saved data.
3. **No DB migrations**: Keep using JSONB; do not create new schema columns.
4. **Model config only via JSON**: Never hardcode model names or token limits in route code.
5. **AI responses in JSON**: Use consistent structured formats (Zod schema validates on return).

## Testing & Quality

- **ESLint**: Runs on CI; `next.config.js` ignores build-time errors for faster iteration
- **TypeScript**: Strict mode enabled; check with `npm run type-check` before committing
- **Playwright**: E2E tests exist but not enforced in scripts (manual testing common)
- **RBAC tests**: Run `npm run rbac:e2e:min` before major auth changes

## Deployment

- Hosted on Vercel
- Environment variables stored in Vercel project settings (OPENAI_API_KEY, DATABASE_URL, etc.)
- Automatic deployments on push to main
- `next.config.js` specifies 60-second max duration for API routes

## Debugging Tips

- **Check env vars**: `npm run diag/whoami` endpoint verifies auth & company context
- **localStorage snapshots**: Browser DevTools > Application > localStorage for stage snapshots
- **Supabase logs**: Check Supabase dashboard for database queries & RLS policy violations
- **OpenAI usage**: Monitor via OpenAI dashboard (watch for runaway costs on generate routes)
- **Audit logs**: Server-side logs stored in Supabase audit table for compliance review

## Git Workflow

- Main branch: Production code (auto-deploys to Vercel)
- Feature branches: Create from `main`, squash-merge on completion
- Commit messages: Include issue/feature context (e.g., "feat: add deep-dive questions for STAGE2")
