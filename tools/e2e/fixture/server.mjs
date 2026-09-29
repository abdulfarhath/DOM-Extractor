/**
 * Fixture server for the Flowprint end-to-end harness.
 *
 * A tiny static + JSON server with no dependencies. It serves a single-page
 * app shaped like a generic e-filing portal ("Harbourline Filing Portal" — an
 * invented name) and the JSON the app's tables are filled from.
 *
 * Run standalone to click around by hand:
 *     node tools/e2e/fixture/server.mjs 8765
 *
 * Everything the harness needs to know about the fixture — the strings that
 * must be redacted, the file names that must never appear in an export, the
 * menu items it must leave unclicked — is exported from here as FIXTURE, so
 * the fixture and the checks cannot drift apart.
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.join(HERE, 'site');

/** Ground truth shared with run.mjs and checks.mjs. */
export const FIXTURE = Object.freeze({
  basePath: '/portal/',
  title: 'Harbourline Filing Portal',
  /** Shapes the redaction packs must catch. Distinctive on purpose, so a grep cannot hit by accident. */
  secrets: Object.freeze({
    emailDomain: 'mailbox.example',
    emailRe: '[A-Za-z0-9._+-]+@mailbox\\.example',
    phonePrefix: '98450',
    phoneRe: '98450\\d{5}',
    taxIdPrefix: 'QWERT',
    taxIdRe: 'QWERT\\d{4}[A-Z]',
    profileEmail: 'meera.kulkarni@mailbox.example',
    profilePhone: '9845077731',
    profileTaxId: 'QWERT7731K',
  }),
  downloads: Object.freeze({
    pdfHref: '/files/demand-notice.pdf',
    pdfFileName: 'Demand_Notice_QX48213_FY2024.pdf',
    blobFileName: 'ledger_export_AC90417_2026.csv',
  }),
  routes: Object.freeze({
    login: '/portal/#/login',
    dashboard: '/portal/#/dashboard',
    returns: '/portal/#/returns',
    forms: '/portal/#/forms',
    payments: '/portal/#/payments',
    demands: '/portal/#/demands',
    proceedings: '/portal/#/proceedings',
    proceedingDetail: '/portal/#/proceedings/detail/',
    profile: '/portal/#/profile',
    help: '/portal/#/help',
  }),
  headings: Object.freeze({
    login: 'Sign in',
    dashboard: 'Dashboard',
    returns: 'Returns',
    forms: 'New application',
    payments: 'Payments ledger',
    demands: 'Demands',
    proceedings: 'Proceedings',
    proceedingDetail: 'Proceeding detail',
    profile: 'Taxpayer profile',
    help: 'Filing guide',
  }),
  menus: Object.freeze({
    /** Every menu item the fixture has, by the labels from the menu root down. */
    all: [
      ['Dashboard'],
      ['Filing'],
      ['Filing', 'Returns'],
      ['Filing', 'Applications'],
      ['Filing', 'Applications', 'New application'],
      ['Filing', 'Applications', 'Draft applications'],
      ['Filing', 'Annual statement'],
      ['Accounts'],
      ['Accounts', 'Payments'],
      ['Accounts', 'Demands'],
      ['Accounts', 'Refund status'],
      ['Compliance'],
      ['Compliance', 'Proceedings'],
      ['Compliance', 'Notices'],
      ['Compliance', 'Reports'],
      ['Compliance', 'Reports', 'Audit trail'],
    ],
    /** The harness never clicks these. */
    neverClicked: ['Draft applications', 'Annual statement', 'Refund status', 'Notices', 'Audit trail'],
  }),
  views: Object.freeze({
    tabs: ['Pending', 'Responded', 'Closed'],
    tabNeverClicked: 'Closed',
    chips: ['All periods', 'Last 30 days', 'Last 12 months'],
    chipNeverClicked: 'Last 12 months',
  }),
  ledger: Object.freeze({
    path: '/api/ledger',
    rowKeys: ['entryId', 'postedOn', 'amount', 'currency', 'status', 'narration', 'counterparty', 'reference', 'headCode', 'contactEmail', 'contactPhone', 'taxId'],
    statusValues: ['posted', 'pending', 'reversed', 'failed'],
    listPath: 'data.items',
    pagingParams: ['page', 'size'],
    minBytes: 300 * 1024,
  }),
  returns: Object.freeze({ path: '/api/returns', total: 27, size: 10, pages: 3 }),
  dangerLabel: 'Submit',
});

