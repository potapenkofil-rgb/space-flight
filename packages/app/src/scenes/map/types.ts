/** Local UI-facing types for the map scene — see `MapScene.ts`. */
import type { ManeuverNode } from './maneuverNode';

export interface MapUiState {
  readonly focusBodyId: string;
  readonly focusVesselId: number;
  readonly node: ManeuverNode | null;
}
