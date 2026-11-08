---
"@thatopen/services": minor
---

`thatopen create` works without `--beta`: the project uses the public engine libraries (`@thatopen/components`, `-front`, `fragments` ^3.6), which anyone can install, and `--beta` keeps the Founding Members' beta ones. The engine peers accept any 3.x from 3.4, and `client.setup<OBC.Components>` type-checks with the public 3.6 engine.
