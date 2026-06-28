# Security & Non-Functional Requirements Classification
## growth-mvp v0.2.0 — PoC Essential vs. Deferrable

**Analysis Date**: 2026-06-28  
**Base Documents**: 08-security-review.md, 09-non-functional-requirements.md  
**Current Branch**: main (commit 34e494b)

---

## COMPLETED ✅

| Finding | Status | Evidence |
|---------|--------|----------|
| **F-1** | ✅ COMPLETED | `utils/ai.ts` removed; no `NEXT_PUBLIC_OPENAI_API_KEY` references in codebase |
| **F-2 (partial)** | ✅ 1 of 8 COMPLETED | `/api/stage5/assist-execution` has `requireMembership()` guard (commit 34e494b: "add manager role checks for PoC security") |
| **F-1-3** | ✅ COMPLETED | Manager role checks added to `/api/stage2/generate-final` and `/api/stage3/generate-strategy-bridge` (commit 34e494b) |
| **G-1 through G-7** | ✅ MAINTAINED | All green findings verified (invitation hashing, Cookie security, admin protection, RBAC guard, AI tenant isolation) |

---

## POC_ESSENTIAL — High Risk / Critical Blockers

### 🔴 **F-8: Data Protection / RLS Verification & Implementation**

| Attribute | Value |
|-----------|-------|
| **Severity** | CRITICAL |
| **Current Status** | ⚠️ Partially prepared / On hold pending PoC |
| **Work Type** | Investigation + Schema migration + Test validation |
| **Estimated Effort** | 3–4 hours investigation + 2 hours migration + 3 hours testing = **8 hours / 1 day** |
| **Risk if Deferred** | **CRITICAL** — If RLS broken on even one core table (companies, company_members, strategy_data, okrs, progress_logs, profiles), **all tenant-isolation claims are void**. Company A users can read/modify/delete Company B data |
| **Details** | • Core tables (companies, company_members, strategy_data, okrs, progress_logs, profiles, org_alignment_*) have **no CREATE TABLE migrations in repo** (only org_alignment + invites have RLS migrations)  <br/>• Client makes **134+ direct `.from()` calls** to these tables from browser (anon Supabase key)  <br/>• RLS is **sole barrier to cross-tenant access**; definition unavailable in Git → unconfirmed  <br/>• **Migration on hold** (20260628_fix_strategy_data_rls_role_control.sql) due to STAGE4 data conflicts  <br/>• **Must test before PoC**: Company A user cannot select/update/delete Company B data; member cannot write strategy_data |
| **PoC Blocker** | YES — **Must verify RLS active & correct before external PoC** |
| **Next Step** | 1. **Verify** RLS enabled on all core tables (Supabase SQL: `select relrowsecurity from pg_class where relname = 'X'`)  <br/>2. **Confirm** all RLS policies exist & company_id constraints present  <br/>3. **Run tenant-crossing tests** (see §13 A-5)  <br/>4. **Decide**: Apply strategy_data role migration or defer (depends on STAGE4 data scope) |

---

### 🟠 **F-2: Remaining 6 Unauthenticated APIs (of 8)**

| Attribute | Value |
|-----------|-------|
| **Severity** | HIGH |
| **Current Status** | 2 of 8 authenticated; **6 still unguarded** |
| **Work Type** | Code fix (add `getAuthUserIdFromBearer` + `requireMembership`) |
| **Estimated Effort** | **2 hours** (5–10 min per endpoint + testing) |
| **Risk if Deferred** | HIGH — Anonymous users can burn OpenAI quota, DoS generation APIs, create arbitrary knowledge entries |
| **Endpoints Remaining** | `/api/generate-question`, `/api/generate-insight`, `/api/generate-department-summary`, `/api/okr-from-exec`, `/api/recommend-top-patterns`, `/api/recommend-exec-patterns`, `/api/knowledge` |
| **Pattern to Apply** | ```ts export async function POST(req: Request) { const { userId, companyId } = await getAuthUserIdFromBearer(req, 'Authorization'); const error = requireMembership(userId, companyId); if (error) return NextResponse.json(error, { status: 401 }); // ... ``` |
| **PoC Blocker** | YES — Public PoC demo = immediate abuse surface |

