/* ============================================================
   One Step Ahead — demo-engine.js
   Offline fallback engine: deterministic, hand-written micro-steps.
   Works with no network and no API key ("Demo mode").
   Contract: serves exactly ONE step per call. Never a list,
   never a future step, never a step count.
   ============================================================ */

var DemoEngine = (function () {
  'use strict';

  /* ---- Sample goal 1: writing (paper / essay / thesis) ---- */
  var PAPER = {
    steps: [
      { s: 'Open a blank document and title it "Paper Draft".', sec: 30, enc: "That's started." },
      { s: 'Type one sentence about what the paper is about.', sec: 45, enc: 'Rough counts.' },
      { s: 'Add one source you already have in mind.', sec: 30, enc: "That's a real piece." },
      { s: 'Write a rough headline for the intro paragraph.', sec: 40, enc: 'Placeholders are allowed.' },
      { s: 'Save the file with today\u2019s date.', sec: 15, enc: 'Progress is saved.' },
      { s: 'Read the sentence you wrote out loud.', sec: 20, enc: 'Hearing it helps.' },
      { s: 'Add one more sentence anywhere it fits.', sec: 45, enc: "It's growing." },
      { s: 'Mark the line where you stopped.', sec: 10, enc: "Stopping points are gold." }
    ],
    alts: [
      { s: 'Open your notes app and create a page titled "Paper Draft".', sec: 30, enc: "That's started." },
      { s: 'Write one messy sentence about your topic.', sec: 40, enc: 'Messy is fine.' },
      { s: 'Jot one author\u2019s name you already know.', sec: 20, enc: "That's a real piece." },
      { s: 'Type the intro\u2019s first sentence without editing it.', sec: 45, enc: 'First drafts are allowed.' },
      { s: 'Duplicate the file as a safety copy.', sec: 15, enc: 'Progress is saved.' },
      { s: 'Skim the page once from top to bottom.', sec: 20, enc: 'One look is plenty.' },
      { s: 'Paste one quote you saved earlier.', sec: 30, enc: "It's growing." },
      { s: 'Write where you left off on a sticky note.', sec: 20, enc: "Stopping points are gold." }
    ]
  };

  /* ---- Sample goal 2: coding ("Fix bug in auth service") ---- */
  var BUG = {
    steps: [
      { s: 'Open the file where the bug shows up.', sec: 30, enc: "That's the door open." },
      { s: 'Find the exact line the error names.', sec: 30, enc: "One line. That's all." },
      { s: 'Read that line out loud, slowly.', sec: 20, enc: 'Slowness is allowed.' },
      { s: 'Write one sentence describing what should happen instead.', sec: 60, enc: 'Clarity unlocked.' },
      { s: 'Make one small change toward the fix.', sec: 90, enc: 'Small counts.' },
      { s: 'Run the code once.', sec: 30, enc: 'Evidence beats guessing.' },
      { s: 'Mark the bug fixed in your notes.', sec: 15, enc: 'Hunted down.' }
    ],
    alts: [
      { s: 'Open the error log the message mentions.', sec: 30, enc: "That's the door open." },
      { s: 'Search the codebase for the error\u2019s text.', sec: 45, enc: "One line. That's all." },
      { s: 'Copy the line number onto a sticky note.', sec: 15, enc: 'Slowness is allowed.' },
      { s: 'Type the expected result as a comment above the line.', sec: 60, enc: 'Clarity unlocked.' },
      { s: 'Rename one confusing variable on that line.', sec: 60, enc: 'Small counts.' },
      { s: 'Run the failing test by itself.', sec: 30, enc: 'Evidence beats guessing.' },
      { s: 'Write one line about how you fixed it.', sec: 20, enc: 'Hunted down.' }
    ]
  };

  /* ---- Sample goal 3: emotional admin (the avoided email) ---- */
  var EMAIL = {
    steps: [
      { s: 'Open the email you\u2019ve been avoiding.', sec: 30, enc: 'Looking is the work.' },
      { s: 'Read it once, without replying.', sec: 60, enc: 'Just reading counts.' },
      { s: 'Jot one sentence you might reply with.', sec: 45, enc: 'Drafting in the margins.' },
      { s: 'Start a reply and paste that sentence.', sec: 60, enc: "It's becoming real." },
      { s: 'Read your reply once.', sec: 30, enc: 'One more look.' },
      { s: 'Press send.', sec: 10, enc: 'Sent is better than perfect.' }
    ],
    alts: [
      { s: 'Open your inbox and find that email.', sec: 30, enc: 'Looking is the work.' },
      { s: 'Skim it for what it\u2019s actually asking.', sec: 60, enc: 'Just reading counts.' },
      { s: 'Write the reply\u2019s first two words.', sec: 20, enc: 'Drafting in the margins.' },
      { s: 'Type the greeting line of your reply.', sec: 30, enc: "It's becoming real." },
      { s: 'Read it out loud to check the tone.', sec: 30, enc: 'One more look.' },
      { s: 'Send it as-is.', sec: 10, enc: 'Sent is better than perfect.' }
    ]
  };

  /* ---- Generic fallback ladder for any other goal ---- */
  var GENERIC = {
    steps: [
      { s: 'Write the task\u2019s name at the top of a blank page.', sec: 30, enc: 'Named things are tamer.' },
      { s: 'Write one sentence about where this task starts.', sec: 45, enc: 'A thread to pull.' },
      { s: 'Put that object within arm\u2019s reach.', sec: 15, enc: 'Staged and ready.' },
      { s: 'Look at it for ten seconds.', sec: 15, enc: 'Just noticing.' },
      { s: 'Start the first piece, however small it feels.', sec: 90, enc: 'Small is the point.' },
      { s: 'Write one line about where you stopped.', sec: 20, enc: 'Stopping points are gold.' }
    ],
    alts: [
      { s: 'Say the task out loud in one sentence.', sec: 15, enc: 'Named things are tamer.' },
      { s: 'Name the first object this task involves.', sec: 20, enc: 'A thread to pull.' },
      { s: 'Clear one square foot of surface to work on.', sec: 60, enc: 'Room to breathe.' },
      { s: 'Hold it in your hands for a moment.', sec: 15, enc: 'Just noticing.' },
      { s: 'Try the first piece for two minutes.', sec: 120, enc: 'Small is the point.' },
      { s: 'Mark the spot you\u2019ll return to.', sec: 15, enc: 'Stopping points are gold.' }
    ]
  };

  /* ---- The universal shrink ladder.
         Each level is strictly lighter than the one before.
         Level 3+ (index 2+) are pure physical or sensory actions. ---- */
  var SHRINK = [
    { s: 'Open the app or file this task lives in.', sec: 15 },
    { s: 'Sit where this usually happens.', sec: 10 },
    { s: 'Put one hand on your mouse or trackpad.', sec: 8 },
    { s: 'Look at your screen without doing anything.', sec: 8 },
    { s: 'Take one slow breath.', sec: 5 },
    { s: 'Breathe out once.', sec: 5 },
    { s: 'Breathe.', sec: 3 }
  ];

  /* Same-size alternatives for shrink steps. */
  var SHRINK_ALT = [
    { s: 'Open the tool you would need, nothing more.', sec: 15 },
    { s: 'Sit with both feet flat on the floor.', sec: 10 },
    { s: 'Rest both hands on the desk.', sec: 8 },
    { s: 'Look at one spot on your screen.', sec: 8 },
    { s: 'Unclench your jaw.', sec: 5 },
    { s: 'Let your shoulders drop.', sec: 5 },
    { s: 'Notice your breathing.', sec: 5 }
  ];

  /* Universal same-size pool (2nd+ press of "This step doesn't fit"). */
  var POOL = [
    { s: 'Write the task name on a sticky note.', sec: 20, enc: 'Named things are tamer.' },
    { s: 'Say your next tiny action out loud.', sec: 10, enc: 'Spoken counts.' },
    { s: 'Move one related object onto your desk.', sec: 15, enc: 'Staged and ready.' },
    { s: 'Open the tool this task needs.', sec: 15, enc: 'The door is open.' }
  ];

  var SHRINK_ENC = [
    'Smaller is allowed.',
    'This still counts.',
    'Tiny is the point.',
    'Good enough, truly.',
    'Even this is a start.',
    'No rush on this one.',
    'Bedrock counts too.'
  ];

  var COMPLETE = { s: 'Notice what you just did.', sec: 10, enc: "It's done.", done: true };

  /* ---- matching ---- */
  function pickKey(goal) {
    var g = String(goal || '');
    if (/e-?mail|inbox|respond|reply|mail|letter|text back/i.test(g)) return 'email';
    if (/paper|essay|research|thesis|dissertation|draft|writ/i.test(g)) return 'paper';
    if (/bug|fix|code|error|crash|auth|api|deploy|build|function|refactor|compile|test/i.test(g)) return 'bug';
    return 'generic';
  }

  function ladderFor(key) {
    if (key === 'paper') return PAPER;
    if (key === 'bug') return BUG;
    if (key === 'email') return EMAIL;
    return GENERIC;
  }

  function wordCount(s) {
    return String(s || '').trim().split(/\s+/).filter(Boolean).length;
  }

  // Where to enter the shrink ladder based on how tiny the rejected step
  // already was, so the replacement is always strictly lighter.
  function entryLevel(rejected) {
    var w = wordCount(rejected);
    if (w <= 4) return 2;
    if (w <= 7) return 1;
    return 0;
  }

  function pack(e, forcedEnc) {
    return {
      step: e.s,
      estimated_seconds: e.sec,
      is_goal_complete: !!e.done,
      encouragement: forcedEnc != null ? forcedEnc : (e.enc || '')
    };
  }

  function currentStepText(st) {
    return (st && st.currentStep && st.currentStep.step) || '';
  }

  function poolNext(st, d) {
    var e = POOL[d.pool % POOL.length];
    var guard = 0;
    while (e.s === currentStepText(st) && guard < POOL.length) {
      d.pool += 1;
      e = POOL[d.pool % POOL.length];
      guard += 1;
    }
    d.pool += 1;
    return pack(e);
  }

  /* ----------------------------------------------------------
     getStep(action, st) -> one step object.
     action: 'first' | 'next' | 'smaller' | 'alternate'
     st: app state {goal, currentStep, demo}. st.demo is this
     engine's own counter bag (persisted with the session).
     ---------------------------------------------------------- */
  function getStep(action, st) {
    if (!st.demo) {
      st.demo = { key: pickKey(st.goal), index: 0, shrinkIdx: null, alt: 0, pool: 0, shrunkAlt: false };
    }
    var d = st.demo;
    var L = ladderFor(d.key);

    if (action === 'first') {
      d.index = 0; d.shrinkIdx = null; d.alt = 0; d.pool = 0; d.shrunkAlt = false;
      return pack(L.steps[0]);
    }

    if (action === 'next') {
      // A completed step (main, shrunk, or alternate) always moves the
      // session forward; a rejected step is never re-served.
      d.shrinkIdx = null; d.alt = 0; d.pool = 0; d.shrunkAlt = false;
      d.index += 1;
      if (d.index >= L.steps.length) return pack(COMPLETE);
      return pack(L.steps[d.index]);
    }

    if (action === 'smaller') {
      var idx = (d.shrinkIdx != null) ? d.shrinkIdx + 1 : entryLevel(currentStepText(st));
      if (idx > SHRINK.length - 1) idx = SHRINK.length - 1; // bedrock: "Breathe."
      d.shrinkIdx = idx;
      d.shrunkAlt = false;
      return pack(SHRINK[idx], SHRINK_ENC[idx % SHRINK_ENC.length]);
    }

    if (action === 'alternate') {
      if (d.shrinkIdx != null) {
        // Same size, different action: swap between the shrink step
        // and its same-size sibling.
        d.shrunkAlt = !d.shrunkAlt;
        var src = d.shrunkAlt ? SHRINK_ALT[d.shrinkIdx] : SHRINK[d.shrinkIdx];
        return pack(src, 'Different, same size.');
      }
      d.alt += 1;
      if (d.alt === 1) {
        var alt = L.alts[d.index] || L.alts[L.alts.length - 1];
        if (alt.s === currentStepText(st)) return poolNext(st, d);
        return pack(alt);
      }
      return poolNext(st, d);
    }

    return pack(GENERIC.steps[0]);
  }

  return {
    getStep: getStep,
    pickKey: pickKey,
    SHRINK: SHRINK,
    COMPLETE: COMPLETE
  };
})();

/* Node (tests) support */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DemoEngine;
}
