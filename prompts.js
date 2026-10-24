/* ============================================================
   One Step Ahead — prompts.js
   The LLM behavior contract. Everything the coach model does
   lives here so it can be tuned in one place.
   Loaded as a plain <script> in the browser; require()-able in Node.
   ============================================================ */

var Prompts = (function () {
  'use strict';

  /* ----------------------------------------------------------
     SYSTEM_PROMPT — persona, the one-step rule, the size rule,
     forbidden behaviors, JSON-only output, few-shot examples.
     ---------------------------------------------------------- */
  var SYSTEM_PROMPT = [
    'You are the step engine for "One Step Ahead" - a tool for people whose brain freezes when a task feels too big (executive dysfunction, ADHD).',
    '',
    'PERSONA: a calm coach. Warm, brief, concrete. Never bossy, never saccharine, never pressuring, never shaming.',
    '',
    'THE ONE-STEP RULE (the core promise of this product):',
    '- Reply with exactly ONE micro-action. Never reveal, hint at, or list future steps. Never show a plan or a step count.',
    '- The step must be doable in under two minutes, with near-zero decisions and zero planning by the person.',
    '- The step must be physical or digital and concrete - something a body or a device does, observable from outside.',
    '',
    'THE SIZE RULE:',
    '- If the person would have to decide anything or plan anything, the step is too big. Cut it down.',
    '',
    'SHRINKING (used when the person said a step was "too heavy"):',
    '- Every smaller step must be strictly easier than the rejected one. Never repeat a rejected step.',
    '- Shrink level 1: remove any creating or typing - just open, find, or look.',
    '- Shrink level 2: body-only setup - sit down, bring the thing within reach.',
    '- Shrink level 3 and beyond: pure physical or sensory actions - put a hand on the trackpad, take one breath.',
    '',
    'FORBIDDEN:',
    '- Revealing future steps, step counts, totals, or plans.',
    '- Multi-part steps, sequences, "and then", numbered or bulleted lists.',
    '- Vague verbs: "plan", "research", "figure out", "work on", "think about", "organize", "prepare", "review" (as a whole task).',
    '- Pressure, guilt, or hype language: "you should", "come on", "just do it", "easy!".',
    '- Emojis.',
    '',
    'OUTPUT FORMAT - reply with JSON only. No markdown, no code fences, no words before or after the JSON. Exactly this shape:',
    '{"step":"...","estimated_seconds":30,"is_goal_complete":false,"encouragement":""}',
    '- step: one sentence, 20 words or fewer, starts with a verb, one single action.',
    '- estimated_seconds: a number from 1 to 120.',
    '- is_goal_complete: true only when the done-steps show the goal is genuinely finished; then make "step" a tiny closing action, e.g. "Close the tab and stretch."',
    '- encouragement: 12 words or fewer, warm, optional - an empty string is fine.',
    '- Write the step in the same language the person used for their goal.',
    '',
    'EXAMPLES - each goal, followed by your ENTIRE reply:',
    'Writing task, goal "Write research paper" ->',
    '{"step":"Open a blank document and title it \'Paper Draft\'.","estimated_seconds":30,"is_goal_complete":false,"encouragement":"That\'s started."}',
    'Coding task, goal "Fix bug in auth service" ->',
    '{"step":"Open the file where the failing auth check lives.","estimated_seconds":45,"is_goal_complete":false,"encouragement":""}',
    'Household task, goal "Clean the kitchen" ->',
    '{"step":"Put one dirty dish in the sink.","estimated_seconds":20,"is_goal_complete":false,"encouragement":"Counted."}',
    'Emotional-admin task, goal "Reply to the email I\'ve been avoiding" ->',
    '{"step":"Open the email and read it once.","estimated_seconds":60,"is_goal_complete":false,"encouragement":"Just looking counts."}',
    'Completion (history shows the reply was sent) ->',
    '{"step":"Close the email tab.","estimated_seconds":10,"is_goal_complete":true,"encouragement":"It\'s done."}'
  ].join('\n');

  /* ----------------------------------------------------------
     Message templates. {placeholders} are filled by buildMessages().
     ---------------------------------------------------------- */

  // Inputs: goal, history of completed steps, last step shown.
  var NEXT_STEP_TEMPLATE = [
    'GOAL: {goal}',
    '',
    'STEPS ALREADY DONE (most recent last):',
    '{history}',
    '',
    'LAST STEP SHOWN: {last_step}',
    '',
    'Reply with the next single micro-step, as JSON only.'
  ].join('\n');

  // Inputs: goal, the step that was too heavy, how many times it has
  // already been shrunk. Output must be strictly smaller.
  var SMALLER_STEP_TEMPLATE = [
    'GOAL: {goal}',
    '',
    'THE PERSON SAID THIS STEP WAS TOO HEAVY:',
    '"{rejected_step}"',
    '',
    'TIMES IT HAS ALREADY BEEN SHRUNK: {shrink_level}',
    '',
    'Reply with ONE step that is strictly easier and smaller than the rejected one, as JSON only.',
    'Shrink guidance - level 1: just open, find, or look (no typing, no creating). Level 2: body-only setup (sit down, bring it within reach). Level 3 or higher: pure physical or sensory (put a hand on the trackpad, take one breath).',
    'Never repeat the rejected step.'
  ].join('\n');

  // Inputs: goal, current step that did not fit, recent history.
  // Output: a different step at the same size.
  var ALTERNATE_STEP_TEMPLATE = [
    'GOAL: {goal}',
    '',
    'THIS STEP DID NOT FIT THE PERSON\'S SITUATION:',
    '"{current_step}"',
    '',
    'STEPS ALREADY DONE (most recent last):',
    '{history}',
    '',
    'Reply with ONE different micro-step of the same small size - not bigger, not smaller - as JSON only.'
  ].join('\n');

  // Sent after an invalid model reply, to correct it.
  var CORRECTIVE_TEMPLATE = [
    'Your last reply was not valid: {error}.',
    'Reply again with ONLY one JSON object and no other text:',
    '{"step":"one sentence, 20 words max, starts with a verb, one action","estimated_seconds":30,"is_goal_complete":false,"encouragement":"12 words max"}'
  ].join('\n');

  /* ----------------------------------------------------------
     Helpers
     ---------------------------------------------------------- */

  function fill(tpl, map) {
    return tpl.replace(/\{(\w+)\}/g, function (m, k) {
      return map[k] != null ? String(map[k]) : m;
    });
  }

  function goalFor(st) {
    var g = String((st && st.goal) || '').trim();
    if (!g) g = 'the thing I am avoiding';
    return g.slice(0, 280); // keep prompts compact for latency + tokens
  }

  function historyBlock(st) {
    var h = ((st && st.history) || []).slice(-8);
    if (!h.length) return '(none yet)';
    return h.map(function (s, i) { return (i + 1) + '. ' + s; }).join('\n');
  }

  // Build the messages array for one request. kind: 'first' | 'next' | 'smaller' | 'alternate'
  function buildMessages(kind, st) {
    var goal = goalFor(st);
    if (kind === 'smaller') {
      var rejected = (st && st.lastRejected) || ((st && st.currentStep) && st.currentStep.step) || '';
      return [{ role: 'user', content: fill(SMALLER_STEP_TEMPLATE, {
        goal: goal,
        rejected_step: rejected,
        shrink_level: ((st && st.shrinkLevel) || 0) + 1
      }) }];
    }
    if (kind === 'alternate') {
      var cur = ((st && st.currentStep) && st.currentStep.step) || '';
      return [{ role: 'user', content: fill(ALTERNATE_STEP_TEMPLATE, {
        goal: goal,
        current_step: cur,
        history: historyBlock(st)
      }) }];
    }
    var last = (st && st.currentStep) ? st.currentStep.step : '(none yet - this is the very first step)';
    return [{ role: 'user', content: fill(NEXT_STEP_TEMPLATE, {
      goal: goal,
      history: historyBlock(st),
      last_step: last
    }) }];
  }

  /* ----------------------------------------------------------
     Output validation. A step object is valid only if:
     - step: non-empty string, <= 20 words, starts with a verb,
       single action (no "and then", no lists, no line breaks,
       no future-step references)
     - estimated_seconds: number 1..120
     - is_goal_complete: boolean
     - encouragement: string <= 12 words, optional
     ---------------------------------------------------------- */

  var VERBS = {
    accept: 1, add: 1, adjust: 1, allow: 1, answer: 1, apologize: 1, ask: 1,
    begin: 1, blink: 1, book: 1, boot: 1, breathe: 1, brighten: 1, bring: 1,
    brush: 1, buy: 1, call: 1, cancel: 1, carry: 1, change: 1, charge: 1,
    check: 1, chew: 1, choose: 1, circle: 1, clean: 1, click: 1, close: 1,
    collect: 1, comb: 1, come: 1, comment: 1, compare: 1, complete: 1,
    confirm: 1, connect: 1, continue: 1, cook: 1, cool: 1, copy: 1, count: 1,
    cross: 1, cut: 1, delete: 1, describe: 1, dial: 1, dim: 1, do: 1, download: 1,
    draft: 1, draw: 1, drink: 1, drop: 1, duplicate: 1, edit: 1, email: 1,
    enter: 1, erase: 1, exhale: 1, explore: 1, feed: 1, feel: 1, file: 1,
    fill: 1, find: 1, fix: 1, flag: 1, focus: 1, fold: 1, follow: 1, format: 1,
    forward: 1, gather: 1, give: 1, glance: 1, go: 1, grab: 1, greet: 1,
    group: 1, hand: 1, hang: 1, help: 1, highlight: 1, hit: 1, hold: 1,
    imagine: 1, inhale: 1, jot: 1, keep: 1, kick: 1, lay: 1, lean: 1, let: 1,
    lift: 1, list: 1, listen: 1, load: 1, locate: 1, lock: 1, look: 1, loosen: 1,
    mail: 1, make: 1, mark: 1, message: 1, mix: 1, move: 1, mute: 1, name: 1,
    nod: 1, note: 1, notice: 1, open: 1, order: 1, pack: 1, paste: 1, pay: 1,
    photograph: 1, pick: 1, picture: 1, pin: 1, place: 1, plan2: 0, plug: 1,
    point: 1, pour: 1, power: 1, practice: 1, press: 1, print: 1, pull: 1,
    put: 1, question: 1, read: 1, recall: 1, record: 1, relax: 1, remember: 1,
    remove: 1, rename: 1, reply: 1, rest: 1, reread: 1, rinse: 1, roll: 1,
    run: 1, sample: 1, save: 1, say: 1, scan: 1, screenshot: 1, scroll: 1,
    seal: 1, search: 1, see: 1, send: 1, set: 1, shake: 1, share: 1, ship: 1,
    show: 1, shrink: 1, sign: 1, silence: 1, sip: 1, sit: 1, sketch: 1,
    skim: 1, slide: 1, smell: 1, smile: 1, soften: 1, sort: 1, spend: 1,
    spray: 1, squeeze: 1, stack: 1, stand: 1, star: 1, start: 1, stick: 1,
    stir: 1, stop: 1, stretch: 1, swipe: 1, switch: 1, take: 1, talk: 1,
    tape: 1, tear: 1, tell: 1, test: 1, thank: 1, think2: 0, tidy: 1, tilt: 1,
    time: 1, touch: 1, track: 1, try: 1, turn: 1, type: 1, unclench: 1,
    underline: 1, unlock: 1, unload: 1, update: 1, upload: 1, use: 1, verify: 1,
    wait: 1, walk: 1, warm: 1, wash: 1, water: 1, watch: 1, wear: 1, wipe: 1,
    wrap: 1, write: 1
  };
  delete VERBS.plan2; delete VERBS.think2; // (kept structure tidy above)

  function wordList(s) {
    return String(s || '').trim().split(/\s+/).filter(Boolean);
  }

  // opts.relaxVerbs: skip the verb-start check (used when the goal itself
  // is in a non-Latin script, so we cannot judge its verbs mechanically).
  function validateStep(o, opts) {
    opts = opts || {};
    var errors = [];
    if (!o || typeof o !== 'object') return { ok: false, error: 'not an object' };

    if (typeof o.step !== 'string') {
      errors.push('step must be a string');
    } else {
      var s = o.step.trim();
      var words = wordList(s);
      if (!s) errors.push('step is empty');
      if (words.length > 20) errors.push('step is longer than 20 words');
      if (/\n/.test(s)) errors.push('step must be one sentence (no line breaks)');
      if (/and\s+then/i.test(s)) errors.push('step must not contain "and then"');
      if (/\bfirst[,,]?\s+then\b/i.test(s) || /\bafter that\b/i.test(s)) errors.push('step must be a single action');
      if (/(^|\n)\s*\d+[.)]\s/.test(s) || /\s\d+[.)]\s/.test(s)) errors.push('step must not contain a numbered list');
      if (/^\s*[-*•]\s/.test(s)) errors.push('step must not contain a bullet list');
      if (/\bstep\s*\d+/i.test(s) || /\bnext step\b/i.test(s)) errors.push('step must not mention future steps');
      if (!opts.relaxVerbs && words.length) {
        var first = words[0].toLowerCase().replace(/[^a-z]/g, '');
        if (first && !VERBS[first]) errors.push('step must start with a verb (starts with "' + first + '")');
      }
    }

    if (typeof o.estimated_seconds !== 'number' || !isFinite(o.estimated_seconds)) {
      errors.push('estimated_seconds must be a number');
    } else if (o.estimated_seconds < 1 || o.estimated_seconds > 120) {
      errors.push('estimated_seconds must be between 1 and 120');
    }

    if (typeof o.is_goal_complete !== 'boolean') {
      errors.push('is_goal_complete must be a boolean');
    }

    if (o.encouragement != null) {
      if (typeof o.encouragement !== 'string') {
        errors.push('encouragement must be a string');
      } else if (wordList(o.encouragement).length > 12) {
        errors.push('encouragement must be 12 words or fewer');
      }
    }

    return errors.length ? { ok: false, error: errors.join('; ') } : { ok: true };
  }

  function corrective(error) {
    return fill(CORRECTIVE_TEMPLATE, { error: error || 'it did not match the schema' });
  }

  return {
    SYSTEM_PROMPT: SYSTEM_PROMPT,
    NEXT_STEP_TEMPLATE: NEXT_STEP_TEMPLATE,
    SMALLER_STEP_TEMPLATE: SMALLER_STEP_TEMPLATE,
    ALTERNATE_STEP_TEMPLATE: ALTERNATE_STEP_TEMPLATE,
    CORRECTIVE_TEMPLATE: CORRECTIVE_TEMPLATE,
    buildMessages: buildMessages,
    validateStep: validateStep,
    corrective: corrective,
    VERBS: VERBS
  };
})();

/* Node (tests) support */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Prompts;
}
