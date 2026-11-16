// Bannière de l'accueil, pilotée depuis le panel (Admin > Publicités, emplacement « Labo Surf »).
// Par défaut, la bannière « Labo Surf VPN » intégrée s'affiche (canal et groupe officiels, contenu neutre). Si le panel est
// injoignable ou n'a rien configuré, elle reste affichée — aucune erreur visible.
//
// Modèle d'une bannière (tous les champs sont optionnels) : image · badge · titre · texte · action · indicateur.
// Aujourd'hui le panel fournit text, image, link et style ; badge et title sont lus s'ils existent (futures campagnes),
// sinon leur emplacement reste masqué. Aucune API n'est créée ici et aucun contenu n'est inventé.

let currentAd = null;
const BANNER_LONG_CHARS = 140;

const Banner = {
  ads: [],
  welcomeBanner: 'Vous êtes connecté — Tunnel Sécurisé Actif',
  bannerDurationMs: 12000,
  adDurationMs: 8000,
  mode: 'ad',
  adIndex: 0,
  timer: 0,
};

function renderAdText(){
  if(!currentAd) return;
  const text = localizedField(currentAd, 'text');
  $('homeBannerText').textContent = text;
  $('homeBannerCard').classList.toggle('is-long', text.length > BANNER_LONG_CHARS);   // message long : lecture confortable, la bannière s'allonge
  const slot = (id, field) => { const v = localizedField(currentAd, field); $(id).textContent = v; $(id).hidden = !v; };
  slot('homeBannerBadge', 'badge');
  slot('homeBannerTitle', 'title');
  // Les annonces du panel restent telles que fournies ; si le backend donne text_fr / text_en, la langue courante est utilisée
}
document.addEventListener('langchange', renderAdText);

// Transition douce quand le contenu change (jamais au simple redessin) ; le corps de la bannière revient en haut
function bannerSwap(){
  const body = $('homeBannerBody');
  body.scrollTop = 0;
  body.classList.remove('is-swap'); void body.offsetWidth; body.classList.add('is-swap');
}

const COUNTRY_OPS_SHOWCASE = {
  CM: { flag: '🇨🇲', name: 'Cameroun', ops: 'MTN · Orange · Camtel · Nexttel' },
  CI: { flag: '🇨🇮', name: "Côte d'Ivoire", ops: 'Orange CI · MTN CI · Moov Africa' },
  SN: { flag: '🇸🇳', name: 'Sénégal', ops: 'Orange SN · Free SN · Expresso' },
  GA: { flag: '🇬🇦', name: 'Gabon', ops: 'Airtel GA · Moov Gabon' },
  ML: { flag: '🇲🇱', name: 'Mali', ops: 'Orange ML · Moov Malitel' },
  BF: { flag: '🇧🇫', name: 'Burkina Faso', ops: 'Orange BF · Moov BF · Telecel' },
  BJ: { flag: '🇧🇯', name: 'Bénin', ops: 'MTN BJ · Moov BJ' },
  TG: { flag: '🇹🇬', name: 'Togo', ops: 'Togocom · Moov TG' },
  CD: { flag: '🇨🇩', name: 'RD Congo', ops: 'Vodacom · Orange · Airtel' },
};

function populateConnBanner(){
  const cfg = (typeof getActiveConfigSummary === 'function') ? getActiveConfigSummary() : { title: 'Labo Surf VPN', subtitle: '🛡️ Stable' };
  const acc = (typeof Account !== 'undefined' && Account.last) ? Account.last : {};
  const en = (typeof I18N !== 'undefined' && I18N.lang === 'en');
  const user = acc.username || (en ? 'Member' : 'Abonné');
  const cc = (acc.country_code || acc.country || 'CM').toUpperCase();
  const cInfo = COUNTRY_OPS_SHOWCASE[cc] || COUNTRY_OPS_SHOWCASE.CM;
  let exp = en ? 'Unlimited' : 'Illimité';
  if(acc.daysLeft !== undefined && acc.daysLeft !== null){
    exp = acc.daysLeft <= 0 ? (en ? 'Expired' : 'Expiré') : (acc.daysLeft + (en ? ' d left' : ' j restants'));
  } else if(acc.expires_at){
    exp = String(acc.expires_at).slice(0, 10);
  }
  if($('bnConnCfg')) $('bnConnCfg').textContent = `${cInfo.flag} ${cfg.title || 'Labo Surf VPN'}`;
  if($('bnConnSub')) $('bnConnSub').textContent = `${cfg.subtitle || '🛡️ Stable'} · ${cInfo.ops}`;
  if($('bnConnUser')) $('bnConnUser').textContent = `👤 ${user} (${cc}) • ⏳ ${exp}`;
  if($('bnConnWelcome')) $('bnConnWelcome').textContent = '✨ ' + (Banner.welcomeBanner || (en ? 'Welcome to Labo Surf VPN' : 'Bienvenue sur Labo Surf VPN'));
}

