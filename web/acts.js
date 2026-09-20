/* Act controllers. They talk only to a data source (live or replay) and never to the network directly. */
(function () {
  'use strict';
  var J = window.JevDemo, V = J.viz, el = V.el, fmt = V.fmt, stats = V.stats, $ = function (id) { return document.getElementById(id); };
  var src, base, cfg, live, headline;
  var store = { race: {}, fanout: {}, gating: {}, limits: {} };
  var FAN = [1, 3, 6, 12], SERIES = [
    { id: 'jev', laneId: 'jev', variant: 'single_call', name: 'Jev, one call', short: 'Jev', css: '--jev' },
    { id: 'one', laneId: null, variant: 'single_call', name: 'OpenAI, one call', short: 'OpenAI, 1 call', css: '--llm' },
    { id: 'par', laneId: null, variant: 'one_call_per_question', name: 'OpenAI, one call per question', short: 'OpenAI, N calls', css: '--llm-alt' }];

  function lane(id) { return cfg.lanes.filter(function (l) { return l.id === id; })[0]; }
  function laneColor(id) { return V.cssVar(id === 'jev' ? '--jev' : '--llm'); }
  function laneLabel(l) { return l.id === 'jev' ? 'Jev' : l.label; }
  function modelLine(l, ex) { return (ex && ex.resolvedModel ? ex.resolvedModel : l.model) + (l.id === 'jev' ? '' : ' · effort ' + (l.effort || (ex && ex.effort) || 'n/a')); }
  /** Warm-connection samples only. A cold one includes TLS setup, which says nothing about the engine. */
  function okTimes(list) { return (list || []).filter(function (e) { return e && e.ok && e.timing.reusedSocket !== false; }).map(function (e) { return e.timing.totalMs; }); }
  function stateText(s) { return typeof s === 'string' ? s : JSON.stringify(s, null, 2); }
  function cleanQuestions(qs) { var out = {}; Object.keys(qs).forEach(function (k) { var c = Object.assign({}, qs[k]); delete c.signature; out[k] = c; }); return out; }
  function questions(ids) { var o = {}; ids.forEach(function (id) { o[id] = cfg.questionBank[id]; }); return o; }
  function option(value, text) { return el('option', { value: value, text: text }); }
  function busy(btn, on, label) { btn.disabled = on; if (label) btn.textContent = label; }
  function push(bucket, a, b, ex) { bucket[a] = bucket[a] || {}; (bucket[a][b] = bucket[a][b] || []).push(ex); }

  /* ---------- header ---------- */
  function renderProvenance() {
    var env = cfg.environment || {}, nb = env.networkBaseline || {}, llm = lane(headline);
    $('mode-badge').textContent = live ? 'Live' : 'Recorded';
    var parts = live
      ? ['Calls run from this machine with your keys, and the keys never reach the browser.']
      : ['Recorded on ' + fmt.date(cfg.recordedAt) + ' from one laptop on one network. Nothing on this page calls an API. Press Replay to watch a run at its recorded speed.'];
    if (llm) parts.push('OpenAI headline model: ' + llm.model + ' at reasoning effort ' + llm.effort + '.');
    if (nb.jev && nb.openai) parts.push('Network baseline, a bare request on a warm connection: ' + fmt.ms(nb.jev.warmGetMs) + ' to Jev, ' + fmt.ms(nb.openai.warmGetMs) + ' to OpenAI.');
    (cfg.warnings || []).forEach(function (w) { parts.push(w); });
    $('provenance-text').textContent = parts.join(' ');
  }

  /* ---------- act 1: anatomy ---------- */
  function initAnatomy() {
    var sel = $('anatomy-ticket'), btn = $('anatomy-run'), ids = cfg.questionSets.triage3, qs = questions(ids), seq = 0;
    Object.keys(cfg.inputs).forEach(function (id) { if (live || src.has({ laneId: 'jev', inputId: id, questionSetId: 'triage3' })) sel.appendChild(option(id, cfg.inputs[id].title)); });
    sel.value = cfg.featured.anatomy; btn.textContent = live ? 'Ask Jev' : 'Replay';
    $('anatomy-free').hidden = !live;
    var qBox = $('anatomy-questions'); ids.forEach(function (id) { qBox.appendChild(V.questionCard(id, qs[id])); });
    function showState() { $('anatomy-state').textContent = cfg.inputs[sel.value].state; }
    function renderAnswers(ex, pending) {
      var box = V.clear($('anatomy-answers'));
      ids.forEach(function (id) { box.appendChild(V.answerCard(id, qs[id], ex && ex.ok ? ex.normalized[id] : null, { pending: pending })); });
      V.linkCards($('act-anatomy'));
      if (ex && !ex.ok) box.insertBefore(el('p', { class: 'lane-detail is-error', text: ex.error.message }), box.firstChild);
    }
    function run(instant) {
      var mine = ++seq, free = live ? $('anatomy-free-text').value.trim() : '', req = { laneId: 'jev', questionSetId: 'triage3', instant: instant };
      if (free) { req.state = free; $('anatomy-state').textContent = free; } else { req.inputId = sel.value; showState(); }
      busy(btn, true); renderAnswers(null, true); $('anatomy-meta').textContent = '';
      src.run(req).then(function (ex) {
        if (mine !== seq) return; busy(btn, false); renderAnswers(ex, false);
        if (!ex.ok) return;
        $('anatomy-meta').textContent = [ex.resolvedModel, fmt.ms(ex.timing.totalMs), fmt.int(ex.usage.input_tokens) + ' input tokens', fmt.usd(ex.costUsd) + ' at list price'].join(' · ');
        V.renderJson($('anatomy-raw-req'), ex.raw && ex.raw.request ? ex.raw.request : { state: free || cfg.inputs[sel.value].state, model: 'jev-latest', questions: cleanQuestions(qs) });
        V.renderJson($('anatomy-raw-res'), ex.raw && ex.raw.response ? ex.raw.response : null);
      });
    }
    sel.addEventListener('change', function () { if (live) $('anatomy-free-text').value = ''; run(!live); });
    btn.addEventListener('click', function () { run(false); });
    run(!live);
  }

  /* ---------- act 2: the race ---------- */
  function initRace() {
    var sel = $('race-ticket'), btn = $('race-run'), more = $('race-more'), speedSel = $('race-speed'), pick = $('race-lanes'), track = $('race-track'), running = false;
    var raceInputs = live ? Object.keys(cfg.inputs) : cfg.plan.race.inputs, llmLanes = cfg.lanes.filter(function (l) { return l.id !== 'jev' && l.available && (live || cfg.plan.race.laneIds.indexOf(l.id) >= 0); });
    raceInputs.forEach(function (id) { sel.appendChild(option(id, cfg.inputs[id].title)); });
    sel.value = cfg.featured.race[0];
    llmLanes.forEach(function (l) {
      var cb = el('input', { type: 'checkbox', id: 'race-lane-' + l.id, value: l.id }); cb.checked = l.id === headline;
      cb.addEventListener('change', function () { if (!running) rest(); });
      pick.appendChild(el('label', { for: 'race-lane-' + l.id, title: l.why }, [cb, l.label + ' (' + l.model + ')']));
    });
    speedSel.parentNode.hidden = live; btn.textContent = live ? 'Run the race' : 'Replay the race'; more.hidden = !live;
    ['one call per engine', 'same ticket, same rubric text', 'strict JSON schema', 'lowest reasoning effort', 'warm connections', 'store: false', 'no retries inside a timed call'].forEach(function (c) { $('race-chips').appendChild(el('li', { text: c })); });
    ['Both engines get the same ticket and the same question and criteria text. The OpenAI prompt carries that text once, and its JSON schema carries only the allowed values.',
      'The OpenAI model answers all questions in one call, which is its best case. Reasoning effort is set to the lowest value each model accepts, and the value used is shown beside the model name.',
      'Times are wall-clock for a complete typed answer, measured on the server around each HTTPS request. Connections are kept alive and warmed up first, so no run pays for a TLS handshake. The dark tick on each bar is the time the API itself reported.',
      'There are no automatic retries inside a timed call. A failed call is shown as failed.',
      'We found no sign of response caching on Jev: repeated identical requests were not faster than requests with a unique id.',
      'Samples alternate between engines rather than running one engine first. We show every sample and the median, and no percentiles, because five samples cannot support one.',
      'The race asks for labels only. Asking the OpenAI model to also write a confidence number adds output tokens, so that happens only in the confidence section.',
    ].forEach(function (t) { $('race-fair').appendChild(el('li', { text: t })); });

    function lanesNow() { return [lane('jev')].concat(llmLanes.filter(function (l) { return $('race-lane-' + l.id).checked; })); }
    function samplesFor(inputId, laneId) { return (store.race[inputId] || {})[laneId] || []; }

    function buildTrack(lanes) {
      V.clear(track); var rows = {};
      lanes.forEach(function (l) {
        var bar = el('div', { class: 'lane-bar' }), tick = el('div', { class: 'lane-server', hidden: true }), clock = el('div', { class: 'lane-clock', text: '–' }), detail = el('div', { class: 'lane-detail' }), model = el('span', { class: 'lane-model', text: modelLine(l) });
        V.hover(tick, function () { return [el('b', { text: 'Time inside the API' }), el('span', { text: 'What the API itself reported spending on this request. The rest of the bar is network and TLS.' })]; });
        track.appendChild(el('div', { class: 'lane' + (l.id === 'jev' ? ' is-jev' : '') }, [el('div', { class: 'lane-name' }, [laneLabel(l), model]), el('div', { class: 'lane-track' }, [bar, tick]), clock, detail]));
        rows[l.id] = { bar: bar, tick: tick, clock: clock, detail: detail, model: model, done: null, lane: l };
      });
      var axis = el('div', { class: 'race-axis-inner' }); track.appendChild(el('div', { class: 'race-axis' }, axis)); rows._axis = axis; return rows;
    }
    function drawAxis(axis, max) { V.clear(axis); V.ticks(max, axis.clientWidth && axis.clientWidth < 380 ? 2 : 4).forEach(function (t) { axis.appendChild(el('span', { text: fmt.ms(t), style: { left: (t / max) * 100 + '%' } })); }); }
    function settle(row, ex, max) {
      row.done = ex;
      if (!ex.ok) { row.bar.style.width = '0'; row.clock.textContent = 'failed'; row.detail.textContent = ex.error.message; row.detail.classList.add('is-error'); return; }
      var t = ex.timing; row.bar.style.width = Math.min(100, (t.totalMs / max) * 100) + '%'; row.clock.textContent = fmt.ms(t.totalMs); row.model.textContent = modelLine(row.lane, ex);
      if (t.serverMs != null) { row.tick.hidden = false; row.tick.style.left = Math.min(100, (t.serverMs / max) * 100) + '%'; }
      row.detail.textContent = [t.serverMs != null ? fmt.ms(t.serverMs) + ' inside the API' : null, t.reusedSocket ? 'warm connection' : 'cold connection, includes TLS setup', fmt.int(ex.usage.input_tokens) + ' tokens in, ' + fmt.int(ex.usage.output_tokens) + ' out'].filter(Boolean).join(' · ');
    }

    function renderResults(lanes, results) {
      var inputId = sel.value, ids = cfg.questionSets.triage3, labels = cfg.inputs[inputId].labels || {}, jev = results.jev, hasLabels = ids.some(function (id) { return labels[id] !== undefined; });
      var t = V.clear($('race-answers')), head = el('tr', {}, [el('th', { text: 'Question' })]);
      lanes.forEach(function (l) { head.appendChild(el('th', { text: laneLabel(l) })); }); if (hasLabels) head.appendChild(el('th', { text: 'Author label' })); t.appendChild(el('thead', {}, head));
      var body = el('tbody');
      ids.forEach(function (id) {
        var tr = el('tr', {}, [el('td', { class: 'mono', text: id })]);
        lanes.forEach(function (l) {
          var ex = results[l.id], a = ex && ex.ok ? ex.normalized[id] : null, ja = jev && jev.ok ? jev.normalized[id] : null, txt = !a ? '–' : a.type === 'score' ? 'level ' + a.level : a.label, sub = [];
          if (a && a.p != null) sub.push(el('span', { class: 'tier', text: 'p ' + fmt.p(a.p) }));
          if (l.id !== 'jev' && a && ja) sub.push(V.mark(a.type === 'score' ? a.level === ja.level : a.label === ja.label, 'same as Jev', 'differs'));
          tr.appendChild(el('td', {}, [el('div', { class: 'cell-main', text: txt }), sub.length ? el('div', { class: 'cell-sub' }, sub) : null]));
        });
        if (hasLabels) { var lab = labels[id]; tr.appendChild(el('td', { class: 'mono', text: lab === undefined ? '–' : Array.isArray(lab) ? lab.join(' or ') : lab === true ? 'yes' : lab === false ? 'no' : String(lab) })); }
        body.appendChild(tr);
      });
      t.appendChild(body);

      var c = V.clear($('race-cost')); c.appendChild(el('thead', {}, el('tr', {}, [el('th', { text: 'Engine' }), el('th', { class: 'num', text: 'Tokens in' }), el('th', { class: 'num', text: 'Tokens out' }), el('th', { class: 'num', text: 'Per call' }), el('th', { class: 'num', text: 'Per 1M calls' })])));
      var cb = el('tbody'); lanes.forEach(function (l) {
        var ex = results[l.id], ok = ex && ex.ok, sw = el('span', { class: 'sw' }); sw.style.background = laneColor(l.id);
        cb.appendChild(el('tr', {}, [el('td', {}, [sw, laneLabel(l)]), el('td', { class: 'num' }, ok ? [fmt.int(ex.usage.input_tokens), ex.usage.cached_tokens ? el('div', { class: 'tier', text: fmt.int(ex.usage.cached_tokens) + ' cached' }) : null] : ['–']), el('td', { class: 'num', text: ok ? fmt.int(ex.usage.output_tokens) : '–' }), el('td', { class: 'num', text: ok ? fmt.usd(ex.costUsd) : '–' }), el('td', { class: 'num', text: ok && ex.costUsd != null ? fmt.usd(ex.costUsd * 1e6) : '–' })]));
      }); c.appendChild(cb);
      var h = results[headline], note = 'Prices are published list prices, retrieved ' + cfg.pricing.retrievedAt + '. Token counts are measured. Jev counts more input tokens than OpenAI for the same request, and its output tokens are free. OpenAI bills a repeated long prompt at a lower cached rate. When that happens the cached tokens are shown and the cost reflects it.';
      if (jev && jev.ok && h && h.ok) note = 'On this run Jev took ' + fmt.ms(jev.timing.totalMs) + ' and ' + lane(headline).model + ' took ' + fmt.ms(h.timing.totalMs) + ', which is ' + fmt.times(h.timing.totalMs / jev.timing.totalMs) + ' as long. Per call, the OpenAI model cost ' + fmt.times(h.costUsd / jev.costUsd) + ' as much. ' + note;
      $('race-cost-note').textContent = note;
      renderSamples(lanes);
    }
    function renderSamples(lanes) {
      V.stripPlot($('race-samples'), lanes.map(function (l) { return { name: laneLabel(l), color: laneColor(l.id), samples: okTimes(samplesFor(sel.value, l.id)) }; }));
      J.acts.renderClaims();
    }

    /** Show a finished race without animating: the page at rest. */
    function rest() {
      var lanes = lanesNow(), rows = buildTrack(lanes), results = {}, max = 0;
      lanes.forEach(function (l) { var s = samplesFor(sel.value, l.id).filter(function (e) { return e.ok; })[0]; if (s) { results[l.id] = s; max = Math.max(max, s.timing.totalMs); } });
      max = V.niceMax(Math.max(max, 400) * 1.05); drawAxis(rows._axis, max);
      lanes.forEach(function (l) { if (results[l.id]) settle(rows[l.id], results[l.id], max); else rows[l.id].detail.textContent = live ? 'Not run yet for this ticket.' : 'Not part of the recording.'; });
      if (Object.keys(results).length) renderResults(lanes, results); else renderSamples(lanes);
    }

    function race() {
      if (running) return; running = true; busy(btn, true); more.disabled = true;
      var lanes = lanesNow(), rows = buildTrack(lanes), speed = live ? 1 : Number(speedSel.value), inputId = sel.value, results = {}, t0 = performance.now(), pending = lanes.length;
      var known = live ? 0 : stats.max(lanes.map(function (l) { var s = samplesFor(inputId, l.id)[0]; return s ? s.timing.totalMs : 0; }));
      var max = V.niceMax(Math.max(known, 1000) * 1.05); drawAxis(rows._axis, max);
      var runIndex = live ? 0 : ((race.n = (race.n || 0) + 1) - 1);
      function frame() {
        if (!running) return; var sim = (performance.now() - t0) * speed;
        if (sim > max * 0.94) { max = V.niceMax(max * 1.5); drawAxis(rows._axis, max); lanes.forEach(function (l) { if (rows[l.id].done) settle(rows[l.id], rows[l.id].done, max); }); }
        lanes.forEach(function (l) { var r = rows[l.id]; if (r.done) return; r.bar.style.width = Math.min(100, (sim / max) * 100) + '%'; r.clock.textContent = fmt.ms(sim); });
        requestAnimationFrame(frame);
      }
      src.warm({ jev: 1, openai: lanes.length - 1 }).then(function () {
      t0 = performance.now(); if (!V.reduceMotion) requestAnimationFrame(frame);
      lanes.forEach(function (l) {
        src.run({ laneId: l.id, inputId: inputId, questionSetId: 'triage3', sampleIndex: runIndex, speed: speed }).then(function (ex) {
          results[l.id] = ex; if (live) push(store.race, inputId, l.id, ex);
          settle(rows[l.id], ex, max);
          if (--pending === 0) { running = false; busy(btn, false); more.disabled = false; lanes.forEach(function (x) { if (results[x.id].ok) settle(rows[x.id], results[x.id], max); }); renderResults(lanes, results); }
        });
      });
      });
    }
    function runMore() {
      if (running) return; running = true; busy(btn, true); busy(more, true, 'Running');
      var lanes = lanesNow(), inputId = sel.value, jobs = []; for (var i = 0; i < 5; i++) lanes.forEach(function (l) { jobs.push(l); });
      (function next() {
        if (!jobs.length) { running = false; busy(btn, false); busy(more, false, 'Run 5 more'); return rest(); }
        var l = jobs.shift(); src.run({ laneId: l.id, inputId: inputId, questionSetId: 'triage3' }).then(function (ex) { push(store.race, inputId, l.id, ex); renderSamples(lanes); next(); });
      })();
    }
    btn.addEventListener('click', race); more.addEventListener('click', runMore);
    sel.addEventListener('change', function () { if (!running) { rest(); if (live && !samplesFor(sel.value, 'jev').length) race(); } });
    rest(); if (live) setTimeout(race, 1200);
  }

  /* ---------- act 3: fan-out ---------- */
  function fanSeries() { return SERIES.map(function (s) { return Object.assign({}, s, { laneId: s.laneId || headline }); }); }
  function renderFanout() {
    var series = fanSeries(), have = FAN.every(function (n) { return series.every(function (s) { return okTimes((store.fanout[n] || {})[s.id]).length; }); });
    var legend = V.clear($('fanout-legend')); series.forEach(function (s) { var i = el('i'); i.style.borderTopColor = V.cssVar(s.css); legend.appendChild(el('span', {}, [i, s.name + (s.id === 'jev' ? '' : ' (' + lane(headline).model + ')')])); });
    if (!have) { V.clear($('fanout-chart')).appendChild(el('p', { class: 'a-empty', text: live ? 'No measurements yet. Run it live to fill this chart.' : 'Not part of the recording.' })); return; }
    V.lineChart($('fanout-chart'), series.map(function (s) { return { name: s.name, short: s.short, color: V.cssVar(s.css), points: FAN.map(function (n) { return { x: n, samples: okTimes(store.fanout[n][s.id]) }; }) }; }), { label: 'Median latency against number of questions for three setups', xLabel: 'questions in the request' });
    var t = V.clear($('fanout-table')); t.appendChild(el('thead', {}, el('tr', {}, [el('th', { text: 'Questions' }), el('th', { text: 'Setup' }), el('th', { class: 'num', text: 'Median' }), el('th', { class: 'num', text: 'Range' }), el('th', { class: 'num', text: 'Tokens in' }), el('th', { class: 'num', text: 'Per call' })])));
    var b = el('tbody'); FAN.forEach(function (n) { series.forEach(function (s) { var list = store.fanout[n][s.id].filter(function (e) { return e.ok; }), ms = okTimes(list), e0 = list[0];
      b.appendChild(el('tr', {}, [el('td', { class: 'num', text: String(n) }), el('td', { text: s.name }), el('td', { class: 'num', text: fmt.ms(stats.median(ms)) }), el('td', { class: 'num', text: fmt.ms(stats.min(ms)) + ' to ' + fmt.ms(stats.max(ms)) }), el('td', { class: 'num', text: fmt.int(e0.usage.input_tokens) }), el('td', { class: 'num', text: fmt.usd(e0.costUsd) })])); }); }); t.appendChild(b);
    var med = function (n, id) { return stats.median(okTimes(store.fanout[n][id])); }, cost = function (n, id) { return store.fanout[n][id].filter(function (e) { return e.ok; })[0].costUsd; };
    $('fanout-takeaway').textContent = 'Going from 1 question to 12, Jev went from ' + fmt.ms(med(1, 'jev')) + ' to ' + fmt.ms(med(12, 'jev')) + '. OpenAI in one call went from ' + fmt.ms(med(1, 'one')) + ' to ' + fmt.ms(med(12, 'one')) + '. Twelve OpenAI calls fired together took ' + fmt.ms(med(12, 'par')) + ' and cost ' + fmt.times(cost(12, 'par') / cost(12, 'one')) + ' as much as the single call, because every call repeats the ticket.';
    J.acts.renderClaims();
  }
  function initFanout() {
    var btn = $('fanout-run'), status = $('fanout-status'), inputId = cfg.featured.fanout; btn.hidden = !live;
    if (base) FAN.forEach(function (n) { fanSeries().forEach(function (s) { base.all({ laneId: s.laneId, inputId: inputId, questionIds: cfg.questionSets['triage' + n], variant: s.variant, act: 'fanout' }).forEach(function (ex) { push(store.fanout, n, s.id, ex); }); }); });
    status.textContent = live && base ? 'Showing the recording from ' + fmt.date(base.config.recordedAt) + '.' : '';
    btn.addEventListener('click', function () {
      var jobs = [], total; store.fanout = {}; for (var r = 0; r < 3; r++) FAN.forEach(function (n) { fanSeries().forEach(function (s) { jobs.push({ n: n, s: s }); }); }); total = jobs.length; busy(btn, true);
      (function next() {
        if (!jobs.length) { busy(btn, false); status.textContent = 'Measured live just now, 3 samples per point.'; return renderFanout(); }
        var j = jobs.shift(); status.textContent = 'Running ' + (total - jobs.length) + ' of ' + total + '.';
        src.run({ laneId: j.s.laneId, inputId: inputId, questionIds: cfg.questionSets['triage' + j.n], variant: j.s.variant }).then(function (ex) { push(store.fanout, j.n, j.s.id, ex); next(); });
      })();
    });
    renderFanout();
  }

  /* ---------- act 4: confidence gating ---------- */
  function initGating() {
    var btn = $('gating-run'), status = $('gating-status'), ids = Object.keys(cfg.inputs), engines = [{ id: 'jev', laneId: 'jev', name: 'Jev', sub: 'confidence from its probability spread', css: '--jev' }, { id: 'llm', laneId: headline, name: 'OpenAI', sub: 'a number the model wrote', css: '--llm' }];
    var th = { jev: { escalateBelow: 0.5, actAbove: 0.9 }, llm: { escalateBelow: 0.5, actAbove: 0.9 } }, strips = {};
    btn.hidden = !live;
    function req(e, id) { return { laneId: e.laneId, inputId: id, questionSetId: 'triage1', withConfidence: e.id === 'llm' }; }
    if (base) ids.forEach(function (id) { engines.forEach(function (e) { var ex = base.all(Object.assign({ act: 'gating' }, req(e, id)))[0]; if (ex) { store.gating[id] = store.gating[id] || {}; store.gating[id][e.id] = ex; } }); });
    status.textContent = live && base ? 'Showing the recording from ' + fmt.date(base.config.recordedAt) + '.' : '';

    function item(e, id) {
      var ex = (store.gating[id] || {})[e.id], inp = cfg.inputs[id]; if (!ex || !ex.ok) return null;
      var a = ex.normalized.department, exp = inp.labels.department, list = Array.isArray(exp) ? exp : [exp];
      return { id: id, title: inp.title, confidence: a.confidence, answer: a.label, expected: list.join(' or '), kind: inp.escalateIsCorrect ? 'open' : list.indexOf(a.label) >= 0 ? 'right' : 'wrong' };
    }
    function bucket(e, it) { return it.confidence < th[e.id].escalateBelow ? 'escalate' : it.confidence >= Math.max(th[e.id].actAbove, th[e.id].escalateBelow) ? 'act' : 'confirm'; }
    function hot(id, on) { var tr = document.querySelector('#gating-table tr[data-id="' + id + '"]'); if (tr) tr.classList.toggle('is-hot', on); }
    function sumText(list) { var r = 0, w = 0, o = 0; list.forEach(function (i) { if (i.kind === 'right') r++; else if (i.kind === 'wrong') w++; else o++; }); var p = []; if (r) p.push(r + ' right'); if (w) p.push(w + ' wrong'); if (o) p.push(o + ' needed a person'); return p.join(', ') || 'none'; }

    function renderSummary(e, box) {
      var items = ids.map(function (id) { return item(e, id); }).filter(Boolean), g = { act: [], confirm: [], escalate: [] }; items.forEach(function (i) { g[bucket(e, i)].push(i); }); V.clear(box);
      [['act', 'Acts alone'], ['confirm', 'Asks to confirm'], ['escalate', 'Escalates']].forEach(function (k) { box.appendChild(el('div', { class: k[0] }, [el('span', { class: 'k', text: k[1] }), el('span', { class: 'n', text: String(g[k[0]].length) }), el('span', { class: 'd', text: sumText(g[k[0]]) })])); });
    }
    function renderTable() {
      var t = V.clear($('gating-table')); t.appendChild(el('thead', {}, el('tr', {}, [el('th', { text: 'Ticket' }), el('th', { text: 'Author label' }), el('th', { text: 'Jev' }), el('th', { text: 'OpenAI' })])));
      var b = el('tbody'); ids.forEach(function (id) {
        var inp = cfg.inputs[id], exp = inp.labels.department, tr = el('tr', { data: { id: id } }, [el('td', {}, [inp.title, el('div', { class: 'tier', text: inp.tier + (inp.note ? '. ' + inp.note : '') })]), el('td', { class: 'mono', text: inp.escalateIsCorrect ? 'a person' : Array.isArray(exp) ? exp.join(' or ') : exp })]);
        engines.forEach(function (e) { var it = item(e, id); if (!it) return tr.appendChild(el('td', { text: '–' })); var bk = bucket(e, it), good = it.kind === 'open' ? bk !== 'act' : it.kind === 'right';
          tr.appendChild(el('td', {}, [el('div', { class: 'cell-main', text: it.answer + '  ' + fmt.p(it.confidence) }), el('div', { class: 'cell-sub' }, [el('span', { class: 'pill ' + bk, text: bk === 'act' ? 'acts alone' : bk }), V.mark(good, it.kind === 'open' ? 'held back' : 'right', it.kind === 'open' ? 'acted on it' : 'wrong')])])); });
        b.appendChild(tr);
      }); t.appendChild(b);
    }
    function build() {
      var host = V.clear($('gating-strips')); var any = engines.some(function (e) { return ids.some(function (id) { return item(e, id); }); });
      if (!any) { host.appendChild(el('p', { class: 'a-empty', text: live ? 'No measurements yet. Run it live to fill this section.' : 'Not part of the recording.' })); V.clear($('gating-table')); return; }
      engines.forEach(function (e) {
        var chart = el('div', { class: 'chart' }), sum = el('div', { class: 'gate-sum' }), sliders = el('div', { class: 'gate-sliders' }), l = lane(e.laneId);
        [['escalateBelow', 'Escalate below'], ['actAbove', 'Act alone at or above']].forEach(function (s) {
          var out = el('output', { text: fmt.p(th[e.id][s[0]]) }), rid = 'gate-' + e.id + '-' + s[0], input = el('input', { type: 'range', min: '0', max: '1', step: '0.01', id: rid, value: String(th[e.id][s[0]]) });
          input.addEventListener('input', function () { th[e.id][s[0]] = Number(input.value); out.textContent = fmt.p(th[e.id][s[0]]); strips[e.id].redraw(); renderSummary(e, sum); renderTable(); });
          sliders.appendChild(el('label', { for: rid }, [el('span', {}, [s[1] + ' ', out]), input]));
        });
        host.appendChild(el('div', { class: 'gate' }, [el('div', { class: 'gate-title' }, [el('b', { text: e.name }), el('span', { text: (l ? l.model : '') + ' · ' + e.sub })]), sliders, chart, sum]));
        strips[e.id] = V.confidenceStrip(chart, ids.map(function (id) { return item(e, id); }).filter(Boolean), th[e.id], V.cssVar(e.css), hot); renderSummary(e, sum);
      });
      renderTable();
    }
    var key = $('gating-key'); [['●', 'matched the author label'], ['✕', 'did not match'], ['◇', 'needed a person by design, so holding back is the right call']].forEach(function (k) { key.appendChild(el('span', {}, [el('b', { text: k[0] }), k[1]])); });
    key.appendChild(el('span', { text: 'Starting thresholds of 0.50 and 0.90 come from TypeSafe’s confidence guide. Each engine has its own sliders because the two numbers are different statistics.' }));
    btn.addEventListener('click', function () {
      var jobs = []; ids.forEach(function (id) { engines.forEach(function (e) { jobs.push({ e: e, id: id }); }); }); var total = jobs.length; store.gating = {}; busy(btn, true);
      (function next() { if (!jobs.length) { busy(btn, false); status.textContent = 'Measured live just now.'; return build(); } var j = jobs.shift(); status.textContent = 'Running ' + (total - jobs.length) + ' of ' + total + '.';
        src.run(req(j.e, j.id)).then(function (ex) { store.gating[j.id] = store.gating[j.id] || {}; store.gating[j.id][j.e.id] = ex; next(); }); })();
    });
    build();
  }

  /* ---------- closing: limits, claims, method ---------- */
  function initLimits() {
    var btn = $('limits-run'), status = $('limits-status'), ids = Object.keys(cfg.limits), engines = [['jev', 'jev', 'Jev'], ['llm', headline, 'OpenAI']]; btn.hidden = !live;
    if (base) ids.forEach(function (id) { engines.forEach(function (e) { var ex = base.all({ laneId: e[1], limitId: id })[0]; if (ex) { store.limits[id] = store.limits[id] || {}; store.limits[id][e[0]] = ex; } }); });
    status.textContent = live && base ? 'Showing the recording from ' + fmt.date(base.config.recordedAt) + '.' : '';
    function render() {
      var host = V.clear($('limits-cards')), tally = { jev: { ok: 0, n: 0 }, llm: { ok: 0, n: 0 } }; ids.forEach(function (id) {
        var L = cfg.limits[id], qid = Object.keys(L.questions)[0], q = L.questions[qid], truth = L.truth[qid], dl = el('dl');
        V.add(dl, [el('dt', { text: 'Asked' }), el('dd', { text: qid + ': ' + q.signature }), el('dt', { text: 'By code' }), el('dd', { text: (truth === true ? 'yes' : truth === false ? 'no' : truth) + ', because ' + L.truthBy })]);
        engines.forEach(function (e) { var ex = (store.limits[id] || {})[e[0]], a = ex && ex.ok ? ex.normalized[qid] : null, got = a ? (a.type === 'noul' ? a.label === 'yes' : a.label) : null;
          if (a) { tally[e[0]].n++; if (got === truth) tally[e[0]].ok++; }
          var coin = a && a.p != null && Math.abs(a.p - 0.5) < 0.1;
          V.add(dl, [el('dt', { text: e[2] }), el('dd', {}, a ? [a.label + (a.p != null ? '  p ' + fmt.p(a.p) : '') + (a.confidence != null ? '  confidence ' + fmt.p(a.confidence) : '') + '  ', V.mark(got === truth, 'right', 'wrong'), coin ? el('div', { class: 'tier', text: 'p is close to 0.5, so this was nearly a coin flip' }) : null] : [ex && !ex.ok ? ex.error.message : live ? 'not run yet' : 'not recorded'])]); });
        host.appendChild(el('div', { class: 'limit' }, [el('h4', { text: L.limitation }), el('div', { class: 'ticket', text: stateText(L.state) }), el('p', { class: 'q-text', text: q.instructions }), dl]));
      });
      $('limits-takeaway').textContent = tally.jev.n && tally.llm.n ? 'In this run Jev got ' + tally.jev.ok + ' of ' + tally.jev.n + ' right and ' + lane(headline).model + ' got ' + tally.llm.ok + ' of ' + tally.llm.n + '. Three cases prove nothing about either engine. A line of code gets all of them right every time, which is why TypeSafe says to compute these instead of asking.' : '';
    }
    btn.addEventListener('click', function () { var jobs = []; ids.forEach(function (id) { engines.forEach(function (e) { jobs.push([id, e]); }); }); busy(btn, true);
      (function next() { if (!jobs.length) { busy(btn, false); status.textContent = 'Measured live just now.'; return render(); } var j = jobs.shift(); src.run({ laneId: j[1][1], limitId: j[0] }).then(function (ex) { store.limits[j[0]] = store.limits[j[0]] || {}; store.limits[j[0]][j[1][0]] = ex; next(); }); })(); });
    render();
  }

  function renderClaims() {
    var t = V.clear($('claims-table')); if (!cfg) return;
    t.appendChild(el('thead', {}, el('tr', {}, [el('th', { text: 'TypeSafe says' }), el('th', { text: 'We measured' }), el('th', { text: 'Why they differ' })])));
    var jevAll = [], llmAll = [], frontierAll = [], jc = [], lc = [];
    Object.keys(store.race).forEach(function (inp) { var r = store.race[inp]; jevAll = jevAll.concat(okTimes(r.jev)); llmAll = llmAll.concat(okTimes(r[headline])); frontierAll = frontierAll.concat(okTimes(r.openai_frontier));
      (r.jev || []).forEach(function (e) { if (e.ok) jc.push(e.costUsd); }); (r[headline] || []).forEach(function (e) { if (e.ok) lc.push(e.costUsd); }); });
    var measured = {
      speed: jevAll.length && llmAll.length ? 'Median ' + fmt.ms(stats.median(jevAll)) + ' for Jev and ' + fmt.ms(stats.median(llmAll)) + ' for ' + lane(headline).model + ' across ' + jevAll.length + ' and ' + llmAll.length + ' samples. That is ' + fmt.times(stats.median(llmAll) / stats.median(jevAll)) + ' faster' + (frontierAll.length ? ', and ' + fmt.times(stats.median(frontierAll) / stats.median(jevAll)) + ' against the frontier model' : '') + '. Cost per call was ' + fmt.times(stats.median(lc) / stats.median(jc)) + ' lower.' : 'Run the race to fill this in.',
      fanout: store.fanout[1] && store.fanout[12] && okTimes(store.fanout[1].jev).length && okTimes(store.fanout[12].jev).length ? 'Jev median ' + fmt.ms(stats.median(okTimes(store.fanout[1].jev))) + ' with 1 question and ' + fmt.ms(stats.median(okTimes(store.fanout[12].jev))) + ' with 12.' : 'Run the fan-out section to fill this in.',
      price: jc.length && lc.length ? 'Median cost per three-question call: ' + fmt.usd(stats.median(jc)) + ' for Jev and ' + fmt.usd(stats.median(lc)) + ' for ' + lane(headline).model + '.' : 'Run the race to fill this in.',
    };
    var b = el('tbody'); cfg.claims.forEach(function (c) { b.appendChild(el('tr', {}, [el('td', {}, [el('q', { text: c.quote }), el('div', { class: 'tier' }, [el('a', { href: c.sourceUrl, rel: 'noopener', target: '_blank', text: c.sourceUrl.replace('https://', '') }), ', read ' + c.retrievedAt])]), el('td', { text: measured[c.id] || '–' }), el('td', { text: c.conditions })])); }); t.appendChild(b);
  }
  function renderMethod() {
    var env = cfg.environment || {}, list = V.clear($('method-list')), p = cfg.plan;
    [live ? 'This page is live. Buttons make real API calls from the local server on this machine.' : 'This page is a recording made on ' + fmt.date(cfg.recordedAt) + '. It makes no network calls.',
      'Measured from ' + (env.vantage || 'one laptop, one network') + ' with ' + (env.runtime || 'Node') + ' using ' + (env.client || 'keep-alive HTTPS') + '. Your numbers will differ with distance to each API.',
      p ? 'The recording holds ' + p.race.samples + ' samples per engine for each race ticket, ' + p.fanout.samples + ' per point in the fan-out chart, and one run per ticket in the confidence section. ' + (p.failures ? p.failures + ' calls failed and are kept in the file.' : 'No calls failed.') : null,
      base && base.coldCount ? base.coldCount + ' recorded samples ran on a cold connection. They are kept in the file and left out of every median, because TLS setup says nothing about the engine.' : 'Every recorded sample ran on a warm connection. Before any burst of concurrent calls, enough connections are opened first, outside the timed window.',
      'All 14 tickets, their labels and their difficulty tiers were written before the first recorded run. Scenario fingerprint: ' + cfg.scenarioHash + '. No ticket was removed after seeing results.',
      'Right and wrong are judged against the author’s labels, which are one person’s opinion. Several tickets accept more than one team.',
      'Jev returns probabilities rounded to two decimals. Its confidence formula is not published. The OpenAI confidence is a number the model wrote when asked, so the two are not the same statistic.',
      'Costs use list prices: ' + Object.keys(cfg.pricing.entries).map(function (m) { var e = cfg.pricing.entries[m]; return m + ' $' + e.inputPerM + ' in, $' + e.outputPerM + ' out per 1M tokens'; }).join('; ') + '.',
    ].filter(Boolean).forEach(function (s) { list.appendChild(el('li', { text: s })); });
  }

  J.acts = {
    renderClaims: renderClaims,
    start: function (source, baseline) {
      src = source; base = baseline; cfg = source.config; live = source.mode === 'live';
      var fast = cfg.lanes.filter(function (l) { return l.id !== 'jev' && l.available && l.tier === 'fast'; })[0] || cfg.lanes.filter(function (l) { return l.id !== 'jev' && l.available; })[0]; headline = fast ? fast.id : null;
      if (base) { var bp = base.config.plan; bp.race.inputs.forEach(function (inp) { bp.race.laneIds.forEach(function (lid) { base.all({ laneId: lid, inputId: inp, questionSetId: 'triage3', act: 'race' }).forEach(function (ex) { if (!live) push(store.race, inp, lid, ex); }); }); }); }
      renderProvenance(); initAnatomy(); initRace(); initFanout(); initGating(); initLimits(); renderClaims(); renderMethod();
    },
  };
})();