---

### 🟠 **F-3: Rate Limiting (Absent)**

| Attribute | Value |
|-----------|-------|
| **Severity** | HIGH |
| **Current Status** | Not implemented |
| **Work Type** | Infrastructure + code (edge middleware or Redis) |
| **Estimated Effort** | **2–4 hours** (Vercel WAF config: 1h; Upstash Redis: 3h) |
| **Risk if Deferred** | HIGH — Uncontrolled OpenAI calls → cost spirals (could hit $1000+/day). DoS targets: `/api/generate-*`, `/api/invites/accept` (token brute-force baseline), `/api/companies/provision` (account spam) |
| **Implementation Options** | 1. **Vercel WAF** (simplest): 1–2 IP-based rules via dashboard  <br/>2. **Upstash Redis** + middleware: `@upstash/ratelimit` + per-user daily quota (e.g., 50 generations/day)  <br/>3. **Hybrid**: WAF for IP/endpoint baseline + Redis for user quota |
| **PoC Baseline** | Generation APIs: **10 req/min per IP, 50/day per user**; auth endpoints: **5 failures/10min**; provision: **1/min per IP** |
| **PoC Blocker** | YES — Without limits, cost liability is unbounded |

---

### 🟠 **F-9: Audit Logs (Missing / Non-Persistent)**

| Attribute | Value |
|-----------|-------|
| **Severity** | HIGH |
| **Current Status** | `saveWithAudit` = console.log only (no DB). No audit trail for role changes, deletions, invites |
| **Work Type** | Schema (new table) + server-side logging |
| **Estimated Effort** | **4–6 hours** (migration 1h, service layer 2h, integrate into 10+ endpoints 2h, test 1h) |
| **Risk if Deferred** | HIGH — No trail for unauthorized changes/deletions. Fails IPA "audit logging" requirement. Cannot prove/disprove "who deleted data" in incident |
| **Schema** | `audit_logs` (append-only, Service Role write): `id, company_id, actor_user_id, action, target, before_json, after_json, ip, user_agent, created_at` |
| **Critical Actions to Log** | Auth login (failures), role changes, invite issue/accept, member add/delete, strategy/department/project delete, data export |
| **PoC Blocker** | MEDIUM-HIGH — ISO/compliance-sensitive customers will ask; PoC won't be blocked but trust decreases |
| **Implementation Path** | 1. Create `audit_logs` migration  <br/>2. Build `logAuditEvent(action, target, before, after)` helper (server-side)  <br/>3. Call in `members/role`, `invites/*`, `cascade/cleanup` paths  <br/>4. Integrate `agent_logs` write to use helper (not client anon) |

---

### 🟠 **F-10: Dependency Vulnerabilities (51 total)**

| Attribute | Value |
|-----------|-------|
| **Severity** | HIGH |
| **Current Status** | `npm audit` (2026-06-24): 51 issues (critical 2, high 30, moderate 15, low 4) |
| **Work Type** | Dependency update + testing |
| **Estimated Effort** | **1–2 hours** (run `npm audit fix`, test smoke, resolve conflicts) |
| **Risk if Deferred** | MEDIUM-HIGH — Known exploits for `@ai-sdk`, `next`, `tar`, `undici`, `yaml`. `xlsx` has no fix (ReDoS/Prototype Pollution) → must document risk |
| **Fixable via `npm audit fix`** | **15 non-breaking issues** → ~80% of high/critical can be resolved |
| **Force-only (Breaking)** | 9 issues require `npm audit fix --force` (may break transitive deps) |
| **No Fix Available** | `xlsx` (high: ReDoS + Prototype Pollution) → risk: trust only validated Excel files |
| **Action** | 1. Run `npm audit fix` (non-breaking)  <br/>2. Test smoke scripts  <br/>3. Resolve conflicts for remaining high issues  <br/>4. Document `xlsx` risk / consider `exceljs` replacement  <br/>5. Update `next` to latest patch |
| **PoC Blocker** | YES — Public demo with known critical vulnerabilities = liability |

---

