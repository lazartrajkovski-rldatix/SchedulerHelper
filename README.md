# SchedulerHelper

**This is a prototype / proof-of-concept only — not production-ready, not in use by any live eCommunity deployment.**

A proof-of-concept nurse scheduling assistant built for eCommunity's district 
nursing teams. Given a list of patient visits and available nurses for the day, 
it automatically suggests the best nurse for each visit, calculates travel times, 
detects conflicts, and lets a coordinator override decisions with real-time 
feasibility warnings.

This was built to explore and validate the scheduling/assignment approach — 
it is not a finished product and has not been hardened for production use.

---

## The Problem It Solves

District nursing coordinators receive a list of visits each morning — each with a patient, location (postcode), required clinical band, and a time window (fixed or flexible). They then manually match nurses to visits, mentally juggling:

- Who is geographically close enough to make it in time?
- Who finishes their shift in time to reach the next patient?
- If I send Nurse A to this visit, does it strand another patient with no nurse?

This tool automates that reasoning and flags problems before they happen.

---

## Key Concepts

### Visit Types

| Type | Meaning | Example |
|------|---------|---------|
| `SpecificTime` | Must happen at exactly this time | Nina Targaryen — 15:00 opioid patch |
| `TimeSlots` | Can happen at any of the listed hourly slots | Karen Moore — IV medication, flexible |
| `MultipleVisitsPerDay` | Clinically flexible within a narrow window | Alex Smith — physiotherapy, 07:00–09:00 |

**Flexible visits** (`TimeSlots` / `MultipleVisitsPerDay`) are scheduled at whatever time fits best within the nurse's shift. The actual slots in the data are just the maximum range — the nurse's shift hours are the real constraint.

### Nurse Shifts

Each nurse has a shift start and end time. The scheduler never places a visit outside a nurse's shift. Current mock shifts:

| Nurse | Shift | Type |
|-------|-------|------|
| Biljana Chuchurski | 07:00 – 17:00 | Morning |
| Sophie Bennett | 07:00 – 17:00 | Morning |
| Health Roster | 08:00 – 18:00 | Day |
| Dell Delete | 14:00 – 00:00 | Evening |
| Cillian Murphy | 07:00 – 17:00 | Morning |

Evening nurses (Dell) can pick up flexible visits that morning nurses have no time for.

### Band Eligibility

Nurses can only do visits at or below their grade band. A Band 5 nurse can do Band 2–5 visits. A Band 7 nurse can do Band 2–7. Band 9 (Cillian) can do everything.

### Travel Time

Travel is calculated using the **haversine formula** (straight-line distance between postcodes) divided by an average speed of 48 km/h, plus 5 minutes overhead. A minimum 15-minute buffer is required between arriving at one visit and starting the next.

### Mileage Cap

Some nurses have a mileage cap (e.g. Biljana: 5 miles). Visits outside that radius are flagged as ineligible for that nurse.

---

## Scheduling Algorithm

The scheduler runs in `src/lib/scheduler.ts` and works in three phases:

### Phase 1 — Eligibility Filtering
For each visit, determine which nurses are allowed to do it based on:
- Band grade (nurse grade ≥ visit band)
- Mileage cap (if `hasMileageCap`, distance must be within cap)
- Patient continuity (if `preferredClinicianId` is set and mode is `hard`, only that nurse)

