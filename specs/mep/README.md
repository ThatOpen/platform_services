# MEP specification

**Status:** Draft · **Scope:** HVAC, plumbing, gas, and the parts of electrical that share
the same routing and coordination problems · **Last updated:** 2026-07-29

## The answer to "what can we do to help you spend less time and money on software?"

**Let one model carry enough MEP semantics that the calculations can run against it.**

An architect will do maybe 80% of their work inside a popular tool we all have in mind. As an MEP engineer I
do about 40% of mine there, and that number is the whole problem. Heat loss, cooling load,
ventilation rates, hydraulic sizing and balancing, energy modelling, drainage: every one of
these steps happens in a *different* paid application, and each one needs the building in
its own form first. So the building topology must be provided, in different ways and
different formats, to different third-party discipline tools, and kept current in each of
them.

That replay is the real cost. Not only the licences, although there are plenty of those. It is
the engineer-days spent typing in a building that somebody already modelled, and the errors
that appear when one of those copies falls behind and nobody notices until issue.

Nothing here asks the platform to become a physics engine. It asks for the thing that makes
the physics engines unnecessary to re-model into: a modelling core that is
**connection-aware, system-aware and zone-aware**, plus a stable data contract so that any
calculation app, ours or a third party's, can read the model and write results back. That is
the core idea. Everything else in this folder builds on it.

### --- In a perfect world, That Open Platform should be the only platform for MEP engineer ---

## Where the money goes today

| Job to be done | Why it is a separate tool today | What it forces you to rebuild |
| --- | --- | --- |
| Design heat loss / cooling load | Needs envelope physics the BIM tool does not model | Rooms, envelope build-ups, U-values, orientation, internal gains |
| Ventilation and duct sizing, pressure drop, balancing | The BIM tool's calculations are not trusted for issue | The whole duct network, as a *network* |
| Hydraulic sizing and balancing (heating, cooling, water, gas) | Same | The whole pipe network, plus fittings and valve data |
| Building energy modelling | Legally required output, needs its own thermal model | A third copy of the building: zones, envelope, schedules, systems |
| Site and rainwater drainage, with construction profiles | Catchments, part-full flow, terrain: nothing in the BIM tool, which also cannot draw a properly scaled longitudinal profile | Terrain, roof areas, gravity network, and the route re-drawn at a distorted scale |
| System diagrams: P&ID and riser diagrams | A mandatory deliverable on every MEP project, and BIM tools do them poorly or not at all, so they are drawn in a separate 2D CAD | Every system, redrawn by hand as a schematic, then kept in sync with the model manually |
| Equipment families | Manufacturer content is heavy, over-detailed, and unauthored by you | Every piece of equipment, modelled by hand |

Three kinds of waste run through that table:

1. **Duplicated building definition.** The same rooms, the same envelope, the same network,
   entered repeatedly. Then maintained repeatedly, or allowed to drift.
2. **Family authoring.** Time spent modelling equipment that a catalogue sheet already fully
   describes. Manufacturer families are rich, huge, poorly optimised, and you do not control
   what you did not author. So you rebuild them.
3. **Cross-discipline ping-pong.** Loads to the structural engineer, opening locations and
   sizes to everyone, assumptions back and forth over email. Equipment is easy, because it
   is localised and its weight is on the datasheet. **Distributed load from pipe, duct and
   tray hangers is the hard one**, and it is the number most often guessed.

The detailed, phase-by-phase version is in [`01-workflow-and-waste.md`](./01-workflow-and-waste.md).

## Minimum viable MEP

The smallest set that makes it rational for an MEP engineer to open the platform for
production work. Everything here is **P0**. The reasoning and acceptance criteria are in
[`02-modelling-core.md`](./02-modelling-core.md), except generic equipment, which lives in
[`03-equipment-and-families.md`](./03-equipment-and-families.md).

- Linear elements (pipes, ducts, cable trays) routed along a path, with automatic,
  configurable in-line fitting placement.
- **Slope as a routing property, not a workaround.** Nearly every piped service is laid to a fall,
  so that air can escape to the vents and the line can be drained. This is not a drainage-only
  feature.
- Connectivity that is real: a connected network forms a **graph of nodes and edges**, not a
  set of drawings that happen to touch.
- **Systems** as a first-class grouping: what a set of elements belongs to, and what a
  per-system schedule, filter or calculation can be run against.
- **MEP zones**, distinct from architectural rooms and spaces, with a many-to-many
  relationship to them.
- Standard product libraries out of the box (steel, PE, copper, rectangular and round duct)
  with real dimension tables, not generic tubes.
- Fluids and materials (air, water, gas, steel, copper, plastic) carrying the properties the
  engineering actually needs, starting with density.
- Insulation and outer cladding as layers that contribute to weight and outer dimension.
- Configurable segmentation into manufacturing lengths, because a bill of materials for
  construction is meaningless without it.
- Generic, parametric, non-catalogue equipment: recognisably shaped, deliberately simple,
  with proper connectors.

## Index

| File | What it covers |
| --- | --- |
| [`01-workflow-and-waste.md`](./01-workflow-and-waste.md) | How MEP work actually runs, phase by phase, and where the time and money go. The evidence behind everything else. |
| [`02-modelling-core.md`](./02-modelling-core.md) | `MEP-MOD-*`: routing, slope, connectivity graph, systems, zones, libraries, materials, insulation, segmentation. |
| [`03-equipment-and-families.md`](./03-equipment-and-families.md) | `MEP-EQP-*`: generic parametric equipment, connectors, service clearances, and AI-assisted family authoring from a catalogue sheet. |
| [`04-calculations.md`](./04-calculations.md) | `MEP-CALC-*`, `MEP-DWG-*`: the data contract that lets loads, hydraulics, energy modelling and drainage run against the model instead of a re-typed copy of it, automatic sizing, plus the drawing outputs that leave the model today: system diagrams (P&ID and riser diagrams) and construction profiles. |
| [`05-cross-discipline.md`](./05-cross-discipline.md) | `MEP-XD-*`: hangers and accumulated load, openings, and the running multidisciplinary totals worth watching. |
| [`06-open-source-engines.md`](./06-open-source-engines.md) | `MEP-CAP-*`, `MEP-DATA-*`, `MEP-INT-*`: capability by capability, what is needed, **what the BIM model must carry**, which open-source engine covers it and how far, what is left to build, and the licensing and compliance issues with their mitigations. |
| [`07-implementation-playbook.md`](./07-implementation-playbook.md) | A suggested way to tackle a capability: stage gates from documentation and licence clearance through POC, benchmarked validation, and implementation with user feedback. A proposal to adapt, not a mandated process. |
| [`glossary.md`](./glossary.md) | MEP terms used here, for readers who are not MEP engineers. |

## Known constraints

- **Native family round-trip to the incumbent authoring tool is off the table.** Its API
  does not permit freely creating parametric families, so anything authored on the platform
  goes back to it as geometry and data, not as a native family that regenerates.
  [`03`](./03-equipment-and-families.md) is written with that constraint accepted rather
  than wished away.
- **Solvers are not core platform work.** [`04`](./04-calculations.md) therefore specifies
  the *contract*, and leaves the physics to apps, including third-party ones. And the
  physics is largely already written: [`06`](./06-open-source-engines.md) lists mature
  open-source engines (EnergyPlus, EPANET, SWMM, pandapipes, pandapower, CONTAM) that are
  public domain, MIT or BSD-3 and can be integrated commercially. That Open would be
  shipping adapters, not solvers.

