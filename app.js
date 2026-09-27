"use strict";

/* =========================================================
   THE PLAN'S STARTING POINT — personal, so it is never in this code.
   It travels with your saved plan (STATE.plan): date of birth, the
   workbook the plan came from, its funds, rules, phases, calendar,
   retirement layers. A browser with no plan yet gets the small example
   below until you restore yours (Overview → Your data → Restore).
   ========================================================= */
const STARTER_PLAN = {
  v:1, starter:true, dob:'1995-01-01', source:'',
  baseline:{
    date: new Date().toISOString().slice(0,10), portfolioValue:0, salary:100000, buffer:0, ppfMonthly:0, ppfRate:0.071,
    equityRate:0.12, stepUp:0.10, retireAge:55, targetLowCr:3, targetHighCr:4,
    indiaFunds:[
      {id:'in-core', name:'Nifty 50 index fund (example)', monthly:10000, cls:'Index Fund', geo:'India', role:'An example row - replace it with your own funds.'},
    ],
    usFunds:[],
  },
  removed:[],
  goldenRules:[
    {title:'April step-up, every year', body:'Raise every SIP each April, before the salary hike gets spent.'},
    {title:'Never stop SIPs in a crash', body:'A crash means SIPs buy more units at a discount.'},
  ],
  phases:[], phaseHeads:['Phase 1','Phase 2','Phase 3','Phase 4','Phase 5'],
  calendar:[], crashEvents:[], reasons:[], layers:[], swp:[], milestones:{},
  phaseFundIds:{}, matchAliases:{},
};

let DOB, BASELINE, REMOVED, GOLDEN_RULES, PHASES, PHASE_HEADS, CALENDAR, CRASH_EVENTS, REASONS, LAYERS,
    SWP_SCENARIOS, MILESTONES, PHASE_FUND_IDS, MATCH_ALIASES, PLAN_SOURCE;
/* Points the page at a plan's starting point: yours, or the example. */
function usePlan(p){
  if(!p || !p.baseline) p = STARTER_PLAN;
  const d = String(p.dob || '').split('-').map(Number);
  DOB = new Date(d[0] || 1995, (d[1] || 1) - 1, d[2] || 1);
  BASELINE = p.baseline;
  REMOVED = p.removed || []; GOLDEN_RULES = p.goldenRules || []; PHASES = p.phases || [];
  PHASE_HEADS = (p.phaseHeads && p.phaseHeads.length === 5) ? p.phaseHeads : STARTER_PLAN.phaseHeads;
  CALENDAR = p.calendar || []; CRASH_EVENTS = p.crashEvents || []; REASONS = p.reasons || []; LAYERS = p.layers || [];
  SWP_SCENARIOS = p.swp || []; MILESTONES = p.milestones || {}; PHASE_FUND_IDS = p.phaseFundIds || {};
  MATCH_ALIASES = p.matchAliases || {}; PLAN_SOURCE = p.source || '';
}
usePlan(null);

/* =========================================================
   STATE — the editable, persisted picture of the plan.
   Kept in this browser: the last SAVED plan, plus any unsaved edits
   (a draft), so a reload never loses work. Sync (Profile → Sync) carries
   the saved plan, encrypted, to your other devices.
   ========================================================= */
function cryptoId(prefix){ return prefix + '-' + Math.random().toString(36).slice(2,9); }
function deepClone(o){ return JSON.parse(JSON.stringify(o)); }

function freshStateFromBaseline(){
  return {
    v: 2,
    plan: deepClone(STARTER_PLAN),
    salary: BASELINE.salary,
    buffer: BASELINE.buffer,
    ppfMonthly: BASELINE.ppfMonthly,
    ppfRate: BASELINE.ppfRate,
    equityRate: BASELINE.equityRate,
    stepUp: BASELINE.stepUp,
    retireAge: BASELINE.retireAge,
    targetLowCr: BASELINE.targetLowCr,
    targetHighCr: BASELINE.targetHighCr,
    fdRate: 0.07, inflation: 0.06, ltcgRate: 0.125,
    indiaFunds: deepClone(BASELINE.indiaFunds),
    usFunds: deepClone(BASELINE.usFunds),
    snapshots: [
      { id:'snap-origin', date: BASELINE.date, value: BASELINE.portfolioValue, note:'Starting point', origin:true },
    ],
  };
}

const STATE_KEY = 'ledger-state-v2';
const DRAFT_KEY = 'ledger-draft-v2';
const DONE_KEY = 'ledger-calendar-done-v1';

function readPlanKey(key){
  try{
    const cached = localStorage.getItem(key);
    if(cached){
      const parsed = JSON.parse(cached);
      if(parsed && parsed.indiaFunds && parsed.indiaFunds.length) return parsed;
    }
  }catch(e){}
  return null;
}
/* The last saved plan (or the example), with its starting point switched in. */
function loadSavedState(){
  const s = readPlanKey(STATE_KEY);
  usePlan(s && s.plan);
  return s || freshStateFromBaseline();
}
let LOADED_DRAFT = false;
function loadState(){
  const d = readPlanKey(DRAFT_KEY);
  if(d){ LOADED_DRAFT = true; usePlan(d.plan); return d; }
  return loadSavedState();
}
/* Writes the plan as saved on this device and lets sync know. */
function persistSaved(state){
  try{ localStorage.setItem(STATE_KEY, JSON.stringify(state)); }catch(e){ return false; }
  try{ localStorage.removeItem(DRAFT_KEY); }catch(e){}
  return true;
}

/* Phase rows in the source workbook, keyed back to fund ids so an edited
   or renamed fund keeps its glide path. */
/* PHASE_FUND_IDS comes with the plan (usePlan). */

/* Backfills anything a state saved by an earlier version lacks, so an
   existing saved plan gains the new editable sections without losing data. */
function migrateState(){
  /* The debt/liquid MF used to be a standalone field sitting OUTSIDE the SIP
     total, which made every contribution reading look permanently ahead of plan
     once the fund started showing up in imported holdings. It is a Portfolio row
     now. Moved across once, then the old field is zeroed so the same ₹10K can
     never be counted on both sides. */
  if(Array.isArray(STATE.indiaFunds) && !STATE.indiaFunds.some(isDebtFund)
     && (Number(STATE.ppfMonthly) || 0) > 0){
    STATE.indiaFunds.push({
      id:'in-debt', name:'Debt/Liquid MF', monthly:Number(STATE.ppfMonthly)||0,
      cls:'Debt MF', geo:'India', debt:true,
      role:'Low-volatility ballast — compounds at the debt rate, not the equity rate. Redeemed into the FD ladder from age 49.',
    });
  }
  STATE.ppfMonthly = 0;
  if(!Array.isArray(STATE.corpusExclude)) STATE.corpusExclude = ['VEHICLE'];
  if(!Array.isArray(STATE.phaseHeads) || STATE.phaseHeads.length !== 5){
    STATE.phaseHeads = PHASE_HEADS.slice();
  }
  if(!STATE.phasePlan || typeof STATE.phasePlan !== 'object'){
    STATE.phasePlan = {};
    STATE.phaseExtras = [];
    PHASES.forEach(p=>{
      const id = PHASE_FUND_IDS[p.fund];
      if(id) STATE.phasePlan[id] = {cols:p.cols.slice(), note:p.note};
      else STATE.phaseExtras.push({id:cryptoId('px'), name:p.fund, cols:p.cols.slice(), note:p.note});
    });
  }
  if(!Array.isArray(STATE.phaseExtras)) STATE.phaseExtras = [];
  /* Everything below started life as a frozen constant. Each becomes editable
     state the first time a saved plan is opened, so rules, dropped instruments,
     retirement layers, SWP scenarios and crash history can all be added to. */
  if(!Array.isArray(STATE.goldenRules) || !STATE.goldenRules.length){
    STATE.goldenRules = GOLDEN_RULES.map(r=>({id:cryptoId('gr'), title:r.title, body:r.body}));
  }
  if(!Array.isArray(STATE.removed) || !STATE.removed.length){
    STATE.removed = REMOVED.map(r=>({id:cryptoId('rm'), name:r.name, status:r.status, reason:r.reason}));
  }
  if(!Array.isArray(STATE.layers) || !STATE.layers.length){
    STATE.layers = LAYERS.map(l=>({id:cryptoId('ly'), name:l.name, instrument:l.instrument,
      target:l.target, mid:l.mid, covers:l.covers, refill:l.refill, rule:l.rule}));
  }
  if(!Array.isArray(STATE.swp) || !STATE.swp.length){
    /* Surplus is derived, never stored — a stored one goes stale the moment
       either side of the subtraction is edited. */
    STATE.swp = SWP_SCENARIOS.map(x=>({id:cryptoId('sw'), name:x.name, corpus:x.corpus,
      monthly:x.monthly, expenses:x.expenses}));
  }
  /* Crash drawdowns keyed by FUND ID, not by ticker, so adding a US ETF on the
     Portfolio tab gives it an empty bar in every event, ready to fill in. */
  if(!Array.isArray(STATE.crashEvents) || !STATE.crashEvents.length){
    STATE.crashEvents = CRASH_EVENTS.map(e=>({
      id:cryptoId('cr'), name:e.name, dur:e.dur, cause:e.cause,
      draw:{'us-voo':e.voo, 'us-qqq':e.qqq, 'us-schd':e.schd},
    }));
  }
  // drop drawdowns whose ETF no longer exists, so deleting one leaves no tail
  if(Array.isArray(STATE.crashEvents)){
    const liveUs = {};
    (STATE.usFunds||[]).forEach(f=>{ liveUs[f.id] = true; });
    STATE.crashEvents.forEach(e=>{
      if(!e.draw || typeof e.draw !== 'object'){ e.draw = {}; return; }
      Object.keys(e.draw).forEach(k=>{ if(!liveUs[k]) delete e.draw[k]; });
    });
  }
  /* Its glide path used to be a standalone extras row. It belongs to the fund
     now, or the Phases tab lists the same instrument twice. */
  const debtFund = (STATE.indiaFunds||[]).filter(isDebtFund)[0];
  if(debtFund && STATE.phasePlan && !STATE.phasePlan[debtFund.id]){
    const legacy = STATE.phaseExtras.filter(x=>isDebtFund({name:x.name}) || /^ppf$/i.test(x.name||''))[0];
    if(legacy){
      STATE.phasePlan[debtFund.id] = {cols:(legacy.cols||[]).slice(), note:legacy.note};
      STATE.phaseExtras = STATE.phaseExtras.filter(x=>x !== legacy);
    }
  }
  /* Rates the projection needs but the original workbook never had. */
  if(typeof STATE.fdRate    !== 'number') STATE.fdRate    = 0.07;   // rate your FDs were booked at
  if(typeof STATE.inflation !== 'number') STATE.inflation = 0.06;
  if(typeof STATE.ltcgRate  !== 'number') STATE.ltcgRate  = 0.125;  // equity LTCG
  delete STATE.ltcgExempt;          // the annual exemption is no longer modelled
  if(typeof STATE.projTodayMoney !== 'boolean') STATE.projTodayMoney = false;
  if(!Array.isArray(STATE.contribSnaps)) STATE.contribSnaps = [];
  /* Purchase values entered by hand, for anything INDmoney reports without
     a cost basis. `holdings` is keyed by investment_code; `assets` by
     asset_type, for classes that have no row-level detail (RSUs, EPF…). */
  if(!STATE.costBasis || typeof STATE.costBasis !== 'object') STATE.costBasis = {};
  if(!STATE.costBasis.holdings || typeof STATE.costBasis.holdings !== 'object') STATE.costBasis.holdings = {};
  /* {newCode: oldCode} — a holding re-coded by a broker, linked by hand once and
     remembered, so its history is never orphaned again. */
  if(!STATE.holdingAliases || typeof STATE.holdingAliases !== 'object') STATE.holdingAliases = {};
  if(!STATE.costBasis.assets || typeof STATE.costBasis.assets !== 'object') STATE.costBasis.assets = {};
  /* Holdings INDmoney cannot see at all — Bitcoin on an exchange, anything
     off-platform. Tracked entirely by hand, but counted like any other asset. */
  if(!Array.isArray(STATE.manualAssets)){
    STATE.manualAssets = [];
    const btc = (STATE.indiaFunds || []).concat(STATE.usFunds || [])
      .filter(f => /bitcoin|crypto/i.test(f.name || ''))[0];
    if(btc){
      STATE.manualAssets.push({id: cryptoId('man'), name:'Bitcoin', current:0, invested:null});
    }
  }
  // Self-heal: drop glide paths whose fund no longer exists, so deleting a
  // fund can never leave a growing tail of dead entries in the saved plan.
  if(STATE.phasePlan && Array.isArray(STATE.indiaFunds) && Array.isArray(STATE.usFunds)){
    const live = {};
    STATE.indiaFunds.concat(STATE.usFunds).forEach(f=>{ live[f.id] = true; });
    Object.keys(STATE.phasePlan).forEach(k=>{ if(!live[k]) delete STATE.phasePlan[k]; });
  }
  if(!Array.isArray(STATE.calendar)){
    let legacy = {};
    try{ legacy = JSON.parse(localStorage.getItem('ledger-calendar-done-v1')) || {}; }catch(e){}
    const seen = {};
    STATE.calendar = CALENDAR.map(c=>{
      seen[c.age] = (seen[c.age] === undefined) ? 0 : seen[c.age] + 1;
      return {
        id: cryptoId('cal'), age:c.age, year:c.year, pr:c.pr, label:c.label,
        action:c.action, fund:c.fund, why:c.why, how:c.how,
        done: !!legacy[c.age + '-' + seen[c.age]],
      };
    });
  }
}

let STATE = loadState();
migrateState();
let dirty = LOADED_DRAFT;   // unsaved edits from last time come back as unsaved

/* One step back for anything destructive. Discard reverts to the last SAVE,
   which is far too blunt when you have just deleted one fund by mistake. */
const UNDO = [];
function pushUndo(label){
  try{ UNDO.push({label, state: deepClone(STATE)}); }catch(e){ return; }
  if(UNDO.length > 20) UNDO.shift();
}
function rerenderAll(){
  renderTopbar();
  if(typeof renderPlanSource === 'function') renderPlanSource();
  Object.keys(RENDERERS).forEach(id=>{ if(document.getElementById('panel-'+id)) RENDERERS[id](); });
  applySearch();
}
function undoLast(){
  const u = UNDO.pop();
  if(!u) return;
  STATE = u.state;
  usePlan(STATE.plan);
  migrateState();
  hydrateLiveFromState();
  markDirty();
  rerenderAll();
  flashSaveStatus('Undone — ' + u.label);
}

function markDirty(){
  dirty = true;
  try{ localStorage.setItem(DRAFT_KEY, JSON.stringify(STATE)); }catch(e){}
  updateSaveBar();
}
function updateSaveBar(){
  document.getElementById('save-bar').classList.toggle('show', dirty);
  const u = document.getElementById('undo-btn');
  if(u){
    u.hidden = !UNDO.length;
    u.textContent = UNDO.length ? 'Undo ' + UNDO[UNDO.length-1].label.toLowerCase() : 'Undo';
  }
}
function flashSaveStatus(msg){
  const el = document.getElementById('save-status');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(flashSaveStatus._t);
  flashSaveStatus._t = setTimeout(()=>el.classList.remove('show'), 3200);
}

/* =========================================================
   FORMATTERS
   ========================================================= */
function inrGroup(intStr){
  const neg = intStr.startsWith('-');
  if(neg) intStr = intStr.slice(1);
  let last3 = intStr.slice(-3);
  let rest = intStr.slice(0,-3);
  if(rest !== '') last3 = ',' + last3;
  rest = rest.replace(/\B(?=(\d{2})+(?!\d)$)/g, ',');
  return (neg?'-':'') + rest + last3;
}
function fmtINR(n, {decimals=0}={}){
  n = Number(n)||0;
  n = Math.round(n * Math.pow(10,decimals)) / Math.pow(10,decimals);
  const [intPart, decPart] = n.toFixed(decimals).split('.');
  const grouped = inrGroup(intPart);
  return '₹' + grouped + (decPart ? '.'+decPart : '');
}
function fmtCompact(n){
  n = Number(n)||0;
  if(Math.abs(n) >= 1e7) return '₹' + (n/1e7).toFixed(2) + ' Cr';
  if(Math.abs(n) >= 1e5) return '₹' + (n/1e5).toFixed(2) + ' L';
  return fmtINR(n);
}
function fmtPct(n, d=1){ return (Number(n)*100 || 0).toFixed(d) + '%'; }
function fmtDate(d){
  const dt = (d instanceof Date) ? d : new Date(d);
  return dt.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
}

/* =========================================================
   AGE — computed from DOB, always live (new Date() at call time)
   ========================================================= */
function ageAt(asOf){
  const y = asOf.getFullYear(), m = asOf.getMonth(), d = asOf.getDate();
  let age = y - DOB.getFullYear();
  const hadBirthday = (m > DOB.getMonth()) || (m === DOB.getMonth() && d >= DOB.getDate());
  if(!hadBirthday) age--;
  const lastBdayYear = y - (hadBirthday?0:1);
  const lastBday = new Date(lastBdayYear, DOB.getMonth(), DOB.getDate());
  const nextBday = new Date(lastBdayYear+1, DOB.getMonth(), DOB.getDate());
  const frac = (asOf - lastBday) / (nextBday - lastBday);
  return age + frac;
}
function fmtAge(a){
  const years = Math.floor(a);
  const months = Math.round((a-years)*12);
  return months>0 ? `${years}y ${months}m` : `${years}y`;
}

/* =========================================================
   DERIVED TOTALS from STATE
   ========================================================= */
function totalSIP(){ return sumFunds(STATE.indiaFunds) + sumFunds(STATE.usFunds); }
function sumFunds(list){ return list.reduce((s,f)=>s+(Number(f.monthly)||0),0); }
/* The debt/liquid MF is an ordinary Portfolio row, so it counts inside the total
   SIP like any other mandate. But it must never compound at the equity rate, and
   it isn't part of the equity allocation the donuts and drift checks describe.
   One predicate, used everywhere that distinction actually matters. */
function isDebtFund(f){
  return f.debt === true || /\b(debt|liquid)\b/i.test(String(f.cls||'') + ' ' + String(f.name||''));
}
function allFunds(){ return (STATE.indiaFunds||[]).concat(STATE.usFunds||[]); }
function debtSIP(){ return sumFunds(allFunds().filter(isDebtFund)); }
function equitySIP(){ return totalSIP() - debtSIP(); }
function indiaEquityFunds(){ return (STATE.indiaFunds||[]).filter(f=>!isDebtFund(f)); }
function usEquityFunds(){ return (STATE.usFunds||[]).filter(f=>!isDebtFund(f)); }
function livingExpenses(){
  return STATE.salary - totalSIP() - STATE.buffer;
}
function latestSnapshot(){
  return STATE.snapshots.slice().sort((a,b)=> new Date(a.date)-new Date(b.date)).pop();
}

/* Asset classes that do not compound at an equity rate. Growing EPF and
   fixed deposits at 12% overstated the age-50 corpus by roughly 8%. */
const DEBT_CLASSES = {EPF:1, NPS:1, FD:1, PPF:1, RD:1, BOND:1, SA:1, US_STOCK_WALLET:1};

/* Today's corpus, separated into what compounds like equity and what doesn't.
   Falls back to the workbook's single starting figure when nothing has been
   imported yet — there's no class detail to split in that case. */
function startingBuckets(){
  const inv = (LIVE.snapshot && Array.isArray(LIVE.snapshot.investments)) ? LIVE.snapshot.investments : [];
  const ex = corpusExclude();
  let equity = 0, fd = 0, ppf = 0, flat = 0;
  inv.forEach(a=>{
    if(ex.indexOf(a.asset_type) !== -1) return;
    const v = Number(a.current_value) || 0;
    if(a.asset_type === 'FD' || a.asset_type === 'RD')      fd   += v;   // grows at the booked rate
    else if(a.asset_type === 'PPF')                          ppf  += v;   // joins the debt/liquid MF corpus
    else if(DEBT_CLASSES[a.asset_type])                      flat += v;   // EPF, NPS — no rate to hand
    else                                                     equity += v;
  });
  manualAssets().forEach(m=>{
    if(ex.indexOf(manualKey(m)) !== -1) return;
    equity += Number(m.current) || 0;
  });
  /* An import reports one flat "MF" class, so a debt/liquid fund you already
     hold lands in the equity bucket and would compound at the equity rate.
     Move whatever the plan recognises as ballast across before projecting. */
  const heldDebt = reconcilePlan().rows
    .filter(r=>isDebtFund(r.fund)).reduce((s,r)=>s + (Number(r.value)||0), 0);
  const movedDebt = Math.min(equity, heldDebt);
  equity -= movedDebt; ppf += movedDebt;
  const debt = fd + ppf + flat;
  if(equity + debt <= 0){
    const snap = latestSnapshot();
    return {equity: snap ? snap.value : BASELINE.portfolioValue,
            fd:0, ppf:0, flat:0, debt:0, split:false};
  }
  return {equity, fd, ppf, flat, debt, split:true};
}

/* =========================================================
   PROJECTION ENGINE (detailed table) — mirrors the workbook:
   F(age) = F(age-1)*(1+equity) + annualSIP*(1+equity/2)
   G(age) = G(age-1)*(1+debt)   + debtAnnual*(1+debt/2)
   Final age: contributions stop; both corpora keep compounding.
   Runs on a fixed 34→50 age scale — the plan's own designed
   schedule (all phase/action triggers are keyed to it).
   ========================================================= */
function computeProjection(a){
  const rows = [];
  let D = a.baseSIP;
  let F = a.existing;                                  // equity bucket
  let G = Number(a.existingPpf) || 0;                   // debt / liquid MF corpus, plus what you add
  let FD   = Number(a.existingFd)   || 0;               // grows at the rate it was booked at
  let FLAT = Number(a.existingFlat) || 0;               // EPF / NPS — carried, never guessed at
  const ppfAnnual = a.ppfMonthly * 12;
  const fdRate    = (typeof a.fdRate === 'number') ? a.fdRate : 0.07;
  const startAge  = (typeof a.startAge === 'number') ? a.startAge : 34;
  const endAge    = (typeof a.endAge   === 'number') ? a.endAge   : 50;
  /* Money put in, tracked alongside, so the tax view can tell a withdrawal's
     gain from its principal instead of guessing. */
  let contributed = a.existing + FD + FLAT + G;
  for(let age=startAge; age<=endAge; age++){
    let E, prevF = F, prevG = G, prevFD = FD;
    if(age === startAge){
      E = D * 12;
      F = a.existing*(1+a.equityRate) + E*(1+a.equityRate/2);
      G = prevG*(1+a.ppfRate) + ppfAnnual*(1+a.ppfRate/2);
      FD = prevFD*(1+fdRate);
      contributed += E + ppfAnnual;
    } else if(age === endAge){
      D = null; E = 0;                                  // contributions stop
      F = prevF*(1+a.equityRate);
      G = prevG*(1+a.ppfRate);                          // still compounds; only the SIP stops
      FD = prevFD*(1+fdRate);
    } else {
      D = D*(1+a.stepUp);
      E = D*12;
      F = prevF*(1+a.equityRate) + E*(1+a.equityRate/2);
      G = prevG*(1+a.ppfRate) + ppfAnnual*(1+a.ppfRate/2);
      FD = prevFD*(1+fdRate);
      contributed += E + ppfAnnual;
    }
    const B = FD + FLAT;                                 // shown as one column
    const H = F + G + B;
    const I = H*0.04/12;
    const phase = age >= endAge ? 'Retired'
                : age < 40      ? 'Phase 1: Full throttle'
                : age <= 42     ? 'Phase 2A: Growth + aware'
                : age <= 45     ? 'Phase 2B: De-risking'
                :                 'Phase 3: Preservation';
    rows.push({ age, year:2025+(age-startAge), phase, monthlySIP:D, annualSIP:E,
                equity:F, ppf:G, debt:B, fd:FD, flat:FLAT, total:H, income:I, contributed });
  }
  return rows;
}

/* Tax on a 4% withdrawal. Only equity LTCG is modelled, at the full rate — no
   annual exemption is assumed. EPF comes out tax-exempt; debt-fund and FD gains
   at slab are deliberately left out rather than guessed at, since the split
   inside the debt bucket isn't known here. */
function afterTax(row, opts){
  const gross = row.total * 0.04;                       // per year
  const gainFrac = row.total > 0 ? Math.max(0, (row.total - row.contributed)/row.total) : 0;
  const equityShare = row.total > 0 ? row.equity/row.total : 0;
  const equityGain = gross * equityShare * gainFrac;
  const tax = Math.max(0, equityGain) * (opts.ltcgRate||0);
  return {gross: gross/12, tax: tax/12, net: (gross-tax)/12, gainFrac, equityGain};
}

/* Future rupees expressed in today's money. */
function deflate(v, years, inflation){ return v / Math.pow(1 + (inflation||0), Math.max(0, years)); }

/* Forward, real-age projection for the progress chart — a single
   blended corpus figure, stepped annually from a real (possibly
   fractional) starting age to a real end age. */
function computeForwardProjection({startAge, startValue, monthlySIP, stepUp, equityRate, endAge}){
  const pts = [{age:startAge, value:startValue}];
  if(endAge <= startAge) return pts;
  let age = startAge, value = startValue, sip = monthlySIP;
  let nextWhole = Math.floor(startAge) + 1;
  if(nextWhole > startAge && nextWhole <= endAge){
    const frac = nextWhole - startAge;
    const annual = sip*12*frac;
    value = value*Math.pow(1+equityRate, frac) + annual*(1+equityRate*frac/2);
    age = nextWhole;
    pts.push({age, value});
  }
  while(age < endAge - 1e-9){
    sip = sip*(1+stepUp);
    const next = Math.min(age+1, endAge);
    const yrs = next - age;
    const annual = sip*12*yrs;
    value = value*Math.pow(1+equityRate, yrs) + annual*(1+equityRate*yrs/2);
    age = next;
    pts.push({age, value});
  }
  return pts;
}

/* =========================================================
   TAB / PANEL SHELL
   ========================================================= */
const TABS = [
  {id:'overview', label:'Overview', group:'overview'},
  {id:'live', label:'Import portfolio', group:'holdings'},
  {id:'contrib', label:'Contributions', group:'holdings'},
  {id:'checks', label:'Checks', group:'holdings'},
  {id:'portfolio', label:'Portfolio', group:'plan'},
  {id:'phases', label:'Phases', group:'plan'},
  {id:'projection', label:'Projection', group:'plan'},
  {id:'calendar', label:'Action Calendar', group:'actions'},
  {id:'us', label:'US ETF Strategy', group:'retire'},
  {id:'retirement', label:'Retirement', group:'retire'},
];
/* Five sections, like the expense tracker: a strip on a wide screen, a
   bottom bar on a phone. Sections with more than one page show those
   pages as a second row underneath. */
const GROUPS = [
  {id:'overview', label:'Overview', icon:'◉'},
  {id:'holdings', label:'Holdings', icon:'▤'},
  {id:'plan', label:'Plan', icon:'◆'},
  {id:'actions', label:'Actions', icon:'✓'},
  {id:'retire', label:'Retirement', icon:'☼'},
];
const LAST_IN_GROUP = {};
const RENDERERS = {}; // filled in below, id -> render function

function buildShell(){
  const groupsEl = document.getElementById('tabs');
  groupsEl.removeAttribute('role');
  groupsEl.className = 'groups';
  const wrap = document.createElement('div');
  wrap.className = 'navwrap';
  groupsEl.parentNode.insertBefore(wrap, groupsEl);
  wrap.appendChild(groupsEl);
  const tabsEl = document.createElement('nav');
  tabsEl.className = 'tabs subtabs';
  tabsEl.id = 'subtabs';
  tabsEl.setAttribute('role','tablist');
  tabsEl.setAttribute('aria-label','Pages');
  wrap.appendChild(tabsEl);
  GROUPS.forEach(g=>{
    const b = document.createElement('button');
    b.className = 'group-btn';
    b.dataset.group = g.id;
    b.innerHTML = `<span class="gi" aria-hidden="true">${g.icon}</span><span>${g.label}</span>`;
    b.addEventListener('click', ()=>{
      const first = TABS.filter(t=>t.group===g.id)[0];
      selectTab(LAST_IN_GROUP[g.id] || first.id);
    });
    groupsEl.appendChild(b);
  });
  TABS.forEach((t,i)=>{
    const b = document.createElement('button');
    b.className = 'tab-btn';
    b.setAttribute('role','tab');
    b.setAttribute('aria-selected', i===0 ? 'true':'false');
    b.id = 'tab-' + t.id;
    b.setAttribute('aria-controls', 'panel-' + t.id);
    b.tabIndex = i===0 ? 0 : -1;          // one stop; arrows move within
    b.dataset.panel = t.id;
    b.dataset.group = t.group;
    b.hidden = t.group !== TABS[0].group;
    b.innerHTML = `<span>${t.label}</span>`;
    b.addEventListener('click', ()=>selectTab(t.id));
    b.addEventListener('keydown', e=>{
      const keys = {ArrowRight:1, ArrowLeft:-1, Home:'first', End:'last'};
      if(!(e.key in keys)) return;
      e.preventDefault();
      const k = keys[e.key];
      const sib = TABS.filter(x=>x.group===t.group);
      const j = sib.indexOf(t);
      const nextTab = k==='first' ? sib[0] : k==='last' ? sib[sib.length-1]
                 : sib[(j + k + sib.length) % sib.length];
      selectTab(nextTab.id);
      const btn = document.getElementById('tab-' + nextTab.id);
      if(btn) btn.focus();
    });
    tabsEl.appendChild(b);
  });
  syncNav(TABS[0].id);
  const main = document.getElementById('main');
  TABS.forEach((t,i)=>{
    const sec = document.createElement('section');
    sec.className = 'panel' + (i===0?' active':'');
    sec.id = 'panel-'+t.id;
    sec.setAttribute('role','tabpanel');
    sec.setAttribute('aria-labelledby','tab-'+t.id);
    sec.tabIndex = 0;
    main.appendChild(sec);
  });
}
function syncNav(id){
  const tab = TABS.filter(t=>t.id===id)[0];
  if(!tab) return;
  LAST_IN_GROUP[tab.group] = id;
  document.querySelectorAll('.group-btn').forEach(b=>{
    const on = b.dataset.group === tab.group;
    b.classList.toggle('on', on);
    if(on) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current');
  });
  document.querySelectorAll('.tab-btn').forEach(b=>{ b.hidden = b.dataset.group !== tab.group; });
  const sub = document.getElementById('subtabs');
  if(sub) sub.hidden = TABS.filter(t=>t.group===tab.group).length < 2;
}
function selectTab(id){
  syncNav(id);
  document.querySelectorAll('.tab-btn').forEach(b=>{
    const on = b.dataset.panel === id;
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.tabIndex = on ? 0 : -1;
  });
  if(RENDERERS[id]) RENDERERS[id]();
  document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('active', p.id==='panel-'+id));
  applySearch();          // a live filter term carries across to the new tab
  window.scrollTo({top:0,behavior:'instant' in window ? 'instant':'auto'});
}

/* =========================================================
   PAGE SEARCH — one box, filtering whichever tab is open.
   Matches against a row's visible text AND the current value of
   any input inside it, because on Portfolio and Phases the fund
   names live in input values, not in text nodes.
   ========================================================= */
const SEARCH_ROWS = 'tbody tr, .action-item, .snap-item, .rule, .reason-card, .layer-row, .crash-event';
let searchTerm = '';

function searchHaystack(el){
  let s = el.textContent || '';
  el.querySelectorAll('input, select, textarea').forEach(i=>{
    const t = String(i.type || '').toLowerCase();
    if(t === 'checkbox' || t === 'radio') return;
    if(i.value) s += ' ' + i.value;
    if(i.tagName === 'SELECT' && i.selectedOptions && i.selectedOptions[0]){
      s += ' ' + i.selectedOptions[0].textContent;
    }
  });
  return s.toLowerCase();
}
function shownBySearch(el){ return !el.classList.contains('search-hidden'); }

function applySearch(){
  const panel = document.querySelector('.panel.active');
  const countEl = document.getElementById('search-count');
  const clearBtn = document.getElementById('search-clear');
  if(clearBtn) clearBtn.hidden = !searchTerm;
  if(!panel){ if(countEl) countEl.textContent = ''; return; }

  if(!searchTerm){
    panel.querySelectorAll('.search-hidden').forEach(e=>e.classList.remove('search-hidden'));
    if(countEl){ countEl.textContent = ''; countEl.style.color = ''; }
    return;
  }

  const rows = panel.querySelectorAll(SEARCH_ROWS);
  let shown = 0;
  rows.forEach(r=>{
    const hit = searchHaystack(r).indexOf(searchTerm) !== -1;
    r.classList.toggle('search-hidden', !hit);
    if(hit) shown++;
  });
  // Fold away wrappers left holding nothing — but never one that had no
  // filterable rows to begin with (charts, notices, the settings grid).
  panel.querySelectorAll('.year-group').forEach(g=>{
    const items = g.querySelectorAll('.action-item');
    g.classList.toggle('search-hidden',
      items.length > 0 && !Array.prototype.some.call(items, shownBySearch));
  });
  panel.querySelectorAll('section.block').forEach(s=>{
    const items = s.querySelectorAll(SEARCH_ROWS);
    s.classList.toggle('search-hidden',
      items.length > 0 && !Array.prototype.some.call(items, shownBySearch));
  });

  if(countEl){
    countEl.textContent = shown ? (shown + ' of ' + rows.length) : 'no matches';
    countEl.style.color = shown ? '' : 'var(--warning)';
  }
}

function wireSearch(){
  const inp = document.getElementById('page-search');
  if(!inp) return;
  inp.addEventListener('input', ()=>{
    searchTerm = inp.value.trim().toLowerCase();
    applySearch();
  });
  inp.addEventListener('keydown', e=>{
    if(e.key === 'Escape'){ inp.value = ''; searchTerm = ''; applySearch(); inp.blur(); }
  });
  const clr = document.getElementById('search-clear');
  if(clr) clr.addEventListener('click', ()=>{
    inp.value = ''; searchTerm = ''; applySearch(); inp.focus();
  });
  /* Panels rebuild themselves on every edit, import and tab switch, which
     discards the hidden marks. Re-apply after any rebuild. childList only —
     our own class toggles are attribute changes, so this can't feed itself. */
  const main = document.getElementById('main');
  if(main && window.MutationObserver){
    let t = null;
    new MutationObserver(()=>{
      if(!searchTerm) return;
      clearTimeout(t);
      t = setTimeout(applySearch, 60);
    }).observe(main, {childList:true, subtree:true});
  }
}
function renderTopbar(){
  document.getElementById('top-sip').textContent = fmtINR(totalSIP());
  document.getElementById('top-target').textContent = `₹${STATE.targetLowCr}–${STATE.targetHighCr} Cr`;
  document.getElementById('brand-eyebrow').textContent = `Investment plan · age ${Math.floor(ageAt(new Date()))} → ${STATE.retireAge}`;
}

/* =========================================================
   REUSABLE: DONUT CHART
   ========================================================= */
const CAT_COLORS = ['var(--cat-blue)','var(--cat-orange)','var(--cat-aqua)','var(--cat-yellow)','var(--cat-magenta)','var(--cat-green)','var(--cat-violet)','var(--cat-red)'];

