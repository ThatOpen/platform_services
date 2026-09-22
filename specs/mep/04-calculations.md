# Calculations, the data contract (`MEP-CALC-*`, `MEP-DWG-*`)

**Status:** Draft · **Last updated:** 2026-07-29

This is the file about the biggest waste, and it is deliberately the least ambitious about
what That Open could build.

Heat loss, hydraulics and energy modelling are decades-deep engineering
problems with established solvers, national code variants and certification requirements
attached. Mature, validated engines already exist, and engineers trust results that come
from recognised methods. The highest-value move here is integration, not
reimplementation.

**The waste is not that the solvers are elsewhere. The waste is that the building has to be
rebuilt before the solver can see it.** That part is a data problem, and it is squarely
platform work.

So this file specifies a contract: what the model must expose so that a calculation app
(built by That Open, by me, or by a third party arriving through Connect) can read the
design and write results back, without a human re-entering the building first.

Get the contract right and every one of these calculations becomes somebody's app. Get it
wrong and MEP engineers keep paying for five licences and keeping five copies in sync.

> The solvers this contract would feed already exist, and most of them are permissively
> licensed or outright public domain: EnergyPlus, EPANET, SWMM, pandapipes, pandapower,
> CONTAM. [`06-open-source-engines.md`](./06-open-source-engines.md) names them, states
> their licences, and proposes the integration pattern. Read that alongside this file. It is
> what turns everything below from a request into a plan.

---

## MEP-CALC-01: Thermal and envelope model exposed for load calculations

**P0** for anyone doing HVAC.

