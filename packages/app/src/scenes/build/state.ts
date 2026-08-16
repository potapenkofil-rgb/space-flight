/**
 * The hangar's assembly state: placed parts, joints, stages and symmetry
 * groups, plus the pure functions that mutate it. No DOM here — this module is
 * unit-tested headlessly (`state.test.ts`) and is what `BuildScene.ts` wraps
 * with pointer/click handling.
 *
 * A `Vessel` (PLAN.md §4) is a tree of `PartInstance`s; this module models the
 * same tree but keeps a couple of extra bookkeeping fields (`attachedTo`,
 * symmetry-group membership) the contract doesn't need, so `toVessel` strips
 * them back down to exactly the `Vessel` shape the rest of the game (and
 * `computeMass`/`computeDeltaV`, once Agent B's real ones land) expects.
 */
import {
  v2,
  type AttachNode,
  type Body,
  type JointLink,
  type PartDef,
  type PartLibrary,
  type Stage,
  type Vec2,
  type Vessel,
} from '@karman/core';

export type SymmetryCount = 1 | 2 | 4 | 6;

/** One part placed in the hangar. Extends `PartInstance` bookkeeping with the attachment that put it there. */
export interface PlacedPart {
  readonly instanceId: number;
  readonly partId: string;
  position: Vec2;
  rotation: number;
  resources: Record<string, number>;
  /** `null` only for the very first part placed (the assembly root). */
  attachedTo: { readonly instanceId: number; readonly nodeIndex: number; readonly ownNodeIndex: number } | null;
  symmetryGroupId: string | null;
}

export interface JointRecord {
  readonly id: number;
  readonly a: number;
  readonly b: number;
  readonly nodeKind: AttachNode['kind'];
  readonly strength: number;
}

/** A radial symmetry group: `memberInstanceIds[0]` is the leader the player actually placed; the rest are generated. */
export interface SymmetryGroup {
  readonly id: string;
  readonly partId: string;
  count: SymmetryCount;
  memberInstanceIds: number[];
  readonly parentInstanceId: number;
  readonly parentNodeIndex: number;
}

/** A stage bucket in firing order (array index 0 fires first, per PLAN.md §4 `Stage.index`). Reordering is just an array move. */
export interface StageBucket {
  readonly id: string;
  partIds: number[];
}

export interface BuildState {
  parts: PlacedPart[];
  joints: JointRecord[];
  symmetryGroups: SymmetryGroup[];
  stages: StageBucket[];
  symmetryMode: SymmetryCount;
  selectedInstanceId: number | null;
  nextInstanceId: number;
  nextJointId: number;
  nextStageOrdinal: number;
}

export function createEmptyState(): BuildState {
  return {
    parts: [],
    joints: [],
    symmetryGroups: [],
    stages: [{ id: 'stage-0', partIds: [] }],
    symmetryMode: 1,
    selectedInstanceId: null,
    nextInstanceId: 1,
    nextJointId: 1,
    nextStageOrdinal: 1,
  };
}

export function findPart(state: BuildState, instanceId: number): PlacedPart | undefined {
  return state.parts.find((p) => p.instanceId === instanceId);
}

/** World position of a part's `nodeIndex`-th attach node, in the vessel-local frame (PLAN.md §6.1 origin/axes). */
export function nodeWorldPos(part: PlacedPart, def: PartDef, nodeIndex: number): Vec2 {
  const node = def.nodes[nodeIndex];
  if (!node) throw new RangeError(`nodeWorldPos: part "${def.id}" has no node ${nodeIndex}`);
  return v2.add(part.position, v2.rot(node.pos, part.rotation));
}

/** World-facing direction of a part's `nodeIndex`-th attach node (unit vector). */
export function nodeWorldDir(part: PlacedPart, def: PartDef, nodeIndex: number): Vec2 {
  const node = def.nodes[nodeIndex];
  if (!node) throw new RangeError(`nodeWorldDir: part "${def.id}" has no node ${nodeIndex}`);
  return v2.rot(node.dir, part.rotation);
}

function nodesCompatible(a: AttachNode, b: AttachNode): boolean {
  return a.kind === b.kind && a.size === b.size;
}

/** Node indices already consumed by a joint, per part instance. */
function occupiedNodes(state: BuildState): Map<number, Set<number>> {
  const map = new Map<number, Set<number>>();
  const mark = (instanceId: number, nodeIndex: number) => {
    const set = map.get(instanceId) ?? new Set<number>();
    set.add(nodeIndex);
    map.set(instanceId, set);
  };
  for (const part of state.parts) {
    if (part.attachedTo) {
      mark(part.attachedTo.instanceId, part.attachedTo.nodeIndex);
      mark(part.instanceId, part.attachedTo.ownNodeIndex);
    }
  }
  return map;
}

