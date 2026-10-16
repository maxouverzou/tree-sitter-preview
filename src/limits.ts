export const MAX_INPUT_BYTES = 5 * 1024 * 1024;
export const MAX_OUTPUT_BYTES = 32 * 1024;
export const MAX_OUTPUT_LINES = 1000;
export const MAX_DIRECTORY_ENTRIES = 1000;
export const MAX_DEPTH = 8;
export function checkAbort(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}
