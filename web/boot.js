/* Chooses the data source. Embedded recording = published artifact. ?replay=1 = local replay. Otherwise live. */
(function () {
  'use strict';
  var J = window.JevDemo;
  function fail(msg) { var t = document.getElementById('provenance-text'), b = document.getElementById('mode-badge'); if (b) b.textContent = 'Problem'; if (t) t.textContent = msg; }
  var embedded = document.getElementById('jev-recording');
  var wantReplay = !!embedded || /[?&]replay=1\b/.test(window.location.search);
  var recording = embedded ? Promise.resolve(JSON.parse(embedded.textContent)) : J.loadRecording ? J.loadRecording() : Promise.resolve(null);
  recording.then(function (rec) {
    if (wantReplay) {
      if (!rec) return fail('No recording was found. Run "node --env-file=.env scripts/record.mjs" first.');
      var src = J.replaySource(rec); return J.acts.start(src, src);
    }
    return J.liveSource().then(function (live) { J.acts.start(live, rec ? J.replaySource(rec) : null); });
  }).catch(function (e) { fail('The page could not start: ' + (e && e.message ? e.message : e)); });
})();
