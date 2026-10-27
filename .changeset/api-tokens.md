---
'@thatopen/services': minor
---

PlatformClient manages the caller's API tokens: `listTokens`, `getTokenSecret`, `createToken`, `updateToken` and `revokeToken`. A token can be limited to some projects (`projectIds`); without them it acts on every project its owner can reach. New types `AccessToken`, `NewAccessToken` and `AccessTokenPermission`.
