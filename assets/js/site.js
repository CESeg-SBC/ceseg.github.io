// ---- Site analytics (Google Analytics 4) ----
// Informe aqui o Measurement ID da propriedade GA4 (formato "G-XXXXXXXXXX").
// Com o valor vazio a coleta fica desativada (ex.: durante o desenvolvimento).
const GA_MEASUREMENT_ID = '';
(function initAnalytics(){
  if(!/^G-[A-Z0-9]+$/.test(GA_MEASUREMENT_ID)) return;             // ID ausente ou placeholder
  if(['localhost','127.0.0.1'].includes(location.hostname)) return; // não medir dev local
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_MEASUREMENT_ID);
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function(){ dataLayer.push(arguments); };
  gtag('js', new Date());
  gtag('config', GA_MEASUREMENT_ID, { anonymize_ip: true });
})();

// ---- Navigation model (label keys resolved via i18n) ----
const NAV = [
  {key:'nav.home', href:'index.html'},
  {key:'nav.org', href:'organizacao.html', children:[
    {key:'nav.comissoes', href:'comissoes.html'},
    {key:'nav.conferencistas', href:'conferencistas.html'}]},
  {key:'nav.mapa', href:'comunidade.html', children:[
    {key:'nav.gruposCnpq', href:'grupos-cnpq.html'}]},
  {key:'nav.sbseg', href:'https://sbseg-sbc.github.io'},
  {key:'nav.homenagens', href:'homenageados.html'},
  {key:'nav.publicacoes', href:'publicacoes.html', children:[
    {key:'nav.anaisTP', href:'anais-trilha-principal.html'},
    {key:'nav.anaisEst', href:'anais-estendidos.html'},
    {key:'nav.minicursos', href:'minicursos.html'},
    {key:'nav.tpc', href:'estatisticas-tpc.html'},
    {key:'nav.tpcEst', href:'estatisticas-tpc-estendido.html'},
    {key:'nav.referenciais', href:'referenciais.html'},
    {key:'nav.ondepublicar', href:'onde-publicar.html'}]},
  {key:'nav.documentos', href:'documentos.html', children:[
    {key:'nav.atas', href:'atas.html'},
    {key:'nav.regimentos', href:'regimentos.html'},
    {key:'nav.portarias', href:'portarias.html'}]},
];

function navItemHTML(item, current){
  const active = item.href === current ? ' class="active"' : '';
  const label = `<span data-i18n="${item.key}"></span>`;
  if(item.children){
    const kids = item.children.map(c =>
      `<li><a href="${c.href}"${c.href===current?' class="active"':''}><span data-i18n="${c.key}"></span></a></li>`).join('');
    return `<li class="has-drop"><a href="${item.href}"${active}>${label}</a>
      <ul class="dropdown">${kids}</ul></li>`;
  }
  return `<li><a href="${item.href}"${active}>${label}</a></li>`;
}

function renderHeader(current){
  const links = NAV.map(i => navItemHTML(i, current)).join('');
  return `<div class="wrap nav">
    <a class="brand" href="index.html">CESeg</a>
    <ul class="nav-links" id="navLinks">${links}</ul>
    <div class="nav-right">
      <div class="lang" role="group" aria-label="Idioma">
        <button data-lang="pt">PT</button><button data-lang="en">EN</button><button data-lang="es">ES</button>
      </div>
      <button class="nav-toggle hamburger" aria-label="Menu" aria-expanded="false">☰</button>
    </div>
  </div>`;
}

function renderBetaBanner(){
  return `<div class="wrap beta-bar">
    <span class="beta-tag" data-i18n="beta.tag">Beta v0.8</span>
    <span class="beta-msg" data-i18n="beta.msg">🚧 Site em construção — conteúdo em revisão e sujeito a alterações.</span>
  </div>`;
}

