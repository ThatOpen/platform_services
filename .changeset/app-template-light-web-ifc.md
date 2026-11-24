---
"@thatopen/services": patch
---

The app template carries web-ifc's constants only, not its IFC reader (`src/webgpu/web-ifc-light.mjs`, written at build time from the web-ifc installed): the platform converts IFC files on upload. A new app's bundle goes from 18.4 to 14.7 MB, and building it needs ~2.25 GB instead of ~2.8.