function renderBannerDots(){
  const dots = $('homeBannerDots');
  if(!dots) return;
  const isOn = (typeof VPN !== 'undefined' && VPN.state === 'on');
  const slides = [];
  if(isOn) slides.push({ type: 'conn', idx: 0 });
  if(Banner.ads.length) Banner.ads.forEach((_, i) => slides.push({ type: 'ad', idx: i }));
  else if(!isOn) slides.push({ type: 'default', idx: 0 });

  if(slides.length < 2){
    dots.hidden = true;
    dots.textContent = '';
    return;
  }
  dots.hidden = false;
  dots.textContent = '';
  slides.forEach((s) => {
    const b = document.createElement('button');
    b.type = 'button';
    const active = (s.type === Banner.mode && (s.type !== 'ad' || s.idx === Banner.adIndex));
    b.className = 'bn-dot-btn' + (active ? ' is-active' : '');
    b.onclick = () => {
      Banner.mode = s.type;
      if(s.type === 'ad') Banner.adIndex = s.idx;
      renderBannerSlide(true);
      scheduleBannerCycle();
    };
    dots.appendChild(b);
  });
}

function renderBannerSlide(doSwap){
  const card = $('homeBannerCard'), defaultBlock = $('homeBannerDefault'), adBlock = $('homeBannerAd'), connBlock = $('homeBannerConn');
  if(!card || !defaultBlock || !adBlock) return;
  const isOn = (typeof VPN !== 'undefined' && VPN.state === 'on');
  if(!isOn && Banner.mode === 'conn') Banner.mode = Banner.ads.length ? 'ad' : 'default';

  if(Banner.mode === 'conn' && isOn && connBlock){
    populateConnBanner();
    card.className = 'banner-card banner-style-conn';
    defaultBlock.hidden = true;
    adBlock.hidden = true;
    connBlock.hidden = false;
    renderBannerDots();
    if(doSwap) bannerSwap();
    fitHomeScreen();
    return;
  }

  if(connBlock) connBlock.hidden = true;
  const ad = Banner.ads.length ? Banner.ads[Banner.adIndex % Banner.ads.length] : null;
  currentAd = ad;
  if(!ad){
    card.className = 'banner-card banner-style-default';
    defaultBlock.hidden = false;
    adBlock.hidden = true;
    renderBannerDots();
    if(doSwap) bannerSwap();
    fitHomeScreen();
    return;
  }

  card.className = 'banner-card banner-style-' + String(ad.style || 'neon').replace(/[^a-z0-9_-]/gi, '');
  defaultBlock.hidden = true;
  adBlock.hidden = false;
  const img = $('homeBannerImg');
  if(ad.image){
    img.src = String(ad.image).startsWith('http') ? ad.image : `${FREE_SURF_API_BASE}${ad.image}`;
    img.hidden = false;
  } else img.hidden = true;
  renderAdText();
  const link = $('homeBannerLink');
  if(ad.link){ link.href = ad.link; link.hidden = false; } else link.hidden = true;
  renderBannerDots();
  if(doSwap) bannerSwap();
  fitHomeScreen();
}

function scheduleBannerCycle(){
  clearTimeout(Banner.timer);
  const isOn = (typeof VPN !== 'undefined' && VPN.state === 'on');
  if(isOn){
    if(Banner.mode === 'conn'){
      if(!Banner.ads.length) return;
      Banner.timer = setTimeout(() => {
        Banner.mode = 'ad';
        Banner.adIndex = 0;
        renderBannerSlide(true);
        scheduleBannerCycle();
      }, Banner.bannerDurationMs);
    } else {
      Banner.timer = setTimeout(() => {
        if(Banner.adIndex + 1 < Banner.ads.length){
          Banner.adIndex++;
        } else {
          Banner.mode = 'conn';
        }
        renderBannerSlide(true);
        scheduleBannerCycle();
      }, Banner.adDurationMs);
    }
  } else if(Banner.ads.length > 1){
    Banner.timer = setTimeout(() => {
      Banner.adIndex = (Banner.adIndex + 1) % Banner.ads.length;
      renderBannerSlide(true);
      scheduleBannerCycle();
    }, Banner.adDurationMs);
  }
}

