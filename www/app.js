const STYLES = {
  light: 'https://tiles.openfreemap.org/styles/liberty',
  night: 'https://tiles.openfreemap.org/styles/dark'
};
const RASTER_FALLBACK = {
  version: 8,
  sources: { osm: { type:'raster', tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize:256 } },
  layers: [{ id:'osm-fallback', type:'raster', source:'osm' }]
};

let map, lMap, usingLeaflet = false, lRouteLayers = [], lNavMarker = null;
let navMarker, navMarkerEl, poiMarkers = [], fallbackApplied = false, mapReady = false;
let routeOptions = [], selectedRouteIdx = 0, routeCoords = [];
let simInterval = null, simIndex = 0, lastSpeedWarn = 0, isNavigating = false;
let customOriginCoords = null, userCurrentCoords = null, liveGpsWatchId = null;

let settings = {
  theme:'night', is3D:true, navIconMode:'auto',
  voiceEnabled:true, voiceLang:'pt-PT', voiceStyle:'normal',
  alertLevel:'all', avoidTolls:false, speedAlert:true, units:'kmh'
};
let tacho = { mode:'rest', contUsed:0, dailyUsed:0, breakAcc:0, speedMult:1 };
let currentPois = [
  { name:"Área de Serviço Batalha / A1", km:118, freeSpots:14, diesel:1.62, cards:["DKV","UTA","Repsol"] },
  { name:"Truck Park Vilar Formoso (Seguro)", km:325, freeSpots:4, diesel:1.59, cards:["DKV","Repsol"] },
  { name:"Estación Salamanca HGV", km:445, freeSpots:0, diesel:1.49, cards:["DKV","UTA"] },
  { name:"Madrid Sur Logistics Parking", km:615, freeSpots:22, diesel:1.51, cards:["UTA","Repsol"] }
];

function showToast(msg){
  const t = document.getElementById('toast-msg');
  if(!t) return;
  t.innerText = msg; t.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(()=>t.classList.remove('show'), 3600);
}

function resizeActiveMap(){
  try{
    if(usingLeaflet && lMap) setTimeout(()=>lMap.invalidateSize(), 150);
    else if(map) setTimeout(()=>map.resize(), 150);
  }catch(e){}
}

function updateRasterDarkClass(){
  const m = document.getElementById('map');
  if(m) m.classList.toggle('raster-dark', fallbackApplied && settings.theme==='night');
}

async function initAutoUpdater(){
  try{
    const updater = window.Capacitor?.Plugins?.CapacitorUpdater;
    if(!updater) return;
    try{ await updater.notifyAppReady(); }catch(e){}
    const res = await fetch('https://maikonmkn07.github.io/Mk-Truck/version.json?t=' + Date.now());
    if(!res.ok) return;
    const remote = await res.json();
    const cur = await updater.current();
    const currentVer = cur?.bundle?.version || '0.0.0';
    const lastApplied = localStorage.getItem('mk_ota_ver') || '0.0.0';
    if(remote.version && remote.version !== currentVer && remote.version !== lastApplied){
      const bundle = await updater.download({ url: remote.url, version: remote.version });
      localStorage.setItem('mk_ota_ver', remote.version);
      await updater.next({ id: bundle.id });
      showToast('✅ Atualização v' + remote.version + ' pronta (aplica ao reabrir).');
    }
  }catch(e){}
}

