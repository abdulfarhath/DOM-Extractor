/* Redaction pack: india — docs/05 rule 4. Auto-enabled when a consented host
   ends in `.in`; toggleable in the panel. GSTIN runs before PAN because a GSTIN
   embeds a PAN. Classic script: registers window.__FP.packs.india. */
(() => {
  window.__FP = window.__FP || {};
  window.__FP.packs = window.__FP.packs || {};

  window.__FP.packs.india = {
    name: 'india',
    // Boundaries are explicit lookarounds, not \b: `_` is a word character,
    // so \b misses an identifier embedded in a file name such as
    // `..._AST_ABCDE1234F_Notice.pdf`. Over-redacting a lookalike is the
    // cheaper mistake.
    rules: [
      { name: 'gstin', pattern: /(?<![A-Za-z0-9])\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d]Z[A-Z\d](?![A-Za-z0-9])/g, replacement: '<GSTIN>' },
      { name: 'pan', pattern: /(?<![A-Za-z0-9])[A-Z]{5}\d{4}[A-Z](?![A-Za-z0-9])/g, replacement: '<PAN>' },
      { name: 'ifsc', pattern: /(?<![A-Za-z0-9])[A-Z]{4}0[A-Z0-9]{6}(?![A-Za-z0-9])/g, replacement: '<IFSC>' },
      { name: 'passport', pattern: /(?<![A-Za-z0-9])[A-Z]\d{7}(?![A-Za-z0-9])/g, replacement: '<PASSPORT>' },
      { name: 'aadhaar', pattern: /(?<!\d)\d{4}\s?\d{4}\s?\d{4}(?!\d)/g, replacement: '<AADHAAR>' },
      { name: 'phone-in', pattern: /(?<![\d+])(?:\+91[-\s]?)?[6-9]\d{9}(?!\d)/g, replacement: '<PHONE>' },
      { name: 'din', pattern: /(?<!\d)\d{8}(?!\d)/g, replacement: '<DIN>' },
    ],
  };
})();