Banner.onVpnStateChange = (state) => {
  if(state === 'on'){
    Banner.mode = 'conn';
    renderBannerSlide(true);
  } else {
    Banner.mode = Banner.ads.length ? 'ad' : 'default';
    Banner.adIndex = 0;
    renderBannerSlide(true);
  }
  scheduleBannerCycle();
};
Banner.refreshConn = () => {
  if(Banner.mode === 'conn') populateConnBanner();
};

async function loadHomeBanner(){
  try{
    // apiFetch (avec jeton s'il existe) : le panel renvoie alors la bannière du revendeur de l'utilisateur
    const res = await apiFetch('/api/ads/active?location=labo_surf_rail');
    if(!res.ok) return;
    const d = res.data || {};
    Banner.ads = Array.isArray(d.ads) ? d.ads : [];
    if(d.welcome_banner) Banner.welcomeBanner = String(d.welcome_banner);
    if(Number(d.banner_duration_sec) > 0) Banner.bannerDurationMs = Number(d.banner_duration_sec) * 1000;
    if(Number(d.ad_duration_sec) > 0) Banner.adDurationMs = Number(d.ad_duration_sec) * 1000;
    const isOn = (typeof VPN !== 'undefined' && VPN.state === 'on');
    Banner.mode = isOn ? 'conn' : (Banner.ads.length ? 'ad' : 'default');
    Banner.adIndex = 0;
    renderBannerSlide(false);
    scheduleBannerCycle();
  }catch(e){
    /* panel injoignable : la bannière par défaut reste affichée */
  }
  fitHomeScreen();
}

// Bannière par défaut : jamais de défilement. Le bloc est mesuré à sa taille naturelle, puis --bn-s (police et espacements, en em)
// est réglé pour qu'il occupe exactement la hauteur disponible : réduit sur un petit écran, agrandi sur un grand.
// Retourne la hauteur naturelle (à --bn-s = 1), utilisée par l'accueil pour réserver la place de la bannière.
const BN_SCALE_MIN = 0.6, BN_SCALE_MAX = 1.22;
let bnFitting = false;
function fitBannerDefault(){
  const el = $('homeBannerDefault'), body = $('homeBannerBody');
  if(!el || !body || el.hidden || bnFitting || !$('screen-home').classList.contains('active')) return 0;
  const cs = getComputedStyle(body);
  const avail = body.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  if(avail <= 0) return 0;
  bnFitting = true;
  el.style.flex = 'none';                                       // hauteur naturelle du contenu (sans étirement)
  const height = (s) => { el.style.setProperty('--bn-s', s.toFixed(3)); return el.offsetHeight; };
  const natural = height(1);
  let s = 1;
  for(let i = 0; i < 4; i++){                                   // le retour à la ligne rend la hauteur non linéaire : on affine
    const h = height(s);
    if(Math.abs(h - avail) < 2) break;
    s = Math.min(BN_SCALE_MAX, Math.max(BN_SCALE_MIN, s * avail / h));
  }
  while(height(s) > avail && s > BN_SCALE_MIN) s = Math.max(BN_SCALE_MIN, s - 0.02);
  el.style.flex = '';
  bnFitting = false;
  el.dataset.natural = String(natural);
  return natural;
}
document.addEventListener('langchange', () => requestAnimationFrame(fitHomeScreen));
if(document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitHomeScreen());

// Accroche de la bannière : effet machine à écrire en boucle (frappe, pause, effacement) ; la couleur change à chaque fin de boucle :
// blanc, émeraude, or (palette de la marque). Chaque caractère est déjà dans la page (masqué), on ne fait que les révéler : aucune
// variation de hauteur. Suspendu hors de l'accueil ou quand l'app est en arrière-plan ; texte fixe si « réduire les animations ».
// palette : blanc lumineux, émeraude, vert néon, cyan, rouge élégant, or — toutes lisibles sur la vitre sombre
const TW_COLORS = [['#f5f8f6', 'rgba(255,255,255,.22)'], ['#3fdc80', 'rgba(25,199,99,.35)'], ['#8dffb2', 'rgba(110,255,170,.32)'],
  ['#6fdcf5', 'rgba(70,200,240,.32)'], ['#ff8a96', 'rgba(255,110,130,.30)'], ['#e8c77a', 'rgba(216,180,90,.35)']];
const TW = { chars: [], n: 0, dir: 1, loop: 0, timer: 0, started: false };
const TW_TYPE = 62, TW_ERASE = 26, TW_HOLD = 2000, TW_GAP = 450;