### 🟡 **F-4: Build Configuration & Security Headers**

| Attribute | Value |
|-----------|-------|
| **Severity** | MEDIUM |
| **Current Status** | `next.config.js`: `ignoreBuildErrors: true`, `ignoreDuringBuilds: true`; **no security headers** |
| **Work Type** | Config (next.config.js) + CI setup |
| **Estimated Effort** | **2–3 hours** (headers config 1h, CI gates 1h, resolve type/lint 1h+) |
| **Risk if Deferred** | MEDIUM — Type/Lint errors hide bugs. Missing headers (CSP, HSTS, X-Frame-Options) enable clickjacking/XSS/MIME sniff attacks |
| **Immediate Actions** | 1. Add to `next.config.js` `async headers()`:  <br/>`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`  <br/>`X-Frame-Options: DENY`  <br/>`X-Content-Type-Options: nosniff`  <br/>`Referrer-Policy: strict-origin-when-cross-origin`  <br/>`Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.openai.com; ...`  <br/>2. Set `ignoreBuildErrors: false`, `ignoreDuringBuilds: false`  <br/>3. Fix errors or add CI gates (optional for PoC: allow override with `IGNORE_BUILD_ERRORS` env) |
| **PoC Blocker** | YES — Missing headers = OWASP Top 10 #5 (XSS), #9 (Clickjack) unmitigated |

---

### 🟡 **F-6: Unauthenticated Cookie Setting**

| Attribute | Value |
|-----------|-------|
| **Severity** | MEDIUM |
| **Current Status** | `/api/_session/set-cookie` + `/api/_session/set-company`: **no auth checks** |
| **Work Type** | Code fix (add `requireMembership` + Cookie whitelist) |
| **Estimated Effort** | **1 hour** |
| **Risk if Deferred** | MEDIUM — Anonymous can set arbitrary Cookies (CSRF foothold). Company selection Cookie tampering (mitigated by server re-auth, but defense-in-depth gap) |
| **Action** | 1. Add `requireMembership` guard to both endpoints  <br/>2. Whitelist Cookie names (e.g., `selected_company_id`, `ui_preferences` only; reject `Authorization` / `session`)  <br/>3. Validate `company_id` argument matches user's membership |
| **PoC Blocker** | MEDIUM — Can defer if server-side auth check is robust (which it is), but still a loose door |

---

## POC_AFTER — Deferrable (Can Do Post-Launch)

| Finding | Why Defer | Notes |
|---------|-----------|-------|
| **F-7** | Log masking/level control | Current logging exposes strategy/finance data. Low urgency if: (1) no real sensitive data in PoC, (2) Vercel logs not publicly accessible. Can implement in ops phase |
| **F-11** | AI/LLM security (prompt injection, output validation) | Main exploit surface (AI context & role scope) is **partially covered** by F-8 + existing tenant checks (G-6). Prompt injection & output validation refinement can iterate after PoC. Add to backlog |
| **Part of F-9** | Agent_logs client→server migration | `agent_logs` currently has client-side writes (anon). Post-PoC: migrate to server-side write to suppress data exposure. Deferrable if volume low |
| **Network resilience** | OpenAI fallback / graceful degradation | Only 6 of 11 generation APIs have 58s timeout. Unifying timeouts can happen post-launch (already tracked in [09] §1) |
| **CSRF validation** | Full Cookie/CSRF audit | F-6 guard addition should cover high-risk surface. Detailed CSRF test = phase D (dynamic testing) post-auth fixes |

---

## Non-Functional Requirements Classification

### § 1: Availability (可用性)

| Requirement | Status | PoC Action |
|-------------|--------|-----------|
| Backup/Restore procedure | ⚠️ Not confirmed (Supabase auto-backup assumed) | **A-0**: Verify Supabase daily backup enabled; document RTO/RPO; provide restore playbook |
| OpenAI graceful degradation | ⚠️ Partial (6/11 APIs have timeout) | **A-0.5**: Add 60s timeout + "AI unavailable" fallback to remaining 5 generation APIs |
| SLA / uptime targets | Not defined (OK for PoC) | PoC = best-effort; no contractual SLA |

---

