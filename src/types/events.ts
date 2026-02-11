import { Base, ObjectId } from './base';

export enum EventScope {
  PERSONAL = 'PERSONAL',
  PROJECT = 'PROJECT',
}

export enum EventStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

export interface EventHook extends Base {
  name: string;
  description?: string;
  eventType: string;
  scope: EventScope;
  isActive: boolean;
  toolId: string;
  versionTag?: string;
  toolConfig?: Record<string, any>;
}

export interface EventLog extends Base {
  hookId: ObjectId;
  eventType: string;
  status: EventStatus;
  executedAt: Date;
  duration?: number;
  result?: string;
  payload?: Record<string, any>;
  executionCount: number;
}

export interface EnrichedEventLog extends EventLog {
  hookName?: string;
}

export type CreateEventHookParams = {
  name: string;
  description?: string;
  eventType: string;
  scope: EventScope;
  isActive?: boolean;
  toolId: string;
  versionTag?: string;
  toolConfig?: Record<string, any>;
};

export type UpdateEventHookParams = {
  name?: string;
  description?: string;
  eventType?: string;
  isActive?: boolean;
  toolId?: string;
  versionTag?: string;
  toolConfig?: Record<string, any>;
};
