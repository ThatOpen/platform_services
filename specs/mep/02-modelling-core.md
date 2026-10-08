# Modelling core (`MEP-MOD-*`)

**Status:** Draft · **Last updated:** 2026-07-29

The minimum an MEP engineer needs before the platform is usable for production work at all.
Everything here is P0 unless marked otherwise. If a requirement below is unbuildable or
solves a problem that does not exist, strike it out inline.

One framing note before the list. Most of this is not about drawing. It is about the model
knowing **what a thing is, what it belongs to, and what it is connected to**. That is what
everything downstream (schedules, hydraulics, flow, coordination, cost) actually consumes.
A beautiful pipe that does not know it is connected to anything is a picture.

---

## MEP-MOD-01: Linear elements with path routing

**P0.** Pipe, duct and cable tray as first-class element types, created by routing along a
path rather than placed segment by segment.

**Why.** This is the bulk of MEP modelling. Everything else in this file hangs off it.

**Done means:**

- A route is defined by eg a polyline in 3D, and remains editable **as a route**: moving a
  vertex reflows the run and its fittings, rather than orphaning them.
- Duct profiles: round, rectangular, oval. Pipe: round. Tray: ladder, perforated, solid.
  Profile is a property of the run, changeable after the fact.
- A run carries: nominal size, actual outer and inner dimension, material, product standard,
  wall thickness, system assignment, insulation, slope, reference level.
- Size changes anywhere along a run insert the appropriate transition automatically
  (see `MEP-MOD-02`).
- Elements know their **length along the route**, distinct from straight-line distance.
- Runs can be branched from an existing run, with the tee created as part of the operation.

**Notes.** The distinction between a *run* (the thing I design and edit) and the *segments*
(the things that get manufactured and counted) needs to exist from day one. Tools that only
have segments make editing miserable. Tools that only have runs cannot produce a BOM. See
`MEP-MOD-10`.

---

## MEP-MOD-02: Automatic, configurable in-line fitting placement

**P0.** Fittings placed along a route automatically, driven by rules I configure once.

**Why.** Placing elbows and tees by hand is the most tedious part of routing, and the rules
are mostly mechanical. They belong to the system type, not to my mouse.

**Done means:**

- A per-system **fitting rule set** defines what gets inserted at direction changes, size
  changes, branches and terminations: elbow radius or angle, tee type, reducer style
  (concentric or eccentric), coupling and connection method.
- Rules can be graded by size (for example threaded fittings below DN50, welded above) and
  by material.
- Where the geometry cannot satisfy the rule (bend radius will not fit, angle out of range)
  the tool says so **at that location** rather than silently substituting something else.
- Rules are shareable: exportable, importable, project-level and office-level. Every office
  has its own standard fittings. Nobody wants to re-enter them per project.
- Manual override of any single auto-placed fitting, without breaking the rest of the run.

**Notes.** Eccentric versus concentric reducers matters more than it looks. On a sloped or
drained line the choice determines whether the line actually drains. If the fitting rules
are slope-aware, this can be got right automatically.

---

## MEP-MOD-03: Slope as a first-class routing property

**P0.** I want to be very clear about this one, because it is the requirement most likely to
be filed under "drainage, later".

**Why.** Nearly every piped service in a building is laid to a fall. Not only sewers. Heating and
chilled water mains are sloped so that air migrates to the vents and so the system can be
drained down for service. Sloped routing is the normal case, not the special one. In the
tools I use today, drawing a sloped run is a struggle, and *editing* one without losing the
fall is worse. It has to be easy, or the tool does not get used.

**Done means:**

- Slope is a property of a run, expressible as ratio (1:100), percentage (1%) or per-mille,
  with the unit configurable per project.
- **The reference matters and must be selectable**: slope applied to the centreline, the
  invert, or the crown. For gravity drainage the invert is what is designed to. For a sloped
  pressure line the centreline is usually fine. Getting this wrong makes a run wrong by half
  a diameter every time the size changes.
- A default slope per system type, so a drainage system slopes by default without me asking.
- **Slope survives editing.** Move a vertex, change a size, insert a fitting: the fall is
  preserved unless I change it. Slope is a constraint, not a one-time transformation.