// ------------------------------------------------------------------ data

const pad = (n, w) => String(n).padStart(w, '0');
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Small deterministic generator so every run serves the same bytes. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const GIVEN = ['Meera', 'Arjun', 'Latha', 'Imran', 'Deepa', 'Rohan', 'Sunita', 'Farid', 'Anil', 'Kavya', 'Joseph', 'Nandini'];
const FAMILY = ['Kulkarni', 'Menon', 'Shaikh', 'Pillai', 'Dsouza', 'Bhat', 'Reddy', 'Mathew', 'Iyer', 'Gowda'];
const FIRMS = ['Traders', 'Logistics', 'Textiles', 'Foods', 'Engineering', 'Exports', 'Builders', 'Pharma', 'Retail', 'Agro'];
const WORDS = ['advance', 'instalment', 'adjusted', 'against', 'quarterly', 'liability', 'interest', 'late', 'fee', 'refund', 'set-off', 'carried', 'forward', 'assessment', 'order', 'rectified', 'demand', 'partial', 'settlement', 'challan'];

const emailFor = (i, tag) => `${tag}${pad(i, 4)}@${FIXTURE.secrets.emailDomain}`;
const phoneFor = (i) => `${FIXTURE.secrets.phonePrefix}${pad(i % 100000, 5)}`;
const taxIdFor = (i) => `${FIXTURE.secrets.taxIdPrefix}${pad(i % 10000, 4)}${LETTERS[i % LETTERS.length]}`;

const RETURN_STATUS = ['Filed', 'Processed', 'Defective'];
const RETURNS = Array.from({ length: FIXTURE.returns.total }, (_, k) => {
  const i = k + 1;
  return {
    returnId: `RT-${pad(i, 4)}`,
    period: `FY 2025-26 Q${(k % 4) + 1}`,
    formType: `Form R-${(k % 3) + 1}`,
    filedOn: `2026-${pad((k % 9) + 1, 2)}-${pad((k % 27) + 1, 2)}`,
    status: RETURN_STATUS[k % RETURN_STATUS.length],
    amount: 1250.5 + k * 310,
    contactEmail: emailFor(i, 'filer'),
    contactPhone: phoneFor(1000 + i),
    taxId: taxIdFor(100 + i),
  };
});

function buildLedger() {
  const rand = rng(20260929);
  /** @type {object[]} */
  const rows = [];
  let bytes = 0;
  for (let k = 0; bytes < FIXTURE.ledger.minBytes + 4096; k++) {
    const i = k + 1;
    const words = Array.from({ length: 6 + Math.floor(rand() * 6) }, () => WORDS[Math.floor(rand() * WORDS.length)]);
    const row = {
      entryId: `LE-${pad(i, 6)}`,
      postedOn: `2026-${pad((k % 12) + 1, 2)}-${pad((k % 28) + 1, 2)}`,
      amount: Math.round((500 + rand() * 250000) * 100) / 100,
      currency: 'INR',
      status: FIXTURE.ledger.statusValues[k % 4],
      narration: `${words.join(' ')} for period ${(k % 4) + 1} ref ${i}`,
      counterparty: `${FAMILY[k % FAMILY.length]} ${FIRMS[(k * 7) % FIRMS.length]} ${i}`,
      reference: `CH/${pad(i, 5)}/${LETTERS[k % LETTERS.length]}`,
      headCode: `H-${pad((k % 6) + 1, 3)}`,
      contactEmail: emailFor(i, 'ledger'),
      contactPhone: phoneFor(20000 + i),
      taxId: taxIdFor(2000 + i),
    };
    rows.push(row);
    bytes += JSON.stringify(row).length + 1;
  }
  return rows;
}
const LEDGER = buildLedger();