function donut(items, {size=180, thickness=26, label='Allocation'}={}){
  const total = items.reduce((s,i)=>s+i.value,0) || 1;
  /* A screen reader gets the actual split, not the word "chart". */
  const alt = label + ': ' + (items.length
    ? items.map(i=>i.label + ' ' + fmtCompact(i.value) + ' (' + fmtPct(i.value/total) + ')').join(', ')
    : 'nothing to show');
  const r = (size - thickness)/2;
  const c = 2*Math.PI*r;
  let offset = 0;
  const cx=size/2, cy=size/2;
  let circles = '';
  items.forEach((it)=>{
    const frac = Math.max(0,it.value)/total;
    const len = frac*c;
    circles += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${it.color}" stroke-width="${thickness}"
      stroke-dasharray="${len} ${c-len}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"
      stroke-linecap="butt"><title>${it.label}: ${fmtINR(it.value)} (${fmtPct(frac)})</title></circle>`;
    offset += len;
  });
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${escAttr(alt)}">
    ${circles}
    <circle cx="${cx}" cy="${cy}" r="${r-thickness/2-3}" fill="none" stroke="var(--border)" stroke-width="1"></circle>
  </svg>`;
}
function legendHTML(items){
  const total = items.reduce((s,i)=>s+i.value,0) || 1;
  return `<div class="legend">${items.map(it=>`
    <div class="legend-item">
      <span class="sw" style="background:${it.color}"></span>
      <span class="lbl">${it.label}</span>
      <span class="val num">${fmtINR(it.value)}</span>
      <span class="pct num">${fmtPct(it.value/total)}</span>
    </div>`).join('')}</div>`;
}

/* =========================================================
   TOOLTIP
   ========================================================= */
const tooltipEl = document.getElementById('tooltip');
function showTooltip(x,y,html){
  tooltipEl.innerHTML = html;
  tooltipEl.hidden = false;
  tooltipEl.style.opacity = '1';
  const rect = tooltipEl.getBoundingClientRect();
  let left = x + 16, top = y + 16;
  if(left + rect.width > window.innerWidth - 8) left = x - rect.width - 16;
  if(top + rect.height > window.innerHeight - 8) top = y - rect.height - 16;
  tooltipEl.style.left = left+'px';
  tooltipEl.style.top = top+'px';
}
function hideTooltip(){ tooltipEl.style.opacity='0'; tooltipEl.hidden = true; }

/* =========================================================
   EDITABLE FIELD HELPERS
   ========================================================= */
function bindStateField(input, {get, set}){
  input.value = get();
  input.addEventListener('input', ()=>{
    set(parseFloat(input.value)||0);
    markDirty();
  });
}
function bindFundField(input, group, id, field, isNumber){
  input.addEventListener('input', ()=>{
    const fund = STATE[group].find(f=>f.id===id);
    if(!fund) return;
    fund[field] = isNumber ? (parseFloat(input.value)||0) : input.value;
    markDirty();
    refreshFundDerived();
  });
}

/* =========================================================
   PANEL: OVERVIEW
   ========================================================= */
const OPEN_FOLDS = new Set();
function renderOverview(){
  const el = document.getElementById('panel-overview');
  const now = new Date();
  const currentAge = ageAt(now);
  const baselineAge = ageAt(new Date(BASELINE.date));
  const retireAge = STATE.retireAge;
  const pct = Math.max(0, Math.min(100, ((currentAge-baselineAge)/(retireAge-baselineAge))*100));

  const phaseRanges = [
    {label:'34–40', name:'Full throttle', lo:34, hi:40},
    {label:'40–43', name:'Growth + aware', lo:40, hi:43},
    {label:'43–46', name:'De-risking', lo:43, hi:46},
    {label:'46–50', name:'Preservation', lo:46, hi:49.5},
    {label:'50+', name:'Retired', lo:49.5, hi:999},
  ];

  const snap = latestSnapshot();

  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Where the plan stands</h2>
        <p>Age ${fmtAge(currentAge)} · retiring at <span id="ov-retire">${retireAge}</span> · target <span id="ov-target">₹${STATE.targetLowCr}–${STATE.targetHighCr} Cr</span></p>
      </div>
      <button class="snap-add-btn review-btn" id="review-month" ${ASK.ready ? '' : 'hidden'}>✦ Review this month</button>
    </div>

    <div class="kpi-grid">
      <div class="card kpi">
        <div class="l">Corpus today</div>
        <div class="v" id="kpi-corpus">—</div>
        <div class="sub" id="kpi-corpus-sub"></div>
      </div>
      <div class="card kpi">
        <div class="l">Monthly SIP</div>
        <div class="v" id="kpi-sip">—</div>
        <div class="sub" id="kpi-sip-sub"></div>
      </div>
      <div class="card kpi">
        <div class="l">Projected at <span id="kpi-proj-age">${retireAge}</span></div>
        <div class="v" id="kpi-proj">—</div>
        <span class="state" id="kpi-proj-state"></span>
      </div>
      <div class="card kpi">
        <div class="l">Next action</div>
        <div class="v text" id="kpi-next">—</div>
        <div class="sub" id="kpi-next-sub"></div>
        <button class="kpi-link" id="kpi-next-go">Open the action calendar →</button>
      </div>
    </div>

    <div class="card hero-card">
      <div class="road-head"><h3>Road to retirement</h3><span>${fmtDate(new Date(BASELINE.date))} → age ${retireAge}</span></div>
      <div class="timeline">
        <div class="timeline-now" style="left:${pct}%"><span class="tag">Today · ${fmtDate(now)}</span><span class="pin"></span></div>
        <div class="timeline-track"><div class="timeline-fill" id="tl-fill"></div></div>
        <div class="timeline-ticks"><span>${baselineAge.toFixed(0)}</span><span>${(baselineAge + (retireAge-baselineAge)*0.33).toFixed(0)}</span><span>${(baselineAge + (retireAge-baselineAge)*0.66).toFixed(0)}</span><span>${retireAge} — retire</span></div>
      </div>
      <div class="phase-strip">
        ${phaseRanges.map(p=>`<div class="phase-chip ${currentAge>=p.lo && currentAge<p.hi ? 'current':''}"><b>${p.label}</b>${p.name}</div>`).join('')}
      </div>
    </div>

    <section class="block" style="margin-top:32px;">
      <div class="block-title">Progress toward the target</div>
      <div class="card pad">
        <div class="chart-wrap" id="chart-progress"></div>
        <div class="chart-legend">
          <div class="item"><span class="sw" style="background:var(--ink-muted)"></span>Original plan</div>
          <div class="item"><span class="sw" style="background:var(--ink-secondary)"></span>Your check-ins</div>
          <div class="item"><span class="sw" style="border:2px dashed var(--gold-strong);background:transparent;"></span>Starting point</div>
          <div class="item"><span class="sw" style="background:var(--accent)"></span>Projected from today</div>
          <div class="item"><span class="sw" style="background:var(--gold)"></span>Target band</div>
        </div>
        ${(function(){
          const hasOrigin = STATE.snapshots.some(s=>s.origin);
          const hasLater  = STATE.snapshots.some(s=>!s.origin);
          if(!hasOrigin || !hasLater) return '';
          return `<p class="footnote">The starting point isn't joined to the line: it predates the EPF, RSUs, NPS and FD
            that later imports brought in, so a line from it would count that import as growth.</p>`;
        })()}
      </div>
    </section>

    <section class="block">
      <div class="block-title">Monthly money flow</div>
      <div class="grid-2">
        <div class="card pad">
          <div class="donut-row" id="flow-donut"></div>
        </div>
        <div class="card pad" style="display:flex;flex-direction:column;gap:12px;justify-content:center;">
          <div class="stat-tile" style="padding:0;">
            <div class="l">Salary</div><div class="v num">${fmtINR(STATE.salary)}</div>
            <div class="sub">Take-home, 100% accounted for</div>
          </div>
          <div class="stat-tile" style="padding:0;">
            <div class="l">Total monthly SIP</div><div class="v num">${fmtINR(totalSIP())}</div>
            <div class="sub">${fmtPct(totalSIP()/STATE.salary)} of salary</div>
          </div>
          <div class="stat-tile" style="padding:0;">
            <div class="l">Buffer / Sweep-in FD</div><div class="v num">${fmtINR(STATE.buffer)}</div>
            <div class="sub">Deploy on any crash over 15%.</div>
          </div>
        </div>
      </div>
      <div id="budget-warn"></div>
    </section>

    <section class="block">
      <div class="block-title">Investments recorded in the expense tracker</div>
      <div class="card pad">
        <div class="xi-head">
          <p>What actually went into investments each month, from your bank statements.</p>
          <button class="reset-btn" id="xi-paste-toggle">Paste from expense tracker</button>
        </div>
        <div id="xi-paste" hidden>
          <textarea id="xi-text" rows="3" placeholder="Paste what the expense tracker's “Copy for Ledger” button copied" aria-label="Paste from expense tracker"></textarea>
          <div class="corpus-actions" style="margin-top:8px;"><button class="snap-add-btn" id="xi-check">Add these months</button></div>
        </div>
        <p class="xi-msg" id="xi-msg" role="status"></p>
        <div id="xi-body"></div>
      </div>
    </section>

    <section class="block">
      <div class="block-title">Portfolio check-ins</div>
      <div class="card pad">
        <div class="snap-list" id="snap-list"></div>
        <form class="snap-form" id="snap-form">
          <div><label for="snap-date">Date</label><input type="date" id="snap-date" required></div>
          <div><label for="snap-value">Portfolio value (₹)</label><input type="number" id="snap-value" step="1000" required placeholder="e.g. 1250000"></div>
          <div><label for="snap-note">Note (optional)</label><input type="text" id="snap-note" placeholder="e.g. after the March step-up"></div>
          <button type="submit" class="snap-add-btn">Add check-in</button>
        </form>
      </div>
    </section>

    <details class="import-box fold" data-fold="numbers">
      <summary>Plan settings — salary, target, returns</summary>
      <div class="import-body">
        <div class="settings-grid" style="margin-top:14px;">
          <div class="field"><label for="f-salary">Monthly salary</label><input type="number" step="1000" id="f-salary"></div>
          <div class="field"><label for="f-buffer">Buffer / sweep-in FD</label><input type="number" step="500" id="f-buffer"></div>
          <div class="field"><label for="f-retireage">Retirement age</label><input type="number" step="1" id="f-retireage"></div>
          <div class="field"><label for="f-targetlow">Target — low (₹ Cr)</label><input type="number" step="0.1" id="f-targetlow"></div>
          <div class="field"><label for="f-targethigh">Target — high (₹ Cr)</label><input type="number" step="0.1" id="f-targethigh"></div>
          <div class="field"><label for="f-equityrate">Equity XIRR assumption (%)</label><input type="number" step="0.5" id="f-equityrate"></div>
          <div class="field"><label for="f-stepup">Annual step-up (%)</label><input type="number" step="0.5" id="f-stepup"></div>
          <div class="field"><label for="f-fdrate">FD return (%)</label><input type="number" step="0.25" id="f-fdrate"></div>
          <div class="field"><label for="f-inflation">Inflation (%)</label><input type="number" step="0.25" id="f-inflation"></div>
          <div class="field"><label for="f-ltcg">Equity LTCG rate (%)</label><input type="number" step="0.5" id="f-ltcg"></div>
        </div>
      </div>
    </details>

    <details class="import-box fold" data-fold="rules">
      <summary><span><span id="rules-count">${STATE.goldenRules.length}</span> golden rules</span></summary>
      <div class="import-body">
        <div class="rules" id="rules-list" style="margin-top:14px;"></div>
        <button class="add-row-btn" id="add-rule">+ Add a rule</button>
      </div>
    </details>

    <details class="import-box fold" data-fold="data">
      <summary>Your data — export and restore</summary>
      <div class="import-body">
        <p>Your plan is kept in this browser${Cloud.syncConfig() ? ' and, encrypted, synced to your other devices' : ' (turn on Profile → Settings → Sync to have it on your phone too)'}.
          Export it to keep a copy you own, restorable into any browser's copy of this page.</p>
        <div class="corpus-actions" style="margin-top:12px;">
          <button class="snap-add-btn" id="data-export">Export my plan</button>
          <button class="reset-btn" id="data-restore-toggle">Restore from a file</button>
          <button class="reset-btn" id="print-summary">Print one-page summary</button>
          <button class="reset-btn" id="save-summary">Save it as a file</button>
          <span id="data-msg" style="font-size:12px;color:var(--ink-muted);"></span>
        </div>
        <div id="data-out"></div>
      </div>
    </details>
  `;

  /* Remember which folded sections are open while moving between tabs. */
  el.querySelectorAll('details[data-fold]').forEach(d=>{
    if(OPEN_FOLDS.has(d.dataset.fold)) d.open = true;
    d.addEventListener('toggle', ()=>{ if(d.open) OPEN_FOLDS.add(d.dataset.fold); else OPEN_FOLDS.delete(d.dataset.fold); });
  });
  renderExpenseInvest();
  wireExpenseInvest();
  const rev = document.getElementById('review-month');
  if(rev) rev.addEventListener('click', reviewMonth);
  const goCal = document.getElementById('kpi-next-go');
  if(goCal) goCal.addEventListener('click', ()=>selectTab('calendar'));

  requestAnimationFrame(()=>{ const f=document.getElementById('tl-fill'); if(f) f.style.width = pct+'%'; });

  bindStateField(document.getElementById('f-salary'), {get:()=>STATE.salary, set:v=>{STATE.salary=v; refreshOverviewDerived();}});
  bindStateField(document.getElementById('f-buffer'), {get:()=>STATE.buffer, set:v=>{STATE.buffer=v; refreshOverviewDerived();}});
  bindStateField(document.getElementById('f-retireage'), {get:()=>STATE.retireAge, set:v=>{STATE.retireAge=Math.max(35,v); refreshOverviewDerived();}});
  bindStateField(document.getElementById('f-targetlow'), {get:()=>STATE.targetLowCr, set:v=>{STATE.targetLowCr=v; refreshOverviewDerived();}});
  bindStateField(document.getElementById('f-targethigh'), {get:()=>STATE.targetHighCr, set:v=>{STATE.targetHighCr=v; refreshOverviewDerived();}});
  bindStateField(document.getElementById('f-equityrate'), {get:()=>(STATE.equityRate*100).toFixed(2), set:v=>{STATE.equityRate=v/100; refreshOverviewDerived();}});
  bindStateField(document.getElementById('f-stepup'), {get:()=>(STATE.stepUp*100).toFixed(2), set:v=>{STATE.stepUp=v/100; refreshOverviewDerived();}});
  bindStateField(document.getElementById('f-fdrate'), {get:()=>(STATE.fdRate*100).toFixed(2), set:v=>{STATE.fdRate=v/100; refreshOverviewDerived();}});
  bindStateField(document.getElementById('f-inflation'), {get:()=>(STATE.inflation*100).toFixed(2), set:v=>{STATE.inflation=v/100; refreshOverviewDerived();}});
  bindStateField(document.getElementById('f-ltcg'), {get:()=>(STATE.ltcgRate*100).toFixed(2), set:v=>{STATE.ltcgRate=v/100; refreshOverviewDerived();}});

  document.getElementById('snap-date').value = now.toISOString().slice(0,10);
  document.getElementById('snap-form').addEventListener('submit', e=>{
    e.preventDefault();
    const date = document.getElementById('snap-date').value;
    const value = parseFloat(document.getElementById('snap-value').value)||0;
    const note = document.getElementById('snap-note').value.trim();
    if(!date || value<=0) return;
    STATE.snapshots.push({ id: cryptoId('snap'), date, value, note });
    markDirty();
    document.getElementById('snap-value').value='';
    document.getElementById('snap-note').value='';
    refreshOverviewDerived();
    renderSnapList();
  });

  wireDataPortability();
  renderRules();
  document.getElementById('add-rule').addEventListener('click', ()=>{
    STATE.goldenRules.push({id:cryptoId('gr'), title:'New rule', body:''});
    markDirty();
    renderRules();
  });
  renderSnapList();
  refreshOverviewDerived();
}

/* ---------- export / restore ----------
   The plan lives in this browser (and, encrypted, in sync). Export gives you
   a file you hold yourself, restorable into any browser's copy of this page. */
function planFilename(){
  return 'ledger-plan-' + new Date().toISOString().slice(0,10) + '.json';
}
function downloadText(name, text, type){
  const blob = new Blob([text], {type: type || 'application/octet-stream'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
}
function exportPlan(){
  const msg = document.getElementById('data-msg');
  try{ downloadText(planFilename(), JSON.stringify(STATE, null, 2), 'application/json'); msg.textContent = 'Saved ' + planFilename() + ' to your downloads'; }
  catch(e){ msg.textContent = 'Could not save the file: ' + e.message; }
}

function wireDataPortability(){
  const ex = document.getElementById('data-export');
  if(ex) ex.addEventListener('click', exportPlan);
  const pr = document.getElementById('print-summary');
  if(pr) pr.addEventListener('click', printSummary);
  const sv = document.getElementById('save-summary');
  if(sv) sv.addEventListener('click', saveSummaryFile);
  const tog = document.getElementById('data-restore-toggle');
  if(tog) tog.addEventListener('click', ()=>{
    const out = document.getElementById('data-out');
    document.getElementById('data-msg').textContent = '';
    out.innerHTML = `
      <p style="font-size:13px;color:var(--ink-secondary);margin-top:12px;">
        Choose an exported plan file, or paste its contents below. Nothing changes until you confirm what it contains.
      </p>
      <input type="file" id="restore-file" accept=".json,application/json" style="margin-bottom:8px;font-size:13px;">
      <textarea id="restore-text" rows="5" style="width:100%;padding:10px 12px;border:1px solid var(--border);
        border-radius:8px;background:var(--surface-2);color:var(--ink);font-family:var(--font-mono);font-size:11.5px;"
        placeholder='{"v":2,...}'></textarea>
      <div class="corpus-actions" style="margin-top:10px;">
        <button class="reset-btn" id="restore-check">Check this file</button>
      </div>
      <div id="restore-preview"></div>`;
    document.getElementById('restore-file').addEventListener('change', e=>{
      const f = e.target.files && e.target.files[0];
      if(!f) return;
      const r = new FileReader();
      r.onload = ()=>{ document.getElementById('restore-text').value = String(r.result || ''); document.getElementById('restore-check').click(); };
      r.readAsText(f);
    });
    document.getElementById('restore-check').addEventListener('click', ()=>{
      const prev = document.getElementById('restore-preview');
      let s = null;
      try{ s = JSON.parse(document.getElementById('restore-text').value); }catch(e){ s = null; }
      if(!s || !Array.isArray(s.indiaFunds) || !s.indiaFunds.length){
        prev.innerHTML = `<div class="notice err" style="margin-top:12px;"><b>That isn't a plan file</b>
          It needs to be the JSON produced by Export — starting with <span class="num">{"v":2</span> and carrying a fund list.</div>`;
        return;
      }
      const nFunds = s.indiaFunds.length + (Array.isArray(s.usFunds) ? s.usFunds.length : 0);
      const sip = s.indiaFunds.concat(s.usFunds||[]).reduce((t,f)=>t+(Number(f.monthly)||0),0);
      prev.innerHTML = `<div class="notice warn" style="margin-top:12px;">
          <b>This will replace your current plan</b>
          ${nFunds} funds · ${fmtINR(sip)}/month · ${(s.snapshots||[]).length} check-ins ·
          ${(s.contribSnaps||[]).length} readings · ${(s.calendar||[]).length} calendar actions.
          Your present plan is overwritten and only recoverable from an export or an earlier saved version.
        </div>
        <div class="corpus-actions" style="margin-top:10px;">
          <button class="snap-add-btn" id="restore-go">Replace my plan with this</button>
        </div>`;
      document.getElementById('restore-go').addEventListener('click', ()=>{
        pushUndo('restoring a file');
        if(!s.plan && STATE.plan && !STATE.plan.starter) s.plan = STATE.plan;   // an older export: keep your plan's starting point
        STATE = s;
        usePlan(STATE.plan);
        migrateState();
        hydrateLiveFromState();
        markDirty();
        rerenderAll();
        document.getElementById('data-msg').textContent = 'Restored. Hit Save to keep it.';
      });
    });
  });
}

/* The rules you promise yourself. Free text, because what you swear off
   changes as the plan does — and a rule you can't edit is one you quietly
   stop believing instead of rewriting. */
function renderRules(){
  const wrap = document.getElementById('rules-list');
  if(!wrap) return;
  const count = document.getElementById('rules-count');
  if(count) count.textContent = STATE.goldenRules.length;
  wrap.innerHTML = STATE.goldenRules.map((r,i)=>`
    <div class="rule" data-rule="${r.id}">
      <div class="n num">${i+1}</div>
      <div class="rule-body">
        <input class="inline-input" data-rf="title" value="${escAttr(r.title||'')}" placeholder="The rule, in a few words">
        <textarea class="inline-input" data-rf="body" rows="2" placeholder="Why it matters — the reasoning you'll want to reread in a crash">${escAttr(r.body||'')}</textarea>
      </div>
      <button class="del-btn" data-delrule="${r.id}" aria-label="Remove rule">✕</button>
    </div>`).join('');
  wrap.querySelectorAll('[data-rule]').forEach(row=>{
    const r = STATE.goldenRules.filter(x=>x.id===row.dataset.rule)[0];
    if(!r) return;
    row.querySelectorAll('[data-rf]').forEach(inp=>{
      inp.addEventListener('input', ()=>{ r[inp.dataset.rf] = inp.value; markDirty(); });
    });
    const d = row.querySelector('[data-delrule]');
    if(d) d.addEventListener('click', ()=>{
      pushUndo('removing a golden rule');
      STATE.goldenRules = STATE.goldenRules.filter(x=>x.id !== d.dataset.delrule);
      markDirty();
      renderRules();
    });
  });
}

function renderSnapList(){
  const wrap = document.getElementById('snap-list');
  if(!wrap) return;
  const sorted = STATE.snapshots.slice().sort((a,b)=> new Date(a.date)-new Date(b.date));
  wrap.innerHTML = sorted.map(s=>{
    const hasInv = typeof s.invested === 'number' && s.invested > 0;
    const pl = hasInv ? s.value - s.invested : null;
    return `
    <div class="snap-item">
      <span class="sdate">${fmtDate(s.date)}</span>
      <span class="sval">${fmtCompact(s.value)}</span>
      <span class="snote">${hasInv
        ? `invested ${fmtCompact(s.invested)} · <span class="${pl>=0?'pnl-pos':'pnl-neg'}">P&amp;L ${(pl>=0?'+':'')+fmtCompact(pl)}</span>${s.note?' · '+s.note:''}`
        : (s.note||'')}</span>
      ${s.origin ? '<span class="sorigin">Starting point</span>' : `<button class="del-btn" data-snap="${s.id}" aria-label="Remove check-in">✕</button>`}
    </div>`;
  }).join('');
  wrap.querySelectorAll('[data-snap]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      pushUndo('removing a check-in');
      STATE.snapshots = STATE.snapshots.filter(s=>s.id!==btn.dataset.snap);
      markDirty();
      renderSnapList();
      refreshOverviewDerived();
    });
  });
}

/* The four headline cards: where the corpus is, what goes in each month,
   where that leads by retirement, and the next thing to do. */
function refreshHeadline(){
  const set = (id, v)=>{ const e = document.getElementById(id); if(e) e.textContent = v; };
  const snap = latestSnapshot();
  set('kpi-corpus', snap ? fmtCompact(snap.value) : '—');
  if(snap){
    const hasInv = typeof snap.invested === 'number' && snap.invested > 0;
    const gain = hasInv ? snap.value - snap.invested : null;
    set('kpi-corpus-sub', 'Check-in ' + fmtDate(snap.date) + (gain === null ? '' : ' · ' + (gain >= 0 ? '+' : '') + fmtCompact(gain) + ' gain'));
  } else set('kpi-corpus-sub', 'No check-in yet');
  set('kpi-sip', fmtINR(totalSIP()));
  set('kpi-sip-sub', STATE.salary ? fmtPct(totalSIP()/STATE.salary) + ' of salary · +' + fmtPct(STATE.stepUp, 0) + ' each April' : '');
  set('ov-retire', STATE.retireAge);
  set('ov-target', '₹' + STATE.targetLowCr + '–' + STATE.targetHighCr + ' Cr');
  const rows = computeProjection(defaultAssumptions());
  const end = rows[rows.length-1];
  set('kpi-proj-age', end.age);
  set('kpi-proj', fmtCompact(end.total));
  const st = document.getElementById('kpi-proj-state');
  if(st){
    const low = STATE.targetLowCr * 1e7;
    const onTrack = end.total >= low;
    st.className = 'state ' + (onTrack ? 'ok' : 'short');
    st.textContent = onTrack ? 'On track for the target' : fmtCompact(low - end.total) + ' short of target';
  }
  const next = STATE.calendar.filter(c=>!c.done).sort((a,b)=>(a.age-b.age)||(a.year-b.year))[0];
  set('kpi-next', next ? next.action : 'All actions done');
  set('kpi-next-sub', next ? 'Age ' + next.age + ' · ' + next.year + (next.fund ? ' · ' + next.fund : '') : '');
}

/* Refreshes everything on the Overview panel that depends on STATE
   but contains no input elements — safe to call on every keystroke. */
function refreshOverviewDerived(){
  renderTopbar();
  refreshHeadline();

  const flowItems = [
    {label:'Living Expenses', value: Math.max(0,livingExpenses()), color:CAT_COLORS[0]},
    {label:'Debt/Liquid MF', value: debtSIP(), color:CAT_COLORS[1]},
    {label:'India equity SIPs', value: sumFunds(indiaEquityFunds()), color:CAT_COLORS[2]},
    {label:'US ETFs', value: sumFunds(usEquityFunds()), color:CAT_COLORS[3]},
    {label:'Buffer / Sweep-in FD', value: STATE.buffer, color:CAT_COLORS[4]},
  ];
  const donutWrap = document.getElementById('flow-donut');
  if(donutWrap) donutWrap.innerHTML = donut(flowItems,{label:'Where each month of salary goes'}) + legendHTML(flowItems);

  const warnEl = document.getElementById('budget-warn');
  if(warnEl){
    warnEl.innerHTML = livingExpenses() < 0
      ? `<div class="warn-badge">⚠ Over budget by ${fmtINR(Math.abs(livingExpenses()))} — reduce SIP or buffer, or raise salary</div>`
      : '';
  }

  const statTiles = document.querySelectorAll('#panel-overview .stat-tile');
  if(statTiles[0]) statTiles[0].querySelector('.v').textContent = fmtINR(STATE.salary);
  if(statTiles[1]){ statTiles[1].querySelector('.v').textContent = fmtINR(totalSIP()); statTiles[1].querySelector('.sub').textContent = fmtPct(totalSIP()/STATE.salary) + ' of salary'; }
  if(statTiles[2]) statTiles[2].querySelector('.v').textContent = fmtINR(STATE.buffer);

  renderProgressChart();
}

function renderProgressChart(){
  const wrap = document.getElementById('chart-progress');
  if(!wrap) return;
  const now = new Date();
  const currentAge = ageAt(now);
  const baselineAge = ageAt(new Date(BASELINE.date));
  const retireAge = STATE.retireAge;
  const snap = latestSnapshot();
  const currentValue = snap ? snap.value : BASELINE.portfolioValue;

  const original = computeForwardProjection({
    startAge: baselineAge, startValue: BASELINE.portfolioValue,
    monthlySIP: sumFunds(BASELINE.indiaFunds)+sumFunds(BASELINE.usFunds),
    stepUp: BASELINE.stepUp, equityRate: BASELINE.equityRate, endAge: 50,
  });
  const projected = computeForwardProjection({
    startAge: currentAge, startValue: currentValue,
    monthlySIP: totalSIP(), stepUp: STATE.stepUp, equityRate: STATE.equityRate, endAge: retireAge,
  });
  /* The starting point predates the asset classes an import brings in — EPF,
     RSUs, NPS, FD were always yours but were never in that figure. Joining it
     to a post-import check-in draws a slope that is almost entirely accounting,
     so the origin is plotted but deliberately not connected. */
  const ordered = STATE.snapshots.slice().sort((a,b)=> new Date(a.date)-new Date(b.date));
  const toPt = s => ({age: ageAt(new Date(s.date)), value: s.value});
  const actual = ordered.filter(s=>!s.origin).map(toPt);
  const originPts = ordered.filter(s=>s.origin).map(toPt);

  const targetLow = STATE.targetLowCr*1e7, targetHigh = STATE.targetHighCr*1e7;
  const maxAge = Math.max(retireAge, 50);
  const minAge = baselineAge;
  const maxVal = Math.max(
    ...original.map(p=>p.value), ...projected.map(p=>p.value),
    ...actual.map(p=>p.value), ...originPts.map(p=>p.value), targetHigh
  ) * 1.05;

  const W=920,H=360,ML=70,MR=16,MT=16,MB=34;
  const plotW=W-ML-MR, plotH=H-MT-MB;
  const x = age => ML + ((age-minAge)/(maxAge-minAge))*plotW;
  const y = v => MT + plotH - (v/maxVal)*plotH;

  const gridVals=[0,0.25,0.5,0.75,1].map(f=>f*maxVal);
  const gridlines = gridVals.map(v=>`<line class="gridline" x1="${ML}" x2="${W-MR}" y1="${y(v)}" y2="${y(v)}"></line>
    <text class="axis-label" x="${ML-8}" y="${y(v)+4}" text-anchor="end">${fmtCompact(v)}</text>`).join('');

  const ageTicks = [];
  const step = Math.max(1, Math.round((maxAge-minAge)/8));
  for(let a=Math.ceil(minAge); a<=Math.floor(maxAge); a+=step) ageTicks.push(a);
  const xlabels = ageTicks.map(a=>`<text class="axis-label" x="${x(a)}" y="${H-MB+18}" text-anchor="middle">${a}</text>`).join('');

  const linePath = pts => 'M'+pts.map(p=>`${x(p.age)},${y(p.value)}`).join(' L');

  const targetBand = `<rect x="${ML}" y="${y(targetHigh)}" width="${plotW}" height="${Math.max(2,y(targetLow)-y(targetHigh))}" fill="var(--gold)" opacity="0.14"></rect>
    <text class="axis-label" x="${W-MR-4}" y="${y(targetHigh)-6}" text-anchor="end" style="fill:var(--gold-strong)">Target ₹${STATE.targetLowCr}–${STATE.targetHighCr} Cr</text>`;

  const todayX = x(currentAge);
  const todayLine = `<line x1="${todayX}" x2="${todayX}" y1="${MT}" y2="${MT+plotH}" stroke="var(--ink-muted)" stroke-dasharray="2 4" opacity="0.6"></line>`;

  const progressAlt = 'Corpus from age ' + minAge.toFixed(0) + ' to ' + maxAge
    + '. Latest check-in ' + fmtCompact(currentValue)
    + '; projected ' + fmtCompact(projected[projected.length-1].value) + ' by ' + retireAge
    + ', against a target band of ₹' + STATE.targetLowCr + '–' + STATE.targetHighCr + ' Cr.'
    + (originPts.length ? ' The starting point is plotted separately and not joined to the line.' : '');
  wrap.innerHTML = `
  <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escAttr(progressAlt)}">
    ${gridlines}
    ${targetBand}
    <path d="${linePath(original)}" fill="none" stroke="var(--ink-muted)" stroke-width="2" stroke-dasharray="1 5" stroke-linecap="round"></path>
    ${actual.length>1 ? `<path d="${linePath(actual)}" fill="none" stroke="var(--ink-secondary)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>` : ''}
    ${actual.map(p=>`<circle cx="${x(p.age)}" cy="${y(p.value)}" r="4" fill="var(--ink-secondary)" stroke="var(--surface)" stroke-width="1.5"></circle>`).join('')}
    ${originPts.map(p=>`<circle cx="${x(p.age)}" cy="${y(p.value)}" r="5" fill="none" stroke="var(--gold-strong)" stroke-width="2" stroke-dasharray="2 2"></circle>
      <text class="axis-label" x="${x(p.age)}" y="${y(p.value)-12}" text-anchor="middle" style="fill:var(--gold-strong);">start</text>`).join('')}
    <path d="${linePath(projected)}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-dasharray="7 5" stroke-linecap="round" stroke-linejoin="round"></path>
    ${todayLine}
    <circle cx="${todayX}" cy="${y(currentValue)}" r="5.5" fill="var(--gold)" stroke="var(--surface)" stroke-width="2"></circle>
    <text class="axis-label" x="${todayX}" y="${MT+12}" text-anchor="middle" style="fill:var(--gold-strong);font-weight:600;">Today</text>
    ${xlabels}
  </svg>`;
}

/* =========================================================
   PANEL: PORTFOLIO
   ========================================================= */
function fundRow(f, group){
  return `<tr data-id="${f.id}">
    <td class="name"><input class="inline-input" data-field="name" value="${escAttr(f.name)}"></td>
    <td><input class="inline-input num" type="number" step="500" data-field="monthly" value="${f.monthly}"></td>
    <td><input class="inline-input" data-field="cls" value="${escAttr(f.cls||'')}"></td>
    <td><input class="inline-input" data-field="geo" value="${escAttr(f.geo||'')}"></td>
    <td><input class="inline-input" data-field="role" value="${escAttr(f.role||'')}"></td>
    <td class="col-del"><button class="del-btn" data-del="${f.id}" data-group="${group}" aria-label="Remove fund">✕</button></td>
  </tr>`;
}
function escAttr(s){ return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

function renderPortfolio(){
  const el = document.getElementById('panel-portfolio');
  const geoItems = ()=>[
    {label:'India Equity', value: (STATE.indiaFunds.filter(f=>f.id!=='in-gold'&&f.id!=='in-btc'&&!isDebtFund(f)).reduce((s,f)=>s+(Number(f.monthly)||0),0)), color:CAT_COLORS[0]},
    {label:'US Equity', value: sumFunds(STATE.usFunds), color:CAT_COLORS[1]},
    {label:'Gold', value: (STATE.indiaFunds.find(f=>f.id==='in-gold')||{monthly:0}).monthly, color:CAT_COLORS[2]},
    {label:'Bitcoin', value: (STATE.indiaFunds.find(f=>f.id==='in-btc')||{monthly:0}).monthly, color:CAT_COLORS[3]},
    {label:'Debt/Liquid MF', value: debtSIP(), color:CAT_COLORS[4]},
  ];

  el.innerHTML = `
    <div class="panel-head">
      <h2>Portfolio — fully editable</h2>
      <p>Rename a fund, change its amount, or add a new one entirely. Everything else on this page recalculates from what's here.</p>
    </div>

    <section class="block">
      <div class="block-title">India SIPs</div>
      <div class="grid-2">
        <div class="table-wrap">
          <table>
            <thead><tr><th class="name">Fund</th><th>Monthly</th><th>Asset class</th><th>Geography</th><th>Role</th><th></th></tr></thead>
            <tbody id="india-tbody">${STATE.indiaFunds.map(f=>fundRow(f,'indiaFunds')).join('')}</tbody>
            <tfoot><tr><td>India subtotal</td><td class="num" id="india-subtotal">${fmtINR(sumFunds(STATE.indiaFunds))}</td><td colspan="4" class="num" id="india-subtotal-pct">${fmtPct(sumFunds(STATE.indiaFunds)/(totalSIP()||1))} of total SIP</td></tr></tfoot>
          </table>
          <div class="pad" style="padding-top:0;"><button class="add-row-btn" id="add-india">+ Add an India fund</button></div>
        </div>
        <div class="card pad">
          <div class="donut-row" id="india-donut" style="flex-direction:column;align-items:stretch;"></div>
        </div>
      </div>
    </section>

    <section class="block">
      <div class="block-title">US ETFs — via INDMoney, LRS route</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th class="name">ETF</th><th>Monthly</th><th>Expense</th><th>10yr CAGR</th><th>Category</th><th></th></tr></thead>
          <tbody id="us-tbody">
            ${STATE.usFunds.map(f=>`<tr data-id="${f.id}">
              <td class="name"><input class="inline-input" data-field="name" value="${escAttr(f.name)}"></td>
              <td><input class="inline-input num" type="number" step="500" data-field="monthly" value="${f.monthly}"></td>
              <td><input class="inline-input" data-field="expense" value="${escAttr(f.expense||'')}"></td>
              <td><input class="inline-input" data-field="cagr" value="${escAttr(f.cagr||'')}"></td>
              <td><input class="inline-input" data-field="cls" value="${escAttr(f.cls||'')}"></td>
              <td class="col-del"><button class="del-btn" data-del="${f.id}" data-group="usFunds" aria-label="Remove ETF">✕</button></td>
            </tr>`).join('')}
          </tbody>
          <tfoot><tr><td>US subtotal</td><td class="num" id="us-subtotal">${fmtINR(sumFunds(STATE.usFunds))}</td><td colspan="3" class="num" id="us-subtotal-pct">${fmtPct(sumFunds(STATE.usFunds)/(totalSIP()||1))} of total SIP</td></tr></tfoot>
        </table>
        <div class="pad" style="padding-top:0;"><button class="add-row-btn" id="add-us">+ Add a US ETF</button></div>
      </div>
    </section>

    <section class="block">
      <div class="block-title">Geography split — the total SIP</div>
      <div class="grid-2">
        <div class="card pad">
          <div class="donut-row" id="geo-donut"></div>
        </div>
        <div class="table-wrap" style="align-self:start;">
          <table>
            <thead><tr><th class="name">Instrument</th><th>Status</th><th>Reason</th><th></th></tr></thead>
            <tbody id="removed-tbody">
              ${STATE.removed.map(r=>`<tr data-rm="${r.id}">
                <td class="name"><input class="inline-input" data-rmf="name" value="${escAttr(r.name||'')}" placeholder="Instrument"></td>
                <td><input class="inline-input" data-rmf="status" value="${escAttr(r.status||'')}" placeholder="Removed / Moved / Stopped"></td>
                <td><input class="inline-input" data-rmf="reason" value="${escAttr(r.reason||'')}" placeholder="Why"></td>
                <td class="col-del"><button class="del-btn" data-delrm="${r.id}" aria-label="Remove row">✕</button></td>
              </tr>`).join('')}
            </tbody>
          </table>
          <div class="pad" style="padding-top:0;"><button class="add-row-btn" id="add-removed">+ Add an instrument</button></div>
        </div>
      </div>
    </section>
  `;

  function wireTable(tbody, group){
    tbody.querySelectorAll('input').forEach(input=>{
      const tr = input.closest('tr');
      const id = tr.dataset.id;
      const field = input.dataset.field;
      const isNumber = field==='monthly';
      bindFundField(input, group, id, field, isNumber);
    });
    tbody.querySelectorAll('[data-del]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const id = btn.dataset.del;
        const gone = (STATE[group].filter(f=>f.id===id)[0]||{}).name || 'fund';
        pushUndo('removing ' + gone);
        STATE[group] = STATE[group].filter(f=>f.id!==id);
        // the fund's glide path goes with it — otherwise it orphans in saved state
        if(STATE.phasePlan) delete STATE.phasePlan[id];
        markDirty();
        renderPortfolio();
        renderPhases();
        renderUS();          // a deleted ETF must lose its crash bars too
      });
    });
  }
  wireTable(document.getElementById('india-tbody'), 'indiaFunds');
  wireTable(document.getElementById('us-tbody'), 'usFunds');

  document.getElementById('removed-tbody').querySelectorAll('[data-rm]').forEach(row=>{
    const r = STATE.removed.filter(x=>x.id===row.dataset.rm)[0];
    if(!r) return;
    row.querySelectorAll('[data-rmf]').forEach(inp=>{
      inp.addEventListener('input', ()=>{ r[inp.dataset.rmf] = inp.value; markDirty(); });
    });
    const d = row.querySelector('[data-delrm]');
    if(d) d.addEventListener('click', ()=>{
      pushUndo('removing an instrument row');
      STATE.removed = STATE.removed.filter(x=>x.id !== d.dataset.delrm);
      markDirty();
      renderPortfolio();
    });
  });
  document.getElementById('add-removed').addEventListener('click', ()=>{
    STATE.removed.push({id:cryptoId('rm'), name:'New instrument', status:'Removed', reason:''});
    markDirty();
    renderPortfolio();
  });

  document.getElementById('add-india').addEventListener('click', ()=>{
    STATE.indiaFunds.push({id:cryptoId('in'), name:'New fund', monthly:1000, cls:'', geo:'India', role:''});
    markDirty();
    renderPortfolio();
  });
  document.getElementById('add-us').addEventListener('click', ()=>{
    STATE.usFunds.push({id:cryptoId('us'), name:'New ETF', monthly:1000, expense:'', cagr:'', cls:''});
    markDirty();
    renderPortfolio();
    renderUS();            // the new ETF picks up an empty bar in every crash
  });

  function refreshDonuts(){
    const indiaItems = indiaEquityFunds().map((f,i)=>({label:f.name.split(' (')[0], value:Number(f.monthly)||0, color:CAT_COLORS[i%8]}));
    /* Each donut names its own base — the India one divides by the India
       subtotal, the geography one by the whole SIP, and the Checks tab by
       the whole SIP again. Unlabelled, the same fund appears to disagree
       with itself across tabs. */
    document.getElementById('india-donut').innerHTML =
      `<div style="align-self:center;">${donut(indiaItems,{size:160,thickness:22,label:'India SIP split'})}</div>`
      + legendHTML(indiaItems)
      + `<p class="footnote">Share of the ${fmtINR(sumFunds(indiaEquityFunds()))} India <b>equity</b> SIP only —
         the debt/liquid MF is ballast, not an equity allocation, so it sits outside this donut though it is
         listed and edited in the table. Against the full ${fmtINR(totalSIP())} — the basis the Checks tab uses —
         each of these is smaller.</p>`;
    document.getElementById('geo-donut').innerHTML =
      donut(geoItems(),{size:160,thickness:22,label:'Geography split of the total SIP'}) + legendHTML(geoItems())
      + `<p class="footnote">Share of the full ${fmtINR(totalSIP())} monthly SIP, India and US together.</p>`;
  }
  refreshDonuts();
  window.__refreshPortfolioDonuts = refreshDonuts;
}

/* Recomputes subtotals/donuts without touching the input elements —
   safe to call from a fund-table keystroke handler. */
function refreshFundDerived(){
  const iSub = document.getElementById('india-subtotal');
  const uSub = document.getElementById('us-subtotal');
  if(iSub){
    iSub.textContent = fmtINR(sumFunds(STATE.indiaFunds));
    document.getElementById('india-subtotal-pct').textContent = fmtPct(sumFunds(STATE.indiaFunds)/(totalSIP()||1)) + ' of total SIP';
  }
  if(uSub){
    uSub.textContent = fmtINR(sumFunds(STATE.usFunds));
    document.getElementById('us-subtotal-pct').textContent = fmtPct(sumFunds(STATE.usFunds)/(totalSIP()||1)) + ' of total SIP';
  }
  if(window.__refreshPortfolioDonuts) window.__refreshPortfolioDonuts();
  renderTopbar();
}

/* =========================================================
   PANEL: PHASES
   ========================================================= */
function phaseRows(){
  const funds = STATE.indiaFunds.concat(STATE.usFunds);
  const rows = funds.map(f=>{
    if(!STATE.phasePlan[f.id]) STATE.phasePlan[f.id] = {cols:['','','','',''], note:''};
    const p = STATE.phasePlan[f.id];
    if(!Array.isArray(p.cols)) p.cols = ['','','','',''];
    while(p.cols.length < 5) p.cols.push('');
    return {key:f.id, kind:'fund', name:f.name, monthly:f.monthly, plan:p};
  });
  STATE.phaseExtras.forEach(x=>{
    if(!Array.isArray(x.cols)) x.cols = ['','','','',''];
    while(x.cols.length < 5) x.cols.push('');
    rows.push({key:x.id, kind:'extra', name:x.name, plan:x});
  });
  return rows;
}

function renderPhases(){
  const el = document.getElementById('panel-phases');
  const rows = phaseRows();
  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Phase-wise SIP plan</h2>
        <p>Every fund on your Portfolio tab appears here automatically — add one there and its row shows up, ready to fill in. Every cell here is editable, including the column headings.</p>
      </div>
    </div>
    <div class="table-wrap">
      <table class="phase-table">
        <thead>
          <tr>
            <th class="name">Fund / instrument</th>
            ${STATE.phaseHeads.map((h,i)=>`<th class="age-col"><input class="inline-input head-input" data-head="${i}" value="${escAttr(h)}"></th>`).join('')}
            <th style="min-width:200px;">Notes</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="phase-tbody">
          ${rows.map(r=>`<tr data-key="${r.key}" data-kind="${r.kind}">
            <td class="name">
              ${r.kind === 'fund'
                ? `${r.name}<div class="recon-sub">${fmtINR(r.monthly)}/mo · from Portfolio</div>`
                : `<input class="inline-input" data-x="name" value="${escAttr(r.name)}">`}
            </td>
            ${r.plan.cols.map((c,i)=>`<td><input class="inline-input" data-col="${i}" value="${escAttr(c)}"></td>`).join('')}
            <td><input class="inline-input" data-note="1" value="${escAttr(r.plan.note || '')}"></td>
            <td class="col-del">${r.kind === 'extra' ? `<button class="del-btn" data-delx="${r.key}" aria-label="Remove row">✕</button>` : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div class="pad" style="padding-top:0;">
        <button class="add-row-btn" id="add-phase">+ Add a non-SIP row (BAF, FD ladder, EPF…)</button>
      </div>
    </div>
    <p class="footnote">Fund rows are driven by the Portfolio tab — rename or remove a fund there and it changes here. Rows you add here are standalone, for instruments that aren't monthly SIPs.</p>
  `;

  const tb = document.getElementById('phase-tbody');
  tb.querySelectorAll('tr').forEach(tr=>{
    const key = tr.dataset.key, kind = tr.dataset.kind;
    const target = (kind === 'fund')
      ? STATE.phasePlan[key]
      : STATE.phaseExtras.filter(x=>x.id===key)[0];
    if(!target) return;
    tr.querySelectorAll('input').forEach(inp=>{
      inp.addEventListener('input', ()=>{
        if(inp.dataset.col !== undefined) target.cols[Number(inp.dataset.col)] = inp.value;
        else if(inp.dataset.note !== undefined) target.note = inp.value;
        else if(inp.dataset.x === 'name') target.name = inp.value;
        markDirty();
      });
    });
    const del = tr.querySelector('[data-delx]');
    if(del) del.addEventListener('click', ()=>{
      pushUndo('removing a phase row');
      STATE.phaseExtras = STATE.phaseExtras.filter(x=>x.id !== del.dataset.delx);
      markDirty();
      renderPhases();
    });
  });

  el.querySelectorAll('[data-head]').forEach(inp=>{
    inp.addEventListener('input', ()=>{
      STATE.phaseHeads[Number(inp.dataset.head)] = inp.value;
      markDirty();
    });
  });

  document.getElementById('add-phase').addEventListener('click', ()=>{
    STATE.phaseExtras.push({id:cryptoId('px'), name:'New instrument', cols:['','','','',''], note:''});
    markDirty();
    renderPhases();
  });
}

/* =========================================================
   PANEL: PROJECTION (interactive what-if, defaults from STATE)
   ========================================================= */
let projAssumptions = null;
/* The toggle lives in STATE, not a module variable — otherwise reading the
   projection in today's money is undone by every reload and every save. */
function todayMoney(){ return !!STATE.projTodayMoney; }

function defaultAssumptions(){
  const b = startingBuckets();
  return {
    existing: b.equity, existingFd: b.fd, existingPpf: b.ppf, existingFlat: b.flat,
    splitKnown: b.split,
    baseSIP: equitySIP(),
    ppfMonthly: debtSIP(),
    stepUp: STATE.stepUp,
    equityRate: STATE.equityRate,
    ppfRate: STATE.ppfRate,
    fdRate: STATE.fdRate,
    startAge: 34,
    endAge: Math.max(35, Math.round(STATE.retireAge)),
  };
}

function renderProjection(){
  const el = document.getElementById('panel-projection');
  const snap = latestSnapshot();
  projAssumptions = defaultAssumptions();

  el.innerHTML = `
    <div class="panel-head">
      <h2>Year-by-year projection</h2>
      <p>The workbook's own compounding formula, on its original 34→50 schedule, defaulted to your current numbers. Adjust further here to explore scenarios — these sliders don't change your saved plan.</p>
    </div>

    <div class="card pad">
      <div class="controls">
        <div class="control">
          <label>Starting equity <span class="val num" id="lbl-existing"></span></label>
          <input type="number" id="in-existing" step="1000" min="0">
          <div class="hint">Stocks, MF, gold, crypto — what compounds</div>
        </div>
        <div class="control">
          <label>Fixed deposits <span class="val num" id="lbl-fd"></span></label>
          <input type="number" id="in-fd" step="1000" min="0">
          <div class="hint">Grown at the rate they were booked at</div>
        </div>
        <div class="control">
          <label>FD return <span class="val num" id="lbl-fdrate"></span></label>
          <input type="range" id="in-fdrate" min="0.04" max="0.10" step="0.001">
          <div class="hint">Whatever rate you locked in</div>
        </div>
        <div class="control">
          <label>EPF / NPS <span class="val num" id="lbl-flat"></span></label>
          <input type="number" id="in-flat" step="1000" min="0">
          <div class="hint">Carried flat — no rate assumed for these</div>
        </div>
        <div class="control">
          <label>Annual step-up <span class="val num" id="lbl-stepup"></span></label>
          <input type="range" id="in-stepup" min="0" max="0.20" step="0.01">
          <div class="hint">Every April, on all SIPs</div>
        </div>
        <div class="control">
          <label>Equity XIRR <span class="val num" id="lbl-equity"></span></label>
          <input type="range" id="in-equity" min="0.06" max="0.18" step="0.005">
          <div class="hint">12% conservative · 14% bull case</div>
        </div>
        <div class="control">
          <label>Debt/Liquid MF return <span class="val num" id="lbl-ppf"></span></label>
          <input type="range" id="in-ppf" min="0.04" max="0.09" step="0.001">
          <div class="hint">6–7% is typical for liquid and short-duration funds</div>
        </div>
      </div>
      <div class="corpus-actions" style="margin-top:14px;">
        <button class="reset-btn" id="btn-reset">Reset to your current numbers</button>
        <label style="font-size:12.5px;color:var(--ink);cursor:pointer;display:inline-flex;align-items:center;gap:7px;">
          <input type="checkbox" id="in-today"> Show in today's money
        </label>
        <span style="font-size:12px;color:var(--ink-muted);" id="proj-basis"></span>
      </div>
    </div>

    <div id="proj-note"></div>
    <div class="result-row" id="result-row"></div>

    <div class="card pad">
      <div class="block-title" style="margin-bottom:16px;" id="chart-main-title">Corpus by bucket</div>
      <div class="chart-wrap" id="chart-main"></div>
      <div class="chart-legend">
        <div class="item"><span class="sw" style="background:var(--cat-blue)"></span>Equity corpus</div>
        <div class="item"><span class="sw" style="background:var(--cat-green)"></span>Debt/Liquid MF corpus</div>
        <div class="item"><span class="sw" style="background:var(--cat-yellow)"></span>EPF / NPS / FD</div>
      </div>
    </div>

    <div class="card pad" style="margin-top:18px;">
      <div class="block-title" style="margin-bottom:16px;">Monthly income if retired at this age (4% safe withdrawal rate)</div>
      <div class="chart-wrap" id="chart-income"></div>
    </div>

    <div class="table-wrap" style="margin-top:18px;">
      <table id="proj-table">
        <thead><tr><th>Age</th><th>Year</th><th>Phase</th><th>Monthly SIP</th><th>Equity corpus</th><th>Debt/Liquid MF</th><th>EPF / NPS / FD</th><th>Total corpus</th><th>Monthly income @4%</th></tr></thead>
        <tbody></tbody>
      </table>
    </div>
  `;

  const inExisting = document.getElementById('in-existing');
  const inFd = document.getElementById('in-fd');
  const inFdRate = document.getElementById('in-fdrate');
  const inFlat = document.getElementById('in-flat');
  const inStepup = document.getElementById('in-stepup');
  const inEquity = document.getElementById('in-equity');
  const inPpf = document.getElementById('in-ppf');
  const inToday = document.getElementById('in-today');

  function syncInputs(){
    inExisting.value = Math.round(projAssumptions.existing);
    inFd.value = Math.round(projAssumptions.existingFd || 0);
    inFdRate.value = projAssumptions.fdRate;
    inFlat.value = Math.round(projAssumptions.existingFlat || 0);
    inStepup.value = projAssumptions.stepUp;
    inEquity.value = projAssumptions.equityRate;
    inPpf.value = projAssumptions.ppfRate;
    inToday.checked = todayMoney();
    document.getElementById('lbl-existing').textContent = fmtCompact(projAssumptions.existing);
    document.getElementById('lbl-fd').textContent = fmtCompact(projAssumptions.existingFd||0);
    document.getElementById('lbl-fdrate').textContent = fmtPct(projAssumptions.fdRate,1);
    document.getElementById('lbl-flat').textContent = fmtCompact(projAssumptions.existingFlat||0);
    document.getElementById('lbl-stepup').textContent = fmtPct(projAssumptions.stepUp,0);
    document.getElementById('lbl-equity').textContent = fmtPct(projAssumptions.equityRate,1);
    document.getElementById('lbl-ppf').textContent = fmtPct(projAssumptions.ppfRate,1);
    const basis = document.getElementById('proj-basis');
    if(basis) basis.textContent = todayMoney()
      ? 'Every figure below is deflated at ' + fmtPct(STATE.inflation) + ' a year.'
      : 'Figures below are in future rupees, to age ' + projAssumptions.endAge + '.';
  }
  syncInputs();

  function recalc(){
    const rows = computeProjection(projAssumptions);
    const t = document.getElementById('chart-main-title');
    if(t) t.textContent = 'Corpus by bucket, age ' + projAssumptions.startAge + ' → ' + projAssumptions.endAge;
    const nt = document.getElementById('proj-note');
    if(nt) nt.innerHTML = (projAssumptions.existingFlat > 0)
      ? `<div class="notice info" style="margin-top:14px;"><b>${fmtCompact(projAssumptions.existingFlat)} of EPF and NPS is carried flat</b>
         Neither has a rate you can state from the import — a total gain figure isn't an annual return without knowing how long
         the money has been in. They're held at today's value rather than grown at an invented rate, so the corpus below is
         conservative by whatever those two actually earn. Equity, the debt/liquid MF and FD each compound at their own rate.</div>`
      : '';
    renderProjectionResults(rows);
    renderMainChart(rows);
    renderIncomeChart(rows);
    renderProjTable(rows);
  }

  inExisting.addEventListener('input', ()=>{ projAssumptions.existing = Number(inExisting.value)||0; syncInputs(); recalc(); });
  inFd.addEventListener('input', ()=>{ projAssumptions.existingFd = Number(inFd.value)||0; syncInputs(); recalc(); });
  inFdRate.addEventListener('input', ()=>{ projAssumptions.fdRate = Number(inFdRate.value); syncInputs(); recalc(); });
  inFlat.addEventListener('input', ()=>{ projAssumptions.existingFlat = Number(inFlat.value)||0; syncInputs(); recalc(); });
  inToday.addEventListener('change', ()=>{
    STATE.projTodayMoney = inToday.checked;
    markDirty();                      // remembered with the rest of the plan
    syncInputs(); recalc();
  });
  inStepup.addEventListener('input', ()=>{ projAssumptions.stepUp = Number(inStepup.value); syncInputs(); recalc(); });
  inEquity.addEventListener('input', ()=>{ projAssumptions.equityRate = Number(inEquity.value); syncInputs(); recalc(); });
  inPpf.addEventListener('input', ()=>{ projAssumptions.ppfRate = Number(inPpf.value); syncInputs(); recalc(); });
  document.getElementById('btn-reset').addEventListener('click', ()=>{
    projAssumptions = defaultAssumptions();
    syncInputs(); recalc();
  });

  recalc();
}

function renderProjectionResults(rows){
  const retire = rows[rows.length-1];
  const endAge = retire.age;
  const mid = rows[Math.floor(rows.length/2)] || rows[0];
  const last = rows[rows.length-2] || retire;
  const yearsOut = Math.max(0, endAge - ageAt(new Date()));
  const adj = v => todayMoney() ? deflate(v, yearsOut, STATE.inflation) : v;
  const tax = afterTax(retire, {ltcgRate: STATE.ltcgRate});
  const el = document.getElementById('result-row');
  const tiles = [
    {l:'Corpus at retirement ('+endAge+')', v:fmtCompact(adj(retire.total)),
     s:'equity '+fmtCompact(adj(retire.equity))+' · debt/liquid MF '+fmtCompact(adj(retire.ppf))+' · EPF/NPS/FD '+fmtCompact(adj(retire.debt))},
    {l:'Monthly income @ 4%', v:fmtINR(adj(tax.gross)), s:'before tax'},
    {l:'After LTCG tax', v:fmtINR(adj(tax.net)),
     s:'−'+fmtINR(adj(tax.tax))+'/mo · '+fmtPct(tax.gainFrac)+' of the corpus is gain'},
    {l:'Final monthly SIP (age '+last.age+')', v:fmtINR(last.monthlySIP||0),
     s:'corpus at '+mid.age+': '+fmtCompact(adj(mid.total))},
  ];
  el.innerHTML = tiles.map(t=>`<div class="card stat-tile"><div class="l">${t.l}</div><div class="v num">${t.v}</div>${t.s?`<div class="sub">${t.s}</div>`:''}</div>`).join('');
}

function renderProjTable(rows){
  const tb = document.querySelector('#proj-table tbody');
  const now = ageAt(new Date());
  const adj = (v,age) => todayMoney() ? deflate(v, Math.max(0, age-now), STATE.inflation) : v;
  tb.innerHTML = rows.map(r=>`<tr>
    <td class="num">${r.age}</td><td class="num">${r.year}</td><td>${r.phase}</td>
    <td class="amt">${r.monthlySIP===null?'Stopped':fmtINR(r.monthlySIP)}</td>
    <td class="amt">${fmtCompact(adj(r.equity,r.age))}</td>
    <td class="amt">${fmtCompact(adj(r.ppf,r.age))}</td>
    <td class="amt">${fmtCompact(adj(r.debt,r.age))}</td>
    <td class="amt" style="font-weight:700;color:var(--ink);">${fmtCompact(adj(r.total,r.age))}</td>
    <td class="amt">${fmtINR(adj(r.income,r.age))}</td>
  </tr>`).join('');
}

function renderMainChart(rows){
  const wrap = document.getElementById('chart-main');
  const W=920,H=340,ML=64,MR=16,MT=16,MB=34;
  const plotW = W-ML-MR, plotH = H-MT-MB;
  const maxTotal = Math.max(...rows.map(r=>r.total));
  const x = i => ML + (i/(rows.length-1))*plotW;
  const y = v => MT + plotH - (v/maxTotal)*plotH;

  const debtPoints  = rows.map((r,i)=>[x(i), y(r.debt)]);
  const ppfPoints   = rows.map((r,i)=>[x(i), y(r.debt + r.ppf)]);
  const totalPoints = rows.map((r,i)=>[x(i), y(r.total)]);
  const baseline = y(0);

  const path = (pts)=> 'M'+pts.map(p=>p.join(',')).join(' L');
  const areaPath = (pts)=> `M${ML},${baseline} L` + pts.map(p=>p.join(',')).join(' L') + ` L${x(rows.length-1)},${baseline} Z`;
  const bandPath = (bottom,top)=> `M` + bottom.map(p=>p.join(',')).join(' L') + ' L' + top.slice().reverse().map(p=>p.join(',')).join(' L') + ' Z';

  const gridVals = [0,0.25,0.5,0.75,1].map(f=>f*maxTotal);
  const gridlines = gridVals.map(v=>`<line class="gridline" x1="${ML}" x2="${W-MR}" y1="${y(v)}" y2="${y(v)}"></line>
    <text class="axis-label" x="${ML-8}" y="${y(v)+4}" text-anchor="end">${fmtCompact(v)}</text>`).join('');

  const xlabels = rows.map((r,i)=> (i%2===0) ? `<text class="axis-label" x="${x(i)}" y="${H-MB+18}" text-anchor="middle">${r.age}</text>` : '').join('');

  const end = rows[rows.length-1];
  const mainAlt = 'Corpus by bucket from age ' + rows[0].age + ' to ' + end.age
    + ', ending at ' + fmtCompact(end.total) + ' — equity ' + fmtCompact(end.equity)
    + ', debt/liquid MF ' + fmtCompact(end.ppf) + ', EPF/NPS/FD ' + fmtCompact(end.debt)
    + '. The table below carries every year.';
  const svg = `
  <svg class="chart" viewBox="0 0 ${W} ${H}" id="svg-main" role="img" aria-label="${escAttr(mainAlt)}">
    ${gridlines}
    <path d="${areaPath(debtPoints)}" fill="var(--cat-yellow)" opacity="0.35"></path>
    <path d="${bandPath(debtPoints, ppfPoints)}" fill="var(--cat-green)" opacity="0.35"></path>
    <path d="${bandPath(ppfPoints, totalPoints)}" fill="var(--cat-blue)" opacity="0.35"></path>
    <path d="${path(debtPoints)}" fill="none" stroke="var(--cat-yellow)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
    <path d="${path(ppfPoints)}" fill="none" stroke="var(--cat-green)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
    <path d="${path(totalPoints)}" fill="none" stroke="var(--cat-blue)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
    ${xlabels}
    <line class="crosshair" id="main-crosshair" x1="0" x2="0" y1="${MT}" y2="${MT+plotH}"></line>
    <circle class="hover-dot" id="dot-total" r="4.5" fill="var(--cat-blue)" stroke="var(--surface)" stroke-width="2"></circle>
    <circle class="hover-dot" id="dot-ppf" r="4.5" fill="var(--cat-green)" stroke="var(--surface)" stroke-width="2"></circle>
    <rect class="overlay-rect" x="${ML}" y="${MT}" width="${plotW}" height="${plotH}" id="main-overlay"></rect>
  </svg>`;
  wrap.innerHTML = svg;

  const overlay = document.getElementById('main-overlay');
  const crosshair = document.getElementById('main-crosshair');
  const dotTotal = document.getElementById('dot-total');
  const dotPpf = document.getElementById('dot-ppf');
  const svgEl = document.getElementById('svg-main');

  function pointerMove(clientX, clientY){
    const rect = svgEl.getBoundingClientRect();
    const relX = ((clientX-rect.left)/rect.width)*W;
    let idx = Math.round(((relX-ML)/plotW)*(rows.length-1));
    idx = Math.max(0, Math.min(rows.length-1, idx));
    const r = rows[idx];
    crosshair.style.opacity = 1;
    crosshair.setAttribute('x1', x(idx)); crosshair.setAttribute('x2', x(idx));
    dotTotal.style.opacity = 1; dotTotal.setAttribute('cx', x(idx)); dotTotal.setAttribute('cy', y(r.total));
    dotPpf.style.opacity = 1; dotPpf.setAttribute('cx', x(idx)); dotPpf.setAttribute('cy', y(r.ppf));
    const milestone = MILESTONES[r.age] ? `<div class="tt-note">${MILESTONES[r.age]}</div>` : '';
    showTooltip(clientX, clientY, `
      <div class="tt-title">Age ${r.age} · ${r.year}</div>
      <div class="tt-row"><span>Total corpus</span><span class="num">${fmtCompact(r.total)}</span></div>
      <div class="tt-row"><span>Equity</span><span class="num">${fmtCompact(r.equity)}</span></div>
      <div class="tt-row"><span>Debt/Liquid MF</span><span class="num">${fmtCompact(r.ppf)}</span></div>
      <div class="tt-row"><span>EPF / NPS / FD</span><span class="num">${fmtCompact(r.debt)}</span></div>
      <div class="tt-row"><span>Monthly SIP</span><span class="num">${r.monthlySIP===null?'Stopped':fmtINR(r.monthlySIP)}</span></div>
      ${milestone}
    `);
  }
  overlay.addEventListener('mousemove', e=>pointerMove(e.clientX, e.clientY));
  overlay.addEventListener('mouseleave', ()=>{ crosshair.style.opacity=0; dotTotal.style.opacity=0; dotPpf.style.opacity=0; hideTooltip(); });
  overlay.addEventListener('touchmove', e=>{ const t=e.touches[0]; pointerMove(t.clientX,t.clientY); }, {passive:true});
}

function renderIncomeChart(rows){
  const wrap = document.getElementById('chart-income');
  const W=920,H=180,ML=64,MR=16,MT=14,MB=30;
  const plotW=W-ML-MR, plotH=H-MT-MB;
  const maxV = Math.max(...rows.map(r=>r.income));
  const x = i => ML + (i/(rows.length-1))*plotW;
  const y = v => MT+plotH-(v/maxV)*plotH;
  const pts = rows.map((r,i)=>[x(i), y(r.income)]);
  const baseline = y(0);
  const areaPath = `M${ML},${baseline} L` + pts.map(p=>p.join(',')).join(' L') + ` L${x(rows.length-1)},${baseline} Z`;
  const linePath = 'M'+pts.map(p=>p.join(',')).join(' L');
  const gridVals=[0,0.5,1].map(f=>f*maxV);
  const gridlines = gridVals.map(v=>`<line class="gridline" x1="${ML}" x2="${W-MR}" y1="${y(v)}" y2="${y(v)}"></line>
    <text class="axis-label" x="${ML-8}" y="${y(v)+4}" text-anchor="end">${fmtCompact(v)}</text>`).join('');
  const xlabels = rows.map((r,i)=> (i%2===0) ? `<text class="axis-label" x="${x(i)}" y="${H-MB+18}" text-anchor="middle">${r.age}</text>` : '').join('');

  const incAlt = 'Monthly income at a 4% withdrawal rate, rising from '
    + fmtINR(rows[0].income) + ' at age ' + rows[0].age + ' to '
    + fmtINR(rows[rows.length-1].income) + ' at ' + rows[rows.length-1].age + '.';
  wrap.innerHTML = `
  <svg class="chart" viewBox="0 0 ${W} ${H}" id="svg-income" role="img" aria-label="${escAttr(incAlt)}">
    ${gridlines}
    <path d="${areaPath}" fill="var(--gold)" opacity="0.22"></path>
    <path d="${linePath}" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
    ${xlabels}
    <line class="crosshair" id="inc-crosshair" x1="0" x2="0" y1="${MT}" y2="${MT+plotH}"></line>
    <circle class="hover-dot" id="dot-income" r="4.5" fill="var(--gold)" stroke="var(--surface)" stroke-width="2"></circle>
    <rect class="overlay-rect" x="${ML}" y="${MT}" width="${plotW}" height="${plotH}" id="inc-overlay"></rect>
  </svg>`;

  const overlay = document.getElementById('inc-overlay');
  const crosshair = document.getElementById('inc-crosshair');
  const dot = document.getElementById('dot-income');
  const svgEl = document.getElementById('svg-income');
  function pointerMove(clientX, clientY){
    const rect = svgEl.getBoundingClientRect();
    const relX = ((clientX-rect.left)/rect.width)*W;
    let idx = Math.round(((relX-ML)/plotW)*(rows.length-1));
    idx = Math.max(0, Math.min(rows.length-1, idx));
    const r = rows[idx];
    crosshair.style.opacity=1; crosshair.setAttribute('x1',x(idx)); crosshair.setAttribute('x2',x(idx));
    dot.style.opacity=1; dot.setAttribute('cx',x(idx)); dot.setAttribute('cy',y(r.income));
    showTooltip(clientX, clientY, `
      <div class="tt-title">Age ${r.age} · ${r.year}</div>
      <div class="tt-row"><span>Monthly income @4%</span><span class="num">${fmtINR(r.income)}</span></div>
    `);
  }
  overlay.addEventListener('mousemove', e=>pointerMove(e.clientX,e.clientY));
  overlay.addEventListener('mouseleave', ()=>{ crosshair.style.opacity=0; dot.style.opacity=0; hideTooltip(); });
  overlay.addEventListener('touchmove', e=>{ const t=e.touches[0]; pointerMove(t.clientX,t.clientY); }, {passive:true});
}

/* =========================================================
   PANEL: ACTION CALENDAR
   ========================================================= */
const PRIORITIES = [
  {v:'critical', l:'Critical / Now'},
  {v:'warning',  l:'Review'},
  {v:'good',     l:'Routine / April'},
  {v:'gold',     l:'Retire / Bonus'},
];
const editingCal = new Set();
let calFilter = 'all';

function calItemHTML(c){
  if(editingCal.has(c.id)){
    return `<div class="action-item editing" data-pr="${c.pr}" data-id="${c.id}">
      <div class="action-body cal-edit">
        <div class="cal-edit-grid">
          <div><label>Age</label><input type="number" data-f="age" value="${c.age}"></div>
          <div><label>Year</label><input type="number" data-f="year" value="${c.year}"></div>
          <div><label>Priority</label><select data-f="pr">${PRIORITIES.map(p=>`<option value="${p.v}"${p.v===c.pr?' selected':''}>${p.l}</option>`).join('')}</select></div>
          <div><label>Badge</label><input data-f="label" value="${escAttr(c.label)}"></div>
        </div>
        <label>Action</label><input data-f="action" value="${escAttr(c.action)}">
        <label>Fund / instrument</label><input data-f="fund" value="${escAttr(c.fund)}">
        <label>Why</label><input data-f="why" value="${escAttr(c.why)}">
        <label>How</label><input data-f="how" value="${escAttr(c.how)}">
        <div class="cal-edit-actions">
          <button class="snap-add-btn" data-doneedit="${c.id}">Done editing</button>
          <button class="del-btn wide" data-delcal="${c.id}">Delete this action</button>
        </div>
      </div>
    </div>`;
  }
  return `<div class="action-item ${c.done?'done':''}" data-pr="${c.pr}" data-id="${c.id}">
    <input type="checkbox" data-chk="${c.id}"${c.done?' checked':''} aria-label="Mark done">
    <div class="action-body">
      <div class="action-title">${c.action}</div>
      ${c.fund ? `<div class="action-fund">${c.fund}</div>` : ''}
      ${c.why ? `<div class="action-why">${c.why}</div>` : ''}
      ${c.how ? `<div class="action-how">${c.how}</div>` : ''}
    </div>
    <span class="pill ${c.pr}"><span class="dot"></span>${c.label}</span>
    <button class="del-btn" data-edit="${c.id}" title="Edit this action" aria-label="Edit">✎</button>
  </div>`;
}

function renderCalendar(){
  const el = document.getElementById('panel-calendar');
  const now = new Date();
  const items = STATE.calendar.slice().sort((a,b)=> (a.age - b.age) || (a.year - b.year));
  const upcoming = items.filter(c=>!c.done)[0];
  const doneCount = items.filter(c=>c.done).length;

  const groups = {};
  items.forEach(c=>{ (groups[c.age] = groups[c.age] || []).push(c); });
  const ages = Object.keys(groups).map(Number).sort((a,b)=>a-b);

  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Action calendar</h2>
        <p>Every action from today to retirement. Tick them off, edit any of them with ✎, or add your own — it all saves with the rest of your plan.</p>
      </div>
      <button class="refresh-btn" id="add-action">+ Add an action</button>
    </div>

    ${upcoming ? `<div class="card now-card">
      <span class="badge">Next up</span>
      <p><b>${upcoming.action}</b> — age ${upcoming.age}, ${upcoming.year}. ${upcoming.why || ''}</p>
    </div>` : ''}

    ${stepUpCardHTML()}

    <div class="filter-row" id="filter-row">
      <button class="filter-chip" data-f="all" aria-pressed="${calFilter==='all'}">All <span class="num">${items.length}</span></button>
      ${PRIORITIES.map(p=>`<button class="filter-chip" data-f="${p.v}" aria-pressed="${calFilter===p.v}">${p.l} <span class="num">${items.filter(c=>c.pr===p.v).length}</span></button>`).join('')}
      <button class="filter-chip" data-f="open" aria-pressed="${calFilter==='open'}">Not done <span class="num">${items.length-doneCount}</span></button>
    </div>

    <div id="calendar-groups">
      ${ages.map(age=>{
        const g = groups[age];
        return `<div class="year-group" data-age="${age}">
          <div class="year-group-head"><span class="age num">${age}</span><span class="yr num">${g[0].year}</span></div>
          <div class="action-list">${g.map(calItemHTML).join('')}</div>
        </div>`;
      }).join('')}
    </div>
    <p class="footnote">${doneCount} of ${items.length} done.</p>
  `;

  function byId(id){ return STATE.calendar.filter(c=>c.id===id)[0]; }

  el.querySelectorAll('[data-chk]').forEach(cb=>{
    cb.addEventListener('change', ()=>{
      const c = byId(cb.dataset.chk);
      if(!c) return;
      c.done = cb.checked;
      markDirty();
      renderCalendar();
    });
  });
  el.querySelectorAll('[data-edit]').forEach(b=>{
    b.addEventListener('click', ()=>{ editingCal.add(b.dataset.edit); renderCalendar(); });
  });
  el.querySelectorAll('[data-doneedit]').forEach(b=>{
    b.addEventListener('click', ()=>{ editingCal.delete(b.dataset.doneedit); renderCalendar(); });
  });
  el.querySelectorAll('[data-delcal]').forEach(b=>{
    b.addEventListener('click', ()=>{
      pushUndo('deleting an action');
      STATE.calendar = STATE.calendar.filter(c=>c.id !== b.dataset.delcal);
      editingCal.delete(b.dataset.delcal);
      markDirty();
      renderCalendar();
    });
  });
  el.querySelectorAll('.action-item.editing').forEach(row=>{
    const c = byId(row.dataset.id);
    if(!c) return;
    row.querySelectorAll('[data-f]').forEach(inp=>{
      inp.addEventListener('input', ()=>{
        const f = inp.dataset.f;
        c[f] = (f === 'age' || f === 'year') ? (parseInt(inp.value,10) || 0) : inp.value;
        markDirty();
      });
    });
  });

  const suBtn = document.getElementById('stepup-apply');
  if(suBtn) suBtn.addEventListener('click', ()=>{
    const before = totalSIP();
    pushUndo('the step-up');
    applyStepUp();
    renderPortfolio(); renderPhases(); renderOverview(); renderChecks(); renderCalendar();
    flashSaveStatus('SIPs stepped up — ' + fmtINR(before) + ' → ' + fmtINR(totalSIP()) + '. Hit Save to keep it.');
  });

  document.getElementById('add-action').addEventListener('click', ()=>{
    const item = {
      id: cryptoId('cal'),
      age: Math.floor(ageAt(new Date())),
      year: new Date().getFullYear(),
      pr:'critical', label:'New', action:'New action', fund:'', why:'', how:'', done:false,
    };
    STATE.calendar.push(item);
    editingCal.add(item.id);
    markDirty();
    renderCalendar();
  });

  el.querySelectorAll('.filter-chip').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      calFilter = btn.dataset.f;
      el.querySelectorAll('.filter-chip').forEach(b=>b.setAttribute('aria-pressed', b===btn?'true':'false'));
      el.querySelectorAll('.action-item').forEach(item=>{
        const c = byId(item.dataset.id);
        const show = calFilter === 'all' ? true
          : calFilter === 'open' ? (c && !c.done)
          : item.dataset.pr === calFilter;
        item.style.display = show ? 'flex' : 'none';
      });
      el.querySelectorAll('.year-group').forEach(g=>{
        const any = Array.prototype.slice.call(g.querySelectorAll('.action-item')).some(it=>it.style.display !== 'none');
        g.style.display = any ? 'block' : 'none';
      });
    });
  });
}