function loadScript(src){
  return new Promise((resolve, reject)=>{
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

function loadCss(href){
  return new Promise((resolve)=>{
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href;
    l.onload = resolve; l.onerror = resolve;
    document.head.appendChild(l);
    setTimeout(resolve, 1800);
  });
}

function switchToRasterFallback(){
  if(fallbackApplied || !map) return;
  fallbackApplied = true;
  try{ map.setStyle(RASTER_FALLBACK); updateRasterDarkClass(); map.resize(); }catch(e){}
}

async function initLeafletFallback(){
  usingLeaflet = true;
  await loadCss('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css');
  await loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js');
  lMap = L.map('map', { zoomControl:false }).setView([41.1, -8.4], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19 }).addTo(lMap);
  const pos = await getNativeLocation(true);
  if(pos){
    userCurrentCoords = pos; customOriginCoords = pos;
    document.getElementById('origin-input').value = '📍 Minha Localização';
    updateNavMarker(pos, 0);
    lMap.setView([pos[1], pos[0]], 15);
  }
}

async function initMapSafely(){
  try{
    await loadCss('https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css');
    if(typeof maplibregl === 'undefined'){
      try{ await loadScript('https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js'); }
      catch(e){ await loadScript('https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js'); }
    }
    map = new maplibregl.Map({
      container:'map',
      style: STYLES[settings.theme] || STYLES.night,
      center:[-8.4, 41.1],
      zoom:13.5,
      pitch: settings.is3D ? 58 : 0,
      bearing:0,
      attributionControl:false
    });
    map.on('load', () => { mapReady = true; map.resize(); });
    map.on('style.load', () => {
      mapReady = true; add3DBuildings(); redrawRoutesOnMap(); updateRasterDarkClass(); map.resize();
    });
    map.on('error', () => { switchToRasterFallback(); });
    setTimeout(() => { if(!mapReady) switchToRasterFallback(); }, 3500);

    const pos = await getNativeLocation(true);
    if(pos){
      userCurrentCoords = pos; customOriginCoords = pos;
      document.getElementById('origin-input').value = '📍 Minha Localização';
      updateNavMarker(pos, 0);
      map.flyTo({ center:pos, zoom:15.5, pitch: settings.is3D ? 58 : 0 });
    }
  }catch(err){
    try{ await initLeafletFallback(); }
    catch(e2){ showToast('Ligue a internet para carregar o mapa.'); }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  try{ loadSettings(); }catch(e){}
  try{ loadProfile(); }catch(e){}
  try{ renderPoiList(); }catch(e){}
  setInterval(tickTacho, 1000);
  initAutoUpdater();
  initMapSafely();
});

function add3DBuildings(){
  try{
    if(!map || fallbackApplied || map.getLayer('3d-buildings-mk')) return;
    const src = map.getSource('openmaptiles') ? 'openmaptiles' : null;
    if(!src) return;
    map.addLayer({
      id:'3d-buildings-mk', source: src, 'source-layer':'building', type:'fill-extrusion', minzoom:14,
      paint:{
        'fill-extrusion-color': settings.theme==='light' ? '#cbd5e1' : '#1e3a5f',
        'fill-extrusion-height':['coalesce',['get','render_height'],12],
        'fill-extrusion-base':['coalesce',['get','render_min_height'],0],
        'fill-extrusion-opacity': settings.is3D ? 0.72 : 0
      }
    });
  }catch(e){}
}

function getActiveIconType(){
  if(settings.navIconMode === 'truck') return 'truck';
  if(settings.navIconMode === 'arrow') return 'arrow';
  return isNavigating ? 'arrow' : 'truck';
}

function getNavSvg(type, rot=0){
  if(type === 'arrow'){
    return `<svg style="transform:rotate(${rot}deg)" viewBox="0 0 64 64" width="44" height="44"><circle cx="32" cy="32" r="24" fill="#0f172a" fill-opacity="0.88" stroke="#38bdf8" stroke-width="3"/><path d="M32 10 L48 48 L32 40 L16 48 Z" fill="#38bdf8" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="round"/></svg>`;
  }
  return `<svg style="transform:rotate(${rot}deg)" viewBox="0 0 64 64" width="46" height="46"><circle cx="32" cy="32" r="26" fill="#0f172a" fill-opacity="0.85" stroke="#38bdf8" stroke-width="2.5"/><rect x="20" y="13" width="24" height="36" rx="6" fill="#0ea5e9" stroke="#ffffff" stroke-width="2"/><rect x="23" y="17" width="18" height="8" rx="2" fill="#091326"/><rect x="23" y="10" width="5" height="3" rx="1" fill="#fef08a"/><rect x="36" y="10" width="5" height="3" rx="1" fill="#fef08a"/></svg>`;
}

function updateNavMarker(coords, bearing=0){
  const type = getActiveIconType();
  if(usingLeaflet && lMap){
    const icon = L.divIcon({ className:'nav-marker-wrap', html:getNavSvg(type, bearing), iconSize:[44,44], iconAnchor:[22,22] });
    if(!lNavMarker) lNavMarker = L.marker([coords[1], coords[0]], { icon }).addTo(lMap);
    else { lNavMarker.setIcon(icon); lNavMarker.setLatLng([coords[1], coords[0]]); }
    return;
  }
  if(!map || typeof maplibregl === 'undefined') return;
  if(!navMarker){
    navMarkerEl = document.createElement('div');
    navMarkerEl.className = 'nav-marker-wrap';
    navMarkerEl.innerHTML = getNavSvg(type, 0);
    navMarker = new maplibregl.Marker({ element: navMarkerEl, rotationAlignment:'map', pitchAlignment:'map' }).setLngLat(coords).addTo(map);
  }else{
    navMarkerEl.innerHTML = getNavSvg(type, 0);
    navMarker.setLngLat(coords);
  }
  navMarker.setRotation(bearing);
}

function setNavIconMode(mode){
  settings.navIconMode = mode;
  document.querySelectorAll('#navicon-auto,#navicon-truck,#navicon-arrow').forEach(el=>el.classList.remove('active'));
  document.getElementById('navicon-'+mode).classList.add('active');
  localStorage.setItem('mk_truck_settings', JSON.stringify(settings));
  const pos = navMarker ? [navMarker.getLngLat().lng, navMarker.getLngLat().lat] : userCurrentCoords;
  if(pos) updateNavMarker(pos, navMarker ? navMarker.getRotation() : 0);
}

function set3DMode(is3D){
  settings.is3D = is3D;
  document.getElementById('view-3d').classList.toggle('active', is3D);
  document.getElementById('view-2d').classList.toggle('active', !is3D);
  const fab = document.getElementById('btn-3d');
  fab.innerText = is3D ? '3D' : '2D';
  fab.classList.toggle('active-3d', is3D);
  if(map){
    map.easeTo({ pitch: is3D ? 58 : 0, bearing: is3D ? map.getBearing() : 0, duration: 450 });
    try{ if(map.getLayer('3d-buildings-mk')) map.setPaintProperty('3d-buildings-mk','fill-extrusion-opacity', is3D ? 0.72 : 0); }catch(e){}
  }
  localStorage.setItem('mk_truck_settings', JSON.stringify(settings));
}
function toggle3D(){ set3DMode(!settings.is3D); }

function openSettings(){ document.getElementById('settings-modal').classList.add('open'); }
function closeSettings(){ document.getElementById('settings-modal').classList.remove('open'); }

function setTheme(t){
  settings.theme = t;
  document.body.classList.toggle('light-mode', t==='light');
  document.getElementById('theme-light').classList.toggle('active', t==='light');
  document.getElementById('theme-night').classList.toggle('active', t==='night');
  if(map){
    if(fallbackApplied) updateRasterDarkClass();
    else{ mapReady = false; map.setStyle(STYLES[t] || STYLES.night); }
  }
  localStorage.setItem('mk_truck_settings', JSON.stringify(settings));
}

function saveSettings(){
  settings.voiceEnabled = document.getElementById('set-voice').checked;
  settings.voiceLang = document.getElementById('set-lang').value;
  settings.voiceStyle = document.getElementById('set-voice-style').value;
  settings.alertLevel = document.getElementById('set-alert-level').value;
  settings.avoidTolls = document.getElementById('set-avoid-tolls').checked;
  settings.speedAlert = document.getElementById('set-speed-alert').checked;
  settings.units = document.getElementById('set-units').value;
  localStorage.setItem('mk_truck_settings', JSON.stringify(settings));
  applySettingsUI();
}

function loadSettings(){
  const raw = localStorage.getItem('mk_truck_settings');
  if(raw) settings = {...settings, ...JSON.parse(raw)};
  if(settings.theme !== 'light' && settings.theme !== 'night') settings.theme = 'night';
  if(!['auto','truck','arrow'].includes(settings.navIconMode)) settings.navIconMode = 'auto';
  document.getElementById('set-voice').checked = !!settings.voiceEnabled;
  document.getElementById('set-lang').value = settings.voiceLang || 'pt-PT';
  document.getElementById('set-voice-style').value = settings.voiceStyle || 'normal';
  document.getElementById('set-alert-level').value = settings.alertLevel || 'all';
  document.getElementById('set-avoid-tolls').checked = !!settings.avoidTolls;
  document.getElementById('set-speed-alert').checked = settings.speedAlert !== false;
  document.getElementById('set-units').value = settings.units || 'kmh';
  document.body.classList.toggle('light-mode', settings.theme==='light');
  document.getElementById('theme-light').classList.toggle('active', settings.theme==='light');
  document.getElementById('theme-night').classList.toggle('active', settings.theme==='night');
  document.querySelectorAll('#navicon-auto,#navicon-truck,#navicon-arrow').forEach(el=>el.classList.remove('active'));
  document.getElementById('navicon-'+settings.navIconMode).classList.add('active');
  document.getElementById('view-3d').classList.toggle('active', settings.is3D!==false);
  document.getElementById('view-2d').classList.toggle('active', settings.is3D===false);
  document.getElementById('btn-3d').innerText = settings.is3D!==false ? '3D' : '2D';
  document.getElementById('btn-3d').classList.toggle('active-3d', settings.is3D!==false);
  applySettingsUI();
}

function applySettingsUI(){
  document.getElementById('btn-voice').innerText = settings.voiceEnabled ? '🔊 Voz: ON' : '🔇 Voz: OFF';
  document.getElementById('hud-limit').innerText = settings.units==='mph' ? '50' : '80';
  document.getElementById('hud-unit-lbl').innerText = settings.units==='mph' ? 'mph (HGV)' : 'km/h (HGV)';
}

function toggleVoice(){
  settings.voiceEnabled = !settings.voiceEnabled;
  document.getElementById('set-voice').checked = settings.voiceEnabled;
  saveSettings();
  if(settings.voiceEnabled) speak('Voz do MK Truck ativada.', 'test', true);
}

function testVoice(){
  const samples = {
    'pt-PT':'MK Truck pronto para a viagem. Siga em frente e boa estrada.',
    'pt-BR':'MK Truck pronto para a viagem. Siga em frente e boa viagem.',
    'es-ES':'MK Truck listo para el viaje. Siga adelante.',
    'en-GB':'MK Truck ready for your journey. Drive safely.'
  };
  speak(samples[settings.voiceLang] || samples['pt-PT'], 'test', true);
}

async function speak(text, category='all', interactive=false){
  if(!settings.voiceEnabled) return;
  if(category!=='test'){
    if(settings.alertLevel==='hazards' && category==='route') return;
    if(settings.alertLevel==='route_only' && category==='hazard') return;
  }
  let rate = 1.0, pitch = 1.0;
  if(settings.voiceStyle==='fast'){ rate=1.22; pitch=1.05; }
  if(settings.voiceStyle==='deep'){ rate=0.92; pitch=0.78; }

  const tts = window.Capacitor?.Plugins?.TextToSpeech;
  if(tts){
    try{
      let chosenLang = settings.voiceLang;
      try{
        const res = await tts.getSupportedLanguages();
        const langs = res?.languages || [];
        if(langs.length > 0 && !langs.includes(chosenLang)){
          const prefix = chosenLang.split('-')[0].toLowerCase();
          chosenLang = langs.find(l => l.toLowerCase().startsWith(prefix)) || langs[0];
        }
      }catch(e){}
      await tts.speak({ text, lang: chosenLang, rate, pitch, volume:1.0 });
      return;
    }catch(err1){
      try{ await tts.speak({ text, rate, pitch, volume:1.0 }); return; }
      catch(err2){
        if(interactive){
          showToast('Pacote de voz não instalado. A abrir definições...');
          try{ await tts.openInstall(); }catch(e3){}
        }
      }
    }
  }
  if('speechSynthesis' in window){
    const u = new SpeechSynthesisUtterance(text);
    u.lang = settings.voiceLang; u.rate = rate; u.pitch = pitch;
    window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
  }else if(interactive){
    showToast('Voz indisponível neste navegador.');
  }
}

async function getNativeLocation(silent=false){
  const geo = window.Capacitor?.Plugins?.Geolocation;
  if(geo){
    try{
      await geo.requestPermissions();
      const pos = await geo.getCurrentPosition({enableHighAccuracy:true,timeout:10000});
      return [pos.coords.longitude, pos.coords.latitude];
    }catch(e){ if(!silent) showToast('Ative o GPS no telemóvel e permita a localização.'); return null; }
  }
  if('geolocation' in navigator){
    return new Promise(res=>{
      navigator.geolocation.getCurrentPosition(
        p=>res([p.coords.longitude,p.coords.latitude]),
        ()=>{ if(!silent) showToast('GPS bloqueado neste navegador.'); res(null); },
        {enableHighAccuracy:true,timeout:7000}
      );
    });
  }
  if(!silent) showToast('GPS indisponível.');
  return null;
}

async function useMyLocationAsOrigin(){
  showToast('A procurar a sua localização GPS...');
  const coords = await getNativeLocation(false);
  if(!coords) return;
  userCurrentCoords = coords; customOriginCoords = coords;
  updateNavMarker(coords, 0);
  if(usingLeaflet && lMap) lMap.setView([coords[1], coords[0]], 15);
  else if(map) map.flyTo({ center:coords, zoom:15, pitch: settings.is3D ? 58 : 0 });
  document.getElementById('origin-input').value = '📍 Minha Localização';
  showToast('Localização atual carregada!');
  speak('Localização atual definida como origem.','route');
  try{
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${coords[1]}&lon=${coords[0]}`);
    const d = await r.json();
    const place = d.address?.city || d.address?.town || d.address?.village || d.address?.road;
    if(place) document.getElementById('origin-input').value = `📍 ${place}`;
  }catch(e){}
}

function updateSpeedHud(kmh){
  const val = settings.units==='mph' ? Math.round(kmh*0.621371) : Math.round(kmh);
  document.getElementById('hud-speed').innerText = val;
  const box = document.getElementById('speed-box');
  if(settings.speedAlert && kmh>82){
    box.classList.add('overspeed');
    if(Date.now()-lastSpeedWarn>15000){ lastSpeedWarn=Date.now(); speak('Atenção: excesso de velocidade para pesados.','hazard'); }
  }else box.classList.remove('overspeed');
}

async function toggleLiveGps(){
  const btn = document.getElementById('btn-live-gps');
  const geo = window.Capacitor?.Plugins?.Geolocation;
  if(liveGpsWatchId !== null){
    if(geo) await geo.clearWatch({id:liveGpsWatchId}); else navigator.geolocation.clearWatch(liveGpsWatchId);
    liveGpsWatchId = null; isNavigating = false;
    btn.classList.remove('active-gps'); setTachoMode('rest');
    if(userCurrentCoords) updateNavMarker(userCurrentCoords, 0);
    return;
  }
  btn.classList.add('active-gps'); isNavigating = true; setTachoMode('drive');
  speak('Navegação GPS ao vivo iniciada.','route');
  const onUpdate = (pos)=>{
    if(!pos) return;
    const c = [pos.coords.longitude, pos.coords.latitude];
    const brg = pos.coords.heading || 0;
    userCurrentCoords = c;
    updateNavMarker(c, brg);
    if(usingLeaflet && lMap) lMap.panTo([c[1], c[0]]);
    else if(map) map.easeTo({ center:c, bearing: settings.is3D ? brg : 0, pitch: settings.is3D ? 58 : 0, zoom:16.5, duration:450 });
    if(pos.coords.speed !== null && pos.coords.speed >= 0) updateSpeedHud(pos.coords.speed*3.6);
  };
  if(geo){ await geo.requestPermissions(); liveGpsWatchId = await geo.watchPosition({enableHighAccuracy:true},onUpdate); }
  else if('geolocation' in navigator){ liveGpsWatchId = navigator.geolocation.watchPosition(onUpdate, ()=>showToast('GPS bloqueado.')); }
}

function centerOnUserOrTruck(){
  const target = userCurrentCoords || (navMarker ? [navMarker.getLngLat().lng, navMarker.getLngLat().lat] : null);
  if(!target){ showToast('Toque primeiro em 📍 para localizar.'); return; }
  if(usingLeaflet && lMap) lMap.setView([target[1], target[0]], 15);
  else if(map) map.flyTo({ center:target, zoom:15.5, pitch: settings.is3D ? 58 : 0 });
}

function swapOriginDest(){
  const o=document.getElementById('origin-input'), d=document.getElementById('dest-input');
  const tmp=o.value; o.value=d.value; d.value=tmp; customOriginCoords=null;
}

function switchTab(tab){
  document.querySelectorAll('.tab-view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById('view-'+tab).classList.add('active');
  document.getElementById('nav-'+tab).classList.add('active');
  if(tab==='map') resizeActiveMap();
}

async function geocode(query){
  try{
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`);
    const d = await r.json();
    if(d && d.
