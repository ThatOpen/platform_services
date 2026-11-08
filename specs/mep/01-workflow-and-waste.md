# How MEP work actually runs, and where it loses time and money

**Status:** Draft · **Last updated:** 2026-07-29

This is the evidence document. Every requirement in the other files should trace back to
something described here. If a phase below is wrong, or works differently where you practise,
correct it inline. That is more useful than agreeing with it.

**A note on regions.** This is written from HVAC practice in Poland. Some of it is universal
(you cannot size a duct without a load), some is local (here the MEP engineer usually carries
the building energy certificate, elsewhere a building physics specialist does). Regional
differences are marked. Add yours.

## The short version

I spend my day in maybe six applications. Only one of them holds the 3D model. The others
need the building in their own form before they will tell me anything, and how that happens
varies by tool. Some want it re-entered by hand, room by room. Some can import an IFC,
which brings the geometry but rarely the data the calculation needs, so the import is a
starting point to fix up, not a working model. And sometimes the flow runs backwards: the
ventilation gets modelled inside the calculation software, and travels into the authoring
tool as an IFC export.

So the design does not live in one place. It lives in fragments, spread across tools,
joined by manual re-entry and by IFC hops that lose something at every pass. Then the
architect moves a wall, and every fragment has to be caught up by hand, each in its own
way.

Nobody bills the client for that. No one sees that. Architects / PMs dont see that. It just comes out of the hours and all are surprised why MEP is not ready or spent so much time.

## Phase by phase

### 1. Assumptions and inputs

Gathering requirements, indoor conditions, heat and electrical loads, occupancy, what the
client actually wants versus what the code demands.

| | |
| --- | --- |
| **Produces** | A set of design assumptions the whole project then depends on |
| **Tools** | Documents, email, spreadsheets |
| **Waste** | The early design assumptions live often in a spreadsheet, not in the model. When one changes, nothing downstream knows. Half the coordination emails later in the project exist because somebody was working from an assumption that had already been revised. |

Not glamorous, but this is where the later ping-pong starts. The fix for the assumption
side of it is [`MEP-CALC-03`](./04-calculations.md), assumptions as first-class objects.

A CDE obviously takes part of this load: documents, versions, who received what. And the
platform already moves in the right direction here, with its CDE machinery and BCF-style
topics. This is not a requirement, more a confirmation that the direction is valuable and
where it leads for MEP. The destination is a Jira-like issue and task capability whose
items **link to model elements, zones and assumptions**. "Give me the loads for level 3"
becomes a tracked item with an owner, a status and a link to the exact spaces it concerns,
instead of an email that expires the moment it is read. The penetration workflow
([`MEP-XD-03`](./05-cross-discipline.md)) is really a special case of the same idea. Grown
that far, it also becomes serious project management and maintenance capability, because
the history of decisions stays attached to the objects they were about, which is exactly
what an operator or a renovation designer needs years later.

### 2. Balance calculations: heat loss, cooling load, electrical load

| | |
| --- | --- |
| **Produces** | Per-room design heat loss, cooling load, airflow, electrical demand |
| **Tools** | Dedicated calculation software, one per calculation type. Some can be expensive. |
| **Waste** | **The building gets rebuilt inside the calculation tool.** Rooms, walls, roofs, their build-ups and U-values, orientation, glazing. All of it already exists in the BIM model, and all of it gets typed in again. |

Then the architect changes the layout, and you change it in two places. That is not a
one-off cost, it is a cost that recurs on every revision for the life of the project.

### 3. Zones and design conditions

Defining HVAC zones, setting temperature, humidity and air-quality requirements per zone,
producing the temperature and condition maps that go to the client with colouring and
labelling.

| | |
| --- | --- |
| **Produces** | Zoned design intent, and the drawings that communicate it |
| **Waste** | HVAC zones do not map one-to-one onto architectural rooms, so the room model cannot 1:1 express them. One room can belong to several HVAC zones, and one HVAC zone can span many rooms. Without a real MEP zone concept you end up faking it with filters, parameters and naming conventions, and then a typo breaks them. |

