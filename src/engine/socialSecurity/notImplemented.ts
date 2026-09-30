import { InvalidProjectionInputError } from '../errors';

/** Builds the typed `SS_NOT_IMPLEMENTED` error thrown by every not-yet-landed SS stub. */
export function notImplemented(fnName: string, owner: string): InvalidProjectionInputError {
  return new InvalidProjectionInputError('SS_NOT_IMPLEMENTED', `${fnName} is not implemented yet (owned by ${owner})`);
}