/* =========================================================
   PANEL: US ETF STRATEGY
   ========================================================= */
/* "VOO — Vanguard S&P 500" -> "VOO". The short label the crash chart needs,
   derived rather than stored, so renaming a fund renames its bar. */
function fundTicker(f){
  const first = String(f.name||'').split('\u2014')[0].trim().split(/\s+/)[0] || '';
  return first.toUpperCase().replace(/[^A-Z0-9.]/g,'').slice(0,8) || 'ETF';
}

/* Crash drawdowns pasted back from a Claude chat. No market data can be fetched
   here — the artifact sandbox blocks every network call — so this is the route
   that actually works: ask in a normal chat, paste the JSON in. Tolerant of
   code fences, prose around the JSON, and several shapes of key. */
function parsePastedCrashes(text){
  const out = [];
  const byTicker = {};
  (STATE.usFunds||[]).forEach(f=>{ byTicker[fundTicker(f)] = f.id; });
  function visit(v, depth){
    if(!v || depth > 8) return;
    if(typeof v === 'string'){ const q = tryParseJSON(v); if(q !== undefined) visit(q, depth+1); return; }
    if(Array.isArray(v)){ v.forEach(x=>visit(x, depth+1)); return; }
    if(typeof v !== 'object') return;
    const name  = v.event || v.crash || v.name || v.title;
    const draws = v.drawdowns || v.drawdown || v.draw || v.returns;
    if(name && draws && typeof draws === 'object' && !Array.isArray(draws)){
      const d = {}; const unknown = [];
      Object.keys(draws).forEach(k=>{
        const t = String(k).toUpperCase().trim();
        const n = parseIndianNumber(draws[k]);
        if(byTicker[t] && n !== null) d[byTicker[t]] = Math.round(n);
        else if(n !== null) unknown.push(t);
      });
      if(Object.keys(d).length || unknown.length){
        out.push({name:String(name), dur:String(v.duration||v.dur||''),
                  cause:String(v.cause||v.reason||''), draw:d, unknown:unknown});
      }
      return;
    }
    Object.keys(v).forEach(k=>visit(v[k], depth+1));
  }
  extractJsonBlobs(text).forEach(b=>visit(b, 0));
  return out;
}

