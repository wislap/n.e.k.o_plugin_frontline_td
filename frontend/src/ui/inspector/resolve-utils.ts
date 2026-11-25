// Shared row-lookup helper for inspector resolvers (ADR 0062 step 3).
export function indexOfHandle(handles: Float64Array, handle: number): number {
  for (let i = 0; i < handles.length; i++) {
    if (handles[i] === handle) {
      return i;
    }
  }
  return -1;
}