### Phase 2 — Scoring
Eligible nurses are scored per visit. Lower score = better match:
- **Grade gap**: prefer the lowest-grade nurse who still qualifies (don't waste a Band 9 on a Band 2 visit)
- **Distance**: closer is better
- **Preferred clinician**: bonus if this is the patient's usual nurse

### Phase 3 — Simulation
Visits are processed in priority order (SpecificTime first, then flexible sorted by score). For each visit:

- **SpecificTime**: try each listed slot. A nurse passes if:
  1. No existing block overlaps the slot
  2. Can travel from their previous visit in time (+ 15-min buffer)
  3. Can travel to their next visit in time after this one
  4. The slot is within their shift hours

- **Flexible**: use `optimalFlexStart` to find the earliest valid minute within the nurse's shift where the visit fits. Rounds to nearest 5 minutes.

The best-scoring available nurse is assigned and their timeline is updated for subsequent visits.

---

## Conflict Detection

### Real-Time (AssignmentCheck)
When a coordinator clicks a nurse that isn't the recommended one, `src/lib/assignmentCheck.ts` checks:
1. **Feasibility**: is there any slot where this nurse can actually do the visit?
2. **Stranding**: if this nurse is the *only* one eligible for another visit at an overlapping time, assigning them here would leave that patient with no nurse.

The result is shown in a warning modal before confirming.

### Post-Assignment (BatchResults)
After any manual assignment, the full timeline is rebuilt. Visits where a nurse now appears double-booked are moved to a "🔴 Now unschedulable" section.

---

## Project Structure

```
frontend/
├── src/
│   ├── components/
│   │   ├── BatchResults.tsx        # Main batch planner UI — categorises visits into ready/broken/needs-decision
│   │   ├── VisitCard.tsx           # Individual visit card with nurse pills for assignment
│   │   ├── NurseDayPlan.tsx        # Card-based day schedule per nurse with travel analysis
│   │   └── AssignWarningModal.tsx  # Modal shown before confirming a non-recommended assignment
│   ├── lib/
│   │   ├── scheduler.ts            # Core eligibility, scoring, and simulation logic
│   │   ├── assignmentCheck.ts      # Real-time feasibility check for manual assignments
│   │   └── travel.ts               # Haversine travel time calculation (postcode → lat/lng → minutes)
│   ├── data/
│   │   ├── mockVisits.ts           # Sample visits for the day (stand-in for clinical scheduling system)
│   │   └── mockClinicians.ts       # Sample nurses with their bands, shifts, and constraints
│   └── types/
│       └── index.ts                # Shared TypeScript types (Visit, Clinician, ScoredVisit, etc.)
```

---

## Getting Started

### Prerequisites
- Node.js 18+ (tested on Node 24 LTS)
- npm

### Install and run
```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

### Build for production
```bash
npm run build
```

---

## Mock Data

The app ships with realistic mock data to demonstrate scheduling logic:

- **22 patient visits** across Band 2–9, covering SpecificTime and flexible types, spread across the UK (London, Birmingham, Bath, Manchester, etc.)
- **5 nurses** on different 10-hour shifts (morning / day / evening), with different band grades, mileage caps, and base postcodes

To connect real data, replace `mockVisits` and `mockClinicians` with API calls that return objects conforming to the `Visit` and `Clinician` types in `src/types/index.ts`.

---

## Configuration

`src/data/mockConfig.ts` (or passed via props) exposes constraint settings:

| Constraint | Modes | Effect |
|---|---|---|
| `bandGrade` | hard / soft / off | Hard = only exact band; soft = penalise grade gaps; off = ignore |
| `mileageCap` | hard / soft / off | Hard = nurse ineligible if visit exceeds cap |
| `patientContinuity` | hard / soft / off | Hard = only the preferred clinician can do this visit |

---

## How to Interpret the UI

### Batch Planner
- **✓ Ready to assign** — visit has a nurse, no conflicts
- **🔴 Now unschedulable** — manual assignment created a double-booking; nurse appears in two places at once
- **⚠ Needs decision** — no nurse could be assigned; conflict reason explains why

### Nurse Day Plan
Each nurse card shows:
- Their shift hours (e.g. "Shift: 07:00 – 17:00")
- All visits in chronological order
- Travel blocks between visits coloured red/amber/green based on buffer time

### Visit Cards
- 🕐 **Fixed: HH:MM – HH:MM** — must happen at that exact time
- 🕐 **Flexible (any time)** — can happen anytime within the nurse's shift
- ★ pill = scheduler's recommended nurse
- ✓ pill = manually confirmed nurse
- Clicking a different nurse opens the warning modal