export interface OpenNode {
  readonly instanceId: number;
  readonly nodeIndex: number;
  readonly node: AttachNode;
  readonly worldPos: Vec2;
  readonly worldDir: Vec2;
}

/** Every attach node not already consumed by a joint, across the whole assembly. */
export function listOpenNodes(state: BuildState, parts: PartLibrary): OpenNode[] {
  const occupied = occupiedNodes(state);
  const out: OpenNode[] = [];
  for (const placed of state.parts) {
    const def = parts.get(placed.partId);
    const taken = occupied.get(placed.instanceId);
    def.nodes.forEach((node, nodeIndex) => {
      if (taken?.has(nodeIndex)) return;
      out.push({
        instanceId: placed.instanceId,
        nodeIndex,
        node,
        worldPos: nodeWorldPos(placed, def, nodeIndex),
        worldDir: nodeWorldDir(placed, def, nodeIndex),
      });
    });
  }
  return out;
}

/**
 * Picks the held part's own node that best mates with a target node pointed in
 * `targetWorldDir`. `computeAttachTransform` will make *any* kind/size-compatible
 * node coincide with the target and face into it — but which node gets chosen
 * still decides the resulting rotation, because a part's other nodes generally
 * point a different way in its *local* frame (e.g. a stack part's bottom node is
 * `dir (0,-1)`, its top node `dir (0,1)`, 180° apart). Picking the wrong one
 * forces `computeAttachTransform` to spin the whole part 180° to make the chosen
 * node line up — harmless for a symmetric tank, but for an engine (PLAN.md §6.1,
 * §5.5; `fuel.ts`'s thrust direction is the part's own local +Y) it flips the
 * nozzle to face the sky instead of the ground.
 *
 * The fix: choose the own node whose *local* direction is already most nearly
 * antiparallel to `targetWorldDir` (minimises `dot(node.dir, targetWorldDir)`) —
 * that is the node that needs the *least* rotation to face the target, so
 * attaching "below" an open node facing down picks the part's own top/mount
 * node, and attaching "above" an open node facing up picks its bottom node,
 * regardless of which direction the assembly is being built in. A 180° flip
 * only ever happens now when it's the only way to mate compatible nodes at all
 * (e.g. every candidate node points the same way), not as a side effect of an
 * arbitrary tie-break.
 */
function bestOwnNode(def: PartDef, kind: AttachNode['kind'], size: number, targetWorldDir: Vec2): number | null {
  let best: number | null = null;
  let bestDot = Number.POSITIVE_INFINITY;
  def.nodes.forEach((node, i) => {
    if (node.kind !== kind || node.size !== size) return;
    const dot = v2.dot(node.dir, targetWorldDir);
    if (dot < bestDot) {
      bestDot = dot;
      best = i;
    }
  });
  return best;
}

/** The transform (`position`, `rotation`) a new part needs so its own node `ownNode` coincides with, and faces into, a parent node at `parentWorldPos`/`parentWorldDir`. */
export function computeAttachTransform(
  parentWorldPos: Vec2,
  parentWorldDir: Vec2,
  ownNode: AttachNode
): { position: Vec2; rotation: number } {
  const desiredWorldDir = v2.scale(parentWorldDir, -1);
  const desiredAngle = Math.atan2(desiredWorldDir.y, desiredWorldDir.x);
  const ownAngle = Math.atan2(ownNode.dir.y, ownNode.dir.x);
  const rotation = desiredAngle - ownAngle;
  const position = v2.sub(parentWorldPos, v2.rot(ownNode.pos, rotation));
  return { position, rotation };
}

export interface AttachCandidate {
  readonly parentInstanceId: number;
  readonly parentNodeIndex: number;
  readonly ownNodeIndex: number;
  readonly worldPos: Vec2; // the parent node's world position — what the cursor snaps to
  readonly transform: { position: Vec2; rotation: number };
  readonly kind: AttachNode['kind'];
}

