// THE 16-YEAR LEDGER, END TO END (regression): the page in real Chrome with made-up holdings as ATS sends them — what
// broke once must stay fixed. Run: node tests/ledger.e2e.mjs   (needs Google Chrome; nothing is saved anywhere)
import fs from 'fs'; import os from 'os'; import path from 'path'; import http from 'http'; import {spawn} from 'child_process';
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml'};
const srv = http.createServer((q, r)=>{ const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); if(!f.startsWith(ROOT) || !fs.existsSync(f)){ r.writeHead(404); return r.end(); } r.writeHead(200, {'content-type': TYPES[path.extname(f)] || 'application/octet-stream'}); fs.createReadStream(f).pipe(r); });
await new Promise(r=>srv.listen(0, '127.0.0.1', r));
const url = 'http://127.0.0.1:' + srv.address().port + '/index.html';
// what ATS sends (/api/ledger/holdings): INDmoney's mutual funds, Groww's ETFs (units and buy price from Groww), US stocks,
// the Bitcoin entered in the plan (kind crypto) and INDmoney's net-worth classes — its Crypto is ₹0 (it cannot see it)
const ATS = {ok: true, items: [
  {kind: 'mf', name: 'Parag Parikh Flexi Cap Direct Growth', mf_code: 122639, units: 1317.38, value: 117000, invested: 119994, broker: '', cost_src: 'INDmoney', ind_code: '3229'},
  {kind: 'mf', name: 'Motilal Oswal Arbitrage Fund Direct Growth', mf_code: 147796, units: 6203.17, value: 70100, invested: 69996.5, broker: '', cost_src: 'INDmoney', ind_code: '9001'},
  {kind: 'etf', name: 'Nippon India ETF Gold BeES', symbol: 'GOLDBEES.NS', region: 'IN', units: 857, value: 104000, invested: 86025.66, broker: 'Groww', cost_src: 'Groww'},
  {kind: 'etf', name: 'Nippon India ETF Nifty 50 BeES', symbol: 'NIFTYBEES.NS', region: 'IN', units: 267, value: 68000, invested: 73601.22, broker: 'Groww', cost_src: 'Groww'},
  {kind: 'us_etf', name: 'Vanguard S&P 500 ETF', symbol: 'VOO', region: 'US', units: 0.62, value: 43000, invested: 41105.55, broker: 'INDmoney', cost_src: 'INDmoney'},
  {kind: 'crypto', name: 'Bitcoin', symbol: 'BTC-USD', region: 'CRYPTO', value_inr: 26000, invested: 23000, units: null}],
  snapshot: [{asset_type: 'EPF', current_value: 1690966, invested_value: 1690966}, {asset_type: 'ESOPS_RSUS', current_value: 1517745, invested_value: 0},
    {asset_type: 'GOLD', current_value: 1387900, invested_value: 430000}, {asset_type: 'MF', current_value: 187100, invested_value: 189990.5},
    {asset_type: 'STOCK', current_value: 172000, invested_value: 159626.88}, {asset_type: 'US_STOCK', current_value: 43000, invested_value: 41105.55}, {asset_type: 'CRYPTO', current_value: 0, invested_value: 0}]};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-e2e-'));
const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', '--user-data-dir=' + dir, 'about:blank'], {env: Object.assign({}, process.env, {HOME: os.userInfo().homedir})});
let port; for(let i = 0; i < 150 && !port; i++){ await new Promise(r=>setTimeout(r, 150)); try{ port = +fs.readFileSync(dir + '/DevToolsActivePort', 'utf8').split('\n')[0]; }catch(e){} }
const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {method: 'PUT'})).json();
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r=>ws.onopen = r);
let id = 0; const w = new Map(), errs = [];
ws.onmessage = m => { const d = JSON.parse(m.data); if(d.id && w.has(d.id)){ w.get(d.id)(d); w.delete(d.id); } if(d.method === 'Runtime.exceptionThrown') errs.push(String((d.params.exceptionDetails.exception || {}).description || d.params.exceptionDetails.text).slice(0, 200)); };
const send = (m, p) => new Promise(r=>{ const n = ++id; w.set(n, r); ws.send(JSON.stringify({id: n, method: m, params: p || {}})); });
const ev = async e => { const r = await send('Runtime.evaluate', {expression: e, awaitPromise: true, returnByValue: true}); return r.result.exceptionDetails ? 'EXC ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300) : r.result.result.value; };
const sl = ms => new Promise(r=>setTimeout(r, ms));
let pass = 0, fail = 0; const check = (name, ok, info) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (info !== undefined && !ok ? '  — ' + JSON.stringify(info).slice(0, 300) : '')); };
await send('Runtime.enable'); await send('Page.navigate', {url}); await sl(3500);
const setup = await ev(`(()=>{ const d = ${JSON.stringify(ATS)};
  STATE.manualAssets = [{id: 'man-btc', name: 'Bitcoin', current: 26000, invested: 23000}];
  const got = holdingsFromAts(d); STATE.importedSnapshot = {rows: got.snapshot, total: got.total, at: new Date().toISOString()};
  applyImport(got.rows); rerenderAll(); if(typeof renderLive === 'function') renderLive();
  return {rows: got.rows.map(r=>[r.investment, r.__section, r.total_units, r.invested_amount, r.cost_src])}; })()`);
