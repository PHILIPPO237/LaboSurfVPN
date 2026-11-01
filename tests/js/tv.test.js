'use strict';
// LABOSURF TV : le pont natif ne reçoit que des tickets du panel, le tunnel n'est pas concerné, et rien du panel n'est rendu sans échappement.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { WWW } = require('./harness.js');

const js = fs.readFileSync(path.join(WWW, 'js', 'tv.js'), 'utf8');
const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
const ROOT = path.join(WWW, '..', '..', '..', '..', '..');
const kotlin = (f) => fs.readFileSync(path.join(WWW, '..', '..', 'java', 'com', 'philippo237', 'labosurf', f), 'utf8');

test('le pont natif reçoit un ticket, jamais une adresse de vidéo', () => {
  assert.match(js, /play\(granted\.ticket, I18N\.lang, pref\.audio \|\| '', pref\.subtitles \|\| ''\)/);
  assert.match(js, /start\(granted\.ticket, I18N\.lang\)/);
  assert.match(js, /open\(granted\.ticket\)/);
  const bridge = kotlin('MainActivity.kt');
  assert.match(bridge, /fun tvPlay\(ticket: String, lang: String, audio: String, subtitles: String\)/);
  assert.doesNotMatch(bridge, /fun tv\w+\(url: String/);
});

test('le natif échange le ticket uniquement auprès du panel configuré dans l\'APK, et n\'accepte que HTTPS', () => {
  const api = kotlin('tv/TvApi.kt');
  assert.match(api, /BuildConfig\.PANEL_BASE_URL\.trimEnd\('\/'\) \+ "\/api\/tv\/play\/redeem"/);
  assert.match(api, /startsWith\("https:\/\/", ignoreCase = true\)/);
  const player = kotlin('tv/TvPlayerActivity.kt');
  assert.match(player, /!TvApi\.isHttps\(url\)/);
  assert.match(player, /play\.optString\("kind"\) == "youtube"/);
});

test('aucun fichier du tunnel ne dépend de LABOSURF TV', () => {
  for(const f of ['LaboVpnService.kt', 'CoreTunnel.kt', 'NetworkRecovery.kt', 'udp/UdpLink.kt', 'udp/UdpProtocol.kt', 'udp/UdpTunnelClient.kt']){
    assert.doesNotMatch(kotlin(f), /\.tv\.|TvPlayer|TvDownloads|TvApi/, f);
  }
  assert.match(kotlin('LaboVpnService.kt'), /addDisallowedApplication\(packageName\)/);
});

test('YouTube : lecteur officiel, jamais d\'extraction ni de téléchargement', () => {
  assert.match(kotlin('MainActivity.kt'), /https:\/\/www\.youtube\.com\/watch\?v=\$videoId/);
  assert.match(js, /youtube-nocookie\.com\/embed\//);
  assert.doesNotMatch(kotlin('tv/TvDownloads.kt'), /youtube/i);
});

test('téléchargement : espace vérifié sur le téléphone, fichier dans le stockage privé, expiration appliquée hors connexion', () => {
  const downloads = kotlin('tv/TvDownloads.kt');
  assert.match(downloads, /size \+ SPACE_MARGIN_BYTES > freeBytes\(context\)/);
  assert.match(downloads, /setDestinationInExternalFilesDir\(context, Environment\.DIRECTORY_MOVIES/);
  assert.match(downloads, /!isExpired\(item\)/);
  assert.doesNotMatch(downloads, /WRITE_EXTERNAL_STORAGE/);
  assert.doesNotMatch(fs.readFileSync(path.join(WWW, '..', '..', 'AndroidManifest.xml'), 'utf8'), /WRITE_EXTERNAL_STORAGE|READ_EXTERNAL_STORAGE/);
});

test('la consommation de données est expliquée dans les deux langues', () => {
  for(const lang of ['fr', 'en']){
    const dict = fs.readFileSync(path.join(WWW, 'js', 'lang', lang + '.js'), 'utf8');
    assert.match(dict, /'tv\.dataNotice'/);
  }
  assert.match(js, /t\('tv\.dataNotice'\)/);
});

test('les images du panel sont limitées à ses fichiers ou à HTTPS, et l\'écran TV a son retour', () => {
  assert.match(js, /value\.indexOf\('\/tv-images\/'\) === 0/);
  assert.match(js, /\/\^https:\\\/\\\/\/i\.test\(value\)/);
  const block = html.slice(html.indexOf('id="screen-tv"'), html.indexOf('id="screen-servers"'));
  assert.match(block, /back-btn/);
  assert.match(html, /id="railBtn-tv"/);
});

test('Media3 reste compatible avec les SDK du projet', () => {
  const gradle = fs.readFileSync(path.join(ROOT, 'app', 'build.gradle.kts'), 'utf8');
  assert.match(gradle, /minSdk = 24/);
  assert.match(gradle, /compileSdk = 34/);
  assert.match(gradle, /androidx\.media3:media3-exoplayer:1\.4\.1/);
});
