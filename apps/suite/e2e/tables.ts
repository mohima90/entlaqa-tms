import { type Page, expect } from '@playwright/test';

/**
 * Data tables on narrow screens (T-M2-21): no word inside a table cell is split across lines (the
 * page-wide `overflow-wrap: anywhere` once broke column headers letter by letter at 390 px), column
 * headers stay on one line, and a table wider than its box scrolls inside it — the page itself never
 * scrolls sideways.
 */
export async function expectReadableTables(page: Page) {
  const report = await page.evaluate(() => {
    const broken: string[] = [];
    const wrappedHeaders: string[] = [];
    const tables = [...document.querySelectorAll('table')];
    for (const table of tables) {
      for (const cell of table.querySelectorAll('th, td')) {
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.textContent ?? '';
          // Words between spaces and hyphens (a line may legitimately break after a hyphen).
          for (const match of text.matchAll(/[^\s\-\u2010]+/g)) {
            const range = document.createRange();
            range.setStart(node, match.index);
            range.setEnd(node, match.index + match[0].length);
            // One line → all fragments share a top; a word split over lines has fragments on two.
            const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
            if (tops.size > 1) broken.push(match[0]);
          }
        }
      }
      for (const header of table.querySelectorAll<HTMLElement>('th[scope="col"]')) {
        const range = document.createRange();
        range.selectNodeContents(header);
        const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
        if (tops.size > 1) wrappedHeaders.push(header.innerText);
      }
    }
    return {
      tables: tables.length,
      broken,
      wrappedHeaders,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(report.tables).toBeGreaterThan(0);
  expect(report.broken).toEqual([]);
  expect(report.wrappedHeaders).toEqual([]);
  expect(report.pageOverflow).toBeLessThanOrEqual(0);
}
