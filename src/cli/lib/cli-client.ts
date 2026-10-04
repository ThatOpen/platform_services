import { EngineServicesClient } from '../../core/client';

/**
 * The one way the CLI builds a client.
 *
 * Every CLI client sends its platform token as `Authorization: Bearer`
 * instead of `?accessToken=`. The CLI holds long-lived API tokens, and the
 * query form reproduces them in proxy logs, error bodies and anything a user
 * pastes while asking for help. Requires a backend that accepts bearer
 * platform tokens (deployed 2026-10); older backends answer 401, in which
 * case upgrading the platform comes first, not flipping this off.
 */
export function cliClient(accessToken: string, apiUrl: string) {
  return new EngineServicesClient(accessToken, apiUrl, { useBearer: true });
}
