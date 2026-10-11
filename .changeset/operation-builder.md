---
'@thatopen/services': minor
---

`OperationBuilder` joins the SDK: authors an interoperability operation — geometry-less .frag, envelope `revitflow/op@2`, laid out exactly as the C# reader expects — from plain `add`/`set`/`remove` calls, returning the deflated bytes for `suggest({ payload })` or a recipe's result. Attributes are written untranslated, in the target application's own terms and units. Its two dependencies, `flatbuffers` and `@thatopen/fragments`, are OPTIONAL peers resolved only when `build()` runs, so apps that never author operations install and pay nothing new.
