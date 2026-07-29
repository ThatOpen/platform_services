# Cross-discipline (`MEP-XD-*`)

**Status:** Draft · **Last updated:** 2026-07-29

A large part of MEP work is not designing. It is playing ping-pong with the other
disciplines: give me the loads, where do you need the openings, how big, what does that
weigh, has the room use changed. Back and forth, by email, with attachments, and every
answer stale the moment the model moves again.

Antonio's read on this was that it is app territory rather than core modeller work: a cloud
component keeping running totals against the shared model and raising a flag when something
crosses a threshold. I agree, and this is also where the platform's architecture pays off
most directly for MEP. Everything in this file needs exactly two things: one always-current
shared model, and compute that can run against it when nobody has the project open. The
platform already has both. This file is essentially a list of what they make possible for
cross-discipline work. Antonio also asked which numbers I would want watched first. The
ranked table in `MEP-XD-02` is the answer.

---

## MEP-XD-01: Hanger and support systems

**Why.** First, hangers are real material that gets procured and installed, and today they are often estimated 
by rule of thumb.
Second, **hangers are how MEP load reaches the structure**.

**Done means:**

- Generic, non-catalogue, parametric supports: rod hanger, trapeze, clevis, riser clamp,
  bracket, seismic brace where relevant.
- Automatic placement along a run, with the spacing rule configurable per system, by:
  - **fixed span**, or
  - **carried mass**, placing supports so no support exceeds a given load, or
  - a **diameter → span mapping**, which is how most office standards and code tables are
    actually written.
- Supports are **run-aware**: a support knows which runs it carries, and therefore knows
  what it is carrying. Pipe or duct self-weight, insulation and cladding
  ([`MEP-MOD-09`](./02-modelling-core.md)), fluid content, and any valves or in-line
  components in its tributary length.
- A support reports its **load**, split into dead load and fluid load, and reports what it
  attaches to.
- Loads are computed in both states: **operating** (fluid-filled) and **test**
  (water-filled, which for a gas or air system is the governing case and routinely
  forgotten).
- Supports respect slope. A sloped run's supports vary in drop length, and that is
  schedulable.
- Supports are schedulable and countable per system and per level.

**Notes.** I would rather have approximate supports placed automatically everywhere than
exact supports placed by hand, but hand placement is also required.

---

## MEP-XD-02: Cross-discipline running totals and notifications

**P1.** One mechanism: totals computed from the shared model, watched against thresholds,
with a optional, subscribction based, notification when something crosses. The accumulated MEP load to structure is the
flagship number and is specified in full below. The other numbers follow the same pattern.

**Why.** Equipment is easy: it is localised, and its weight is on the datasheet. Distributed
load from piping, ducting and containment is the hard one. It is spread over hundreds of
supports, it changes every time a route changes, and the structural engineer needs it early.
So what they get is a blanket allowance in kN/m² that somebody guessed, and which is then
either wasteful or wrong.

With supports (`MEP-XD-01`) and insulation ([`MEP-MOD-09`](./02-modelling-core.md)) in the
model, it contains everything needed to compute this properly. And the same
watch-and-notify mechanism that carries this number carries all the others.

**The flagship number, accumulated MEP load. Done means:**

- Accumulated load per structural host (slab, beam, wall), summing the supports attached to
  it (`MEP-XD-01`) plus directly-mounted equipment.
- Reported as point loads where they are point loads, and as distributed loads where a
  sensible distributed equivalent applies.
- Broken down by contribution: pipe, fluid, insulation, cladding, support steel, equipment.
  A structural engineer will ask, and "1.4 kN" without a breakdown does not get accepted.
- Both operating and test cases.
- Comparable against an **allowance** set by the structural engineer, so exceedance is
  detectable rather than discovered.
- Exportable per structural element, in a form a structural engineer can actually use.
- Recomputed continuously, and re-issued when it changes materially, through the mechanism
  below.

**The other numbers worth watching.**

