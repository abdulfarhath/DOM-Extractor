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
      { name: 'iban', pattern: /(?<![A-Za-z0-9])[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}[A-Z0-9]{0,3}(?![A-Za-z0-9])/g, replacement: '<IBAN>' },
      {
        name: 'card',
        pattern: /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g,
        /** @param {string} m */
        replacement: (m) => {
          const digits = m.replace(/[ -]/g, '');
          return digits.length >= 13 && digits.length <= 19 && luhn(digits) ? '<CARD>' : m;
        },
      },
      { name: 'phone', pattern: /(?<![\d.])\+?(?:\d[ \-().]?){9,14}\d(?![\d.])/g, replacement: '<PHONE>' },
    ],
    /* Structural rules (docs/11 F6). Patterns cannot see a name or an
       address; the key or label next to it can. These are code-vocabulary
       conventions (JSON keys, class names) plus a small English label list;
       another language adds its own pack with its own `labels`. */
    keys: [
      // First match wins, so the file rule runs before the name rule.
      // `notTokens` is tested against each camelCase/snake_case token of the
      // key, so `formName`, `serviceName`, `bankName` stay data while
      // `contactFirstName` and `nameOfAssessee` are redacted.
      { name: 'file-name', key: /file.?name|doc.?nam|attach.*name/i, replacement: '<FILE>' },
      {
        name: 'person-name',
        key: /name|nam$|nm$/i,
        notTokens: /^(?:forms?|service|file|doc|class|field|col|column|table|module|proceeding|procdng|action|menu|route|page|type|section|tab|label|method|param|event|app|host|domain|product|template|screen|role|state|city|country|district|bank|branch|ward|circle|act|scheme|category|status|key|tag|image|icon|attr|prop|short|desc|description|hindi|code|cd|flag|mode|mod|currency|month|day|year|browser|device|font|theme|lang|locale|region|zone|group|dept|designation|desig|title|order|sort|path|var|stage|step|task|report|return|notice|sub|host|server|queue|job|test|column)$/i,
        replacement: '<NAME>',
      },
      { name: 'address', key: /addr|address|street|locality|landmark|pin.?code|zip.?code|postal/i, notTokens: /^(?:flag|type|code|cd|status|ind|same|chk|check|valid|msg|label)$/i, replacement: '<ADDRESS>' },
      { name: 'birth', key: /dob|birth/i, replacement: '<DATE>' },
    ],
    labels: [
      // A label that is only "name", or ends in "name" / starts "name of".
      { name: 'person-name', label: /^(?:(?:full|first|last|middle|user|customer|client|account|holder|legal|trade|company|firm|applicant|member|contact|owner|display|assessee|taxpayer|entity|partner|director|father|mother|spouse|nominee|beneficiary|payee|employee|employer|deductor|deductee|borrower|guarantor|person|party|business|organi[sz]ation)(?:'s)?\s+)?name(?:\s+of\s+[\p{L} ]{2,30})?$/iu, replacement: '<NAME>' },
      { name: 'address', label: /^(?:[\p{L} ]{0,20}\s)?address$/iu, replacement: '<ADDRESS>' },
      { name: 'birth', label: /^(?:date of birth|dob|birth date)$/iu, replacement: '<DATE>' },
    ],
    hints: [
      // class or id tokens on the element that renders the value itself
      { name: 'person-name', hint: /user.?name|full.?name|display.?name|profile.?name|account.?name|customer.?name|assess?ee.?name|taxpayer.?name|text.?name|welcome/i, replacement: '<NAME>' },
    ],
  };
})();