const PROC_STATUS = ['pending', 'responded', 'closed'];
const PROCEEDINGS = Array.from({ length: 15 }, (_, k) => {
  const id = 1001 + k;
  return {
    id,
    caseRef: `PR-${id}`,
    section: `Section ${40 + (k % 5)}`,
    status: PROC_STATUS[k % 3],
    /** days since the notice was issued; drives the period filter */
    ageDays: [5, 12, 20, 45, 90, 200, 28, 400, 10, 60, 25, 300, 8, 150, 29][k],
    issuedOn: `2026-${pad((k % 9) + 1, 2)}-${pad((k % 27) + 1, 2)}`,
    officer: `${GIVEN[k % GIVEN.length]} ${FAMILY[(k * 3) % FAMILY.length]}`,
    contactEmail: emailFor(id, 'officer'),
    contactPhone: phoneFor(30000 + k),
    taxId: taxIdFor(3000 + k),
  };
});

const SUBCATEGORIES = {
  income: [
    { code: 'INC-SAL', label: 'Salary income' },
    { code: 'INC-BUS', label: 'Business income' },
    { code: 'INC-CAP', label: 'Capital gains' },
  ],
  deductions: [
    { code: 'DED-INV', label: 'Investments' },
    { code: 'DED-INS', label: 'Insurance premium' },
  ],
  refunds: [
    { code: 'REF-EXC', label: 'Excess payment' },
    { code: 'REF-APP', label: 'Appeal effect' },
    { code: 'REF-OTH', label: 'Other refund' },
  ],
};

const DEMANDS = [
  { demandId: 'DM-0301', raisedOn: '2026-02-11', amount: 18450, status: 'Outstanding' },
  { demandId: 'DM-0302', raisedOn: '2026-04-02', amount: 920, status: 'Paid' },
  { demandId: 'DM-0303', raisedOn: '2026-06-19', amount: 40710.75, status: 'Disputed' },
];

