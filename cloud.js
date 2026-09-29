"use strict";
/* =========================================================
   CLOUD — everything the Ledger reaches outside this browser tab:
   · the Expense Tracker's sign-in and AI keys (same site, same browser),
   · encrypted sync between devices through a private GitHub Gist,
   · the free AI services behind "Ask",
   · live holdings from ATS on this Mac.
   Nothing personal lives in this file or anywhere in the site's code: the
   plan stays in this browser, and leaves it only encrypted.
   ========================================================= */
const Cloud = (function(){

  const lsGet = (k, d) => { try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } };
  const lsSet = (k, v) => { try{ if(v === undefined) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };

  /* ---------------------------------------------------------------- Expense Tracker (same site)
     Both apps are served from anilgupta2606.github.io, so this browser holds the
     Expense Tracker's saved data too. The Ledger only READS it: the sign-in, so one
     password opens both, and the AI keys, so they need entering once. The database
     is opened only if it already exists - opening a missing one would create an
     empty copy that the Expense Tracker would then trip over. */
  let etPromise = null;
  /* fresh: read again (the Expense Tracker may have imported statements since) */
  function expenseTracker(fresh){
    if(etPromise && !fresh) return etPromise;
    etPromise = (async ()=>{
      try{
        if(!window.indexedDB) return null;
        if(indexedDB.databases){
          const list = await indexedDB.databases();
          if(!list.some(d=>d.name === 'expense-tracker')) return null;
        }
        const db = await new Promise((res, rej)=>{
          const req = indexedDB.open('expense-tracker');
          req.onupgradeneeded = ()=>{ try{ req.transaction.abort(); }catch(e){} };
          req.onsuccess = ()=>res(req.result);
          req.onerror = ()=>rej(req.error);
          req.onblocked = ()=>rej(new Error('blocked'));
        });
        try{
          if(!db.objectStoreNames.contains('kv')) return null;
          const s = await new Promise((res, rej)=>{
            const r = db.transaction('kv').objectStore('kv').get('state');
            r.onsuccess = ()=>res(r.result); r.onerror = ()=>rej(r.error);
          });
          if(!s) return null;
          const st = s.settings || {};
          const txns = etRows(s.txns);
          return {auth: s.auth || null, txns, invest: investMonths(txns),
                  ai: {keys: Object.assign({}, st.aiKeys || {}, st.geminiKey ? {gemini: st.geminiKey} : {}),
                       order: st.aiOrder || [], off: st.aiOff || [], model: st.aiModel || {}}};
        } finally { db.close(); }
      }catch(e){ return null; }
    })();
    return etPromise;
  }

  /* The Expense Tracker's transactions as its own totals see them: a payment split into parts
     (Rs 1,000 Shopping + Rs 4,000 Gold, say) is one row per part, each with its own amount, type and
     category; Counted, the date and the card pairing are the payment's. Before splits were read,
     a split payment's investment part was missed here and its spending counted in full. */
  function etRows(list){
    const out = [];
    (list || []).forEach(t=>{
      const base = {date:String(t.date || ''), direction:t.direction, excluded:!!t.excluded, paired:!!t.pairId};
      const parts = Array.isArray(t.splits) && t.splits.length >= 2 ? t.splits : null;
      if(parts) parts.forEach(p=>out.push(Object.assign({}, base, {amount:Number(p.amount) || 0, kind:p.kind, category:p.category || ''})));
      else out.push(Object.assign({}, base, {amount:Number(t.amount) || 0, kind:t.kind, category:t.category || ''}));
    });
    return out;
  }

  /* Money put into (and taken out of) investments each month, by type - exactly what the
     Expense Tracker's "Copy for Ledger" button copies (counted investment rows, amounts only). */
  function investMonths(txns){
    const r2 = n => Math.round(n * 100) / 100, by = {};
    txns.forEach(t=>{
      if(t.kind !== 'investment' || t.excluded || !/^\d{4}-\d{2}/.test(t.date)) return;
      const m = t.date.slice(0, 7), e = by[m] || (by[m] = {invested:0, redeemed:0, byType:{}});
      if(t.direction === 'debit'){ e.invested += t.amount; e.byType[t.category] = (e.byType[t.category] || 0) + t.amount; }
      else e.redeemed += t.amount;
    });
    return Object.keys(by).sort().map(m=>({month:m, invested:r2(by[m].invested), redeemed:r2(by[m].redeemed),
      byType: Object.fromEntries(Object.entries(by[m].byType).map(([k, v])=>[k, r2(v)]))}));
  }

  async function sha256(text){
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.prototype.map.call(new Uint8Array(buf), b=>b.toString(16).padStart(2,'0')).join('');
  }
  /* The Expense Tracker's password check, exactly as it does it. -> true / false / null (no account here) */
  async function checkExpenseTrackerLogin(user, pass){
    const et = await expenseTracker();
    if(!et || !et.auth || !et.auth.passwordHash) return null;
    const u = String(user || '').trim();
    if(u.toLowerCase() !== String(et.auth.username || '').toLowerCase()) return false;
    return await sha256('expense-tracker|' + u.toLowerCase() + '|' + pass) === et.auth.passwordHash;
  }

  /* ---------------------------------------------------------------- encryption (same scheme as the Expense Tracker) */
  const ITER = 200000;
  const b64 = bytes => { let s = ''; for(let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c=>c.charCodeAt(0));
  async function keyFor(pass, salt){
    const raw = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2', salt, iterations:ITER, hash:'SHA-256'}, raw, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
  }
  async function pipe(bytes, stream){
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
  }
  async function seal(obj, pass, rev){
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    let bytes = new TextEncoder().encode(JSON.stringify(obj));
    const gz = typeof CompressionStream !== 'undefined';
    if(gz) bytes = await pipe(bytes, new CompressionStream('gzip'));
    const data = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM', iv}, await keyFor(pass, salt), bytes));
    return {app:'ledger-sync', v:1, rev, savedAt:Date.now(), salt:b64(salt), iv:b64(iv), gz, data:b64(data)};
  }
  async function unseal(env, pass){
    let bytes;
    try{ bytes = new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM', iv:unb64(env.iv)}, await keyFor(pass, unb64(env.salt)), unb64(env.data))); }
    catch(e){ throw new Error('The sync passphrase doesn’t match the one used on your other device.'); }
    if(env.gz) bytes = await pipe(bytes, new DecompressionStream('gzip'));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  /* ---------------------------------------------------------------- sync through a private GitHub Gist */
  const SYNC_FILE = 'investment-plan.sync.json';
  const SYNC_CFG = 'ledger-sync-config', SYNC_CHANGED = 'ledger-sync-changed-at', SYNC_OTHER = 'ledger-sync-other';
  const syncConfig = () => lsGet(SYNC_CFG, null);
  const saveSyncConfig = c => lsSet(SYNC_CFG, c || undefined);
  /* The Expense Tracker's own sync settings in this browser, to offer reusing them. */
  const expenseTrackerSync = () => { const c = lsGet('sync-config', null); return c && c.token && c.pass ? c : null; };

  async function gh(cfg, path, init){
    init = init || {};
    const res = await fetch('https://api.github.com' + path, Object.assign({}, init, {
      headers: Object.assign({Accept:'application/vnd.github+json', Authorization:'Bearer ' + cfg.token, 'X-GitHub-Api-Version':'2022-11-28'},
        init.body ? {'Content-Type':'application/json'} : {}),
      cache:'no-store'}));
    if(res.status === 401) throw new Error('GitHub refused the token. Check it has the Gists permission and hasn’t expired.');
    if(res.status === 403 || res.status === 404) throw new Error('GitHub said ' + res.status + '. The token needs “Gists: read and write”.');
    if(!res.ok) throw new Error('GitHub error ' + res.status + '.');
    return res;
  }
  async function readRemote(cfg){
    if(!cfg.gistId){
      for(let page = 1; page <= 5 && !cfg.gistId; page++){
        const list = await (await gh(cfg, '/gists?per_page=100&page=' + page)).json();
        const hit = list.find(g=>g.files && SYNC_FILE in g.files);
        if(hit) cfg.gistId = hit.id;
        if(list.length < 100) break;
      }
      if(!cfg.gistId) return null;
    }
    const gist = await (await gh(cfg, '/gists/' + cfg.gistId)).json();
    const f = gist.files && gist.files[SYNC_FILE];
    if(!f) return null;
    const text = f.truncated && f.raw_url ? await (await fetch(f.raw_url, {cache:'no-store'})).text() : (f.content || '');
    const env = JSON.parse(text);
    if(env.app !== 'ledger-sync') throw new Error('The sync gist holds something else.');
    return env;
  }
  async function writeRemote(cfg, env){
    const files = {}; files[SYNC_FILE] = {content: JSON.stringify(env)};
    if(cfg.gistId) await gh(cfg, '/gists/' + cfg.gistId, {method:'PATCH', body:JSON.stringify({files})});
    else cfg.gistId = (await (await gh(cfg, '/gists', {method:'POST', body:JSON.stringify({description:'Investment plan sync (encrypted)', public:false, files})})).json()).id;
  }

  /* A saved change on this device, for the next sync to carry up. */
  const markSaved = () => lsSet(SYNC_CHANGED, Date.now());
  let running = null;
  /* getSaved() -> the last SAVED plan; apply(plan) puts a newer one from the other device here.
     -> 'pushed' | 'pulled' | 'kept-both' | 'unchanged' | 'waiting' */
  function syncNow(getSaved, apply, canApply){
    if(!running) running = runSync(getSaved, apply, canApply).finally(()=>{ running = null; });
    return running;
  }
  async function runSync(getSaved, apply, canApply){
    const cfg = syncConfig();
    if(!cfg) throw new Error('Sync is off.');
    const finish = (rev, result) => { saveSyncConfig(Object.assign(cfg, {rev, syncedAt:Date.now(), lastError:undefined})); return result; };
    const newRev = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
    try{
      const remote = await readRemote(cfg);
      const changed = (lsGet(SYNC_CHANGED, 0) || 0) > (cfg.syncedAt || 0);
      if(!remote){ const rev = newRev(); await writeRemote(cfg, await seal(getSaved(), cfg.pass, rev)); return finish(rev, 'pushed'); }
      if(remote.rev === cfg.rev){
        if(!changed) return finish(remote.rev, 'unchanged');
        const rev = newRev(); await writeRemote(cfg, await seal(getSaved(), cfg.pass, rev)); return finish(rev, 'pushed');
      }
      const theirs = await unseal(remote, cfg.pass);
      if(cfg.rev && !changed){
        if(!canApply()) return 'waiting';               // unsaved edits here: try again after Save / Discard
        await apply(theirs);
        return finish(remote.rev, 'pulled');
      }
      if(!cfg.rev && !changed){                         // this device's first sync, nothing saved here yet
        if(!canApply()) return 'waiting';
        await apply(theirs);
        return finish(remote.rev, 'pulled');
      }
      // both devices saved since they last met: this device's plan wins, the other is kept to switch to
      lsSet(SYNC_OTHER, {savedAt: remote.savedAt, plan: theirs});
      const rev = newRev(); await writeRemote(cfg, await seal(getSaved(), cfg.pass, rev));
      return finish(rev, 'kept-both');
    }catch(e){
      saveSyncConfig(Object.assign(cfg, {lastError: e.message}));
      throw e;
    }
  }
  const otherVersion = () => lsGet(SYNC_OTHER, null);
  const dropOtherVersion = () => lsSet(SYNC_OTHER, undefined);
  function forgetSync(){ lsSet(SYNC_CFG, undefined); lsSet(SYNC_CHANGED, undefined); lsSet(SYNC_OTHER, undefined); }

  /* ---------------------------------------------------------------- free AI services
     The same services and order as the Expense Tracker. Keys entered here win;
     otherwise the Expense Tracker's keys in this browser are used, so there is
     nothing to set up twice. A service that is out of free quota rests 15 minutes. */
  const PROVIDERS = [
    {id:'gemini', name:'Google Gemini', signupUrl:'https://aistudio.google.com/apikey', placeholder:'AIza…', models:['gemini-flash-latest','gemini-flash-lite-latest']},
    {id:'groq', name:'Groq', signupUrl:'https://console.groq.com/keys', placeholder:'gsk_…', models:['openai/gpt-oss-120b','llama-3.3-70b-versatile','openai/gpt-oss-20b']},
    {id:'cerebras', name:'Cerebras', signupUrl:'https://cloud.cerebras.ai', placeholder:'csk-…', models:['gpt-oss-120b','llama-3.3-70b','llama3.1-8b']},
    {id:'mistral', name:'Mistral', signupUrl:'https://console.mistral.ai/api-keys', placeholder:'key', models:['mistral-small-latest','mistral-medium-latest']},
    {id:'openrouter', name:'OpenRouter', signupUrl:'https://openrouter.ai/keys', placeholder:'sk-or-…', models:['openrouter/free','meta-llama/llama-3.3-70b-instruct:free']},
    {id:'anthropic', name:'Anthropic Claude (paid)', signupUrl:'https://console.anthropic.com/settings/keys', placeholder:'sk-ant-…', models:['claude-haiku-4-5-20251001']},
    {id:'ollama', name:'Local (Ollama)', signupUrl:'https://ollama.com', placeholder:'http://localhost:11434', models:[], keyless:true},
  ];
  const OPENAI_BASE = {groq:'https://api.groq.com/openai/v1', cerebras:'https://api.cerebras.ai/v1', mistral:'https://api.mistral.ai/v1', openrouter:'https://openrouter.ai/api/v1'};
  const AI_KEY = 'ledger-ai', REST_KEY = 'ledger-ai-rest', MODELS_KEY = 'ledger-ai-models';
  const aiLocal = () => lsGet(AI_KEY, {keys:{}, order:[], off:[]});
  const saveAiLocal = s => lsSet(AI_KEY, s);
  let etAi = null;
  async function loadAi(){ const et = await expenseTracker(); etAi = et ? et.ai : null; return aiSettings(); }
  /* This device's keys first, then the Expense Tracker's for any service not set here. */
  function aiSettings(){
    const own = aiLocal(), et = etAi || {keys:{}, order:[], off:[], model:{}};
    const keys = {}, from = {};
    PROVIDERS.forEach(p=>{
      const mine = String((own.keys || {})[p.id] || '').trim(), theirs = String((et.keys || {})[p.id] || '').trim();
      if(mine){ keys[p.id] = mine; from[p.id] = 'ledger'; } else if(theirs){ keys[p.id] = theirs; from[p.id] = 'expense-tracker'; }
    });
    const order = (own.order && own.order.length ? own.order : et.order || []).filter(id=>PROVIDERS.some(p=>p.id === id));
    PROVIDERS.forEach(p=>{ if(order.indexOf(p.id) < 0) order.push(p.id); });
    const off = own.order && own.order.length ? (own.off || []) : (et.off || []);
    return {keys, from, order, off, model: Object.assign({}, et.model || {}, own.model || {})};
  }
  const usable = s => s.order.filter(id=>s.off.indexOf(id) < 0 && s.keys[id]);
  const aiAvailable = () => usable(aiSettings()).length > 0;
  const aiNames = () => usable(aiSettings()).map(id=>PROVIDERS.find(p=>p.id === id).name);

  const restMap = () => lsGet(REST_KEY, {});
  function resting(id){ const r = restMap()[id]; return r && r.until > Date.now() ? r : null; }
  function rest(id, why){ const m = restMap(); m[id] = {until: Date.now() + 15 * 60000, why}; lsSet(REST_KEY, m); }
  function wake(id){ const m = restMap(); delete m[id]; lsSet(REST_KEY, m); }

  function Unavailable(message, status, limit){ const e = new Error(message); e.unavailable = true; e.status = status; e.limit = !!limit; return e; }
  async function post(url, headers, body, signal){
    const ctl = new AbortController(), timer = setTimeout(()=>ctl.abort(), 90000);
    if(signal) signal.addEventListener('abort', ()=>ctl.abort());
    try{ return await fetch(url, {method:'POST', headers:Object.assign({'Content-Type':'application/json'}, headers), body:JSON.stringify(body), signal:ctl.signal}); }
    catch(e){
      if(signal && signal.aborted){ const c = new Error('Stopped.'); c.code = 'cancelled'; throw c; }
      if(e.name === 'AbortError') throw Unavailable('No answer in time.', 504);
      throw Unavailable('Could not reach the service (offline, or it blocked the request).', 503);
    } finally { clearTimeout(timer); }
  }
  async function failure(name, res){
    const body = await res.text().catch(()=>'');
    if(res.status === 401 || res.status === 403 || (res.status === 400 && /api[ _-]?key|unauthori[sz]ed|invalid.*key/i.test(body))) throw new Error(name + ' rejected the API key.');
    if(res.status === 429 || /quota|rate.?limit|exhausted|too many/i.test(body)) throw Unavailable(name + ': free limit reached for now.', 429, true);
    if(res.status === 402) throw Unavailable(name + ': no credit left on this account.', 402, true);
    if(res.status === 404) throw Unavailable(name + ': model not available to this key.', 404);
    if(res.status >= 500) throw Unavailable(name + ' is busy right now.', res.status);
    throw Unavailable(name + ' returned an error (' + res.status + ').', res.status);
  }
  /* One chat turn. system: instructions; turns: [{role:'user'|'assistant', content}] */
  async function callOne(id, key, model, system, turns, signal){
    const name = PROVIDERS.find(p=>p.id === id).name;
    if(id === 'gemini'){
      const res = await post('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key), {},
        {systemInstruction:{parts:[{text:system}]}, contents: turns.map(t=>({role: t.role === 'assistant' ? 'model' : 'user', parts:[{text:t.content}]})),
         generationConfig:{temperature:0.2, maxOutputTokens:4096}}, signal);
      if(!res.ok) await failure(name, res);
      const d = await res.json();
      const text = ((((d.candidates || [])[0] || {}).content || {}).parts || []).map(p=>p.text || '').join('');
      if(!text) throw Unavailable('Gemini returned an empty answer.', 502);
      return text;
    }
    if(id === 'anthropic'){
      const res = await post('https://api.anthropic.com/v1/messages', {'x-api-key':key, 'anthropic-version':'2023-06-01', 'anthropic-dangerous-direct-browser-access':'true'},
        {model, max_tokens:4096, temperature:0.2, system, messages:turns}, signal);
      if(!res.ok) await failure(name, res);
      const d = await res.json();
      return (d.content || []).map(c=>c.text || '').join('');
    }
    const base = id === 'ollama' ? key.replace(/\/+$/, '') + '/v1' : OPENAI_BASE[id];
    const headers = id === 'ollama' ? {} : {Authorization:'Bearer ' + key};
    if(id === 'openrouter'){ headers['HTTP-Referer'] = location.origin; headers['X-Title'] = 'Investment Plan'; }
    const res = await post(base + '/chat/completions', headers,
      {model, temperature:0.2, max_tokens:4096, messages:[{role:'system', content:system}].concat(turns)}, signal);
    if(!res.ok) await failure(name, res);
    const d = await res.json();
    const text = ((((d.choices || [])[0] || {}).message) || {}).content || '';
    if(!text) throw Unavailable(name + ' returned an empty answer.', 502);
    return text;
  }

  /* ---- the best model a key can use (the Expense Tracker's ranking, for chat) ---- */
  const NOT_CHAT = /embed|tts|whisper|audio|speech|transcribe|image|imagen|veo|lyria|dall|guard|moderation|ocr|rerank|live|realtime|robotics|computer-use|omni|customtools|aqa|learnlm|search|compound|playai|safeguard/i;
  const PREFER = ['gpt-oss-120b','kimi-k2','qwen3-235b','qwen-3-235b','llama-4-maverick','deepseek-v3','llama-3.3-70b','mistral-large','mistral-medium','qwen3-32b','qwen-3-32b','llama-4-scout','mistral-small','gpt-oss-20b','gemma-3-27b','ministral-8b','llama-3.1-8b','llama3.1-8b'];
  const sizeB = m => Number((m.match(/(\d+(?:\.\d+)?)b\b/i) || [])[1] || 0);
  const verOf = m => Number((m.match(/(\d+(?:\.\d+)?)/) || [])[1] || 0);
  const prefIdx = m => { const i = PREFER.findIndex(p=>m.toLowerCase().indexOf(p) >= 0); return i < 0 ? PREFER.length : i; };
  function rankModels(id, names){
    const uniq = Array.from(new Set(names)).filter(m=>!NOT_CHAT.test(m));
    if(id === 'gemini'){
      const g = uniq.filter(m=>/^gemini/.test(m) && !/gemma|nano|tuning/.test(m));
      const preview = m => /preview|exp|thinking/.test(m) ? 1 : 0, kind = m => /lite/.test(m) ? 2 : /flash/.test(m) ? 3 : /pro/.test(m) ? 1 : 0, alias = m => /-latest$/.test(m);
      const newest = k => Math.max.apply(null, [0].concat(g.filter(m=>!alias(m) && !preview(m) && kind(m) === k).map(verOf)));
      const score = m => [preview(m), -kind(m), -(alias(m) ? newest(kind(m)) : verOf(m)), alias(m) ? 1 : 0];
      return g.sort((a, b)=>{ const x = score(a), y = score(b); for(let i = 0; i < x.length; i++) if(x[i] !== y[i]) return x[i] - y[i]; return a.localeCompare(b); });
    }
    if(id === 'anthropic'){ const tier = m => /haiku/.test(m) ? 0 : /sonnet/.test(m) ? 1 : 2; return uniq.filter(m=>/^claude/.test(m) && !/opus/.test(m)).sort((a, b)=>tier(a) - tier(b)); }
    if(id === 'ollama') return uniq.sort((a, b)=>(sizeB(a) || 99) - (sizeB(b) || 99));
    let list = uniq;
    if(id === 'openrouter') list = uniq.filter(m=>/:free$/.test(m) || m === 'openrouter/free');
    const ranked = list.filter(m=>m !== 'openrouter/free').sort((a, b)=>prefIdx(a) - prefIdx(b) || sizeB(b) - sizeB(a) || a.localeCompare(b));
    return id === 'openrouter' && list.indexOf('openrouter/free') >= 0 ? ranked.slice(0, 3).concat(['openrouter/free'], ranked.slice(3)) : ranked;
  }
  async function listModels(id, key){
    let res;
    if(id === 'gemini') res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=' + encodeURIComponent(key));
    else if(id === 'anthropic') res = await fetch('https://api.anthropic.com/v1/models', {headers:{'x-api-key':key, 'anthropic-version':'2023-06-01', 'anthropic-dangerous-direct-browser-access':'true'}});
    else if(id === 'ollama') res = await fetch(key.replace(/\/+$/, '') + '/api/tags');
    else res = await fetch(OPENAI_BASE[id] + '/models', {headers:{Authorization:'Bearer ' + key}});
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    if(id === 'gemini') return (d.models || []).filter(m=>(m.supportedGenerationMethods || []).indexOf('generateContent') >= 0).map(m=>m.name.replace(/^models\//, ''));
    if(id === 'ollama') return (d.models || []).map(m=>m.name);
    return (d.data || []).map(m=>m.id);
  }
  async function bestModels(id, key){
    const cache = lsGet(MODELS_KEY, {}), c = cache[id], tag = key.slice(-6);
    if(c && c.key === tag && Date.now() - c.at < 86400000 && c.models.length) return c.models;
    try{
      const ranked = rankModels(id, await listModels(id, key));
      if(ranked.length){ cache[id] = {at:Date.now(), key:tag, models:ranked}; lsSet(MODELS_KEY, cache); return ranked; }
    }catch(e){}
    return PROVIDERS.find(p=>p.id === id).models;
  }

  const chosen = {};
  /* -> {text, provider, model}; tries each service in order, moves on when one is out of quota or busy. */
  async function chat(system, turns, signal){
    const s = aiSettings(), order = usable(s);
    if(!order.length) throw new Error('Add a free AI key (Profile → AI assistants), or add one in the Expense Tracker.');
    const skipped = []; let lastError = null;
    for(const id of order){
      const r = resting(id);
      if(r){ skipped.push(PROVIDERS.find(p=>p.id === id).name + ' is resting (' + r.why + ')'); continue; }
      const key = s.keys[id];
      const pinned = s.model[id] && s.model[id] !== 'auto' ? [s.model[id]] : [];
      const models = Array.from(new Set(pinned.concat(chosen[id] ? [chosen[id]] : [], await bestModels(id, key), PROVIDERS.find(p=>p.id === id).models))).slice(0, 4);
      for(const model of models){
        try{
          const text = await callOne(id, key, model, system, turns, signal);
          chosen[id] = model; wake(id);
          return {text, provider: PROVIDERS.find(p=>p.id === id).name, model};
        }catch(e){
          if(e.code === 'cancelled') throw e;
          lastError = e;
          if(!e.unavailable){ skipped.push(e.message); break; }
          if(e.limit){ rest(id, e.message); break; }
        }
      }
    }
    const why = skipped.concat(lastError && lastError.unavailable ? [lastError.message] : []);
    throw new Error('No AI service could answer' + (why.length ? ': ' + why.join('; ') : '') + '. Try again later or add another free key.');
  }

  /* ---------------------------------------------------------------- ATS on this Mac
     ATS gives this page a read-only link (a random key) once you are signed in there;
     with it the page reads your holdings, valued live, straight from ATS. It works
     only on the Mac that runs ATS - elsewhere the last holdings read (synced) are shown. */
  const ATS_KEY = 'ledger-ats';
  const atsLink = () => lsGet(ATS_KEY, null);
  function takeAtsLinkFromUrl(){
    const m = /[#&]ats-link=([A-Za-z0-9_-]{20,})(?:&ats=([^&]+))?/.exec(location.hash || '');
    if(!m) return false;
    lsSet(ATS_KEY, {token:m[1], url: m[2] ? decodeURIComponent(m[2]) : 'http://localhost:8765', linkedAt:Date.now()});
    try{ history.replaceState(null, '', location.pathname + location.search); }catch(e){ location.hash = ''; }
    return true;
  }
  function atsLinkUrl(){
    const back = location.origin + location.pathname;
    return 'http://localhost:8765/ledger/link?back=' + encodeURIComponent(back);
  }
  async function atsHoldings(){
    const l = atsLink();
    if(!l) throw new Error('not linked');
    let res;
    const ctl = new AbortController(), t = setTimeout(()=>ctl.abort(), 20000);
    try{ res = await fetch(l.url.replace(/\/+$/, '') + '/api/ledger/holdings', {headers:{Authorization:'Bearer ' + l.token}, cache:'no-store', signal:ctl.signal}); }
    catch(e){ const err = new Error('ATS isn’t reachable from this device (it runs on your Mac, and must be open).'); err.offline = true; throw err; }
    finally{ clearTimeout(t); }
    if(res.status === 401 || res.status === 403){ const err = new Error('ATS no longer accepts this link - link it again.'); err.unlinked = true; throw err; }
    if(!res.ok) throw new Error('ATS returned an error (' + res.status + ').');
    const d = await res.json();
    if(!d.ok) throw new Error(d.error || 'ATS could not value the holdings.');
    return d;
  }
  const unlinkAts = () => lsSet(ATS_KEY, undefined);

  return {expenseTracker, etRows, investMonths, checkExpenseTrackerLogin, sha256,
          syncConfig, saveSyncConfig, expenseTrackerSync, syncNow, markSaved, forgetSync, otherVersion, dropOtherVersion, seal, unseal,
          PROVIDERS, loadAi, aiSettings, aiLocal, saveAiLocal, aiAvailable, aiNames, resting, wake, chat, listModels, rankModels,
          atsLink, takeAtsLinkFromUrl, atsLinkUrl, atsHoldings, unlinkAts};
})();
