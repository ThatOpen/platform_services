# Specs

Discipline specifications for That Open Platform, written by the people who do the work.

A spec here is **not** a feature request list and **not** a component catalogue. It is a
reviewable, correctable description of three things:

1. **How a discipline actually works today**, step by step, with the tools really used.
2. **Where that workflow burns time or money.** Usually on tool-hopping, re-entry and
   re-sync, not on the design itself.
3. **What the platform would have to do** for that waste to stop existing.

The point of (1) and (2) is that (3) can be argued with. A feature list is a guess. A
described workflow is evidence.

## Index

| Spec | Discipline | Status |
| --- | --- | --- |
| [`mep/`](./mep/README.md) | MEP: HVAC, plumbing, gas, and the electrical work that touches them | Draft |

## Layout

One folder per discipline. Inside it, a `README.md` that carries the summary and the index,
and numbered topic files that can be reviewed and argued with independently:

```text
specs/
  <discipline>/
    README.md            summary, minimum viable scope, index
    01-...md             workflow and waste, the evidence
    02-...md, 03-...md   requirements, grouped so each file is reviewable alone
    glossary.md          domain terms, for readers outside the discipline
```
