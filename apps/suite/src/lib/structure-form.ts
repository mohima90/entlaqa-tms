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
    case 'defaultCostCentreId':
      return { field, key: 'fieldErrors.costCentreInactive' };
    case 'parentId':
      switch (code) {
        case 'BELOW_LAST_LEVEL':
          return { field: 'form', key: 'fieldErrors.belowLastLevel' };
        // «Move to…» (WP-HR-01): a unit keeps its level; never under itself or a unit below it.
        case 'LEVEL_CHANGES':
          return { field: 'form', key: 'fieldErrors.levelChanges' };
        case 'MOVE_INTO_ITSELF':
          return { field: 'form', key: 'fieldErrors.moveIntoItself' };
        default:
          return { field: 'form', key: 'fieldErrors.parentNotFound' };
      }
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
        // People are placed in units (WP-HR-01): levels are only renamed.
        case 'LEVELS_LOCKED':
          return { field: 'form', key: 'levels.locked' };
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
    // WP-HR-01: address, typed location (both or neither, in range), own working week.
    case 'addressEn':
    case 'addressAr':
      return { field, key: 'fieldErrors.address' };
    case 'latitude':
    case 'longitude':
      return { field, key: 'fieldErrors.location' };
    case 'workingDays':
      return { field, key: 'fieldErrors.hours' };
    default:
      return { field: 'form', key: 'fieldErrors.required' };
  }
}

/** Cost centre form (WP-HR-01) and its delete. */
export function costCentreFieldText(path: string, code: string): FieldText {
  const field = path.split('.')[0] ?? path;
  switch (field) {
    case 'code':
      if (code === 'CODE_TAKEN') return { field, key: 'costCentres.codeTaken' };
      return nameText(field, code, 'fieldErrors.code');
    case 'nameEn':
    case 'nameAr':
      // One sentence for both rules: a name in either language, with visible letters.
      return { field, key: 'costCentres.name' };
    case 'costCentre':
      return { field: 'form', key: 'costCentres.inUse' };
    default:
      return { field: 'form', key: 'fieldErrors.required' };
  }
}