Requirement: [`MEP-MOD-06`](./02-modelling-core.md).

### 4. Large equipment sizing and space reservation

Sizing AHUs, chillers, boilers, pumps, tanks. The big pieces that take up plant room space and
that everyone else needs to design around.

| | |
| --- | --- |
| **Produces** | Equipment schedule with duties, and reserved space in the building |
| **Waste** | Early on you do not know the make and model, but you *do* need to occupy the space, and you need it to look like the thing it will become. Modelling a detailed family at this stage is wasted work. Putting in a box loses the connectors, the clearances and the plausibility. |

This is where generic parametric equipment helps
([`MEP-EQP-01`](./03-equipment-and-families.md)), with service clearances attached
([`MEP-EQP-04`](./03-equipment-and-families.md)), because the space you actually have to
reserve is the equipment plus the room to pull the coil out.

### 5. Routing, the drawing phase

Ducts, pipes and trays get drawn, with a first pass at coordination. This is also when you
realise the generic parts will not do and you start sculpting families for real.

| | |
| --- | --- |
| **Produces** | The distribution networks |
| **Tools** | The BIM tool, plus whatever addon makes routing bearable |
| **Waste** | Family authoring (see phase 6). Slope. Fitting placement. Segmentation that has to be faked. |

Three things about this phase need to be said plainly:

- **Slope is not an edge case.** Almost every piped service is laid to a fall, not just drainage.
  Heating and chilled water lines are sloped so air can find its way to the vents and so the
  system can be drained. In today's tools sloping a run, and then *editing* a sloped run
  without losing the fall, is a fight. It should be a normal, built-in property of a route.
  [`MEP-MOD-03`](./02-modelling-core.md).
- **A drawn network is not a network.** Elements that touch are not necessarily connected,
  and nothing downstream (schedules, hydraulics, flow) can be trusted unless connectivity
  is real and inspectable. [`MEP-MOD-04`](./02-modelling-core.md).
- **Fittings.** Elbows, tees, reducers and transitions should land automatically along a
  route, following rules I configure once per system, not get placed one at a time.
  [`MEP-MOD-02`](./02-modelling-core.md).

### 6. Family authoring

| | |
| --- | --- |
| **Produces** | The equipment content used in this project, and maybe the next one |
| **Waste** | Enormous, and almost entirely avoidable. |

Manufacturer families would seem to solve this, and they do not. They are over-detailed,
heavy, poorly optimised, and, most important, **you do not control what you did not
author.** Parameters are named someone else's way, the connectors are wrong or missing, the
geometry drags the model down. So you build your own from the catalogue sheet.

And the catalogue sheet is the point. It already contains almost everything: a dimensioned drawing,
a table of sizes, the connection specification, weights, duties. All the information needed
to generate the family is sitting in a PDF, and an engineer is reading it and typing it into
a family editor by hand. That is the case for
[`MEP-EQP-06`](./03-equipment-and-families.md).

### 7. Hydraulic calculations

Sizing and balancing the networks: pressure drops, velocities, pump head, valve settings.

| | |
| --- | --- |
| **Produces** | Sized networks, balancing data, pump and fan duties |
| **Tools** | A separate application. Again. |
| **Waste** | You either **redraw the whole network** in the calculation software, which is what we routinely do, or you model it in the calculation software first and import the result into the BIM tool as IFC. Either way one model is authored twice, and the two drift apart on the next revision. |

What the BIM tools ship natively is, in my experience, rarely relied on for final design.
That is not really fixable by improving a solver. It is fixable by making the model
something a trusted solver can run against. Electrical colleagues describe the same pattern
with their own tools.

[`MEP-CALC-02`](./04-calculations.md).

### 8. Coordination

