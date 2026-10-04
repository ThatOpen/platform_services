export interface Base {
  _id: ObjectId;
  createdAt: Date;
  updatedAt?: Date;
  /**
   * The human user who performed the action (audit trail). This used to be
   * declared as a required `creatingUser`, a field the API has never
   * returned — the server sends `createdBy`, optionally. Matching the wire
   * is what a type is for.
   */
  createdBy?: ObjectId;
  /** The human user who last updated the entity (audit trail). */
  lastUpdatedBy?: ObjectId;
  creatingToken?: ObjectId;
  archived?: boolean;
}

export type ObjectId = string;