### § 2: Performance / Scalability (性能・拡張性)

| Requirement | Status | PoC Action |
|-------------|--------|-----------|
| p95 latency for non-generation screens | No baseline | Measure via **D (dynamic testing)**; aim <3s |
| Generation API timeout | 6/11 implemented (58s) | Apply 60s + loading UI to all 11 |
| Concurrent user scaling | Assumed OK (Vercel autoscale) | Load test with 10 concurrent users post-auth fixes |
| Rate limiting | **❌ MISSING** | **ESSENTIAL**: Implement F-3 |
| `strategy_data` bloat optimization | Not critical for PoC (1–2 MB typical) | Defer; monitor in ops |

---

### § 3: Operability / Maintainability (運用・保守性)

| Requirement | Status | PoC Action |
|-------------|--------|-----------|
| CI (type check / lint / smoke) | ❌ No CI workflows | **B-1**: Build GitHub Actions: `tsc --noEmit && next lint && npm test` on PR |
| Error monitoring (Sentry, etc.) | ❌ Not integrated | **D-1**: Configure Sentry + Slack alerts (post-launch for PoC, or day-1) |
| Audit logging | ❌ Console-only | **A-7 / F-9**: Implement `audit_logs` table + logging |
| Log levels / masking | ⚠️ Excessive debug output | Defer; add `DEBUG=false` override for PoC |

---

### § 4: Migratability (移行性)

| Requirement | Status | PoC Action |
|-------------|--------|-----------|
| Core schema in migrations | ❌ companies, company_members, strategy_data, okrs, profiles **not in Git** | **A-5**: Extract + commit RLS-enabled migrations |
| Data export / import | ⚠️ Stage1 import works; export untested | Test CSV export; document deletion procedure |
| OKR dual-source cleanup | ⚠️ Phase 2A underway | Not critical for PoC; doc the state in `docs/phase2a/` |

---

### § 5: Security (セキュリティ)

See [08-security-review.md] §12–§13 and above **POC_ESSENTIAL** section.

**IPA 11-category status**:
- 🔴 Critical (F-1, F-8): **Must fix**
- 🟠 High (F-2, F-3, F-9, F-10): **Must fix**
- 🟡 Medium (F-4, F-5, F-6, F-7, F-11): **Strongly recommended** (F-4, F-5, F-6 are PoC blockers)

---

### § 6: System Environment / Ecology (システム環境・エコロジー)

| Requirement | Status | PoC Action |
|-------------|--------|-----------|
| OpenAI cost limits + alerts | ❌ Uncapped | **D-2**: Set monthly budget cap ($500?) + Slack alert at 80% |
| Data processing agreement (DPA) | ⚠️ Not prepared | **C-5**: Brief PoC customer on OpenAI data handling (no training / EU availability if needed) |
| Browser compatibility | Undefined | Document: Chrome/Edge/Safari latest 2 versions; define in `browserslist` |

---

## PoC-Essential Checklist (Prioritized)

### Phase A: Security Mandatory Fixes

```
[ ] A-0   : Verify Supabase backup + restore playbook
[ ] A-0.5 : Add 60s timeout + graceful degradation to 5 remaining generation APIs
[ ] A-1   : ✅ DONE — utils/ai.ts removed, NEXT_PUBLIC_OPENAI_API_KEY purged
[ ] A-2   : ⚠️ PARTIAL — Add requireMembership to 6 remaining APIs (generate-question, -insight, -department-summary, -okr-from-exec, -recommend-top-patterns, -recommend-exec-patterns, knowledge) [2h]
[ ] A-3   : Build CI gate for unauthenticated writes (fail if route lacks rbacGuard) [2h]
[ ] A-4   : Implement rate limiting (Vercel WAF or Upstash Redis) [2–4h]
[ ] A-5   : ⭐ CRITICAL — Verify RLS on all core tables; migrate strategy_data role control; run tenant-crossing tests [8h full-day]
[ ] A-6   : npm audit fix (non-breaking) + next update [1–2h]
[ ] A-7   : Create audit_logs table + logging for auth/role/delete/invite [4–6h]
```

### Phase B: Build & Multi-Layer Defense

