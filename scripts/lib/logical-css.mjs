/**
 * RTL guard (CLAUDE.md: "RTL via CSS logical properties"). Flags physical-direction Tailwind
 * utilities and CSS properties. Use ms-/me-/ps-/pe-/start-/end-/border-s/border-e/text-start/…
 */
const TAILWIND_PHYSICAL =
  /(?<![\w-])-?(?:ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br|scroll-ml|scroll-mr|scroll-pl|scroll-pr)-[\w[\]./%-]+|(?<![\w-])(?:text-left|text-right|float-left|float-right|clear-left|clear-right|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br)(?![\w-])/g;
const CSS_PHYSICAL =
  /(?:^|[;{\s])(margin-left|margin-right|padding-left|padding-right|border-left|border-right|left|right)\s*:|text-align\s*:\s*(?:left|right)|float\s*:\s*(?:left|right)/gm;

/** @returns {string[]} */
export function checkLogicalSource(fileName, source) {
  const errors = [];
  const lines = source.split('\n');
  const isCss = fileName.endsWith('.css');
  lines.forEach((line, i) => {
    const code = isCss ? line.replace(/\/\*.*?\*\//g, '') : line.replace(/\/\/.*$/, '');
    const re = isCss ? CSS_PHYSICAL : TAILWIND_PHYSICAL;
    for (const m of code.matchAll(re)) {
      errors.push(
        `${fileName}:${i + 1}: physical direction "${m[0].trim()}" — use logical properties (start/end)`,
      );
    }
  });
  return errors;
}