- Slope direction is explicit and visible, and reversible in one action.
- Fittings absorb slope correctly. A sloped run through an elbow must not produce a
  geometric fiction.
- Mixed runs are legal: a horizontal section, a riser, a sloped section, in one route.
- Readout of invert level at any point, and at each end of any segment. This is what goes on
  the drawing.
- Warning when a sloped gravity run goes uphill or falls below a minimum slope for its size.

**Notes.** If I could only have one thing from this whole file that today's tools do badly,
it would be this. It is not conceptually hard. It is just never treated as core.

---

## MEP-MOD-04: Connection-aware networks as a real graph

**P0.** Connected elements form an inspectable graph of nodes and edges.

**Why.** Everything downstream depends on it: flow, hydraulics, per-system quantities,
"what is fed from this riser", "what does this valve isolate". Without it, the model is a
drawing that happens to be in 3D, and every network calculation needs the network re-entered
somewhere else, which is exactly the waste described in
[`01`](./01-workflow-and-waste.md#7-hydraulic-calculations).

**Done means:**

- Elements have **connectors** with position, direction, nominal size, shape, connection
  method (flanged, welded, threaded, socket, grooved, press, spigot) and the system type
  they accept.
- Two connectors are either connected or they are not, and this is queryable, visualisable,
  and independent of whether the geometry looks like it touches.
- Connecting incompatible connectors is refused or flagged, not silently allowed.
- The network exposes a graph: **nodes** (equipment, fittings, terminals, junctions,
  free ends) and **edges** (straight segments), each carrying its engineering properties.
- Junctions carry their semantics: for a tee, which leg is the main and which is the
  branch. A solver will run without this, but its pressure drops will be wrong, because a
  tee's loss coefficient differs several times between the straight run and the branch. For
  standard fittings the roles can usually be inferred from the geometry. The graph should
  still carry them explicitly, so no downstream app has to re-infer them and get a reduced
  or custom fitting wrong.
- Flow direction can be assigned or inferred (source to receiver), per system, and shown.
- The graph is traversable: give me everything downstream of this point, find the path from
  this terminal back to its source, find disconnected fragments.
- **Open ends are reported.** The commonest real defect in an MEP model is a run that looks
  connected and is not. That should be a query I can run, not a surprise on site.

**Notes.** This is the requirement that makes the platform different from a modeller. The
geometry engine gives shapes. This gives a network. Almost every "strong nice to have" later
in this spec is cheap once this exists and out of reach before it.

---

## MEP-MOD-05: Systems

**P0.** A system is a named grouping that elements belong to.

**Why.** "Supply air AHU-1", "Heating circuit 2", "Domestic cold water". It is how MEP
engineers think, how schedules are cut, how drawings are filtered, how calculations are
scoped, and how the model is handed over. Without it you fake it with parameters and naming
conventions, and then a typo breaks a schedule.

**Done means:**

- Systems have a type (supply air, extract, heating flow, heating return, chilled water,
  domestic cold, domestic hot, hot water return, foul drainage, rainwater, gas, sprinkler,
  compressed air, cable containment and so on), a name, and a colour for display.
- Every routed element and every equipment connector can be assigned to a system.
- Systems nest, so quantities roll up. A branch is part of a larger system.
- Everything can be filtered, scheduled, coloured, exported and calculated **per system**.
  Including clash detection ([`05`](./05-cross-discipline.md)).
- A system knows its source equipment and its terminals.
- some devices like AHU can be shared across different systems (intake, supply, return, exhaust)
- System type carries defaults down: fluid, material and standard, default slope, fitting
  rules, insulation spec. Setting up a system once should configure most of `MEP-MOD-01`
  through `MEP-MOD-09` for everything drawn into it.
- Elements not assigned to a system are findable. They are usually a mistake.

---

## MEP-MOD-06: MEP zones, distinct from rooms and spaces

**P0.** MEP zones are their own concept, not a re-use of architectural rooms.

**Why.** An HVAC zone is not a room. One room can belong to several MEP zones at once (a
ventilation zone, a heating zone, a fire compartment, a control zone), and one MEP zone
usually spans many rooms. The relationship is many-to-many in both directions, and any model
that assumes otherwise forces workarounds within a week.

**Done means:**

- Zones are typed: ventilation, heating, cooling, control, fire, acoustic, pressure regime,
  and user-defined types.
- **Many-to-many with spaces**: a space can be in several zones of different types (and, in
  some designs, of the same type), and a zone contains many spaces.
- Zones carry design conditions: design indoor temperature (winter and summer), relative
  humidity, air change rate or airflow, CO₂ or IAQ target, pressure regime, acoustic limit,
  occupancy assumption.
- Zones aggregate what is inside them: floor area, volume, total load, total airflow,
  connected terminals and equipment.
- Zones are drawable and colour-mappable, so the condition maps that go to the client
  (`01`, phase 3) come straight out of the model instead of being drawn by hand.
- Zones are addressable by calculation apps ([`04`](./04-calculations.md)), which is where
  they deliver most of their value.

---

## MEP-MOD-07: Built-in product libraries to recognised standards

**P0.** Real pipe and duct catalogues shipped with the platform.

**Why.** DN100 is not "100 mm". A DN100 steel pipe to EN 10220 has a specific outer diameter
and a wall thickness that depends on the series, and both feed straight into weight, volume,
pressure drop and clearance. Today every engineer enters these tables by hand, each
slightly differently, and that is exactly the kind of duplicated work this spec hopes to
remove.

**Done means:**

- Shipped size tables, each keyed to its standard. The table below is a suggested starting
  set.
- Each entry carries: nominal designation, outer diameter or dimensions, wall thickness,
  inner diameter, mass per metre, roughness, and the standard's own reference.
- Pressure and temperature limits where the standard defines them.
- Offices can extend the libraries with their own products, and can restrict a project to an
  approved subset. Both matter. The second is how a project stays procurable.
- Libraries are versioned, and a model records which library version it was built against.

**Suggested reference standards.** A European starting set, proposed for the built-in
libraries. It is a suggestion, not a closed list. Regional catalogues (ASME/ASTM ranges,
national standards) come in through the office-extension mechanism above.

| Service / material | Suggested standard | Notes |
| --- | --- | --- |
| Steel pipe, threaded and welded building services (heating, compressed air, gas inside buildings) | EN 10255 (medium and heavy series) | The classic threadable steel pipe |
| Steel pipe, welded systems and larger sizes | EN 10220 dimensions, with materials to EN 10216-1 / EN 10217-1 | Dimension standard plus material standard, they are separate things |
| **Steam and condensate, elevated temperature and pressure** | EN 10216-2 (seamless, for example P235GH) | Wall thickness and design verification per EN 13480 where the installation falls under it. Condensate lines wear faster, so the wall thickness series matters |
| US-style pipe schedules, for international projects | ASME B36.10M (Sch 40, Sch 80), ASME B36.19M for stainless | Needed the moment a project leaves Europe |
| Stainless steel, drinking water and press-fit | EN 10312, materials to EN 10088 | Press-fit ranges are manufacturer-specific on top of this |
| Copper, water and gas | EN 1057 | |
| Copper, refrigeration and ACR | EN 12735 | Different tempers and sizes than water copper |
| **PE pressure pipe, water** | EN 12201, PE80/PE100, by SDR | |
| PE pressure pipe, gas | EN 1555 | Yellow, and its own standard, do not reuse the water table |
| **PVC-U pressure pipe** | EN ISO 1452 | |
| PP-R | EN ISO 15874 | |
| PEX | EN ISO 15875 | |
| Multilayer (PEX-Al-PEX) | EN ISO 21003 | |
| PVC-U soil and waste, in building | EN 1329 | |
| PP soil and waste | EN 1451 | |
| PE drainage, in building | EN 1519 | |
| PVC-U underground sewer | EN 1401, structured-wall EN 13476 | |
| Cast iron drainage (SML) | EN 877 | |
| Ductile iron, site water and sewer | EN 545 (water), EN 598 (sewerage) | |
| Circular duct | EN 1506 dimensions, EN 12237 strength and leakage | |
| Rectangular duct | EN 1505 dimensions, EN 1507 strength and leakage | |
| Cable tray and ladder | EN 61537 | |

Two cross-cutting references worth shipping alongside: PN pressure ratings to EN 1333, and
flange dimensions to EN 1092-1, since half of the equipment connectors in
[`03`](./03-equipment-and-families.md) are specified against them.

**One "diameter" is actually several numbers.** This is the part that most often gets lost
in exchange between tools, so it deserves to be explicit. A single routed element carries all of these at
once, and they are different values with different consumers:

| Value | Example, DN100 steel EN 10220 | Who needs it |
| --- | --- | --- |
| Nominal designation | DN100 (or NPS 4, or "110" for PE) | Schedules, drawings, procurement. A label, never an input to calculation |
| Trade / catalogue code | for example 114.3 x 3.6, Cu 22x1, PE 110 SDR17 | Ordering, BOM. Manufacturer-specific on top of the standard |
| Outer diameter | 114.3 mm | Geometry, coordination, clash, supports. This is what gets modelled |
| Wall thickness (series, SDR or schedule) | 3.6 mm in one series, 4.5 mm in another | Weight, pressure rating, and it decides the inner diameter |
| Inner diameter | 107.1 mm or 105.3 mm depending on series | **Hydraulics.** The value every flow calculation actually runs on |
| Hydraulic diameter | equals ID for round pipe, 4A/P for rectangular and oval duct | Pressure drop for non-circular sections |
| Effective inner diameter and roughness | reduced by an internal lining, for example cement-lined ductile iron | Hydraulics again, where a lining exists |

**Proposal for how the model handles this.** The element stores a reference into the
product library, and the library resolves the full size record. Concretely:

- The engineer picks a nominal size and a series (or SDR, or schedule). Everything else is
  resolved from the library table, not typed in.
- **Geometry is driven by the outer diameter** (plus insulation per `MEP-MOD-09` for the
  coordination envelope). Conveniently, for both steel series and plastic SDR families the
  outer diameter is constant while the wall varies. So changing a series changes the inner
  diameter and the weight without moving any geometry, and coordination is untouched.
- **Calculations read the inner or hydraulic diameter, never the label.** A solver that
  parses "DN100" and assumes 100 mm is wrong by 5% on diameter and roughly 10% on area, on
  every single pipe. The contract in [`04`](./04-calculations.md) must expose ID and
  hydraulic diameter as first-class fields so no app is ever tempted to guess.
- Non-circular sections (rectangular and oval duct) expose their computed hydraulic
  diameter alongside width and height.
- Lined products carry the effective inner diameter and the roughness of the lining, not of
  the base material.
- All of these are separate, queryable fields on the element. Nominal designation is for
  humans. The rest is for the machine.

**Notes.** This is unglamorous work that pays back permanently, and it is also easy to get
subtly wrong. An engineer should review the tables before they ship. The standards above
are dimension and product standards, so the licensing posture from
[`06`](./06-open-source-engines.md) applies: the dimension values themselves (outer
diameter, wall thickness, mass) are physical facts, and the standards' text cannot be
reproduced. Each shipped table should cite which edition it was built from, and counsel
should confirm the approach per jurisdiction, since Europe also protects databases as such,
separately from copyright on the text.

---

## MEP-MOD-08: Fluids and materials with engineering properties

**P0.** A basic set of fluids and solid materials carrying the properties the calculations
need.

**Why.** Weight needs density. Hydraulics needs density and viscosity. Thermal work needs
specific heat and conductivity. These are physical constants, so they belong in the
platform once, rather than typed into project parameters by every user separately.

**Done means:**

- **Fluids**: air, water, water/glycol mixtures (by concentration), natural gas, refrigerant
  placeholders, compressed air, wastewater. Each with density, dynamic or kinematic
  viscosity, specific heat capacity, thermal conductivity.
- Fluid properties are **temperature-dependent**, or at minimum defined at a stated design
  temperature that the model records. Water at 80 °C and water at 6 °C are not the same
  fluid for design purposes.
- **Solid materials**: steel, stainless, copper, cast iron, PE, PP, PVC, PEX, aluminium,
  galvanised sheet, with density, thermal conductivity and roughness.
- Insulation materials (mineral wool, elastomeric, PIR) with density and conductivity.
- Fluid is assigned at system level and inherited by everything in the system.
- Custom fluids and materials can be added.

---

## MEP-MOD-09: Insulation and cladding as contributing layers

**P0.** Insulation and outer cladding modelled as layers on a run, contributing to outer
dimension and to weight.

**Why.** Two things break without it. Coordination: an insulated DN150 with 60 mm of wool
and a metal jacket does not fit where a bare DN150 fits, and the clash check will happily
tell you it does. And load: on a long run the insulation and jacket are not a rounding error
in what the hangers carry.

**Done means:**

- Insulation layer with material, thickness and coverage (whole run, or from/to along it).
- Separate outer cladding or jacket layer (foil, PVC, aluminium, steel sheet) with material
  and thickness.
- Both contribute to **outer dimension** used for clash detection and clearance checking,
  and to **mass per metre**.
- Insulation specification is a property of the system, applied by default, overridable per
  run.
- Insulation is visible and hideable independently, and schedulable. Insulation quantities
  are their own trade package and get their own BOM.
- Fittings and valves inherit the run's insulation, with an override for what is left bare.

---

## MEP-MOD-10: Configurable segmentation into manufacturing lengths

**P0.** Runs split into deliverable lengths, configurably, feeding the BOM.

**Why.** A construction bill of materials that says "47.3 m of DN100" cannot be ordered. What
gets delivered is a count of 6 m stock lengths and an offcut, and the joints between them are real
work with real cost.

**Done means:**

- Standard stock lengths per product family and size, from the library (`MEP-MOD-07`),
  overridable per project.
- Automatic segmentation of a run into stock lengths plus a remainder, with the joint type
  taken from the fitting rules (`MEP-MOD-02`).
- Segmentation strategy is configurable: start from a fixed point, avoid joints inside a
  defined region (through a wall, over a corridor), snap joints to supports.
- **Segmentation does not fight editing.** It is derived from the run and recomputed when the
  run changes. It is not a destructive explode that I then have to maintain.
- Joints are countable and schedulable: the count of welds, presses or socket joints is
  what a fabricator prices.
- BOM output is per system, per level, per zone.

---

## MEP-MOD-11: Free-end and validity checking

**P1.** Continuous model validation aimed at the defects that actually occur.

**Why.** MEP models fail in a small number of boring, repeatable ways, and every one of them
is detectable.

**Done means:** a queryable, live list of at least:

- Open connectors and disconnected network fragments
- Elements with no system assignment
- Size mismatches across a connection
- Gravity runs with insufficient or reversed slope
- Runs whose product is not in the project's approved subset
- Terminals not reachable from any source
- Systems with no source equipment
- Insulated elements whose outer dimension violates a defined clearance

**Notes.** Presented as findings against elements, not as a modal dialog. It should be
possible for a cloud component to run this on every model version and post the results.

---

## MEP-MOD-12: Levels, risers and vertical structure

**P1.** Vertical distribution treated as a real thing.

**Why.** Risers and shafts are where MEP coordination actually fails, and they are usually
modelled as "some vertical pipes that happen to be near each other".

**Done means:**

- A riser is nameable and groups the vertical runs passing through a shaft.
- Elements report the level they belong to, and vertical runs report which levels they cross.
- Shaft space can be defined and its utilisation reported: how much of the shaft is
  consumed, by which systems, with what space left. This is a number the architect asks for
  every project and nobody can answer quickly.
- Per-level quantities for anything crossing levels are split correctly.

---

## Deliberately out of scope here

- **Hangers and supports**: a real requirement, but it belongs with structural load, so it
  is in [`05-cross-discipline.md`](./05-cross-discipline.md).
- **Hydraulics and sizing**: [`04-calculations.md`](./04-calculations.md).
- **Equipment and family authoring**: [`03-equipment-and-families.md`](./03-equipment-and-families.md).

## Open questions

1. Is a "run" a persisted platform entity or an app-level construct over segments? This
   affects whether slope-preserving editing (`MEP-MOD-03`) can work at all.
2. How much of `MEP-MOD-04` is the semantic layer already going to give us for free? If
   connectors and connection state are coming anyway, this file gets much shorter.
3. Where do product libraries live: in the platform, in a project, or in a published
   component that projects depend on? The versioning answer differs for each.
4. Units. MEP is mixed-unit by nature (DN and inches in the same schedule, Pa and mbar and
   metres of head for the same quantity). Is unit handling a platform concern or ours?