function renderUS(){
  const el = document.getElementById('panel-us');
  const funds = STATE.usFunds;
  const events = STATE.crashEvents;

  /* Bars scale to the worst drawdown actually recorded, with a floor so a
     half-filled table doesn't render every bar at 100%. */
  const mags = [];
  events.forEach(ev=>funds.forEach(f=>{
    const v = ev.draw ? ev.draw[f.id] : null;
    if(typeof v === 'number') mags.push(Math.abs(v));
  }));
  const maxAbs = Math.max(40, ...mags);
  const tickers = funds.map(fundTicker).join(', ') || 'your ETFs';

  el.innerHTML = `
    <div class="panel-head">
      <h2>US ETF strategy — ${funds.map(fundTicker).join(' + ') || 'no ETFs yet'}</h2>
      <p>SCHD fell only −6% when QQQ fell −33% in the 2022 crash. SCHD is the US portfolio's crash insurance — sized equal to VOO, ahead of QQQ.</p>
    </div>

    <section class="block">
      <div class="block-title">Your US ETF SIPs</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th class="name">ETF</th><th>Monthly</th><th>Expense</th><th>10yr CAGR</th><th>Category</th><th>Why</th></tr></thead>
          <tbody>
            ${funds.map(f=>`<tr>
              <td class="name">${f.name}${f.hero?'<span class="tag-hero">★ crash king</span>':''}</td>
              <td class="amt">${fmtINR(f.monthly)}</td><td class="num">${f.expense||'—'}</td><td class="num">${f.cagr||'—'}</td>
              <td>${f.cls||'—'}</td><td style="min-width:220px;">${f.why||''}</td>
            </tr>`).join('')}
          </tbody>
          <tfoot><tr><td>US subtotal</td><td>${fmtINR(sumFunds(STATE.usFunds))}</td><td colspan="4">${fmtPct(sumFunds(STATE.usFunds)/(totalSIP()||1))} of total SIP</td></tr></tfoot>
        </table>
      </div>
      <p class="footnote">Add or remove an ETF on the Portfolio tab — it appears here, and picks up an empty bar in every crash below.</p>
    </section>

    <section class="block">
      <div class="block-title">Crash performance — ${funds.length} ETF${funds.length===1?'':'s'}</div>
      <div class="card pad">
        ${events.length ? events.map(ev=>`
          <div class="crash-event" data-crash="${ev.id}">
            <div class="crash-event-head">
              <span class="name">
                <input class="inline-input" data-cf="name" value="${escAttr(ev.name)}" placeholder="Crash" style="font-weight:600;min-width:150px;width:auto;">
                <input class="inline-input num" data-cf="dur" value="${escAttr(ev.dur||'')}" placeholder="duration" style="width:90px;color:var(--ink-muted);">
              </span>
              <span class="cause" style="display:flex;align-items:center;gap:6px;">
                <input class="inline-input" data-cf="cause" value="${escAttr(ev.cause||'')}" placeholder="cause" style="text-align:right;min-width:130px;">
                <button class="del-btn" data-delcrash="${ev.id}" aria-label="Remove this crash">✕</button>
              </span>
            </div>
            <div class="crash-bars">
              ${funds.length ? funds.map(f=>{
                const v = (ev.draw && typeof ev.draw[f.id] === 'number') ? ev.draw[f.id] : null;
                const w = (v === null) ? 0 : Math.min(100,(Math.abs(v)/maxAbs)*100);
                return `<div class="crash-bar-row ${f.hero?'hero':''}">
                  <span class="lbl">${fundTicker(f)}</span>
                  <div class="crash-bar-track">${v===null ? '' :
                    `<div class="crash-bar-fill" style="width:${w}%;background:${f.hero?'var(--gold)':'var(--ink-muted)'}"></div>`}</div>
                  <input class="inline-input num crash-pct" type="number" step="1" max="0"
                         data-crashpct="${f.id}" value="${v===null?'':v}" placeholder="—"
                         aria-label="${escAttr(fundTicker(f) + ' drawdown in ' + ev.name)}">
                </div>`;
              }).join('') : '<p class="footnote">No US ETFs in the plan yet.</p>'}
            </div>
          </div>
        `).join('') : `<div class="notice info"><b>No crashes recorded</b>Add one below, or paste a set in from a Claude chat.</div>`}
        <button class="add-row-btn" id="add-crash">+ Add a crash</button>
      </div>

      <details class="import-box" id="crash-import">
        <summary>Fill these in from a Claude chat</summary>
        <div class="import-body">
          <p><b>This page cannot fetch market data.</b> It runs in a sandbox with every network call
             blocked, so nothing here can look a drawdown up on its own. What does work is the same
             route the holdings import uses — ask in any Claude chat and paste the answer back:</p>
          <div class="ask-line">What was the maximum peak-to-trough drawdown for ${tickers} in the 2000 dot-com, 2008 financial, 2020 COVID and 2022 rate-hike crashes? Answer as raw JSON: [{"event":"","duration":"","cause":"","drawdowns":{"TICKER":-00}}]</div>
          <p>Use <code>null</code> for an ETF that did not exist yet — SCHD only launched in 2011, so it
             has no dot-com figure, and inventing one would be worse than leaving it blank.</p>
          <textarea id="crash-import-text" rows="5" placeholder='Paste the JSON reply here'></textarea>
          <div class="corpus-actions" style="margin-top:10px;">
            <button class="reset-btn" id="crash-import-check">Check what this contains</button>
            <span id="crash-import-msg" style="font-size:12px;color:var(--ink-muted);"></span>
          </div>
          <div id="crash-import-preview"></div>
        </div>
      </details>
      <p class="footnote">Percentages are drawdowns, so they are negative. Blank means not recorded —
         the bar is left empty rather than drawn at zero, which would read as "came through unharmed".</p>
    </section>

    <section class="block">
      <div class="block-title">Why SCHD ≥ QQQ is the right call</div>
      <div class="reason-grid">
        ${REASONS.map(r=>`<div class="card pad reason-card"><h4>${r.h}</h4><p>${r.p}</p></div>`).join('')}
      </div>
    </section>
  `;

  function byId(id){ return STATE.crashEvents.filter(c=>c.id===id)[0]; }

  el.querySelectorAll('[data-crash]').forEach(row=>{
    const ev = byId(row.dataset.crash);
    if(!ev) return;
    row.querySelectorAll('[data-cf]').forEach(inp=>{
      inp.addEventListener('input', ()=>{ ev[inp.dataset.cf] = inp.value; markDirty(); });
    });
    /* Only the bar widths are redrawn on a keystroke — re-rendering the panel
       would tear the focus out of the field being typed into. */
    row.querySelectorAll('[data-crashpct]').forEach(inp=>{
      inp.addEventListener('input', ()=>{
        if(!ev.draw) ev.draw = {};
        const raw = inp.value.trim();
        if(raw === '') delete ev.draw[inp.dataset.crashpct];
        else ev.draw[inp.dataset.crashpct] = Math.round(parseFloat(raw) || 0);
        markDirty();
        refreshCrashBars();
      });
    });
    const d = row.querySelector('[data-delcrash]');
    if(d) d.addEventListener('click', ()=>{
      pushUndo('removing a crash');
      STATE.crashEvents = STATE.crashEvents.filter(c=>c.id !== d.dataset.delcrash);
      markDirty(); renderUS();
    });
  });

  const addC = document.getElementById('add-crash');
  if(addC) addC.addEventListener('click', ()=>{
    STATE.crashEvents.push({id:cryptoId('cr'), name:'New crash', dur:'', cause:'', draw:{}});
    markDirty(); renderUS();
  });

  wireCrashImport();
}

/* Redraws every bar against a freshly computed scale, touching no input. */
function refreshCrashBars(){
  const panel = document.getElementById('panel-us');
  if(!panel) return;
  const funds = STATE.usFunds;
  const mags = [];
  STATE.crashEvents.forEach(ev=>funds.forEach(f=>{
    const v = ev.draw ? ev.draw[f.id] : null;
    if(typeof v === 'number') mags.push(Math.abs(v));
  }));
  const maxAbs = Math.max(40, ...mags);
  panel.querySelectorAll('[data-crash]').forEach(row=>{
    const ev = STATE.crashEvents.filter(c=>c.id===row.dataset.crash)[0];
    if(!ev) return;
    row.querySelectorAll('.crash-bar-row').forEach((bar,i)=>{
      const f = funds[i];
      if(!f) return;
      const v = (ev.draw && typeof ev.draw[f.id] === 'number') ? ev.draw[f.id] : null;
      const track = bar.querySelector('.crash-bar-track');
      if(!track) return;
      if(v === null){ track.innerHTML = ''; return; }
      const w = Math.min(100,(Math.abs(v)/maxAbs)*100);
      track.innerHTML = '<div class="crash-bar-fill" style="width:' + w + '%;background:'
        + (f.hero ? 'var(--gold)' : 'var(--ink-muted)') + '"></div>';
    });
  });
}

