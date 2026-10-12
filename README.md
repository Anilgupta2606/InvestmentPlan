# The 16-Year Ledger

A long-range investment plan in the browser: SIPs by fund, the glide path by age, projections,
an action calendar, contribution checks, and your holdings read live from ATS.

**Live:** https://anilgupta2606.github.io/InvestmentPlan/

## Where your data lives

Nothing personal is in this repository. The site is only the app.

- **The plan** is kept in your browser's site storage. **Profile → Settings → Sync** encrypts it on the device
  (AES-GCM, key from your sync passphrase) and keeps it in a private GitHub Gist, so the laptop and the phone
  show the same plan. GitHub only ever holds unreadable text.
- **Holdings** come from ATS on your Mac, which gets them from INDmoney and Groww. Link it once
  (Import portfolio → Link ATS); the page then reads them, valued live, whenever it opens on that Mac.
  ATS gives the page a read-only key and answers only this site.
- **Ask AI** uses free AI services (Gemini, Groq, Cerebras, Mistral, OpenRouter, local Ollama) with your own keys.
  Keys added in the Expense Tracker are used here too, in the same browser.
- **Sign-in** is the Expense Tracker's username and password where that app is used in the same browser.

A browser with no plan yet shows a small example until you restore yours (Overview → Your data → Restore).

## Files

`index.html` (page), `style.css`, `app.js` (the plan), `cloud.js` (sync, AI, ATS, shared sign-in). No build step.

## Tests

`node tests/ledger.e2e.mjs` — the page in real Chrome with made-up holdings as ATS sends them (Groww units and buy prices, mutual funds, Bitcoin tracked by hand, INDmoney's ₹0 Crypto class); what broke once must stay fixed.
