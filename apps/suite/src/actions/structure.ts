'use server';
/**
 * Organization → Structure (FR-ADM-05, T-M3-02; business flow EP-ORG, PO 17 Oct 2026): the HR Manager's
 * levels and units. Definitions and tests in @jadarat/platform-rbac (iam/structure.ts); the database repeats
 * every rule (platform.structure_levels, platform.departments).
 */
import {
  addStructureLevelActionDefinition,
  createStructureUnitActionDefinition,
  defineAction,
  deleteStructureUnitActionDefinition,
  moveStructureUnitActionDefinition,
  previewStructureUnitMoveActionDefinition,
  removeStructureLevelActionDefinition,
  reorderStructureUnitActionDefinition,
  renameStructureLevelActionDefinition,
  setStructureUnitStatusActionDefinition,
  updateStructureUnitActionDefinition,
} from '@jadarat/platform-rbac';

/** «Add level»: below the last one (at most ten). */
export const addStructureLevelAction = defineAction(addStructureLevelActionDefinition());

/** Rename a level (its place never changes). */
export const renameStructureLevelAction = defineAction(renameStructureLevelActionDefinition());

/** Remove the last level while no unit uses it. */
export const removeStructureLevelAction = defineAction(removeStructureLevelActionDefinition());

/** «Add <level>» at the top or under a unit. */
export const createStructureUnitAction = defineAction(createStructureUnitActionDefinition());

/** Edit a unit's names, code, branch and head. */
export const updateStructureUnitAction = defineAction(updateStructureUnitActionDefinition());

/** Deactivate or activate a unit. */
export const setStructureUnitStatusAction = defineAction(setStructureUnitStatusActionDefinition());

/** Delete a unit nothing points at any more. */
export const deleteStructureUnitAction = defineAction(deleteStructureUnitActionDefinition());

/** «Move to…» — the preview first: what moves and who sees more or less (WP-HR-01). */
export const previewStructureUnitMoveAction = defineAction(
  previewStructureUnitMoveActionDefinition(),
);

/** «Move»: under a unit of the same level as its parent (WP-HR-01). */
export const moveStructureUnitAction = defineAction(moveStructureUnitActionDefinition());

/** Drag-and-drop, «Move up», «Move down» (WP-HR-01). */
export const reorderStructureUnitAction = defineAction(reorderStructureUnitActionDefinition());
