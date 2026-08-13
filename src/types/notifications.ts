// Re-exported from the backend rather than redeclared here.
//
// Every other file in this directory is a hand-maintained copy of a backend
// type, which is why `base.ts` has to alias `ObjectId` to `string` and hope
// it stays true. These come straight from `src/common/dto` in the backend
// repo, vendored as a submodule, so the contract cannot drift from what the
// API actually sends.
//
// Run `yarn types:update` to move the pin. Nothing in that directory imports
// `mongodb`, which is what makes it safe to compile in a browser build.
export type {
  NotificationCategoryDto,
  NotificationDto,
  NotificationPageDto,
  NotificationTypeDto,
  MarkNotificationsReadResultDto,
  UnreadCountDto,
} from '../../vendor/backend-api/src/common/dto/notifications.dto';

export type { BaseDto } from '../../vendor/backend-api/src/common/dto/base.dto';

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
