## Context

Only `src/app/module/auth/` and `src/app/module/user/` exist. Both follow a consistent five-file pattern (`*.route.ts`, `*.controller.ts`, `*.service.ts`, `*.validation.ts`, `*.interface.ts`) wired through `checkAuth(...roles)` for authorization, `validateRequest(zodSchema)` for input validation, and `sendResponse`/`catchAsync` for the response envelope and error handling. This design extends that exact pattern to every remaining domain rather than introducing a new one.

## Goals / Non-Goals

**Goals:**
- A complete, accurate inventory of every endpoint the current schema implies, grouped into phases ordered by real business dependency.
- Each phase is a self-contained capability (own spec, independently implementable/archivable) so `/opsx:apply` can be run phase by phase over multiple sessions, matching the user's "not all today" instruction.
- Reuse the existing module pattern exactly — no new architectural decisions needed per phase.

**Non-Goals:**
- Not writing any code in this change.
- Not deciding internal service-layer implementation details (e.g. exact Prisma query shapes) — that's implementation-time work once a phase is applied.
- Not covering capabilities with no underlying model (gift cards, multi-vendor, i18n, etc.) — consistent with every prior change's scope boundary in this project.
- Not building a payment gateway integration (Stripe/bKash/etc. webhook handling) — `api/checkout`'s Payment endpoints cover recording/reading payment state, not a specific gateway's SDK integration, which would be its own follow-up change once a gateway is chosen.

## Decisions

### Decision: 7 phases, ordered by what blocks what
**Options considered:**
- (a) One phase per Prisma model (46 phases) — too granular, most models are meaningless to ship alone (e.g. `OrderItem` without `Order`).
- (b) One phase per `openspec/specs/` capability already created (`commerce/cart`, `commerce/wishlist`, etc. individually) — mirrors existing capability boundaries but splits things that are naturally built together (cart and wishlist share almost identical patterns and are typically built in the same sitting).
- (c) 7 phases grouped by business dependency and typical team sprint size (roughly 4-7 models each).

**Choice: (c).** Phase order follows what actually blocks what in a real storefront: you cannot have a cart without a catalog to add from; you cannot checkout without a cart; you cannot return/refund/review without a completed order; inventory and marketing are admin-side concerns that can happen in parallel with or after checkout is live; support/admin governance is the least urgent to ship first (the store functions without it, if there's a single owner). This ordering is a recommendation, not a hard constraint — phases 5 and 6 (inventory, marketing) could be swapped or run in parallel without breaking anything, since neither blocks the other.

### Decision: Every phase reuses the auth/user module's five-file pattern
No new pattern is introduced. Each phase's tasks (see `tasks.md`) create `src/app/module/<domain>/{<domain>.route,controller,service,validation,interface}.ts` and add one `router.use(...)` line to `src/app/routes/index.ts`. This keeps the codebase consistent and means future contributors only need to learn the pattern once.

### Decision: Public vs. admin endpoints are separate route trees, not role-gated variants of the same route
E.g. `GET /products` (public, active-only) and the admin product list are different endpoints (or the same endpoint with a role-conditional query, decided per-phase at implementation time) — this design doc doesn't lock in which, since it's an implementation detail that doesn't change the behavior contract in the specs. What the specs do lock in: public endpoints never require auth and never leak non-`ACTIVE`/non-`APPROVED` records to anonymous requests.

## Risks / Trade-offs

- **[Risk] 7 phases is still a lot of surface area; scope could balloon within a single phase.** → Mitigation: `tasks.md` lists concrete endpoints per phase so "done" is checkable, not open-ended.
- **[Risk] Payment gateway choice is deferred, so `api/checkout`'s payment endpoints may need rework once a real gateway is integrated.** → Accepted; documented above as a Non-Goal, not silently assumed solved.
- **[Risk] Phase ordering assumes a single-store, single-owner-then-staff rollout; a team building phases out of order (e.g. marketing before checkout) will hit missing dependencies (e.g. no `Order` to apply a coupon to).** → Mitigation: dependency ordering is stated explicitly per phase in `tasks.md`, not left implicit.

## Open Questions

- Which payment gateway(s) to integrate (Stripe, bKash, Nagad, COD-only for launch)? Doesn't change `api/checkout`'s spec (payment *state* recording is gateway-agnostic) or the task breakdown — safely deferred to when that phase is actually implemented.
