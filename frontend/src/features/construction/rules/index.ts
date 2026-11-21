// Pure footprint and range placement checks plus reject code lists.
export { checkFootprint, checkRange, FOOTPRINT_CODES, RANGE_CODES } from './placement';
// Placement rule and view interfaces shared by sim and client preview.
export type { PlacementRule, PlacementView } from './placement';
// Snapshot-backed PlacementView adapter for client build ghost and bots.
export { makePlacementView } from './placement-view';
// Pure demolition refund, footprint centering, and cancel classification helpers.
export { centeredFootprint, classifyCancelSelection, demolishRefund } from './demolish';
