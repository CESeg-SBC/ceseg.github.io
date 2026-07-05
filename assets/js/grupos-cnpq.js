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

  // Accent-insensitive stopwords (Portuguese + English) dropped from the cloud.
  var STOP = {};
  ('de da do das dos e em a o as os para por com na no nas nos um uma que ao aos se ' +
   'sua seu suas seus ou entre sobre como sem sob ate até mais menos ' +
   'of the and in for to on with a an by from at as ' +
   'pesquisa grupo grupos linha linhas area areas estudo estudos tema temas').split(' ')
    .forEach(function (w) { STOP[fold(w)] = true; });

  var GROUPS = [];
  var query = '';       // folded search string
  var activeWord = '';  // currently selected cloud term (folded), '' if none
  var els = {};

  /* Tokenise a research line into meaningful terms (>=3 chars, not stopwords,
     not purely numeric). Returns folded tokens. */
  function terms(line) {
    return fold(line).split(/[^a-z0-9à-ÿ]+/)
      .filter(function (w) { return w.length >= 3 && !STOP[w] && !/^\d+$/.test(w); });
  }

  function precompute() {
    GROUPS.forEach(function (g) {
      var parts = [g.name, g.institution, g.state,
        (g.members || []).join(' '), (g.lines || []).join(' ')];
      g._hay = fold(parts.join(' '));
      // Distinct folded terms for this group (document-frequency counting).
      var seen = {};
      (g.lines || []).forEach(function (l) {
        terms(l).forEach(function (w) { seen[w] = true; });
      });
      g._terms = seen;
    });
  }

  /* Build the word cloud: count in how many groups each term appears, take the
     most common, and map their frequency to five size buckets. */
  function buildCloud() {
    if (!els.cloud) return;
    var freq = {};
    GROUPS.forEach(function (g) {
      Object.keys(g._terms).forEach(function (w) { freq[w] = (freq[w] || 0) + 1; });
    });
    var words = Object.keys(freq)
      .filter(function (w) { return freq[w] >= 2; })
      .sort(function (a, b) { return freq[b] - freq[a] || a.localeCompare(b); })
      .slice(0, 80);
    if (!words.length) { els.cloud.innerHTML = ''; return; }
    var max = freq[words[0]], min = freq[words[words.length - 1]];
    var span = Math.max(1, max - min);
    // A representative (accent-preserving) label for each folded term.
    var labelOf = {};
    GROUPS.forEach(function (g) {
      (g.lines || []).forEach(function (l) {
        l.split(/[^A-Za-z0-9À-ſ]+/).forEach(function (raw) {
          var f = fold(raw);
          if (freq[f] && !labelOf[f]) labelOf[f] = raw;
        });
      });
    });
    els.cloud.innerHTML = words.map(function (w) {
      var bucket = 1 + Math.round(((freq[w] - min) / span) * 4); // 1..5
      var label = labelOf[w] || w;
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
