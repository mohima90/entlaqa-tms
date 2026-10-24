import { describe, expect, it } from 'vitest';
import {
  branchFieldText,
  costCentreFieldText,
  levelFieldText,
  unitFieldText,
} from './structure-form';

describe('unitFieldText', () => {
  it('maps every field error of the unit actions to its field and text', () => {
    expect(unitFieldText('nameEn', 'TOO_SMALL')).toEqual({
      field: 'nameEn',
      key: 'fieldErrors.required',
    });
    expect(unitFieldText('nameAr', 'CUSTOM')).toEqual({ field: 'nameAr', key: 'fieldErrors.name' });
    expect(unitFieldText('code', 'CODE_TAKEN')).toEqual({
      field: 'code',
      key: 'fieldErrors.codeTaken',
    });
    expect(unitFieldText('code', 'INVALID_FORMAT')).toEqual({
      field: 'code',
      key: 'fieldErrors.code',
    });
    expect(unitFieldText('code', 'TOO_SMALL')).toEqual({
      field: 'code',
      key: 'fieldErrors.required',
    });
    expect(unitFieldText('headPersonId', 'HEAD_NOT_ACTIVE').key).toBe('fieldErrors.headNotActive');
    expect(unitFieldText('branchId', 'BRANCH_NOT_FOUND').key).toBe('fieldErrors.branchNotFound');
    expect(unitFieldText('parentId', 'BELOW_LAST_LEVEL')).toEqual({
      field: 'form',
      key: 'fieldErrors.belowLastLevel',
    });
    expect(unitFieldText('parentId', 'PARENT_NOT_FOUND').key).toBe('fieldErrors.parentNotFound');
    expect(unitFieldText('other', 'X').field).toBe('form');
  });
});

describe('levelFieldText', () => {
  it('maps level names and the level rules', () => {
    expect(levelFieldText('nameEn', 'NAME_TAKEN')).toEqual({
      field: 'nameEn',
      key: 'levels.nameTaken',
    });
    expect(levelFieldText('nameAr', 'TOO_SMALL').key).toBe('fieldErrors.required');
    expect(levelFieldText('nameAr', 'TOO_BIG').key).toBe('levels.name');
    expect(levelFieldText('level', 'TOO_MANY_LEVELS').key).toBe('levels.full');
    expect(levelFieldText('level', 'NOT_LAST_LEVEL').key).toBe('levels.lastOnly');
    expect(levelFieldText('level', 'ONLY_LEVEL').key).toBe('levels.onlyLevel');
    expect(levelFieldText('level', 'LEVEL_IN_USE').key).toBe('levels.inUse');
    expect(levelFieldText('x', 'Y')).toEqual({ field: 'form', key: 'levels.name' });
  });
});

describe('branchFieldText', () => {
  it('maps the branch form errors', () => {
    expect(branchFieldText('nameEn', 'TOO_SMALL').key).toBe('fieldErrors.required');
    expect(branchFieldText('nameAr', 'CUSTOM').key).toBe('fieldErrors.name');
    expect(branchFieldText('code', 'CODE_TAKEN').key).toBe('fieldErrors.codeTaken');
    expect(branchFieldText('code', 'INVALID_FORMAT').key).toBe('fieldErrors.code');
    expect(branchFieldText('cityAr', 'CUSTOM').key).toBe('fieldErrors.city');
    expect(branchFieldText('timezone', 'TIMEZONE_UNKNOWN').key).toBe('fieldErrors.timezone');
    expect(branchFieldText('parentBranchId', 'BRANCH_TREE').key).toBe('fieldErrors.parent');
    expect(branchFieldText('isHeadquarters', 'INVALID_TYPE').field).toBe('form');
  });
});

describe('structure completion texts (WP-HR-01)', () => {
  it('maps moves, locked levels, cost centres and branch details', () => {
    expect(unitFieldText('parentId', 'LEVEL_CHANGES')).toEqual({
      field: 'form',
      key: 'fieldErrors.levelChanges',
    });
    expect(unitFieldText('parentId', 'MOVE_INTO_ITSELF').key).toBe('fieldErrors.moveIntoItself');
    expect(unitFieldText('defaultCostCentreId', 'COST_CENTRE_INACTIVE')).toEqual({
      field: 'defaultCostCentreId',
      key: 'fieldErrors.costCentreInactive',
    });
    expect(levelFieldText('level', 'LEVELS_LOCKED').key).toBe('levels.locked');
    expect(branchFieldText('latitude', 'CUSTOM').key).toBe('fieldErrors.location');
    expect(branchFieldText('addressAr', 'TOO_BIG').key).toBe('fieldErrors.address');
    expect(branchFieldText('workingDays.0.endsAt', 'INVALID_FORMAT')).toEqual({
      field: 'workingDays',
      key: 'fieldErrors.hours',
    });
    expect(costCentreFieldText('code', 'CODE_TAKEN').key).toBe('costCentres.codeTaken');
    expect(costCentreFieldText('code', 'INVALID_FORMAT').key).toBe('fieldErrors.code');
    expect(costCentreFieldText('nameEn', 'CUSTOM').key).toBe('costCentres.name');
    expect(costCentreFieldText('costCentre', 'COST_CENTRE_IN_USE')).toEqual({
      field: 'form',
      key: 'costCentres.inUse',
    });
  });
});
