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
