/* Redaction pack: india — docs/05 rule 4. Auto-enabled when a consented host
   ends in `.in`; toggleable in the panel. GSTIN runs before PAN because a GSTIN
   embeds a PAN. Classic script: registers window.__FP.packs.india. */
(() => {
  window.__FP = window.__FP || {};
  window.__FP.packs = window.__FP.packs || {};

  window.__FP.packs.india = {
    name: 'india',
    rules: [
      { name: 'gstin', pattern: /\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d]Z[A-Z\d]\b/g, replacement: '<GSTIN>' },
      { name: 'pan', pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/g, replacement: '<PAN>' },
      { name: 'ifsc', pattern: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g, replacement: '<IFSC>' },
      { name: 'passport', pattern: /\b[A-Z]\d{7}\b/g, replacement: '<PASSPORT>' },
      { name: 'aadhaar', pattern: /\b\d{4}\s?\d{4}\s?\d{4}\b/g, replacement: '<AADHAAR>' },
      { name: 'phone-in', pattern: /\b(?:\+91[-\s]?)?[6-9]\d{9}\b/g, replacement: '<PHONE>' },
      { name: 'din', pattern: /\b\d{8}\b/g, replacement: '<DIN>' },
    ],
  };
})();