check('the import reads mutual funds, Groww ETFs and US stocks (5 rows; Bitcoin is not a holding)', setup.rows && setup.rows.length === 5, setup);
check('Groww units and buy prices come through as Groww gives them', JSON.stringify(setup.rows).includes('"Nippon India ETF Gold BeES","STOCK",857,86025.66,"Groww"'), setup.rows);
check('mutual funds keep their purchase value (nothing to type in)', setup.rows.filter(r=>r[1] === 'MF').every(r=>r[3] > 0), setup.rows);
const rows = await ev(`missingCostRows().map(r=>[r.kind, r.name, r.current, r.value])`);
check('Bitcoin (tracked by hand) is in Purchase values', rows.some(r=>r[0] === 'manual' && r[1] === 'Bitcoin' && r[3] === 23000), rows);
check('INDmoney\'s empty ₹0 Crypto class is not listed', !rows.some(r=>r[0] === 'asset' && /crypto/i.test(r[1])), rows.filter(r=>r[0] === 'asset'));
const inv = await ev(`corpusInvested()`);
check('only RSUs are missing a cost (INDmoney reports ₹0 invested for them)', JSON.stringify(inv.unknown) === '["ESOPS_RSUS"]', inv);
const edit = await ev(`(()=>{ const i = document.querySelector('.cost-input[data-kind=manual]'); if(!i) return 'no input'; i.value = '24500'; i.dispatchEvent(new Event('input', {bubbles: true})); return STATE.manualAssets[0].invested; })()`);
check('editing Bitcoin\'s purchase value takes', edit === 24500, edit);
await sl(1300);
const both = await ev(`[document.querySelector('.cost-input[data-kind=manual]').value, (document.querySelector('tr[data-manid=man-btc] input[data-mf=invested]') || {}).value]`);
check('… and both tables show it', both[0] === '24500' && both[1] === '24500', both);
// the plan's target mix for ATS ("Your target"): monthly SIPs by ATS's asset classes
const tg = await ev(`(()=>{ const keep = [STATE.indiaFunds, STATE.usFunds];
  STATE.indiaFunds = [{id: 'a', name: 'Nifty 50 index', monthly: 60000, cls: 'Index Fund', geo: 'India'}, {id: 'b', name: 'Liquid fund', monthly: 10000, cls: 'Debt MF', geo: 'India', debt: true},
    {id: 'c', name: 'Gold ETF', monthly: 10000, cls: 'ETF', geo: 'India'}, {id: 'd', name: 'Paused fund', monthly: 0, cls: 'Index Fund', geo: 'India'}];
  STATE.usFunds = [{id: 'e', name: 'S&P 500 ETF', monthly: 20000, cls: 'ETF'}];
  const t = planTargets(); STATE.indiaFunds = keep[0]; STATE.usFunds = keep[1]; return t; })()`);
check('the plan\'s target mix for ATS, by its asset classes', JSON.stringify(tg) === JSON.stringify({'Equity India': 60, 'Debt / cash': 10, 'Gold / silver': 10, 'Equity US': 20}), tg);
check('no script errors', !errs.length, errs);
console.log(`\nLedger: ${pass} passed, ${fail} failed`);
ws.close(); proc.kill('SIGKILL'); srv.close(); fs.rmSync(dir, {recursive: true, force: true});
process.exit(fail ? 1 : 0);
