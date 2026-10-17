import type { NeedsFormField, NeedsFormSection } from './model';

/**
 * Show-if conditions (Kawadir conditional-fields.ts, with two fixes): answers are keyed by FIELD ID, and a
 * field whose trigger is itself hidden (switched off, or not shown by its own condition) is hidden too —
 * its answer could never be given. One source of truth for the renderer (what to show), the server-side
 * validator (what to check and keep) and the builder's preview.
 *
 * `entry` is one entry of a section: `{ [fieldId]: answer }`.
 */
export type Entry = Readonly<Record<string, unknown>>;

const MAX_DEPTH = 60;

export function isFieldShown(
  field: Pick<NeedsFormField, 'id' | 'visible' | 'condition'>,
  sectionFields: readonly Pick<NeedsFormField, 'id' | 'visible' | 'condition'>[],
  entry: Entry | undefined,
): boolean {
  let current = field;
  for (let depth = 0; depth <= MAX_DEPTH; depth += 1) {
    if (!current.visible) return false;
    const condition = current.condition;
    if (!condition) return true;
    const trigger = sectionFields.find((f) => f.id === condition.fieldId);
    // A dangling condition (its field was deleted) shows the field, as the database clears it.
    if (!trigger) return true;
    if (entry?.[trigger.id] !== condition.value) return false;
    current = trigger;
  }
  return false; // a loop (the database refuses one): never shown
}

/** The fields of a section shown for this entry, in order. */
export function shownFields(section: NeedsFormSection, entry: Entry | undefined): NeedsFormField[] {
  return section.fields.filter((f) => isFieldShown(f, section.fields, entry));
}

/** A copy of the entry without the answers of fields that are not shown (stale answers never reach storage). */
export function keepShownAnswers(section: NeedsFormSection, entry: Entry): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const field of section.fields) {
    if (Object.hasOwn(entry, field.id) && isFieldShown(field, section.fields, entry)) {
      kept[field.id] = entry[field.id];
    }
  }
  return kept;
}

/** Fields of the section that depend (directly) on `fieldId` — for the builder's warnings. */
export function dependantsOf(section: NeedsFormSection, fieldId: string): NeedsFormField[] {
  return section.fields.filter((f) => f.condition?.fieldId === fieldId);
}

/**
 * Would pointing `fieldId` at `triggerId` make a loop? (The trigger, or a field it depends on, depends on
 * `fieldId`.)
 */
export function conditionMakesLoop(
  section: Pick<NeedsFormSection, 'fields'>,
  fieldId: string,
  triggerId: string,
): boolean {
  let cursor: string | undefined = triggerId;
  for (let depth = 0; cursor !== undefined && depth <= MAX_DEPTH; depth += 1) {
    if (cursor === fieldId) return true;
    const id: string = cursor;
    cursor = section.fields.find((f) => f.id === id)?.condition?.fieldId;
  }
  return cursor !== undefined;
}
