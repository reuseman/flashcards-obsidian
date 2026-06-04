import type {
  CreateOp,
  DeleteOp,
  UpdateOp,
} from "./sync-plan.js";

/**
 * Outcome of executing a sync plan against the card store.
 *
 * These are plain data describing the RESULT of a sync (ids, names, errors) —
 * a domain/sync contract, not Anki transport. They live in `core/sync` so the
 * writeback step (`core/edits/writeback-sync-results.ts`) and the application
 * use case can depend on them without reaching into `adapters/`. The concrete
 * `executeSyncPlan` adapter imports these back from here.
 */

export interface CreateOpResult {
  op: CreateOp;
  status: "ok" | "failed";
  nid?: number;
  error?: string;
}

export interface UpdateOpResult {
  op: UpdateOp;
  status: "ok" | "failed";
  error?: string;
}

export interface DeleteOpResult {
  op: DeleteOp;
  status: "ok" | "failed";
  error?: string;
}

export interface ExecuteSyncPlanResult {
  creates: CreateOpResult[];
  updates: UpdateOpResult[];
  deletes: DeleteOpResult[];
}
