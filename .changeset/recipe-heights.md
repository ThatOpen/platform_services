---
'@thatopen/services': patch
---

`ifc-to-revit` / `frag-to-revit`: walls and floors land at the right height. A wall run's `base` and a slab's `base` are RELATIVE to their level, and the recipe treated them as absolute, so every wall on a level above zero came out a full level lower and floors lost their offset. Walls now ask for `BaseOffset = base` with the line at `level + base`; floors carry `HeightOffset` (their top face above the level, base + thickness), which the Revit applier sets after creating them.
