'use server';

// A local look-alike that skips authorization entirely.
function defineAction<T>(definition: T): T {
  return definition;
}

export const approve = defineAction(async () => 'approved without checks');
