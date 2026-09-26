// Bannière de l'accueil, pilotée depuis le panel (Admin > Publicités, emplacement « Labo Surf »).
// Par défaut, la bannière « Labo Surf VPN » intégrée s'affiche (canal et groupe officiels, contenu neutre). Si le panel est
// injoignable ou n'a rien configuré, elle reste affichée — aucune erreur visible.
//
// Modèle d'une bannière (tous les champs sont optionnels) : image · badge · titre · texte · action · indicateur.
// Aujourd'hui le panel fournit text, image, link et style ; badge et title sont lus s'ils existent (futures campagnes),
// sinon leur emplacement reste masqué. Aucune API n'est créée ici et aucun contenu n'est inventé.

let currentAd = null;
const BANNER_LONG_CHARS = 140;

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

async function loadHomeBanner(){
  const card = $('homeBannerCard'), defaultBlock = $('homeBannerDefault'), adBlock = $('homeBannerAd');
  try{
    // apiFetch (avec jeton s'il existe) : le panel renvoie alors la bannière du revendeur de l'utilisateur
    const res = await apiFetch('/api/ads/active?location=labo_surf_rail');
    if(!res.ok) return;
    const ad = (res.data && Array.isArray(res.data.ads) && res.data.ads.length) ? res.data.ads[0] : null;
    const changed = JSON.stringify(ad) !== JSON.stringify(currentAd);
    currentAd = ad;
    if(!ad){
      card.className = 'banner-card banner-style-default';
      defaultBlock.hidden = false; adBlock.hidden = true;
      if(changed) bannerSwap();
      return;
    }
    card.className = 'banner-card banner-style-' + String(ad.style || 'neon').replace(/[^a-z0-9_-]/gi, '');
    defaultBlock.hidden = true; adBlock.hidden = false;

    const img = $('homeBannerImg');
    if(ad.image){
      img.src = String(ad.image).startsWith('http') ? ad.image : `${FREE_SURF_API_BASE}${ad.image}`;
      img.hidden = false;
    } else img.hidden = true;

    renderAdText();
    const link = $('homeBannerLink');
    if(ad.link){ link.href = ad.link; link.hidden = false; } else link.hidden = true;
    if(changed) bannerSwap();
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
const TW_COLORS = [['#f5f8f6', 'rgba(255,255,255,.22)'], ['#3fdc80', 'rgba(25,199,99,.35)'], ['#d8b45a', 'rgba(216,180,90,.35)']];   // palette de la marque : blanc, émeraude, or
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
document.querySelectorAll('.bn-op').forEach((el) => {
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