function wireCrashImport(){
  const btn = document.getElementById('crash-import-check');
  if(!btn) return;
  btn.addEventListener('click', ()=>{
    const raw = (document.getElementById('crash-import-text').value || '').trim();
    const msg = document.getElementById('crash-import-msg');
    const prev = document.getElementById('crash-import-preview');
    if(!raw){ msg.textContent = 'Paste something first.'; prev.innerHTML = ''; return; }
    msg.textContent = '';
    let found = [];
    try{ found = parsePastedCrashes(raw); }catch(e){ found = []; }
    if(!found.length){
      prev.innerHTML = `<div class="notice err" style="margin-top:12px;"><b>Nothing recognised in that</b>
        Each entry needs a name (<span class="num">event</span>) and a
        <span class="num">drawdowns</span> object keyed by ticker — for example
        <span class="num">{"event":"2022 Rate Hike","drawdowns":{"VOO":-18}}</span>.
        Ask for raw JSON rather than a table, and paste the whole reply.</div>`;
      return;
    }
    const known = {};
    STATE.usFunds.forEach(f=>{ known[f.id] = fundTicker(f); });
    const strays = {};
    found.forEach(e=>(e.unknown||[]).forEach(t=>{ strays[t] = 1; }));
    const strayList = Object.keys(strays);
    prev.innerHTML = `
      <div class="notice ok" style="margin-top:12px;">
        <b>Found ${found.length} crash${found.length===1?'':'es'}</b>
        ${found.map(e=>e.name + ' (' + Object.keys(e.draw).map(k=>known[k]).join(', ') + ')').join(' · ')}
      </div>
      ${strayList.length ? `<div class="notice warn" style="margin-top:10px;">
        <b>${strayList.length} ticker${strayList.length===1?'':'s'} not in your plan</b>
        ${strayList.join(', ')} — these are ignored. Add the ETF on the Portfolio tab first if you want its figures.</div>` : ''}
      <div class="table-wrap" style="margin-top:12px;">
        <table>
          <thead><tr><th class="name">Crash</th>${STATE.usFunds.map(f=>`<th>${fundTicker(f)}</th>`).join('')}</tr></thead>
          <tbody>
            ${found.map(e=>`<tr>
              <td class="name">${e.name}<div class="recon-sub">${[e.dur,e.cause].filter(Boolean).join(' · ')||'&nbsp;'}</div></td>
              ${STATE.usFunds.map(f=>`<td class="amt">${typeof e.draw[f.id]==='number' ? e.draw[f.id]+'%' : '—'}</td>`).join('')}
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="corpus-actions" style="margin-top:12px;">
        <button class="snap-add-btn" id="crash-import-commit">Merge these in</button>
        <span style="font-size:12px;color:var(--ink-muted);">Matches on the crash name — an existing one is updated, a new one is added. Nothing is deleted.</span>
      </div>`;
    const go = document.getElementById('crash-import-commit');
    if(go) go.addEventListener('click', ()=>{
      pushUndo('importing crash data');
      found.forEach(e=>{
        const hit = STATE.crashEvents.filter(c=>norm(c.name) === norm(e.name))[0];
        if(hit){
          hit.draw = Object.assign({}, hit.draw || {}, e.draw);
          if(e.dur)   hit.dur = e.dur;
          if(e.cause) hit.cause = e.cause;
        } else {
          STATE.crashEvents.push({id:cryptoId('cr'), name:e.name, dur:e.dur, cause:e.cause, draw:e.draw});
        }
      });
      markDirty();
      renderUS();
      flashSaveStatus('Crash data merged. Hit Save to keep it.');
    });
  });
}

/* =========================================================
   PANEL: RETIREMENT
   ========================================================= */
function renderRetirement(){
  const el = document.getElementById('panel-retirement');
  const seqSteps = ['var(--seq-250)','var(--seq-350)','var(--seq-450)','var(--seq-550)','var(--seq-650)'];
  const layers = STATE.layers;
  const swp = STATE.swp;
  const maxMid = Math.max(1, ...layers.map(l=>Math.sqrt(Math.max(0, Number(l.mid)||0))));
  const step = i => seqSteps[i % seqSteps.length];

  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>${layers.length}-layer retirement withdrawal</h2>
        <p>Activates at retirement. Never sell equity during a crash — each layer funds the one below it. The last layer stays untouched for 7+ years. Every field here is editable.</p>
      </div>
    </div>

    <section class="block">
      <div class="layers" id="layers-list">
        ${layers.map((l,i)=>{
          const w = Math.max(18, (Math.sqrt(Math.max(0, Number(l.mid)||0))/maxMid)*100);
          return `<div class="layer-row" data-layer="${l.id}">
            <div class="layer-meta">
              <span class="n num">Layer ${i+1}</span>
              <input class="inline-input" data-lf="name" value="${escAttr(l.name||'')}" placeholder="Name">
              <button class="del-btn" data-dellayer="${l.id}" aria-label="Remove layer" style="align-self:flex-start;margin-top:6px;">✕</button>
            </div>
            <div class="layer-bar-card" style="border-color:${step(i)};">
              <div class="layer-bar-bg" style="width:${w}%;background:${step(i)};"></div>
              <div class="layer-top">
                <input class="inline-input" data-lf="instrument" value="${escAttr(l.instrument||'')}" placeholder="Instrument" style="flex:1 1 55%;font-weight:600;">
                <input class="inline-input num" data-lf="target" value="${escAttr(l.target||'')}" placeholder="Target" style="flex:0 1 150px;text-align:right;font-weight:700;">
              </div>
              <div class="layer-detail">
                <div style="flex:1 1 190px;"><b>Covers</b><input class="inline-input" data-lf="covers" value="${escAttr(l.covers||'')}"></div>
                <div style="flex:1 1 190px;"><b>Refill source</b><input class="inline-input" data-lf="refill" value="${escAttr(l.refill||'')}"></div>
                <div style="flex:0 1 140px;"><b>Bar scale ₹</b><input class="inline-input num" type="number" step="100000" data-lf="mid" value="${Number(l.mid)||0}"></div>
              </div>
              <input class="inline-input" data-lf="rule" value="${escAttr(l.rule||'')}" placeholder="The rule for this layer" style="font-style:italic;">
            </div>
          </div>`;
        }).join('')}
      </div>
      <button class="add-row-btn" id="add-layer">+ Add a layer</button>
      <p class="footnote">“Bar scale ₹” is the midpoint of the target in rupees. It sizes the bar only — nothing else reads it — so a rough figure is fine.</p>
    </section>

    <section class="block">
      <div class="block-title">SWP income scenarios — 4% safe withdrawal rate</div>
      <div class="card pad">
        <div style="display:flex;flex-direction:column;gap:12px;" id="swp-bars"></div>
      </div>
      <div class="table-wrap" style="margin-top:14px;">
        <table>
          <thead><tr><th class="name">Scenario</th><th>Corpus</th><th>Monthly income</th><th>Expenses*</th><th>Surplus</th><th></th></tr></thead>
          <tbody id="swp-tbody">
            ${swp.map(x=>`<tr data-swp="${x.id}">
              <td class="name"><input class="inline-input" data-sf="name" value="${escAttr(x.name||'')}" placeholder="Scenario"></td>
              <td><input class="inline-input" data-sf="corpus" value="${escAttr(x.corpus||'')}" placeholder="e.g. ₹6.0 Cr"></td>
              <td><input class="inline-input num" type="number" step="5000" data-sf="monthly" value="${Number(x.monthly)||0}"></td>
              <td><input class="inline-input num" type="number" step="1000" data-sf="expenses" value="${Number(x.expenses)||0}"></td>
              <td class="amt swp-surplus" style="font-weight:700;"></td>
              <td class="col-del"><button class="del-btn" data-delswp="${x.id}" aria-label="Remove scenario">✕</button></td>
            </tr>`).join('')}
          </tbody>
        </table>
        <div class="pad" style="padding-top:0;"><button class="add-row-btn" id="add-swp">+ Add a scenario</button></div>
      </div>
      <p style="margin-top:12px;font-size:12px;color:var(--ink-muted);">* Today's ₹50,000/month expenses, at 6% inflation for 16 years, become ≈₹1,27,000/month at retirement. Surplus is income less expenses, computed — it can't go stale.</p>
    </section>
  `;

  el.querySelectorAll('[data-layer]').forEach(row=>{
    const l = STATE.layers.filter(x=>x.id===row.dataset.layer)[0];
    if(!l) return;
    row.querySelectorAll('[data-lf]').forEach(inp=>{
      inp.addEventListener('input', ()=>{
        const f = inp.dataset.lf;
        l[f] = (f === 'mid') ? (parseFloat(inp.value)||0) : inp.value;
        markDirty();
        if(f === 'mid') refreshLayerBars();
      });
    });
    const d = row.querySelector('[data-dellayer]');
    if(d) d.addEventListener('click', ()=>{
      pushUndo('removing a retirement layer');
      STATE.layers = STATE.layers.filter(x=>x.id !== d.dataset.dellayer);
      markDirty(); renderRetirement();
    });
  });
  const addL = document.getElementById('add-layer');
  if(addL) addL.addEventListener('click', ()=>{
    STATE.layers.push({id:cryptoId('ly'), name:'New layer', instrument:'', target:'',
      mid:1000000, covers:'', refill:'', rule:''});
    markDirty(); renderRetirement();
  });

  el.querySelectorAll('[data-swp]').forEach(row=>{
    const x = STATE.swp.filter(y=>y.id===row.dataset.swp)[0];
    if(!x) return;
    row.querySelectorAll('[data-sf]').forEach(inp=>{
      inp.addEventListener('input', ()=>{
        const f = inp.dataset.sf;
        x[f] = (f === 'monthly' || f === 'expenses') ? (parseFloat(inp.value)||0) : inp.value;
        markDirty();
        refreshSwpDerived();
      });
    });
    const d = row.querySelector('[data-delswp]');
    if(d) d.addEventListener('click', ()=>{
      pushUndo('removing an SWP scenario');
      STATE.swp = STATE.swp.filter(y=>y.id !== d.dataset.delswp);
      markDirty(); renderRetirement();
    });
  });
  const addS = document.getElementById('add-swp');
  if(addS) addS.addEventListener('click', ()=>{
    STATE.swp.push({id:cryptoId('sw'), name:'New scenario', corpus:'', monthly:0, expenses:(STATE.swp[0] || {}).expenses || 0});
    markDirty(); renderRetirement();
  });

  refreshLayerBars();
  refreshSwpDerived();
}

/* Both refreshers redraw only derived output — never an input — so they are
   safe to call on every keystroke. */
function refreshLayerBars(){
  const wrap = document.getElementById('layers-list');
  if(!wrap) return;
  const maxMid = Math.max(1, ...STATE.layers.map(l=>Math.sqrt(Math.max(0, Number(l.mid)||0))));
  wrap.querySelectorAll('[data-layer]').forEach(row=>{
    const l = STATE.layers.filter(x=>x.id===row.dataset.layer)[0];
    const bg = row.querySelector('.layer-bar-bg');
    if(!l || !bg) return;
    bg.style.width = Math.max(18, (Math.sqrt(Math.max(0, Number(l.mid)||0))/maxMid)*100) + '%';
  });
}
function refreshSwpDerived(){
  const seqSteps = ['var(--seq-250)','var(--seq-350)','var(--seq-450)','var(--seq-550)','var(--seq-650)'];
  const maxMonthly = Math.max(1, ...STATE.swp.map(x=>Number(x.monthly)||0));
  const bars = document.getElementById('swp-bars');
  if(bars){
    bars.innerHTML = STATE.swp.map((x,i)=>`
      <div>
        <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:4px;">
          <span style="color:var(--ink);font-weight:600;">${x.name||'—'} ${x.corpus?`<span style="color:var(--ink-muted);font-weight:400;">· corpus ${x.corpus}</span>`:''}</span>
          <span class="num" style="font-weight:700;">${fmtINR(Number(x.monthly)||0)}/mo</span>
        </div>
        <div class="crash-bar-track"><div class="crash-bar-fill" style="width:${((Number(x.monthly)||0)/maxMonthly)*100}%;background:${seqSteps[i % seqSteps.length]};"></div></div>
      </div>`).join('');
  }
  const tb = document.getElementById('swp-tbody');
  if(tb) tb.querySelectorAll('[data-swp]').forEach(row=>{
    const x = STATE.swp.filter(y=>y.id===row.dataset.swp)[0];
    const cell = row.querySelector('.swp-surplus');
    if(!x || !cell) return;
    const surplus = (Number(x.monthly)||0) - (Number(x.expenses)||0);
    cell.textContent = fmtINR(surplus);
    cell.style.color = surplus >= 0 ? 'var(--good)' : 'var(--critical)';
  });
}

/* =========================================================
   PANEL: IMPORT PORTFOLIO — built entirely from pasted JSON.
   Groww and INDmoney schemas both parse; nothing is fetched.
   ========================================================= */

const ASSET_LABELS = {
  EPF:'EPF', VEHICLE:'Vehicle', ESOPS_RSUS:'ESOPs / RSUs', PHYSICAL_GOLD:'Physical Gold',
  STOCK:'Indian Stocks & ETFs', IND_STOCK:'Indian Stocks & ETFs', NPS:'NPS', MF:'Mutual Funds',
  US_STOCK:'US Stocks & ETFs', US_STOCK_WALLET:'US Wallet (cash)', BOND:'Bonds', FD:'Fixed Deposits',
  SA:'Savings', CRYPTO:'Crypto', PPF:'PPF', RD:'Recurring Deposit', AIF:'AIF', PMS:'PMS',
  INSURANCE:'Insurance', RE:'Real Estate',
};
function assetLabel(t){ return ASSET_LABELS[t] || String(t||'').replace(/_/g,' '); }

/* Asset types that are not part of the retirement corpus by default. */
function corpusExclude(){
  if(!Array.isArray(STATE.corpusExclude)) STATE.corpusExclude = ['VEHICLE'];
  return STATE.corpusExclude;
}

/* Name hints for reconciling planned funds against live holding names —
   these instruments are listed under longer or renamed titles upstream. */
/* MATCH_ALIASES comes with the plan (usePlan). */

function norm(s){
  return String(s||'').toLowerCase().replace(/&/g,' and ')
    .replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}
function fundAliases(f){
  const list = [];
  if(Array.isArray(f.aliases)) list.push.apply(list, f.aliases);
  if(MATCH_ALIASES[f.id]) list.push.apply(list, MATCH_ALIASES[f.id]);
  const base = String(f.name||'').replace(/\(.*?\)/g,' ').split('—')[0];
  list.push(base);
  return list.map(norm).filter(a=>a.length>3);
}
function matchesFund(f, holdingName){
  const h = norm(holdingName);
  if(h.length<=3) return false;
  return fundAliases(f).some(a => h.indexOf(a) !== -1 || a.indexOf(h) !== -1);
}

const LIVE = {
  status:'empty', snapshot:null,
  holdings:{ MF:[], STOCK:[], US_STOCK:[] },
};



function allLiveHoldings(){
  const out = [];
  ['MF','STOCK','US_STOCK'].forEach(k=>{
    (LIVE.holdings[k] || []).forEach(h=>{
      const row = {}; for(const p in h) row[p]=h[p];
      row.__section = k;
      out.push(row);
    });
  });
  // Manually-tracked assets join as pseudo-holdings, so a planned fund like
  // Bitcoin can match one and stop reading as "Not found".
  manualAssets().forEach(m=>{
    out.push({
      investment_code: manualKey(m),
      investment: m.name || 'Manual holding',
      market_value: Number(m.current) || 0,
      invested_amount: (typeof m.invested === 'number') ? m.invested : null,
      total_units: 0,
      unit_price: 0,
      broker: 'Tracked by hand',
      __section: 'MANUAL',
      __manualSource: true,
      __tracksUnits: false,
    });
  });
  return out;
}

function reconcilePlan(){
  const holdings = allLiveHoldings();
  const planned = STATE.indiaFunds.concat(STATE.usFunds);
  const claimed = new Set();
  const rows = planned.map(f=>{
    const matches = [];
    holdings.forEach((h,i)=>{
      if(claimed.has(i)) return;
      if(matchesFund(f, h.investment)){ claimed.add(i); matches.push(h); }
    });
    let value = 0, invested = 0, hasInvested = false;
    matches.forEach(m=>{
      value += Number(m.market_value) || 0;
      if(typeof m.invested_amount === 'number'){ invested += m.invested_amount; hasInvested = true; }
    });
    return {fund:f, matches, value, invested, hasInvested};
  });
  const extras = holdings.filter((h,i)=>!claimed.has(i));
  return {rows, extras};
}

function corpusFigure(){
  const inv = (LIVE.snapshot && Array.isArray(LIVE.snapshot.investments)) ? LIVE.snapshot.investments : [];
  const ex = corpusExclude();
  let total = 0;
  inv.forEach(a=>{ if(ex.indexOf(a.asset_type) === -1) total += Number(a.current_value)||0; });
  manualAssets().forEach(m=>{ if(ex.indexOf(manualKey(m)) === -1) total += Number(m.current)||0; });
  return total;
}

/* ---------- cost basis: API value, else what you entered, else unknown ----------
   Returned as {value, source} where source is 'api' | 'manual' | null. Keeping
   the source lets the UI show a real P&L without ever passing an estimate off
   as a reported figure. */
function holdingInvested(h){
  // Manually-tracked assets carry their own figure and are always "yours".
  if(h.__manualSource){
    return (typeof h.invested_amount === 'number')
      ? {value: h.invested_amount, source:'manual'}
      : {value: null, source: null};
  }
  const code = String(h.investment_code || h.investment);
  const man = STATE.costBasis.holdings[code];
  if(typeof man === 'number') return {value: man, source:'manual'};   // your correction wins
  if(typeof h.invested_amount === 'number' && h.invested_amount > 0){
    return {value: h.invested_amount, source:'api'};
  }
  return {value: null, source: null};
}
function assetInvested(a){
  const man = STATE.costBasis.assets[a.asset_type];
  if(typeof man === 'number') return {value: man, source:'manual'};   // your correction wins
  const api = Number(a.invested_value) || 0;
  if(api > 0) return {value: api, source:'api'};
  return {value: null, source: null};
}
function setHoldingCost(code, v){
  if(v === '' || v === null || isNaN(v)) delete STATE.costBasis.holdings[code];
  else STATE.costBasis.holdings[code] = Number(v);
  markDirty();
}
function setAssetCost(type, v){
  if(v === '' || v === null || isNaN(v)) delete STATE.costBasis.assets[type];
  else STATE.costBasis.assets[type] = Number(v);
  markDirty();
}

/* Corpus-level invested + P&L, honouring the asset-type selection above.
   `unknown` lists the types still missing a cost basis, so the UI can say
   the P&L is partial rather than quietly understating it. */
/* Asset types INDmoney also returns holding-by-holding. For these the cost
   basis is summed from the rows — otherwise a per-holding value you entered
   (every Groww ETF is edited that way) would never reach this total, and the
   P&L would be overstated by exactly the amount you had just filled in. */
const DETAILED_TYPES = {MF:'MF', STOCK:'STOCK', US_STOCK:'US_STOCK'};

/* THE resolver for an asset class's cost basis. Every caller must use this,
   not assetInvested() directly: for classes INDmoney returns row detail on,
   the cost lives per holding, so an asset-level lookup silently reports
   nothing even when every row has been filled in. */
function assetInvestedResolved(a){
  const section = DETAILED_TYPES[a.asset_type];
  // Only sum row-by-row when rows actually exist; with none, the snapshot's
  // own figure is the best available and must not be discarded.
  if(section && Array.isArray(LIVE.holdings[section]) && LIVE.holdings[section].length){
    let sum = 0, any = false, missing = false, anyManual = false;
    LIVE.holdings[section].forEach(h=>{
      const r = holdingInvested(h);
      if(r.value === null){ missing = true; return; }
      sum += r.value; any = true;
      if(r.source === 'manual') anyManual = true;
    });
    if(!any) return {value:null, source:null, partial:missing};
    return {value:sum, source: anyManual ? 'manual' : 'api', partial:missing};
  }
  const r = assetInvested(a);
  return {value:r.value, source:r.source, partial:false};
}

function manualAssets(){
  if(!Array.isArray(STATE.manualAssets)) STATE.manualAssets = [];
  return STATE.manualAssets;
}
function manualKey(m){ return 'MANUAL:' + m.id; }

/* ---------- imported holdings are the source of truth ----------
   They persist in the saved plan, so the page is fully populated on
   load with no connector and no re-pasting. */
function importedHoldings(){
  if(!Array.isArray(STATE.importedHoldings)) STATE.importedHoldings = [];
  return STATE.importedHoldings;
}
function hydrateLiveFromState(){
  LIVE.holdings = {MF:[], STOCK:[], US_STOCK:[]};
  importedHoldings().forEach(h=>{
    const s = h.__section || 'STOCK';
    if(!LIVE.holdings[s]) LIVE.holdings[s] = [];
    LIVE.holdings[s].push(h);
  });
  // Anything you entered by hand counts on its own — Bitcoin alone, with nothing
  // imported yet, still deserves the full page rather than the empty-state notice.
  LIVE.status = (importedHoldings().length
    || (STATE.importedSnapshot && (STATE.importedSnapshot.rows||[]).length)
    || manualAssets().length) ? 'ready' : 'empty';
  /* The net-worth tile reads total_networth, so it has to be computed here or
     it renders ₹0. Summing the classes (rather than trusting the imported
     total) lets Bitcoin and anything else tracked by hand count toward it. */
  const inv = derivedInvestments();
  let nw = 0;
  inv.forEach(a=>{ nw += Number(a.current_value) || 0; });
  manualAssets().forEach(m=>{ nw += Number(m.current) || 0; });
  LIVE.snapshot = {investments: inv, total_networth: nw};
}
/* Asset classes are computed from the holdings themselves rather than a
   separate net-worth call — one less thing to fetch or paste. */
function derivedInvestments(){
  const snap = STATE.importedSnapshot;
  if(snap && Array.isArray(snap.rows) && snap.rows.length){
    const out = snap.rows.map(r=>({
      asset_type: r.asset_type,
      current_value: Number(r.current_value) || 0,
      invested_value: Number(r.invested_value) || 0,
    }));
    // a class present only in a holdings paste still deserves a row
    const have = {}; out.forEach(r=>{ have[r.asset_type] = true; });
    ['MF','STOCK','US_STOCK'].forEach(sec=>{
      const rows = LIVE.holdings[sec] || [];
      if(!rows.length || have[sec]) return;
      let cur = 0; rows.forEach(r=>{ cur += Number(r.market_value) || 0; });
      out.push({asset_type: sec, current_value: cur, invested_value: 0});
    });
    return out;
  }
  const out = [];
  ['MF','STOCK','US_STOCK'].forEach(sec=>{
    const rows = LIVE.holdings[sec] || [];
    if(!rows.length) return;
    let cur = 0;
    rows.forEach(r=>{ cur += Number(r.market_value) || 0; });
    out.push({asset_type: sec, current_value: cur, invested_value: 0});
  });
  return out;
}
function applySnapshot(snap){
  STATE.importedSnapshot = {rows: snap.rows, total: snap.total, at: new Date().toISOString()};
  hydrateLiveFromState();
  markDirty();
}
/* Replaces just the sections present in an import, so pasting Groww's
   Indian holdings can't double-count against an earlier US paste. */
function applyImport(rows){
  const secs = {};
  rows.forEach(r=>{ secs[r.__section] = true; });
  const kept = importedHoldings().filter(h=>!secs[h.__section || 'STOCK']);
  STATE.importedHoldings = kept.concat(rows);
  STATE.importedAt = new Date().toISOString();
  hydrateLiveFromState();
  markDirty();
}

function corpusInvested(){
  const inv = (LIVE.snapshot && Array.isArray(LIVE.snapshot.investments)) ? LIVE.snapshot.investments : [];
  const ex = corpusExclude();
  let total = 0; const unknown = [];
  inv.forEach(a=>{
    if(ex.indexOf(a.asset_type) !== -1) return;
    const r = assetInvestedResolved(a);
    if(r.value !== null) total += r.value;      // partial totals still count
    if(r.value === null || r.partial) unknown.push(a.asset_type);
  });
  manualAssets().forEach(m=>{
    if(ex.indexOf(manualKey(m)) !== -1) return;
    if(typeof m.invested === 'number') total += m.invested;
    else if((Number(m.current)||0) > 0) unknown.push(m.name || 'Manual holding');
  });
  return {total, unknown};
}

/* EVERY purchase value on the page, editable — an imported figure can be
   wrong or missing, and correcting it must not require a re-import. */
function missingCostRows(){
  const rows = [];
  const inv = (LIVE.snapshot && Array.isArray(LIVE.snapshot.investments)) ? LIVE.snapshot.investments : [];
  const detailed = {MF:true, STOCK:true, US_STOCK:true};
  inv.forEach(a=>{
    if(detailed[a.asset_type]) return;   // listed holding-by-holding below
    const r = assetInvested(a);
    rows.push({
      kind:'asset', key:a.asset_type, name:assetLabel(a.asset_type),
      sub: r.source === 'api' ? 'Whole asset class · from your import' : 'Whole asset class',
      current:Number(a.current_value)||0, value: r.value, source: r.source,
    });
  });
  allLiveHoldings().forEach(h=>{
    if(h.__manualSource) return;         // these have their own editor below
    const r = holdingInvested(h);
    rows.push({
      kind:'holding', key:String(h.investment_code || h.investment), name:h.investment,
      sub: assetLabel(h.__section) + (h.broker && h.broker!=='2' ? ' · '+h.broker : '')
           + (r.source === 'api' ? ' · from your import' : ''),
      current:Number(h.market_value)||0, value:r.value, source:r.source, section: h.__section,
    });
  });
  return rows;
}

function renderLive(){
  const el = document.getElementById('panel-live');
  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Import portfolio</h2>
        <p>Your holdings, read live from ATS (INDmoney + Groww) — or pasted in by hand.</p>
      </div>
      <div class="corpus-actions">
        <button class="refresh-btn" id="live-import-toggle">↑ Paste holdings</button>
      </div>
    </div>
    <div class="notice info" id="ats-live" style="margin-bottom:14px;"></div>
    <details class="import-box" id="live-import"${importedHoldings().length || Cloud.atsLink() ? '' : ' open'}>
      <summary>Paste holdings by hand — Groww, INDmoney, or both (the old way)</summary>
      <div class="import-body">
        <div class="corpus-actions" style="margin-top:12px;">
          <a class="refresh-btn" id="ats-send" href="ats://import" target="_blank" rel="noopener" title="Sends these holdings to ATS on this Mac (starts ATS if needed); you confirm there">Send to ATS ↗</a>
          <button class="refresh-btn" id="ats-copy" title="Copies these holdings for ATS - paste them in ATS → Holdings → Update holdings">Copy for ATS</button>
        </div>
        <p class="footnote" id="ats-msg">Only needed if ATS isn't connected to your brokers.
          <a href="http://localhost:8765/import" id="ats-direct" target="_blank" rel="noopener">ATS already open? Send directly</a></p>
        <p>In any Claude chat (any plan), ask your broker's connector for raw JSON. The net-worth
           snapshot is what fills in EPF, RSUs, Gold, NPS and FD — classes no holdings list carries:</p>
        <div class="ask-line">Show me my Groww holdings as raw JSON</div>
        <div class="ask-line">Show me my INDmoney net worth snapshot, and my holdings for MF and US_STOCK, as raw JSON</div>
        <p>Paste the reply below. Both brokers' formats are understood, including Groww's
           “65.44 Thousands” style amounts. Importing replaces only the categories present in
           what you paste, so brokers can't double-count each other.</p>
        <div class="settings-grid" style="grid-template-columns:220px 1fr;align-items:end;margin-bottom:10px;">
          <div class="field">
            <label>If the paste doesn't say, treat it as</label>
            <select id="import-section" style="width:100%;padding:9px 11px;border:1px solid var(--border);
              border-radius:8px;background:var(--surface-2);color:var(--ink);font-family:var(--font-body);font-size:13.5px;">
              <option value="STOCK">Indian Stocks &amp; ETFs</option>
              <option value="MF">Mutual Funds</option>
              <option value="US_STOCK">US Stocks &amp; ETFs</option>
            </select>
          </div>
        </div>
        <textarea id="live-import-text" rows="6" placeholder='Paste the JSON your broker connector returned'></textarea>
        <div class="corpus-actions" style="margin-top:10px;">
          <button class="reset-btn" id="live-import-check">Check what this contains</button>
          <span id="live-import-msg" style="font-size:12px;color:var(--ink-muted);"></span>
        </div>
        <div id="live-import-preview"></div>
      </div>
    </details>

    <div id="live-body"></div>
  `;
  const tgl = document.getElementById('live-import-toggle');
  if(tgl) tgl.addEventListener('click', ()=>{
    const box = document.getElementById('live-import');
    box.open = true;
    box.scrollIntoView({behavior:'smooth', block:'nearest'});
  });
  wireLiveImport();
  wireAts();
  paintAtsBar();
  renderLiveBody();
}
/* ---------- to ATS, the trading dashboard on this Mac ----------
   The page cannot reach this Mac itself (the frame allows no outside requests), so the
   holdings travel in a link: ats://import#d=... opens ATS's update page through the ATS
   Launcher (which starts ATS if needed); the part after # never goes to any server. ATS
   shows what changes and saves only when told to. */
function atsPayload(){
  return {v:1, source:'16-Year Ledger', holdings:importedHoldings(), manual:STATE.manualAssets||[],
    snapshot:(STATE.importedSnapshot&&STATE.importedSnapshot.rows)||[], imported_at:STATE.importedAt||null,
    plan_url: location.origin + location.pathname};
}
function atsCode(){
  const bytes = new TextEncoder().encode(JSON.stringify(atsPayload()));
  let bin = ''; bytes.forEach(b=>{ bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function wireAts(){
  const send = document.getElementById('ats-send'), direct = document.getElementById('ats-direct'),
        copy = document.getElementById('ats-copy'), msg = document.getElementById('ats-msg');
  const empty = ()=>{ if(importedHoldings().length) return false; msg.textContent = 'Import your holdings first - then send them to ATS.'; return true; };
  // the links are filled in at the click, so they always carry the holdings as they are now
  if(send) send.addEventListener('click', e=>{ if(empty()){ e.preventDefault(); return; } send.href = 'ats://import#d=' + atsCode(); });
  if(direct) direct.addEventListener('click', e=>{ if(empty()){ e.preventDefault(); return; } direct.href = 'http://localhost:8765/import#d=' + atsCode(); });
  if(copy) copy.addEventListener('click', async ()=>{
    if(empty()) return;
    const code = atsCode();
    try{ await navigator.clipboard.writeText(code); copy.textContent = 'Copied ✓'; }
    catch(err){
      const t = document.createElement('textarea'); t.value = code; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select(); try{ document.execCommand('copy'); copy.textContent = 'Copied ✓'; }catch(e2){ copy.textContent = 'Select & copy failed'; } t.remove();
    }
    setTimeout(()=>{ copy.textContent = 'Copy for ATS'; }, 2500);
  });
}

/* ---------- live from ATS ----------
   ATS (the trading dashboard on this Mac) keeps your holdings from INDmoney and
   Groww, valued live. Linked once, this page reads them whenever it opens on that
   Mac and saves them with the plan, so the phone shows the last read through sync.
   Codes are kept from earlier imports where they match (ISIN, INDmoney code or
   ticker), so Contributions keeps comparing like with like. */
let ATS_BUSY = false, ATS_ERR = '';
function holdingsFromAts(d){
  /* codes in use, most recent first: the holdings as they stand, the latest reading, then older ones and hand-entered costs */
  const tiers = [new Set(importedHoldings().map(h=>String(h.investment_code)))];
  (STATE.contribSnaps || []).slice().sort((a, b)=>String(b.date || '').localeCompare(String(a.date || '')))
    .forEach(s=>tiers.push(new Set(Object.keys(s.holdings || {}))));
  tiers.push(new Set(Object.keys(((STATE.costBasis || {}).holdings) || {})));
  const pick = cands => { for(const t of tiers){ const c = cands.find(x=>t.has(x)); if(c) return c; } return null; };
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const rows = (d.items || []).filter(x=>x.kind !== 'crypto' && (Number(x.units) || 0) > 0).map(x=>{
    const section = x.kind === 'mf' ? 'MF' : x.region === 'US' ? 'US_STOCK' : 'STOCK';
    const cands = [x.ind_code, x.isin, x.symbol ? String(x.symbol).replace(/\.NS$|\.BO$/, '') : null, x.mf_code ? String(x.mf_code) : null]
      .filter(Boolean).map(String);
    const code = pick(cands) || cands[0] || String(x.name);
    const value = (typeof x.value === 'number' && x.value > 0) ? x.value : null;
    return {
      investment_code: code, investment: x.name_src || x.name, broker: x.broker || '',
      total_units: Number(x.units) || 0, market_value: r2(value || 0),
      unit_price: value ? r2(value / x.units) : 0,
      invested_amount: (typeof x.invested === 'number' && x.invested > 0) ? r2(x.invested) : null,
      __section: section, __noCurrentValue: !value, cost_src: x.cost_src || '',
    };
  });
  /* Asset classes: INDmoney's net-worth snapshot (EPF, RSUs, NPS, gold…), with the three
     classes listed holding by holding taken from the live values instead. */
  const sums = {};
  rows.forEach(r=>{
    const s = sums[r.__section] || (sums[r.__section] = {cur:0, inv:0, invKnown:true});
    s.cur += r.market_value;
    if(typeof r.invested_amount === 'number') s.inv += r.invested_amount; else s.invKnown = false;
  });
  const snapshot = (d.snapshot || []).map(r=>({asset_type:r.asset_type, current_value:Number(r.current_value) || 0, invested_value:Number(r.invested_value) || 0}));
  const typeOf = {MF:'MF', STOCK:'STOCK', US_STOCK:'US_STOCK'};
  Object.keys(sums).forEach(sec=>{
    let row = snapshot.find(r=>r.asset_type === typeOf[sec] || (sec === 'STOCK' && r.asset_type === 'IND_STOCK'));
    if(!row){ row = {asset_type: typeOf[sec], current_value:0, invested_value:0}; snapshot.push(row); }
    row.current_value = r2(sums[sec].cur);
    if(sums[sec].invKnown) row.invested_value = r2(sums[sec].inv);
  });
  let total = 0; snapshot.forEach(r=>{ total += r.current_value; });
  return {rows, snapshot, total: r2(total)};
}
async function refreshFromAts(quiet){
  if(!Cloud.atsLink() || ATS_BUSY) return;
  ATS_BUSY = true; ATS_ERR = '';
  paintAtsBar();
  try{
    const d = await Cloud.atsHoldings();
    const got = holdingsFromAts(d);
    if(!got.rows.length) throw new Error('ATS has no holdings yet - connect INDmoney in ATS → Holdings.');
    const wasDirty = dirty;
    STATE.importedSnapshot = {rows: got.snapshot, total: got.total, at: new Date().toISOString()};
    STATE.atsReadAt = new Date().toISOString();
    STATE.atsSource = d.source || '';
    STATE.atsUpdatedAt = d.updated_at || null;
    applyImport(got.rows);                 // replaces MF, Indian and US holdings; marks the plan changed
    if(!wasDirty){                          // nothing of yours was unsaved: keep it straight away
      persistSaved(STATE);
      Cloud.markSaved();
      dirty = false;
      updateSaveBar();
    }
    rerenderAll();
    if(!quiet) flashSaveStatus('Read ' + got.rows.length + ' holdings from ATS' + (wasDirty ? ' — Save to keep them' : ''));
  }catch(e){
    ATS_ERR = e.message;
    if(e.unlinked) Cloud.unlinkAts();
    if(!quiet) flashSaveStatus(e.message);
  }finally{
    ATS_BUSY = false;
    paintAtsBar();
    refreshSettings();
  }
}
function paintAtsBar(){
  const el = document.getElementById('ats-live');
  if(!el) return;
  const l = Cloud.atsLink();
  const ago = STATE.atsReadAt ? agoText(new Date(STATE.atsReadAt).getTime()) : null;
  if(!l){
    el.className = 'notice info';
    el.innerHTML = `<b>Holdings from ATS</b>
      ATS on your Mac collects your holdings from INDmoney and Groww. Link it once and this page reads them from ATS, valued live, whenever it opens there — no pasting.
      ${ago ? `<br>Holdings here were last read from ATS ${escAttr(ago)}.` : ''}
      <div class="corpus-actions" style="margin-top:10px;"><a class="snap-add-btn" style="text-decoration:none;" href="${escAttr(Cloud.atsLinkUrl())}">Link ATS on this Mac</a></div>
      ${ATS_ERR ? `<div class="footnote" style="color:var(--critical);">${escAttr(ATS_ERR)}</div>` : ''}`;
    return;
  }
  el.className = 'notice ' + (ATS_ERR ? 'warn' : 'ok');
  el.innerHTML = `<b>Live from ATS${STATE.atsSource ? ' · ' + escAttr(STATE.atsSource) : ''}</b>
    ${ATS_BUSY ? 'Reading your holdings from ATS…' : ago ? 'Read ' + escAttr(ago) + (STATE.atsUpdatedAt ? ' · brokers last synced in ATS ' + escAttr(fmtDate(STATE.atsUpdatedAt)) : '') + '.' : 'Not read yet.'}
    ${ATS_ERR ? `<br><span style="color:var(--ink);">${escAttr(ATS_ERR)}</span>${ago ? ' Showing the holdings read ' + escAttr(ago) + '.' : ''}` : ''}
    <div class="corpus-actions" style="margin-top:10px;"><button class="refresh-btn" id="ats-live-refresh" ${ATS_BUSY ? 'disabled' : ''}>↻ Read from ATS now</button></div>`;
  const b = document.getElementById('ats-live-refresh');
  if(b) b.addEventListener('click', ()=>refreshFromAts(false));
}
/* The footer names the workbook the plan came from - it is part of your saved plan. */
function renderPlanSource(){
  const el = document.getElementById('plan-source');
  if(!el) return;
  const starter = !STATE.plan || STATE.plan.starter;
  el.innerHTML = starter
    ? 'Example plan — restore yours in Overview → Your data · figures are planning estimates, not financial advice.'
    : (PLAN_SOURCE ? 'Sourced from <span class="num">' + escAttr(PLAN_SOURCE) + '</span> · ' : '') + 'figures are personal planning estimates, not financial advice.';
}

function wireLiveImport(){
  const btn = document.getElementById('live-import-check');
  if(!btn) return;
  btn.addEventListener('click', ()=>{
    const raw = (document.getElementById('live-import-text').value || '').trim();
    const hint = document.getElementById('import-section').value;
    const msg = document.getElementById('live-import-msg');
    const prev = document.getElementById('live-import-preview');
    if(!raw){ msg.textContent = 'Paste something first.'; prev.innerHTML = ''; return; }
    let p, snap;
    try{ p = parsePastedHoldings(raw, hint); }catch(e){ p = {rows:[], sections:{}, noValue:[], noUnits:[]}; }
    try{ snap = parsePastedSnapshot(raw); }catch(e){ snap = null; }
    msg.textContent = '';
    if(!p.rows.length && !snap){
      prev.innerHTML = `<div class="notice err" style="margin-top:12px;"><b>Nothing recognised in that</b>
        A <b>net-worth snapshot</b> needs an <span class="num">investments</span> list with
        <span class="num">asset_type</span> and <span class="num">current_value</span>.
        <b>Holdings</b> need a name (<span class="num">investment</span>, <span class="num">title</span> or
        <span class="num">trading_symbol</span>) and a quantity or value.
        Ask for raw JSON rather than a formatted table, and paste the whole reply.</div>`;
      return;
    }
    const snapBlock = snap ? `
      <div class="notice ok" style="margin-top:12px;">
        <b>Net-worth snapshot — ${snap.rows.length} asset classes</b>
        ${snap.rows.map(r=>assetLabel(r.asset_type)+' '+fmtCompact(r.current_value)).join(' · ')}
        ${snap.total ? '<br>Total ' + fmtCompact(snap.total) : ''}
      </div>` : '';
    if(!p.rows.length){
      prev.innerHTML = snapBlock + `
        <p class="footnote">Classes reported with no purchase price — RSUs and Indian stocks usually —
           keep whatever you've entered, and stay editable below.</p>
        <div class="corpus-actions" style="margin-top:12px;">
          <button class="snap-add-btn" id="live-import-commit">Import this snapshot</button>
        </div>`;
      const go1 = document.getElementById('live-import-commit');
      if(go1) go1.addEventListener('click', ()=>{
        applySnapshot(snap);
        document.getElementById('live-import').open = false;
        renderLive(); renderContrib();
      });
      return;
    }
    const secs = Object.keys(p.sections).map(k=>assetLabel(k)+' ('+p.sections[k]+')').join(' · ');
    let inv = 0, cur = 0, costKnown = 0;
    p.rows.forEach(r=>{
      if(typeof r.invested_amount === 'number'){ inv += r.invested_amount; costKnown++; }
      cur += Number(r.market_value) || 0;
    });
    prev.innerHTML = snapBlock + `
      <div class="notice ok" style="margin-top:12px;">
        <b>Found ${p.rows.length} holdings</b>${secs}<br>
        ${costKnown} came with a purchase price · ${fmtCompact(inv)} invested · ${fmtCompact(cur)} current value
      </div>
      ${(p.noUnits||[]).length ? `<div class="notice warn" style="margin-top:10px;"><b>No unit count for ${p.noUnits.length}</b>
        ${p.noUnits.join(', ')} — the paste carried a value but no holding size, so these show 0 units.
        Rupee figures are unaffected, but Contributions proves a SIP ran by watching units move, so it
        cannot verify these until the export includes a quantity.</div>` : ''}
      ${p.noValue.length ? `<div class="notice warn" style="margin-top:10px;"><b>No current value for ${p.noValue.length}</b>
        ${p.noValue.join(', ')} — your broker returned nothing for these, so they'll count as ₹0 until it does.
        Their purchase price is still recorded.</div>` : ''}
      <div class="table-wrap" style="margin-top:12px;max-height:280px;overflow:auto;">
        <table>
          <thead><tr><th class="name">Holding</th><th>Units</th><th>Invested</th><th>Current</th><th>P&amp;L</th></tr></thead>
          <tbody>
            ${p.rows.map(r=>{
              const iv = (typeof r.invested_amount === 'number') ? r.invested_amount : null;
              const cv = Number(r.market_value) || 0;
              const pl = (iv === null || r.__noCurrentValue) ? null : cv - iv;
              return `<tr>
                <td class="name">${r.investment}<div class="recon-sub">${assetLabel(r.__section)}${r.broker?' · '+r.broker:''}</div></td>
                <td class="amt">${r.total_units.toLocaleString('en-IN',{maximumFractionDigits:4})}</td>
                <td class="amt">${iv===null?'—':fmtINR(iv)}</td>
                <td class="amt">${r.__noCurrentValue?'—':fmtINR(cv)}</td>
                <td class="amt ${pl===null?'':(pl>=0?'pnl-pos':'pnl-neg')}">${pl===null?'—':(pl>=0?'+':'')+fmtINR(pl)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      ${(function(){
        /* Brokers key holdings differently — INDmoney by its own code, Groww by ISIN.
           If past readings used other keys, a month-on-month diff would read the whole
           portfolio as bought this month. Say so before it happens. */
        const snaps = STATE.contribSnaps || [];
        if(!snaps.length) return '';
        const oldKeys = {};
        snaps.forEach(s=>Object.keys(s.holdings||{}).forEach(k=>{ if(k.indexOf('MANUAL:')!==0) oldKeys[k]=1; }));
        const overlap = p.rows.filter(r=>oldKeys[r.investment_code]).length;
        if(overlap > 0) return '';
        return `<div class="notice err" style="margin-top:10px;">
          <b>These use different holding IDs from your saved readings</b>
          Your ${snaps.length} existing reading${snaps.length===1?'':'s'} identify holdings by another broker's codes,
          so none of these ${p.rows.length} would line up. Left alone, your next comparison would report the whole
          portfolio as invested in one month. Clear the old readings and let this import start a fresh baseline.
          <div style="margin-top:10px;"><label style="font-size:12.5px;color:var(--ink);cursor:pointer;">
            <input type="checkbox" id="import-reset-readings" checked style="margin-right:7px;">
            Clear ${snaps.length} old reading${snaps.length===1?'':'s'} and re-baseline from this import
          </label></div>
        </div>`;
      })()}
      <div class="corpus-actions" style="margin-top:12px;">
        <button class="snap-add-btn" id="live-import-commit">Import these ${p.rows.length} holdings</button>
        <span style="font-size:12px;color:var(--ink-muted);">Replaces ${Object.keys(p.sections).map(assetLabel).join(' and ')} only.</span>
      </div>`;
    const go = document.getElementById('live-import-commit');
    if(go) go.addEventListener('click', ()=>{
      const reset = document.getElementById('import-reset-readings');
      if(reset && reset.checked) STATE.contribSnaps = [];
      if(snap) applySnapshot(snap);
      applyImport(p.rows);
      document.getElementById('live-import').open = false;
      renderLive();
      renderContrib();
    });
  });
}

function renderLiveBody(){
  const body = document.getElementById('live-body');
  if(!body) return;
  if(LIVE.status !== 'ready'){
    body.innerHTML = `<div class="notice info"><b>No holdings imported yet</b>
      Use <b>Import holdings</b> above. Ask Claude in any chat for your INDmoney net worth and holdings as raw JSON,
      paste the reply, and this whole tab fills in — allocation, P&amp;L, and your plan compared against what you actually hold.</div>`;
    return;
  }

  const snap = LIVE.snapshot || {};
  const investments = Array.isArray(snap.investments) ? snap.investments : [];
  const netWorth = Number(snap.total_networth) || 0;
  const corpus = corpusFigure();
  const ex = corpusExclude();
  const ci = corpusInvested();
  const invested = ci.total;
  const gain = corpus - invested;
  const gainPct = invested > 0 ? (gain/invested) : 0;
  const missing = missingCostRows();

  /* One combined list: INDmoney's asset classes plus anything tracked by hand,
     so the donut, the table and the chips all describe the same portfolio. */
  const allRows = investments.map(a=>({
    key: a.asset_type,
    label: assetLabel(a.asset_type),
    current: Number(a.current_value) || 0,
    inv: assetInvestedResolved(a),
    manual: null,
  })).concat(manualAssets().map(m=>({
    key: manualKey(m),
    label: (m.name || 'Manual holding'),
    current: Number(m.current) || 0,
    inv: {value: (typeof m.invested === 'number') ? m.invested : null, source:'manual', partial:false},
    manual: m,
  })));
  allRows.sort((a,b)=>b.current - a.current);

  const allocItems = allRows
    .filter(r=>r.current > 0)
    .map((r,i)=>({label:r.label, value:r.current, color:CAT_COLORS[i%8]}));

  /* There is no connector any more — the meaningful timestamp is when you
     last pasted something in. */
  const stampSrc = STATE.importedAt || (STATE.importedSnapshot||{}).at;
  const stamp = stampSrc
    ? fmtDate(new Date(stampSrc)) + ', ' + new Date(stampSrc).toLocaleTimeString('en-IN',{hour:'numeric',minute:'2-digit'})
    : 'not yet';

  const recon = reconcilePlan();

  body.innerHTML = `
    <div class="result-row">
      <div class="card stat-tile"><div class="l">Total net worth</div><div class="v num">${fmtCompact(netWorth)}</div><div class="sub">Everything imported, plus what you track by hand</div></div>
      <div class="card stat-tile"><div class="l">Corpus — current value</div><div class="v num">${fmtCompact(corpus)}</div><div class="sub">${ex.length? 'Excludes '+ex.map(assetLabel).join(', ') : 'All asset types included'}</div></div>
      <div class="card stat-tile"><div class="l">Corpus — invested</div><div class="v num">${fmtCompact(invested)}</div><div class="sub">${ci.unknown.length ? ci.unknown.length+' asset type'+(ci.unknown.length===1?'':'s')+' still missing a cost' : 'Complete — every holding has a cost'}</div></div>
      <div class="card stat-tile"><div class="l">Profit &amp; loss</div><div class="v num ${gain>=0?'pnl-pos':'pnl-neg'}">${gain>=0?'+':''}${fmtCompact(gain)}</div><div class="sub">${gain>=0?'+':''}${fmtPct(gainPct)}${ci.unknown.length?' · partial, see below':''}</div></div>
    </div>

    <div class="live-stamp">Last import: ${stamp}</div>

    <section class="block" style="margin-top:26px;">
      <div class="block-title">Count toward the retirement corpus</div>
      <div class="card pad">
        <p style="font-size:13px;color:var(--ink-secondary);">Tap an asset type to include or exclude it. A car or a physical asset usually isn't part of the corpus you'll draw an income from.</p>
        <div class="chip-row" id="corpus-chips">
          ${allRows.map(r=>`
            <button class="asset-chip" data-asset="${escAttr(r.key)}" aria-pressed="${ex.indexOf(r.key)===-1?'true':'false'}">
              ${r.label}${r.manual?' <span style="font-size:9.5px;color:var(--gold-strong);">by hand</span>':''} <span class="amt">${fmtCompact(r.current)}</span>
            </button>`).join('')}
        </div>
        <div class="corpus-actions">
          <button class="snap-add-btn" id="log-live">Log this month's check-in</button>
          <button class="reset-btn" id="take-reading-live">Take this month's contribution reading</button>
          <span style="font-size:12px;color:var(--ink-muted);">Check-in records ${fmtCompact(corpus)} current and ${fmtCompact(invested)} invested. The reading captures per-holding units and cost for the Contributions tab.</span>
        </div>
        <div id="log-live-result"></div>
      </div>
    </section>

    <section class="block">
      <div class="block-title">Purchase values — edit any of them</div>
      <div class="card pad">
        ${missing.length ? `
          <p style="font-size:13px;color:var(--ink-secondary);">Every purchase value on the page, editable. Imports fill these in where your broker reports them — RSUs and Indian stocks usually come through as blank or zero — and anything you type here overrides the imported figure permanently, surviving future imports. Leave one blank to keep that holding out of the P&amp;L.</p>
          <div class="table-wrap" style="margin-top:12px;">
            <table>
              <thead><tr><th class="name">Holding</th><th>Current value</th><th>Invested (yours)</th><th>P&amp;L</th><th>Gain %</th></tr></thead>
              <tbody>
                ${missing.map(m=>{
                  const pl = (m.value === null) ? null : m.current - m.value;
                  return `<tr>
                    <td class="name">${m.name}<div class="recon-sub">${m.sub}</div></td>
                    <td class="amt">${fmtCompact(m.current)}</td>
                    <td><input class="inline-input num cost-input" type="number" step="1000" placeholder="not set"
                        data-kind="${m.kind}" data-key="${escAttr(m.key)}" value="${m.value === null ? '' : m.value}"></td>
                    <td class="amt ${pl===null?'':(pl>=0?'pnl-pos':'pnl-neg')}">${pl===null?'—':(pl>=0?'+':'')+fmtCompact(pl)}</td>
                    <td class="amt ${pl===null?'':(pl>=0?'pnl-pos':'pnl-neg')}">${
                      (m.value === null || m.value <= 0) ? '—' : (pl>=0?'+':'')+fmtPct(pl/m.value)}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
          <p class="footnote">Stored with your plan and applied ahead of any imported value, so a re-import each month never overwrites a correction you made.
             <b>Gain %</b> is the P&amp;L against what you put in. There's no long-term / short-term flag here on purpose:
             a monthly SIP buys a fresh lot every month, each with its own holding-period clock, so no single date describes the position.</p>
        ` : `<div class="notice ok"><b>Nothing missing</b>Every holding has a cost basis — from INDmoney or entered by you — so the P&amp;L above is complete.</div>`}
      </div>
    </section>

    <section class="block">
      <div class="block-title">Holdings INDmoney can't see</div>
      <div class="card pad">
        <p style="font-size:13px;color:var(--ink-secondary);">
          Anything held off-platform — Bitcoin on an exchange, for instance. Enter what it's worth now and what you put in;
          it then counts in the corpus, the P&amp;L and the allocation exactly like any other asset, and can be
          excluded with its own chip above.
        </p>
        <div class="table-wrap" style="margin-top:12px;">
          <table>
            <thead><tr><th class="name">Name</th><th>Current value</th><th>Invested</th><th>P&amp;L</th><th></th></tr></thead>
            <tbody id="manual-tbody">
              ${manualAssets().map(m=>{
                const cur = Number(m.current)||0;
                const pl = (typeof m.invested === 'number') ? cur - m.invested : null;
                return `<tr data-manid="${m.id}">
                  <td class="name"><input class="inline-input" data-mf="name" value="${escAttr(m.name||'')}" placeholder="e.g. Bitcoin"></td>
                  <td><input class="inline-input num" type="number" step="1000" data-mf="current" value="${cur||''}" placeholder="0"></td>
                  <td><input class="inline-input num" type="number" step="1000" data-mf="invested" value="${typeof m.invested==='number'?m.invested:''}" placeholder="not set"></td>
                  <td class="amt ${pl===null?'':(pl>=0?'pnl-pos':'pnl-neg')}">${pl===null?'—':(pl>=0?'+':'')+fmtCompact(pl)}</td>
                  <td class="col-del"><button class="del-btn" data-delman="${m.id}" aria-label="Remove">✕</button></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
          <div class="pad" style="padding-top:0;"><button class="add-row-btn" id="add-manual">+ Add a holding</button></div>
        </div>
        <p class="footnote">Your plan's Bitcoin SIP shows as “Not found” below until a holding here matches it by name.</p>
      </div>
    </section>

    <section class="block">
      <div class="block-title">Allocation by asset type</div>
      <div class="grid-2">
        <div class="card pad"><div class="donut-row">${donut(allocItems,{size:180,thickness:26,label:'Allocation by asset type'})}${legendHTML(allocItems)}</div></div>
        <div class="table-wrap" style="align-self:start;">
          <table>
            <thead><tr><th class="name">Asset type</th><th>Invested</th><th>Current</th><th>P&amp;L</th></tr></thead>
            <tbody>
              ${allRows.map(r=>{
                const cur = r.current;
                const iv = r.inv;
                const pl = (iv.value === null) ? null : cur - iv.value;
                const plPct = (iv.value && iv.value > 0) ? (pl/iv.value) : null;
                const excluded = ex.indexOf(r.key) !== -1;
                const note = excluded ? 'not in corpus'
                  : (r.manual ? 'tracked by hand' : (iv.partial ? 'some holdings have no cost yet' : ''));
                return `<tr${excluded?' style="opacity:.5;"':''}>
                  <td class="name">${r.label}${note?`<div class="recon-sub">${note}</div>`:''}</td>
                  <td class="amt">${iv.value===null?'—':fmtCompact(iv.value)}${iv.source==='manual'?' <span style="color:var(--gold-strong);font-size:10px;">yours</span>':''}</td>
                  <td class="amt">${fmtCompact(cur)}</td>
                  <td class="amt ${pl===null?'':(pl>=0?'pnl-pos':'pnl-neg')}">${pl===null?'—':(pl>=0?'+':'')+fmtCompact(pl)+(plPct!==null?' · '+(plPct>=0?'+':'')+fmtPct(plPct):'')}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <p class="footnote">A “—” means no cost basis is known for that class, so no P&amp;L is shown rather than a fabricated one. Values tagged <b>yours</b> are the ones you entered above.</p>
    </section>

    <section class="block">
      <div class="block-title">Your plan vs. what you actually hold</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th class="name">Planned fund</th><th>Planned SIP</th><th>Invested</th><th>Current</th><th>P&amp;L</th><th>Status</th></tr></thead>
          <tbody>
            ${recon.rows.map(r=>{
              let inv = 0, anyInv = false, anyManual = false;
              r.matches.forEach(m=>{
                const ri = holdingInvested(m);
                if(ri.value !== null){ inv += ri.value; anyInv = true; if(ri.source==='manual') anyManual = true; }
              });
              const pl = anyInv ? (r.value - inv) : null;
              return `<tr>
                <td class="name">${r.fund.name}
                  ${r.matches.length ? `<div class="recon-sub">${r.matches.map(m=>m.investment + (m.broker && m.broker!=='2' ? ' · '+m.broker : '')).join('<br>')}</div>` : ''}
                </td>
                <td class="amt">${fmtINR(r.fund.monthly)}</td>
                <td class="amt">${anyInv?fmtCompact(inv):'—'}${anyManual?' <span style="color:var(--gold-strong);font-size:10px;">yours</span>':''}</td>
                <td class="amt">${r.matches.length ? fmtCompact(r.value) : '—'}</td>
                <td class="amt ${pl===null?'':(pl>=0?'pnl-pos':'pnl-neg')}">${pl===null ? '—' : (pl>=0?'+':'')+fmtCompact(pl)}</td>
                <td><span class="recon-status ${r.matches.length?'held':'missing'}">${r.matches.length?'Held':'Not found'}</span></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <p class="footnote">“Not found” means nothing in what you imported matched that name — either the SIP hasn't started, or it's held somewhere the import doesn't cover. Add it under “Holdings INDmoney can't see” if it's off-platform.</p>
    </section>

    ${recon.extras.length ? `
    <section class="block">
      <div class="block-title">Held, but not in your plan</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th class="name">Holding</th><th>Invested</th><th>Current</th><th>P&amp;L</th><th>Broker</th></tr></thead>
          <tbody>
            ${recon.extras.slice().sort((a,b)=>(Number(b.market_value)||0)-(Number(a.market_value)||0)).map(h=>{
              const cur = Number(h.market_value)||0;
              const ri = holdingInvested(h);
              const pl = ri.value===null ? null : cur - ri.value;
              return `<tr>
                <td class="name">${h.investment}<div class="recon-sub">${assetLabel(h.__section)}</div></td>
                <td class="amt">${ri.value===null?'—':fmtCompact(ri.value)}${ri.source==='manual'?' <span style="color:var(--gold-strong);font-size:10px;">yours</span>':''}</td>
                <td class="amt">${fmtCompact(cur)}</td>
                <td class="amt ${pl===null?'':(pl>=0?'pnl-pos':'pnl-neg')}">${pl===null?'—':(pl>=0?'+':'')+fmtCompact(pl)}</td>
                <td>${h.broker && h.broker!=='2' ? h.broker : 'INDmoney'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <p class="footnote">Worth a look against golden rule 3 — no sector bets — and against the break-even exit plan for any frozen positions.</p>
    </section>` : ''}
  `;

  const chips = document.getElementById('corpus-chips');
  if(chips){
    chips.querySelectorAll('[data-asset]').forEach(chip=>{
      chip.addEventListener('click', ()=>{
        const a = chip.dataset.asset;
        const list = corpusExclude();
        const i = list.indexOf(a);
        if(i === -1) list.push(a); else list.splice(i,1);
        markDirty();
        renderLiveBody();
      });
    });
  }
  /* Cost-basis inputs — debounced so a re-render doesn't steal focus mid-typing. */
  body.querySelectorAll('.cost-input').forEach(inp=>{
    inp.addEventListener('input', ()=>{
      const v = inp.value.trim() === '' ? '' : parseFloat(inp.value);
      if(inp.dataset.kind === 'asset') setAssetCost(inp.dataset.key, v);
      else setHoldingCost(inp.dataset.key, v);
      clearTimeout(inp.__t);
      inp.__t = setTimeout(()=>{
        const active = document.activeElement;
        const key = active && active.dataset ? active.dataset.key : null;
        renderLiveBody();
        if(key){
          const again = document.querySelector('.cost-input[data-key="'+(window.CSS && CSS.escape ? CSS.escape(key) : key)+'"]');
          if(again){ again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
        }
      }, 900);
    });
  });

  /* Manually-tracked holdings — same debounce so a re-render can't steal focus. */
  const manBody = document.getElementById('manual-tbody');
  if(manBody){
    manBody.querySelectorAll('input[data-mf]').forEach(inp=>{
      inp.addEventListener('input', ()=>{
        const id = inp.closest('tr').dataset.manid;
        const m = manualAssets().filter(x=>x.id===id)[0];
        if(!m) return;
        const f = inp.dataset.mf;
        if(f === 'name') m.name = inp.value;
        else if(inp.value.trim() === '') m[f] = (f === 'invested') ? null : 0;
        else m[f] = parseFloat(inp.value) || 0;
        markDirty();
        clearTimeout(inp.__t);
        inp.__t = setTimeout(()=>{
          const active = document.activeElement;
          const rid = active && active.closest && active.closest('tr') ? active.closest('tr').dataset.manid : null;
          const fld = active && active.dataset ? active.dataset.mf : null;
          renderLiveBody();
          if(rid && fld){
            const again = document.querySelector('tr[data-manid="'+rid+'"] input[data-mf="'+fld+'"]');
            if(again){ again.focus(); try{ again.setSelectionRange(again.value.length, again.value.length); }catch(e){} }
          }
        }, 900);
      });
    });
    manBody.querySelectorAll('[data-delman]').forEach(b=>{
      b.addEventListener('click', ()=>{
        const id = b.dataset.delman;
        pushUndo('removing a hand-tracked holding');
        STATE.manualAssets = manualAssets().filter(x=>x.id !== id);
        // drop its corpus exclusion too, so the key can't linger
        const ix = corpusExclude().indexOf('MANUAL:'+id);
        if(ix !== -1) corpusExclude().splice(ix,1);
        markDirty();
        hydrateLiveFromState();
        renderLiveBody();
      });
    });
  }
  const addMan = document.getElementById('add-manual');
  if(addMan){
    addMan.addEventListener('click', ()=>{
      manualAssets().push({id: cryptoId('man'), name:'', current:0, invested:null});
      markDirty();
      renderLiveBody();
    });
  }

  const rdBtn = document.getElementById('take-reading-live');
  if(rdBtn) rdBtn.addEventListener('click', ()=>{
    const cap = buildCapture();
    STATE.contribSnaps = (STATE.contribSnaps || []).filter(s=>s.ym !== cap.ym);
    STATE.contribSnaps.push(cap);
    markDirty();
    renderContrib();
    document.getElementById('log-live-result').innerHTML =
      `<div class="notice ok" style="margin-top:12px;"><b>Reading saved for ${ymLabel(cap.ym)}</b>` +
      `${Object.keys(cap.holdings).length} holdings recorded. See the Contributions tab. Hit Save to keep it.</div>`;
  });

  const logBtn = document.getElementById('log-live');
  if(logBtn){
    logBtn.addEventListener('click', ()=>{
      const value = corpusFigure();
      if(value <= 0) return;
      const ciNow = corpusInvested();
      const date = new Date().toISOString().slice(0,10);
      STATE.snapshots = STATE.snapshots.filter(s=> !(s.date === date && s.fromLive));
      STATE.snapshots.push({
        id: cryptoId('snap'), date, value,
        invested: ciNow.total,
        note:'From INDmoney', fromLive:true,
      });
      markDirty();
      renderOverview();
      const pl = value - ciNow.total;
      document.getElementById('log-live-result').innerHTML =
        `<div class="notice ok" style="margin-top:12px;"><b>Logged for ${fmtDate(new Date())}</b>` +
        `Current ${fmtCompact(value)} · invested ${fmtCompact(ciNow.total)} · P&amp;L ${(pl>=0?'+':'')+fmtCompact(pl)}` +
        `${ciNow.unknown.length ? ' — invested is partial, ' + ciNow.unknown.length + ' asset type(s) still have no cost.' : ''}` +
        `<br>It's on the Overview progress chart now. Hit Save to keep it permanently.</div>`;
    });
  }
}

/* =========================================================
   PANEL: CONTRIBUTIONS — did the money actually go in?

   Two signals, deliberately kept apart:
     · MF + US holdings report a real cost basis (invested_amount),
       so their month-over-month delta is rupee-exact.
     · Groww-brokered Indian ETFs report no cost basis at all, but
       total_units is exact — and units move ONLY when you buy or
       sell, never with the market. So a unit change is proof a SIP
       executed; the rupee figure for those is an estimate
       (units added x current price) and is labelled as one.
   ========================================================= */
/* ---------- modal ---------- */
function closeModal(){
  const m = document.getElementById('ledger-modal');
  if(m) m.remove();
  document.removeEventListener('keydown', modalKey);
}
function modalKey(e){ if(e.key === 'Escape') closeModal(); }
function openModal(title, subtitle, html){
  closeModal();
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.id = 'ledger-modal';
  back.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="${escAttr(title)}">
      <div class="modal-head">
        <div><h3>${title}</h3>${subtitle?`<div class="msub">${subtitle}</div>`:''}</div>
        <button class="modal-close" aria-label="Close">✕</button>
      </div>
      <div class="modal-body">${html}</div>
    </div>`;
  back.addEventListener('click', e=>{ if(e.target === back) closeModal(); });
  back.querySelector('.modal-close').addEventListener('click', closeModal);
  document.body.appendChild(back);
  document.addEventListener('keydown', modalKey);
}

function ymOf(d){ return (d instanceof Date ? d : new Date(d)).toISOString().slice(0,7); }
function ymIdx(ym){ const p = String(ym).split('-'); return Number(p[0])*12 + Number(p[1]) - 1; }
function monthsBetween(a,b){ return ymIdx(b) - ymIdx(a); }
function ymLabel(ym){
  const p = String(ym).split('-');
  return new Date(Number(p[0]), Number(p[1])-1, 1)
    .toLocaleDateString('en-IN',{month:'short', year:'numeric'});
}

function liveHoldingsReady(){
  return LIVE.status === 'ready' &&
    (LIVE.holdings.MF || LIVE.holdings.US_STOCK || LIVE.holdings.STOCK);
}

/* ---------- readings: one shared builder, two sources ----------
   A reading must have the SAME shape whether it came from the live
   connector or from pasted JSON, or a month-over-month comparison
   across the two would be meaningless. Both paths go through here. */
function captureFromRows(rows){
  const holdings = {};
  rows.forEach(h=>{
    const code = String(h.investment_code || h.investment || '').trim();
    if(!code) return;
    const rawInvested = (typeof h.invested_amount === 'number') ? h.invested_amount : null;
    // Fall back to a cost basis you entered when INDmoney reports none.
    const eff = (rawInvested === null) ? holdingInvested(h).value : rawInvested;
    /* Whether the unit count is KNOWN is recorded alongside it. A bare 0 for
       "the export omitted it" is indistinguishable from "holds nothing", and the
       next reading then reads the gap as a large sale. */
    const unitsKnown = h.__noUnits !== true;
    const units = Number(h.total_units) || 0;
    const prev = holdings[code];
    if(prev){
      prev.units += units;
      prev.value += Number(h.market_value) || 0;
      if(!unitsKnown) prev.unitsKnown = false;   // one unknown taints the sum
      if(eff !== null) prev.invested = (prev.invested || 0) + eff;
    } else {
      holdings[code] = {
        name: h.investment || code,
        section: h.__section || h.asset_type || 'STOCK',
        units: units,
        unitsKnown: unitsKnown,
        price: Number(h.unit_price) || 0,
        value: Number(h.market_value) || 0,
        invested: eff,
        costFromApi: rawInvested !== null,
      };
    }
  });
  // Off-platform holdings have no units; their cost basis is the only signal.
  manualAssets().forEach(m=>{
    holdings[manualKey(m)] = {
      name: m.name || 'Manual holding', section:'MANUAL',
      units: 0, price: 0,
      value: Number(m.current) || 0,
      invested: (typeof m.invested === 'number') ? m.invested : null,
      costFromApi: false,
      tracksUnits: false,
    };
  });
  return {
    id: cryptoId('cap'),
    ym: ymOf(new Date()),
    date: new Date().toISOString().slice(0,10),
    expected: totalSIP(),
    holdings: holdings,
  };
}

function buildCapture(){
  const rows = [];
  [['MF','MF'],['US_STOCK','US_STOCK'],['STOCK','STOCK']].forEach(pair=>{
    (LIVE.holdings[pair[0]] || []).forEach(h=>{
      const row = {}; for(const p in h) row[p] = h[p];
      row.__section = pair[1];
      rows.push(row);
    });
  });
  return captureFromRows(rows);
}

/* ---------- pasted-JSON import (no connector needed) ----------
   Ask Claude in a normal chat for your INDmoney holdings and paste
   whatever it returns. Deliberately tolerant: code fences, prose
   around the JSON, several blocks at once, and INDmoney's habit of
   wrapping its payload in {"result": "<json string>"} all parse. */
function tryParseJSON(t){ try{ return JSON.parse(t); }catch(e){ return undefined; } }

function extractJsonBlobs(text){
  const s = String(text||'').replace(/```[a-zA-Z]*\s*/g,'').replace(/```/g,'');
  const whole = tryParseJSON(s.trim());
  if(whole !== undefined) return [whole];
  const out = [];
  let i = 0;
  while(i < s.length){
    const ch = s[i];
    if(ch === '{' || ch === '['){
      const close = (ch === '{') ? '}' : ']';
      let depth = 0, inStr = false, esc = false, j = i;
      for(; j < s.length; j++){
        const c = s[j];
        if(inStr){
          if(esc) esc = false;
          else if(c === '\\') esc = true;
          else if(c === '"') inStr = false;
          continue;
        }
        if(c === '"'){ inStr = true; continue; }
        if(c === ch) depth++;
        else if(c === close){ depth--; if(depth === 0){ j++; break; } }
      }
      const v = tryParseJSON(s.slice(i, j));
      if(v !== undefined){ out.push(v); i = j; continue; }
    }
    i++;
  }
  return out;
}

/* Groww reports money as display strings — "65.44 Thousands", "4.38 Lakhs",
   "-613.44" — so every amount has to survive that before it can be used. */
function parseIndianNumber(v){
  if(typeof v === 'number') return isFinite(v) ? v : null;
  if(v === null || v === undefined) return null;
  let s = String(v).trim().replace(/[,₹\s]+/g,' ').replace(/%$/,'').trim();
  if(!s || /^(unknown|n\/?a|null|-)$/i.test(s)) return null;
  const m = s.match(/^(-?\d*\.?\d+)\s*(thousands?|k|lakhs?|lacs?|crores?|cr|millions?|mn|bn)?$/i);
  if(!m){ const n = parseFloat(s); return isFinite(n) ? n : null; }
  let n = parseFloat(m[1]);
  if(!isFinite(n)) return null;
  const u = (m[2]||'').toLowerCase();
  if(/^(thousands?|k)$/.test(u))      n *= 1e3;
  else if(/^(lakhs?|lacs?)$/.test(u)) n *= 1e5;
  else if(/^(crores?|cr)$/.test(u))   n *= 1e7;
  else if(/^(millions?|mn)$/.test(u)) n *= 1e6;
  else if(/^bn$/.test(u))             n *= 1e9;
  return n;
}

/* A payload may declare its own type on the wrapper - {"asset":"mutual_fund",
   "holdings":[...]} - rather than per row. Map that onto a section so the rows
   land in the right bucket instead of defaulting to STOCK. */
function assetToSection(a){
  const s = String(a||'').toUpperCase().replace(/[^A-Z]/g,'');
  if(!s) return null;
  if(s === 'MUTUALFUND' || s === 'MUTUALFUNDS' || s === 'MF') return 'MF';
  if(s === 'USSTOCK' || s === 'USSTOCKS' || s === 'USEQUITY') return 'US_STOCK';
  if(s === 'STOCK' || s === 'STOCKS' || s === 'INDSTOCK' || s === 'EQUITY') return 'STOCK';
  return null;
}

/* The size of a position goes by many names across exports. Missing one used to
   yield a SILENT zero, which matters more than it looks: the Contributions panel
   treats a unit change as proof a SIP executed, so a zero there quietly removes a
   fund from SIP verification. Returns null when genuinely absent, so "not
   reported" stays distinguishable from "holds nothing". */
const UNIT_KEYS = ['total_units','quantity','units','qty','no_of_units',
                   'total_quantity','holding_units','shares','nav_units'];
function pickUnits(o){
  for(let i=0;i<UNIT_KEYS.length;i++){
    const k = UNIT_KEYS[i];
    if(o[k] !== undefined){
      const n = parseIndianNumber(o[k]);
      if(n !== null) return n;
    }
  }
  return null;
}
function hasUnitField(o){
  for(let i=0;i<UNIT_KEYS.length;i++) if(o[UNIT_KEYS[i]] !== undefined) return true;
  return false;
}

/* Recognises a holding row from either broker's schema. */
function looksLikeHolding(o){
  if(!o || typeof o !== 'object' || Array.isArray(o)) return false;
  const hasName = o.investment !== undefined || o.title !== undefined
               || o.name !== undefined
               || o.trading_symbol !== undefined || o.investment_code !== undefined
               || o.symbol_isin !== undefined || o.id !== undefined;
  const hasQty  = hasUnitField(o)
               || o.market_value !== undefined || o.current_value !== undefined
               || o.average_price !== undefined;
  return hasName && hasQty;
}

/* One shape out, whichever broker went in. */
function normalizeHoldingRow(o, sectionHint){
  const name = o.investment || o.title || o.name || o.trading_symbol || o.investment_code || o.symbol_isin || '';
  const code = String(o.investment_code || o.symbol_isin || o.id || o.trading_symbol || name).trim();
  const unitsRaw = pickUnits(o);
  const units = unitsRaw === null ? 0 : unitsRaw;
  const avg   = parseIndianNumber(o.average_price);
  // Groww: average_price x quantity is exact; its invested_value string is rounded.
  let invested = (o.invested_amount !== undefined) ? parseIndianNumber(o.invested_amount) : null;
  if(invested === null && avg !== null && units) invested = avg * units;
  if(invested === null) invested = parseIndianNumber(o.invested_value);
  let value = (o.market_value !== undefined) ? parseIndianNumber(o.market_value)
                                             : parseIndianNumber(o.current_value);
  const price = (o.unit_price !== undefined) ? parseIndianNumber(o.unit_price)
              : (value !== null && units ? value/units : avg);
  const section = o.asset_type === 'MF' ? 'MF'
                : o.asset_type === 'US_STOCK' ? 'US_STOCK'
                : o.asset_type === 'STOCK' || o.asset_type === 'IND_STOCK' ? 'STOCK'
                : (assetToSection(o.asset) || o.__assetHint || sectionHint || 'STOCK');
  return {
    investment_code: code,
    investment: name,
    total_units: units,
    unit_price: price === null ? 0 : price,
    market_value: value,                  // null when the broker didn't report one
    invested_amount: invested === null ? 'unknown' : invested,
    broker: o.symbol_isin ? 'Groww' : (o.broker || ''),
    __section: section,
    __noCurrentValue: value === null,
    __noUnits: unitsRaw === null,
  };
}

function collectHoldingRows(v, acc, depth, hint){
  depth = depth || 0;
  if(!v || depth > 8) return acc;
  if(typeof v === 'string'){
    const p = tryParseJSON(v);           // INDmoney's {"result":"<json>"} wrapper
    if(p !== undefined) collectHoldingRows(p, acc, depth+1, hint);
    return acc;
  }
  const take = function(x){
    // The wrapper knew what these were; the row itself may not say.
    if(hint && x.__assetHint === undefined) x.__assetHint = hint;
    acc.push(x);
  };
  if(Array.isArray(v)){
    if(v.some(looksLikeHolding)) v.forEach(x=>{ if(looksLikeHolding(x)) take(x); });
    else v.forEach(x=>collectHoldingRows(x, acc, depth+1, hint));
    return acc;
  }
  if(typeof v === 'object'){
    if(looksLikeHolding(v)){ take(v); return acc; }
    const down = assetToSection(v.asset) || assetToSection(v.asset_type) || hint;
    Object.keys(v).forEach(k=>collectHoldingRows(v[k], acc, depth+1, down));
  }
  return acc;
}

/* A net-worth snapshot paste: the asset-class layer (EPF, RSUs, Gold, NPS,
   FD…) that never appears in a holdings list. */
function parsePastedSnapshot(text){
  let found = null;
  function scan(v, depth){
    if(!v || found || depth > 8) return;
    if(typeof v === 'string'){ const p = tryParseJSON(v); if(p !== undefined) scan(p, depth+1); return; }
    if(Array.isArray(v)){ v.forEach(x=>scan(x, depth+1)); return; }
    if(typeof v === 'object'){
      if(Array.isArray(v.investments) &&
         v.investments.some(a=>a && a.asset_type !== undefined && a.current_value !== undefined)){
        found = v; return;
      }
      Object.keys(v).forEach(k=>scan(v[k], depth+1));
    }
  }
  extractJsonBlobs(text).forEach(b=>scan(b, 0));
  if(!found) return null;
  const rows = found.investments
    .filter(a=>a && a.asset_type !== undefined)
    .map(a=>({
      asset_type: String(a.asset_type),
      current_value: parseIndianNumber(a.current_value) || 0,
      invested_value: parseIndianNumber(a.invested_value) || 0,
    }));
  return {
    rows: rows,
    total: parseIndianNumber(found.total_networth) || parseIndianNumber(found.total_current_value) || null,
  };
}

function parsePastedHoldings(text, sectionHint){
  const raw = [];
  extractJsonBlobs(text).forEach(b=>collectHoldingRows(b, raw, 0, null));
  const seen = {}, clean = [];
  raw.forEach(r=>{
    const row = normalizeHoldingRow(r, sectionHint);
    if(!row.investment_code || seen[row.investment_code]) return;
    seen[row.investment_code] = true;
    clean.push(row);
  });
  const sections = {}, noValue = [], noUnits = [];
  clean.forEach(r=>{
    sections[r.__section] = (sections[r.__section]||0) + 1;
    if(r.__noCurrentValue) noValue.push(r.investment);
    if(r.__noUnits) noUnits.push(r.investment);
  });
  return {rows: clean, sections: sections, noValue: noValue, noUnits: noUnits};
}

/* Compares two captures into an actual-vs-expected picture. */
/* Brokers re-code the same fund between exports — "INDS12345" one month, a bare
   numeric id the next, sometimes a ticker in place of the full name. Matching on
   code alone then reads one position as two: the old one silently vanishes and
   the new one books its ENTIRE value as a contribution. So a holding is matched
   on every identity it offers. */
/* Words carrying no identity — every fund has them, so they must not count
   toward a match or "HDFC Nifty ETF" would look like "ICICI Nifty ETF". */
/* Words carrying no identity — every fund has them, so they must not count
   toward a match or "HDFC Nifty ETF" would look like "ICICI Nifty ETF".
   NOTE: "direct" and "regular" are deliberately NOT here. They look like
   boilerplate but they separate two genuinely different plans of the same
   fund — both of which can be held at once. */
const NAME_NOISE = ['etf','fund','funds','plan','growth','option','options',
                    'scheme','ltd','limited','the','series','trust','index','com','inc',
                    'corporation','corp','of'];

/* The only words a longer name may add and still be the same holding. Every
   one is a family or exchange label; none of them changes what is tracked. */
const ALLOW_EXTRA = ['nifty','nse','bse','sensex','india','indian','bees','s','p'];

function nameFlat(n){ return String(n||'').toLowerCase().replace(/[^a-z0-9]/g,''); }
function nameTokens(n){
  return String(n||'').toLowerCase().split(/[^a-z0-9]+/)
         .filter(t=>t && NAME_NOISE.indexOf(t) === -1);
}
/* "Motilal Oswal Midcap 100 ETF" -> "mom100", which is exactly what a different
   export calls it. Initials of the meaningful words, then the digits. */
function nameAcronym(n){
  const t = nameTokens(n);
  return t.filter(x=>/^[a-z]+$/.test(x)).map(x=>x[0]).join('')
       + t.filter(x=>/^[0-9]+$/.test(x)).join('');
}

/* How confident are we that two rows are the same holding? Higher is stronger,
   0 is no. Graded rather than boolean so the caller can demand a clear winner
   and refuse an ambiguous one — a wrong link is worse than asking. */
function matchScore(a, aCode, b, bCode){
  const ac = String(aCode||'').trim().toUpperCase();
  const bc = String(bCode||'').trim().toUpperCase();
  if(ac && ac === bc) return 100;                       // same code — settled

  /* Checked BEFORE any name reasoning: two different asset classes are never
     the same holding, however alike they read. */
  if(a && b && a.section && b.section && a.section !== b.section) return 0;

  const af = nameFlat(a && a.name), bf = nameFlat(b && b.name);
  if(!af || !bf) return 0;
  if(af === bf) return 90;                              // same name, punctuation aside

  const short = af.length <= bf.length ? af : bf;
  const long  = af.length <= bf.length ? bf : af;

  /* A ticker against a full name: "MOM100" is the initials of Motilal Oswal
     Midcap plus its number. Only applied when one side really is short, so two
     full names can never collide this way — "Parag Parikh ... Direct" and
     "... Regular" both reduce to the same initials and are genuinely different
     funds. */
  if(short.length <= 12 && long.length >= 12){
    const aa = nameAcronym(a && a.name), ba = nameAcronym(b && b.name);
    if((aa && aa === bf) || (ba && ba === af)) return 70;
  }

  /* One name wholly inside the other — "Vanguard S&P 500" in "Vanguard S&P 500
     ETF". Substring, not shared words, because shared words are what makes
     "HDFC Nifty 250" look like "ICICI Nifty 250". */
  if(short.length >= 8 && long.indexOf(short) >= 0) return 65;

  /* The same, but tolerant of a word inserted in the MIDDLE: "Nippon India ETF
     Bank BeES" against "Nippon India ETF Nifty Bank BeES" is one holding, yet
     no substring test can see it. Every meaningful word of the shorter name
     must appear in the longer one — a subset, not an overlap, which is what
     keeps "HDFC …" away from "ICICI …" and "Nifty 50" away from "Nifty Bank",
     since each of those has a word the other lacks. Three-word minimum, so
     "Tata Motors" cannot swallow "Tata Motors Passenger Vehicles". */
  const at = nameTokens(a && a.name), bt = nameTokens(b && b.name);
  if(at.length && bt.length){
    const few = at.length <= bt.length ? at : bt;
    const many = at.length <= bt.length ? bt : at;
    if(few.length >= 3){
      const inMany = {}; many.forEach(t=>{ inMany[t] = 1; });
      if(few.every(t=>inMany[t])){
        /* Subset alone is not enough. "Nifty 50 BeES" is a strict subset of
           "Nifty NEXT 50 JUNIOR BeES" and they are different funds you hold at
           once. So the longer name may carry at most one extra word, and only a
           connective one — an index family, never a word like "next", "junior",
           "bank" or a number, each of which changes which basket it tracks. */
        const inFew = {}; few.forEach(t=>{ inFew[t] = 1; });
        const extra = many.filter(t=>!inFew[t]);
        if(extra.length === 0) return 62;
        if(extra.length === 1 && ALLOW_EXTRA.indexOf(extra[0]) >= 0) return 60;
      }
    }
  }

  return 0;
}

function holdingIdentities(h, code){
  const out = [];
  if(code) out.push('c:' + String(code).trim().toUpperCase());
  const n = nameFlat(h && h.name);
  if(n.length > 3) out.push('n:' + n);
  return out;
}

function diffCaptures(prev, cur){
  const perFund = [];
  let exact = 0, estimated = 0;

  /* Index the previous reading under each of its identities, then resolve every
     current holding against it. A hand-made link wins over everything. */
  const idx = {}, used = {};
  Object.keys(prev.holdings).forEach(c=>{
    holdingIdentities(prev.holdings[c], c).forEach(k=>{ if(idx[k] === undefined) idx[k] = c; });
  });
  const aliases = (typeof STATE !== 'undefined' && STATE.holdingAliases) || {};

  Object.keys(cur.holdings).forEach(code=>{
    const b = cur.holdings[code];
    let pc = null, matchHow = 0;
    if(aliases[code] && prev.holdings[aliases[code]] && !used[aliases[code]]){ pc = aliases[code]; matchHow = 100; }
    if(!pc){
      /* Score every unclaimed holding from the previous reading and take the
         best — but only when it clearly beats the runner-up, because a tie is a
         guess. Anything unresolved falls through to "needs linking". */
      let bestC = null, best = 0, second = 0;
      Object.keys(prev.holdings).forEach(c=>{
        if(used[c]) return;
        const sc = matchScore(prev.holdings[c], c, b, code);
        if(sc > best){ second = best; best = sc; bestC = c; }
        else if(sc > second) second = sc;
      });
      if(best >= 50 && best > second) pc = bestC;
      if(pc) matchHow = best;
    }
    if(pc) used[pc] = true;
    const matched = !!pc;
    const a = matched ? prev.holdings[pc] : {units:0, invested:null, name:b.name, price:0};

    /* A holding that reported units last time, still carries value, and now
       reports zero has a MISSING unit count — an export that omitted the
       quantity — not a liquidated position. Reading it as a sale invents a large
       negative contribution out of nothing, so it is flagged instead. */
    const aU = Number(a.units) || 0;
    const bU = Number(b.units) || 0;
    const unitsMissing = b.tracksUnits !== false && (
        b.unitsKnown === false
     || (bU === 0 && aU > 0 && (Number(b.value)||0) > 0));
    const unitsAdded = unitsMissing ? 0 : (bU - aU);
    const isNewHolding = !matched;

    let rupees = null, exactRupees = false;
    if(typeof b.invested === 'number' && typeof a.invested === 'number'){
      rupees = b.invested - a.invested; exactRupees = true;
    } else if(typeof b.invested === 'number' && a.invested === null && isNewHolding){
      rupees = b.invested; exactRupees = true;
    } else if(typeof b.invested === 'number' && a.invested === null){
      /* The holding already existed; a cost basis has simply become known. That
         is new INFORMATION, not new money, and booking the full basis here would
         overstate the period badly. */
      rupees = unitsAdded !== 0 ? unitsAdded * (Number(b.price)||0) : 0;
    } else if(unitsMissing){
      rupees = 0;
    } else if(unitsAdded !== 0){
      rupees = unitsAdded * (Number(b.price)||0);
    } else {
      rupees = 0;
    }

    /* A holding seen for the first time books its whole cost basis as money
       contributed. When that single figure exceeds the entire monthly plan it is
       far more likely a re-coded fund than a genuine lump sum, so it is held back
       and shown for confirmation rather than quietly added. */
    const planMonth = Number(cur.expected) || 0;
    const suspectRecode = isNewHolding && !aliases[code] && rupees > 0 && planMonth > 0 && rupees > planMonth;
    const rupeesRaw = rupees;
    if(suspectRecode) rupees = 0;

    if(exactRupees) exact += rupees; else estimated += rupees;
    perFund.push({
      suspectRecode, rupeesRaw, matched, unitsMissing,
      code, name:b.name, section:b.section,
      unitsBefore:Number(a.units)||0, unitsAfter:Number(b.units)||0,
      unitsAdded, rupees, exactRupees, matchHow,
      investedBefore: (typeof a.invested === 'number') ? a.invested : null,
      investedAfter:  (typeof b.invested === 'number') ? b.invested : null,
      /* The exact change in money put in — null when either side never reported
         a cost basis, in which case `rupees` holds the units-based estimate. */
      amountAdded: (typeof a.invested === 'number' && typeof b.invested === 'number')
                     ? (b.invested - a.invested) : null,
      valueAfter: Number(b.value)||0,
      price: Number(b.price)||0,
      tracksUnits: b.tracksUnits !== false,
    });
  });

  /* Everything in the previous reading that nothing here matched. Paired with
     the suspects above, this is what a re-code looks like from both ends. */
  const vanished = Object.keys(prev.holdings)
    .filter(c=>!used[c])
    .map(c=>({code:c, name:prev.holdings[c].name, section:prev.holdings[c].section,
              units:Number(prev.holdings[c].units)||0, value:Number(prev.holdings[c].value)||0}));

  perFund.sort((x,y)=> Math.abs(y.rupees) - Math.abs(x.rupees));
  const months = Math.max(1, monthsBetween(prev.ym, cur.ym));
  /* Each reading records the planned SIP at the time it was taken. If those
     differ — an April step-up landed in between — applying only the later
     figure to every month overstates what was ever due. Without knowing which
     month it changed, the midpoint is the honest estimate, and it is labelled
     as one rather than presented as exact. */
  const eA = Number(prev.expected) || 0;
  const eB = Number(cur.expected)  || 0;
  const expectedExact = (eA === eB);
  const expected = expectedExact ? eB * months : ((eA + eB) / 2) * months;
  const expectedRange = expectedExact ? null
    : {lo: Math.min(eA,eB) * months, hi: Math.max(eA,eB) * months, from: eA, to: eB};
  const actual = exact + estimated;
  const suspects = perFund.filter(f=>f.suspectRecode);
  return {perFund, exact, estimated, actual, expected, expectedExact, expectedRange,
          months, variance: actual - expected, vanished, suspects};
}

function contribPeriods(){
  const snaps = (STATE.contribSnaps || []).slice().sort((a,b)=> a.ym < b.ym ? -1 : (a.ym > b.ym ? 1 : 0));
  const out = [];
  for(let i=1; i<snaps.length; i++) out.push(Object.assign({from:snaps[i-1].ym, to:snaps[i].ym}, diffCaptures(snaps[i-1], snaps[i])));
  return out;
}

function renderContrib(){
  const el = document.getElementById('panel-contrib');
  if(!Array.isArray(STATE.contribSnaps)) STATE.contribSnaps = [];
  const snaps = STATE.contribSnaps.slice().sort((a,b)=> a.ym < b.ym ? -1 : (a.ym > b.ym ? 1 : 0));
  const thisYM = ymOf(new Date());
  const haveThis = snaps.some(s=>s.ym === thisYM);
  const periods = contribPeriods();
  const latest = periods.length ? periods[periods.length-1] : null;
  const cumVar = periods.reduce((s,p)=>s+p.variance, 0);
  const ready = liveHoldingsReady();

  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Contributions</h2>
        <p>Whether the money actually went in each month, and how that compares with the ₹${fmtINR(totalSIP()).slice(1)} you planned. Take one reading a month — the gap between readings is what you invested.</p>
      </div>
      <button class="refresh-btn" id="capture-btn"${ready?'':' disabled'}>${haveThis?'↻ Update':'+ Take'} this month's reading</button>
    </div>

    ${!ready ? `<div class="notice info"><b>Live data hasn't loaded yet</b>Import your holdings on the Import portfolio tab first — readings are built from them.</div>` : ''}


    ${snaps.length === 0 ? `
      <div class="notice info" style="margin-top:14px;">
        <b>No readings yet</b>
        Take your first reading now to set the baseline. From next month, each new reading shows exactly what went in — per fund — and whether it matched the plan. Nothing can be computed for the past; this builds up from today forward.
      </div>` : ''}

    ${snaps.length === 1 ? `
      <div class="notice ok" style="margin-top:14px;">
        <b>Baseline set — ${ymLabel(snaps[0].ym)}</b>
        Come back next month and take another reading. The difference between the two is your actual contribution.
      </div>` : ''}

    ${latest ? `
      <div class="result-row" style="margin-top:18px;">
        <div class="card stat-tile"><div class="l">Expected${latest.months>1?' ('+latest.months+' months)':''}</div>
          <div class="v num">${fmtINR(latest.expected)}${latest.expectedExact?'':' <span style="font-size:11px;color:var(--ink-muted);">est</span>'}</div>
          <div class="sub">${ymLabel(latest.from)} → ${ymLabel(latest.to)}${latest.expectedExact ? ''
            : ' · the plan moved from '+fmtINR(latest.expectedRange.from)+' to '+fmtINR(latest.expectedRange.to)
              +'/mo in this window, so this sits between '+fmtINR(latest.expectedRange.lo)+' and '+fmtINR(latest.expectedRange.hi)}</div></div>
        <div class="card stat-tile"><div class="l">Actually invested</div><div class="v num">${fmtINR(latest.actual)}</div><div class="sub">${latest.estimated ? fmtINR(latest.exact)+' exact + '+fmtINR(latest.estimated)+' estimated' : 'all figures exact'}</div></div>
        <div class="card stat-tile"><div class="l">Variance</div><div class="v num ${latest.variance>=0?'pnl-pos':'pnl-neg'}">${latest.variance>=0?'+':''}${fmtINR(latest.variance)}</div><div class="sub">${latest.variance>=0?'ahead of plan':'short of plan'}</div></div>
        <div class="card stat-tile"><div class="l">Cumulative variance</div><div class="v num ${cumVar>=0?'pnl-pos':'pnl-neg'}">${cumVar>=0?'+':''}${fmtINR(cumVar)}</div><div class="sub">across ${periods.length} period${periods.length===1?'':'s'}</div></div>
      </div>

      <section class="block" style="margin-top:26px;">
        <div class="block-title">Did each SIP execute? · ${ymLabel(latest.from)} → ${ymLabel(latest.to)}</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th class="name">Fund</th><th>Invested before</th><th>Invested after</th><th>Invested added</th><th>Counted</th><th>Status</th></tr></thead>
            <tbody>
              ${latest.perFund.map(f=>{
                // Off-platform holdings have no units — judge those on rupees.
                /* Money decides. Units only stand in when no cost basis exists. */
                const delta  = (f.amountAdded !== null) ? f.amountAdded : f.rupees;
                const bought = f.suspectRecode ? false : delta > 0;
                const sold   = f.suspectRecode ? false : delta < 0;
                const st = f.suspectRecode ? 'missing' : (bought ? 'held' : 'missing');
                const lbl = f.suspectRecode ? 'Needs linking' : (bought ? 'Invested' : (sold ? 'Sold' : 'No purchase'));
                /* Units are still shown, but under the name — the money put in is
                   the measurement, and units are the corroborating detail. */
                const uSub = f.unitsMissing ? 'units not reported'
                           : (f.tracksUnits && (f.unitsBefore || f.unitsAfter)
                                ? f.unitsBefore.toLocaleString('en-IN',{maximumFractionDigits:2}) + ' \u2192 ' +
                                  f.unitsAfter.toLocaleString('en-IN',{maximumFractionDigits:2}) + ' units'
                                : '');
                return `<tr>
                  <td class="name">${f.name}<div class="recon-sub">${assetLabel(f.section)}${uSub?' · '+uSub:''}</div></td>
                  <td class="amt">${f.investedBefore === null ? '<span style="color:var(--ink-muted);">—</span>' : fmtINR(f.investedBefore)}</td>
                  <td class="amt">${f.investedAfter === null ? '<span style="color:var(--ink-muted);">—</span>' : fmtINR(f.investedAfter)}</td>
                  <td class="amt ${bought?'pnl-pos':(sold?'pnl-neg':'')}">${f.amountAdded === null
                      ? '<span style="color:var(--ink-muted);" title="No cost basis recorded on one side of this period, so the money put in cannot be measured directly. The Counted column falls back to units added times price.">—</span>'
                      : (f.amountAdded>0?'+':'') + fmtINR(f.amountAdded)}</td>
                  <td class="amt">${f.suspectRecode
                      ? '<span style="color:var(--ink-muted);" title="Held back - see the note below the table.">not counted</span>'
                      : fmtINR(f.rupees) + (f.exactRupees?'':' <span style="color:var(--ink-muted);font-size:10px;">est</span>')}</td>
                  <td><span class="recon-status ${st}">${lbl}</span></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        ${latest.suspects.length ? `<div class="notice warn" style="margin-top:12px;">
          <b>${latest.suspects.length} holding${latest.suspects.length>1?'s look':' looks'} re-coded, not newly bought</b>
          Your broker gave ${latest.suspects.length>1?'these':'this'} a different code or name than last reading, so the
          ledger cannot see the earlier units and would otherwise book the whole position as this month's contribution.
          ${latest.vanished.length ? 'Link each one to the holding it replaced and the pairing is remembered from now on.'
                                   : 'Nothing in the previous reading is left unmatched, so these may genuinely be new.'}
          <div style="margin-top:10px;display:flex;flex-direction:column;gap:8px;">
            ${latest.suspects.map(sf=>`
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <span style="min-width:190px;"><b>${sf.name}</b>
                  <span style="color:var(--ink-muted);"> — would add ${fmtINR(sf.rupeesRaw)}</span></span>
                <select data-linknew="${sf.code}" style="flex:1;min-width:220px;">
                  <option value="">Genuinely new — count it</option>
                  ${latest.vanished.map(v=>`<option value="${v.code}">was: ${v.name} (${v.units.toLocaleString('en-IN',{maximumFractionDigits:4})} units)</option>`).join('')}
                </select>
              </div>`).join('')}
          </div>
        </div>` : ''}
        <p class="footnote">Expected is the planned SIP recorded at each reading; where the two disagree it's marked <b>est</b> and shown as the midpoint.
           <b>Invested</b> is the cost basis recorded at each reading — money paid in, never current market value —
           so the difference between them is exactly what you contributed, unaffected by how the market moved.
           Units appear under each name as corroboration.
           Rows marked <b>est</b> are holdings where the broker reports no purchase price: there the amount falls back
           to units added × today's price, close but not exact.</p>
      </section>` : ''}

    ${periods.length ? `
      <section class="block">
        <div class="block-title">Month by month</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th class="name">Period</th><th>Expected</th><th>Invested</th><th>Variance</th><th>Running</th></tr></thead>
            <tbody>
              ${(function(){ let run=0; return periods.map((p,i)=>{ run+=p.variance; return `<tr class="clickable" data-period="${i}">
                  <td class="name">${ymLabel(p.from)} → ${ymLabel(p.to)}${p.months>1?`<div class="recon-sub">${p.months} months</div>`:''}</td>
                  <td class="amt">${fmtINR(p.expected)}${p.expectedExact?'':' <span style="color:var(--ink-muted);font-size:10px;">est</span>'}</td>
                  <td class="amt">${fmtINR(p.actual)}</td>
                  <td class="amt ${p.variance>=0?'pnl-pos':'pnl-neg'}">${p.variance>=0?'+':''}${fmtINR(p.variance)}</td>
                  <td class="amt ${run>=0?'pnl-pos':'pnl-neg'}">${run>=0?'+':''}${fmtINR(run)}</td>
                </tr>`; }).join(''); })()}
            </tbody>
          </table>
        </div>
      </section>` : ''}

    ${snaps.length ? `
      <section class="block">
        <div class="block-title">Readings taken</div>
        <div class="snap-list">
          ${snaps.slice().reverse().map(s=>{
            const hs = Object.keys(s.holdings||{});
            let inv = 0, anyInv = false;
            hs.forEach(k=>{ const h=s.holdings[k]; if(typeof h.invested === 'number'){ inv += h.invested; anyInv = true; } });
            return `
            <div class="snap-item">
              <span class="sdate">${ymLabel(s.ym)}</span>
              <span class="sval">${hs.length} holdings</span>
              <span class="snote">taken ${fmtDate(s.date)} · plan ${fmtINR(s.expected)}/mo${anyInv?' · cost basis '+fmtCompact(inv):''}</span>
              <button class="reset-btn" data-viewcap="${s.id}" style="padding:5px 11px;font-size:11.5px;">Details</button>
              <button class="del-btn" data-delcap="${s.id}" aria-label="Remove reading">✕</button>
            </div>`;
          }).join('')}
        </div>
      </section>` : ''}
  `;

  el.querySelectorAll('[data-period]').forEach(tr=>{
    tr.addEventListener('click', ()=>{
      const p = periods[Number(tr.dataset.period)];
      if(!p) return;
      openModal(
        `${ymLabel(p.from)} → ${ymLabel(p.to)}`,
        `Expected ${fmtINR(p.expected)}${p.expectedExact?'':' (estimated)'}${p.months>1?' over '+p.months+' months':''} · invested ${fmtINR(p.actual)} · ` +
        `<span class="${p.variance>=0?'pnl-pos':'pnl-neg'}">${p.variance>=0?'ahead by ':'short by '}${fmtINR(Math.abs(p.variance))}</span>`,
        `${p.expectedExact ? '' : `<div class="notice warn" style="margin-bottom:14px;">
           <b>The planned SIP changed inside this window</b>
           It was ${fmtINR(p.expectedRange.from)}/month at the first reading and ${fmtINR(p.expectedRange.to)}/month at the second.
           The readings don't record which month it moved, so “expected” is the midpoint — the true figure lies
           between ${fmtINR(p.expectedRange.lo)} and ${fmtINR(p.expectedRange.hi)}.
         </div>`}
         <p style="font-size:13px;color:var(--ink-secondary);margin-bottom:14px;">
           Every holding compared across the two readings. <b>Invested</b> is the recorded cost basis — the money
           you actually put in, not what the holding is worth today — so the difference between the two readings
           is your contribution, unaffected by market movement. Units are shown alongside as corroboration. Where
           a broker reports no cost basis, <b>Counted</b> falls back to units added × price and is marked <b>est</b>.
         </p>
         <div class="table-wrap">
           <table>
             <thead><tr><th class="name">Holding</th><th>Invested before</th><th>Invested after</th><th>Invested added</th><th>Units before</th><th>Units after</th><th>Counted</th></tr></thead>
             <tbody>
               ${p.perFund.map(f=>{
                 const delta  = (f.amountAdded !== null) ? f.amountAdded : f.rupees;
                 const bought = f.suspectRecode ? false : delta > 0;
                 const sold   = f.suspectRecode ? false : delta < 0;
                 const note   = f.suspectRecode ? ' · needs linking' : (bought ? '' : (sold ? ' · sold' : ' · no purchase'));
                 return `<tr>
                   <td class="name">${f.name}<div class="recon-sub">${assetLabel(f.section)}${note}</div></td>
                   <td class="amt">${f.investedBefore===null?'<span style="color:var(--ink-muted);">—</span>':fmtINR(f.investedBefore)}</td>
                   <td class="amt">${f.investedAfter===null?'<span style="color:var(--ink-muted);">—</span>':fmtINR(f.investedAfter)}</td>
                   <td class="amt ${bought?'pnl-pos':(sold?'pnl-neg':'')}">${f.amountAdded === null
                       ? '<span style="color:var(--ink-muted);" title="No cost basis on one side, so the change in money cannot be measured directly.">—</span>'
                       : (f.amountAdded>0?'+':'')+fmtINR(f.amountAdded)}</td>
                   <td class="amt">${f.tracksUnits ? f.unitsBefore.toLocaleString('en-IN',{maximumFractionDigits:2}) : '—'}</td>
                   <td class="amt">${f.unitsMissing ? '<span title="This reading carried no unit count. Not zero units - unknown." style="color:var(--ink-muted);">not reported</span>' : (f.tracksUnits ? f.unitsAfter.toLocaleString('en-IN',{maximumFractionDigits:2}) : '—')}</td>
                   <td class="amt">${f.suspectRecode ? '<span style="color:var(--ink-muted);">not counted</span>' : fmtINR(f.rupees) + (f.exactRupees?'':' <span style="color:var(--ink-muted);font-size:10px;">est</span>')}</td>
                 </tr>`;
               }).join('')}
             </tbody>
             <tfoot>
               <tr><td>Total counted</td><td colspan="5"></td><td>${fmtINR(p.actual)}</td></tr>
             </tfoot>
           </table>
         </div>
         <p class="footnote">${fmtINR(p.exact)} from recorded cost basis${p.estimated?` · ${fmtINR(p.estimated)} estimated from unit changes`:''}.</p>`
      );
    });
  });

  const cb = document.getElementById('capture-btn');
  if(cb && ready){
    cb.addEventListener('click', ()=>{
      const cap = buildCapture();
      /* Catch a degraded reading as it is taken, not a month later once it has
         already skewed a contribution figure. */
      const missing = Object.keys(cap.holdings)
        .filter(k=>cap.holdings[k].unitsKnown === false)
        .map(k=>cap.holdings[k].name);
      if(missing.length && !confirm(
          'This reading has no unit count for ' + missing.length + ' holding(s):\n\n  ' +
          missing.join('\n  ') +
          '\n\nRupee figures are fine and contributions still come from cost basis, ' +
          'but no buy or sell can be inferred for these.\n\n' +
          'Re-export with quantities for a complete reading, or save it anyway?')) return;
      STATE.contribSnaps = (STATE.contribSnaps || []).filter(s=>s.ym !== cap.ym);
      STATE.contribSnaps.push(cap);
      markDirty();
      renderContrib();
    });
  }
  el.querySelectorAll('[data-viewcap]').forEach(b=>{
    b.addEventListener('click', ()=>{
      const s = STATE.contribSnaps.filter(x=>x.id === b.dataset.viewcap)[0];
      if(!s) return;
      const rows = Object.keys(s.holdings||{}).map(k=>Object.assign({code:k}, s.holdings[k]));
      rows.sort((a,b2)=>(Number(b2.value)||0)-(Number(a.value)||0));
      let totInv = 0, totVal = 0, anyInv = false;
      rows.forEach(r=>{ totVal += Number(r.value)||0; if(typeof r.invested === 'number'){ totInv += r.invested; anyInv = true; } });
      openModal(
        `Reading — ${ymLabel(s.ym)}`,
        `Taken ${fmtDate(s.date)} · ${rows.length} holdings · plan was ${fmtINR(s.expected)}/month`,
        `<p style="font-size:13px;color:var(--ink-secondary);margin-bottom:14px;">
           Exactly what was recorded at this reading. Comparing two of these is what produces the contribution figures.
         </p>
         <div class="table-wrap">
           <table>
             <thead><tr><th class="name">Holding</th><th>Units</th><th>Price</th><th>Invested</th><th>Value</th><th>P&amp;L</th></tr></thead>
             <tbody>
               ${rows.map(r=>{
                 const pl = (typeof r.invested === 'number') ? (Number(r.value)||0) - r.invested : null;
                 return `<tr>
                   <td class="name">${r.name}<div class="recon-sub">${assetLabel(r.section)}${r.costFromApi===false?' · cost entered by you':''}</div></td>
                   <td class="amt">${r.unitsKnown === false
                       ? '<span style="color:var(--ink-muted);" title="The export behind this reading carried no unit count. Not zero units - unknown.">not reported</span>'
                       : (Number(r.units)||0).toLocaleString('en-IN',{maximumFractionDigits:4})}</td>
                   <td class="amt">${fmtINR(r.price)}</td>
                   <td class="amt">${typeof r.invested==='number'?fmtINR(r.invested):'—'}</td>
                   <td class="amt">${fmtINR(r.value)}</td>
                   <td class="amt ${pl===null?'':(pl>=0?'pnl-pos':'pnl-neg')}">${pl===null?'—':(pl>=0?'+':'')+fmtINR(pl)}</td>
                 </tr>`;
               }).join('')}
             </tbody>
             <tfoot><tr><td>Total</td><td colspan="2"></td><td>${anyInv?fmtCompact(totInv):'—'}</td><td>${fmtCompact(totVal)}</td><td>${anyInv?((totVal-totInv)>=0?'+':'')+fmtCompact(totVal-totInv):'—'}</td></tr></tfoot>
           </table>
         </div>
         <p class="footnote">A “—” in Invested means no cost basis was known at the time. Fill those in on the Import portfolio tab and future readings will carry them.</p>`
      );
    });
  });
  /* Linking a re-coded holding to the one it replaced. Stored on STATE, so it is
     remembered for every future reading rather than asked again each month. */
  el.querySelectorAll('[data-linknew]').forEach(sel=>{
    sel.value = STATE.holdingAliases[sel.dataset.linknew] || '';
    sel.addEventListener('change', ()=>{
      pushUndo('linking a re-coded holding');
      if(sel.value) STATE.holdingAliases[sel.dataset.linknew] = sel.value;
      else delete STATE.holdingAliases[sel.dataset.linknew];
      markDirty();
      renderContrib();
    });
  });
  el.querySelectorAll('[data-delcap]').forEach(b=>{
    b.addEventListener('click', ()=>{
      pushUndo('removing a reading');
      STATE.contribSnaps = STATE.contribSnaps.filter(s=>s.id !== b.dataset.delcap);
      markDirty();
      renderContrib();
    });
  });
}

/* =========================================================
   PANEL: CHECKS — the golden rules, made automatic.

   Everything here is computed from data already in the page:
   the plan (Portfolio tab), what you actually hold (imports),
   and your check-in history. Nothing is fetched.
   ========================================================= */

/* Planned split vs. what you actually hold. Compared only across funds
   that matched a real holding, because the planned split is a share of
   NEW money each month while the corpus also contains EPF, RSUs and gold
   that predate the plan entirely — mixing the two would be meaningless. */
function planVsActual(){
  const recon = reconcilePlan();
  const held = recon.rows.filter(r=>r.matches.length > 0 && r.value > 0);
  const totalActual  = held.reduce((s,r)=>s + r.value, 0);
  const totalPlanned = held.reduce((s,r)=>s + (Number(r.fund.monthly)||0), 0);
  const unmatched = recon.rows.filter(r=>!r.matches.length).map(r=>r.fund.name);
  if(!totalActual || !totalPlanned) return {rows:[], totalActual:0, totalPlanned:0, unmatched};
  const rows = held.map(r=>{
    const planned = (Number(r.fund.monthly)||0) / totalPlanned;
    const actual  = r.value / totalActual;
    return {name:r.fund.name, monthly:Number(r.fund.monthly)||0, value:r.value,
            planned, actual, drift: actual - planned};
  });
  rows.sort((a,b)=>Math.abs(b.drift) - Math.abs(a.drift));
  return {rows, totalActual, totalPlanned, unmatched};
}

/* What counts as crypto for the 5% rule. Reading the holding's own name was
   fragile — rename the row and the rule stopped firing with no sign it had.
   This asks the plan instead, and reports when it finds nothing to check. */
function isCryptoFund(f){
  return /crypto|bitcoin|btc\b/i.test(String(f.cls||'') + ' ' + String(f.name||''));
}
function cryptoHoldings(){
  const out = [], seen = {};
  const inv = (LIVE.snapshot && Array.isArray(LIVE.snapshot.investments)) ? LIVE.snapshot.investments : [];
  inv.forEach(a=>{
    if(String(a.asset_type).toUpperCase() !== 'CRYPTO') return;
    out.push({name: assetLabel(a.asset_type), value: Number(a.current_value)||0});
  });
  reconcilePlan().rows.forEach(r=>{
    if(!isCryptoFund(r.fund)) return;
    r.matches.forEach(m=>{
      const k = String(m.investment_code || m.investment);
      if(seen[k]) return;
      seen[k] = 1;
      out.push({name: m.investment, value: Number(m.market_value)||0});
    });
  });
  return out;
}

/* Your written rules, evaluated against today's numbers. */
function ruleAlerts(){
  const out = [];
  const corpus = corpusFigure();

  const cryptoRows = cryptoHoldings();
  const crypto = cryptoRows.reduce((s,h)=>s + h.value, 0);
  const plannedCrypto = STATE.indiaFunds.concat(STATE.usFunds).filter(isCryptoFund);
  if(corpus > 0 && crypto > 0){
    const share = crypto / corpus;
    const over = share > 0.05;
    out.push({level: over ? 'warning' : 'good',
      title: over ? 'Bitcoin is over its 5% ceiling' : 'Bitcoin is inside its 5% ceiling',
      body: fmtCompact(crypto) + ' of ' + fmtCompact(corpus) + ' — ' + fmtPct(share) + '. '
            + (over ? 'Your age-45 rule trims 30% once it passes 5%.'
                    : 'The age-45 rule trims 30% above 5%.')
            + ' Counting: ' + cryptoRows.map(h=>h.name).join(', ') + '.'});
  } else if(corpus > 0 && plannedCrypto.length){
    /* Loud rather than silent — a rule that quietly stops checking is worse
       than one that says it can't. */
    out.push({level:'warning', title:'The 5% crypto rule has nothing to check',
      body:'Your plan holds ' + plannedCrypto.map(f=>f.name).join(', ')
           + ', but nothing in your imported or hand-tracked holdings matched it, so the ceiling isn\'t being watched. '
           + 'Add it under “Holdings INDmoney can\'t see”, or give it a name the plan recognises.'});
  }

  const holds = allLiveHoldings().filter(h=>(Number(h.market_value)||0) > 0);
  if(corpus > 0 && holds.length){
    const top = holds.slice().sort((a,b)=>(Number(b.market_value)||0)-(Number(a.market_value)||0))[0];
    const share = (Number(top.market_value)||0) / corpus;
    if(share > 0.20){
      out.push({level:'warning', title:'One holding is over 20% of the corpus',
        body: top.investment + ' is ' + fmtPct(share) + ' (' + fmtCompact(top.market_value)
              + '). Golden rule 3 is about concentration — worth a look.'});
    }
  }

  const snaps = STATE.snapshots.filter(s=>(Number(s.value)||0) > 0)
    .slice().sort((a,b)=> new Date(a.date) - new Date(b.date));
  if(snaps.length >= 2){
    const latest = snaps[snaps.length-1];
    const peak = snaps.reduce((m,s)=>Math.max(m, Number(s.value)||0), 0);
    const fall = peak > 0 ? (peak - latest.value)/peak : 0;
    if(fall >= 0.15){
      out.push({level:'critical', title:'Down ' + fmtPct(fall) + ' from your peak — deploy the buffer',
        body:'Golden rule 4: a fall past 15% is when the sweep-in FD (' + fmtINR(STATE.buffer)
             + '/month) goes into PPFCF or VOO as a lump sum.'});
    }
  }

  if(livingExpenses() < 0){
    out.push({level:'critical', title:'Over budget by ' + fmtINR(Math.abs(livingExpenses())),
      body:'Salary less every SIP and the buffer is negative. Reduce a SIP or the buffer, or update your salary on the Overview tab.'});
  }

  const periods = contribPeriods();
  if(periods.length){
    const cum = periods.reduce((s,p)=>s + p.variance, 0);
    out.push({level: cum < 0 ? 'warning' : 'good',
      title: cum < 0 ? 'Behind plan by ' + fmtINR(Math.abs(cum))
                     : 'Contributions are on or ahead of plan',
      body: 'Across ' + periods.length + ' period' + (periods.length===1?'':'s') + ' of readings.'});
  }

  if(new Date().getMonth() === 3){
    out.push({level:'warning', title:'It is April — the step-up is due',
      body:'Golden rule 1, the biggest lever in the plan. The checklist on the Action Calendar tab has the new amount for every fund.'});
  }
  return out;
}

/* Money-weighted return. Bisection rather than Newton — slower, but it
   cannot diverge, and this runs once per render. */
function xirr(flows){
  if(flows.length < 2) return null;
  const t0 = flows[0].d.getTime();
  const yrs = f => (f.d.getTime() - t0) / (365.25*24*3600*1000);
  const npv = r => flows.reduce((s,f)=> s + f.amt/Math.pow(1+r, yrs(f)), 0);
  let lo = -0.95, hi = 10;
  if(!isFinite(npv(lo)) || !isFinite(npv(hi)) || npv(lo)*npv(hi) > 0) return null;
  for(let i=0;i<200;i++){
    const mid = (lo+hi)/2;
    if(npv(lo)*npv(mid) <= 0) hi = mid; else lo = mid;
  }
  const r = (lo+hi)/2;
  return isFinite(r) ? r : null;
}

/* What you have actually earned, against the rate every projection assumes.
   The total gain is exact. The annualised rate needs two check-ins that
   BOTH carry a cost basis — the origin point can't be one of them, since
   it predates the asset classes the imports later brought in, and pairing
   it with today would report the import itself as investment growth. */
function actualReturn(){
  const corpus = corpusFigure();
  const ci = corpusInvested();
  const invested = ci.total;
  const gain = corpus - invested;
  const gainPct = invested > 0 ? gain/invested : null;

  const usable = STATE.snapshots
    .filter(s=>typeof s.invested === 'number' && s.invested > 0 && (Number(s.value)||0) > 0)
    .slice().sort((a,b)=> new Date(a.date) - new Date(b.date));

  let rate = null, note = '', added = null;
  if(usable.length >= 2){
    const a = usable[0], b = usable[usable.length-1];
    added = b.invested - a.invested;
    const months = Math.max(1, monthsBetween(ymOf(a.date), ymOf(b.date)));
    const flows = [{d:new Date(a.date), amt:-a.value}];
    for(let i=1;i<=months;i++){
      const d = new Date(a.date);
      d.setMonth(d.getMonth() + i);
      if(d > new Date(b.date)) break;
      flows.push({d, amt: -(added/months)});
    }
    flows.push({d:new Date(b.date), amt: b.value});
    rate = xirr(flows);
    note = fmtDate(a.date) + ' → ' + fmtDate(b.date) + ', with ' + fmtCompact(added)
         + ' added in between, spread evenly across ' + months + ' month' + (months===1?'':'s') + '.';
  } else {
    note = usable.length === 1
      ? 'One check-in so far carries a cost basis. Log another next month and this becomes a real annualised figure.'
      : 'Use “Log this month’s check-in” on the Import portfolio tab — it records current value and cost basis together, which is what this needs.';
  }
  return {corpus, invested, gain, gainPct, rate, note, points: usable.length,
          assumed: STATE.equityRate, unknown: ci.unknown};
}

/* The April step-up, priced out fund by fund. */
function stepUpRows(){
  const pct = Number(STATE.stepUp) || 0;
  const round = v => Math.round(v/50)*50;
  const mk = (f, group) => ({id:f.id, group, name:f.name,
    from: Number(f.monthly)||0, to: round((Number(f.monthly)||0)*(1+pct))});
  const rows = STATE.indiaFunds.map(f=>mk(f,'indiaFunds'))
        .concat(STATE.usFunds.map(f=>mk(f,'usFunds')));
  return {pct, rows,
    totalFrom: rows.reduce((s,r)=>s+r.from,0),
    totalTo:   rows.reduce((s,r)=>s+r.to,0)};
}
function applyStepUp(){
  const su = stepUpRows();
  su.rows.forEach(r=>{
    const f = (STATE[r.group]||[]).filter(x=>x.id===r.id)[0];
    if(f) f.monthly = r.to;
  });
  markDirty();
}

/* Drift says what's off; this says what to do about it. Next month's SIP is
   re-weighted toward whichever funds sit furthest below their planned share,
   rather than split by the plan's own proportions. */
const FLOOR = 0.5;      // no SIP drops below half its usual amount
function rebalanceSuggestion(){
  const pva = planVsActual();
  const sip = totalSIP();
  if(!pva.rows.length || sip <= 0) return null;
  const rows = pva.rows.map(r=>{
    const target = pva.totalActual * r.planned;
    return {name:r.name, monthly:r.monthly, value:r.value, target,
            short: Math.max(0, target - r.value), drift:r.drift};
  });
  const totalShort = rows.reduce((s,r)=>s + r.short, 0);
  if(totalShort <= 0){
    return {rows: rows.map(r=>Object.assign({}, r, {suggested:r.monthly})), sip,
            alreadyBalanced:true, floorPct:FLOOR};
  }
  /* Every fund keeps a floor of its usual amount. Allocating purely by
     shortfall drives the overweight ones to zero, which is stopping a SIP —
     exactly what golden rule 2 forbids. Only the pool above the floors moves. */
  const floors = rows.map(r=>Math.round(r.monthly * FLOOR / 100) * 100);
  const pool = sip - floors.reduce((s,v)=>s + v, 0);
  if(pool <= 0){
    return {rows: rows.map(r=>Object.assign({}, r, {suggested:r.monthly})), sip,
            alreadyBalanced:true, floorPct:FLOOR};
  }
  const alloc = rows.map((r,i)=> floors[i] + Math.round(pool * r.short / totalShort / 100) * 100);
  const drift = sip - alloc.reduce((s,v)=>s + v, 0);      // rounding remainder
  if(drift !== 0){
    let big = 0;
    rows.forEach((r,i)=>{ if(r.short > rows[big].short) big = i; });
    alloc[big] += drift;
  }
  return {rows: rows.map((r,i)=>Object.assign({}, r, {suggested:alloc[i]})), sip,
          alreadyBalanced:false, floorPct:FLOOR};
}

function renderChecks(){
  const el = document.getElementById('panel-checks');
  const alerts = ruleAlerts();
  const pva = planVsActual();
  const ret = actualReturn();
  const ICO = {good:'✓', warning:'!', critical:'!'};

  const driftScale = Math.max(0.08, ...pva.rows.map(r=>Math.abs(r.drift)));

  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Checks</h2>
        <p>Your golden rules and your plan, evaluated against what you actually hold. All computed from data already on this page — nothing is fetched.</p>
      </div>
    </div>

    <section class="block">
      <div class="block-title">Rules</div>
      ${alerts.length
        ? alerts.map(a=>`<div class="alert ${a.level}">
            <span class="ico">${ICO[a.level]}</span>
            <div><h4>${a.title}</h4><p>${a.body}</p></div>
          </div>`).join('')
        : `<div class="notice info"><b>Nothing to check yet</b>Import your holdings and log a check-in — the rules need real numbers to test against.</div>`}
    </section>

    <section class="block">
      <div class="block-title">Drift from your plan</div>
      <div class="card pad">
        ${pva.rows.length ? `
          <p style="font-size:13px;color:var(--ink-secondary);">
            Where your money actually sits, against the share your SIP plan sends there.
            Compared across the ${pva.rows.length} planned fund${pva.rows.length===1?'':'s'} you actually hold
            (${fmtCompact(pva.totalActual)}); EPF, RSUs, physical gold and the rest sit outside the SIP plan and aren't part of this.
          </p>
          ${(function(){
            /* The same fund reads two different percentages across two tabs,
               because the donut on Portfolio divides by the India subtotal
               while this divides by the whole SIP. Say which, with a live
               example rather than a hardcoded one. */
            const indiaBase = sumFunds(STATE.indiaFunds);
            const eg = STATE.indiaFunds.slice().sort((a,b)=>(b.monthly||0)-(a.monthly||0))[0];
            if(!indiaBase || !pva.totalPlanned || !eg) return '';
            return `<p style="font-size:12.5px;color:var(--ink-muted);margin-top:8px;">
              <b style="color:var(--ink-secondary);">Both columns are shares of ${fmtINR(pva.totalPlanned)}/month</b>
              — India and US together — so plan and actual are directly comparable.
              The Portfolio tab's India donut divides by the ${fmtINR(indiaBase)} India subtotal instead,
              so an India fund reads higher there: ${eg.name.split(' (')[0]} is
              ${fmtPct((eg.monthly||0)/indiaBase)} of the India SIP but
              ${fmtPct((eg.monthly||0)/pva.totalPlanned)} of the whole.
            </p>`;
          })()}
          <div style="margin-top:14px;">
            <div class="drift-row drift-head">
              <span>Fund</span><span class="dv">Plan</span><span class="dv hide-sm">Actual</span>
              <span class="dv" style="text-align:center;">under · over</span><span class="dv">Drift</span>
            </div>
            ${pva.rows.map(r=>{
              const w = Math.min(50, (Math.abs(r.drift)/driftScale)*50);
              const over = r.drift >= 0;
              return `<div class="drift-row">
                <span class="dn">${r.name}<div class="recon-sub">${fmtINR(r.monthly)}/mo · ${fmtCompact(r.value)}</div></span>
                <span class="dv">${fmtPct(r.planned)}</span>
                <span class="dv hide-sm">${fmtPct(r.actual)}</span>
                <span class="drift-bar"><span class="mid"></span>
                  <span class="fill" style="${over?'left:50%':'right:50%'};width:${w}%;
                    background:${over?'var(--cat-orange)':'var(--cat-blue)'};"></span></span>
                <span class="drift-amt ${over?'pnl-pos':'pnl-neg'}">${over?'+':'−'}${fmtPct(Math.abs(r.drift))}</span>
              </div>`;
            }).join('')}
          </div>
          ${pva.unmatched.length ? `<p class="footnote">Not counted, because nothing in your imports matched them yet: ${pva.unmatched.join(', ')}.</p>` : ''}
          <p class="footnote">Drift is normal — it's what a rising fund does. It matters when it crosses a rule: golden rule 3 on concentration, or the age-45 Bitcoin ceiling.</p>
        ` : `<div class="notice info"><b>Nothing to compare yet</b>Import your holdings on the Import portfolio tab, and this fills in.</div>`}
      </div>
    </section>

    ${(function(){
      const rb = rebalanceSuggestion();
      if(!rb) return '';
      if(rb.alreadyBalanced) return `<section class="block">
        <div class="block-title">Where next month's SIP should go</div>
        <div class="notice ok">
          <b>Nothing to correct</b>
          Every planned fund is at or above its target share, so the ordinary
          ${fmtINR(rb.sip)} split is the right one this month.
        </div></section>`;
      const moved = rb.rows.reduce((s,r)=>s + Math.max(0, r.suggested - r.monthly), 0);
      return `<section class="block">
        <div class="block-title">Where next month's SIP should go</div>
        <div class="card pad">
          <p style="font-size:13px;color:var(--ink-secondary);">
            The same ${fmtINR(rb.sip)}, weighted toward whatever sits furthest below its planned share.
            This buys the laggards rather than selling the leaders, so nothing is realised and no tax is triggered.
            Every fund keeps at least ${fmtPct(rb.floorPct,0)} of its usual amount — allocating purely by shortfall
            would drive the overweight ones to zero, and stopping a SIP is what golden rule 2 forbids.
          </p>
          <div class="table-wrap" style="margin-top:12px;">
            <table>
              <thead><tr><th class="name">Fund</th><th>Usual</th><th>Suggested</th><th>Change</th><th>Below target by</th></tr></thead>
              <tbody>
                ${rb.rows.slice().sort((a,b)=>b.short-a.short).map(r=>{
                  const d = r.suggested - r.monthly;
                  return `<tr>
                    <td class="name">${r.name}</td>
                    <td class="amt">${fmtINR(r.monthly)}</td>
                    <td class="amt" style="font-weight:700;color:var(--ink);">${fmtINR(r.suggested)}</td>
                    <td class="amt ${d>0?'pnl-pos':(d<0?'pnl-neg':'')}">${d===0?'—':(d>0?'+':'')+fmtINR(d)}</td>
                    <td class="amt">${r.short>0?fmtCompact(r.short):'—'}</td>
                  </tr>`;
                }).join('')}
              </tbody>
              <tfoot><tr><td>Total</td><td>${fmtINR(rb.sip)}</td><td>${fmtINR(rb.rows.reduce((s,r)=>s+r.suggested,0))}</td><td colspan="2">${fmtINR(moved)} redirected</td></tr></tfoot>
            </table>
          </div>
          <p class="footnote">A suggestion, not an instruction — it's deliberately not wired to change your plan.
             One month of this won't close a 10% gap; it nudges. Revert to the usual split once the drift is small.</p>
        </div>
      </section>`;
    })()}

    <section class="block">
      <div class="block-title">What you have actually earned</div>
      <div class="result-row" style="margin-top:0;">
        <div class="card stat-tile"><div class="l">Invested</div><div class="v num">${fmtCompact(ret.invested)}</div>
          <div class="sub">${ret.unknown.length ? ret.unknown.length + ' class(es) missing a cost' : 'every holding has a cost basis'}</div></div>
        <div class="card stat-tile"><div class="l">Current value</div><div class="v num">${fmtCompact(ret.corpus)}</div>
          <div class="sub">corpus, excluding what you've unticked</div></div>
        <div class="card stat-tile"><div class="l">Total gain</div>
          <div class="v num ${ret.gain>=0?'pnl-pos':'pnl-neg'}">${ret.gain>=0?'+':''}${fmtCompact(ret.gain)}</div>
          <div class="sub">${ret.gainPct===null?'—':(ret.gainPct>=0?'+':'')+fmtPct(ret.gainPct)+' on money in'}</div></div>
        <div class="card stat-tile"><div class="l">Annualised (XIRR)</div>
          <div class="v num">${ret.rate===null?'—':fmtPct(ret.rate)}</div>
          <div class="sub">plan assumes ${fmtPct(ret.assumed)}</div></div>
      </div>
      <div class="card pad" style="margin-top:14px;">
        <p style="font-size:13px;color:var(--ink-secondary);">${ret.note}</p>
        ${ret.rate !== null ? `
          <div class="corpus-actions" style="margin-top:12px;">
            <button class="snap-add-btn" id="use-real-rate">Use ${fmtPct(ret.rate)} in my projections</button>
            <span style="font-size:12px;color:var(--ink-muted);">Replaces the ${fmtPct(ret.assumed)} equity assumption on the Overview tab.</span>
          </div>
          <p class="footnote">A rate measured over a short window is noisy — one good quarter flatters it. Treat it as a reading, not a forecast.</p>
        ` : ''}
      </div>
    </section>
  `;

  const useBtn = document.getElementById('use-real-rate');
  if(useBtn) useBtn.addEventListener('click', ()=>{
    const r = actualReturn().rate;
    if(r === null) return;
    STATE.equityRate = r;
    markDirty();
    renderOverview();
    renderProjection();
    renderChecks();
  });
}

/* ---------- the April step-up, as a checklist ---------- */
function stepUpCardHTML(){
  const su = stepUpRows();
  if(!su.rows.length || !su.pct) return '';
  const isApril = new Date().getMonth() === 3;
  return `
    <details class="import-box" id="stepup-box"${isApril ? ' open' : ''}>
      <summary>April step-up — ${fmtPct(su.pct,0)} on every SIP${isApril ? ' · due now' : ''}</summary>
      <div class="import-body">
        <p>Golden rule 1, priced out. Change each mandate in Groww or INDmoney to the amount on the right,
           then tick it off here. Amounts are rounded to the nearest ₹50.</p>
        <div style="margin-top:6px;">
          ${su.rows.map(r=>`<div class="stepup-row">
            <span class="sn">${r.name}</span>
            <span class="sf">${fmtINR(r.from)}</span>
            <span class="sa">→</span>
            <span class="st">${fmtINR(r.to)}</span>
          </div>`).join('')}
          <div class="stepup-row" style="border-top:1px solid var(--border-strong);">
            <span class="sn">Total SIP</span>
            <span class="sf">${fmtINR(su.totalFrom)}</span>
            <span class="sa">→</span>
            <span class="st">${fmtINR(su.totalTo)}</span>
          </div>
        </div>
        <div class="corpus-actions" style="margin-top:14px;">
          <button class="snap-add-btn" id="stepup-apply">Apply these amounts to my plan</button>
          <span style="font-size:12px;color:var(--ink-muted);">
            Updates the Portfolio tab — do it once you've changed the mandates. Adds ${fmtINR(su.totalTo-su.totalFrom)}/month.
          </span>
        </div>
        <p class="footnote">Your take-home is ${fmtINR(STATE.salary)}; after the step-up, every SIP plus the buffer comes to ${fmtINR(su.totalTo + STATE.buffer)}.</p>
      </div>
    </details>`;
}

/* ---------- one-page summary ---------- */
function summaryHTML(){
  const now = new Date();
  const age = ageAt(now);
  const ret = actualReturn();
  const pva = planVsActual();
  const alerts = ruleAlerts().filter(a=>a.level !== 'good');
  const snap = latestSnapshot();
  const proj = computeProjection(defaultAssumptions());
  const atRetire = proj[proj.length-1];
  const investments = (LIVE.snapshot && LIVE.snapshot.investments) || [];
  const rows = investments.map(a=>({label:assetLabel(a.asset_type), cur:Number(a.current_value)||0,
      inv:assetInvestedResolved(a).value}))
    .concat(manualAssets().map(m=>({label:m.name||'Manual', cur:Number(m.current)||0,
      inv:(typeof m.invested==='number')?m.invested:null})))
    .filter(r=>r.cur>0).sort((a,b)=>b.cur-a.cur);
  const next = STATE.calendar.filter(c=>!c.done)
    .sort((a,b)=>(a.age-b.age)||(a.year-b.year)).slice(0,6);

  return `
    <h1>The 16-Year Ledger</h1>
    <div class="psub">Age ${fmtAge(age)} · retiring at ${STATE.retireAge} · target ₹${STATE.targetLowCr}–${STATE.targetHighCr} Cr · as of ${fmtDate(now)}</div>

    <h3>Where it stands</h3>
    <div class="pgrid">
      <div class="ptile"><div class="l">Corpus now</div><div class="v">${fmtCompact(ret.corpus)}</div></div>
      <div class="ptile"><div class="l">Invested</div><div class="v">${fmtCompact(ret.invested)}</div></div>
      <div class="ptile"><div class="l">Gain</div><div class="v">${ret.gain>=0?'+':''}${fmtCompact(ret.gain)}</div></div>
      <div class="ptile"><div class="l">Monthly SIP</div><div class="v">${fmtINR(totalSIP())}</div></div>
    </div>
    <div class="pgrid" style="margin-top:12px;">
      <div class="ptile"><div class="l">Projected at ${STATE.retireAge}</div><div class="v">${fmtCompact(atRetire.total)}</div></div>
      <div class="ptile"><div class="l">Income @ 4%</div><div class="v">${fmtINR(atRetire.income)}</div></div>
      <div class="ptile"><div class="l">Equity assumption</div><div class="v">${fmtPct(STATE.equityRate)}</div></div>
      <div class="ptile"><div class="l">Actual XIRR</div><div class="v">${ret.rate===null?'—':fmtPct(ret.rate)}</div></div>
    </div>

    <h3>Allocation</h3>
    <table><thead><tr><th>Asset</th><th style="text-align:right;">Invested</th><th style="text-align:right;">Current</th><th style="text-align:right;">P&amp;L</th></tr></thead><tbody>
      ${rows.map(r=>{
        const pl = r.inv===null?null:r.cur-r.inv;
        return `<tr><td>${r.label}</td><td class="n">${r.inv===null?'—':fmtCompact(r.inv)}</td>
          <td class="n">${fmtCompact(r.cur)}</td>
          <td class="n">${pl===null?'—':(pl>=0?'+':'')+fmtCompact(pl)}</td></tr>`;
      }).join('')}
    </tbody></table>

    ${pva.rows.length ? `<h3>Furthest from plan</h3>
      <table><thead><tr><th>Fund</th><th style="text-align:right;">Plan</th><th style="text-align:right;">Actual</th><th style="text-align:right;">Drift</th></tr></thead><tbody>
        ${pva.rows.slice(0,5).map(r=>`<tr><td>${r.name}</td><td class="n">${fmtPct(r.planned)}</td>
          <td class="n">${fmtPct(r.actual)}</td>
          <td class="n">${r.drift>=0?'+':'−'}${fmtPct(Math.abs(r.drift))}</td></tr>`).join('')}
      </tbody></table>` : ''}

    ${alerts.length ? `<h3>Wants attention</h3>
      <ol>${alerts.map(a=>`<li><b>${a.title}</b> — ${a.body}</li>`).join('')}</ol>` : ''}

    <h3>Next actions</h3>
    <ol>${next.map(c=>`<li><b>${c.action}</b> — age ${c.age}, ${c.year}${c.fund?' · '+c.fund:''}</li>`).join('')}</ol>

    <div class="pfoot">Generated from ${PLAN_SOURCE ? escAttr(PLAN_SOURCE) + ' and ' : ''}your holdings.
      Personal planning estimates, not financial advice.</div>`;
}

function printHost(){
  let h = document.getElementById('print-view');
  if(!h){ h = document.createElement('div'); h.id = 'print-view'; document.body.appendChild(h); }
  return h;
}
function printSummary(){
  const host = printHost();
  host.innerHTML = summaryHTML();
  document.body.classList.add('printing');
  const done = ()=>document.body.classList.remove('printing');
  try{
    window.addEventListener('afterprint', done, {once:true});
    window.print();
    setTimeout(done, 4000);      // some viewers never fire afterprint
  }catch(e){ done(); }
}
/* Printing from inside the viewer's frame isn't always permitted, so the
   same summary is also offered as a file you can open and print yourself. */
async function saveSummaryFile(){
  const msg = document.getElementById('data-msg');
  let css = '';
  try{ css = await (await fetch('style.css', {cache:'no-store'})).text(); }catch(e){}
  const fonts = Array.prototype.map.call(document.querySelectorAll('link[href*="fonts.googleapis.com"]'), e=>e.outerHTML).join('\n');
  const doc = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + '<title>Ledger summary — ' + fmtDate(new Date()) + '</title>\n'
    + fonts + '\n<style>' + css + '</style>\n</head>\n<body>\n'
    + '<div id="print-view" class="print-standalone">' + summaryHTML() + '</div>\n</body>\n</html>';
  const name = 'ledger-summary-' + new Date().toISOString().slice(0,10) + '.html';
  try{ downloadText(name, doc, 'text/html'); if(msg) msg.textContent = 'Saved ' + name + ' to your downloads'; }
  catch(e){ if(msg) msg.textContent = 'Could not save the file — use Print instead.'; }
}

RENDERERS.overview = renderOverview;
RENDERERS.live = renderLive;
RENDERERS.contrib = renderContrib;
RENDERERS.checks = renderChecks;
RENDERERS.portfolio = renderPortfolio;
RENDERERS.phases = renderPhases;
RENDERERS.projection = renderProjection;
RENDERERS.calendar = renderCalendar;
RENDERERS.us = renderUS;
RENDERERS.retirement = renderRetirement;

/* =========================================================
   PERSISTENCE — Save keeps the plan in this browser; if sync is on it
   then goes, encrypted, to a private GitHub Gist for your other devices.
   ========================================================= */
function saveState(){
  const btn = document.getElementById('save-btn');
  if(!persistSaved(STATE)){
    flashSaveStatus('Could not save — this browser is blocking site storage');
    return;
  }
  Cloud.markSaved();
  dirty = false;
  updateSaveBar();
  btn.disabled = false;
  btn.textContent = 'Save';
  flashSaveStatus('Saved · ' + fmtDate(new Date()));
  runSync(true);
}

function discardChanges(){
  STATE = loadSavedState();
  try{ localStorage.removeItem(DRAFT_KEY); }catch(e){}
  /* Reverting to the last save reloads a raw state object. It has to go back
     through the same backfill the boot path uses, or a section the saved copy
     predates (rules, layers, SWP scenarios, crash history) comes back missing
     and the panel that reads it throws. */
  migrateState();
  hydrateLiveFromState();
  dirty = false;
  updateSaveBar();
  const activeTab = document.querySelector('.tab-btn[aria-selected="true"]');
  if(activeTab && RENDERERS[activeTab.dataset.panel]) RENDERERS[activeTab.dataset.panel]();
  renderTopbar();
}

/* A plan saved on another device replaces this one - only ever when nothing here is unsaved. */
function adoptSavedPlan(s){
  persistSaved(s);
  STATE = s;
  usePlan(STATE.plan);
  migrateState();
  hydrateLiveFromState();
  dirty = false;
  updateSaveBar();
  rerenderAll();
}

let SYNC_BUSY = false;
const SYNC_MESSAGES = {
  pushed:'Synced — saved for your other devices',
  pulled:'Synced — brought in the plan saved on your other device',
  'kept-both':'Both devices had saved changes; this one’s plan was kept. Profile → Sync lets you switch.',
  unchanged:'Already in sync',
  waiting:'Your other device saved a newer plan — Save or Discard here first, then sync',
};
async function runSync(quiet){
  if(!Cloud.syncConfig() || SYNC_BUSY) return;
  if(!navigator.onLine){ if(!quiet) flashSaveStatus('Offline — sync runs when you are back online'); return; }
  SYNC_BUSY = true;
  refreshSettings();
  try{
    const r = await Cloud.syncNow(()=>readPlanKey(STATE_KEY) || STATE, async s=>adoptSavedPlan(s), ()=>!dirty);
    if(!quiet || r === 'pulled' || r === 'kept-both' || r === 'waiting') flashSaveStatus(SYNC_MESSAGES[r]);
  }catch(e){
    flashSaveStatus('Sync failed: ' + e.message);
  }finally{
    SYNC_BUSY = false;
    refreshSettings();
  }
}
function startSync(){
  let last = 0;
  document.addEventListener('visibilitychange', ()=>{
    if(document.visibilityState !== 'visible' || Date.now() - last < 60000) return;
    last = Date.now();
    runSync(true);
    refreshFromAts(true);
  });
  window.addEventListener('online', ()=>runSync(true));
  runSync(true);
}

document.getElementById('undo-btn').addEventListener('click', undoLast);
document.getElementById('save-btn').addEventListener('click', saveState);
document.getElementById('discard-btn').addEventListener('click', discardChanges);

/* =========================================================
   SETTINGS — sync between devices, AI assistants, the ATS link.
   Kept in this browser only (never in the plan or its exports).
   ========================================================= */
let SETTINGS_OPEN = null;
function agoText(ms){
  const s = Math.round((Date.now() - ms) / 1000);
  if(s < 60) return 'just now';
  if(s < 3600) return Math.round(s / 60) + ' min ago';
  if(s < 86400) return Math.round(s / 3600) + ' h ago';
  return new Date(ms).toLocaleString('en-IN', {day:'numeric', month:'short', hour:'numeric', minute:'2-digit'});
}
function syncSectionHTML(){
  const cfg = Cloud.syncConfig();
  if(cfg){
    const other = Cloud.otherVersion();
    return `<p class="footnote" style="margin-top:0">On. Your plan is encrypted with your sync passphrase on this device and kept in a private GitHub Gist; GitHub can’t read it. It syncs when the page opens and after each Save.</p>
      <p style="font-size:13px;margin:8px 0;">${SYNC_BUSY ? 'Syncing…' : cfg.syncedAt ? 'Last synced ' + escAttr(agoText(cfg.syncedAt)) + '.' : 'Not synced yet.'}</p>
      ${cfg.lastError ? `<div class="notice err" style="margin:8px 0;"><b>Last sync failed</b>${escAttr(cfg.lastError)}</div>` : ''}
      ${other ? `<div class="notice warn" style="margin:8px 0;"><b>Your other device saved a different plan at the same time</b>
          This device’s plan was kept and synced. Saved there ${escAttr(fmtDate(new Date(other.savedAt)))}.
          <div class="corpus-actions" style="margin-top:8px;"><button class="reset-btn" id="sync-use-other">Use the other device’s plan</button>
          <button class="reset-btn" id="sync-drop-other">Keep this one</button></div></div>` : ''}
      <div class="corpus-actions"><button class="snap-add-btn" id="sync-now" ${SYNC_BUSY ? 'disabled' : ''}>Sync now</button>
        <button class="del-btn wide" id="sync-off">Turn off on this device</button></div>`;
  }
  const et = Cloud.expenseTrackerSync();
  return `<p class="footnote" style="margin-top:0">Keep the same plan on your laptop and phone. It is encrypted on this device with a passphrase only you know, then stored in a private GitHub Gist.</p>
    ${et ? `<div class="notice ok" style="margin:10px 0;"><b>The Expense Tracker already syncs in this browser</b>
        Use the same GitHub token and passphrase - nothing to type. The plan gets its own private gist.
        <div class="corpus-actions" style="margin-top:8px;"><button class="snap-add-btn" id="sync-use-et">Turn on with the Expense Tracker’s sync</button></div></div>` : ''}
    <ol style="font-size:12.5px;color:var(--ink-secondary);padding-left:18px;margin:8px 0 12px;">
      <li>On <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com → Fine-grained tokens</a>, create a token with <b>Account permissions → Gists: Read and write</b> (or a classic token with the <b>gist</b> scope).</li>
      <li>Paste it below with a sync passphrase and tap Turn on sync.</li>
      <li>On your other device, do the same with the <b>same token and passphrase</b>.</li></ol>
    <div class="pw-form">
      <input type="password" id="sync-token" autocomplete="off" placeholder="GitHub token (github_pat_… or ghp_…)" spellcheck="false" autocapitalize="none">
      <input type="password" id="sync-pass" autocomplete="new-password" placeholder="Sync passphrase (8+ characters)">
      <button class="snap-add-btn" id="sync-on" style="align-self:flex-start;">Turn on sync</button>
    </div>
    <p class="footnote">Both stay on this device only. If you forget the passphrase, the synced copy can’t be opened; the plan on each device is unaffected.</p>`;
}
function aiSectionHTML(){
  const s = Cloud.aiSettings(), own = Cloud.aiLocal();
  const rows = Cloud.PROVIDERS.map(p=>{
    const k = s.keys[p.id], from = s.from[p.id], r = Cloud.resting(p.id), on = s.off.indexOf(p.id) < 0;
    const state = !k ? '<span class="recon-status missing">no key</span>'
      : !on ? '<span class="recon-status missing">off</span>'
      : r ? '<span class="recon-status missing" title="' + escAttr(r.why) + '">resting</span>'
      : '<span class="recon-status held">ready</span>';
    return `<tr><td class="name">${escAttr(p.name)}<div class="recon-sub">${from === 'expense-tracker' ? 'key from the Expense Tracker' : from === 'ledger' ? 'key saved here' : '<a href="' + p.signupUrl + '" target="_blank" rel="noopener">get a key</a>'}</div></td>
      <td>${state}</td>
      <td><input class="inline-input" type="password" data-ai-key="${p.id}" placeholder="${escAttr((own.keys || {})[p.id] ? '••••••' : p.placeholder)}" autocomplete="off" spellcheck="false"></td>
      <td><label style="font-size:12px;white-space:nowrap;"><input type="checkbox" data-ai-on="${p.id}" ${on ? 'checked' : ''}> use</label></td></tr>`;
  }).join('');
  return `<p class="footnote" style="margin-top:0">Ask AI tries these in order and moves on when one is out of free quota (it rests 15 minutes). Keys you already added in the Expense Tracker are used automatically in this browser; a key typed here wins over it. Keys stay on this device.</p>
    <div class="table-wrap" style="margin-top:10px;"><table style="min-width:0;"><thead><tr><th class="name">Service</th><th>State</th><th>Key (leave blank to keep)</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="corpus-actions" style="margin-top:10px;"><button class="snap-add-btn" id="ai-save">Save AI settings</button>
      <button class="reset-btn" id="ai-clear">Remove keys saved here</button><span id="ai-msg" style="font-size:12px;color:var(--ink-muted);"></span></div>`;
}
function atsSectionHTML(){
  const l = Cloud.atsLink();
  return `<p class="footnote" style="margin-top:0">ATS (your trading dashboard on the Mac) collects your holdings from INDmoney and Groww. Linked, this page reads them from ATS, valued live, whenever it opens on that Mac - no more pasting. On the phone it shows the holdings last read (they sync with the plan).</p>
    ${l ? `<p style="font-size:13px;margin:8px 0;">Linked ${escAttr(agoText(l.linkedAt || Date.now()))}${STATE.atsReadAt ? ' · holdings last read ' + escAttr(agoText(new Date(STATE.atsReadAt).getTime())) : ''}.</p>
        <div class="corpus-actions"><button class="snap-add-btn" id="ats-refresh">Read holdings from ATS now</button><button class="del-btn wide" id="ats-unlink">Unlink</button></div>`
      : `<div class="corpus-actions"><a class="snap-add-btn" id="ats-link" href="${escAttr(Cloud.atsLinkUrl())}" style="text-decoration:none;">Link ATS on this Mac</a></div>
         <p class="footnote">Opens ATS (sign in there if asked), which sends you straight back here with a read-only link. Only on the Mac that runs ATS.</p>`}`;
}
function settingsHTML(){
  return `<details class="import-box" data-set="sync" ${SETTINGS_OPEN === 'sync' ? 'open' : ''}><summary>Sync between devices ${Cloud.syncConfig() ? '· on' : '· off'}</summary><div class="import-body">${syncSectionHTML()}</div></details>
    <details class="import-box" data-set="ai" ${SETTINGS_OPEN === 'ai' ? 'open' : ''}><summary>AI assistants · ${Cloud.aiAvailable() ? escAttr(Cloud.aiNames().join(', ')) : 'none yet'}</summary><div class="import-body">${aiSectionHTML()}</div></details>
    <details class="import-box" data-set="ats" ${SETTINGS_OPEN === 'ats' ? 'open' : ''}><summary>Holdings from ATS · ${Cloud.atsLink() ? 'linked' : 'not linked'}</summary><div class="import-body">${atsSectionHTML()}</div></details>`;
}
function openSettings(section){
  SETTINGS_OPEN = section || SETTINGS_OPEN || 'sync';
  openModal('Settings', 'Stored in this browser only', '<div id="settings-body"></div>');
  refreshSettings();
}
function refreshSettings(){
  const body = document.getElementById('settings-body');
  if(!body) return;
  body.innerHTML = settingsHTML();
  body.querySelectorAll('details[data-set]').forEach(d=>d.addEventListener('toggle', ()=>{ if(d.open) SETTINGS_OPEN = d.dataset.set; }));
  const on = (id, fn)=>{ const e = document.getElementById(id); if(e) e.addEventListener('click', fn); };
  const turnOn = async (token, pass)=>{
    Cloud.saveSyncConfig({token, pass});
    await runSync(false);
    const c = Cloud.syncConfig();
    if(c && !c.syncedAt){ Cloud.forgetSync(); flashSaveStatus('Sync not turned on: ' + (c.lastError || 'check the token')); }
    refreshSettings();
  };
  on('sync-on', ()=>{
    const token = document.getElementById('sync-token').value.trim(), pass = document.getElementById('sync-pass').value;
    if(!token){ flashSaveStatus('Paste your GitHub token'); return; }
    if(pass.length < 8){ flashSaveStatus('Use a passphrase of at least 8 characters'); return; }
    turnOn(token, pass);
  });
  on('sync-use-et', ()=>{ const c = Cloud.expenseTrackerSync(); if(c) turnOn(c.token, c.pass); });
  on('sync-now', ()=>runSync(false));
  on('sync-off', ()=>{ Cloud.forgetSync(); flashSaveStatus('Sync is off on this device. The plan here is untouched.'); refreshSettings(); });
  on('sync-use-other', ()=>{
    const o = Cloud.otherVersion();
    if(!o) return;
    pushUndo('switching to the other device’s plan');
    adoptSavedPlan(o.plan); Cloud.markSaved(); Cloud.dropOtherVersion(); runSync(true);
  });
  on('sync-drop-other', ()=>{ Cloud.dropOtherVersion(); refreshSettings(); });
  on('ai-save', ()=>{
    const own = Cloud.aiLocal(); own.keys = own.keys || {};
    body.querySelectorAll('[data-ai-key]').forEach(i=>{ const v = i.value.trim(); if(v){ own.keys[i.dataset.aiKey] = v; Cloud.wake(i.dataset.aiKey); } });
    own.order = Cloud.aiSettings().order;
    own.off = Array.prototype.filter.call(body.querySelectorAll('[data-ai-on]'), c=>!c.checked).map(c=>c.dataset.aiOn);
    Cloud.saveAiLocal(own);
    refreshSettings(); initAsk();
    const m = document.getElementById('ai-msg'); if(m) m.textContent = 'Saved.';
  });
  on('ai-clear', ()=>{ Cloud.saveAiLocal({keys:{}, order:[], off:[]}); refreshSettings(); initAsk(); });
  on('ats-refresh', ()=>refreshFromAts(false));
  on('ats-unlink', ()=>{ Cloud.unlinkAts(); refreshSettings(); if(document.getElementById('panel-live')) renderLive(); });
}

/* =========================================================
   ASK THE LEDGER — the free AI services in Settings (the same ones the
   Expense Tracker uses). It answers from a compact summary of the plan
   and may PROPOSE changes; nothing changes until the viewer taps Apply,
   every applied change can be undone, and Save still decides what is kept.
   ========================================================= */
const ASK = { ready:false, turns:[], busy:null, open:false };

const SETTING_FIELDS = {
  salary:       {label:'Monthly salary',        get:()=>STATE.salary,        set:v=>{STATE.salary=v;},        min:0,   max:1e8, fmt:v=>fmtINR(v)},
  buffer:       {label:'Buffer / sweep-in FD',  get:()=>STATE.buffer,        set:v=>{STATE.buffer=v;},        min:0,   max:1e8, fmt:v=>fmtINR(v)},
  retireAge:    {label:'Retirement age',        get:()=>STATE.retireAge,     set:v=>{STATE.retireAge=v;},     min:35,  max:80,  fmt:v=>String(v)},
  targetLowCr:  {label:'Target — low (₹ Cr)',   get:()=>STATE.targetLowCr,   set:v=>{STATE.targetLowCr=v;},   min:0.1, max:500, fmt:v=>'₹'+v+' Cr'},
  targetHighCr: {label:'Target — high (₹ Cr)',  get:()=>STATE.targetHighCr,  set:v=>{STATE.targetHighCr=v;},  min:0.1, max:500, fmt:v=>'₹'+v+' Cr'},
  equityRatePct:{label:'Equity XIRR assumption',get:()=>STATE.equityRate*100,set:v=>{STATE.equityRate=v/100;},min:0,   max:40,  fmt:v=>v+'%'},
  stepUpPct:    {label:'Annual step-up',        get:()=>STATE.stepUp*100,    set:v=>{STATE.stepUp=v/100;},    min:0,   max:50,  fmt:v=>v+'%'},
  fdRatePct:    {label:'FD return',             get:()=>STATE.fdRate*100,    set:v=>{STATE.fdRate=v/100;},    min:0,   max:20,  fmt:v=>v+'%'},
  inflationPct: {label:'Inflation',             get:()=>STATE.inflation*100, set:v=>{STATE.inflation=v/100;}, min:0,   max:20,  fmt:v=>v+'%'},
  ltcgRatePct:  {label:'Equity LTCG rate',      get:()=>STATE.ltcgRate*100,  set:v=>{STATE.ltcgRate=v/100;},  min:0,   max:50,  fmt:v=>v+'%'},
};

/* Everything the AI sees about the plan. Rounded and trimmed so the whole
   thing stays a few KB; no account numbers exist in the plan to leak. */
function ledgerContext(){
  const r2 = n => Math.round(Number(n)||0);
  const rows = computeProjection(defaultAssumptions());
  const end = rows[rows.length-1];
  const pva = planVsActual();
  const snaps = STATE.snapshots.slice().sort((a,b)=> new Date(a.date)-new Date(b.date)).slice(-6);
  const ci = corpusInvested();
  const settings = {};
  Object.keys(SETTING_FIELDS).forEach(k=>{ settings[k] = +Number(SETTING_FIELDS[k].get()).toFixed(2); });
  return {
    today: new Date().toISOString().slice(0,10),
    ageToday: +ageAt(new Date()).toFixed(1),
    settings,
    funds: allFunds().map(f=>({id:f.id, name:f.name, monthly:r2(f.monthly), assetClass:f.cls||'',
      group: (STATE.usFunds||[]).indexOf(f) >= 0 ? 'US' : 'India', debt: isDebtFund(f)})),
    totalMonthlySIP: r2(totalSIP()),
    livingExpensesLeft: r2(livingExpenses()),
    checkins: snaps.map(s=>({date:s.date, value:r2(s.value), invested: typeof s.invested === 'number' ? r2(s.invested) : null, note:s.note||''})),
    corpusNow: r2(corpusFigure()), investedNow: r2(ci.total),
    projectionAtRetirement: {age:end.age, total:r2(end.total), totalInWords: fmtCompact(end.total), monthlyIncomeAt4pct:r2(end.income)},
    targetInWords: '₹' + STATE.targetLowCr + '–' + STATE.targetHighCr + ' Cr', corpusNowInWords: fmtCompact(corpusFigure()),
    projectionByAge: rows.filter((r,i)=> i%2===0 || i===rows.length-1).map(r=>({age:r.age, total:r2(r.total), monthlySIP: r.monthlySIP===null ? 0 : r2(r.monthlySIP)})),
    driftFromPlan: pva.rows.slice(0,8).map(r=>({fund:r.name, plannedSharePct:+(r.planned*100).toFixed(1), actualSharePct:+(r.actual*100).toFixed(1)})),
    alerts: ruleAlerts().map(a=>a.level + ': ' + a.title),
    nextActions: STATE.calendar.filter(c=>!c.done).sort((a,b)=>(a.age-b.age)||(a.year-b.year)).slice(0,10)
      .map(c=>({id:c.id, age:c.age, year:c.year, action:c.action, fund:c.fund||''})),
    goldenRules: STATE.goldenRules.map(r=>r.title),
    investedPerMonthFromBankStatements: ((STATE.expenseInvest||{}).months||[]).slice(-12)
      .map(m=>({month:m.month, invested:r2(m.invested), redeemed:r2(m.redeemed)})),
  };
}

function askInstructions(){
  return `You are the assistant built into "The 16-Year Ledger", one person's retirement investment plan in Indian rupees (₹1 L = ₹1,00,000; ₹1 Cr = ₹1,00,00,000; write amounts the Indian way).
Answer using ONLY the plan data below. Do arithmetic carefully and show the key numbers. Be concise: plain text, short paragraphs or "- " bullets, under 180 words unless asked for more, no tables, no markdown headings. You are not a licensed adviser: reason from the plan and its golden rules, never promise returns.

If, and only if, the user asks you to change the plan, say in one sentence what you propose, then end your reply with one final line that starts with CHANGES: followed by a JSON array of operations (no code fence). The user reviews and applies them. Allowed operations:
{"op":"set_fund_monthly","fundId":"<id from funds>","monthly":<rupees>}
{"op":"add_fund","name":"...","monthly":<rupees>,"group":"India"|"US","assetClass":"..."}
{"op":"set_setting","field":"${Object.keys(SETTING_FIELDS).join('"|"')}","value":<number; percents as percent numbers, e.g. 12 for 12%>}
{"op":"add_checkin","date":"YYYY-MM-DD","value":<rupees>,"note":"..."}
{"op":"set_action_done","actionId":"<id from nextActions>","done":true|false}
{"op":"add_action","age":<number>,"year":<number>,"action":"...","fund":"...","why":"..."}
{"op":"add_rule","title":"...","body":"..."}
Use only ids that appear in the data. For a relative change ("raise PPFCF by 20%") compute the new absolute amount.

PLAN DATA:
${JSON.stringify(ledgerContext())}`;
}

/* Splits Claude's reply into what to show and the proposed operations. */
function splitReply(text){
  const i = text.lastIndexOf('CHANGES:');
  if(i < 0) return {shown:text.trim(), ops:null};
  const tail = text.slice(i + 8).replace(/```[a-z]*|```/gi, '').trim();
  let ops = null;
  try{
    const a = tail.indexOf('['), b = tail.lastIndexOf(']');
    if(a >= 0 && b > a) ops = JSON.parse(tail.slice(a, b + 1));
  }catch(e){ ops = []; }
  return {shown:text.slice(0, i).trim(), ops: Array.isArray(ops) ? ops : []};
}

/* Checks each proposed operation against the plan and turns it into a
   plain-language line. Anything malformed is dropped, never guessed at. */
function vetOps(ops){
  const ok = [], bad = [];
  const num = v => (typeof v === 'number' ? v : parseFloat(v));
  const fin = v => isFinite(num(v));
  (ops||[]).forEach(o=>{
    if(!o || typeof o !== 'object'){ bad.push(o); return; }
    if(o.op === 'set_fund_monthly'){
      const f = allFunds().filter(x=>x.id === String(o.fundId))[0];
      const v = Math.round(num(o.monthly));
      if(!f || !fin(o.monthly) || v < 0 || v > 1e7) return bad.push(o);
      ok.push({o:{op:o.op, fundId:f.id, monthly:v}, label: f.name + ': ' + fmtINR(f.monthly) + ' → ' + fmtINR(v) + '/month'});
    } else if(o.op === 'add_fund'){
      const v = Math.round(num(o.monthly));
      const name = String(o.name||'').trim().slice(0,80);
      if(!name || !fin(o.monthly) || v < 0 || v > 1e7) return bad.push(o);
      const group = String(o.group) === 'US' ? 'US' : 'India';
      ok.push({o:{op:o.op, name, monthly:v, group, assetClass:String(o.assetClass||'').slice(0,40)},
        label:'Add ' + group + ' fund “' + name + '” at ' + fmtINR(v) + '/month'});
    } else if(o.op === 'set_setting'){
      const f = SETTING_FIELDS[String(o.field)];
      const v = +num(o.value).toFixed(2);
      if(!f || !fin(o.value) || v < f.min || v > f.max) return bad.push(o);
      ok.push({o:{op:o.op, field:String(o.field), value:v}, label: f.label + ': ' + f.fmt(+Number(f.get()).toFixed(2)) + ' → ' + f.fmt(v)});
    } else if(o.op === 'add_checkin'){
      const v = Math.round(num(o.value));
      const date = String(o.date||'');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date)) || !fin(o.value) || v <= 0) return bad.push(o);
      ok.push({o:{op:o.op, date, value:v, note:String(o.note||'').slice(0,80)}, label:'Add check-in: ' + fmtCompact(v) + ' on ' + fmtDate(date)});
    } else if(o.op === 'set_action_done'){
      const c = STATE.calendar.filter(x=>x.id === String(o.actionId))[0];
      if(!c) return bad.push(o);
      const done = o.done !== false;
      ok.push({o:{op:o.op, actionId:c.id, done}, label:(done ? 'Mark done: ' : 'Mark not done: ') + c.action});
    } else if(o.op === 'add_action'){
      const age = Math.round(num(o.age)), year = Math.round(num(o.year));
      const action = String(o.action||'').trim().slice(0,120);
      if(!action || !fin(o.age) || !fin(o.year) || age < 18 || age > 100) return bad.push(o);
      ok.push({o:{op:o.op, age, year, action, fund:String(o.fund||'').slice(0,60), why:String(o.why||'').slice(0,160)},
        label:'Add action at age ' + age + ' (' + year + '): ' + action});
    } else if(o.op === 'add_rule'){
      const title = String(o.title||'').trim().slice(0,80);
      if(!title) return bad.push(o);
      ok.push({o:{op:o.op, title, body:String(o.body||'').slice(0,300)}, label:'Add golden rule: ' + title});
    } else bad.push(o);
  });
  return {ok, bad};
}

function applyOps(list){
  pushUndo('the suggested change');
  list.forEach(({o})=>{
    if(o.op === 'set_fund_monthly'){
      const f = allFunds().filter(x=>x.id === o.fundId)[0]; if(f) f.monthly = o.monthly;
    } else if(o.op === 'add_fund'){
      const key = o.group === 'US' ? 'usFunds' : 'indiaFunds';
      STATE[key].push(o.group === 'US'
        ? {id:cryptoId('us'), name:o.name, monthly:o.monthly, expense:'', cagr:'', cls:o.assetClass}
        : {id:cryptoId('in'), name:o.name, monthly:o.monthly, cls:o.assetClass, geo:'India', role:''});
    } else if(o.op === 'set_setting'){
      SETTING_FIELDS[o.field].set(o.value);
    } else if(o.op === 'add_checkin'){
      STATE.snapshots.push({id:cryptoId('snap'), date:o.date, value:o.value, note:o.note || 'Added with Ask AI'});
    } else if(o.op === 'set_action_done'){
      const c = STATE.calendar.filter(x=>x.id === o.actionId)[0]; if(c) c.done = o.done;
    } else if(o.op === 'add_action'){
      STATE.calendar.push({id:cryptoId('cal'), age:o.age, year:o.year, pr:'warning', label:'Added',
        action:o.action, fund:o.fund, why:o.why, how:'', done:false});
    } else if(o.op === 'add_rule'){
      STATE.goldenRules.push({id:cryptoId('gr'), title:o.title, body:o.body});
    }
  });
  markDirty();
  rerenderAll();
}


function askEl(tag, cls, text){
  const e = document.createElement(tag);
  if(cls) e.className = cls;
  if(text !== undefined) e.textContent = text;
  return e;
}

function openAsk(){
  if(ASK.open) return;
  ASK.open = true;
  const panel = askEl('aside', 'ask-panel');
  panel.id = 'ask-panel';
  panel.setAttribute('aria-label', 'Ask the Ledger');
  const head = askEl('div', 'ask-head');
  const title = askEl('div');
  title.append(askEl('h3', null, 'Ask the Ledger'), askEl('p', null, 'Answers from your plan’s numbers, using your free AI services. Changes are shown first and applied only when you tap Apply.'));
  const actions = askEl('div', 'ask-head-actions');
  const reset = askEl('button', 'ask-icon', 'New chat');
  const close = askEl('button', 'ask-icon', '✕');
  close.setAttribute('aria-label', 'Close');
  actions.append(reset, close);
  head.append(title, actions);
  const log = askEl('div', 'ask-log');
  log.id = 'ask-log';
  log.setAttribute('aria-live', 'polite');
  const form = askEl('form', 'ask-form');
  const box = askEl('textarea');
  box.id = 'ask-input';
  box.rows = 2;
  box.placeholder = 'e.g. Am I on track for ₹' + STATE.targetHighCr + ' Cr?';
  box.setAttribute('aria-label', 'Your question');
  const send = askEl('button', 'snap-add-btn', 'Send');
  send.type = 'submit';
  send.id = 'ask-send';
  form.append(box, send);
  panel.append(head, log, form);
  document.body.appendChild(panel);

  close.addEventListener('click', closeAsk);
  reset.addEventListener('click', ()=>{ if(ASK.busy) ASK.busy.abort(); ASK.turns = []; renderAskLog(); box.focus(); });
  form.addEventListener('submit', e=>{ e.preventDefault(); if(ASK.busy){ ASK.busy.abort(); return; } askSend(box.value); });
  box.addEventListener('keydown', e=>{ if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); form.requestSubmit(); } });
  panel.addEventListener('keydown', e=>{ if(e.key === 'Escape') closeAsk(); });
  renderAskLog();
  box.focus();
}
function closeAsk(){
  if(ASK.busy) ASK.busy.abort();
  const p = document.getElementById('ask-panel');
  if(p) p.remove();
  ASK.open = false;
  const b = document.getElementById('ask-open'); if(b) b.focus();
}

function askExamples(){
  const f = allFunds()[0];
  return [
    'Am I on track for my target?',
    'How much more SIP would reach ₹' + STATE.targetHighCr + ' Cr by ' + STATE.retireAge + '?',
    'Which fund is furthest from plan?',
    f ? 'Raise ' + String(f.name).split(/[—(]/)[0].trim() + ' to ' + fmtINR(Math.round((Number(f.monthly) || 0) * 1.2 / 500) * 500) + ' a month' : 'Add a fund to my plan',
    'Mark the April step-up done',
  ];
}

function renderAskLog(){
  const log = document.getElementById('ask-log');
  if(!log) return;
  log.textContent = '';
  if(!ASK.turns.length){
    const intro = askEl('div', 'ask-empty');
    intro.append(askEl('p', null, 'Try one of these:'));
    const chips = askEl('div', 'ask-chips');
    if(!ASK.ready){
      const n = askEl('div', 'notice info');
      n.append(askEl('b', null, 'No AI service yet'), askEl('span', null, 'Add a free key (Google Gemini or Groq take a minute, no card) - or add it in the Expense Tracker and it is used here too.'));
      const go = askEl('button', 'snap-add-btn', 'Open AI settings');
      go.style.marginTop = '10px';
      go.addEventListener('click', ()=>{ closeAsk(); openSettings('ai'); });
      n.appendChild(go);
      log.appendChild(n);
      return;
    }
    askExamples().forEach(x=>{
      const c = askEl('button', 'filter-chip', x);
      c.type = 'button';
      c.addEventListener('click', ()=>askSend(x));
      chips.appendChild(c);
    });
    intro.appendChild(chips);
    log.appendChild(intro);
    return;
  }
  ASK.turns.forEach(t=>{
    if(t.role === 'user'){ log.appendChild(askEl('div', 'ask-msg you', t.content)); return; }
    const m = askEl('div', 'ask-msg bot' + (t.error ? ' err' : ''));
    m.appendChild(askEl('div', 'ask-text', t.shown || (t.pending ? 'Thinking…' : '')));
    if(t.error) m.appendChild(askEl('div', 'ask-note', t.error));
    else if(t.via) m.appendChild(askEl('div', 'ask-note', t.via));
    if(t.changes && t.changes.ok.length){
      const card = askEl('div', 'ask-changes');
      card.appendChild(askEl('b', null, t.applied ? 'Applied' : 'Proposed change' + (t.changes.ok.length > 1 ? 's' : '')));
      const ul = askEl('ul');
      t.changes.ok.forEach(c=>ul.appendChild(askEl('li', null, c.label)));
      card.appendChild(ul);
      if(t.changes.bad.length) card.appendChild(askEl('div', 'ask-note', t.changes.bad.length + ' suggestion(s) didn’t match your plan and were left out.'));
      if(t.applied){
        card.appendChild(askEl('div', 'ask-note', 'Tap Save at the bottom to keep it, or Undo there to take it back.'));
      } else if(!t.dismissed){
        const row = askEl('div', 'ask-change-actions');
        const go = askEl('button', 'snap-add-btn', 'Apply');
        const no = askEl('button', 'reset-btn', 'Dismiss');
        go.addEventListener('click', ()=>{ applyOps(t.changes.ok); t.applied = true; renderAskLog(); flashSaveStatus('Applied. Hit Save to keep it.'); });
        no.addEventListener('click', ()=>{ t.dismissed = true; renderAskLog(); });
        row.append(go, no);
        card.appendChild(row);
      } else {
        card.appendChild(askEl('div', 'ask-note', 'Dismissed — nothing changed.'));
      }
      m.appendChild(card);
    } else if(t.changes && t.changes.bad.length){
      m.appendChild(askEl('div', 'ask-note', 'The AI suggested a change that didn’t match your plan, so nothing is offered. Try naming the fund or setting exactly.'));
    }
    log.appendChild(m);
  });
  log.scrollTop = log.scrollHeight;
}

function setAskBusy(on){
  const send = document.getElementById('ask-send');
  if(send) send.textContent = on ? 'Stop' : 'Send';
}

async function askSend(q){
  q = String(q||'').trim();
  if(!q || !ASK.ready || ASK.busy) return;
  const box = document.getElementById('ask-input'); if(box) box.value = '';
  ASK.turns.push({role:'user', content:q});
  const reply = {role:'assistant', pending:true, shown:''};
  ASK.turns.push(reply);
  renderAskLog();
  /* The plan goes in fresh every time (it may have changed since the last
     question); only the last few exchanges are carried as context. */
  let history = ASK.turns.slice(0, -1).slice(-9)
    .filter(t=>t.role === 'user' || (t.raw && !t.error))
    .map(t=>({role:t.role, content: t.role === 'user' ? t.content : t.raw}));
  while(history.length && history[0].role !== 'user') history.shift();
  const ctl = new AbortController();
  ASK.busy = ctl;
  setAskBusy(true);
  try{
    const res = await Cloud.chat(askInstructions(), history, ctl.signal);
    const parts = splitReply(res.text);
    reply.raw = res.text;
    reply.shown = parts.shown || 'Here is what I propose:';
    reply.via = 'Answered by ' + res.provider + ' · ' + res.model;
    if(parts.ops) reply.changes = vetOps(parts.ops);
  }catch(e){
    reply.shown = '';
    reply.error = (e && e.code === 'cancelled') ? 'Stopped.' : ((e && e.message) || 'Something went wrong reaching the AI. Try again.');
  }finally{
    reply.pending = false;
    ASK.busy = null;
    setAskBusy(false);
    renderAskLog();
  }
}

/* One tap: a short month-end review from the check-ins, drift, alerts and
   what the bank statements say was actually invested. */
function reviewMonth(){
  if(!ASK.ready) return;
  const month = new Date().toLocaleString('en-IN', {month:'long', year:'numeric'});
  openAsk();
  if(ASK.busy) return;
  askSend(`Review my plan for ${month}. In 5 short "- " bullets: (1) how the corpus moved since the previous check-in, (2) whether the money actually invested per the bank statements matches my monthly SIP (name the gap in rupees), (3) the fund furthest from its planned share, (4) any alerts, (5) the one thing to do before next month. If a piece of data is missing, say what to add instead of guessing. Do not propose changes.`);
}

async function initAsk(){
  const btn = document.getElementById('ask-open');
  if(!btn) return;
  if(!btn.dataset.wired){ btn.dataset.wired = '1'; btn.addEventListener('click', openAsk); }
  try{ await Cloud.loadAi(); }catch(e){}
  ASK.ready = Cloud.aiAvailable();
  btn.hidden = false;
  const rev = document.getElementById('review-month');
  if(rev) rev.hidden = !ASK.ready;
  if(ASK.open) renderAskLog();
}

/* =========================================================
   SIGN-IN, PROFILE MENU AND THEME
   A screen lock for this page. One password for both apps: where the
   Expense Tracker is used in this browser, its username and password open
   the Ledger too. Otherwise the Ledger's own sign-in (saved with the plan,
   default admin / admin until changed). It hides the page on screen; the
   plan itself is only encrypted when it leaves the device (sync).
   ========================================================= */
const SESSION_KEY = 'ledger-session';
const THEME_KEY = 'ledger-theme';
const VIEWER_THEME = document.documentElement.getAttribute('data-theme');

let ET_AUTH = null;      // the Expense Tracker's sign-in in this browser, once read
function ledgerUser(){ return (ET_AUTH && ET_AUTH.username) || (STATE.auth && STATE.auth.user) || 'admin'; }
async function sha256(text){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.prototype.map.call(new Uint8Array(buf), b=>b.toString(16).padStart(2,'0')).join('');
}
async function checkLogin(user, pass){
  const et = await Cloud.checkExpenseTrackerLogin(user, pass);
  if(et !== null) return et;
  const want = (STATE.auth && STATE.auth.hash) || await sha256('admin:admin');
  return user.trim().toLowerCase() === ledgerUser().toLowerCase() && await sha256(ledgerUser().toLowerCase() + ':' + pass) === want;
}
function isSignedIn(){
  try{ return sessionStorage.getItem(SESSION_KEY) === 'yes'; }catch(e){ return false; }
}
function setSignedIn(on){
  try{ if(on) sessionStorage.setItem(SESSION_KEY, 'yes'); else sessionStorage.removeItem(SESSION_KEY); }catch(e){}
}

function showLogin(){
  document.body.classList.add('locked');
  let screen = document.getElementById('login-screen');
  if(screen) return;
  screen = document.createElement('div');
  screen.id = 'login-screen';
  screen.className = 'login-screen';
  screen.innerHTML = `
    <form class="login-card" id="login-form" autocomplete="on">
      <span class="brand-eyebrow">Investment plan</span>
      <h1>The 16-Year <em>Ledger</em></h1>
      <p class="login-sub">Sign in to open your plan.</p>
      <label for="login-user">Username</label>
      <input id="login-user" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required>
      <label for="login-pass">Password</label>
      <input id="login-pass" type="password" autocomplete="current-password" required>
      <p class="login-err" id="login-err" role="alert" hidden>That username or password is wrong.</p>
      <button class="snap-add-btn login-go" type="submit">Sign in</button>
    </form>`;
  document.body.appendChild(screen);
  const form = document.getElementById('login-form');
  form.addEventListener('submit', async e=>{
    e.preventDefault();
    const ok = await checkLogin(document.getElementById('login-user').value, document.getElementById('login-pass').value);
    if(!ok){
      document.getElementById('login-err').hidden = false;
      document.getElementById('login-pass').select();
      return;
    }
    setSignedIn(true);
    screen.remove();
    document.body.classList.remove('locked');
    renderProfileBadge();
    afterSignIn();
  });
  setTimeout(()=>{ const u = document.getElementById('login-user'); if(u) u.focus(); }, 0);
}

function signOut(){
  closeProfileMenu();
  if(ASK.open) closeAsk();
  setSignedIn(false);
  showLogin();
}

/* ---------- theme: System follows the viewer; Light / Dark are remembered here ---------- */
function getLedgerTheme(){
  try{ const v = localStorage.getItem(THEME_KEY); return v === 'light' || v === 'dark' ? v : 'system'; }catch(e){ return 'system'; }
}
function applyLedgerTheme(t){
  t = t || getLedgerTheme();
  const root = document.documentElement;
  if(t === 'system'){
    if(VIEWER_THEME) root.setAttribute('data-theme', VIEWER_THEME); else root.removeAttribute('data-theme');
  } else root.setAttribute('data-theme', t);
}
function setLedgerTheme(t){
  try{ if(t === 'system') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, t); }catch(e){}
  applyLedgerTheme(t);
  rerenderAll();          // charts read colours when they are drawn
}

/* ---------- profile menu ---------- */
function initialsOf(n){ return (String(n||'').trim().slice(0,2) || '?').toUpperCase(); }
function renderProfileBadge(){
  const b = document.getElementById('profile-btn');
  if(b) b.textContent = initialsOf(ledgerUser());
}
function closeProfileMenu(){
  const m = document.getElementById('profile-menu');
  if(m) m.remove();
  const b = document.getElementById('profile-btn');
  if(b) b.setAttribute('aria-expanded', 'false');
}
function toggleProfileMenu(){
  if(document.getElementById('profile-menu')){ closeProfileMenu(); return; }
  const btn = document.getElementById('profile-btn');
  const menu = document.createElement('div');
  menu.id = 'profile-menu';
  menu.className = 'profile-menu';
  menu.setAttribute('role', 'menu');
  const draw = ()=>{
    const theme = getLedgerTheme();
    menu.innerHTML = `
      <div class="pm-head"><span class="avatar-round">${escAttr(initialsOf(ledgerUser()))}</span>
        <span><span class="pm-label" style="padding:0;">Signed in as</span><b style="display:block;">${escAttr(ledgerUser())}</b></span></div>
      <button class="pm-item" role="menuitem" data-pm="settings">Settings — sync, AI, ATS</button>
      <button class="pm-item" role="menuitem" data-pm="password">Change username or password</button>
      <div class="pm-label">Theme</div>
      <div class="pm-theme" role="group" aria-label="Theme">
        ${['system','light','dark'].map(t=>`<button data-theme-pick="${t}" aria-pressed="${theme===t}" class="${theme===t?'on':''}">${t[0].toUpperCase()+t.slice(1)}</button>`).join('')}
      </div>
      <a class="pm-item" role="menuitem" href="https://anilgupta2606.github.io/expenseTracker/" target="_blank" rel="noopener">Expense tracker <span class="pm-ext" aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></a>
      <a class="pm-item" role="menuitem" href="ats://open" target="_blank" rel="noopener" title="Opens the trading dashboard on this Mac - starts it first if it is not running">Open ATS <span class="pm-ext" aria-hidden="true">↗</span><span class="sr-only"> (the trading dashboard on this Mac)</span></a>
      <button class="pm-item danger" role="menuitem" data-pm="signout">Sign out</button>`;
    menu.querySelectorAll('[data-theme-pick]').forEach(b=>b.addEventListener('click', ()=>{ setLedgerTheme(b.dataset.themePick); draw(); }));
    menu.querySelector('[data-pm="password"]').addEventListener('click', ()=>{ closeProfileMenu(); openPasswordModal(); });
    menu.querySelector('[data-pm="settings"]').addEventListener('click', ()=>{ closeProfileMenu(); openSettings(); });
    menu.querySelector('[data-pm="signout"]').addEventListener('click', signOut);
    menu.querySelectorAll('a.pm-item').forEach(a=>a.addEventListener('click', closeProfileMenu));
  };
  draw();
  const r = btn.getBoundingClientRect();
  menu.style.top = (r.bottom + 8) + 'px';
  menu.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
  menu.addEventListener('click', e=>e.stopPropagation());
  document.body.appendChild(menu);
  btn.setAttribute('aria-expanded', 'true');
  const first = menu.querySelector('.pm-item'); if(first) first.focus();
}
document.addEventListener('click', e=>{ if(!e.target.closest || !e.target.closest('#profile-btn')) closeProfileMenu(); });
document.addEventListener('keydown', e=>{ if(e.key === 'Escape') closeProfileMenu(); });
window.addEventListener('resize', closeProfileMenu);

function openPasswordModal(){
  if(ET_AUTH){
    openModal('Change username or password', 'One sign-in for both apps', `
      <p style="font-size:13.5px;color:var(--ink-secondary);">In this browser the Ledger opens with your <b>Expense Tracker</b> sign-in (${escAttr(ET_AUTH.username)}).
      Change it there - Settings → Sign-in - and the Ledger follows.</p>
      <div class="corpus-actions" style="margin-top:12px;"><a class="snap-add-btn" style="text-decoration:none;" href="https://anilgupta2606.github.io/expenseTracker/" target="_blank" rel="noopener">Open the Expense Tracker ↗</a></div>`);
    return;
  }
  openModal('Change username or password', 'Saved with your plan, on every device that opens it.', `
    <form id="pw-form" class="pw-form" autocomplete="off">
      <div class="field"><label for="pw-cur">Current password</label><input type="password" id="pw-cur" autocomplete="current-password" required></div>
      <div class="field"><label for="pw-user">Username</label><input type="text" id="pw-user" autocapitalize="none" spellcheck="false" required></div>
      <div class="field"><label for="pw-new">New password</label><input type="password" id="pw-new" autocomplete="new-password" minlength="4" required></div>
      <div class="field"><label for="pw-new2">Repeat new password</label><input type="password" id="pw-new2" autocomplete="new-password" required></div>
      <p class="login-err" id="pw-err" role="alert" hidden></p>
      <div class="corpus-actions"><button class="snap-add-btn" type="submit">Save new sign-in</button></div>
      <p class="footnote">This locks the page on screen; it doesn't encrypt the plan. Pick a password you'll remember: there's no reset link here.</p>
    </form>`);
  document.getElementById('pw-user').value = ledgerUser();
  document.getElementById('pw-cur').focus();
  document.getElementById('pw-form').addEventListener('submit', async e=>{
    e.preventDefault();
    const err = document.getElementById('pw-err');
    const say = m=>{ err.textContent = m; err.hidden = false; };
    const user = document.getElementById('pw-user').value.trim();
    const pass = document.getElementById('pw-new').value;
    if(!(await checkLogin(ledgerUser(), document.getElementById('pw-cur').value))) return say('The current password is wrong.');
    if(!/^[A-Za-z0-9._@-]{3,40}$/.test(user)) return say('Use 3–40 letters, numbers or . _ @ - for the username.');
    if(pass.length < 4) return say('Use at least 4 characters for the password.');
    if(pass !== document.getElementById('pw-new2').value) return say('The two new passwords don’t match.');
    STATE.auth = {user, hash: await sha256(user.toLowerCase() + ':' + pass)};
    setSignedIn(true);
    renderProfileBadge();
    closeModal();
    markDirty();
    /* Saved straight away: an unsaved password change would quietly revert
       on the next load and lock you out of the one you just typed. */
    saveState();
  });
}

/* =========================================================
   INVESTMENTS FROM THE EXPENSE TRACKER — pasted in, for information.
   The expense tracker's "Copy for Ledger" button copies each month's
   investment totals; nothing here reads or changes the rest of the plan.
   ========================================================= */
function parseExpenseInvest(text){
  let v = null;
  extractJsonBlobs(text).some(b=>{
    if(b && b.ledgerImport === 'expense-tracker' && Array.isArray(b.months)){ v = b; return true; }
    return false;
  });
  if(!v) return null;
  const months = v.months.filter(m=>m && /^\d{4}-\d{2}$/.test(String(m.month))).map(m=>{
    const byType = {};
    Object.keys(m.byType || {}).slice(0, 20).forEach(k=>{ const n = Number(m.byType[k]); if(isFinite(n)) byType[String(k).slice(0,40)] = n; });
    return {month:String(m.month), invested:Number(m.invested)||0, redeemed:Number(m.redeemed)||0, byType};
  });
  return {exportedAt:String(v.exportedAt||'').slice(0,10), months};
}

function renderExpenseInvest(){
  const wrap = document.getElementById('xi-body');
  if(!wrap) return;
  const data = STATE.expenseInvest;
  if(!data || !data.months || !data.months.length){
    wrap.innerHTML = `<p class="xi-empty">In the expense tracker, open <b>Overview</b> → <b>Investments by type</b> → <b>Copy for Ledger</b>, then tap <b>Paste from expense tracker</b> here.</p>`;
    return;
  }
  const months = data.months.slice().sort((a,b)=> a.month < b.month ? 1 : -1);
  const tot = months.reduce((s,m)=>s + m.invested, 0);
  const avg = tot / months.length;
  wrap.innerHTML = `
    <div class="table-wrap" style="box-shadow:none;">
      <table class="xi-table">
        <thead><tr><th class="name">Month</th><th>Invested</th><th>Redeemed</th><th>By type</th></tr></thead>
        <tbody>${months.map(m=>`<tr>
          <td class="name">${ymLabel(m.month)}</td>
          <td class="amt">${fmtINR(m.invested)}</td>
          <td class="amt">${m.redeemed ? fmtINR(m.redeemed) : '—'}</td>
          <td>${Object.keys(m.byType).sort((a,b)=>m.byType[b]-m.byType[a]).map(k=>escAttr(k) + ' ' + fmtCompact(m.byType[k])).join(' · ') || '—'}</td>
        </tr>`).join('')}</tbody>
        <tfoot><tr><td>${months.length} month${months.length===1?'':'s'}</td><td>${fmtINR(tot)}</td><td colspan="2">about ${fmtINR(avg)} a month · plan SIP ${fmtINR(totalSIP())}</td></tr></tfoot>
      </table>
    </div>
    <p class="footnote">From your bank statements in the expense tracker, copied ${data.exportedAt ? fmtDate(data.exportedAt) : ''}. For information only — nothing else on this page uses it.</p>`;
}

function wireExpenseInvest(){
  const tog = document.getElementById('xi-paste-toggle');
  if(!tog) return;
  tog.addEventListener('click', ()=>{
    const box = document.getElementById('xi-paste');
    box.hidden = !box.hidden;
    if(!box.hidden) document.getElementById('xi-text').focus();
  });
  document.getElementById('xi-check').addEventListener('click', ()=>{
    const msg = document.getElementById('xi-msg');
    const got = parseExpenseInvest(document.getElementById('xi-text').value);
    if(!got || !got.months.length){
      msg.textContent = 'That isn’t a copy from the expense tracker. Use its “Copy for Ledger” button and paste the whole thing.';
      msg.className = 'xi-msg err';
      return;
    }
    STATE.expenseInvest = {exportedAt: got.exportedAt, importedAt: new Date().toISOString(), months: got.months};
    markDirty();
    document.getElementById('xi-text').value = '';
    document.getElementById('xi-paste').hidden = true;
    msg.textContent = got.months.length + ' month' + (got.months.length===1?'':'s') + ' added. Hit Save to keep them.';
    msg.className = 'xi-msg ok';
    renderExpenseInvest();
  });
}

/* =========================================================
   BOOT
   ========================================================= */
/* Work that needs the plan open: sync, and a fresh read from ATS on this Mac. */
let AFTER_SIGN_IN_DONE = false;
function afterSignIn(){
  if(AFTER_SIGN_IN_DONE) return;
  AFTER_SIGN_IN_DONE = true;
  startSync();
  if(ATS_JUST_LINKED){ flashSaveStatus('ATS linked — reading your holdings'); openSettings('ats'); refreshFromAts(false); }
  else refreshFromAts(true);
}
const ATS_JUST_LINKED = Cloud.takeAtsLinkFromUrl();
applyLedgerTheme();
Cloud.expenseTracker().then(et=>{ ET_AUTH = et && et.auth && et.auth.passwordHash ? et.auth : null; renderProfileBadge(); });
if(!isSignedIn()) showLogin();
buildShell();
hydrateLiveFromState();   // saved holdings populate the page with no connector
renderTopbar();
Object.keys(RENDERERS).forEach(id=>RENDERERS[id]());
wireSearch();
initAsk();
renderProfileBadge();
document.getElementById('profile-btn').addEventListener('click', e=>{ e.stopPropagation(); toggleProfileMenu(); });
document.getElementById('footer-updated').textContent = 'Rendered ' + fmtDate(new Date());
renderPlanSource();
if(isSignedIn()) afterSignIn();