function renderFooter(){
  return `<div class="wrap cols">
    <div><div class="brand-f">CESeg</div>
      <p data-i18n="footer.about"></p>
      <small data-i18n="footer.cnpj"></small></div>
    <div><h4 data-i18n="footer.contactTitle"></h4>
      <p><a href="mailto:ceseg.sbc@gmail.com">ceseg.sbc@gmail.com</a></p>
      <p>(51) 3308-6835</p>
      <p data-i18n="footer.address"></p></div>
    <div><h4 data-i18n="footer.navTitle"></h4>
      <p><a href="organizacao.html" data-i18n="nav.org"></a></p>
      <p><a href="https://sbseg-sbc.github.io" data-i18n="nav.sbseg"></a></p>
      <p><a href="publicacoes.html" data-i18n="nav.publicacoes"></a></p>
      <p><a href="documentos.html" data-i18n="nav.documentos"></a></p></div>
  </div>
  <div class="wrap footer-credit">
    <span>© <span id="footYear">2026</span> CESeg — SBC</span>
    <span data-i18n="footer.credit"></span>
  </div>`;
}

// ---- i18n ----
const LANGS = ['pt','en','es'];
let DICT = {};

function t(key){
  return key.split('.').reduce((o,k)=> (o&&o[k]!=null)?o[k]:null, DICT) ?? null;
}
// Expose the i18n lookup on a stable namespace so page scripts (e.g. mapa.js) can
// translate without relying on the bare global `t`, which third-party bundles
// (Leaflet) may shadow with their own leaked global.
window.cesegI18n = { t: t, lang: currentLang };
function applyI18n(){
  document.querySelectorAll('[data-i18n]').forEach(el=>{
    const val = t(el.getAttribute('data-i18n'));
    if(val==null) return;            // missing key: leave existing (PT fallback) text
    if(el.tagName==='TITLE') document.title = val;
    else if(el.hasAttribute('data-i18n-attr')) el.setAttribute(el.getAttribute('data-i18n-attr'), val);
    else el.innerHTML = val;
  });
  // Standalone attribute translations (independent of element text content).
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el=>{
    const v = t(el.getAttribute('data-i18n-placeholder')); if(v!=null) el.setAttribute('placeholder', v);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el=>{
    const v = t(el.getAttribute('data-i18n-title')); if(v!=null) el.setAttribute('title', v);
  });
  document.querySelectorAll('.lang button').forEach(b=>
    b.classList.toggle('active', b.dataset.lang===currentLang()));
  document.documentElement.lang = currentLang();
  // Let page-specific scripts (e.g. mapa.js) re-render their dynamic labels.
  document.dispatchEvent(new CustomEvent('i18n:applied'));
}
function currentLang(){
  const url = new URLSearchParams(location.search).get('lang');
  const stored = localStorage.getItem('ceseg-lang');
  const nav = (navigator.language||'pt').slice(0,2);
  const pick = url || stored || (LANGS.includes(nav)?nav:'pt');
  return LANGS.includes(pick) ? pick : 'pt';
}
async function loadLang(lang){
  try{
    const res = await fetch(`assets/i18n/${lang}.json`,{cache:'no-cache'});
    DICT = await res.json();
  }catch(e){ DICT = {}; }
  applyI18n();
}
function setLang(lang){
  localStorage.setItem('ceseg-lang', lang);
  loadLang(lang);
}

// ---- Boot ----
document.addEventListener('DOMContentLoaded', ()=>{
  const current = (document.body.dataset.page||'index') + '.html';
  const banner = document.createElement('div');
  banner.className = 'beta-banner';
  banner.setAttribute('role', 'status');
  banner.innerHTML = renderBetaBanner();
  document.body.insertBefore(banner, document.body.firstChild);

  const header = document.getElementById('site-header');
  const footer = document.getElementById('site-footer');
  if(header){ header.className='site-header'; header.innerHTML = renderHeader(current); }
  if(footer){ footer.className='site-footer'; footer.innerHTML = renderFooter();
    const yr = document.getElementById('footYear'); if(yr) yr.textContent = new Date().getFullYear(); }

  const toggle = document.querySelector('.nav-toggle');
  const links = document.getElementById('navLinks');
  if(toggle&&links) toggle.addEventListener('click', ()=>{
    const open = links.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open?'true':'false');
  });
  document.querySelectorAll('.lang button').forEach(b=>
    b.addEventListener('click', ()=> setLang(b.dataset.lang)));

  loadLang(currentLang());
  initPubList();
  initMiniList();
  initKeywordSearch();
});

