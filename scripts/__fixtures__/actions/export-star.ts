'use server';

import { defineAction } from '@jadarat/platform-rbac';

export const approve = defineAction({ permission: p, input: I, handler: h });
export * from './unchecked-actions';