/** All places the given (not-yet-placed) part could attach right now. `grid.ts` picks the nearest one on screen. */
export function findAttachCandidates(state: BuildState, parts: PartLibrary, heldPartId: string): AttachCandidate[] {
  const heldDef = parts.get(heldPartId);
  const open = listOpenNodes(state, parts);
  const out: AttachCandidate[] = [];
  for (const target of open) {
    const ownNodeIndex = bestOwnNode(heldDef, target.node.kind, target.node.size, target.worldDir);
    if (ownNodeIndex === null) continue;
    const ownNode = heldDef.nodes[ownNodeIndex];
    if (!ownNode || !nodesCompatible(ownNode, target.node)) continue;
    out.push({
      parentInstanceId: target.instanceId,
      parentNodeIndex: target.nodeIndex,
      ownNodeIndex,
      worldPos: target.worldPos,
      transform: computeAttachTransform(target.worldPos, target.worldDir, ownNode),
      kind: target.node.kind,
    });
  }
  return out;
}

function fullResources(def: PartDef): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of def.resources) out[r.id] = r.capacity;
  return out;
}

/** Places `partId` at world origin as the assembly root. Only valid when the assembly is empty. */
export function placeRoot(state: BuildState, parts: PartLibrary, partId: string): BuildState {
  if (state.parts.length > 0) throw new Error('placeRoot: assembly is not empty');
  const def = parts.get(partId);
  const instanceId = state.nextInstanceId;
  const placed: PlacedPart = {
    instanceId,
    partId,
    position: { x: 0, y: 0 },
    rotation: 0,
    resources: fullResources(def),
    attachedTo: null,
    symmetryGroupId: null,
  };
  const next: BuildState = {
    ...state,
    parts: [...state.parts, placed],
    nextInstanceId: instanceId + 1,
  };
  return appendToCurrentStage(next, instanceId, def);
}

function appendToCurrentStage(state: BuildState, instanceId: number, def: PartDef): BuildState {
  const stages = state.stages.map((s, i) =>
    i === state.stages.length - 1 ? { ...s, partIds: [...s.partIds, instanceId] } : s
  );
  let nextStageOrdinal = state.nextStageOrdinal;
  // A separator marks a real separation event, so it closes out the stage it
  // lands in — subsequent placements start a fresh one (PLAN.md §7, "stage
  // panel"). Engines alone don't close a stage: side boosters and a core
  // engine routinely fire together in the same stage.
  if (def.category === 'separators') {
    stages.push({ id: `stage-${nextStageOrdinal}`, partIds: [] });
    nextStageOrdinal += 1;
  }
  return { ...state, stages, nextStageOrdinal };
}

function withRotatedSibling(
  state: BuildState,
  leader: PlacedPart,
  leaderDef: PartDef,
  parent: PlacedPart,
  angle: number
): { state: BuildState; instanceId: number } {
  const position = v2.add(parent.position, v2.rot(v2.sub(leader.position, parent.position), angle));
  const rotation = leader.rotation + angle;
  const instanceId = state.nextInstanceId;
  const placed: PlacedPart = {
    instanceId,
    partId: leader.partId,
    position,
    rotation,
    resources: fullResources(leaderDef),
    attachedTo: leader.attachedTo && { ...leader.attachedTo },
    symmetryGroupId: leader.symmetryGroupId,
  };
  let next: BuildState = { ...state, parts: [...state.parts, placed], nextInstanceId: instanceId + 1 };
  if (leader.attachedTo) {
    next = withJoint(next, leader.attachedTo.instanceId, instanceId, 'radial');
  }
  next = appendToCurrentStage(next, instanceId, leaderDef);
  return { state: next, instanceId };
}

function withJoint(state: BuildState, a: number, b: number, nodeKind: AttachNode['kind'], strength = 0): BuildState {
  const joint: JointRecord = { id: state.nextJointId, a, b, nodeKind, strength };
  return { ...state, joints: [...state.joints, joint], nextJointId: state.nextJointId + 1 };
}

/**
 * Attaches `partId` at `candidate` (from `findAttachCandidates`). Radial
 * attachments made while `state.symmetryMode > 1` immediately spawn the
 * mirrored siblings as a `SymmetryGroup` (PLAN.md §7, "live" symmetry).
 */