// ---- Publications listing: live filter + copy citation ----
function fold(s){ return (s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(); }

function initPubList(){
  const list = document.getElementById('pubList');
  if(!list) return;
  const search = document.getElementById('pubSearch');
  const visEl = document.getElementById('pubVisible');
  const noRes = document.getElementById('pubNoResults');
  const papers = Array.from(list.querySelectorAll('.pub-paper'));
  // Precompute a normalized haystack per paper once (title + authors + keywords).
  papers.forEach(p => p._hay = fold(
    p.dataset.title + ' ' + p.dataset.authors + ' ' + (p.dataset.keywords || '')));

  function apply(q){
    const needle = fold(q.trim());
    let visible = 0;
    papers.forEach(p => {
      const show = !needle || p._hay.includes(needle);
      p.hidden = !show;
      if(show) visible++;
    });
    // Hide section headers + editions that ended up empty.
    list.querySelectorAll('.pub-papers').forEach(ul=>{
      const any = ul.querySelector('.pub-paper:not([hidden])');
      ul.hidden = !any;
      const h = ul.previousElementSibling;
      if(h && h.classList.contains('pub-section')) h.hidden = !any;
    });
    list.querySelectorAll('.pub-edition').forEach(sec=>{
      sec.hidden = !sec.querySelector('.pub-paper:not([hidden])');
    });
    if(visEl) visEl.textContent = visible;
    if(noRes) noRes.hidden = visible !== 0;
  }

  if(search) search.addEventListener('input', () => apply(search.value));

  // Deep-link: ?q=term (used by the combined keyword map on publicacoes.html).
  const q = new URLSearchParams(location.search).get('q');
  if(q && search){ search.value = q; apply(q); }

  list.addEventListener('click', e => {
    const btn = e.target.closest('.pub-cite');
    if(!btn) return;
    const cite = btn.closest('.pub-paper').dataset.cite || '';
    navigator.clipboard.writeText(cite).then(() => {
      btn.classList.add('copied');
      setTimeout(() => btn.classList.remove('copied'), 1500);
    }).catch(() => {});
  });
}

// ---- Keyword cloud + chips: click a term to search ----
function initKeywordSearch(){
  const search = document.getElementById('pubSearch');
  document.addEventListener('click', e => {
    const w = e.target.closest('.wc-word, .pub-kw');
    if(!w) return;
    const kw = w.dataset.kw || w.textContent.trim();
    if(search){
      // On a listing page, fill the box and reuse its live filter.
      search.value = kw;
      search.dispatchEvent(new Event('input', {bubbles:true}));
      const top = document.querySelector('.pub-toolbar') || search;
      top.scrollIntoView({behavior:'smooth', block:'start'});
    } else {
      // On the overview page there is no list: jump to the Main Track filtered.
      location.href = 'anais-trilha-principal.html?q=' + encodeURIComponent(kw);
    }
  });
}

// ---- Minicursos ebooks: live filter across edition cards ----
function initMiniList(){
  const list = document.getElementById('miniList');
  if(!list) return;
  const search = document.getElementById('miniSearch');
  const visEl = document.getElementById('miniVisible');
  const noRes = document.getElementById('miniNoResults');
  const cards = Array.from(list.querySelectorAll('.mini-card'));
  cards.forEach(c => c._hay = fold(c.dataset.hay || c.textContent));

  function apply(q){
    const needle = fold(q.trim());
    let visible = 0;
    cards.forEach(c => {
      const show = !needle || c._hay.includes(needle);
      c.hidden = !show;
      if(show) visible++;
    });
    if(visEl) visEl.textContent = visible;
    if(noRes) noRes.hidden = visible !== 0;
  }
  if(search) search.addEventListener('input', () => apply(search.value));
}
