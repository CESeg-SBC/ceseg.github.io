/* grupos-cnpq.js
   Dedicated page for CNPq research groups and their research lines.
   Loads assets/data/cybersecmap.json (same snapshot the community map uses) and
   renders, from its `cnpq_group` records:
     - a word cloud built from the research-line terms (sized by how many groups
       each term appears in), where clicking a term filters the list;
     - a text search over group name, institution, state, coordinators (members)
       and research lines;
     - a card list of the matching groups.
   Kept independent of mapa.js so the page works without Leaflet. */
(function () {
  'use strict';

  // i18n helper: use site.js's exposed lookup when the dictionary is loaded, else fallback.
  function tr(key, fallback) {
    var fn = window.cesegI18n && window.cesegI18n.t;
    var v = fn ? fn(key) : null;
    return (v == null) ? fallback : v;
  }
  function fold(s) {
    return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }
  function esc(s) {
    return (s || '').replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // Words dropped when they land at the start/end of a phrase (connectors and
  // prepositions are kept INSIDE phrases, e.g. "rede sem fio", "redes de sensores").
  var STOP_EDGE = {};
  ('de da do das dos e em a o as os para por com na no nas nos um uma que ao aos se ' +
   'ou entre sobre como sem sob ate at\u00e9 mais menos of the and in for to on with by from at as')
    .split(' ').forEach(function (w) { STOP_EDGE[fold(w)] = true; });
  // Fragments that are meaningless on their own (mostly orphaned adjectives left
  // over when a comma-separated list is split); never shown as cloud terms.
  var WEAK = {};
  ('fio moveis movel gerais legais organizacionais regulatorios aplicada aplicado aplicados ' +
   'aplicadas outros outras demais novos novas geral humanos distribuida distribuido segura seguros')
    .split(' ').forEach(function (w) { WEAK[fold(w)] = true; });

  var GROUPS = [];
  var LABELS = {};      // folded phrase key -> best display label
  var LABEL_CT = {};    // folded key -> { variantLabel: count } for picking best display
  var query = '';       // folded search string
  var activeWord = '';  // currently selected cloud term (folded), '' if none
  var els = {};

  // Capitalise the first letter only when the label is entirely lowercase.
  function cap(s) {
    return /[A-Z\u00c0-\u00de]/.test(s) ? s : s.charAt(0).toUpperCase() + s.slice(1);
  }

  // Among label variants that fold to the same phrase, prefer the richest one:
  // most accented letters (impeccable Portuguese), then most capitalised words,
  // then the most frequent variant.
  // Turn a stray ALL-CAPS word (>=5 letters) into Title case, leaving short
  // acronyms (IoT, RAN, O-RAN, 5G) untouched.
  function normalizeCaps(label) {
    return label.split(' ').map(function (w) {
      return /^[A-Z\u00c0-\u00de]{5,}$/.test(w)
        ? w.charAt(0) + w.slice(1).toLowerCase() : w;
    }).join(' ');
  }

  function bestLabel(counts) {
    var best = null, bestScore = -1;
    Object.keys(counts).forEach(function (lab) {
      var acc = (lab.match(/[\u00c0-\u024f]/g) || []).length;      // accented letters
      var titled = (lab.match(/(^|\s)[A-Z\u00c0-\u00de][a-z\u00df-\u00ff]/g) || []).length; // Title Case words
      var score = acc * 1e6 + titled * 1e3 + counts[lab];
      if (score > bestScore) { bestScore = score; best = lab; }
    });
    return normalizeCaps(best);
  }

  /* Break a research line into meaningful concept phrases. Splits only on strong
     separators (comma, semicolon, slash, " e ", " ou ") so multi-word terms stay
     intact; drops parentheticals and edge stopwords. Returns [{key, label}]. */
  function phrases(line) {
    var out = [];
    line.split(/,|;|\/| e | ou /).forEach(function (seg) {
      seg = seg.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ')
        .replace(/^[\s\-\u2013\u2014:.]+|[\s\-\u2013\u2014:.]+$/g, '');
      var w = seg.split(' ');
      while (w.length && STOP_EDGE[fold(w[0])]) w.shift();
      while (w.length && STOP_EDGE[fold(w[w.length - 1])]) w.pop();
      var label = w.join(' ');
      var key = fold(label);
      if (key.length < 4 || WEAK[key]) return;
      if (w.length === 1 && key.length < 5) return; // drop short lone words
      out.push({ key: key, label: cap(label) });
    });
    return out;
  }

  function precompute() {
    LABELS = {}; LABEL_CT = {};
    GROUPS.forEach(function (g) {
      var parts = [g.name, g.institution, g.state,
        (g.members || []).join(' '), (g.lines || []).join(' ')];
      g._hay = fold(parts.join(' '));
      // Distinct phrase keys for this group (document-frequency counting).
      var seen = {};
      (g.lines || []).forEach(function (l) {
        phrases(l).forEach(function (pp) {
          seen[pp.key] = true;
          var ct = LABEL_CT[pp.key] || (LABEL_CT[pp.key] = {});
          ct[pp.label] = (ct[pp.label] || 0) + 1;
        });
      });
      g._terms = seen;
    });
    Object.keys(LABEL_CT).forEach(function (k) { LABELS[k] = bestLabel(LABEL_CT[k]); });
  }

  /* Build the cloud: count in how many groups each phrase appears, take the most
     common, and map their frequency to five size buckets. */
  function buildCloud() {
    if (!els.cloud) return;
    var freq = {};
    GROUPS.forEach(function (g) {
      Object.keys(g._terms).forEach(function (w) { freq[w] = (freq[w] || 0) + 1; });
    });
    var words = Object.keys(freq)
      .filter(function (w) { return freq[w] >= 2; })
      .sort(function (a, b) { return freq[b] - freq[a] || a.localeCompare(b); })
      .slice(0, 70);
    if (!words.length) { els.cloud.innerHTML = ''; return; }
    var max = freq[words[0]], min = freq[words[words.length - 1]];
    var span = Math.max(1, max - min);
    els.cloud.innerHTML = words.map(function (w) {
      var bucket = 1 + Math.round(((freq[w] - min) / span) * 4); // 1..5
      var label = LABELS[w] || w;
      return '<button type="button" class="wc-word wc-s' + bucket +
        (w === activeWord ? ' active' : '') +
        '" data-term="' + esc(w) + '" title="' + freq[w] + '">' + esc(label) + '</button>';
    }).join('');
  }

  function cardHTML(g) {
    var links = g.links || {};
    var lnk = [];
    if (links.group) lnk.push('<a href="' + esc(links.group) + '" target="_blank" rel="noopener">CNPq</a>');
    if (links.url) lnk.push('<a href="' + esc(links.url) + '" target="_blank" rel="noopener">' + esc(tr('map.groupSite', 'website')) + '</a>');
    var meta = [g.institution, g.state].filter(Boolean).join(' · ');
    var lines = (g.lines || []).map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('');
    var members = (g.members && g.members.length)
      ? '<p class="cnpq-g-members"><b>' + esc(tr('gcnpq.coordinators', 'Coordination')) + ':</b> ' + esc(g.members.join('; ')) + '</p>'
      : '';
    return '<article class="cnpq-g">'
      + '<h3>' + esc(g.name) + (lnk.length ? ' <span class="cnpq-g-links">' + lnk.join(' · ') + '</span>' : '') + '</h3>'
      + (meta ? '<p class="cnpq-g-meta">' + esc(meta) + '</p>' : '')
      + members
      + (lines ? '<ul class="cnpq-g-lines">' + lines + '</ul>' : '')
      + '</article>';
  }

  function matches(g) {
    if (query && g._hay.indexOf(query) === -1) return false;
    if (activeWord && !g._terms[activeWord]) return false;
    return true;
  }

  function render() {
    var visible = GROUPS.filter(matches);
    els.list.innerHTML = visible.map(cardHTML).join('');
    els.visible.textContent = visible.length;
    els.total.textContent = GROUPS.length;
    els.empty.hidden = visible.length !== 0;
  }

  function setQuery(v) {
    query = fold(v);
    if (els.search.value !== v) els.search.value = v;
    render();
  }

  function toggleWord(w) {
    activeWord = (activeWord === w) ? '' : w;
    els.cloud.querySelectorAll('.wc-word').forEach(function (b) {
      b.classList.toggle('active', b.dataset.term === activeWord);
    });
    render();
  }

  function wire() {
    var timer;
    els.search.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { query = fold(els.search.value); render(); }, 120);
    });
    els.clear.addEventListener('click', function () {
      activeWord = '';
      els.cloud.querySelectorAll('.wc-word.active').forEach(function (b) { b.classList.remove('active'); });
      setQuery('');
      els.search.focus();
    });
    els.cloud.addEventListener('click', function (e) {
      var b = e.target.closest('.wc-word'); if (!b) return;
      // site.js has a document-level .wc-word handler that navigates to the SBSeg
      // proceedings; stop the click here so this page filters in place instead.
      e.stopPropagation();
      toggleWord(b.dataset.term);
    });
  }

  function boot() {
    els = {
      cloud: document.getElementById('gcnpqCloud'),
      search: document.getElementById('gcnpqSearch'),
      clear: document.getElementById('gcnpqClear'),
      list: document.getElementById('gcnpqList'),
      empty: document.getElementById('gcnpqEmpty'),
      visible: document.getElementById('gcnpqVisible'),
      total: document.getElementById('gcnpqTotal')
    };
    if (!els.list) return;
    fetch('assets/data/cybersecmap.json', { cache: 'no-cache' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        GROUPS = (d.records || []).filter(function (r) { return r.type === 'cnpq_group'; })
          .slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'pt'); });
        precompute();
        buildCloud();
        wire();
        render();
        // Re-render dynamic labels when the language changes.
        document.addEventListener('i18n:applied', function () { buildCloud(); render(); });
      })
      .catch(function () {
        els.list.innerHTML = '<p class="cm-list-empty">' +
          esc(tr('gcnpq.loadError', 'Could not load the research-group data.')) + '</p>';
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