/** A minimal one-page PDF. The contents do not matter; the headers do. */
function pdfBytes() {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = 'BT /F1 14 Tf 30 120 Td (Fixture demand notice) Tj ET';
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${pad(off, 10)} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// ---------------------------------------------------------------- server

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

/**
 * @param {{ port?: number, host?: string, quiet?: boolean }} [opts]
 * @returns {Promise<{ origin: string, port: number, log: {method: string, url: string, at: number}[], trapHits: object[], close: () => Promise<void> }>}
 */
export async function startFixtureServer(opts = {}) {
  const host = opts.host || '127.0.0.1';
  /** @type {{method: string, url: string, at: number}[]} */
  const log = [];
  /** Hits on the form's action URL. The harness never submits, so any hit means something submitted the form. */
  /** @type {object[]} */
  const trapHits = [];

  const json = (res, status, body) => {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) });
    res.end(text);
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://fixture.invalid');
    const p = url.pathname;
    log.push({ method: req.method || 'GET', url: req.url || '', at: Date.now() });
    try {
      if (p === '/' || p === '/portal') {
        res.writeHead(302, { location: FIXTURE.basePath });
        return res.end();
      }
      if (p === '/favicon.ico') {
        res.writeHead(204);
        return res.end();
      }
      if (p === '/portal/' || p === '/portal/index.html') {
        const body = await readFile(path.join(SITE, 'index.html'));
        res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
        return res.end(body);
      }
      if (p === '/portal/app.js' || p === '/portal/app.css') {
        const body = await readFile(path.join(SITE, path.basename(p)));
        res.writeHead(200, { 'content-type': MIME[path.extname(p)], 'cache-control': 'no-store' });
        return res.end(body);
      }
      if (p === '/portal/logout') {
        const body = '<!doctype html><meta charset="utf-8"><title>Signed out</title><script>try{localStorage.removeItem("fixture.session")}catch(e){}location.replace("/portal/#/login")</script>';
        res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
        return res.end(body);
      }

      if (p === '/api/summary') {
        return json(res, 200, { data: { returnsFiled: RETURNS.length, openProceedings: PROCEEDINGS.filter((x) => x.status === 'pending').length, outstandingDemands: 1, ledgerEntries: LEDGER.length } });
      }
      if (p === '/api/profile') {
        return json(res, 200, {
          data: {
            displayName: 'Meera Kulkarni',
            contactEmail: FIXTURE.secrets.profileEmail,
            contactPhone: FIXTURE.secrets.profilePhone,
            taxId: FIXTURE.secrets.profileTaxId,
            registeredOn: '2019-07-04',
            category: 'Individual',
          },
        });
      }
      if (p === '/api/returns') {
        const size = Math.max(1, Math.min(100, Number(url.searchParams.get('size')) || FIXTURE.returns.size));
        const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
        const items = RETURNS.slice((page - 1) * size, page * size);
        return json(res, 200, { data: { items, total: RETURNS.length, page, size } });
      }
      if (p === '/api/ledger') {
        const size = Math.max(1, Math.min(5000, Number(url.searchParams.get('size')) || LEDGER.length));
        const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
        const items = LEDGER.slice((page - 1) * size, page * size);
        return json(res, 200, { data: { items, total: LEDGER.length, page, size } });
      }
      if (p === '/api/demands') {
        return json(res, 200, { data: { items: DEMANDS, total: DEMANDS.length } });
      }
      if (p === '/api/proceedings') {
        const status = url.searchParams.get('status') || 'pending';
        const period = url.searchParams.get('period') || 'all';
        const maxAge = period === '30d' ? 30 : period === '12m' ? 365 : Infinity;
        const items = PROCEEDINGS.filter((x) => x.status === status && x.ageDays <= maxAge);
        return json(res, 200, { data: { items, total: items.length } });
      }
      const detail = /^\/api\/proceedings\/(\d+)$/.exec(p);
      if (detail) {
        const item = PROCEEDINGS.find((x) => x.id === Number(detail[1]));
        if (!item) return json(res, 404, { error: 'not found' });
        return json(res, 200, { data: { ...item, history: [{ step: 'Notice issued', on: item.issuedOn }, { step: 'Reply due', on: '2026-12-31' }] } });
      }
      if (p === '/api/subcategories') {
        const items = SUBCATEGORIES[url.searchParams.get('category') || ''] || [];
        return json(res, 200, { data: { items } });
      }
      if (p === '/api/submit-trap') {
        trapHits.push({ method: req.method, at: Date.now(), headers: { referer: req.headers.referer || null } });
        return json(res, 200, { ok: true, note: 'fixture: the form was submitted' });
      }
      if (p === FIXTURE.downloads.pdfHref) {
        const body = pdfBytes();
        res.writeHead(200, {
          'content-type': 'application/pdf',
          'content-length': body.length,
          'content-disposition': `attachment; filename="${FIXTURE.downloads.pdfFileName}"`,
          'cache-control': 'no-store',
        });
        return res.end(body);
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(String(e));
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port || 0, host, () => resolve(undefined));
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const origin = `http://localhost:${port}`;
  if (!opts.quiet) console.log(`[fixture] serving ${origin}${FIXTURE.basePath}`);
  return {
    origin,
    port,
    log,
    trapHits,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve(undefined));
      }),
  };
}

/** Size of the large endpoint's full response, for the harness's own sanity check. */
export function ledgerResponseBytes() {
  return Buffer.byteLength(JSON.stringify({ data: { items: LEDGER, total: LEDGER.length, page: 1, size: LEDGER.length } }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2]) || 8765;
  const s = await startFixtureServer({ port });
  console.log(`[fixture] open ${s.origin}${FIXTURE.basePath}  (any user id, any password)`);
  console.log(`[fixture] large endpoint is ${ledgerResponseBytes()} bytes`);
}
