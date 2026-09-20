/* Replay source: serves recorded exchanges. Makes no network calls, so it is safe inside a published artifact. */
(function () {
  'use strict';
  var J = (window.JevDemo = window.JevDemo || {});

  /** Must match lib/recording.mjs exchangeKey(). */
  J.exchangeKey = function (req, sets) {
    var q = req.limitId ? 'limit' : (req.questionIds || sets[req.questionSetId || 'triage3'] || []).join(',');
    return [req.laneId, req.limitId || req.inputId || 'free', q, req.withConfidence ? 'c' : '', req.variant === 'one_call_per_question' ? 'p' : ''].join('|');
  };

  J.replaySource = function (rec) {
    var index = {};
    (rec.exchanges || []).forEach(function (ex) { (index[ex.key] = index[ex.key] || []).push(ex); });
    Object.keys(index).forEach(function (k) { index[k].sort(function (a, b) { return a.sampleIndex - b.sampleIndex; }); });
    var config = Object.assign({}, rec.catalog, { mode: 'replay', lanes: rec.lanes, environment: rec.environment, recordedAt: rec.recordedAt, plan: rec.plan, warnings: [] });
    function all(req) { return (index[J.exchangeKey(req, config.questionSets)] || []).filter(function (e) { return e.ok && (!req.act || e.act === req.act); }); }
    return {
      mode: 'replay', config: config, all: all, coldCount: (rec.exchanges || []).filter(function (e) { return e.ok && e.timing && e.timing.reusedSocket === false; }).length, warm: function () { return Promise.resolve(); },
      has: function (req) { return all(req).length > 0; },
      run: function (req) {
        var list = all(req), ex = list.length ? list[(req.sampleIndex || 0) % list.length] : null;
        if (!ex) return Promise.resolve({ laneId: req.laneId, ok: false, status: 0, timing: null, usage: null, normalized: null, raw: null, error: { kind: 'not_recorded', message: 'This combination was not part of the recording.' } });
        var wait = req.instant ? 0 : (ex.timing.totalMs || 0) / (req.speed || 1);
        return new Promise(function (resolve) { setTimeout(function () { resolve(ex); }, wait); });
      },
    };
  };
})();
