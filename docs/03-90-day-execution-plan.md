# ORVEXA — 90-Day (12-Week) Execution Roadmap

**Goal:** Go from foundational architecture to a live, pilot-tested, commercially ready B2B Order Intelligence product in **12 weeks (3 months)** while strictly following ORVEXA's market-validation discipline (Spec §19 & §22).

---

## Month 1 (Weeks 1–4): Foundation, Core Engines & First Customer Discovery

### Week 1: Monorepo, Security Isolation & Math Core Setup
- **Engineering:**
  - Initialize Monorepo (`apps/web`, `apps/api`, `services/science-engine`, `packages/db`).
  - Deploy PostgreSQL 17 with Row-Level Security (`RLS`) and Immutable Audit Ledger.
  - Implement and unit-test MILP Global Matching, Integer Packaging Decomposition, and CP-SAT MUS Validation.
- **Business Discovery (Spec §19 & §22 Phase 1):**
  - Identify 15–20 Egyptian SMB distributors/wholesalers (FMCG, food & beverage, packaging, household goods).
  - Conduct first 5 discovery interviews observing real WhatsApp/PDF/Excel order intake.

### Week 2: Arabic/English Hybrid AI Extraction & Provenance Pipeline
- **Engineering:**
  - Build Arabic/Franco/English normalizer (numerals, alef/taa normalization, Egyptian wholesale units: كرتونة/باكت/شدة/دستة/قطعة).
  - Build Structured Candidate Extractor with character-span / bounding-box provenance tracking.
  - Integrate Conformal Risk Control calibration module + SLA Review Scheduler.
- **Business Discovery:**
  - Collect 50–100 real anonymized order samples (text, voice transcripts, Excel, images) with customer permission.
  - Benchmark extraction + OR matching accuracy against real samples.

### Week 3: Core API, RBAC, State Machine & Temporal Durability
- **Engineering:**
  - Implement strict RBAC (`Owner`, `Admin`, `Ops Manager`, `Sales`, `Order Processor`, `Reviewer/Approver`, `Read-only`).
  - Enforce hard human-only approval gate (no AI endpoint can write to `approved_orders`).
  - Wire API ↔ Science Engine ↔ SSE live status stream + Temporal durable workflow.

### Week 4: Split-Pane Evidence Workbench (MVP Frontend v1)
- **Engineering:**
  - Build Next.js 16 + React 19 RTL/LTR Split-Pane Review Workbench with source highlighting, packaging repair suggestions, and keyboard shortcuts.
  - Build Catalog + Alias Management + Customer Management screens + CSV/Excel import.
  - **Milestone 1 Exit Gate:** End-to-end internal demo using 20 real collected distributor messages.

---

## Month 2 (Weeks 5–8): Document Intelligence, Pilot Hardening & Controlled Pilot #1

### Week 5: Document & Spreadsheet Intake (PDF / Image / Excel)
- **Engineering:**
  - Add layout-aware PDF/Image table extraction with bounding-box overlay in the Split-Pane UI.
  - Add Excel/CSV column auto-mapping + validation preview.
  - Add Conformal calibration feedback loop (human corrections automatically update calibration dataset).

### Week 6: Operational Dashboard, Queueing Analytics & Reporting
- **Engineering:**
  - Build Operations Manager Dashboard (Little's Law WIP, Erlang-C bottleneck alert, Pending-Order Aging, Common MUS Validation Failures, Correction Rates).
  - Add printable/exportable Approved Order summaries (CSV/PDF) so distributors can immediately feed their existing accounting/warehouse process.

### Week 7: Security Audit, Load Testing & Pilot Onboarding Toolkit
- **Engineering:**
  - Automated multi-tenant RLS penetration tests (verify cross-tenant leakage = 0).
  - Load test OR solvers on 200-line orders and 10,000-SKU catalogs (target < 300ms per order).
  - Prepare fast catalog-cleanup & alias-seeding onboarding script.
- **Commercial:**
  - Sign 2–3 Controlled Pilot Agreements (Phase 5) with clear baseline metrics (Spec §20: processing time, error rate, clarification rate).

### Week 8: Launch Controlled Pilot #1 & #2
- **Operations:**
  - Onboard first 2 pilot distributors (catalog + customer records + staff training).
  - Shadow operators during live daily order intake; log every friction point and unmatched alias.
  - **Milestone 2 Exit Gate:** Real businesses processing daily orders through ORVEXA with measurable time/error tracking.

---

## Month 3 (Weeks 9–12): Calibration, Measurable ROI & Commercial Launch

### Week 9: Real-World Calibration & UX Friction Elimination
- **Engineering:**
  - Calibrate Conformal thresholds ($\alpha \le 1\%$) using pilot human-correction logs.
  - Fix top 5 UI/workflow bottlenecks observed during live pilot shadowing.
  - Tune Arabic/Franco unit synonyms and customer-specific alias auto-learning (requiring human confirmation before saving permanent aliases per Spec §8.4).

### Week 10: Pilot ROI Measurement & Case Study Validation
- **Business & Analytics:**
  - Compare 2-week pilot metrics against Week 7 baseline (time-to-approval, correction rate, unmatched rate, aging).
  - Validate pricing & willingness-to-pay (Setup fee + Monthly SaaS tier per Spec §17).
  - Lock ICP (which distributor sub-vertical felt the strongest pain).

### Week 11: Production Readiness & Repeatable Onboarding
- **Engineering:**
  - Automated backups, observability (OpenTelemetry + Prometheus/Grafana), CI/CD, and zero-downtime migrations.
  - Self-service Organization Setup wizard (Spec §11.1).
- **Commercial:**
  - Convert Pilot #1 & #2 to paid subscriptions.
  - Finalize commercial landing page, demo script (Spec §18.3), and legal/brand checks for ORVEXA (Spec §2.5).

### Week 12: Commercial Launch (Phase 6)
- **Go-to-Market:**
  - Launch direct B2B outreach backed by real measured pilot case studies.
  - Onboard paying customers #3–#5 using the repeatable 48-hour onboarding playbook.
  - **Milestone 3 Exit Gate:** Live revenue-generating B2B SaaS company with mathematically verified accuracy, multi-tenant isolation, and proven operational ROI.
