/* ============================================================
   One Step Ahead — app.js
   Vanilla JS. No build step. No framework.
   - One step at a time, ever, in UI and DOM.
   - Live mode: POSTs to the server.js proxy (/api/step).
   - Demo mode: offline fallback engine, clearly labeled.
   - State: memory + localStorage (wrapped in try/catch) for
     refresh / "Take a break" resume.
   Rendering is done purely via .textContent (never HTML strings,
   never console logs).
   ============================================================ */

var OneStepAhead = (function () {
  'use strict';

  var STORAGE_KEY = 'oneStepAhead.v1';
  var PREFS_KEY = 'oneStepAhead.prefs.v1';
  var STEP_TIMEOUT_MS = 15000; // calm loading, then a friendly retry
  var MAX_HISTORY = 8;         // compact context for the model

  // Non-Latin scripts: we cannot mechanically verify verb starts,
  // so the validator relaxes that one check for them.
  var NON_LATIN = /[\u00C0-\u024F\u0370-\u04FF\u0590-\u05FF\u0600-\u06FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/;

  var ACKS = [
    "Nice. That's started.",
    'That counts.',
    'Real progress.',
    'One more done. Quietly.',
    "That's momentum.",
    'Steady counts.'
  ];

  var LOADING_MSG = {
    first: 'Finding your first step\u2026',
    next: 'Finding your next step\u2026',
    smaller: 'Finding something lighter\u2026',
    alternate: 'Finding a different step\u2026'
  };

  /* ---------- library refs (browser globals or Node requires) ---------- */

  var PromptsLib = (typeof window !== 'undefined' && window.Prompts) ||
                   (typeof require !== 'undefined' ? require('./prompts.js') : null);
  var DemoLib = (typeof window !== 'undefined' && window.DemoEngine) ||
                (typeof require !== 'undefined' ? require('./demo-engine.js') : null);

  /* ---------- error factory ---------- */

  function mkErr(kind, msg) {
    var e = new Error(msg || kind);
    e.kind = kind; // 'network' | 'nokey' | 'timeout' | 'api'
    return e;
  }

  /* ---------- state ---------- */

  function createState() {
    return {
      v: 1,
      goal: '',
      currentStep: null,   // the ONE step in play (never a list)
      history: [],        // completed steps, capped, used for model context
      doneCount: 0,
      shrinkLevel: 0,
      lastRejected: '',
      mode: 'live',       // volatile: re-probed each session
      onBreak: false,
      demo: null,         // demo engine counters
      fallbackStreak: 0
    };
  }

  function getStore() {
    try {
      return (typeof localStorage !== 'undefined') ? localStorage : null;
    } catch (e) { return null; }
  }

  function saveState(state) {
    var s = getStore();
    if (!s) return false;
    try {
      s.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (e) { return false; }
  }

  function loadState() {
    var s = getStore();
    if (!s) return null;
    try {
      var raw = s.getItem(STORAGE_KEY);
      if (!raw) return null;
      var st = JSON.parse(raw);
      if (!st || st.v !== 1 || typeof st.goal !== 'string') return null;
      if (!Array.isArray(st.history)) st.history = [];
      st.history = st.history
        .filter(function (h) { return typeof h === 'string'; })
        .slice(-MAX_HISTORY);
      if (typeof st.doneCount !== 'number') st.doneCount = 0;
      st.mode = 'live'; // never persist demo mode; re-probe each session
      st.onBreak = !!st.onBreak;
      return st;
    } catch (e) { return null; }
  }

  function clearState() {
    var s = getStore();
    if (!s) return;
    try { s.removeItem(STORAGE_KEY); } catch (e) { /* nothing to do */ }
  }

  /* ---------- display prefs (bigger text / easier reading) ---------- */

  function loadPrefs() {
    var s = getStore();
    if (!s) return {};
    try {
      var raw = s.getItem(PREFS_KEY);
      var p = raw ? JSON.parse(raw) : {};
      return (p && typeof p === 'object') ? p : {};
    } catch (e) { return {}; }
  }

  function savePrefs(p) {
    var s = getStore();
    if (!s) return;
    try { s.setItem(PREFS_KEY, JSON.stringify(p)); } catch (e) { /* optional */ }
  }

  /* ---------- LLM client (proxy at /api/step) ---------- */

  function endpoint() {
    if (typeof window !== 'undefined' && window.ONE_STEP_AHEAD_API) return window.ONE_STEP_AHEAD_API;
    return '/api/step';
  }

  async function apiStep(payload, opts) {
    opts = opts || {};
    var fetchImpl = opts.fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!fetchImpl) throw mkErr('network', 'fetch unavailable');
    var ep = opts.endpoint || endpoint();
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timedOut = false;
    var timer = ctrl ? setTimeout(function () { timedOut = true; ctrl.abort(); }, opts.timeoutMs || STEP_TIMEOUT_MS) : null;
    try {
      var res = await fetchImpl(ep, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl ? ctrl.signal : undefined
      });
      // 404/405/501 = this server can't handle /api/step at all
      // (e.g. python -m http.server) -> treat as "no proxy", fall to demo.
      if (res.status === 404 || res.status === 405 || res.status === 501) throw mkErr('network', 'no proxy at this address');
      var txt = await res.text();
      if (!res.ok) {
        var msg = '';
        try {
          var j = JSON.parse(txt);
          msg = (j && ((j.error && (j.error.message || j.error)) || j.error)) || '';
        } catch (e) { /* non-JSON error body */ }
        if (typeof msg !== 'string') msg = '';
        if (res.status === 502 && /key/i.test(msg)) throw mkErr('nokey', msg || 'no API key on server');
        throw mkErr('api', msg || ('HTTP ' + res.status));
      }
      var ct = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
      if (ct.indexOf('json') === -1) throw mkErr('network', 'non-JSON response');
      try { return JSON.parse(txt); }
      catch (e) { throw mkErr('api', 'proxy sent invalid JSON'); }
    } catch (e) {
      // Our own deadline fired: classify as timeout no matter what error
      // shape the browser produced (cross-origin aborts surface as plain
      // TypeErrors, which would otherwise look like a network failure).
      if (timedOut) throw mkErr('timeout', 'request timed out');
      if (e && e.kind) throw e;
      if (e && (e.name === 'AbortError' || e.name === 'TimeoutError')) throw mkErr('timeout', 'request timed out');
      throw mkErr('network', String((e && e.message) || e));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /* ---------- model reply -> step object ---------- */

  function extractAnthropicText(data) {
    if (!data) return '';
    if (data.error) return '';
    if (Array.isArray(data.content)) {
      return data.content
        .filter(function (b) { return b && b.type === 'text' && typeof b.text === 'string'; })
        .map(function (b) { return b.text; })
        .join('\n');
    }
    return '';
  }

  // Parse a raw model reply into a validated step object.
  // Tolerates accidental code fences or surrounding prose.
  function parseStepResponse(rawText, opts) {
    var relaxVerbs = !!(opts && opts.relaxVerbs);
    var t = String(rawText == null ? '' : rawText).trim();
    if (!t) return { ok: false, error: 'empty reply' };
    var fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) t = fence[1].trim();
    var s = t.indexOf('{');
    var e2 = t.lastIndexOf('}');
    if (s === -1 || e2 === -1 || e2 <= s) return { ok: false, error: 'no JSON object found' };
    var obj;
    try { obj = JSON.parse(t.slice(s, e2 + 1)); }
    catch (ex) { return { ok: false, error: 'JSON did not parse' }; }
    var v = PromptsLib.validateStep(obj, { relaxVerbs: relaxVerbs });
    return v.ok ? { ok: true, step: obj } : { ok: false, error: v.error };
  }

  /* ---------- one full LLM exchange: initial + up to 2 corrective
     retries, per the robustness contract. Injected api for tests. ---------- */

  async function llmExchange(kind, st, opts) {
    opts = opts || {};
    var api = opts.api || apiStep;
    var relaxVerbs = NON_LATIN.test(String(st.goal || ''));
    var messages = PromptsLib.buildMessages(kind, st);
    for (var attempt = 0; attempt < 3; attempt++) {
      var data;
      try {
        data = await api({
          system: PromptsLib.SYSTEM_PROMPT,
          messages: JSON.parse(JSON.stringify(messages)),
          max_tokens: 400
        });
      } catch (e) {
        return { ok: false, reason: (e && e.kind) || 'network', error: (e && e.message) || '', attempts: attempt + 1 };
      }
      var text = extractAnthropicText(data);
      var parsed = parseStepResponse(text, { relaxVerbs: relaxVerbs });
      if (parsed.ok) return { ok: true, step: parsed.step, attempts: attempt + 1 };
      if (attempt < 2) {
        messages.push({ role: 'assistant', content: String(text).slice(0, 400) });
        messages.push({ role: 'user', content: PromptsLib.corrective(parsed.error) });
      }
    }
    return { ok: false, reason: 'invalid', error: 'output failed validation after retries', attempts: 3 };
  }

  /* ============================================================
     Browser app (DOM). Everything below runs only in a page.
     ============================================================ */

  var state = createState();
  var busy = false;
  var currentScreen = 'start';
  var pendingKind = 'first';
  var restartArmed = null;
  var prefs = {};

  var els = {};

  function el(id) { return document.getElementById(id); }

  function show(name) {
    ['start', 'loading', 'step', 'break', 'complete', 'error'].forEach(function (k) {
      els[k].hidden = (k !== name);
    });
    currentScreen = name;
  }

  function focusEl(node) {
    try { if (node && node.focus) node.focus(); } catch (e) { /* non-fatal */ }
  }

  function renderModeBadge() {
    els.modeBadge.hidden = (state.mode !== 'demo');
  }

  function humanSeconds(sec) {
    var s = Math.round(Number(sec) || 5);
    if (s < 1) s = 1;
    if (s > 120) s = 120;
    if (s <= 5) return 'a few seconds';
    if (s < 60) return 'about ' + s + ' seconds';
    if (s === 60) return 'about a minute';
    if (s < 120) return 'about a minute and a half';
    return 'about two minutes';
  }

  /* ---------- rendering the current step (the only one) ---------- */

  function renderStep(kind) {
    var step = state.currentStep;
    if (!step) return;
    if (step.is_goal_complete) { showComplete(step); return; }

    els.stepText.textContent = step.step;
    els.stepTime.textContent = 'Takes ' + humanSeconds(step.estimated_seconds) + '.';

    // Gentle momentum feedback: acknowledgment after a completed step.
    if (kind === 'next') {
      var ack = (step.encouragement && step.encouragement.trim()) || ACKS[state.doneCount % ACKS.length];
      els.ack.textContent = ack;
      els.ack.hidden = false;
    } else if (kind !== 'resume') {
      els.ack.hidden = true;
    }

    if (state.doneCount > 0) {
      els.tally.textContent = state.doneCount + (state.doneCount === 1 ? ' step so far' : ' steps so far');
      els.tally.hidden = false;
    }

    renderModeBadge();
    show('step');
    els.liveRegion.textContent = step.step; // polite announcement for screen readers
    focusEl(els.stepText);
  }

  function applyStep(step, kind) {
    state.currentStep = step;
    if (kind === 'first') state.shrinkLevel = 0;
    if (kind === 'next') state.shrinkLevel = 0;
    if (kind === 'smaller') state.shrinkLevel += 1;
    // 'alternate' keeps the current shrink level (same size).
    saveState(state);
    renderStep(kind);
  }

  function applyDemoStep(kind) {
    var step = DemoLib.getStep(kind, state);
    applyStep(step, kind);
  }

  function showLoading(kind) {
    els.loadingMsg.textContent = LOADING_MSG[kind] || LOADING_MSG.next;
    show('loading');
  }

  function showError(kind) {
    pendingKind = kind || pendingKind;
    renderModeBadge();
    show('error');
    focusEl(els.retry);
  }

  function showComplete(step) {
    var goalName = state.goal.trim() || 'the thing you were avoiding';
    var n = state.doneCount;
    els.completeSummary.textContent =
      'You finished "' + goalName + '". ' + n + (n === 1 ? ' step' : ' steps') + ', one at a time.';
    els.demoCompleteNote.hidden = (state.mode !== 'demo');
    renderModeBadge();
    show('complete');
    els.liveRegion.textContent = 'You did it.';
    focusEl(els.completeHeading);
    if (step && step.encouragement) els.liveRegion.textContent = 'You did it. ' + step.encouragement;
    clearState(); // completion is terminal; a refresh starts fresh
  }

  /* ---------- obtaining the next single step ---------- */

  async function obtainStep(kind) {
    if (state.mode === 'demo') { applyDemoStep(kind); return; }

    showLoading(kind);
    var res = await llmExchange(kind, state);

    if (res.ok) {
      state.fallbackStreak = 0;
      applyStep(res.step, kind);
      return;
    }
    if (res.reason === 'network' || res.reason === 'nokey') {
      // No proxy / no key / network gone: demo mode takes over, gently.
      state.mode = 'demo';
      applyDemoStep(kind);
      return;
    }
    if (res.reason === 'invalid') {
      // Model output failed validation after 2 corrective retries:
      // serve a built-in safe step instead.
      state.fallbackStreak += 1;
      if (state.fallbackStreak >= 3) state.mode = 'demo';
      applyDemoStep(kind);
      return;
    }
    showError(kind); // timeout / api error -> friendly retry screen
  }

  /* ---------- user actions ---------- */

  function onStart(e) {
    e.preventDefault();
    if (busy) return;
    busy = true;
    var raw = els.goalInput.value.trim().slice(0, 2000);
    state = createState();
    state.goal = raw; // empty is fine: the app still returns one step
    if (location.protocol === 'file:') state.mode = 'demo'; // no fetch possible
    saveState(state);
    obtainStep('first').then(function () { busy = false; });
  }

  function onDone() {
    if (busy || !state.currentStep) return;
    busy = true;
    var finished = state.currentStep.step;
    state.history.push(finished);
    if (state.history.length > MAX_HISTORY) state.history.shift();
    state.doneCount += 1;
    state.lastRejected = '';
    saveState(state);
    obtainStep('next').then(function () { busy = false; });
  }

  function onTooHeavy() {
    if (busy || !state.currentStep) return;
    busy = true;
    state.lastRejected = state.currentStep.step;
    saveState(state);
    obtainStep('smaller').then(function () { busy = false; });
  }

  function onAlternate() {
    if (busy || !state.currentStep) return;
    busy = true;
    obtainStep('alternate').then(function () { busy = false; });
  }

  function onBreak() {
    state.onBreak = true;
    saveState(state);
    show('break');
    focusEl(els.resume);
  }

  function onResume() {
    state.onBreak = false;
    saveState(state);
    renderStep('resume');
  }

  /* "Start over" is a two-press action: no modal, no shame, just a
     3-second window so a stray tap can't wipe a session. */
  function disarmRestart() {
    if (restartArmed) {
      clearTimeout(restartArmed.timer);
      restartArmed.node.textContent = restartArmed.node.dataset.origLabel;
      restartArmed = null;
    }
  }

  function armRestart(btn) {
    if (restartArmed && restartArmed.node === btn) {
      doRestart();
      return;
    }
    disarmRestart();
    restartArmed = { node: btn, timer: null };
    btn.dataset.origLabel = btn.textContent;
    btn.textContent = 'Tap again to start fresh';
    restartArmed.timer = setTimeout(disarmRestart, 3000);
  }

  function doRestart() {
    disarmRestart();
    state = createState();
    clearState();
    els.goalInput.value = '';
    els.ack.hidden = true;
    els.tally.hidden = true;
    show('start');
    focusEl(els.goalInput);
  }

  function onRetry() {
    if (busy) return;
    busy = true;
    obtainStep(pendingKind).then(function () { busy = false; });
  }

  function onFallback() {
    state.mode = 'demo';
    applyDemoStep(pendingKind);
  }

  /* ---------- display prefs ---------- */

  function applyPrefs() {
    document.body.classList.toggle('text-large', !!prefs.big);
    document.body.classList.toggle('reading-mode', !!prefs.dys);
    if (els.textSizeToggle) els.textSizeToggle.setAttribute('aria-pressed', String(!!prefs.big));
    if (els.fontToggle) els.fontToggle.setAttribute('aria-pressed', String(!!prefs.dys));
  }

  /* ---------- init ---------- */

  function init() {
    els = {
      start: el('screen-start'),
      loading: el('screen-loading'),
      step: el('screen-step'),
      break: el('screen-break'),
      complete: el('screen-complete'),
      error: el('screen-error'),
      modeBadge: el('modeBadge'),
      goalInput: el('goalInput'),
      startForm: el('startForm'),
      loadingMsg: el('loadingMsg'),
      stepText: el('stepText'),
      stepTime: el('stepTime'),
      ack: el('ackLine'),
      tally: el('tally'),
      liveRegion: el('liveRegion'),
      done: el('doneBtn'),
      tooHeavy: el('tooHeavyBtn'),
      alt: el('altBtn'),
      breakBtn: el('breakBtn'),
      resume: el('resumeBtn'),
      restart: el('restartBtn'),
      restartFromBreak: el('restartFromBreakBtn'),
      retry: el('retryBtn'),
      fallback: el('fallbackBtn'),
      newGoal: el('newGoalBtn'),
      completeSummary: el('completeSummary'),
      demoCompleteNote: el('demoCompleteNote'),
      completeHeading: el('completeHeading'),
      textSizeToggle: el('textSizeToggle'),
      fontToggle: el('fontToggle')
    };

    els.startForm.addEventListener('submit', onStart);
    els.done.addEventListener('click', onDone);
    els.tooHeavy.addEventListener('click', onTooHeavy);
    els.alt.addEventListener('click', onAlternate);
    els.breakBtn.addEventListener('click', onBreak);
    els.resume.addEventListener('click', onResume);
    els.restart.addEventListener('click', function () { armRestart(els.restart); });
    els.restartFromBreak.addEventListener('click', function () { armRestart(els.restartFromBreak); });
    els.retry.addEventListener('click', onRetry);
    els.fallback.addEventListener('click', onFallback);
    els.newGoal.addEventListener('click', doRestart);

    els.textSizeToggle.addEventListener('click', function () {
      prefs.big = !prefs.big; savePrefs(prefs); applyPrefs();
    });
    els.fontToggle.addEventListener('click', function () {
      prefs.dys = !prefs.dys; savePrefs(prefs); applyPrefs();
    });

    // Enter anywhere quiet on the step screen counts as "Done".
    document.addEventListener('keydown', function (e) {
      if (currentScreen !== 'step' || e.key !== 'Enter') return;
      var t = e.target;
      var onButton = t && t.closest && (t.closest('button') || t.closest('a'));
      var onInput = t && t.closest && t.closest('input');
      if (!onButton && !onInput) { e.preventDefault(); onDone(); }
    });

    prefs = loadPrefs();
    applyPrefs();

    state = loadState() || createState();
    if (location.protocol === 'file:') state.mode = 'demo';

    if (state.currentStep) {
      if (state.onBreak) { renderModeBadge(); show('break'); focusEl(els.resume); }
      else renderStep('resume');
    } else {
      renderModeBadge();
      show('start');
      focusEl(els.goalInput);
    }
  }

  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  /* ---------- exports for test.js (Node) ---------- */

  return {
    mkErr: mkErr,
    createState: createState,
    saveState: saveState,
    loadState: loadState,
    clearState: clearState,
    loadPrefs: loadPrefs,
    savePrefs: savePrefs,
    parseStepResponse: parseStepResponse,
    apiStep: apiStep,
    llmExchange: llmExchange,
    STORAGE_KEY: STORAGE_KEY,
    MAX_HISTORY: MAX_HISTORY
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = OneStepAhead;
}