function twBuild(){
  const host = $('bdTagline');
  if(!host) return;
  host.textContent = '';
  TW.chars = [];
  String(t('banner.tagline')).split(' ').forEach((word, i, all) => {
    const w = document.createElement('span'); w.className = 'tw-w';
    Array.from(word).forEach((ch) => { const c = document.createElement('span'); c.className = 'tw-c'; c.textContent = ch; w.appendChild(c); TW.chars.push(c); });
    host.appendChild(w);
    if(i < all.length - 1){ host.appendChild(document.createTextNode(' ')); TW.chars.push(null); }   // l'espace compte comme un caractère tapé
  });
  twPaint();
}
function twPaint(){
  let last = null;
  TW.chars.forEach((c, i) => { if(!c) return; const on = i < TW.n; c.classList.toggle('on', on); c.classList.remove('cur', 'cur-l'); if(on) last = c; });
  const target = last || TW.chars.find(Boolean);
  if(target) target.classList.add(last ? 'cur' : 'cur-l');
}
function twColor(){
  const [c, glow] = TW_COLORS[TW.loop % TW_COLORS.length];
  $('bdTagline').style.setProperty('--tw', c);
  $('bdTagline').style.setProperty('--tw-glow', glow);
}
function twTick(){
  clearTimeout(TW.timer);
  const host = $('bdTagline');
  if(!host) return;
  const visible = !document.hidden && $('screen-home').classList.contains('active') && !$('homeBannerDefault').hidden;
  if(!visible){ TW.timer = setTimeout(twTick, 400); return; }   // en pause : on ne fait rien avancer
  const total = TW.chars.length;
  let wait;
  if(TW.dir === 1){
    TW.n = Math.min(total, TW.n + 1); twPaint();
    if(TW.n >= total){ TW.dir = -1; wait = TW_HOLD; } else wait = TW_TYPE + (Math.random() * 30);
  } else {
    TW.n = Math.max(0, TW.n - 1); twPaint();
    if(TW.n <= 0){ TW.dir = 1; TW.loop++; twColor(); wait = TW_GAP; } else wait = TW_ERASE;   // fin de boucle : nouvelle couleur
  }
  TW.timer = setTimeout(twTick, wait);
}
function twStart(){
  if(TW.started || !$('bdTagline')) return;
  TW.started = true;
  if(!TW.chars.length) twBuild();
  twColor();
  if(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches){ TW.n = TW.chars.length; twPaint(); TW.chars.forEach((c) => c && c.classList.remove('cur')); return; }
  TW.n = 0; TW.dir = 1; twPaint();
  TW.timer = setTimeout(twTick, 500);
}
document.addEventListener('langchange', () => {   // le texte est reconstruit (masqué) dès le premier rendu : la bannière garde sa hauteur
  const keep = TW.chars.length ? TW.n / TW.chars.length : 0;
  twBuild(); TW.n = TW.started ? Math.round(keep * TW.chars.length) : 0; twPaint();
  requestAnimationFrame(fitHomeScreen);
});
Splash.whenDone(twStart);   // la frappe commence quand l'animation d'ouverture est terminée

// Logos des opérateurs (arrière-plan animé de la bannière). Dépose les fichiers dans app/src/main/assets/www/img/operators/ :
// orange.svg|png|webp|jpg, mtn.…, camtel.… (voir le README de ce dossier). Ils sont détectés tout seuls, dans cet ordre de format ;
// tant qu'aucun fichier n'existe, le macaron avec le nom de l'opérateur reste affiché.
// À n'utiliser qu'avec le droit d'afficher ces logos et si le service fonctionne réellement sur ces réseaux.
const OPERATOR_LOGO_DIR = 'img/operators/', OPERATOR_LOGO_EXT = ['svg', 'png', 'webp', 'jpg'];
document.querySelectorAll('.bn-op, .bd-op').forEach((el) => {
  const name = el.dataset.op, label = el.querySelector('b');
  const tryExt = (i) => {
    if(i >= OPERATOR_LOGO_EXT.length) return;   // aucun fichier : on garde le macaron
    const img = new Image();
    img.alt = ''; img.setAttribute('aria-hidden', 'true');
    img.onload = () => { el.appendChild(img); if(label) label.hidden = true; };
    img.onerror = () => tryExt(i + 1);
    img.src = OPERATOR_LOGO_DIR + name + '.' + OPERATOR_LOGO_EXT[i];
  };
  tryExt(0);
});