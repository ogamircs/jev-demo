/* Live source: talks to the local server, which holds the keys. This file is left out of the published artifact. */
(function () {
  'use strict';
  var J = (window.JevDemo = window.JevDemo || {});

  J.loadRecording = function () {
    return fetch('/recordings/latest.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  };

  J.liveSource = function () {
    function getConfig(tries) {
      return fetch('/api/config').then(function (r) { return r.json(); }).then(function (c) {
        if (c.ready || tries <= 0) return c;
        return new Promise(function (res) { setTimeout(res, 700); }).then(function () { return getConfig(tries - 1); });
      });
    }
    return getConfig(40).then(function (config) {
      return {
        mode: 'live', config: config, all: function () { return []; }, has: function () { return true; },
        // Untimed: opens enough keep-alive connections that a burst of concurrent calls never pays for TLS setup.
        warm: function (n) { return fetch('/api/warm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(n) }).then(function () {}, function () {}); },
        run: function (req) {
          var body = { laneId: req.laneId, inputId: req.inputId, state: req.state, limitId: req.limitId, questionSetId: req.questionSetId, questionIds: req.questionIds, withConfidence: !!req.withConfidence, variant: req.variant };
          return fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            .then(function (r) { return r.json().then(function (j) { return r.ok ? j : { laneId: req.laneId, ok: false, status: r.status, timing: null, usage: null, normalized: null, raw: null, error: j.error || { kind: 'error', message: 'The local server returned HTTP ' + r.status + '.' } }; }); })
            .catch(function () { return { laneId: req.laneId, ok: false, status: 0, timing: null, usage: null, normalized: null, raw: null, error: { kind: 'network', message: 'Could not reach the local demo server. Is it still running?' } }; });
        },
      };
    });
  };
})();