export function attachPart(
  state: BuildState,
  parts: PartLibrary,
  partId: string,
  candidate: AttachCandidate
): BuildState {
  const def = parts.get(partId);
  const parent = findPart(state, candidate.parentInstanceId);
  if (!parent) throw new Error(`attachPart: parent instance ${candidate.parentInstanceId} not found`);
  const parentDef = parts.get(parent.partId);
  const strength = Math.min(def.nodeStrength, parentDef.nodeStrength);

  const instanceId = state.nextInstanceId;
  const placed: PlacedPart = {
    instanceId,
    partId,
    position: candidate.transform.position,
    rotation: candidate.transform.rotation,
    resources: fullResources(def),
    attachedTo: { instanceId: candidate.parentInstanceId, nodeIndex: candidate.parentNodeIndex, ownNodeIndex: candidate.ownNodeIndex },
    symmetryGroupId: null,
  };

  let next: BuildState = { ...state, parts: [...state.parts, placed], nextInstanceId: instanceId + 1 };
  next = withJoint(next, candidate.parentInstanceId, instanceId, candidate.kind, strength);
  next = appendToCurrentStage(next, instanceId, def);

  if (candidate.kind === 'radial' && state.symmetryMode > 1) {
    const groupId = `sym-${instanceId}`;
    const memberIds = [instanceId];
    for (let k = 1; k < state.symmetryMode; k++) {
      const angle = (2 * Math.PI * k) / state.symmetryMode;
      const leader = findPart(next, instanceId);
      if (!leader) break;
      const result = withRotatedSibling(next, leader, def, parent, angle);
      next = result.state;
      memberIds.push(result.instanceId);
    }
    const group: SymmetryGroup = {
      id: groupId,
      partId,
      count: state.symmetryMode,
      memberInstanceIds: memberIds,
      parentInstanceId: candidate.parentInstanceId,
      parentNodeIndex: candidate.parentNodeIndex,
    };
    next = {
      ...next,
      symmetryGroups: [...next.symmetryGroups, group],
      parts: next.parts.map((p) => (memberIds.includes(p.instanceId) ? { ...p, symmetryGroupId: groupId } : p)),
    };
  }

  return next;
}

/** Every instance in the subtree rooted at `instanceId` (itself included), following `attachedTo` edges downward. */
export function subtreeInstanceIds(state: BuildState, instanceId: number): Set<number> {
  const children = new Map<number, number[]>();
  for (const p of state.parts) {
    if (!p.attachedTo) continue;
    const list = children.get(p.attachedTo.instanceId) ?? [];
    list.push(p.instanceId);
    children.set(p.attachedTo.instanceId, list);
  }
  const out = new Set<number>();
  const stack = [instanceId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || out.has(id)) continue;
    out.add(id);
    for (const child of children.get(id) ?? []) stack.push(child);
  }
  return out;
}

/** Removes exactly the given instances (and their existing joints/stage entries) — no symmetry-group awareness. Internal building block for both {@link removePart} and {@link rebuildSymmetryGroup}. */
function removeInstances(state: BuildState, doomed: ReadonlySet<number>): BuildState {
  return {
    ...state,
    parts: state.parts.filter((p) => !doomed.has(p.instanceId)),
    joints: state.joints.filter((j) => !doomed.has(j.a) && !doomed.has(j.b)),
    stages: state.stages.map((s) => ({ ...s, partIds: s.partIds.filter((id) => !doomed.has(id)) })),
    selectedInstanceId: state.selectedInstanceId !== null && doomed.has(state.selectedInstanceId) ? null : state.selectedInstanceId,
  };
}

/**
 * Removes `instanceId` and everything attached above/below it (the whole
 * subtree), plus its joints and stage entries. If `instanceId` belongs to a
 * symmetry group, every sibling (and its own subtree) is removed too — the
 * mirrored copies are kept in sync, so deleting one deletes the set (matches
 * `setSymmetryMode`'s "live" rebuild treating the group as one unit).
 */
export function removePart(state: BuildState, instanceId: number): BuildState {
  const part = findPart(state, instanceId);
  const doomed = new Set(subtreeInstanceIds(state, instanceId));
  const group = part?.symmetryGroupId
    ? state.symmetryGroups.find((g) => g.id === part.symmetryGroupId)
    : undefined;
  if (group) {
    for (const memberId of group.memberInstanceIds) {
      for (const id of subtreeInstanceIds(state, memberId)) doomed.add(id);
    }
  }
  let next = removeInstances(state, doomed);
  if (group) {
    next = { ...next, symmetryGroups: next.symmetryGroups.filter((g) => g.id !== group.id) };
  }
  return pruneEmptyStages(next);
}

/** Drops trailing empty stages, always leaving at least one. */
export function pruneEmptyStages(state: BuildState): BuildState {
  const stages = [...state.stages];
  while (stages.length > 1) {
    const last = stages[stages.length - 1];
    if (last && last.partIds.length === 0) stages.pop();
    else break;
  }
  return { ...state, stages };
}

