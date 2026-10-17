/**
 * Organization → Structure and Branches (T-M3-02, EP-ORG) — client-safe mapping of the actions' field errors
 * (codes only, never values) to the form field that shows them and its text key (namespaces `structure` /
 * `branches`, under `fieldErrors.` unless the key starts with `levels.`).
 */
export interface FieldText {
  readonly field: string;
  readonly key: string;
}

/** An empty required text comes back as TOO_SMALL; anything else about a name is its rule. */
function nameText(field: string, code: string, rule: string): FieldText {
  return { field, key: code === 'TOO_SMALL' ? 'fieldErrors.required' : rule };
}

/** Unit form (create / edit). */
export function unitFieldText(path: string, code: string): FieldText {
  const field = path.split('.')[0] ?? path;
  switch (field) {
    case 'nameEn':
    case 'nameAr':
      return nameText(field, code, 'fieldErrors.name');
    case 'code':
      if (code === 'CODE_TAKEN') return { field, key: 'fieldErrors.codeTaken' };
      return nameText(field, code, 'fieldErrors.code');
    case 'headPersonId':
      return { field, key: 'fieldErrors.headNotActive' };
    case 'branchId':
      return { field, key: 'fieldErrors.branchNotFound' };
    case 'parentId':
      return {
        field: 'form',
        key:
          code === 'BELOW_LAST_LEVEL' ? 'fieldErrors.belowLastLevel' : 'fieldErrors.parentNotFound',
      };
    default:
      return { field: 'form', key: 'fieldErrors.required' };
  }
}

/** Level form (add / rename) and removal. */
export function levelFieldText(path: string, code: string): FieldText {
  const field = path.split('.')[0] ?? path;
  switch (field) {
    case 'nameEn':
    case 'nameAr':
      if (code === 'NAME_TAKEN') return { field, key: 'levels.nameTaken' };
      return nameText(field, code, 'levels.name');
    case 'level':
      switch (code) {
        case 'TOO_MANY_LEVELS':
          return { field: 'form', key: 'levels.full' };
        case 'NOT_LAST_LEVEL':
          return { field: 'form', key: 'levels.lastOnly' };
        case 'ONLY_LEVEL':
          return { field: 'form', key: 'levels.onlyLevel' };
        default:
          // LEVEL_IN_USE: the page shows the level's own count (formatted on the server).
          return { field: 'form', key: 'levels.inUse' };
      }
    default:
      return { field: 'form', key: 'levels.name' };
  }
}

/** Branch form (create / edit). */
export function branchFieldText(path: string, code: string): FieldText {
  const field = path.split('.')[0] ?? path;
  switch (field) {
    case 'nameEn':
    case 'nameAr':
      return nameText(field, code, 'fieldErrors.name');
    case 'code':
      if (code === 'CODE_TAKEN') return { field, key: 'fieldErrors.codeTaken' };
      return nameText(field, code, 'fieldErrors.code');
    case 'cityEn':
    case 'cityAr':
      return { field, key: 'fieldErrors.city' };
    case 'timezone':
      return { field, key: 'fieldErrors.timezone' };
    case 'parentBranchId':
      return { field, key: 'fieldErrors.parent' };
    default:
      return { field: 'form', key: 'fieldErrors.required' };
  }
}
