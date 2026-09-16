/* Redaction pack: generic — docs/05 rule 4. Always on.
   Classic script: registers window.__FP.packs.generic. Order matters: tokens
   and JWTs before emails (a JWT can contain '.'), cards before phones so a
   Luhn-valid 16-digit run is a card, not two phone numbers. */
(() => {
  window.__FP = window.__FP || {};
  window.__FP.packs = window.__FP.packs || {};

  /**
   * @param {string} digits
   * @returns {boolean}
   */
  const luhn = (digits) => {
    let sum = 0;
    let alt = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let d = digits.charCodeAt(i) - 48;
      if (alt) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
      alt = !alt;
    }
    return sum % 10 === 0;
  };

  window.__FP.packs.generic = {
    name: 'generic',
    rules: [
      { name: 'jwt', pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*)?/g, replacement: '<JWT>' },
      { name: 'bearer', pattern: /Bearer\s+[A-Za-z0-9._~+/=-]+/g, replacement: 'Bearer <TOKEN>' },
      { name: 'secret-key', pattern: /\bsk-[A-Za-z0-9]{16,}\b/g, replacement: '<TOKEN>' },
      { name: 'google-key', pattern: /\bAIza[0-9A-Za-z_-]{20,}\b/g, replacement: '<TOKEN>' },
      { name: 'email', pattern: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, replacement: '<EMAIL>' },
      { name: 'iban', pattern: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}[A-Z0-9]{0,3}\b/g, replacement: '<IBAN>' },
      {
        name: 'card',
        pattern: /\b(?:\d[ -]?){12,18}\d\b/g,
        /** @param {string} m */
        replacement: (m) => {
          const digits = m.replace(/[ -]/g, '');
          return digits.length >= 13 && digits.length <= 19 && luhn(digits) ? '<CARD>' : m;
        },
      },
      { name: 'phone', pattern: /(?<![\d.])\+?(?:\d[ \-().]?){9,14}\d(?![\d.])/g, replacement: '<PHONE>' },
    ],
  };
})();
