/**
 * Validation error codes and issue records shared by the part and system
 * loaders (PLAN.md §6.2). A broken part or body must never crash the game: it
 * is reported as an `Issue` with a machine-readable `code` and a human
 * message, and skipped — the caller (menu/UI) decides how to surface the
 * "mods with errors" list.
 */

/** Every validation error code the loaders can produce. `SCREAMING_SNAKE`, prefixed `ERR_PART_`/`ERR_SYSTEM_`. */
export type IssueCode =
  | 'ERR_PART_INVALID_JSON'
  | 'ERR_PART_MISSING_FIELD'
  | 'ERR_PART_INVALID_FIELD'
  | 'ERR_PART_INVALID_ID'
  | 'ERR_PART_INVALID_CATEGORY'
  | 'ERR_PART_INVALID_RESOURCE'
  | 'ERR_PART_INVALID_ENGINE'
  | 'ERR_PART_INVALID_NODE'
  | 'ERR_PART_INVALID_SVG'
  | 'ERR_PART_MISSING_SVG'
  | 'ERR_SYSTEM_INVALID_JSON'
  | 'ERR_SYSTEM_MISSING_FIELD'
  | 'ERR_SYSTEM_INVALID_FIELD'
  | 'ERR_SYSTEM_INVALID_BODY'
  | 'ERR_SYSTEM_DUPLICATE_BODY'
  | 'ERR_SYSTEM_UNKNOWN_PARENT'
  | 'ERR_SYSTEM_NO_ROOT'
  | 'ERR_SYSTEM_MULTIPLE_ROOTS'
  | 'ERR_SYSTEM_CYCLE';

/**
 * One validation problem found while loading a part or a system file.
 * `origin` identifies the source unambiguously in a log/UI list (e.g.
 * `"mods/example/parts/strut_truss"`).
 */
export interface Issue {
  readonly code: IssueCode;
  readonly message: string;
  readonly origin: string;
  /** Dot/bracket path to the offending field within the source JSON, e.g. `"nodes[2].kind"`. Empty for whole-file problems. */
  readonly path: string;
}

/** Builds an {@link Issue}. Small helper so call sites stay one-liners. */
export function issue(code: IssueCode, origin: string, path: string, message: string): Issue {
  return { code, message, origin, path };
}
