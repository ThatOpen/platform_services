# MEP glossary

**Status:** Draft · **Last updated:** 2026-07-29

For readers who are building the platform rather than using it. MEP is jargon-heavy, and
many of the terms in this spec carry real weight. The difference between "invert" and
"centreline" decides whether a requirement is right or wrong by half a diameter.

Terms are grouped by what they are about, not alphabetically, because they mostly only make
sense next to each other.

## The disciplines

| Term | Meaning |
| --- | --- |
| **MEP** | Mechanical, Electrical, Plumbing. The building services disciplines. |
| **HVAC** | Heating, Ventilation and Air Conditioning. The mechanical part of MEP. |
| **Sanitary / plumbing** | Water supply, hot water, drainage. |
| **Building physics** | Envelope thermal behaviour, energy performance. In some countries a separate specialist. In Poland this often lands on the MEP engineer. |

## Pipes and ducts

| Term | Meaning |
| --- | --- |
| **Conduit** | Used in this spec as a catch-all for pipe, duct and cable tray: anything linear that carries something. |
| **DN** | *Diamètre Nominal*, the nominal size designation for pipe. **DN100 is a label, not a dimension**: the actual outer diameter and wall thickness come from the product standard. |
| **NPS** | Nominal Pipe Size, the imperial equivalent. Same warning applies. |
| **SDR** | Standard Dimension Ratio: outer diameter divided by wall thickness. How plastic pipe series are specified. |
| **Wall thickness series** | For steel pipe, the same DN exists in several wall thicknesses. Affects inner diameter, weight and pressure rating. |
| **Run** | A continuous routed length of conduit as the engineer designs it, before it is broken into deliverable pieces. |
| **Segment** | One straight piece as manufactured, delivered and counted. See [`MEP-MOD-10`](./02-modelling-core.md). |
| **Fitting** | Elbow, tee, reducer, transition, coupling: the parts that join and redirect runs. |
| **Reducer, concentric / eccentric** | A size change with the two axes aligned, or offset so one side stays flat. On a sloped or drained line, the choice decides whether the line actually drains. |
| **In-line component** | Something inserted into a run: valve, damper, filter, meter, silencer. |
| **Connector** | The connection point on an element, with position, direction, size, and connection method. What makes a network a network. |
| **Connection method** | How two things join: flanged, welded, threaded, socket, grooved, press, spigot. Not interchangeable. |
| **Spigot** | A plain male end that pushes into a socket. Common on ductwork and plastic drainage. |

## Levels and slope

| Term | Meaning |
| --- | --- |
| **Slope / fall / gradient** | The inclination of a run, given as a ratio (1:100), a percentage or per-mille. |
| **Invert level** | The level of the **inside bottom** of a pipe. What gravity drainage is designed and drawn to. |
| **Crown** | The inside top of a pipe. |
| **Centreline** | The axis of the pipe. Sloping to the centreline and sloping to the invert give different results wherever the size changes, by half the diameter difference. |
| **Cover** | Depth of material over the top of a buried pipe. |
| **Chainage** | Distance measured along a route. The horizontal axis of a longitudinal profile. |
| **Riser** | A vertical run between levels. |
| **Shaft** | The vertical space in the building the risers pass through. Perpetually contested. |

## Systems and zones

| Term | Meaning |
| --- | --- |
| **System** | A named group of elements serving one purpose, for example "Supply air AHU-1" or "Heating circuit 2". How MEP engineers organise, schedule and calculate. |
| **Flow / return** | The two halves of a closed hydronic circuit: out to the terminals, back to the source. |
| **MEP zone** | A grouping of spaces sharing a design condition or a control regime. **Not** the same as an architectural room. One room can be in several. One zone spans many rooms. |
| **Space / room** | The architectural volume. The building block the zones are made from. |
| **Terminal** | Where the system meets the room: diffuser, grille, radiator, fan coil, tap, socket. |
| **Compartment** | A fire-rated division of the building. Services crossing it need dampers or seals. |
| **P&ID** | Piping and Instrumentation Diagram: the schematic of a plant room showing equipment, valves, instruments and control, as symbols and lines rather than geometry. A mandatory deliverable. |
| **Riser diagram** | The unfolded vertical schematic of a system across floors (*rozwinięcie* in Polish). Shows every branch, terminal and size per level on one flat drawing. Also a mandatory deliverable. |

