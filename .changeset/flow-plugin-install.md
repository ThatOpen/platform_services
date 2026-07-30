---
'@thatopen/services': minor
---

CLI: `thatopen revit install` and `thatopen rhino install` (both aliased as `update`) install the
That Open Revit add-in and Rhino plug-in from their private npm packages.

Access comes from the platform token, the same way `--beta` gets the private engine libraries: the
CLI trades it for read-only registry credentials, so nobody needs an npm account or an npm token.

npm does the downloading, the version resolution and the integrity check, rather than this
hand-rolling HTTP and getting one of the three subtly wrong. The Revit package ships its own
`install.ps1`, so the CLI never has to know where Revit keeps its add-ins; the Rhino package is
installed through Yak, which records the Rhino versions the plug-in targets and refuses to install
into one it was not built for.

Both refuse while the host application is running. That is the difference between a failed install
and a broken one: Revit and Rhino hold their plug-in assemblies open for the whole session, so a
copy over a running host fails on the first locked file *after* copying the ones it reached, leaving
a folder with some new DLLs and some old that loads and misbehaves.

This is also why installing is the CLI's job at all. A Revit add-in cannot replace itself while
Revit runs, so it can only notice it is out of date and say so; the CLI is what runs with Revit
closed.
