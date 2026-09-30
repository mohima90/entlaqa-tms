'use server';

import { createDefineAction as defineAction } from '@jadarat/platform-rbac';

export const approve = defineAction({ permission: p, input: I, handler: h });