## Equipment

| Term | Meaning |
| --- | --- |
| **AHU** | Air Handling Unit: the box that filters, heats, cools and moves the ventilation air. |
| **FCU** | Fan Coil Unit: local room-level heating and cooling. |
| **VAV / CAV** | Variable / Constant Air Volume terminal box: regulates airflow into a zone. |
| **Chiller** | Produces chilled water. |
| **DHW storage cylinder** | Stores and heats domestic hot water, usually via a coil fed from the primary heating system. |
| **Kv / Kvs** | Valve flow coefficient: the flow through a valve at a given pressure drop. Kvs is the value at fully open. |
| **Valve authority** | The valve's share of the circuit pressure drop. Decides whether it can actually control anything. |
| **Presetting** | The fixed restriction set on a balancing valve during commissioning. |
| **Duty** | What a piece of equipment is required to deliver: kW, m³/h, l/s, and the conditions it applies at. |
| **Operating weight** | Weight in service, including the fluid in it. Distinct from empty weight, and the one the structural engineer needs. |
| **Test weight** | Weight when filled with water for pressure testing. For gas and air systems this is the governing load case, and it is routinely forgotten. |

## Calculations

| Term | Meaning |
| --- | --- |
| **Design heat loss** | Steady-state heat demand per room at design outdoor conditions. Sizes the heating. |
| **Cooling load** | Peak cooling demand, including solar and internal gains. Sizes the cooling. |
| **Internal gains** | Heat from people, lighting and equipment. |
| **Infiltration** | Uncontrolled air leakage through the envelope. |
| **U-value** | Thermal transmittance of a construction, W/m²K. Lower is better. |
| **g-value** | Fraction of solar energy transmitted through glazing. |
| **Thermal bridge** | A local weak point in the envelope where heat bypasses the insulation. |
| **Space boundary** | The surface bounding a space, with what is on the other side. The hard part of getting a BIM model into a thermal calculation, and the valuable part. |
| **gbXML** | An exchange format for thermal and energy models. The usual bridge to energy simulation tools. |
| **Hydraulic calculation** | Sizing and balancing a network: flows, velocities, pressure drops, pump or fan duty, valve settings. |
| **Pressure drop** | Energy lost to friction along a run and through components. |
| **Local loss / K-factor** | Pressure loss at a fitting or component, expressed as a coefficient or an equivalent straight length. |
| **Roughness** | Surface roughness of the pipe or duct wall. Feeds the friction calculation. |
| **Simultaneity / diversity factor** | The assumption that not everything runs at once. Applied to demand, and responsible for a lot of design risk. |
| **Balancing** | Setting the network so each branch gets its design flow instead of whatever the path of least resistance gives it. |
| **Static head** | Pressure due to height difference in a fluid column. |
| **Part-full flow** | Flow in a gravity pipe that is not running full. The normal case in drainage, and a different calculation from pressure flow. |
| **Catchment** | The area draining to a given point. |
| **Return period** | The design storm severity, for example a 1-in-5-year rainfall. A code and client decision, not an engineering one. |

## Coordination

| Term | Meaning |
| --- | --- |
| **Penetration / opening** | A hole through a wall, slab or beam for a service to pass. Usually not yours to cut. |
| **Hanger / support** | What holds a run up. How MEP load reaches the structure. |
| **Trapeze** | A support carrying several runs on a common horizontal member. |
| **Span** | The distance between supports. Set by code table, by carried load, or by office standard. |
| **Service clearance** | The space around equipment needed to operate and maintain it: pull the coil, swing the door, change the filter. Must be reserved, and routinely is not. |
| **Ceiling void** | The space between the ceiling and the slab above, where most coordination conflicts happen. |
| **Clearance clash** | Not a geometric collision, but a violation of a required gap. Different from a hard clash and needs to be reported differently. |
| **BOM** | Bill of Materials. For construction it must be segmented into deliverable lengths. See [`MEP-MOD-10`](./02-modelling-core.md). |
| **Longitudinal profile** | A section drawn along a route, at different horizontal and vertical scales. The vertical exaggeration is the point. |