| | |
| --- | --- |
| **Produces** | A model that can be built |
| **Waste** | Comparatively little. This is the one phase where the tools are mostly fine. |

What is needed is unremarkable and should stay unremarkable: clash detection that can be run
easily, filtered **per system**, and re-run without ceremony. The platform already has a
clashes manager. The MEP requirement is mainly that it understands systems as a filter
dimension.

One layer on top of geometric clash would be genuinely new: **mutual placement rules**.
Regulations prescribe how services may run relative to each other. A natural gas pipe runs
above the electrical tray, not under it. Minimum separations apply between given pairs of
services, crossings have their own rules. Today this is checked by eye, and it is checked
late. Because the model knows what each element is and which system it belongs to
([`MEP-MOD-05`](./02-modelling-core.md)), these rules are checkable exactly like clashes:
"system A above system B", "at least X mm between A and B", per pair, per situation. The
rules come from national regulations and differ by country, so the rule set must be
configurable and shareable, not hard-coded. See [`MEP-XD-06`](./05-cross-discipline.md).

### 9. Building energy modelling

| | |
| --- | --- |
| **Produces** | The energy performance calculation, legally required |
| **Region** | In Poland this usually lands on the MEP engineer, elsewhere on a building physics specialist. Either way it is a separate tool. |
| **Waste** | **A third full re-entry of the building** (envelope, zones, schedules, systems) into yet another application, on another licence, or a paid addon. |

### 10. Bills of materials and schedules

| | |
| --- | --- |
| **Produces** | Quantities for tender and for construction |
| **Waste** | Modest, but real: a construction BOM is only useful **segmented into the lengths that get delivered**. An uncut 47.3 m of DN100 is not procurable. Without built-in segmentation this is done by hand or by spreadsheet workarounds. |

[`MEP-MOD-10`](./02-modelling-core.md).

### 11. Site drainage, where the project has a site

| | |
| --- | --- |
| **Produces** | Rainwater and foul drainage design |
| **Tools** | Yet another application, for catchments and gravity flow |
| **Waste** | Rainfall intensity, catchment areas, drainage basins, part-full pipe flow and liquid levels: none of it available in the BIM tool, all of it dependent on terrain and roof geometry that *is* in the BIM tool. |

[`MEP-CALC-05`](./04-calculations.md).

### 12. Construction profiles

| | |
| --- | --- |
| **Produces** | Longitudinal piping profile drawings for external and underground services |
| **Waste** | Profiles are drawn at different horizontal and vertical scales, with a characteristic info table below. That distortion is the whole point of the drawing, and BIM tools do not do it. So it goes to another application, or to CAD, and gets drawn by hand from a route that is already modelled. Then re-drawn when the route changes. |

## What this adds up to

Four claims, in the order I would prioritise fixing them:

1. **The same building is maintained in several tools at once.** Every calculation
   discipline demands its own copy, and no copy updates itself. This is the largest single
   waste in MEP practice and it is a data problem, not a physics problem.
2. **Equipment content is authored by hand from information that already exists in
   machine-readable form.** A catalogue sheet is a specification. We treat it as a drawing
   to copy.
3. **Coordination with other disciplines runs on email and goodwill.** Loads, openings,
   assumptions: all passed as messages, none of it derived from the shared model, and
   nothing tells you when an assumption you depend on has moved.
4. **Some mandatory drawings cannot be produced from the model at all.** System diagrams
   and longitudinal profiles get drawn from scratch in a separate 2D CAD, with no link to
   the model they depict. From that moment they are a parallel document maintained by hand:
   when the model changes nothing flags them as outdated, and nothing decided while drawing
   them (tags, corrections, annotations) ever flows back into the model. Unlike points 1 to
   3, this is not a sync problem. There is no sync to fail.

The common shape: *information that exists in the model has to be re-entered somewhere else
by a human, and then kept in sync by that same human, forever.*
