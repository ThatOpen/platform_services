// Declared here rather than imported from the backend.
//
// The obvious move is to vendor `src/common/dto` from the backend repo so the
// contract has one definition. It does not work for this package: this repo
// is public and the backend is private, so a clean clone and any fork PR
// could not build, and reaching outside `src` moves tsc's root and reshuffles
// the published `dist` layout, breaking deep imports.
//
// Sharing these properly means publishing the backend's wire DTOs as their
// own package and depending on it normally. Until then this mirrors
// `src/common/dto/notifications.dto.ts` and has to be updated alongside it.

export type NotificationCategoryDto = 'automation' | 'invitation';

export type NotificationTypeDto =
  | 'automation.run.started'
  | 'automation.run.finished'
  | 'invitation.added'
  | 'invitation.accepted'
  | 'project.role_changed';

/**
 * One notification as the API returns it.
 *
 * Ids are strings and timestamps are ISO-8601 strings, because that is what
 * JSON carries. The producer payload is deliberately absent: `title`, `body`
 * and `link` are built server-side, so the data behind them is an internal
 * detail rather than part of this contract.
 */
export interface NotificationDto {
  _id: string;
  accountId: string;
  type: NotificationTypeDto;
  category: NotificationCategoryDto;
  title: string;
  body: string;
  link?: string;
  /** Silenced by the recipient: still listed, but no badge and no channel. */
  muted: boolean;
  readAt: string | null;
  createdAt: string;
  /**
   * What to group consecutive notifications by — the automation id for a run,
   * absent for anything that should stand alone.
   *
   * Derived rather than the raw producer payload, so fifty runs of one
   * automation can collapse into a single row without the whole payload being
   * on the wire for every notification type, forever.
   */
  groupKey?: string;
  /**
   * How an automation run ended, straight from the producer's result.
   *
   * Use this rather than reading the copy. `title` is built from the user's own
   * automation name, so an automation called "Failover sync" makes every
   * successful run look failed to anything matching on the text.
   */
  outcome?: 'success' | 'error' | 'warning';
  /**
   * The automation's name, for a grouped row's heading. Here for the same
   * reason as `outcome`: recovering it by stripping words off the title breaks
   * on any name that contains them.
   */
  groupLabel?: string;
}

/** `nextCursor` is opaque — pass it back verbatim. Null means the last page. */
export interface NotificationPageDto {
  items: NotificationDto[];
  nextCursor: string | null;
}

/** Excludes muted and already-read notifications: this is the bell badge. */
export interface UnreadCountDto {
  count: number;
}

export interface MarkNotificationsReadResultDto {
  updated: number;
}

/** A user's opt-in to one automation's runs, as the API returns it. */
export interface NotificationSubscriptionView {
  _id: string;
  accountId: string;
  hookId: string;
  /** Absent for personal automations, which belong to an account. */
  projectId?: string;
  filter: NotificationSubscriptionFilter;
  channels?: { email?: boolean };
  createdAt: string;
  updatedAt?: string;
}

/**
 * `failures` suppresses started events entirely and only passes a finished
 * run that did not succeed.
 */
export type NotificationSubscriptionFilter = 'all' | 'failures';
