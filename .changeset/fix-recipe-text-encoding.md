---
'@thatopen/services': patch
---

The built-in recipes' manifests and docs read correctly everywhere: 0.26.0 shipped them with mojibake (dashes, ellipses and apostrophes double-encoded by a PowerShell 5.1 round trip that reads BOM-less UTF-8 as ANSI). All recipe text is plain ASCII now.
