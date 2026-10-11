---
'@thatopen/services': minor
---

The model at a version, and explicit descriptor migration. `doc.model()` now SAYS what it is: the last full export (first commit or last publish), not the head — ordinary syncs only add hidden deltas. The new `doc.modelParts({ at? })` answers the ordered recipe for the model at any version: the baseline full export at-or-before it (with `current: false` plus the stored `storageVersion` when a later publish rewrote the visible file) and one step per later version — its delta's hidden id and the uniqueIds it removed. The consumer composes with its geometry engine (load baseline, replace by uniqueId per step, drop removed); composing a merged .frag is deliberately not done here. UniqueIds are the native app's stable element ids and survive syncs, machines and full exports. And `doc.ensureDescriptor()` migrates a pre-descriptor folder on purpose (model .frag becomes the 'frag' view) — reads never write.
