/** An empty value: a dash on screen, words for screen readers (aria-label is not allowed on a span). */
export function NotSet({ label }: { label: string }) {
  return (
    <>
      <span aria-hidden="true" className="text-text-muted">
        —
      </span>
      <span className="sr-only">{label}</span>
    </>
  );
}
