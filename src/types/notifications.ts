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