```
[ ] B-1   : Enable tsc/lint in CI; set next.config ignoreBuildErrors=false [2–3h]
[ ] B-2   : Add security headers (CSP/HSTS/X-Frame-Options) [1h]
[ ] B-3   : Authenticate set-cookie endpoints + whitelist Cookie names [1h]
[ ] B-4   : PoC log level control (add DEBUG=false safety) [1h]
[ ] B-5   : Document xlsx risk; monitor Dependabot [30min]
```

### Phase C: Tenant Ops

```
[ ] C-1   : Provision isolated tenant for PoC customer
[ ] C-2   : Test invite flow (expiry / single-accept / revocation)
[ ] C-3   : Document backup, restore, data deletion procedures
[ ] C-4   : Obtain PoC NDA + data handling agreement
[ ] C-5   : Confirm OpenAI no-training + regional availability
```

### Phase D: Testing & Go/No-Go

```
[ ] D-1   : Setup error monitoring (Sentry, or basic) + alerts
[ ] D-2   : OpenAI cost dashboard + monthly budget cap
[ ] D-3   : Audit log sampling review (admin can access, read-only)
[ ] D-4   : Dynamic security test (auth bypass attempts, IDOR, rate-limit confirmation, IPA 11-category spot-checks)
[ ] D-5   : Main scenario E2E (Stage 1→6, org transform, invites)
```

### Go/No-Go Decision Criteria

**✅ Green to Launch PoC if**:
- [ ] A-1, A-2, A-4, A-5, A-6, A-7 **all complete**
- [ ] A-5 tenant-crossing test: **Company A cannot read/write Company B data** (actual test result)
- [ ] B-1, B-2, B-3 **complete**
- [ ] C-1, C-4, C-5 **complete**
- [ ] D-4 **spot-check passes** (no open 🔴 on IPA 11 categories)

**❌ Red flag (do not launch)**:
- RLS verification fails or unclear
- Any 🔴 critical finding (F-1, F-8) unclosed
- Rate limiting or audit logs still absent
- npm critical vulns not addressed

---

## Summary Table: Effort × Risk × Priority

| ID | Title | Type | Effort | Risk if Deferred | Blocking | Priority |
|----|-------|------|--------|------------------|----------|----------|
| A-0 | Backup/restore verify | Ops | 0.5h | Low | No | Medium |
| A-0.5 | Add timeout to generation APIs | Code | 1h | Medium | No | Medium |
| **A-2** | **Auth to 6 remaining APIs** | **Code fix** | **2h** | **HIGH** | **YES** | **1** |
| **A-3** | CI unauthenticated API gate | CI | **2h** | **MEDIUM** | **YES** | **2** |
| **A-4** | Rate limiting | Code + Config | **2–4h** | **HIGH** | **YES** | **1** |
| **A-5** | RLS verification + migration + test | Investigation + Schema + Test | **1 day** | **CRITICAL** | **YES** | **1 (FIRST)** |
| **A-6** | npm audit fix + next update | Dependency | **1–2h** | **HIGH** | **YES** | **2** |
| **A-7** | audit_logs table + logging | Schema + Code | **4–6h** | **HIGH** | **YES** | **2** |
| **B-1** | CI type/lint gates | CI | **2–3h** | **MEDIUM** | **YES** | **2** |
| **B-2** | Security headers | Config | **1h** | **MEDIUM** | **YES** | **3** |
| **B-3** | Authenticate set-cookie | Code fix | **1h** | **MEDIUM** | No | **3** |
| B-4 | PoC log level toggle | Config | 1h | Low | No | 4 |
| B-5 | Dependabot + xlsx doc | Docs | 0.5h | Low | No | 4 |
| F-7 | Log masking (full) | Code | 2–3h | Low | No | After-PoC |
| F-11 | AI/LLM security hardening | Code + Design | 3–4h | Medium | No | After-PoC |

---

## Execution Order for Next 3 Days

### Day 1 (Today – 6 hours)

