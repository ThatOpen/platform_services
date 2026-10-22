# Open-source engines, feature by feature (`MEP-CAP-*`, `MEP-INT-*`)

**Status:** Draft · **Last updated:** 2026-07-29

[`04-calculations.md`](./04-calculations.md) argues that That Open should build the data
contract and let other people build the solvers. This file is the evidence that the second
half of that sentence is already largely true. More usefully, it also says how far that is
true for each individual feature.

The solvers exist. Most are mature, validated, used in real projects for decades, and carry
licences that permit commercial integration. Several are US federal work in the public
domain. Nobody has to write a heat-balance engine or a Newton-Raphson pipe solver.

That fact turns the calculation story from a feature request into a business case. The
demand side: engineers already pay for four to six calculation licences plus the re-entry
labour. The incumbent side: a twenty-year-old gap that is architectural, not accidental.
This file is the supply side: the physics is free, and what That Open would build is
contracts and adapters. The full argument is in the
[MEP README](./README.md#why-calculations-are-the-business-case-not-a-side-quest). This file
is its evidence.

But "an engine exists" and "the feature is done" are very different statements, and the gap
between them is where all the actual work lives. So each capability below is assessed the
same way:

| Section | Question it answers |
| --- | --- |
| **What is needed** | The feature as an MEP engineer would use it |
| **Model inputs** | What the BIM model must actually carry for the calculation to mean anything |
| **What open source covers, and how far** | Which engine, and honestly how much of the job it does |
| **Gaps to build** | What is left for That Open or an app developer |
| **Legal, licensing and compliance** | Licence terms, standards paywalls, code-compliance limits, and the mitigation |

The **Model inputs** row is the one that turns this from a shopping list into a plan. An
engine is only as good as what you can hand it, and "we have a 3D model" is nowhere near
enough. A wall must be a *layered construction with a thermal conductivity per layer*, not a
solid with a colour. Those requirements are listed once as `MEP-DATA-*` blocks below and
then referenced per capability, because the same handful of them underpin almost everything.

**Coverage vocabulary**, used consistently:

| | Meaning |
| --- | --- |
| **Full** | The engine does the whole job. Write an adapter, ship it. |
| **Strong** | The physics is complete and validated. What is missing is workflow, inputs and presentation. |
| **Partial** | The engine solves the hard core, but a usable feature needs a design layer built on top. |
| **Thin** | An engine helps with one piece. Most of the feature is ours. |
| **None** | Nothing usable found. Build, buy, or leave to a third party. |

**One disclaimer before the tables.** I am an MEP engineer, not a lawyer. Licence names were
checked against the projects' own licence files and documentation, and every project is
linked so it can be verified. Before anything ships, That Open should have counsel confirm
the obligations. If I have a licence wrong, correct it inline. That would be the most useful
possible comment on this file.

---

## Summary matrix

| ID | Capability | Coverage | Primary engine(s) | Licence class |
| --- | --- | --- | --- | --- |
| `MEP-CAP-01` | Design heat load (heating) | **Partial** | EnergyPlus | Green |
| `MEP-CAP-02` | Cooling load | **Strong** | EnergyPlus | Green |
| `MEP-CAP-03` | Whole-building energy simulation | **Strong** | EnergyPlus + OpenStudio | Green |
| `MEP-CAP-04` | National energy certificate | **None** | none | n/a |
| `MEP-CAP-05` | Ventilation airflow, infiltration, pressure regimes | **Strong** | CONTAM | Green |
| `MEP-CAP-06` | Duct sizing and pressure drop | **Partial** | pandapipes + fluids + CONTAM | Green |
| `MEP-CAP-07` | Hydronic sizing and balancing | **Partial** | EPANET / pandapipes + fluids + CoolProp | Green |
| `MEP-CAP-08` | Domestic water and gas | **Partial** | EPANET / pandapipes | Green |
| `MEP-CAP-09` | Drainage, building and site | **Partial** | SWMM | Green |
| `MEP-CAP-10` | Fluid properties and psychrometrics | **Full** | CoolProp, PsychroLib | Green |
| `MEP-CAP-11` | Smoke control and fire safety | **Strong** | FDS, CFAST, CONTAM | Green |
| `MEP-CAP-12` | Electrical load flow and short circuit | **Strong** | pandapower | Green |
| `MEP-CAP-13` | Cable sizing, voltage drop, selectivity | **Thin** | pandapower (fault currents only) | Green, but data is the problem |
| `MEP-CAP-14` | Lighting and daylight | **Strong** | Radiance | Green |
| `MEP-CAP-15` | PV and on-site generation | **Strong** | pvlib | Green |
| `MEP-CAP-16` | Acoustics, plant and duct-borne noise | **None** | none | n/a |
| `MEP-CAP-17` | Longitudinal profiles and 2D outputs | **None** | none | not an engine problem |

Three patterns show up in that table:

1. **Where the calculation is physics, open source has it covered.** Heat balance, pipe
   networks, airflow, fault currents, ray tracing: all solved, all permissively licensed.
2. **Where the calculation is a national code, open source has nothing**, and never will,
   because codes are paywalled, jurisdictional and revised. That boundary runs through this
   whole file, and it is why [`MEP-CALC-07`](./04-calculations.md) (clean export to
   certified tools) does not become redundant no matter how much gets integrated.
3. **The binding constraint is model data, not engines.** Every "Partial" rating in that
   table is limited by what the model can hand over, not by what the solver can do. This is
   the next section, and it is the part only That Open can build.

---

## What the model must carry (`MEP-DATA-*`)

Every capability below depends on the model supplying data it does not supply today. This is
the detailed version of [`MEP-CALC-01`](./04-calculations.md), listed once so the capability
sections can reference it instead of repeating it.

The **Reality today** column is the important one. It is written from opening real project
IFCs, and the picture is not good.

| ID | Data block | What it must carry | Authored by | Reality today |
| --- | --- | --- | --- | --- |
| `MEP-DATA-01` | **Spaces** | Bounded volume, floor area, clear and gross height, name and number, use type, conditioned/unconditioned flag | Architect | Usually present, frequently unbounded, wrong height, or missing in plant areas |
| `MEP-DATA-02` | **Space boundaries** | Every surface bounding a space: area, orientation, tilt, and **what is on the other side** (outside, ground, an adjacent conditioned space, or an unconditioned one). Boundaries matched in pairs across a wall (second-level boundaries) | Derived from architectural geometry | **Rarely usable.** The hardest item on this list and the one with the most value. Every thermal calculation is blocked without it |
| `MEP-DATA-03` | **Layered constructions and materials** | Layer order and thickness, and per material: **thermal conductivity λ (W/mK)**, density, specific heat capacity. Derived U-value and surface resistances | Architect | Layers often exist. **Thermal properties almost never do.** A wall arrives as geometry with a material *name* and nothing behind it |
| `MEP-DATA-04` | **Openings and glazing** | Area, U-value, **g-value**, frame fraction and frame ψ, opening type, integral and external shading | Architect | Geometry yes, performance data no |
| `MEP-DATA-05` | **Thermal bridges** | Junction types with linear transmittance ψ, or a defined allowance per boundary type | Architect / MEP | Never present. Must be an assumption object |
| `MEP-DATA-06` | **Site, orientation and climate** | Coordinates, **true north**, ground level, terrain, surrounding context geometry for shading, climate dataset reference, design outdoor conditions | Architect | Coordinates often absent or wrong, true north often unset. Cheap to fix, and blocks solar work entirely when wrong |
| `MEP-DATA-07` | **Internal gains and schedules** | Occupancy, lighting and equipment gains per space, with operating schedules | Client brief, entered by MEP | Never present. Not derivable from geometry. It needs a place to live in the model |
| `MEP-DATA-08` | **MEP zones and design conditions** | [`MEP-MOD-06`](./02-modelling-core.md): zone membership, setpoints, humidity, air change rate, pressure regime | MEP | Does not exist as a concept today |
| `MEP-DATA-09` | **Network topology** | [`MEP-MOD-04`](./02-modelling-core.md): nodes and edges, junction semantics, connection state, flow direction, elevations at both ends of every segment | MEP | Ports are commonly lost on export. A model that looks connected usually is not |
| `MEP-DATA-10` | **Element and product data** | Actual outer diameter, wall thickness or series, actual inner diameter, hydraulic diameter for non-circular sections, roughness (of the lining where one exists), product standard, length along route | MEP + product libraries ([`MEP-MOD-07`](./02-modelling-core.md), see "One diameter is several numbers" there) | Nominal size only. "DN100" is a label, and a solver cannot use a label |
| `MEP-DATA-11` | **Insulation and cladding** | Material, thickness, λ, resulting outer dimension, mass per metre | MEP ([`MEP-MOD-09`](./02-modelling-core.md)) | Rare, and usually only as a visual thickness |
| `MEP-DATA-12` | **Fluids and operating conditions** | Fluid per system, design flow and return temperatures, operating pressure | MEP ([`MEP-MOD-08`](./02-modelling-core.md)) | Never present |
| `MEP-DATA-13` | **Equipment and connectors** | Duty, design flow, pressure drop, empty and operating weight, electrical load, sound power. Connectors with size, type, position and system | MEP ([`MEP-EQP-02`](./03-equipment-and-families.md)) | Connectors frequently missing or wrong. Engineering data usually absent |
| `MEP-DATA-14` | **Component loss data** | K-factors or equivalent lengths per fitting, valve Kv/Kvs, coil and filter pressure drops | Libraries + manufacturer data | Never present. Half of a hydraulic calculation lives here |
| `MEP-DATA-15` | **Electrical distribution** | Boards, circuits, cable type and route length, connected and diversified loads, supply characteristics, protective devices | Electrical | Rarely modelled as a network at all |
| `MEP-DATA-16` | **Surface optical properties** | Reflectance, transmittance and specularity per surface. Luminaire positions and photometric file references | Architect + Electrical | Never present |
| `MEP-DATA-17` | **Catchment and drainage surfaces** | Definable catchment zones over terrain and roofs, each with an assignable runoff coefficient and an inlet it drains to, plus falls, terrain levels, invert and cover levels | Architect + MEP | Geometry yes. Zones, coefficients and inverts no |

### None of this is new: IFC already defines almost all of it

This changes what is being asked for. The platform is IFC-native, and nearly every block
above already has a first-class home in the IFC schema:

| Data block | IFC home |
| --- | --- |
| `MEP-DATA-01` spaces | `IfcSpace` |
| `MEP-DATA-02` space boundaries | `IfcRelSpaceBoundary` (second-level in IFC4+), defined precisely for thermal exchange |
| `MEP-DATA-03` layered constructions | `IfcMaterialLayerSet` with thermal material properties. U-value as `ThermalTransmittance` in the common psets |
| `MEP-DATA-04` glazing performance | `Pset_WindowCommon` and the glazing psets (U-value, solar transmittance) |
| `MEP-DATA-08` zones, many-to-many | `IfcZone`: grouping, exactly the semantics [`MEP-MOD-06`](./02-modelling-core.md) asks for |
| `MEP-DATA-09` network topology | `IfcDistributionPort` + `IfcRelConnectsPorts`: connectors and connection state as real objects |
| Systems ([`MEP-MOD-05`](./02-modelling-core.md)) | `IfcSystem` / `IfcDistributionSystem` |
| `MEP-DATA-11` insulation | `IfcCovering` (insulation type) related to the covered element |

(This is an entity-level mapping. Exact property sets should be verified against IFC4x3
during design, and a few things really are missing from IFC, slope-as-constraint being the
notable one.)

So the ask is **not** "invent an MEP schema". It is: make the semantics that IFC already
defines, and that every exporter mangles and every importer drops, *authorable, queryable
and reliable* in the shared model. The concepts survived twenty years of committee review.
What never existed is a platform where they are born correct instead of reconstructed from a
file. That is also the interoperability story for [`MEP-CALC-07`](./04-calculations.md):
data that lives in IFC-shaped concepts exports to IFC without a mapping layer inventing
meaning on the way out.

### What that table means

**1. The blocking data is architectural, not MEP.** `MEP-DATA-01` through `MEP-DATA-07` are
authored by the architect, and they are the ones that do not exist. Everything MEP-side we
can author ourselves. That is our job and we are willing to do it. What we cannot do is
re-enter someone else's building, which is precisely what we do today.

This is the strongest argument for a shared model rather than exchanged files. **The
architect authors the wall build-up once, in the model everyone is already working in, and
it never gets re-entered by anybody.** No export, no IFC round-trip, no version drift. Where
the model is a file that gets handed on, that data degrades at every hop: properties dropped
by an exporter, boundaries rebuilt by an importer, a revision that arrived after somebody
already ran their calculation.

**2. Some of it can never come from geometry.** Internal gains, schedules, infiltration and
leakage paths, thermal bridge allowances, design conditions. No geometry engine will ever
produce these. They are engineering decisions. The model needs somewhere for an engineer to
author them **against model objects**, with an author, a date and a source: that is
[`MEP-CALC-03`](./04-calculations.md) assumption objects, and without it none of the
capabilities below can run on a real project.

**3. Missing data must fail loudly.** The temptation with a half-populated model is to
default the gaps and produce a number anyway. Every tool that does this has misled an
engineer at some point. A calculation run on silently assumed U-values is worse than no calculation,
because it looks like an answer and gets signed. Every adapter should report exactly what
was missing, per element, and refuse to produce a headline figure when the inputs are not
there.

**Levels of readiness.** A model should be able to answer "what could I calculate with
this?". If `MEP-DATA-01` to `-06` are present, loads are possible. If `-09` to `-14` are
present, hydraulics are possible. A readiness check per capability would tell an engineer
what to fix before they waste an hour discovering it the hard way (`MEP-INT-01`).

### Where the leverage is

Counting how many capabilities each block unlocks, the ranking is clear:

| Data block | Capabilities it unlocks | Comment |
| --- | --- | --- |
| `MEP-DATA-01` + `-02` + `-03`: **spaces, boundaries, layered constructions with λ** | 8 of 17 | The envelope triple. Nothing thermal happens without it, and it is architectural data we cannot author ourselves |
| `MEP-DATA-13`: **equipment with real connectors** | 9 of 17 | Cheap, MEP-authored, and already specified in [`MEP-EQP-02`](./03-equipment-and-families.md) |
| `MEP-DATA-09`: **network topology** | 8 of 17 | [`MEP-MOD-04`](./02-modelling-core.md). The other half of everything |
| `MEP-DATA-06`: **site, true north, climate** | 8 of 17 | Nearly free, frequently wrong, and silently ruins every solar result |

If only three things get built, build the envelope triple. Everything rated **Partial** in
the summary matrix moves toward **Strong** on the back of it, and it is the one part of
this entire spec that an MEP engineer cannot properly fix alone. It is another discipline's
data, and re-entering it ourselves is exactly the waste this spec is about.

---

## MEP-CAP-01: Design heat load (heating)

**Coverage: Partial.** Engine: **[EnergyPlus](https://github.com/NREL/EnergyPlus)** (BSD-3
with trademark clause).

**What is needed.** Per-room design heat load at design outdoor conditions, computed to the
normative method (**EN 12831-1** in Europe), including transmission losses, ventilation and
infiltration losses, thermal bridges, adjacent unheated space corrections, and a heating-up
allowance. This is what radiators, coils and heat pumps get sized from, and it is a signed
deliverable.

**Model inputs.** `MEP-DATA-01` spaces, `-02` **space boundaries with what is on the other
side**, `-03` **layered constructions with λ per material**, `-04` openings with U and
g-values, `-05` thermal bridges, `-06` site and design outdoor conditions. Plus an
infiltration assumption per space, which is not derivable from geometry.

Without `-02` and `-03` this capability simply cannot run. Those are exactly the two that a
typical model does not have. Everything else on this page is easier than these two.

**What open source covers, and how far.** EnergyPlus performs design-day sizing and will
produce a defensible peak heating load from a full heat balance. The physics is better than
what EN 12831 requires. But **EnergyPlus does not implement EN 12831**, and the difference
matters: EN 12831 has prescribed correction factors, prescribed treatment of adjacent
unheated spaces, prescribed infiltration assumptions and a prescribed heating-up allowance. A
number from an unconstrained heat balance and a number from EN 12831 are both correct, and
neither substitutes for the other on a submission. Small open EN 12831 implementations exist
(OpenEnergyMonitor's [`heatloss.js`](https://openenergymonitor.org/heatlossjs/)) but they
are residential-scale and not a basis to build on.

**Gaps to build.**

- A normative EN 12831-1 calculation layer over the same envelope data. This is arithmetic,
  not simulation: bounded, testable, a few weeks of engineer-supervised work, not a research
  project.
- Envelope extraction to feed either path: space boundaries, constructions, U-values. This
  is `MEP-CALC-01` and is the truly hard part, shared with everything below.
- National parameter sets: design outdoor temperature, ground temperatures, correction
  factors by country.
- Per-room results written back and rolled up to zones and systems.

**Legal, licensing and compliance.**

- The EnergyPlus licence is BSD-3 plus a **trademark clause**: "EnergyPlus", "E+" or similar
  cannot appear in product names, company names or promotional material without written DOE
  consent, unless distributing an unmodified version ("EnergyPlus version X"). *Mitigation:*
  this constrains marketing, not code, so it is safest not to name an app after the
  engine.
- **EN 12831 is a paywalled standard.** The method can be implemented, since methods are not
  copyrightable, but the standard's text and tables cannot be redistributed. *Mitigation:*
  implement from the standard, cite the clause, ship no reproduced text or tables, and
  require the user to hold their own copy. This is how every commercial tool does it.
- Professional liability: engineers sign these numbers. *Mitigation:* the `MEP-INT-06`
  validation corpus, and full input traceability per
  [`MEP-CALC-04`](./04-calculations.md).

---

## MEP-CAP-02: Cooling load

**Coverage: Strong.** Engine: **EnergyPlus**.

**What is needed.** Peak cooling load per space and per zone, including solar gains through
glazing with shading, thermal mass and time lag, internal gains from people, lighting and
equipment, and latent load. Sizes coils, chillers and air volumes.

**Model inputs.** Everything `MEP-CAP-01` needs, plus `MEP-DATA-07` internal gains and
schedules, and `-06` context geometry for shading from surrounding buildings. Construction
data must include **density and specific heat**, not only λ. Thermal mass is what makes a
cooling load different from a heat loss, so `MEP-DATA-03` has to be complete.

**What open source covers, and how far.** This is EnergyPlus at its best. Full heat balance
with mass and radiant exchange, well beyond the simplified methods most commercial tools
use. Design-day sizing gives peak loads directly. No normative-method conflict here, since
cooling load is engineering practice rather than a prescribed national calculation in most
jurisdictions, so the simulated result *is* the deliverable.

**Gaps to build.**

- Same envelope extraction as `MEP-CAP-01`.
- Internal gain and occupancy schedules. This needs a usable interface, since this is where
  design decisions actually get made and where the engineer must be in control.
- Shading from surrounding buildings and site context.
- Results mapped onto spaces and zones, and onto the terminals serving them.
- Weather data: EPW files are freely available, but the platform should manage them so the
  engineer is not hunting for a file.

**Legal, licensing and compliance.**

- EnergyPlus trademark clause as above.
- ASHRAE-method tools (RTS, CLTD) reproduce copyrighted ASHRAE tables. *Mitigation:* stay on
  the EnergyPlus heat-balance path and the question never arises.
- Weather files: check redistribution terms per source. *Mitigation:* reference or fetch
  rather than bundling.

---

## MEP-CAP-03: Whole-building energy simulation

**Coverage: Strong.** Engines: **EnergyPlus** +
**[OpenStudio SDK](https://openstudiocoalition.org/about/software_license/)** (BSD-3).
Optionally **[Modelica Buildings Library](https://github.com/lbl-srg/modelica-buildings)**
(BSD-3) for dynamic plant and controls.

**What is needed.** Annual energy consumption by end use, run against the design, for
comparing options: glazing, plant, control strategy, heat recovery.

**Model inputs.** `MEP-DATA-01` to `-07` in full, plus `-08` zones and `-13` equipment with
duties, and annual schedules rather than design-day snapshots. This is the most data-hungry
capability in the file: it needs the complete envelope *and* the systems *and* how both are
operated over a year.

**What open source covers, and how far.** Completely. EnergyPlus is the reference engine
worldwide and OpenStudio gives an object-oriented API, gbXML and IFC import, workflow
automation and results extraction. Write adapters against OpenStudio, not against IDF text.

**Gaps to build.**

- Envelope extraction (again, it is the recurring dependency).
- HVAC system templates so an engineer picks "VAV with heat recovery" instead of assembling
  an E+ system by hand. OpenStudio has some of this.
- Results presentation and option comparison, which is most of the perceived value.
- Run management: annual simulation is minutes and gigabytes, so async execution with
  progress and artefact retention (`MEP-INT-01`).

**Legal, licensing and compliance.**

- Both BSD-3. Trademark clause on EnergyPlus.
- Results are **not** a compliance deliverable. See `MEP-CAP-04`. *Mitigation:* label them
  as engineering analysis in the UI. An energy model that looks like a certificate will
  eventually be handed to someone as one.

---

## MEP-CAP-04: National energy certificate / code compliance

**Coverage: None.** And it will stay that way.

**What is needed.** The legally required energy performance calculation, in Poland the
*świadectwo charakterystyki energetycznej*, elsewhere its national equivalent, produced by
the national method and, in many jurisdictions, by accredited software.

**Model inputs.** The same blocks as `MEP-CAP-03`, but the requirement here is different in
kind. The data does not need to reach *our* engine, it needs to reach *theirs*, intact,
through gbXML or IFC. Which means `MEP-DATA-02` and `-03` must survive export with their
properties attached, not just their geometry. Export fidelity is the whole capability.

**What open source covers.** Nothing, and no open engine will. National methods are
paywalled, jurisdiction-specific, revised on political timescales, and often require
software accreditation that an open project cannot obtain.

**Gaps to build.** None from our side. We propose leaving this one out deliberately, since
building it would bring accreditation obligations without matching value. What matters is
not blocking it.

**Legal, licensing and compliance.**

- Accreditation requirements are jurisdictional and can be absolute.
- *Mitigation (and this is the actual requirement):* [`MEP-CALC-07`](./04-calculations.md).
  Clean gbXML/IFC export, good enough that the certified national tool imports it **without
  manual repair**. "Exports something" is not the bar. If the platform nails export, the
  compliance step stops being a rebuild and becomes a load-and-run. That captures most of
  the value without any of the liability.

---

## MEP-CAP-05: Ventilation airflow, infiltration and pressure regimes

**Coverage: Strong.** Engine:
**[CONTAM](https://www.nist.gov/services-resources/software/contam)** (NIST, public domain).

**What is needed.** Multizone airflow: infiltration and exfiltration, room-to-room flows,
stack effect, wind pressure, mechanical ventilation interaction, pressure cascades for clean
rooms, kitchens and isolation rooms, contaminant and CO₂ transport.

**Model inputs.** `MEP-DATA-01` spaces, `-02` boundaries (for what connects to what, and to
outside), `-06` site and wind exposure, `-08` zones and pressure regimes, `-09` duct
network, `-13` fans with characteristics. Plus **leakage path data** (crack lengths and
leakage coefficients per boundary type), which no BIM model contains and which is the single
largest driver of the result. That needs a defaults library keyed to construction type, with
engineer override, and it needs to be visible that it *is* an assumption.

**What open source covers, and how far.** CONTAM is the reference multizone airflow model
and is public domain. It covers all of the above and is well validated. It is also almost
unknown outside research, which is a shame, because pressure-regime design is done by rule
of thumb on most projects.

**Gaps to build.**

- Model → CONTAM input generation: zones, leakage paths, ducts, fans, schedules. Leakage
  path data in particular does not exist in a BIM model and needs a defaults library plus
  engineer override.
- CONTAM ships as a Windows toolchain. Check current source and cross-platform availability
  before committing to it in a Linux cloud runtime (`MEP-INT-02`).
- Results back onto spaces and zones: flows, pressures, air change rates.
- A user interface aimed at design engineers, which CONTAM's own research-oriented tooling
  was never meant to be.

**Legal, licensing and compliance.**

- Public domain. No obligations beyond honest attribution.
- Ventilation *rates* are prescribed by national code and by EN 16798-1. CONTAM computes
  flows. It does not tell you what the code requires. *Mitigation:* required rates are
  assumption objects ([`MEP-CALC-03`](./04-calculations.md)) entered by the engineer, with
  the calculation checking against them rather than inventing them.

---

## MEP-CAP-06: Duct sizing and pressure drop

**Coverage: Partial.** Engines: **[pandapipes](https://www.pandapipes.org/)** (BSD-3),
**[fluids](https://github.com/CalebBell/fluids)** (MIT), **CONTAM** (public domain).

**What is needed.** Size ducts to a velocity or friction-rate criterion, compute the
pressure drop along the index run including every fitting, size the fan, and produce
balancing data.

**Model inputs.** `MEP-DATA-09` network topology with junction semantics, `-10` actual duct
dimensions, not nominal labels, `-11` insulation for outer dimension and heat gain, `-12`
air properties at design condition, `-13` terminals with design airflows and fans with
curves, `-14` fitting loss coefficients. Airflows per zone come from `-08` and ultimately
from `MEP-CAP-02`.

The two most critical: a **tee must know which leg is the main and which is the branch**,
because its loss coefficient differs several times between the straight run and the branch,
and every segment needs elevations at both ends. Both can be inferred from geometry while
the geometry is there, and both are lost the moment the network leaves as bare topology.
Cheap to carry, expensive to reconstruct downstream.

**What open source covers, and how far.** No dedicated open-source duct-sizing engine
exists. I looked specifically, and this is the clearest gap in the whole file. But every
piece is available: pandapipes solves the network (it handles compressible and
incompressible media, and low-pressure air is comfortably incompressible), `fluids` supplies
friction factors and fitting K-factors, CONTAM handles airflow networks with fans, and
PsychroLib and CoolProp supply air properties. So the physics is covered. The *design loop*
is not.

**Gaps to build.**

- The sizing loop itself (equal friction, constant velocity, or static regain), specified
  as [`MEP-CALC-08`](./04-calculations.md). This is the feature, and it is ours. It is not
  hard. It is just not written.
- **Fitting loss data for duct fittings**, which is the real obstacle. See below.
- Index-run identification, fan selection, balancing damper positions.
- Rectangular-to-round equivalence, aspect-ratio penalties, transitions.
- Graph → engine mapping ([`MEP-MOD-04`](./02-modelling-core.md)) and results back onto
  elements.

**Legal, licensing and compliance.**

- pandapipes BSD-3, `fluids` MIT, CONTAM public domain. All clean.
- **The ASHRAE Duct Fitting Database is commercial**, and it is what the industry uses for
  duct fitting losses. Its data cannot be embedded. *Mitigation, in order of preference:*
  - use the published correlations in `fluids` and classical sources for the common
    fittings,
  - let the engineer enter K-factors per fitting type in their office standard
    ([`MEP-MOD-02`](./02-modelling-core.md) rule sets are the natural home),
  - let users who hold an ASHRAE licence supply their own data. The database itself cannot
    be shipped.
- Velocity and noise limits come from standards and client briefs, not from the solver.
  *Mitigation:* assumption objects, as with ventilation rates.

**Notes.** Because the physics is covered and only the design layer is missing, a duct
sizing and balancing app is an assembly job rather than a research project. That makes it an
excellent candidate for the first third-party MEP app on Connect, and a good test of whether
the contract in [`04`](./04-calculations.md) is actually sufficient.

---

## MEP-CAP-07: Hydronic sizing and balancing

**Coverage: Partial**, tending to Strong. Engines:
**[EPANET](https://github.com/USEPA/epanet-engine)** (public domain), **pandapipes**
(BSD-3), **fluids** (MIT), **[CoolProp](https://github.com/CoolProp/CoolProp)** (MIT).

**What is needed.** Size pipework for heating, chilled water and condenser circuits. Compute
pressure drops, velocities and pump head. Set balancing valve presettings. Check valve
authority. Verify differential pressure at every terminal.

**Model inputs.** `MEP-DATA-09` topology with **elevations at both ends of every segment**
(static head is not optional in a building with risers), `-10` inner diameter, roughness and
length along route, `-11` insulation for heat loss along the circuit, `-12` fluid, glycol
concentration and design flow and return temperatures, `-13` equipment, pumps and terminals
with design flows and pressure drops, `-14` fitting K-factors and valve Kv.

Terminal design flows come from the loads in `MEP-CAP-01` and `MEP-CAP-02`. This is the
first real example of one calculation feeding another through the model rather than through
a spreadsheet.

**What open source covers, and how far.** The network solve is fully covered, twice over.
EPANET is small, fast, public domain, has a documented toolkit API, and is already the
engine inside several commercial water packages. pandapipes is the better fit for closed
circuits and district systems because it couples a heat-transfer calculation to the
hydraulics, which matters when return temperature is a design variable. `fluids` supplies
fitting losses. CoolProp supplies water and glycol properties at the design temperature.

On **automatic sizing**, checked rather than assumed: neither EPANET nor pandapipes selects
diameters natively. Both analyse the network they are given, and that is fine. Picking a
size from the computed flow against a velocity or pressure-gradient criterion is
deliberately platform-side work ([`MEP-CALC-08`](./04-calculations.md)). Where a full
propose-solve-repeat loop is needed, the pattern is already proven around EPANET
(WaterNetGen, an academic extension that sizes against a commercial diameter catalogue),
and WNTR (EPA) provides a modify-and-rerun API for exactly this.

**Gaps to build.**

- The sizing loop, specified as [`MEP-CALC-08`](./04-calculations.md). The solvers analyse
  a given network. They do not choose diameters. Velocity and pressure-gradient criteria
  per system, iterating to a sized network, is ours.
- Balancing: valve presetting calculation and authority check.
- Terminal demand derivation from the loads in `MEP-CAP-01` and `MEP-CAP-02`.
- Graph → engine mapping, including fittings as K-factors or equivalent lengths, and
  elevations for static head.
- Results back onto elements, with warnings anchored to the element that caused them.

**Legal, licensing and compliance.**

- EPANET public domain, pandapipes BSD-3, `fluids` and CoolProp MIT. Nothing to manage.
- Valve Kv/Kvs data is manufacturer property. *Mitigation:* generic defaults for design,
  with manufacturer data entered per project. The same pattern as
  [`MEP-EQP-06`](./03-equipment-and-families.md).

**Notes.** EPANET's engine is compact C with a clean toolkit API, and others have compiled
it to WebAssembly. If that holds up, hydraulic calculation could run **in the browser
against the live model** while you route pipe. This is worth a quick verification, because a
live hydraulic result during routing is a feature that makes people switch software.

---

## MEP-CAP-08: Domestic water and gas

**Coverage: Partial.** Engines: **EPANET** (water, public domain), **pandapipes** (gas,
BSD-3).

**What is needed.** Size cold and hot water distribution and gas pipework. Apply loading
units and simultaneity to get design flows. Verify pressure at the least favourable outlet.
Size the incoming service.

**Model inputs.** `MEP-DATA-09`, `-10`, `-12` as for hydronics, plus a **fixture
inventory**: every outlet with its type and loading units, which is a property that has to
exist on the fixture family (`MEP-DATA-13`). For gas, appliance connected loads. For hot
water, recirculation loop topology and insulation (`-11`), because dead legs and loop heat
loss are the two things that actually go wrong.

**What open source covers, and how far.** The network solve, entirely. What neither engine
covers is the layer *in front* of it: converting fixture counts into design flows via
loading units and simultaneity curves, which is prescribed by national and European
standards (EN 806, DIN 1988, and national deviations). That layer is arguably the harder
half of the job in practice.

Worth saying plainly: **writing our own simplified solver is also a legitimate option
here**, and maybe the natural one. Domestic water and gas networks are trees, not loops
(the hot water recirculation ring is the one exception, and its circulated flow is set by
design rather than solved for). In a tree, the flow in every segment follows directly from
the demands downstream of it,
so there is nothing to iterate: sum the flows by traversing the graph, then accumulate
pressure drop along each path with Darcy-Weisbach and the K-factors from `fluids`, and
check the least favourable outlet. That is a few hundred lines of code, not a research
project. The heavyweight engines earn their keep on looped networks, pressure-dependent
demand and time simulation, which these systems rarely need. The validation rules of the
[playbook](./07-implementation-playbook.md) apply to an own solver exactly as they do to an
adapter, and are the reason this option is safe to take.

**Gaps to build.**

- Loading-unit and simultaneity calculation, per selectable standard.
- Fixture library with loading units by type.
- Hot water: recirculation loop sizing, heat loss, dead-leg checks.
- Gas: diversity, meter and regulator sizing, pressure-tier handling.
- Or, taking the option above, the simple tree solver itself, validated against worked
  examples.

**Legal, licensing and compliance.**

- Engine licences clean.
- **EN 806 / DIN 1988 are paywalled.** *Mitigation:* implement the method, cite the clause,
  ship no reproduced tables. Make the standard selectable so national variants are explicit
  rather than assumed.

---

## MEP-CAP-09: Drainage, building and site

**Coverage: Partial.** Strong for site, thin for in-building. Engine:
**[SWMM](https://github.com/USEPA/Stormwater-Management-Model)** (US EPA, public domain).

**What is needed.** *Site:* rainfall intensity by return period, catchment areas, runoff,
gravity network sizing, part-full flow, surcharge and attenuation. *Building:* foul and
rainwater stack sizing, branch sizing, stack ventilation, gully and trap sizing.

**Model inputs.** `MEP-DATA-17` roof and paved areas, terrain levels, **invert and cover
levels**, `-09` gravity network topology with slopes, `-10` pipe inner diameter and
roughness, `-06` site and rainfall reference. For in-building, a discharge-unit property on
every sanitary fixture (`-13`).

The catchment side needs its own concept: **catchment zones**. Not a free drawn polygon,
and not a property buried in the roof or terrain object either, but both roles split
cleanly:

- The **runoff coefficient default lives on the surface**, keyed to its build-up or surface
  type: asphalt, paving, gravel, lawn, permeable paving, membrane roof, green roof. The
  surface proposes its coefficient the same way a wall build-up proposes its U-value.
- The **zone boundary is its own object**, because a drainage divide does not respect
  object boundaries. One roof drains to four outlets, and one paved area can split between
  an inlet and the street. Zones are derived automatically from the surfaces and their
  falls (the per-outlet split as a first pass), then adjusted or drawn by the engineer
  where reality disagrees.
- The zone **references the surfaces it covers**, so its area stays live when the architect
  changes the geometry, coefficient defaults flow up from the surfaces underneath, and an
  engineer's override is stored and shown as an override, per the assumption philosophy of
  [`MEP-CALC-03`](./04-calculations.md).
- Each zone is assigned to the inlet or outlet it drains to, and reports its area and its
  effective (coefficient-weighted) area.

The roof is the same mechanism, not a special case. The coefficient spread is why none of
this can be assumed globally: a membrane roof is close to 1.0, a gravel roof less, a green
or retention roof much less, and retention roofs are increasingly a planning condition
rather than a rarity.

Note also what is being asked of the model here: **slope and invert level as real
properties**, not as a consequence of where the geometry happens to sit. That is
[`MEP-MOD-03`](./02-modelling-core.md), and it is why slope is a P0 modelling requirement
rather than a drafting convenience.

**What open source covers, and how far.** SWMM covers the site case comprehensively
(catchments, runoff, part-full flow, surcharge, combined systems) and is public domain. It
is not built for building drainage stacks, where the governing rules (EN 12056, EN 752,
national codes) are prescriptive discharge-unit methods rather than hydraulic simulation.
SWMM is neither intended nor needed for stacks.

**Gaps to build.**

- The catchment zone tool itself: define zones over terrain and roofs, assign coefficients
  from the surface-type library, attach zones to inlets and outlets, and keep zone areas
  live against the geometry they sit on. The model has the geometry. Nothing else does.
- Automatic first-pass roof sub-catchment split per roof outlet, from the roof falls.
- Terrain integration for site levels and falls.
- In-building: discharge-unit method per selectable standard, stack and branch sizing, vent
  sizing. Arithmetic, not simulation.
- Rainfall intensity data by region and return period, as an assumption object.

**Legal, licensing and compliance.**

- SWMM public domain.
- EN 12056 / EN 752 paywalled. Same mitigation as above.
- Rainfall data licensing varies by national meteorological service, and some are
  restrictive. *Mitigation:* an engineer-entered value with a documented source, rather than
  a bundled dataset.

---

## MEP-CAP-10: Fluid properties and psychrometrics

**Coverage: Full.** Engines: **CoolProp** (MIT),
**[PsychroLib](https://github.com/psychrometrics/psychrolib)** (MIT).

**What is needed.** Density, viscosity, specific heat and conductivity for water, glycol
mixtures, air, gas and refrigerants, at the design temperature. Psychrometrics for all air
processes. This is [`MEP-MOD-08`](./02-modelling-core.md).

**Model inputs.** Only `MEP-DATA-12`: a fluid assigned per system and a design temperature.
That is it. **The model has to carry almost nothing, which is exactly why this capability is
rated Full and everything else is not.** It is a useful control case: the gap elsewhere is
never the physics, it is the data.

**What open source covers, and how far.** All of it. CoolProp covers 100+ fluids and
mixtures with high-accuracy equations of state, brines and glycols, and psychrometrics.
PsychroLib implements ASHRAE Fundamentals psychrometrics and, importantly, has a
**JavaScript build**, so it runs client-side in an app with no adapter at all.

**Gaps to build.** Essentially none. Wire them in as platform utilities, expose fluid
selection at system level, done. This is the cheapest item in the file by a wide margin and
should not be treated as an integration project.

**Legal, licensing and compliance.**

- Both MIT. Attribution only.
- **REFPROP is sometimes assumed free because NIST wrote it. It is commercial.**
  *Mitigation:* CoolProp covers the same need, so REFPROP is simply not required here.
- PsychroLib implements published ASHRAE equations, which is the accepted practice.

---

## MEP-CAP-11: Smoke control and fire safety

**Coverage: Strong.** Engines:
**[FDS / CFAST / Smokeview](https://github.com/firemodels/fds)** (NIST, **public domain**,
US federal work not subject to copyright), **CONTAM**.

**What is needed.** In most of Europe smoke extraction is designed by the HVAC engineer. The
needs are smoke movement, extraction rates, pressure differentials for stair pressurisation,
and tenability.

**Model inputs.** `MEP-DATA-01` and `-02` for the enclosure, `-03` constructions, here for
their thermal response to fire rather than their U-value, `-06` for external conditions,
`-09` and `-13` for the extract and pressurisation systems. Plus **fire compartment
boundaries with their ratings**, which is neither architectural nor MEP data today and
usually lives on a coloured PDF.

**What open source covers, and how far.** FDS is the reference fire and smoke CFD and is
used for approvals worldwide. CFAST covers the zone-model cases. CONTAM handles
pressurisation network analysis. Between them the technical ground is covered by public
domain software.

**Gaps to build.**

- Geometry and mesh generation from the model: non-trivial, and the main obstacle.
- Fire scenario definition, which is engineering judgement, not automation.
- Compute: FDS runs are hours to days on many cores. This is a scheduling and cost problem
  before it is a technical one.
- Results presentation and reporting for approvals.

**Legal, licensing and compliance.**

- Public domain. No obligations.
- **Fire safety approvals are jurisdictional and usually require a qualified fire engineer**
  regardless of the software. *Mitigation:* position this as analysis supporting a fire
  engineer, never as an approval output. Realistically this is P2 or later. It is listed
  because the licensing is unusually favourable and the option is worth knowing about.

---

## MEP-CAP-12: Electrical load flow and short circuit

**Coverage: Strong.** Engine:
**[pandapower](https://www.pandapower.org/about/)** (BSD-3). Also
**[OpenDSS](https://opendss.epri.com/)** (BSD-3, EPRI),
**[GridLAB-D](https://www.gridlabd.org/)** (BSD-style),
**[PyPSA](https://pypsa.org/)** (MIT).

**What is needed.** Load flow across the distribution, voltage at each board, and
prospective short-circuit currents to **IEC 60909**, which is what European electrical
designers calculate to and what protective device selection depends on.

**Model inputs.** `MEP-DATA-15` distribution as a **network**: boards, sub-mains and final
circuits with their connections, cable types and **route lengths taken from the modelled
route rather than estimated**, transformer and supply characteristics, connected loads with
diversity. Plus `-13` equipment electrical loads and `-01` spaces to attribute them to.

Route length is an easy win here. It is in the model already, it is guessed today, and it
drives both voltage drop and fault level.

**What open source covers, and how far.** pandapower implements
[IEC 60909 short-circuit calculation](https://pandapower.readthedocs.io/en/stable/shortcircuit/currents.html)
for three-phase, two-phase and single-phase faults, with both the equivalent voltage source
and superposition methods, and handles converter-interfaced sources per the 2016 revision.
It also has load flow, optimal power flow and topological graph search, which maps directly
onto the network graph in [`MEP-MOD-04`](./02-modelling-core.md). For building-scale work
this is a strong fit and better documented than most commercial equivalents.

**Gaps to build.**

- Building-scale modelling conventions: boards, sub-mains, final circuits. pandapower's
  model is utility-shaped and needs a translation layer.
- Cable and transformer parameter library for building-scale equipment.
- Load schedules with diversity per circuit and per board.
- Results back onto boards and cables.

**Legal, licensing and compliance.**

- BSD-3 and MIT throughout. Clean.
- **IEC 60909 is paywalled.** The implementation already exists in pandapower, so this is
  mainly a documentation and citation question. *Mitigation:* cite the standard and version,
  reproduce none of it.
- **An electrical engineer should review this section before it informs a roadmap.** I am
  reporting what I found, not speaking from practice.

---

## MEP-CAP-13: Cable sizing, voltage drop and selectivity

**Coverage: Thin.** Engine: pandapower supplies fault currents. Nothing else applies.

**What is needed.** Size cables to IEC 60364: current-carrying capacity with installation
method, grouping and ambient derating, voltage drop, disconnection time, earth fault loop
impedance. Then select protective devices and verify discrimination and cascading between
them.

**Model inputs.** `MEP-DATA-15`, plus the properties that decide derating and which no model
carries today: **installation method** (in conduit, on tray, buried, in insulation),
**grouping** with other circuits along the shared route, and **ambient temperature** along
that route. The route is modelled. What it passes through is not recorded. A cable tray that
knows which circuits share it ([`MEP-MOD-04`](./02-modelling-core.md) applied to
containment) would supply the grouping factor automatically.

**What open source covers, and how far.** Very little, and this is the second real gap in
the file. pandapower gives prospective fault currents, which is a genuine input to device
selection. Everything else (derating tables, device characteristics, discrimination curves)
is either standards text or manufacturer data. Neither is open.

**Gaps to build.** Effectively the whole feature: derating table implementation, voltage
drop, disconnection-time verification, a protective device library, discrimination checking.

**Legal, licensing and compliance.**

- **IEC 60364 is paywalled**, and its tables are the substance of the calculation.
  *Mitigation:* implement the method and require users to hold the standard. Ship no
  reproduced tables. The same posture as every commercial tool.
- **Device characteristics and discrimination tables are manufacturer property**, usually
  distributed free but under terms. *Mitigation:* a data model users populate, plus
  manufacturer-supplied data where terms permit, not a bundled library.
- *My recommendation:* do not pick this as a first integration. The engine story is weak and
  the data story is worse. Better as a third-party app by someone with manufacturer
  relationships.

---

## MEP-CAP-14: Lighting and daylight

**Coverage: Strong** for physics, **Thin** for the design workflow. Engine:
**[Radiance](https://en.wikipedia.org/wiki/Radiance_(software))** (LBNL, permissive
BSD-like project licence).

**What is needed.** Interior lighting design to EN 12464 (illuminance, uniformity, glare),
plus daylight factor and annual daylight metrics, and the solar gains that feed cooling
load.

**Model inputs.** `MEP-DATA-01` and `-02` for room geometry, `-16` **surface reflectances
and glazing transmittance**, which need to be real numbers on real surfaces rather than a
render material, `-04` glazing and shading, `-06` site and orientation for daylight, plus
luminaire positions with photometric file references. Task areas per space (where the
required illuminance actually applies) are an assumption object, not geometry.

**What open source covers, and how far.** Radiance is the reference physically-based
lighting engine and produces results accepted for design and research. What it does not have
is a workflow: no GUI, text file I/O, and no notion of code compliance.

**Gaps to build.**

- Model → Radiance scene generation, with surface reflectances and material properties.
- Luminaire photometry handling: IES and EULUMDAT files, which manufacturers distribute
  freely.
- EN 12464 compliance checking over the results: required illuminance by task area,
  uniformity, UGR.
- Results presentation: false-colour maps, grid results, a report an engineer can issue.

**Legal, licensing and compliance.**

- Radiance's licence is permissive but project-specific. *Mitigation:* read the attribution
  clause before shipping. Do not assume plain BSD-3.
- **EN 12464 is paywalled.** Same mitigation as elsewhere.
- Photometric files are manufacturer property. Distribution terms are usually permissive but
  vary. *Mitigation:* users supply their own files.

---

## MEP-CAP-15: PV and on-site generation

**Coverage: Strong.** Engine: **[pvlib](https://pvlib-python.readthedocs.io/)** (BSD-3),
with **PyPSA** (MIT) where storage or a microgrid is involved.

**What is needed.** Array yield from geometry, orientation and climate. Shading. Inverter
sizing. Annual generation for the energy balance. On most projects now, and usually done in
a spreadsheet.

**Model inputs.** `MEP-DATA-06` coordinates, **true north** and context geometry for
shading, `-17` roof areas with pitch and orientation, `-15` to connect the output into the
electrical model. Almost all of this is geometry the model already holds. That makes this
one of the cheapest capabilities here, provided true north is set correctly. It frequently
is not.

**What open source covers, and how far.** pvlib is mature, well documented and covers
irradiance modelling, array geometry, module and inverter models and loss chains.

**Gaps to build.**

- Roof geometry and orientation extraction, plus shading from the model's own context: the
  one thing a spreadsheet cannot do and the model can.
- Module and inverter selection.
- Feeding the result into the electrical model (`MEP-CAP-12`) and the energy balance
  (`MEP-CAP-03`).

**Legal, licensing and compliance.** BSD-3 and MIT. Irradiance datasets have their own
terms. Check per source rather than bundling.

---

## MEP-CAP-16: Acoustics, plant and duct-borne noise

**Coverage: None identified.**

**What is needed.** Plant room noise breakout, duct-borne noise to occupied spaces,
attenuator sizing, NR/NC verification against the brief.

**Model inputs.** `MEP-DATA-01` and `-02` for the receiving room, `-03` for construction
sound reduction indices, `-09` and `-13` for the duct path and the plant at the end of it,
plus **sound power data** per equipment item and per fitting, which is manufacturer property
and absent from every model.

**What open source covers.** I did not find a credible open-source engine for building
services acoustics. I state that as "none found", not as "none exists". This is the one
capability I have not researched to the same depth, and corrections are welcome.

**Gaps to build.** All of it, if it is wanted at all.

**Legal, licensing and compliance.** Sound power data is manufacturer property. The
attenuation calculation methods are in paywalled standards and ASHRAE. Same posture as
elsewhere. Low priority. Noted for completeness so the map has no blank spots.

---

## MEP-CAP-17: Longitudinal profiles and 2D outputs

**Coverage: None.** Deliberately so. This is not an engine problem.

**What is needed.** [`MEP-DWG-01`](./04-calculations.md): longitudinal profile drawings
along external and underground routes, at different horizontal and vertical scales. And
[`MEP-DWG-02`](./04-calculations.md): P&ID and riser diagrams, which are a mandatory
deliverable on every MEP project and today mean a separate 2D CAD licence.

**Model inputs.** For profiles: `MEP-DATA-09` the route with chainage, `-10` sizes and
materials, `-17` terrain levels along the route and invert and cover levels at every point,
plus crossing services and their clearances. For diagrams: the system graph (`-09`) with
equipment and in-line components (`-13`), since a schematic is a projection of that graph.
Purely geometric and topological. No engineering data needed, which makes this the only
capability here whose model inputs are already almost complete.

**What open source covers.** Nothing relevant. This is drafting, not physics. For diagram
auto-layout, generic graph-layout libraries exist and can help a best-effort first pass,
but the deliverable-quality layout comes from the engineer editing it.

**Gaps to build.** All of it, but it sits directly on the 2D work already in progress, so it
may be considerably cheaper than it looks from here.

**Legal, licensing and compliance.** None.

---

## Cross-cutting legal notes

Four issues repeat across the capabilities above, so they are stated once here.

**1. Standards are paywalled, but methods are not.** EN 12831, EN 806, EN 12056, EN 12464,
IEC 60364, IEC 60909, ASHRAE: all copyrighted, none freely redistributable. A calculation
method can be implemented from a standard. The standard's text and tables cannot be shipped.
*Mitigation:* implement, cite the standard and version in the result metadata
([`MEP-CALC-04`](./04-calculations.md)), reproduce nothing, and assume users hold their own
copies. This is standard practice across the industry and is not an obstacle. It just has to
be done deliberately.

**2. Manufacturer data is not ours to bundle.** Valve Kv, device curves, photometry, sound
power, duct fitting losses. *Mitigation:* generic defaults for design plus a data model the
user populates, the same shape as [`MEP-EQP-06`](./03-equipment-and-families.md).

**3. Copyleft is manageable. AGPL is not worth the trouble.**
[Ladybug Tools / Honeybee](https://github.com/ladybug-tools/honeybee) is **AGPL-3.0**, and
it is the obvious-looking front end to EnergyPlus and Radiance. The AGPL network clause
targets hosted services precisely. A cloud platform bundling it is the textbook case the
licence exists for. *Mitigation:* go to EnergyPlus and Radiance directly, or via OpenStudio
(BSD-3), and the question never arises. Ordinary GPL engines are fine behind a process
boundary (`MEP-INT-02`).

**4. Free of charge is not free to integrate.** Several popular MEP tools are free to use
and proprietary, and some EULAs explicitly forbid programmatic driving. *Mitigation:* read
the EULA before writing an adapter, and record the finding in the licence manifest
(`MEP-INT-05`).

---

## Licence triage reference

| Class | Licences | What it means |
| --- | --- | --- |
| **Green** | Public domain (US federal work), MIT, BSD-2/3-clause, Apache-2.0 | Integrate freely, including in a commercial closed-source product. Obligations are attribution and keeping the licence text with any redistribution. |
| **Amber** | GPL-2/3, OSMC-PL | Fine when the engine runs as a **separate process** you invoke and exchange files with. That is not linking. A problem only if linked into your binary. |
| **Red** | AGPL-3.0 | The network clause is aimed at cloud platforms specifically. Avoid, or get a commercial licence. |
| **Not open** | Free of charge but proprietary | Free to *use* is not free to *integrate*. Read the EULA. |

---

## The integration requirements

The capability assessments above are analysis. These are the actual asks.

### MEP-INT-01: Solver adapter as a cloud component

**P1.** A documented pattern for wrapping an external engine as a platform cloud component.

**Why.** Every integration above has the same shape: read the model through the contract in
[`04`](./04-calculations.md), write the engine's input, run it, parse the output, write
results back. Specify that shape once and each new engine becomes a week of work rather than
a project.

**Done means:**

- A documented adapter interface: declare required model data, transform, run, parse, write
  back.
- Adapters declare their requirements up front, so a model can be checked for readiness
  **before** the run rather than failing forty seconds in with a Fortran error.
- Full traceability per [`MEP-CALC-04`](./04-calculations.md): engine name and version,
  adapter version, model version, assumptions consumed, standard and edition applied.
- Engine stdout/stderr and the raw input and output files retained as execution artefacts.
  When a result is questioned, and it will be, the input file is the answer.
- Async execution with progress for long runs.
- Third parties can publish adapters, which is the point of the whole pattern.

### MEP-INT-02: Process isolation as a licensing firewall

**P1.** An architectural decision more than a feature.

**Why.** If engines run as separate processes or containers exchanging files, the platform
is not linking to them. That keeps copyleft contained, keeps attribution tractable, and
means an amber-licence engine can be added later without re-architecting. It also means an
engine crash does not take a service down, and engines can be version-pinned per project.
That matters because a calculation re-run two years later must produce the same number.

**Done means:**

- Engines run in isolated, resource-limited execution units, invoked through file or socket
  I/O, never linked into platform code.
- Engine version pinned per project and recorded with every result.
- The adapter, not the engine, is the platform-licensed component.
- Adding an amber-licence engine requires no change to how anything else works.

### MEP-INT-03: Reference adapter, EnergyPlus via OpenStudio

**P1.** The one I would build first, because it removes the largest single waste in
[`01`](./01-workflow-and-waste.md).

**Done means:**

- Model → OpenStudio model → EnergyPlus, driven from the thermal contract of
  [`MEP-CALC-01`](./04-calculations.md).
- Design-day sizing produces per-space heating and cooling loads, written back onto spaces
  and aggregated to zones (`MEP-CAP-01`, `MEP-CAP-02`).
- Missing data reported as missing, never silently defaulted. A load computed on invented
  U-values is worse than no load, because it looks like an answer.
- Every input traceable to the model element it came from.
- Re-runnable on change, with staleness per [`MEP-CALC-06`](./04-calculations.md).
- The generated gbXML/IDF is downloadable, which delivers
  [`MEP-CALC-07`](./04-calculations.md) and the `MEP-CAP-04` mitigation for free.

### MEP-INT-04: Reference adapter, pipe and duct networks

**P1.** EPANET or pandapipes, driven from the connectivity graph.

**Done means:**

- Graph ([`MEP-MOD-04`](./02-modelling-core.md)) → engine network model: lengths, diameters,
  roughness, elevations, fittings as K-factors or equivalent lengths, pumps, valves,
  terminal demands.
- Fluid properties from CoolProp, fitting losses from `fluids`, both at the system's design
  temperature.
- Results (flows, velocities, head loss per segment, pressures, pump duty, valve
  presettings) written back onto the elements they belong to.
- Warnings surfaced on the element that caused them.
- Gravity drainage routed to SWMM instead, for part-full flow and surcharge.

### MEP-INT-05: Licence manifest and attribution

**P2.** Boring work, but skipping it causes trouble two years later.

**Done means:**

- Every adapter declares the engine it wraps, its version, its licence and its attribution
  text.
- A generated notices page covering the whole calculation stack.
- Amber-licence engines flagged with the isolation boundary that contains them.
- Any engine whose licence forbids commercial or programmatic use is rejected at publish
  time rather than at legal review.
- Standards applied by a calculation are recorded with edition, for the same reason.

### MEP-INT-06: Validation corpus

**P2.** This is the reason an engineer will trust any of this.

**Why.** I will not sign a calculation from a tool I have not seen reproduce a known answer.
Nor will my insurer, and nor will a building control officer.

**Done means:**

- A public set of reference cases with published expected results: ASHRAE 140 for the
  building energy path, EPANET's own reference networks for hydraulics, worked textbook
  examples for the rest.
- Adapters run against the corpus on every release, results public.
- Deviation from the engine's own native result is reported. The adapter must not quietly
  change the answer. If the number differs from running the engine by hand, that is an
  adapter bug and it should be visible.

---

## What I would do first

Sequenced purely on return for effort:

1. **CoolProp and PsychroLib as ordinary platform utilities** (`MEP-CAP-10`). MIT, small,
   one has a JavaScript build, coverage is Full and the gap list is empty. This is not an
   integration project. It is a small task that delivers
   [`MEP-MOD-08`](./02-modelling-core.md) outright.
2. **EnergyPlus via OpenStudio, design-day sizing only** (`MEP-INT-03`). Not annual energy.
   Just per-room heating and cooling loads out of the shared model. That alone removes an
   entire application and an entire re-entry of the building from every project I do.
3. **EPANET or pandapipes on a single closed circuit** (`MEP-INT-04`). Prove the graph
   round-trips and that sized diameters land back on the pipes. Once that works, everything
   else in this file is the same pattern with a different engine.

Then let other people build the rest. That is the version that scales, and it keeps That
Open focused on the platform while the ecosystem carries the physics.

Whoever picks any of these up: a suggested working method (stage gates from documentation
and licence clearance through POC, benchmarked validation and real-user feedback) is in
[`07-implementation-playbook.md`](./07-implementation-playbook.md).
