/* Cybersecurity Map page.
   Loads assets/data/cybersecmap.json (snapshot of cybersecmap.rnp.br) and renders
   a single search + filter + Leaflet map view that replaces the source's many
   cascading menus. Self-initializes only when #cybermap is present, so it is inert
   on every other page that also loads site.js. */
(function () {
  var root = document.getElementById('cybermap');
  if (!root) return;

  // Type metadata: marker color + i18n label key (with English fallback).
  var TYPES = {
    researcher:    { color: '#2563eb', key: 'map.typeResearcher',   def: 'Researchers' },
    group:         { color: '#16a34a', key: 'map.typeGroup',        def: 'Research Groups' },
    cnpq_group:    { color: '#0284c7', key: 'map.typeCnpqGroup',    def: 'CNPq Groups' },
    program:       { color: '#9333ea', key: 'map.typeProgram',      def: 'Graduate Programs' },
    publication:   { color: '#64748b', key: 'map.typePublication',  def: 'Publications' }
  };
  // Cluster entity types (publication is now an aggregated overlay, not a cluster type).
  var TYPE_ORDER = ['researcher', 'group', 'cnpq_group', 'program'];
  // Ordered two-row filter strip: type chips filter the cluster; overlay chips
  // toggle their own Leaflet layer. Rendered four-per-row by CSS.
  var TOOL_COLOR = '#c026d3';
  var WTICG_COLOR = '#ea580c';
  var CHIP_ORDER = [
    { kind: 'overlay', layer: 'pubs',  labelKey: 'map.typePublication',  def: 'Publications',     color: TYPES.publication.color },
    { kind: 'overlay', layer: 'sbseg', labelKey: 'map.sbsegToggle',      def: 'SBSeg editions',   color: '#1e3a5f' },
    { kind: 'overlay', layer: 'wticg', labelKey: 'map.wticgToggle',      def: 'WTICG',            color: WTICG_COLOR },
    { kind: 'type',    type: 'researcher',    labelKey: 'map.typeResearcher',   def: 'Researchers',      color: TYPES.researcher.color },
    { kind: 'type',    type: 'group',         labelKey: 'map.typeGroup',        def: 'Research Groups',  color: TYPES.group.color },
    { kind: 'type',    type: 'cnpq_group',    labelKey: 'map.typeCnpqGroup',    def: 'CNPq Groups',      color: TYPES.cnpq_group.color },
    { kind: 'type',    type: 'program',       labelKey: 'map.typeProgram',      def: 'Graduate Programs',color: TYPES.program.color },
    { kind: 'overlay', layer: 'tools', labelKey: 'map.typeTool',         def: 'Tools',            color: TOOL_COLOR }
  ];
  var LIST_CAP = 400; // cap rendered cards; the map still shows every match.

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
  // Render a free-text field that may embed a URL as clickable HTML. When the
  // text is "Label (https://url)" the label itself becomes the link; otherwise
  // any inline URL is linkified. Every non-URL segment is escaped (XSS-safe).
  function linkify(text) {
    text = text || '';
    var wrap = text.match(/^(.*\S)\s*\((https?:\/\/[^\s()]+)\)\s*$/);
    if (wrap) {
      return '<a href="' + esc(wrap[2]) + '" target="_blank" rel="noopener">' +
        esc(wrap[1]) + '</a>';
    }
    var out = '', last = 0, re = /https?:\/\/[^\s)]+/g, m;
    while ((m = re.exec(text))) {
      out += esc(text.slice(last, m.index)) +
        '<a href="' + esc(m[0]) + '" target="_blank" rel="noopener">' + esc(m[0]) + '</a>';
      last = m.index + m[0].length;
    }
    return out + esc(text.slice(last));
  }

  var DATA = null, RECORDS = [], MARKERS = {}, map, cluster;
  var STATS = null, pubsLayer = null, toolsLayer = null;
  var WTICG = null, wticgLayer = null;
  // Cluster entity types, all active by default. Publications and tools are not
  // cluster types: they are aggregated per-institution overlays (see overlayOn).
  var activeTypes = { researcher: true, group: true, cnpq_group: true, program: true };
  // Overlay layers: all on by default.
  var overlayOn = { pubs: true, sbseg: true, tools: true, wticg: false };
  var selState = '', selTopic = '', selLine = '', query = '';
  var els = {};

  function typeLabel(type) { return tr(TYPES[type].key, TYPES[type].def); }

  function buildMap() {
    map = L.map(root, { scrollWheelZoom: true, worldCopyJump: true })
      .setView([-14.6, -52.0], 4);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 19, subdomains: 'abcd'
    }).addTo(map);
    cluster = L.markerClusterGroup({ maxClusterRadius: 50, chunkedLoading: true });
    map.addLayer(cluster);
  }

  function icon(type) {
    return L.divIcon({
      className: 'cm-pin',
      html: '<span style="background:' + TYPES[type].color + '"></span>',
      iconSize: [18, 18], iconAnchor: [9, 9], popupAnchor: [0, -8]
    });
  }

  function buildMarkers() {
    RECORDS.forEach(function (r) {
      if (!TYPES[r.type] || r.type === 'publication') return; // unknown/removed types and aggregated pubs
      if (r.lat == null || r.lng == null) return;
      var m = L.marker([r.lat, r.lng], { icon: icon(r.type) });
      m.bindPopup(detailHTML(r), { maxWidth: 380, minWidth: 300, autoPanPadding: [24, 24] });
      m._rec = r;
      m.on('click', function () { highlightCard(r.id); });
      MARKERS[r.id] = m;
    });
  }

  // All CNPq research lines attached to a record: its own (cnpq_group records)
  // plus the lines of the researcher's groups (researcher records).
  function recordLines(r) {
    if (!r._lines) {
      var ls = (r.lines || []).slice();
      (r.groups || []).forEach(function (g) { ls = ls.concat(g.lines || []); });
      r._lines = ls;
    }
    return r._lines;
  }

  function matches(r) {
    if (!activeTypes[r.type]) return false;
    if (selState && r.state !== selState) return false;
    if (selTopic && (r.topics || []).indexOf(selTopic) === -1) return false;
    if (selLine && recordLines(r).indexOf(selLine) === -1) return false;
    if (query) {
      if (!r._hay) r._hay = fold([r.name, r.institution, r.state, r.interests,
        r.leader, r.project, r.authors, r.education,
        (r.topics || []).join(' '), recordLines(r).join(' '),
        (r.members || []).join(' '),
        (r.groups || []).map(function (g) { return g.name; }).join(' ')].join(' '));
      if (r._hay.indexOf(query) === -1) return false;
    }
    return true;
  }

  function detailHTML(r) {
    var rows = '';
    function row(labelKey, def, val, isLink) {
      if (!val) return;
      var v = isLink
        ? '<a href="' + esc(val) + '" target="_blank" rel="noopener">' + esc(val) + '</a>'
        : esc(val);
      rows += '<div class="cm-d-row"><span>' + esc(tr(labelKey, def)) + '</span><div>' + v + '</div></div>';
    }
    row('map.institution', 'Institution', r.institution);
    row('map.state', 'State', r.state);
    if (r.education) row('map.education', 'Academic background', r.education);
    if (r.interests) row('map.interests', 'Research interests', r.interests);
    if (r.leader) row('map.leader', 'Leader', r.leader);
    if (r.project) row('map.project', 'Project', r.project);
    if (r.authors) row('map.authors', 'Authors', r.authors);
    if (r.year) row('map.year', 'Year', r.year);
    if (r.topics && r.topics.length) row('map.topics', 'Topics', r.topics.join('; '));
    if (r.lines && r.lines.length) row('map.groupLines', 'Research lines', r.lines.join('; '));
    if (r.members && r.members.length) row('map.members', 'Researchers', r.members.join('; '));
    var links = r.links || {};
    if (links.lattes) row('map.lattes', 'Lattes', links.lattes, true);
    if (links.scholar) row('map.scholar', 'Google Scholar', links.scholar, true);
    // CNPq research groups: name + DGP mirror link + own website + research lines.
    (r.groups || []).forEach(function (g) {
      if (!g || !g.name) return;
      var parts = [esc(g.name)];
      if (g.role === 'líder') parts.push('<em>(' + esc(tr('map.groupLeaderRole', 'leader')) + ')</em>');
      var lnk = [];
      if (g.dgp) lnk.push('<a href="' + esc(g.dgp) + '" target="_blank" rel="noopener">CNPq</a>');
      if (g.site) lnk.push('<a href="' + esc(g.site) + '" target="_blank" rel="noopener">' + esc(tr('map.groupSite', 'website')) + '</a>');
      if (lnk.length) parts.push('· ' + lnk.join(' · '));
      var lines = (g.lines && g.lines.length)
        ? '<br><small>' + esc(tr('map.groupLines', 'Research lines')) + ': ' + esc(g.lines.join('; ')) + '</small>'
        : '';
      rows += '<div class="cm-d-row"><span>' + esc(tr('map.cnpqGroup', 'CNPq group')) + '</span><div>' +
        parts.join(' ') + lines + '</div></div>';
    });
    // Legacy single group link, kept for records without the enriched groups array.
    if (links.group && !(r.groups && r.groups.length)) row('map.researchGroup', 'Research group', links.group, true);
    if (links.program) {
      rows += '<div class="cm-d-row"><span>' + esc(tr('map.program', 'Graduate program')) +
        '</span><div>' + linkify(links.program) + '</div></div>';
    }
    if (links.url) row('map.website', 'Website', links.url, true);
    return '<div class="cm-detail">'
      + '<span class="cm-tag" style="background:' + TYPES[r.type].color + '">' + esc(typeLabel(r.type)) + '</span>'
      + '<h4>' + esc(r.name) + '</h4>' + rows + '</div>';
  }

  function cardHTML(r) {
    var sub = [r.institution, r.state].filter(Boolean).join(' · ');
    return '<button type="button" class="cm-card" data-id="' + esc(r.id) + '">'
      + '<span class="cm-dot" style="background:' + TYPES[r.type].color + '"></span>'
      + '<span class="cm-card-body"><span class="cm-card-title">' + esc(r.name) + '</span>'
      + (sub ? '<span class="cm-card-sub">' + esc(sub) + '</span>' : '')
      + '<span class="cm-card-type">' + esc(typeLabel(r.type)) + '</span></span></button>';
  }

  function render() {
    var visible = RECORDS.filter(matches);
    // Map: rebuild cluster with the matching markers.
    cluster.clearLayers();
    var layers = [];
    visible.forEach(function (r) { if (MARKERS[r.id]) layers.push(MARKERS[r.id]); });
    cluster.addLayers(layers);

    // List: render up to LIST_CAP cards.
    var shown = visible.slice(0, LIST_CAP);
    els.list.innerHTML = shown.map(cardHTML).join('') ||
      '<p class="cm-list-empty">' + esc(tr('map.noResults', 'No results found.')) + '</p>';
    if (visible.length > LIST_CAP) {
      els.list.insertAdjacentHTML('beforeend',
        '<p class="cm-list-more">' + esc(tr('map.listCap', 'Showing first 400 on the list; all matches appear on the map.')) + '</p>');
    }
    els.visible.textContent = visible.length;
    els.total.textContent = RECORDS.length;
    els.noResults.hidden = visible.length !== 0;
  }

  function highlightCard(id) {
    var card = els.list.querySelector('.cm-card[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    els.list.querySelectorAll('.cm-card.active').forEach(function (c) { c.classList.remove('active'); });
    if (card) {
      card.classList.add('active');
      card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function focusRecord(id) {
    var r = RECORDS.find(function (x) { return x.id === id; });
    var m = MARKERS[id];
    if (!r || !m) return;
    if (window.matchMedia('(max-width: 760px)').matches) setView('map');
    map.setView([r.lat, r.lng], Math.max(map.getZoom(), 9), { animate: true });
    cluster.zoomToShowLayer(m, function () { m.openPopup(); });
    highlightCard(id);
  }

  function setView(view) {
    els.grid.classList.toggle('show-map', view === 'map');
    els.grid.classList.toggle('show-list', view === 'list');
    document.querySelectorAll('.map-viewtoggle button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.view === view);
    });
    if (view === 'map' && map) setTimeout(function () { map.invalidateSize(); }, 50);
  }

  function statRadius(n) { return Math.max(6, Math.min(28, 6 + Math.sqrt(n) * 2.5)); }

  function overlayCount(name) {
    if (!STATS) return 0;
    if (name === 'pubs') return STATS.institutions.filter(function (i) { return i.pub_count > 0; }).length;
    if (name === 'tools') return STATS.institutions.filter(function (i) { return i.tool_count > 0; }).length;
    if (name === 'sbseg') return 25;
    if (name === 'wticg') return WTICG ? WTICG.total_papers : 0;
    return 0;
  }

  function statPopup(inst, kind) {
    var count = kind === 'tools' ? inst.tool_count : inst.pub_count;
    var items = kind === 'tools' ? inst.tools : inst.pubs;
    var labelKey = kind === 'tools' ? 'map.toolsCount' : 'map.pubsCount';
    var labelDef = kind === 'tools' ? 'tools (Salão de Ferramentas)' : 'publications (SBSeg)';
    var list = items.slice(0, 15).map(function (p) {
      return '<li>' + (p.url
        ? '<a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.title) + '</a>'
        : esc(p.title)) + '</li>';
    }).join('');
    var more = items.length > 15 ? '<li class="cm-more">+' + (items.length - 15) + '</li>' : '';
    var color = kind === 'tools' ? TOOL_COLOR : TYPES.publication.color;
    return '<div class="cm-detail"><span class="cm-tag" style="background:' + color + '">' +
      esc(count + ' ' + tr(labelKey, labelDef)) + '</span><h4>' + esc(inst.institution) +
      '</h4><ul class="cm-pub-list">' + list + more + '</ul></div>';
  }

  function buildStatLayers() {
    pubsLayer = L.layerGroup();
    toolsLayer = L.layerGroup();
    (STATS.institutions || []).forEach(function (inst) {
      if (inst.lat == null || inst.lng == null) return;
      if (inst.pub_count > 0) {
        L.circleMarker([inst.lat, inst.lng], {
          radius: statRadius(inst.pub_count), color: '#fff', weight: 1,
          fillColor: TYPES.publication.color, fillOpacity: 0.8
        }).bindPopup(statPopup(inst, 'pubs'), { maxWidth: 320 }).addTo(pubsLayer);
      }
      if (inst.tool_count > 0) {
        L.circleMarker([inst.lat, inst.lng], {
          radius: statRadius(inst.tool_count), color: '#fff', weight: 1,
          fillColor: TOOL_COLOR, fillOpacity: 0.85
        }).bindPopup(statPopup(inst, 'tools'), { maxWidth: 320 }).addTo(toolsLayer);
      }
    });
  }

  function buildChips() {
    els.chips.innerHTML = CHIP_ORDER.map(function (c) {
      var on, n;
      if (c.kind === 'type') {
        on = !!activeTypes[c.type];
        n = (DATA.counts && DATA.counts[c.type]) || 0;
      } else {
        on = !!overlayOn[c.layer];
        n = overlayCount(c.layer);
      }
      var label = tr(c.labelKey, c.def);
      var data = c.kind === 'type' ? ' data-type="' + c.type + '"' : ' data-layer="' + c.layer + '"';
      return '<button type="button" class="cm-chip' + (on ? ' active' : '') + '"' + data +
        ' style="--c:' + c.color + '"><span class="cm-chip-dot"></span><span class="cm-chip-label">' +
        esc(label) + '</span><span class="cm-chip-n">' + n + '</span></button>';
    }).join('');
  }

  function buildSelects() {
    var allStates = '<option value="">' + esc(tr('map.allStates', 'All states')) + '</option>';
    els.state.innerHTML = allStates + DATA.states.map(function (s) {
      return '<option value="' + esc(s) + '">' + esc(s) + '</option>';
    }).join('');
    var allTopics = '<option value="">' + esc(tr('map.allTopics', 'All topics')) + '</option>';
    els.topic.innerHTML = allTopics + DATA.topics.map(function (tp) {
      return '<option value="' + esc(tp) + '">' + esc(tp) + '</option>';
    }).join('');
    // CNPq research lines select, computed from the records themselves.
    if (els.line) {
      var seen = {};
      RECORDS.forEach(function (r) { recordLines(r).forEach(function (l) { seen[l] = true; }); });
      var lines = Object.keys(seen).sort(function (a, b) { return a.localeCompare(b, 'pt'); });
      var allLines = '<option value="">' + esc(tr('map.allLines', 'All research lines')) + '</option>';
      els.line.innerHTML = allLines + lines.map(function (l) {
        return '<option value="' + esc(l) + '">' + esc(l) + '</option>';
      }).join('');
      els.line.style.display = lines.length ? '' : 'none';
    }
    // Form type select mirrors the entity types.
    var mf = document.getElementById('mfType');
    if (mf) mf.innerHTML = TYPE_ORDER.map(function (type) {
      return '<option value="' + type + '">' + esc(typeLabel(type)) + '</option>';
    }).join('');
  }

  // Re-render i18n-dependent labels when the language changes.
  function relabel() {
    if (!DATA) return;
    buildChips();
    var sv = els.state.value, tv = els.topic.value, lv = els.line ? els.line.value : '';
    buildSelects();
    els.state.value = sv; els.topic.value = tv;
    if (els.line) els.line.value = lv;
    renderCnpqList();
    renderWticg();
    render();
  }

  function wire() {
    els.search.addEventListener('input', function () { query = fold(this.value.trim()); render(); });
    els.chips.addEventListener('click', function (e) {
      var b = e.target.closest('.cm-chip'); if (!b) return;
      if (b.dataset.type) {
        var ty = b.dataset.type;
        activeTypes[ty] = !activeTypes[ty];
        b.classList.toggle('active', activeTypes[ty]);
        render();
      } else if (b.dataset.layer) {
        var ly = b.dataset.layer;
        setOverlay(ly, !overlayOn[ly]);
        b.classList.toggle('active', overlayOn[ly]);
      }
    });
    els.state.addEventListener('change', function () { selState = this.value; render(); });
    els.topic.addEventListener('change', function () { selTopic = this.value; render(); });
    if (els.line) els.line.addEventListener('change', function () { selLine = this.value; render(); });
    els.clear.addEventListener('click', function () {
      query = ''; selState = ''; selTopic = ''; selLine = '';
      els.search.value = ''; els.state.value = ''; els.topic.value = '';
      if (els.line) els.line.value = '';
      render();
    });
    els.list.addEventListener('click', function (e) {
      var c = e.target.closest('.cm-card'); if (!c) return;
      focusRecord(c.dataset.id);
    });
    document.querySelectorAll('.map-viewtoggle button').forEach(function (b) {
      b.addEventListener('click', function () { setView(b.dataset.view); });
    });
    document.addEventListener('i18n:applied', relabel);
    initForm();
  }

  /* Static listing of CNPq research groups and their research lines, below the
     map. Built from the cnpq_group records of the same dataset. */
  function renderCnpqList() {
    var box = document.getElementById('cnpqGroupsList');
    if (!box) return;
    var groups = RECORDS.filter(function (r) { return r.type === 'cnpq_group'; })
      .slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'pt'); });
    if (!groups.length) {
      var sec = box.closest('section');
      if (sec) sec.hidden = true;
      return;
    }
    box.innerHTML = groups.map(function (g) {
      var links = g.links || {};
      var lnk = [];
      if (links.group) lnk.push('<a href="' + esc(links.group) + '" target="_blank" rel="noopener">CNPq</a>');
      if (links.url) lnk.push('<a href="' + esc(links.url) + '" target="_blank" rel="noopener">' + esc(tr('map.groupSite', 'website')) + '</a>');
      var meta = [g.institution, g.state].filter(Boolean).join(' · ');
      var lines = (g.lines || []).map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('');
      var members = (g.members && g.members.length)
        ? '<p class="cnpq-g-members"><b>' + esc(tr('map.members', 'Researchers')) + ':</b> ' + esc(g.members.join('; ')) + '</p>'
        : '';
      return '<article class="cnpq-g">'
        + '<h3>' + esc(g.name) + (lnk.length ? ' <span class="cnpq-g-links">' + lnk.join(' · ') + '</span>' : '') + '</h3>'
        + (meta ? '<p class="cnpq-g-meta">' + esc(meta) + '</p>' : '')
        + (lines ? '<ul class="cnpq-g-lines">' + lines + '</ul>' : '')
        + members + '</article>';
    }).join('');
  }

  function initForm() {
    var form = document.getElementById('mapForm');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = form.elements;
      var name = f.name.value.trim(), email = f.email.value.trim();
      var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      var err = document.getElementById('mfError');
      if (!name || !emailOk) { err.hidden = false; return; }
      err.hidden = true;
      var typeSel = f.type.options[f.type.selectedIndex].text;
      var lines = [
        tr('mapForm.name', 'Name') + ': ' + name,
        tr('mapForm.email', 'Email') + ': ' + email,
        tr('mapForm.type', 'Record type') + ': ' + typeSel,
        tr('mapForm.institution', 'Institution') + ': ' + f.institution.value.trim(),
        tr('mapForm.state', 'State') + ': ' + f.state.value.trim(),
        tr('mapForm.interests', 'Areas') + ': ' + f.interests.value.trim(),
        tr('mapForm.links', 'Links') + ': ' + f.links.value.trim(),
        '', tr('mapForm.message', 'Message') + ':', f.message.value.trim()
      ];
      var subject = tr('mapForm.subject', 'Cybersecurity Map: inclusion request') + ' - ' + name;
      var href = 'mailto:ceseg.sbc@gmail.com?subject=' + encodeURIComponent(subject) +
        '&body=' + encodeURIComponent(lines.join('\n'));
      window.location.href = href;
    });
  }

  /* SBSeg editions layer: a separate, toggleable overlay (default off) of the
     event's host cities, independent of the RNP type chips and the results list.
     Data is grouped by city, so a city that hosted several editions is one pin. */
  var sbsegLayer = null, sbsegLoaded = false;

  function sbsegIcon() {
    return L.divIcon({
      className: 'sbseg-pin',
      html: '<span></span>',
      iconSize: [16, 16], iconAnchor: [8, 8], popupAnchor: [0, -9]
    });
  }

  function sbsegPopupHTML(c) {
    var head = esc(c.city) + (c.uf ? ' · ' + esc(c.uf) : '');
    var rows = c.editions.map(function (e) {
      var links = e.links || {};
      var parts = [];
      if (links.site) parts.push('<a href="' + esc(links.site) + '" target="_blank" rel="noopener">' + esc(tr('map.sbsegSite', 'site')) + '</a>');
      if (links.clone) parts.push('<a href="' + esc(links.clone) + '" target="_blank" rel="noopener">' + esc(tr('map.sbsegClone', 'clone')) + '</a>');
      if (links.anais) parts.push('<a href="' + esc(links.anais) + '" target="_blank" rel="noopener">' + esc(tr('map.sbsegAnais', 'proceedings')) + '</a>');
      var meta = [esc(String(e.year)), esc(e.dates)].filter(Boolean).join(' · ');
      if (e.online) meta += ' · ' + esc(tr('map.sbsegOnline', 'online'));
      if (e.wseg) meta += ' · WSeg';
      return '<div class="sbseg-ed"><b>SBSeg ' + esc(e.n) + '</b> · ' + meta +
        (parts.length ? '<div class="sbseg-ed-links">' + parts.join(' · ') + '</div>' : '') + '</div>';
    }).join('');
    return '<div class="sbseg-detail"><span class="sbseg-tag">SBSeg</span><h4>' + head + '</h4>' + rows + '</div>';
  }

  function loadSbsegLayer(cb) {
    if (sbsegLoaded) { cb(); return; }
    fetch('assets/data/sbseg-editions.json', { cache: 'no-cache' })
      .then(function (res) { return res.json(); })
      .then(function (d) {
        sbsegLayer = L.layerGroup();
        (d.cities || []).forEach(function (c) {
          if (c.lat == null || c.lng == null) return;
          L.marker([c.lat, c.lng], { icon: sbsegIcon() })
            .bindPopup(sbsegPopupHTML(c), { maxWidth: 300 })
            .addTo(sbsegLayer);
        });
        sbsegLoaded = true;
        cb();
      })
      .catch(function () { cb(true); });
  }

  /* WTICG overlay: one pin per SBSeg host city, sized by how many WTICG papers
     (Workshop de Trabalhos de Iniciação Científica e de Graduação) were presented
     there across editions. Built from assets/data/wticg-stats.json. */
  function wticgPopup(c) {
    var head = esc(c.city) + (c.uf ? ' · ' + esc(c.uf) : '');
    var rows = c.editions.map(function (e) {
      var papers = (e.papers || []).slice(0, 6).map(function (p) {
        return '<li>' + (p.url
          ? '<a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.title) + '</a>'
          : esc(p.title)) + '</li>';
      }).join('');
      var more = (e.papers && e.papers.length > 6)
        ? '<li class="cm-more"><a href="' + esc(e.url) + '" target="_blank" rel="noopener">+' +
          (e.papers.length - 6) + ' · ' + esc(tr('map.wticgAll', 'all papers')) + '</a></li>' : '';
      return '<div class="sbseg-ed"><b>WTICG ' + esc(String(e.year)) + '</b> · ' +
        esc(e.n + ' ' + tr('map.wticgPapers', 'papers')) +
        '<ul class="cm-pub-list">' + papers + more + '</ul></div>';
    }).join('');
    return '<div class="cm-detail"><span class="cm-tag" style="background:' + WTICG_COLOR + '">' +
      esc(c.total + ' ' + tr('map.wticgPapers', 'papers') + ' · WTICG') + '</span><h4>' + head +
      '</h4>' + rows + '</div>';
  }

  function buildWticgLayer() {
    if (!WTICG) return;
    wticgLayer = L.layerGroup();
    (WTICG.cities || []).forEach(function (c) {
      if (c.lat == null || c.lng == null) return;
      L.circleMarker([c.lat, c.lng], {
        radius: statRadius(c.total), color: '#fff', weight: 1,
        fillColor: WTICG_COLOR, fillOpacity: 0.85
      }).bindPopup(wticgPopup(c), { maxWidth: 340 }).addTo(wticgLayer);
    });
  }

  /* WTICG statistics panel below the map: totals plus a per-edition bar list and
     the most frequent authors. Rendered from the same wticg-stats.json. */
  function renderWticg() {
    var box = document.getElementById('wticgStats');
    if (!box) return;
    if (!WTICG) { var s = box.closest('section'); if (s) s.hidden = true; return; }
    var max = WTICG.per_year.reduce(function (m, e) { return Math.max(m, e.n); }, 1);
    var bars = WTICG.per_year.map(function (e) {
      var pct = Math.round((e.n / max) * 100);
      var loc = e.city ? esc(e.city) + (e.uf ? '/' + esc(e.uf) : '') : '';
      var yr = e.url
        ? '<a href="' + esc(e.url) + '" target="_blank" rel="noopener">' + e.year + '</a>' : e.year;
      return '<li class="wticg-bar"><span class="wticg-bar-yr">' + yr + '</span>' +
        '<span class="wticg-bar-track"><span class="wticg-bar-fill" style="width:' + pct +
        '%;background:' + WTICG_COLOR + '"></span></span>' +
        '<span class="wticg-bar-n">' + e.n + '</span>' +
        '<span class="wticg-bar-city">' + loc + '</span></li>';
    }).join('');
    var authors = (WTICG.top_authors || []).slice(0, 12).map(function (a) {
      return '<li>' + esc(a.name) + ' <span class="wticg-au-n">' + a.n + '</span></li>';
    }).join('');
    box.innerHTML =
      '<div class="wticg-nums">' +
        '<div class="wticg-num"><b>' + WTICG.total_papers + '</b><span>' + esc(tr('map.wticgStatPapers', 'papers')) + '</span></div>' +
        '<div class="wticg-num"><b>' + WTICG.n_editions + '</b><span>' + esc(tr('map.wticgStatEditions', 'editions')) + '</span></div>' +
        '<div class="wticg-num"><b>' + WTICG.distinct_authors + '</b><span>' + esc(tr('map.wticgStatAuthors', 'authors')) + '</span></div>' +
      '</div>' +
      '<div class="wticg-cols">' +
        '<div class="wticg-col"><h3>' + esc(tr('map.wticgPerYear', 'Papers per edition')) + '</h3>' +
          '<ul class="wticg-bars">' + bars + '</ul></div>' +
        '<div class="wticg-col"><h3>' + esc(tr('map.wticgTopAuthors', 'Most frequent authors')) + '</h3>' +
          '<ul class="wticg-authors">' + authors + '</ul></div>' +
      '</div>';
  }

  function setOverlay(name, on) {
    overlayOn[name] = on;
    if (name === 'pubs') {
      if (on) { if (pubsLayer) map.addLayer(pubsLayer); }
      else if (pubsLayer) map.removeLayer(pubsLayer);
    } else if (name === 'tools') {
      if (on) { if (toolsLayer) map.addLayer(toolsLayer); }
      else if (toolsLayer) map.removeLayer(toolsLayer);
    } else if (name === 'sbseg') {
      if (on) {
        loadSbsegLayer(function (failed) { if (!failed && overlayOn.sbseg) map.addLayer(sbsegLayer); });
      } else if (sbsegLayer) {
        map.removeLayer(sbsegLayer);
      }
    } else if (name === 'wticg') {
      if (on) { if (wticgLayer) map.addLayer(wticgLayer); }
      else if (wticgLayer) map.removeLayer(wticgLayer);
    }
  }

  function boot() {
    els = {
      search: document.getElementById('mapSearch'),
      chips: document.getElementById('mapChips'),
      state: document.getElementById('mapState'),
      topic: document.getElementById('mapTopic'),
      line: document.getElementById('mapLine'),
      clear: document.getElementById('mapClear'),
      list: document.getElementById('mapList'),
      grid: document.getElementById('mapGrid'),
      visible: document.getElementById('mapVisible'),
      total: document.getElementById('mapTotal'),
      noResults: document.getElementById('mapNoResults')
    };
    buildMap();
    Promise.all([
      fetch('assets/data/cybersecmap.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }),
      fetch('assets/data/proceedings-stats.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).catch(function () { return { institutions: [] }; }),
      fetch('assets/data/wticg-stats.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).catch(function () { return null; })
    ]).then(function (res) {
        DATA = res[0]; RECORDS = DATA.records || [];
        STATS = res[1] || { institutions: [] };
        WTICG = res[2] || null;
        buildMarkers();
        buildStatLayers();
        buildWticgLayer();
        buildChips();
        buildSelects();
        wire();
        renderCnpqList();
        renderWticg();
        render();
        ['pubs', 'sbseg', 'tools', 'wticg'].forEach(function (k) { if (overlayOn[k]) setOverlay(k, true); }); // default-on overlays
        if (window.matchMedia('(max-width: 760px)').matches) setView('map');
      })
      .catch(function () {
        els.list.innerHTML = '<p class="cm-list-empty">' +
          esc(tr('map.loadError', 'Could not load the map data.')) + '</p>';
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
