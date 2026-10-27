# Equipment and family authoring (`MEP-EQP-*`)

**Status:** Draft · **Last updated:** 2026-07-29

Two problems live here. The first is the early-stage one: I need to put an air handling unit
in the plant room before I know which air handling unit it is. The second is the late-stage
one: I end up hand-building equipment content from catalogue sheets, and a large amount of
my time goes there.

The first needs generic parametric equipment. The second needs something that has only
recently become possible.

---

## MEP-EQP-01: Generic parametric equipment

**P0.** A built-in set of non-catalogue, parametric, deliberately simplified equipment
families.

**Why.** During sizing and space reservation ([`01`, phase 4](./01-workflow-and-waste.md))
I know the duty and roughly the size, and not the manufacturer. I need something that
occupies the right space, looks enough like the real thing that everyone reading the model
understands what it is, and carries proper connectors so it can be connected up. Modelling
detail at that stage is wasted work. A plain box loses the connectors and the plausibility.

**Done means:**

- A starting set covering at least: air handling unit, fan coil unit, chiller, dry cooler,
  boiler, heat pump, buffer vessel, expansion vessel, domestic hot water storage cylinder,
  pump (in-line and base-mounted),
  heat exchanger, cooling tower, fan (axial, centrifugal, in-line), silencer, filter section,
  heating and cooling coil, humidifier, air terminal (grille, diffuser, valve), VAV/CAV box,
  fire and smoke damper, radiator, underfloor heating manifold, water meter, backflow preventer,
  pressure reducing valve, isolation and control valves, strainer, air vent, drain point,
  floor gully, cleanout, grease separator, electrical panel, distribution board.
- Each driven by a small set of **dimensional parameters** (length, width, height, or
  diameter and face size) that the engineer sets directly.
- Geometry that reads correctly at a glance and stays cheap. An AHU should look like an AHU
  with sections, not like a cube and not like a manufacturer's 40 MB detailed model.
- Each carries connectors per `MEP-EQP-02`.
- Each carries an engineering property set: duty, flow, pressure drop, electrical load,
  operating weight, empty weight, fluid content volume, sound power. Blank is fine. The
  fields must exist so downstream tools can rely on them.
- Placeable, mirrorable, rotatable, hosted on floors or walls or ceilings as appropriate,
  and countable in a schedule.

**Notes.** Deliberately simplified is a feature, not a compromise. Generic content that stays
light is what makes a coordination model openable.

---

## MEP-EQP-02: Connectors on equipment

**P0.** Equipment connectors are as capable as the ones on routed elements.

**Why.** Equipment is where a system starts and ends. If the connector is wrong or missing,
the network graph (`MEP-MOD-04`) breaks at exactly the point where it matters most.

**Done means:**

- Any number of connectors per family, each with position, direction, shape (round,
  rectangular, oval), nominal size, connection method, system type, and expected flow
  direction.
- Mixed connector types on one piece of equipment: an AHU has supply and extract duct
  connections, heating and cooling water flow and return, a condensate drain, and an
  electrical supply, all at once. All of them need to be real.
- Connector positions are **parametric**: they move with the dimensional parameters rather
  than being pinned to where the geometry happened to be when it was authored.
- Connectors carry design data: design flow, design pressure drop, and the system type they
  will accept.
- Routing can start from a connector, inheriting its size, system and direction.
- Unconnected equipment connectors show up in the validity check (`MEP-MOD-11`).

---

## MEP-EQP-03: Equipment schedules and duty data

**P1.** The equipment schedule falls out of the model.

**Done means:**

- Per-system and per-zone equipment schedules with duties, flows, electrical loads and
  weights.
- Schedule columns configurable and templated at office level.
- Round-trips: editing a duty in the schedule updates the element.
- Export to a spreadsheet format that a supplier will accept for a quotation request.

---

## MEP-EQP-04: Service clearance volumes

**P1.** Equipment carries the space needed around it, not just the space it occupies.

**Why.** What has to be reserved in the plant room is the unit *plus* the room to pull the
coil out, swing the door, and change the filters. Today this is a box someone draws by hand,
if they remember. Then the architect shrinks the plant room and nothing objects.

**Done means:**

- One or more clearance volumes per family, parametric with the equipment, and directional
  (pull-out to the front, access panel to the left).
- Clearance volumes participate in clash detection as their own category. I want to know
  that a clearance is violated, and I want that to be distinguishable from a hard clash.
- Toggleable in views and excluded from geometric quantities.
- Same concept applies to valve access, damper access and inspection points, not only to
  large plant.

---

## MEP-EQP-05: Family authoring on the platform

**P1.** An engineer can build a parametric family without leaving the platform, and without
being a developer.

**Done means:**

- Parametric geometry from primitives and the usual operations, dimensions driven by named
  parameters.
