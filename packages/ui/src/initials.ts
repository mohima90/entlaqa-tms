/**
 * The first letter of the name (Arabic or Latin), or of each of its first two words in Latin script.
 * In its own module, not in the client-only avatar.tsx: server components (the suite and platform shells)
 * call it, and a function exported from a 'use client' module cannot be called on the server.
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = Array.from(words[0] ?? '')[0] ?? '?';
  // Arabic names: one letter reads better than two joined letters.
  if (/[؀-ۿ]/.test(first)) return first;
  const second = words.length > 1 ? (Array.from(words[1] ?? '')[0] ?? '') : '';
  return (first + second).toUpperCase();
}