| # | Watched number | Aggregated by | Who consumes it | Notify when |
| --- | --- | --- | --- | --- |
| 1 | **Accumulated MEP load** (above) | Structural element, then level | Structural engineer | Exceeds the structural allowance, or moves by more than a set percentage since the last issue |
| 2 | **Installed electrical load** | Distribution board, riser, floor, whole building | Electrical engineer, utility application | Board or riser exceeds its rated capacity or a diversity threshold |
| 3 | **Open penetration requests** (`MEP-XD-03`) | Host element, level, status | Structural, architect, site | A request has been unanswered past a set time, or an approved opening's service has since moved |
| 4 | **Equipment point loads** | Slab, plinth, roof | Structural engineer | New heavy equipment placed, or operating weight revised |
| 5 | **Cooling and heating capacity balance** | System, plant | Me, mostly | Connected terminal duty exceeds installed source capacity (sometimes it is OK, just a warning/info) |
| 6 | **Water and gas demand** | Riser, incoming service | Utility applications | Total demand exceeds the connection assumption |
| 7 | **Fire damper and compartment crossings** | Compartment boundary | Fire engineer, approvals | A service crosses a compartment without a damper or seal |

**The mechanism. Done means:**

- Each total is computed from the shared model rather than assembled by hand.
- Recomputed as a cloud component on model change, on a schedule, or on demand.
- Thresholds are configurable per project, with a defined owner per number.
- Notification carries **what changed and by how much**, not "something changed". Otherwise
  it becomes noise and gets muted within a week.
- Every number is drillable to the elements that produced it.
- History is kept, so a value can be compared against what was last issued.

---

## MEP-XD-03: Penetrations and openings

**Why.** Openings are the other permanent ping-pong. I need a hole. The structural engineer
needs to approve it. The architect needs to know it is there. The contractor needs it on a
drawing. Today that is a marked-up PDF, an email, and a hope.

**Done means:**

- Create a penetration where a run crosses a wall, slab or beam, ideally in bulk for all
  crossings of a selected system, since one riser can generate fifty.
- Two representations, and both are needed at different times: a **real cut** through the
  host, and a **non-destructive placeholder** that marks the required opening without
  modifying another discipline's model. The placeholder is usually what you want, because
  the hole is not yours to cut.
- Sizing rules: clearance around the outer dimension including insulation, minimum
  rectangular or round shapes, rounding to a construction increment, grouping of nearby
  crossings into one opening.
- Penetrations carry a **status** (proposed, submitted, approved, rejected, built), with who
  changed it and when. That status is the whole workflow.
- A penetration knows which elements pass through it, and goes stale if they move or resize.
- Register export per level and per host element, for the structural engineer and for site.
- Clash-checked against structural rules (proximity to edges, to other openings, to
  reinforcement zones) where those rules are available.

---

## MEP-XD-06: Coordination and clash, per system

**Why.** Listed mostly for completeness, because clash detection is the one part of my
workflow where the existing tools are basically fine. The MEP-specific asks are small, with
one exception at the end of the list that the existing tools do not cover: regulatory
mutual placement rules.

**Done means:**

- Clash runs filterable **per system** ([`MEP-MOD-05`](./02-modelling-core.md)), not only
  per file or per category. "Supply air against structure" is the query I actually run.
- Clearance clashes are distinct from hard clashes, and **insulation and cladding outer
  dimensions participate** ([`MEP-MOD-09`](./02-modelling-core.md)). A bare pipe that fits
  and an insulated pipe that does not is a defect the tool should catch.
- Service clearance volumes ([`MEP-EQP-04`](./03-equipment-and-families.md)) participate as
  their own category.
- Tolerances configurable per system pair. The acceptable gap between two ducts is not the
  acceptable gap between a duct and a structural beam.
- Re-runnable cheaply and results comparable between runs, so I can see what I fixed and
  what I introduced.
- **Mutual placement rules as an additional rule layer.** Regulations prescribe how
  services run relative to each other: a natural gas pipe above the electrical tray, never
  under it, minimum separations between given pairs of services, special rules at
  crossings. Rules are expressed against system types ("A above B", "at least X mm between
  A and B", parallel runs versus crossings) and checked like clashes, with findings
  reported per rule. The rule sets are **configurable and shareable**, because these
  requirements come from national regulations and differ by country. None should be
  hard-coded, and office-level and country-level rule sets should be easy to build and
  exchange.