- Parameters with types, units, ranges and formulas between them.
- **Size tables**: the family holds a table of variants (the catalogue's size range), and
  placing it means choosing a row.
- Connectors defined against parameters, per `MEP-EQP-02`.
- Level-of-detail control, so the same family can be light in a coordination view and
  detailed in a section.
- Families are publishable and shareable: office library, project library, or public.
- Families are versioned, and a model records which version it used.

---

## MEP-EQP-06: Family generation from a catalogue sheet

**P1.** The highest-leverage item in this whole spec.

**Why.** This is different from a normal feature request. The catalogue sheet already
contains almost everything needed to build the family: a dimensioned drawing, a table of
sizes, connection specifications, weights, duties, sometimes the performance curve. It is
close to a complete specification. And what happens today is that an engineer reads that
PDF and
re-types it into a family editor, one dimension at a time, for every piece of equipment on
every project.

That is a translation task from a structured document into a structured schema. It is
exactly what current models are good at, provided the target schema is well defined and the
tooling is strict about validation.

**Done means:**

- I upload a catalogue sheet (PDF or image) and get back a draft family.
- Extraction covers: overall dimensions and how they vary across the size range, the size
  table, connection sizes, types and positions, weights (empty and operating), duty data,
  electrical data.
- Generation targets a **declarative family schema** (`MEP-EQP-07`) rather than free-form
  code, so output is validated, reviewable and repairable.
- The result opens in the family editor (`MEP-EQP-05`) for correction. This is a first draft
  produced in a minute, not an oracle. That framing should be in the UI.
- Every generated value is traceable to where it came from on the sheet, so checking is
  quick. **A value the engineer cannot verify is a value they cannot sign for**, and MEP
  engineers sign for these.
- Values that could not be extracted confidently are flagged, not guessed.
- Runs as a cloud component, so a batch of sheets can be processed in one go. That is how an
  office library actually gets built.

**Notes.** Two comments. First, this is the feature I would show people to explain why the
platform is worth switching to. The time saving is not marginal. Second, it only works if
the schema is strict. A model asked to "produce a family" invents things. A model asked to
fill a validated schema, with the failures visible, does not get the chance to.

---

## MEP-EQP-07: A declarative family schema

**P1.** A documented, versioned, machine-readable format that fully describes a parametric
family.

**Why.** It is the foundation for `MEP-EQP-06`, but it is worth having on its own: families
become diffable, reviewable in a pull request, and generatable by any tool anyone wants to
write.

**Done means:**

- A published schema (JSON or equivalent) covering parameters, size tables, geometry
  construction, connectors, clearances, property sets, level of detail, and metadata.
- Strict validation with useful errors: a generator must be able to tell whether what it
  produced is legal, and what is wrong if not.
- Round-trip: a family authored in the UI can be exported to the schema and re-imported
  without loss.
- Versioned, with a documented migration path.
- Generatable and consumable from a cloud component.

**A sketch, to be argued with.** This is not a proposal for the final shape, just enough to
make the idea concrete:

```jsonc
{
  "schemaVersion": "1.0",
  "id": "generic-ahu",
  "category": "MechanicalEquipment",
  "parameters": [
    { "name": "length", "type": "length", "default": 3200, "min": 800, "max": 12000 },
    { "name": "width",  "type": "length", "default": 1400 },
    { "name": "height", "type": "length", "default": 1600 },
    { "name": "airflow", "type": "volumeFlow", "default": 5000, "unit": "m3/h" },
    { "name": "operatingWeight", "type": "mass", "formula": "emptyWeight + waterContent" }
  ],
  "sizeTable": {
    "columns": ["model", "length", "width", "height", "airflow", "emptyWeight"],
    "rows": [
      ["AHU-05", 2400, 1200, 1300,  5000, 620],
      ["AHU-10", 3200, 1400, 1600, 10000, 940]
    ]
  },
  "geometry": [
    { "op": "box", "size": ["length", "width", "height"], "origin": [0, 0, 0] },
    { "op": "box", "size": [120, "width", "height"], "origin": ["length*0.4", 0, 0],
      "role": "accessPanel" }
  ],
  "connectors": [
    { "id": "supplyAir", "shape": "rectangular", "size": [600, 400],
      "position": ["length", "width*0.25", "height*0.5"], "direction": [1, 0, 0],
      "systemType": "supplyAir", "flowDirection": "out" },
    { "id": "heatingFlow", "shape": "round", "nominalSize": "DN40",
      "connection": "threaded",
      "position": ["length*0.6", 0, 400], "direction": [0, -1, 0],
      "systemType": "heatingFlow", "flowDirection": "in" }
  ],
  "clearances": [
    { "role": "coilPullOut", "size": ["width", "width", "height"],
      "origin": [0, "-width", 0] }
  ],
  "properties": {
    "soundPowerLevel": { "type": "number", "unit": "dB" },
    "electricalLoad":  { "type": "number", "unit": "kW" }
  }
}
```

---

## On the round-trip constraint

Antonio flagged that the dominant authoring tool's API does not permit freely creating
parametric families, so platform-authored families cannot go back into it as native families
that regenerate. Taking that as a fact and designing around it:

- **The schema is the source of truth, not the receiving tool's family format.** A family
  authored here is regenerable here. Other tools get an export.
- **Export as geometry plus data.** A placed instance goes out as a direct shape or an
  IFC element with its full property set and connectors where the receiving side supports
  them. Not parametric, but correct. For coordination that is most of the value.
- **Export the size table as instances, not as types.** If a family has fifteen sizes and
  four are used on the project, export those four as separate resolved objects.
- Where a family is needed as native content in another authoring tool, `MEP-EQP-06` still
  helps: generate the schema from the catalogue sheet, then use it to *drive* creation over
  there. The extraction is the slow part, not the clicking.

Note who this constraint really hurts: it is a reason to do the work on the platform, not a
reason to avoid it. If the family only regenerates here, then here is where the family work
happens.