/** Reorders stages by moving the stage at `fromIndex` to `toIndex` (array move — becomes the new firing order). */
export function reorderStages(state: BuildState, fromIndex: number, toIndex: number): BuildState {
  const stages = [...state.stages];
  const [moved] = stages.splice(fromIndex, 1);
  if (!moved) return state;
  stages.splice(toIndex, 0, moved);
  return { ...state, stages };
}

/** Moves a part from whichever stage currently holds it into `targetStageIndex`. */
export function movePartToStage(state: BuildState, instanceId: number, targetStageIndex: number): BuildState {
  if (targetStageIndex < 0 || targetStageIndex >= state.stages.length) return state;
  const stages = state.stages.map((s) => ({ ...s, partIds: s.partIds.filter((id) => id !== instanceId) }));
  const target = stages[targetStageIndex];
  if (!target) return state;
  target.partIds.push(instanceId);
  return { ...state, stages };
}

/** Rebuilds every radial symmetry group's mirrored siblings for a new global symmetry count (PLAN.md §7: "live" symmetry — rebuilds *placed* parts, not just future ones). */
export function setSymmetryMode(state: BuildState, parts: PartLibrary, count: SymmetryCount): BuildState {
  let next: BuildState = { ...state, symmetryMode: count };
  for (const group of state.symmetryGroups) {
    next = rebuildSymmetryGroup(next, parts, group.id, count);
  }
  return next;
}

/** Regenerates one symmetry group's siblings (all but the leader) for `count` members, from the leader's current placement. */
export function rebuildSymmetryGroup(
  state: BuildState,
  parts: PartLibrary,
  groupId: string,
  count: SymmetryCount
): BuildState {
  const group = state.symmetryGroups.find((g) => g.id === groupId);
  if (!group) return state;
  const leaderId = group.memberInstanceIds[0];
  if (leaderId === undefined) return state;
  const leader = findPart(state, leaderId);
  const parent = findPart(state, group.parentInstanceId);
  if (!leader || !parent) return state;
  const leaderDef = parts.get(leader.partId);

  // Drop every existing sibling (not the leader) and its own subtree. Uses the
  // non-cascading internal remover — `removePart` would (correctly, for the
  // player-facing API) delete this entire group as soon as one sibling
  // vanishes, which is exactly what we're mid-rebuild of.
  let next = state;
  for (const memberId of group.memberInstanceIds.slice(1)) {
    next = removeInstances(next, subtreeInstanceIds(next, memberId));
  }

  const memberIds = [leaderId];
  for (let k = 1; k < count; k++) {
    const angle = (2 * Math.PI * k) / count;
    const currentLeader = findPart(next, leaderId);
    if (!currentLeader) break;
    const result = withRotatedSibling(next, currentLeader, leaderDef, parent, angle);
    next = result.state;
    memberIds.push(result.instanceId);
  }

  next = {
    ...next,
    symmetryGroups: next.symmetryGroups.map((g) => (g.id === groupId ? { ...g, count, memberInstanceIds: memberIds } : g)),
    parts: next.parts.map((p) => (memberIds.includes(p.instanceId) ? { ...p, symmetryGroupId: groupId } : p)),
  };
  return next;
}

/** Converts the hangar's working state into a real `Vessel` (PLAN.md §4) — what `computeMass`/`computeDeltaV`/checklists/flight-plan math actually consume. */
export function toVessel(state: BuildState, library: PartLibrary, soi: Body, id = 1): Vessel {
  const parts = state.parts.map((p) => ({
    id: p.instanceId,
    partId: p.partId,
    // `PartInstance` carries its own definition (PLAN.md §4, added by Agent B):
    // mass, fuel and joint strength are read straight off the instance.
    def: library.get(p.partId),
    position: p.position,
    rotation: p.rotation,
    resources: p.resources,
  }));
  const joints: JointLink[] = state.joints.map((j) => ({ id: j.id, a: j.a, b: j.b, nodeKind: j.nodeKind, strength: j.strength }));
  const stages: Stage[] = state.stages.map((s, index) => ({ index, partIds: [...s.partIds] }));
  return {
    id,
    parts,
    joints,
    stages,
    currentStage: 0,
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    rotation: 0,
    angularVelocity: 0,
    soi,
    railOrbit: null,
    mass: { total: 0, com: { x: 0, y: 0 }, inertia: 0 }, // caller recomputes via computeMass
  };
}