1. **A-5 (first priority)**: RLS verification + tests
   - Connect to Supabase; run `select relrowsecurity from pg_class where relname = 'X'` for core tables
   - Confirm all RLS policies exist; review company_id filtering
   - **Test**: Use test accounts in Company A / B; attempt read/write cross-tenant → confirm reject
   - Decision: Can apply `20260628_fix_strategy_data_rls_role_control.sql` or defer (depends on STAGE4 data)

2. **A-6 (1–2 hours)**: npm audit fix
   ```bash
   npm audit fix  # non-breaking
   npm test # smoke test
   git commit -m "fix: npm audit non-breaking updates"
   ```

### Day 2 (6–8 hours)

3. **A-2 (2 hours)**: Add auth to 6 remaining APIs
   ```bash
   # For each of: generate-question, generate-insight, generate-department-summary, 
   #              okr-from-exec, recommend-top-patterns, recommend-exec-patterns, knowledge
   # Add at POST entry:
   const { userId, companyId } = await getAuthUserIdFromBearer(req, 'Authorization');
   const error = requireMembership(userId, companyId);
   if (error) return NextResponse.json(error, { status: 401 });
   ```

4. **A-4 (2–4 hours)**: Rate limiting
   - Option A (faster): Vercel WAF dashboard + 2 rules
   - Option B (flexible): Upstash Redis + `@upstash/ratelimit` middleware

5. **B-1 (1–2 hours)**: CI gates
   - Create `.github/workflows/ci.yml`: `tsc --noEmit && next lint && npm run test:smoke`
   - Set `next.config.js`: `ignoreBuildErrors: false`, `ignoreDuringBuilds: false`
   - Fix or document any errors

### Day 3 (6–8 hours)

6. **A-7 (4–6 hours)**: audit_logs table + integration
   - Create migration: `audit_logs` (append-only, Service Role write)
   - Build server-side helper: `logAuditEvent(action, target, before, after, metadata)`
   - Integrate: `members/role`, `invites/*`, cascade cleanup
   - Test: sample audit entries appear in table

7. **B-2 & B-3 (2 hours)**: Headers + cookie auth
   - Add CSP/HSTS/X-Frame-Options to `next.config.js`
   - Authenticate `/api/_session/*` endpoints

8. **Final checklist**: Run smoke tests; verify all A-1 through A-7 complete

---

## Risk Summary

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| **RLS misconfiguration** | Medium | Critical (tenant breach) | A-5 verification + live test before PoC |
| **Anonymous API abuse** | High | High (cost, DoS) | A-2 + A-4 rate limiting |
| **Build regression** | Medium | Medium (bugs ship) | B-1 CI gates + fix errors |
| **Cost spiral** | High | High ($1000+) | A-4 rate limiting + D-2 budget cap |
| **Audit trail missing** | Medium | Medium (compliance) | A-7 logging table |
| **Known CVEs in prod** | Medium | Medium (exploits) | A-6 npm updates |

---

## Appendix: Files & Commands

### Key Files to Review / Modify

```
supabase/migrations/20260628_fix_strategy_data_rls_role_control.sql  ← Hold pending STAGE4 clarity
next.config.js  ← Set ignore* = false; add headers()
.github/workflows/  ← Create CI
app/api/generate-*.../route.ts  ← Add auth guards (6 APIs)
lib/server/rbacGuard.ts  ← Ensure requireMembership exported
lib/supabase/  ← Verify RLS not bypassed in queries
```

### Verification Commands

```bash
# RLS check
curl -s "https://project.supabase.co/rest/v1/pg_policies" \
  -H "apikey: <anon_key>" | jq '.[] | select(.tablename == "strategy_data")'

# Unauthenticated API test
curl -X POST http://localhost:3000/api/generate-question \
  -H "Content-Type: application/json" \
  -d '{}' \
  # Should fail with 401 after A-2 fix

# Rate limit test (after A-4)
for i in {1..20}; do curl -X POST http://localhost:3000/api/generate-question; done \
  # Should see 429 after limit hit

# npm audit
npm audit | grep -E "critical|high"  # Should be 0 after A-6
```

---

## Sign-Off

**Prepared by**: Claude Code Agent  
**Date**: 2026-06-28  
**Status**: Analysis complete; ready for engineering execution (A-1 through B-5)