**Why.** Design heat loss and cooling load need the building's envelope, and it already
exists in the model. Today it gets re-entered into a separate application, room by room, and
re-entered again after every architectural revision. This is the clearest single case of
duplicated work in
[`01`](./01-workflow-and-waste.md#2-balance-calculations-heat-loss-cooling-load-electrical-load).

The itemised version of this requirement, with an honest assessment of what a real IFC
carries today, is the `MEP-DATA-*` table in
[`06-open-source-engines.md`](./06-open-source-engines.md).

**Done means:** a documented, queryable representation containing:

- **Spaces** with area, volume, height, name, number, occupancy type.
- **Space boundaries**: every surface bounding a space, its area, orientation, tilt, and
  what is on the other side (outside, ground, another space, an unconditioned space). This
  is the part that is really hard and the part that has all the value. Second-level
  boundaries are what a load calculation actually needs.
- **Constructions**: layered build-ups with materials, thicknesses and thermal
  conductivity, and the resulting U-value where it is available.
- **Openings**: windows and doors with area, U-value, g-value, frame fraction, shading.
- **Thermal bridges**, at least as a definable allowance per boundary type.
- **Infiltration** assumptions per space or zone, definable leakage paths.
- **Internal gains** (occupancy, lighting, equipment) as schedulable values per space.
- **Location and climate reference**: coordinates, orientation, design outdoor conditions,
  and a link to a climate dataset.
- **Zones** per [`MEP-MOD-06`](./02-modelling-core.md), so results aggregate the way the
  design is organised.

**Notes.** Most of this belongs to the architectural model, not to me. That is precisely why
it should come from the shared model instead of from my re-typing. Where data is missing or
uncertain, the contract must be able to say so. A load calculation run on silently assumed
U-values is worse than one that refuses to run.

A guideline document or IDS validation could be interdisciplinary aid to ensure it all parameters are provided
for calculations of other disciplines.

---

## MEP-CALC-02: Network model exposed for hydraulic calculations

**P0.**

**Why.** Sizing and balancing a network needs the network graph. Today either the network is
redrawn in the calculation software, or it is drawn there first and imported back as IFC.
Both are the same waste in different directions.

**Done means:** from the connectivity graph of [`MEP-MOD-04`](./02-modelling-core.md),
a solver can obtain:

- Nodes and edges with topology, including junction semantics (main versus branch on a tee).
- Per edge: length along route, inner diameter or cross-section, material roughness,
  insulation, elevation at both ends (so static head is derivable), fluid.
- Per node: type, elevation, and its local loss characteristics (K-factor, equivalent
  length, or a manufacturer curve).
- Component data: pump curves, valve Kv/Kvs and authority, terminal design flows, filter and
  coil pressure drops, damper characteristics.
- Design conditions: fluid, design temperatures, and for air systems whether pressure is
  static or total at each point.
- Boundary conditions: sources, terminals, design flows or loads at terminals.
- Flow direction, assigned or inferred.

And crucially, **the solver can write back**: sized diameters, computed flows and
velocities, pressure drops per segment, pump and fan duty, valve presettings, balancing
data, all written onto the elements they belong to, per `MEP-CALC-04`.

**Notes.** Add-ins for the incumbent tools get part of the way here, computing inside one
desktop file. What does not exist is this round-trip against a shared, always-current
model, and that is the reason a cloud platform can win. The pipe I sized is the pipe in the
model, not a pipe in another file that resembles it.

The contract does not presume an external engine. **Writing a simplified solver against
this contract is also an option**, because most building networks are trees, where segment
flows follow directly from the terminal demands and pressure drop is an accumulation along
each path. The established engines matter for looped networks and time behaviour. For the
common tree case, a small own solver reading this contract is entirely realistic, provided
it passes the same validation as anything else
([`07`](./07-implementation-playbook.md)).

---

## MEP-CALC-03: Design assumptions as first-class objects

**P1.** Easy to overlook, but important.

**Why.** Every calculation rests on assumptions: design temperatures, occupancy, air change
rates, simultaneity factors, safety margins, code edition. Today they live in a spreadsheet
or in someone's head. When one changes, nothing downstream knows, and the calculation that
depended on it stays in the model looking authoritative.

**Done means:**

- Assumptions are stored objects, with a value, a unit, a source (code clause, client brief,
  engineering judgement), an author and a date.
- Scoped: project-wide, per zone, per system, per space.
- Calculation results record which assumptions they consumed.
- Changing an assumption marks everything derived from it as stale (`MEP-CALC-06`) and can
  notify the people who depend on it ([`05`](./05-cross-discipline.md)).
- Assumptions are readable by other disciplines. Half of cross-discipline email traffic is
  someone asking for a number that would be sitting right here.

---

## MEP-CALC-04: Results written back, versioned and traceable

**P0** for any of this to be usable professionally.

**Why.** MEP engineers sign for their calculations. A result I cannot trace is a result I
cannot defend, and a result that silently overwrites the previous one is a result I cannot
audit.

**Done means:**

- Results are written onto the elements they concern, as structured property sets, not as a
  PDF stapled to the project.
- Every result records: which app and version produced it, when, against which model
  version, using which assumptions, under which code or method.
- Results are versioned. Previous runs remain inspectable and comparable.
- Manual override is possible, and is visibly distinguished from a computed value. Engineers
  override solvers, and always will. Hiding that is how errors survive.
- Results are queryable per system, per zone, per level.
- Results carry a validity state: computed, stale, overridden, failed.

---

## MEP-CALC-05: Site, terrain and gravity drainage data

**P2.** Still, it is a whole extra application today.

**Why.** Rainwater design needs terrain, roof areas, catchments and gravity network
behaviour. The terrain and the roofs are in the model. Nothing else about the calculation
is.

**Done means:**

- Terrain surfaces are queryable, with levels and slopes.
- Roof and paved areas are extractable as contributing catchment areas, with their runoff
  coefficients.
- Catchments can be defined, and their contributing area computed from the geometry.
- Gravity networks expose invert levels, slopes and full-bore capacity, so part-full flow
  and liquid depth can be computed by a solver. (`MEP-CALC-02` covers most of the network
  side. What is missing is the free-surface case.)
- A rainfall intensity input, by region and return period, as an assumption object
  (`MEP-CALC-03`).

---

## MEP-CALC-06: Staleness and change propagation

**P1.**

**Why.** This is the mechanism that actually removes the sync problem. It is not enough that
the calculation *can* read the model. The model must be able to tell me the calculation no
longer matches it.

**Done means:**

- Every result records the model state it was computed against.
- When elements or assumptions it depended on change, the result is marked stale, with what
  changed, not just that something did.
- Staleness is visible in the model and queryable, so "what needs recalculating" is a list.
- Recalculation is re-runnable in place, ideally as a cloud component, without an export
  step.
- Optionally, notification when a result on which another discipline depends goes stale.

**Notes.** If I had to name the one thing that would most change my working life, it is this
plus `MEP-CALC-02`. Not "the platform can calculate", but **"the platform knows my
calculation is out of date and can re-run it against the current model."**

---

## MEP-CALC-07: Neutral exchange, for the solvers that will never live here

**P1.**

**Why.** Some calculations are tied to certified national tools that will not become
platform apps, ever, because a signature or a legal submission depends on that specific
software. That is fine. Those tools should still be fed from the model rather than by hand.

**Done means:**

- Export of the thermal model (`MEP-CALC-01`) in an established neutral format (gbXML and
  IFC being the obvious candidates), good enough that the receiving tool does not need
  manual repair. "Exports something" is not the bar. "Imports without rework" is.
- Export of the network model (`MEP-CALC-02`) similarly.
- Re-import of results back onto the model elements, per `MEP-CALC-04`.
- Export is scriptable from a cloud component, so it can be regenerated on every revision
  instead of on request.

---

## MEP-CALC-08: Automatic sizing

**P1.** Pick the size from the actual flow, against a criterion. Nothing more.

**Why.** Once the flow in every segment is known, choosing the size is mechanical: take the
design flow, apply the criteria for that system type, pick the smallest size from the
approved product range that passes. This is platform-side work, not engine work. The
engines supply flows and pressure drops. The selection rule belongs to us and is
deliberately simple.

**Done means:**

- Sizing criteria per system type: maximum velocity and/or maximum pressure gradient
  (Pa/m), with minimum and maximum size.
- For each segment with a known design flow, the tool proposes the smallest size from the
  project's **approved product subset** (`MEP-MOD-07`) that satisfies the criteria, using
  the real inner and hydraulic diameters from the size records, not nominal labels.
- **Locked sizes are respected.** The engineer can lock any element, selection or system,
  and every re-run keeps the locks.
- The result is a reviewable proposal (current versus proposed sizes), applied explicitly,
  never silently.
- Criteria are stored as assumption objects (`MEP-CALC-03`). Results are traceable per
  `MEP-CALC-04` and go stale per `MEP-CALC-06` when flows change.

**Notes.** The engines in [`06`](./06-open-source-engines.md) analyse a given network and
do not select sizes, which is fine. Where iteration is needed (in balanced circuits, sizes
change the flows), the loop is propose, solve, check, repeat, and that pattern is already
proven around EPANET. Details in `MEP-CAP-07`.

---

## MEP-DWG-01: Longitudinal construction profiles

**P2.** Listed here because it is another whole application today.

**Why.** External and underground services are drawn as longitudinal profiles, at
**different horizontal and vertical scales**. The vertical exaggeration is the entire point,
because otherwise a 1:500 run with a 1:100 fall shows nothing. BIM tools do not produce
them, so the route goes to another tool or to CAD and gets redrawn by hand, then redrawn
again when it moves.

**Done means:**

- Select a route, generate a profile drawing along it.
- Independent horizontal and vertical scales.
- Annotated with chainage, invert and cover levels, slopes, segment lengths, materials and
  sizes, crossing services and their clearances, and ground level along the route.
- Regenerates when the route changes, rather than being a one-time export.

**Notes.** Filed as P2 because it is downstream of everything else, not because it is
unimportant. It is one of the more annoying re-draws in the job. It sits close to the 2D
work already in progress, so it may be cheaper than it looks.

---

## MEP-DWG-02: System diagrams, P&ID and riser diagrams

**P1.** Every MEP project requires system diagrams, not only a model.

**Why.** Diagrams are a **mandatory deliverable**, on every project, in every country I
know of. A P&ID for the plant room, and riser diagrams (the unfolded vertical schematic of
a system across floors, *rozwinięcie* in Polish) for the distribution. A model, however
good, does not replace them. Reviewers, approvers and installers read systems as
schematics, not as 3D. Today these are drawn in a separate 2D CAD, on a separate licence,
and kept in sync with the model by hand, which means in practice they drift.

This is also unusually platform-shaped work: the model already knows the system graph
([`MEP-MOD-04`](./02-modelling-core.md)), and a schematic is a projection of that graph.

**Done means:**

- **Best-effort automated generation** of a diagram from the system graph: equipment,
  terminals, valves and in-line components as symbols, connectivity as lines, per system or
  per selection. Riser diagrams organised by level, P&ID organised around the plant.
- The generated diagram is **editable**, not a static picture. The engineer rearranges,
  annotates and completes it. Automated layout is a starting point, and it will never be
  perfect. That is fine.
- **And in parallel, plain manual 2D drafting** of diagrams in the same environment, for
  the cases automation does not cover and for engineers who prefer to draft. The point of
  both paths together is that no second CAD licence is needed to finish a project.
- Diagram elements stay **linked to model elements** where they came from the model:
  select on the diagram, see it in the model, and the other way round. Sizes, tags and
  system names on the diagram read from the model, so they do not drift.
- When the model changes, linked content is marked stale rather than silently redrawn, and
  manual layout work is preserved on regeneration.
- Symbols come from a standard library, extendable at office level, in line with common
  symbol conventions.
- Diagrams are printable and exportable as normal drawing deliverables.

**Notes.** Fully automatic, publication-ready diagram layout is a research problem. That is
why the requirement says best-effort generation plus manual editing, and why the manual
drafting path is not optional. The deliverable exists on every project regardless of how
clever the automation is.

## What I am explicitly not asking for

- That That Open write a heat loss engine, a hydraulic solver, or an energy simulation.
- That the platform certify anything against national codes.
- That any of this replace an engineer's judgement.

What I am asking for is that the model be **legible enough to compute against**, and open
enough that whoever does write those solvers can plug in. If Connect is what it sounds like,
this file is mostly a description of what those apps will need on day one.
