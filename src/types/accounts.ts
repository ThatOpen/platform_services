import { ObjectId } from './base';

export interface Account {
  _id: ObjectId;
  creatingEntity: ObjectId;
  isAdmin?: boolean;
  createdAt: Date;
  onboarded?: boolean;
  fullName: string;
  email: string;
  authId: string;
  country?: string;
  companyName?: string;
  accountTier: AccountTier;
}

export type AccountTier = 'FREE' | 'ENTERPRISE';

export type UpdateAccountParams = {
  fullName: string;
  companyName?: string;
  country?: string;
};
