/* Widgets and charts. Classic script under one namespace so the artifact builder can concatenate files.
   All text from data goes in via textContent, never innerHTML. */
(function () {
  'use strict';
  var J = (window.JevDemo = window.JevDemo || {});
  var SVGNS = 'http://www.w3.org/2000/svg';

  function setAttrs(node, attrs, isSvg) {
    for (var k in attrs || {}) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'text') node.textContent = v;
      else if (k === 'class') node.setAttribute('class', v);
      else if (k === 'style' && typeof v === 'object') for (var s in v) node.style.setProperty(s, v[s]);
      else if (k === 'on') for (var e in v) node.addEventListener(e, v[e]);
      else if (k === 'data') for (var d in v) node.dataset[d] = v[d];
      else node.setAttribute(k, v === true ? '' : v);
    }
  }
  function add(node, kids) {
    (Array.isArray(kids) ? kids : [kids]).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return node;
  }
  function el(tag, attrs, kids) { var n = document.createElement(tag); setAttrs(n, attrs); return add(n, kids || []); }
  function svg(tag, attrs, kids) { var n = document.createElementNS(SVGNS, tag); setAttrs(n, attrs, true); return add(n, kids || []); }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

  var fmt = {
    ms: function (v) { return v == null ? '–' : v >= 10000 ? (v / 1000).toFixed(1) + ' s' : Math.round(v).toLocaleString('en-US') + ' ms'; },
    p: function (v) { return v == null ? '–' : Number(v).toFixed(2); },
    int: function (v) { return v == null ? '–' : Math.round(v).toLocaleString('en-US'); },
    usd: function (v) {
      if (v == null) return '–'; if (v === 0) return '$0';
      if (v >= 100) return '$' + Math.round(v).toLocaleString('en-US');
      if (v >= 1) return '$' + v.toFixed(2);
      return '$' + v.toFixed(Math.min(8, Math.max(2, 1 - Math.floor(Math.log10(v)))));
    },
    s: function (v) { return (v / 1000).toFixed(1) + ' s'; },
    times: function (v) { return v == null || !isFinite(v) ? '–' : (v >= 10 ? Math.round(v) : v.toFixed(1)) + '×'; },
    date: function (iso) { try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return iso; } },
  };
  var stats = {
    median: function (a) { var s = a.slice().sort(function (x, y) { return x - y; }); if (!s.length) return null; var m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; },
    min: function (a) { return a.length ? Math.min.apply(null, a) : null; },
    max: function (a) { return a.length ? Math.max.apply(null, a) : null; },
  };
  function niceMax(v) { if (!(v > 0)) return 1; var p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
  function ticks(max, n) { var out = []; for (var i = 0; i <= n; i++) out.push((max * i) / n); return out; }
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- tooltip ---- */
  var tipNode = null;
  var tip = {
    show: function (anchor, content) {
      tipNode = tipNode || document.getElementById('tip'); if (!tipNode) return;
      clear(tipNode); add(tipNode, content); tipNode.hidden = false;
      var x, y;
      if (anchor && anchor.clientX !== undefined) { x = anchor.clientX + 14; y = anchor.clientY + 14; }
      else { var r = anchor.getBoundingClientRect(); x = r.left + r.width / 2 + 10; y = r.bottom + 8; }
      var w = tipNode.offsetWidth, h = tipNode.offsetHeight;
      if (x + w > window.innerWidth - 8) x = Math.max(8, x - w - 28);
      if (y + h > window.innerHeight - 8) y = Math.max(8, y - h - 28);
      tipNode.style.left = x + 'px'; tipNode.style.top = y + 'px';
    },
    hide: function () { if (tipNode) tipNode.hidden = true; },
  };
  function hover(node, build) {
    node.addEventListener('pointermove', function (e) { tip.show(e, build()); });
    node.addEventListener('pointerleave', tip.hide);
    node.addEventListener('focus', function () { tip.show(node, build()); });
    node.addEventListener('blur', tip.hide);
  }

  /* ---- typed question / answer cards ---- */
  function sig(id, q) { return el('div', { class: 'sig' }, [el('span', { text: id }), el('span', { class: 'sig-type', text: ': ' + q.signature })]); }

  function questionCard(id, q) {
    var kids = [sig(id, q), el('div', { class: 'q-text', text: q.instructions })];
    if (q.type === 'choice') {
      var dl = el('dl', { class: 'q-criteria' });
      Object.keys(q.criteria).forEach(function (k) { add(dl, [el('dt', { text: k }), el('dd', { text: q.criteria[k] || '' })]); });
      kids.push(dl);
    } else if (q.type === 'score') {
      var dl2 = el('dl', { class: 'q-criteria' });
      q.criteria.forEach(function (d, i) { add(dl2, [el('dt', { text: String(i) }), el('dd', { text: d })]); });
      kids.push(dl2);
    }
    return el('div', { class: 'q', data: { qid: id }, tabindex: '0' }, kids);
  }

  function choiceBars(q, a, color) {
    var box = el('div', { class: 'bars' });
    Object.keys(q.criteria).forEach(function (k) {
      var p = a.probabilities[k] || 0, top = k === a.label;
      var fill = el('div', { class: 'fill' + (top ? ' top' : ''), style: { width: (p * 100).toFixed(1) + '%' } });
      if (top && color) fill.style.background = color;
      var row = [el('span', { class: 'name' + (top ? ' top' : ''), text: k }), el('div', { class: 'track' }, fill), el('span', { class: 'val', text: fmt.p(p) })];
      row.forEach(function (n) { hover(n, function () { return [el('b', { text: k + '  ' + fmt.p(p) }), el('span', { text: q.criteria[k] || '' })]; }); });
      add(box, row);
    });
    return box;
  }

  function scoreScale(q, a, color) {
    var n = q.criteria.length, cols = el('div', { class: 'scale-cols', style: { 'grid-template-columns': 'repeat(' + n + ', minmax(0, 1fr))' } });
    var tk = el('div', { class: 'scale-ticks', style: { 'grid-template-columns': 'repeat(' + n + ', minmax(0, 1fr))' } });
    q.criteria.forEach(function (d, i) {
      var p = a.probabilities[String(i)] || 0, top = i === a.level;
      var c = el('div', { class: 'scale-col' + (top ? ' top' : ''), style: { height: Math.max(p * 100, p > 0 ? 3 : 0).toFixed(1) + '%' } });
      if (top && color) c.style.background = color;
      var cell = el('div', { style: { height: '100%', display: 'flex', 'align-items': 'flex-end' } }, c); c.style.width = '100%';
      hover(cell, function () { return [el('b', { text: 'level ' + i + '  ' + fmt.p(p) }), el('span', { text: d })]; });
      cols.appendChild(cell); tk.appendChild(el('span', { text: String(i) }));
    });
    var mean = el('div', { class: 'scale-mean', text: 'mean ' + Number(a.value).toFixed(2), style: { left: (((a.value + 0.5) / n) * 100).toFixed(2) + '%' } });
    return el('div', { class: 'scale' }, [mean, cols, tk]);
  }

  function noulTrack(a, color) {
    var dot = el('div', { class: 'noul-dot', style: { left: (a.p * 100).toFixed(1) + '%' } }); if (color) dot.style.background = color;
    return el('div', { class: 'noul' }, [el('span', { text: 'no  0' }), el('div', { class: 'noul-track' }, dot), el('span', { text: '1  yes' })]);
  }

  /** One answer card. Works for either engine: draws distributions when they exist, a bare label when they do not. */
  function answerCard(id, q, a, opts) {
    opts = opts || {};
    var card = el('div', { class: 'a', data: { qid: id } });
    if (!a) return add(card, [sig(id, q), el('div', { class: 'a-empty', text: opts.pending ? 'Waiting for the answer.' : 'No answer yet.' })]);
    var value = a.type === 'score' ? a.level + '  ' + (q.criteria[a.level] || '') : a.type === 'noul' ? a.label + (a.p != null ? '  (p = ' + fmt.p(a.p) + ')' : '') : a.label;
    var conf = a.confidence != null ? 'confidence ' + fmt.p(a.confidence) + (a.confidenceKind === 'self_reported' ? ' (self-reported)' : '') : a.type === 'noul' && a.p != null ? 'the probability is the answer' : '';
    add(card, [el('div', { class: 'a-head' }, [sig(id, q), el('span', { class: 'a-conf', text: conf })]), el('div', { class: 'a-value', text: value })]);
    if (a.probabilities && a.type === 'choice') card.appendChild(choiceBars(q, a, opts.color));
    else if (a.probabilities && a.type === 'score') card.appendChild(scoreScale(q, a, opts.color));
    else if (a.type === 'noul' && a.p != null) card.appendChild(noulTrack(a, opts.color));
    else card.appendChild(el('div', { class: 'a-empty', text: 'A label only. This engine returns no probabilities.' }));
    return card;
  }

  function linkCards(root) {
    function set(qid, on) { root.querySelectorAll('[data-qid="' + qid + '"]').forEach(function (n) { n.classList.toggle('is-linked', on); }); }
    root.querySelectorAll('[data-qid]').forEach(function (n) {
      n.addEventListener('pointerenter', function () { set(n.dataset.qid, true); }); n.addEventListener('pointerleave', function () { set(n.dataset.qid, false); });
      n.addEventListener('focusin', function () { set(n.dataset.qid, true); }); n.addEventListener('focusout', function () { set(n.dataset.qid, false); });
    });
  }

  function renderJson(pre, obj) {
    clear(pre);
    if (obj === null || obj === undefined) { pre.textContent = 'Not available.'; return; }
    var text = JSON.stringify(obj, null, 2), re = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/g, last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) pre.appendChild(document.createTextNode(text.slice(last, m.index)));
      if (m[1]) { pre.appendChild(el('span', { class: m[2] ? 'k' : 's', text: m[1] })); if (m[2]) pre.appendChild(document.createTextNode(m[2])); }
      else pre.appendChild(el('span', { class: 'n', text: m[3] }));
      last = re.lastIndex;
    }
    pre.appendChild(document.createTextNode(text.slice(last)));
  }

  function mark(ok, yes, no) {
    if (ok === null || ok === undefined) return el('span', { class: 'mark na', text: '–' });
    return el('span', { class: 'mark ' + (ok ? 'ok' : 'no') }, [ok ? '✓' : '✕', ' ', ok ? yes || 'agree' : no || 'differ']);
  }

  /* ---- charts: drawn at the container's real width so text stays readable on a phone ---- */
  function onResize(node, draw) {
    var last = 0; function go() { var w = node.clientWidth; if (w && Math.abs(w - last) > 4) { last = w; draw(w); } }
    if (window.ResizeObserver) new ResizeObserver(go).observe(node); else window.addEventListener('resize', go);
    go();
  }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  /** Dot strips: one row per lane, shared x axis in ms. rows: [{name, model, color, samples:[ms]}] */
  function stripPlot(container, rows) {
    clear(container);
    var all = []; rows.forEach(function (r) { all = all.concat(r.samples); });
    if (!all.length) { container.appendChild(el('p', { class: 'a-empty', text: 'No samples yet.' })); return; }
    var max = niceMax(stats.max(all) * 1.05);
    rows.forEach(function (r, idx) {
      var host = el('div', { class: 'chart' });
      container.appendChild(el('div', { class: 'strip-row' }, [el('div', { class: 'lane-name' }, [r.name, el('span', { class: 'lane-model', text: r.samples.length + ' samples, median ' + fmt.ms(stats.median(r.samples)) })]), host]));
      var isLast = idx === rows.length - 1;
      onResize(host, function (w) {
        clear(host); var h = isLast ? 50 : 30, padR = 8, x = function (v) { return (v / max) * (w - padR); };
        var s = svg('svg', { width: w, height: h, viewBox: '0 0 ' + w + ' ' + h, role: 'img', 'aria-label': r.name + ': ' + r.samples.map(function (v) { return Math.round(v) + ' ms'; }).join(', ') });
        s.appendChild(svg('line', { class: 'ax', x1: 0, x2: w - padR, y1: 15, y2: 15 }));
        var med = stats.median(r.samples); s.appendChild(svg('line', { x1: x(med), x2: x(med), y1: 4, y2: 26, stroke: cssVar('--ink'), 'stroke-width': 2 }));
        r.samples.forEach(function (v) {
          var g = svg('g', { tabindex: '0' }, [svg('circle', { cx: x(v), cy: 15, r: 12, fill: 'transparent' }), svg('circle', { cx: x(v), cy: 15, r: 5, fill: r.color, stroke: cssVar('--surface'), 'stroke-width': 2 })]);
          hover(g, function () { return [el('b', { text: fmt.ms(v) }), el('span', { text: r.name })]; }); s.appendChild(g);
        });
        if (isLast) ticks(max, w < 420 ? 2 : 4).forEach(function (t, i, arr) { s.appendChild(svg('text', { x: x(t), y: 44, 'text-anchor': i === 0 ? 'start' : i === arr.length - 1 ? 'end' : 'middle', text: fmt.ms(t) })); });
        host.appendChild(s);
      });
    });
  }

  /** Line chart. series: [{name, color, points:[{x, samples:[ms]}]}]. One y axis, from zero. */
  function lineChart(container, series, opts) {
    onResize(container, function (w) {
      clear(container);
      var narrow = w < 520, m = { l: 56, r: narrow ? 14 : 150, t: 14, b: 40 }, h = narrow ? 250 : 300, iw = w - m.l - m.r, ih = h - m.t - m.b;
      var xs = series[0].points.map(function (p) { return p.x; }), xmax = stats.max(xs), all = [];
      series.forEach(function (s) { s.points.forEach(function (p) { all = all.concat(p.samples); }); });
      // Scale to the medians. A few slow samples would otherwise flatten every line, so they are pinned to the top edge and labelled.
      var meds = []; series.forEach(function (s) { s.points.forEach(function (p) { meds.push(stats.median(p.samples)); }); });
      var ymax = niceMax(Math.min(stats.max(all) * 1.02, stats.max(meds) * 1.6)), X = function (v) { return m.l + (v / xmax) * iw; }, Y = function (v) { return m.t + ih - (v / ymax) * ih; };
      var s = svg('svg', { width: w, height: h, viewBox: '0 0 ' + w + ' ' + h, role: 'img', tabindex: '0', 'aria-label': opts.label });
      ticks(ymax, 4).forEach(function (t) { s.appendChild(svg('line', { class: t === 0 ? 'ax' : 'grid', x1: m.l, x2: m.l + iw, y1: Y(t), y2: Y(t) })); s.appendChild(svg('text', { x: m.l - 8, y: Y(t) + 4, 'text-anchor': 'end', text: fmt.ms(t) })); });
      xs.forEach(function (v) { s.appendChild(svg('text', { x: X(v), y: h - m.b + 18, 'text-anchor': 'middle', text: String(v) })); });
      s.appendChild(svg('text', { class: 'lbl', x: m.l + iw / 2, y: h - 4, 'text-anchor': 'middle', text: opts.xLabel }));
      var ends = [], clipped = {};
      series.forEach(function (sr) {
        sr.points.forEach(function (p) {
          var over = [];
          p.samples.forEach(function (v) { if (v > ymax) over.push(v); else s.appendChild(svg('circle', { cx: X(p.x), cy: Y(v), r: 2.5, fill: sr.color, opacity: 0.32 })); });
          if (over.length) { var slot = (clipped[p.x] = (clipped[p.x] || 0) + 1) - 1, ty = m.t + 2 + slot * 13, tx = X(p.x);
            s.appendChild(svg('path', { d: 'M' + (tx - 4) + ' ' + (ty + 7) + ' L' + tx + ' ' + ty + ' L' + (tx + 4) + ' ' + (ty + 7) + ' Z', fill: sr.color }));
            var right = tx + 90 < m.l + iw; s.appendChild(svg('text', { x: right ? tx + 8 : tx - 8, y: ty + 8, 'text-anchor': right ? 'start' : 'end', text: over.map(fmt.s).join(', ') })); }
        });
        var pts = sr.points.map(function (p) { return [X(p.x), Y(stats.median(p.samples))]; });
        s.appendChild(svg('polyline', { points: pts.map(function (p) { return p.join(','); }).join(' '), fill: 'none', stroke: sr.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
        pts.forEach(function (p) { s.appendChild(svg('circle', { cx: p[0], cy: p[1], r: 4.5, fill: sr.color, stroke: cssVar('--surface'), 'stroke-width': 2 })); });
        ends.push({ y: pts[pts.length - 1][1], at: pts[pts.length - 1][1], name: sr.short || sr.name, val: stats.median(sr.points[sr.points.length - 1].samples) });
      });
      if (!narrow) { // direct end labels; if two would collide, move them apart and draw a leader line
        ends.sort(function (a, b) { return a.y - b.y; });
        for (var i = 1; i < ends.length; i++) if (ends[i].at - ends[i - 1].at < 28) ends[i].at = ends[i - 1].at + 28;
        var over = ends.length ? ends[ends.length - 1].at - (h - m.b) : 0; if (over > 0) ends.forEach(function (e) { e.at -= over; });
        ends.forEach(function (e) {
          var x0 = m.l + iw + 8; if (Math.abs(e.at - e.y) > 2) s.appendChild(svg('line', { class: 'ax', x1: x0 - 2, x2: x0 + 8, y1: e.y, y2: e.at }));
          s.appendChild(svg('text', { class: 'lbl', x: x0 + 12, y: e.at - 1, text: e.name })); s.appendChild(svg('text', { x: x0 + 12, y: e.at + 12, text: fmt.ms(e.val) }));
        });
      }
      var xh = svg('line', { class: 'xh', y1: m.t, y2: m.t + ih, visibility: 'hidden' }); s.appendChild(xh);
      var cur = -1;
      function at(i, anchor) {
        cur = i; var xv = xs[i]; xh.setAttribute('x1', X(xv)); xh.setAttribute('x2', X(xv)); xh.setAttribute('visibility', 'visible');
        var rows = [el('b', { text: xv + (xv === 1 ? ' question' : ' questions') })];
        series.forEach(function (sr) { var i2 = el('i'); i2.style.borderTopColor = sr.color; rows.push(el('div', { class: 'r' }, [el('span', {}, [i2, sr.name]), el('b', { text: fmt.ms(stats.median(sr.points[i].samples)) })])); });
        tip.show(anchor, rows);
      }
      function off() { xh.setAttribute('visibility', 'hidden'); tip.hide(); }
      var hit = svg('rect', { x: m.l - 10, y: m.t, width: iw + 20, height: ih, fill: 'transparent' });
      hit.addEventListener('pointermove', function (e) { var r = s.getBoundingClientRect(), px = e.clientX - r.left, best = 0; xs.forEach(function (v, i) { if (Math.abs(X(v) - px) < Math.abs(X(xs[best]) - px)) best = i; }); at(best, e); });
      hit.addEventListener('pointerleave', off); s.appendChild(hit);
      s.addEventListener('keydown', function (e) { if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return; e.preventDefault(); at(Math.max(0, Math.min(xs.length - 1, cur + (e.key === 'ArrowRight' ? 1 : -1))), s); });
      s.addEventListener('blur', off);
      container.appendChild(s);
    });
  }

  /** Confidence strip for the gating act. items: [{id,title,confidence,kind:'right'|'wrong'|'open',answer,expected}] */
  function confidenceStrip(container, items, state, color, onHot) {
    onResize(container, function (w) { draw(w); });
    function draw(w) {
      clear(container); w = w || container.clientWidth; if (!w) return;
      var m = { l: 10, r: 10, t: 22, b: 26 }, iw = w - m.l - m.r, X = function (v) { return m.l + v * iw; };
      // dodge: stack dots that would overlap
      var placed = [], sorted = items.filter(function (i) { return i.confidence != null; }).sort(function (a, b) { return a.confidence - b.confidence; });
      sorted.forEach(function (it) { var x = X(it.confidence), lvl = 0; while (placed.some(function (p) { return p.lvl === lvl && Math.abs(p.x - x) < 15; })) lvl++; placed.push({ x: x, lvl: lvl, it: it }); });
      var levels = placed.reduce(function (mx, p) { return Math.max(mx, p.lvl); }, 0) + 1, ih = Math.max(44, levels * 16 + 10), h = m.t + ih + m.b, base = m.t + ih - 10;
      var s = svg('svg', { width: w, height: h, viewBox: '0 0 ' + w + ' ' + h, role: 'img', 'aria-label': 'Tickets placed by confidence, with zones for escalate, confirm and act alone' });
      var lo = state.escalateBelow, hi = Math.max(state.actAbove, lo);
      [[0, lo, '--zone-escalate', 'escalate'], [lo, hi, '--zone-confirm', 'confirm'], [hi, 1, '--zone-act', 'act alone']].forEach(function (z) {
        if (z[1] - z[0] <= 0) return;
        s.appendChild(svg('rect', { x: X(z[0]), y: m.t, width: X(z[1]) - X(z[0]), height: ih, fill: cssVar(z[2]) }));
        var zw = X(z[1]) - X(z[0]); if (zw > 26) s.appendChild(svg('text', { class: 'lbl', x: (X(z[0]) + X(z[1])) / 2, y: 13, 'text-anchor': 'middle', text: zw > 62 ? z[3] : z[3].split(' ')[0] }));
      });
      [lo, hi].forEach(function (t) { s.appendChild(svg('line', { x1: X(t), x2: X(t), y1: m.t - 4, y2: m.t + ih, stroke: cssVar('--ink'), 'stroke-width': 1.5 })); });
      s.appendChild(svg('line', { class: 'ax', x1: m.l, x2: m.l + iw, y1: m.t + ih, y2: m.t + ih }));
      [0, 0.25, 0.5, 0.75, 1].forEach(function (t, i, a) { s.appendChild(svg('text', { x: X(t), y: h - 8, 'text-anchor': i === 0 ? 'start' : i === a.length - 1 ? 'end' : 'middle', text: t.toFixed(2) })); });
      placed.forEach(function (p) {
        var cy = base - p.lvl * 16, it = p.it, g = svg('g', { tabindex: '0' }); g.appendChild(svg('circle', { cx: p.x, cy: cy, r: 12, fill: 'transparent' }));
        if (it.kind === 'wrong') { var c = cssVar('--crit'); g.appendChild(svg('circle', { cx: p.x, cy: cy, r: 7, fill: cssVar('--surface') })); [[-4, -4, 4, 4], [-4, 4, 4, -4]].forEach(function (l) { g.appendChild(svg('line', { x1: p.x + l[0], y1: cy + l[1], x2: p.x + l[2], y2: cy + l[3], stroke: c, 'stroke-width': 2.5, 'stroke-linecap': 'round' })); }); }
        else if (it.kind === 'open') g.appendChild(svg('rect', { x: p.x - 4.5, y: cy - 4.5, width: 9, height: 9, fill: cssVar('--surface'), stroke: color, 'stroke-width': 2, transform: 'rotate(45 ' + p.x + ' ' + cy + ')' }));
        else g.appendChild(svg('circle', { cx: p.x, cy: cy, r: 5.5, fill: color, stroke: cssVar('--surface'), 'stroke-width': 2 }));
        var build = function () { return [el('b', { text: fmt.p(it.confidence) + '  ' + it.answer }), el('span', { text: it.title + '. ' + (it.kind === 'open' ? 'Needed a person by design.' : 'Author label: ' + it.expected + '.') })]; };
        g.addEventListener('pointermove', function (e) { tip.show(e, build()); onHot(it.id, true); }); g.addEventListener('pointerleave', function () { tip.hide(); onHot(it.id, false); });
        g.addEventListener('focus', function () { tip.show(g, build()); onHot(it.id, true); }); g.addEventListener('blur', function () { tip.hide(); onHot(it.id, false); });
        s.appendChild(g);
      });
      container.appendChild(s);
    }
    return { redraw: function () { draw(); } };
  }

  J.viz = { el: el, svg: svg, add: add, clear: clear, fmt: fmt, stats: stats, niceMax: niceMax, ticks: ticks, tip: tip, hover: hover, reduceMotion: reduceMotion, cssVar: cssVar,
    questionCard: questionCard, answerCard: answerCard, linkCards: linkCards, renderJson: renderJson, mark: mark, stripPlot: stripPlot, lineChart: lineChart, confidenceStrip: confidenceStrip };
})();
