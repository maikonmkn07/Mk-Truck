let lMap = null, lRouteLayers = [], lNavMarker = null, lEndMarker = null;
let routeOptions = [], selectedRouteIdx = 0, routeCoords = [];
let simInterval = null, simIndex = 0, lastSpeedWarn = 0, isNavigating = false;
let customOriginCoords = null, userCurrentCoords = null, liveGpsWatchId = null;

let settings = {
  theme:'night', navIconMode:'auto', homeAddress:'', workAddress:'',
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
  try{ if(lMap) setTimeout(()=>lMap.invalidateSize(), 150); }catch(e){}
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
    s.src = src; s.async = true; s.onload = resolve; s.onerror = reject;
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

async function initMap2D(){
  try{
    try{ await loadCss('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'); }
    catch(e){ await loadCss('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css'); }
    if(typeof L === 'undefined'){
      try{ await loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'); }
      catch(e){ await loadScript('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js'); }
    }
    lMap = L.map('map', { zoomControl:false, attributionControl:false }).setView([41.1, -8.4], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19 }).addTo(lMap);

    const pos = await getNativeLocation(true);
    if(pos){
      userCurrentCoords = pos; customOriginCoords = pos;
      document.getElementById('origin-input').value = '📍 Minha Localização';
      updateNavMarker(pos, 0);
      lMap.setView([pos[1], pos[0]], 15);
    }
  }catch(err){
    showToast('⚠️ Ligue a internet para carregar o mapa.');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  try{ loadSettings(); }catch(e){}
  try{ loadProfile(); }catch(e){}
  try{ renderPoiList(); }catch(e){}
  setInterval(tickTacho, 1000);
  initAutoUpdater();
  initMap2D();
});

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
  if(!lMap || typeof L === 'undefined') return;
  const type = getActiveIconType();
  const icon = L.divIcon({ className:'nav-marker-wrap', html:getNavSvg(type, bearing), iconSize:[44,44], iconAnchor:[22,22] });
  if(!lNavMarker) lNavMarker = L.marker([coords[1], coords[0]], { icon }).addTo(lMap);
  else { lNavMarker.setIcon(icon); lNavMarker.setLatLng([coords[1], coords[0]]); }
}

function setNavIconMode(mode){
  settings.navIconMode = mode;
  document.querySelectorAll('#navicon-auto,#navicon-truck,#navicon-arrow').forEach(el=>el.classList.remove('active'));
  document.getElementById('navicon-'+mode).classList.add('active');
  localStorage.setItem('mk_truck_settings', JSON.stringify(settings));
  const pos = lNavMarker ? [lNavMarker.getLatLng().lng, lNavMarker.getLatLng().lat] : userCurrentCoords;
  if(pos) updateNavMarker(pos, 0);
}

function openSettings(){ document.getElementById('settings-modal').classList.add('open'); }
function closeSettings(){ document.getElementById('settings-modal').classList.remove('open'); }

function setTheme(t){
  settings.theme = t;
  document.body.classList.toggle('light-mode', t==='light');
  document.getElementById('theme-light').classList.toggle('active', t==='light');
  document.getElementById('theme-night').classList.toggle('active', t==='night');
  localStorage.setItem('mk_truck_settings', JSON.stringify(settings));
}

function saveSettings(){
  settings.homeAddress = document.getElementById('set-home-addr').value.trim();
  settings.workAddress = document.getElementById('set-work-addr').value.trim();
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
  document.getElementById('set-home-addr').value = settings.homeAddress || '';
  document.getElementById('set-work-addr').value = settings.workAddress || '';
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
  applySettingsUI();
}

function applySettingsUI(){
  document.getElementById('btn-voice').innerText = settings.voiceEnabled ? '🔊 Voz: ON' : '🔇 Voz: OFF';
  document.getElementById('hud-limit').innerText = settings.units==='mph' ? '50' : '80';
  document.getElementById('hud-unit-lbl').innerText = settings.units==='mph' ? 'mph (HGV)' : 'km/h (HGV)';
}

/* ATALHOS CASA E TRABALHO */
async function fillSavedAddrWithGps(type){
  showToast('A obter endereço atual...');
  const coords = await getNativeLocation(false);
  if(!coords) return;
  let txt = `${coords[1].toFixed(5)}, ${coords[0].toFixed(5)}`;
  try{
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${coords[1]}&lon=${coords[0]}`);
    const d = await r.json();
    const road = d.address?.road || '';
    const city = d.address?.city || d.address?.town || d.address?.village || '';
    if(road || city) txt = [road, city].filter(Boolean).join(', ');
  }catch(e){}
  document.getElementById(type==='home' ? 'set-home-addr' : 'set-work-addr').value = txt;
  saveSettings();
  showToast((type==='home' ? '🏠 Casa' : '🏢 Trabalho') + ' guardado: ' + txt);
}

function goToSavedPlace(type){
  const addr = type==='home' ? settings.homeAddress : settings.workAddress;
  if(!addr){
    showToast(`Defina primeiro o endereço de ${type==='home'?'Casa':'Trabalho'} nas Configurações ⚙️.`);
    openSettings();
    return;
  }
  document.getElementById('dest-input').value = addr;
  calculateTruckRoute();
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
  if(lMap) lMap.setView([coords[1], coords[0]], 15);
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

function updateStartButtonUI(){
  const btn = document.getElementById('btn-start-nav');
  if(!btn) return;
  if(isNavigating){
    btn.classList.add('running');
    btn.innerHTML = '⏹️ Parar';
  }else{
    btn.classList.remove('running');
    btn.innerHTML = '▶️ Iniciar';
  }
}

async function toggleStartNav(){
  if(isNavigating){
    if(simInterval){ clearInterval(simInterval); simInterval=null; document.getElementById('btn-sim').innerText='▶️'; }
    if(liveGpsWatchId !== null) await toggleLiveGps();
    else{
      isNavigating = false;
      setTachoMode('rest');
      updateStartButtonUI();
      if(routeCoords[0]) updateNavMarker(routeCoords[0], 0);
    }
    showToast('Navegação parada.');
    return;
  }
  if(routeCoords.length < 2){ showToast('Escolha um destino e uma rota primeiro!'); return; }
  if(simInterval){ clearInterval(simInterval); simInterval=null; document.getElementById('btn-sim').innerText='▶️'; }
  if(liveGpsWatchId === null) await toggleLiveGps();
  else { isNavigating = true; updateStartButtonUI(); }
  const startPt = userCurrentCoords || routeCoords[0];
  const brg = routeCoords.length>1 ? calcBearing(routeCoords[0], routeCoords[1]) : 0;
  updateNavMarker(startPt, brg);
  if(lMap) lMap.setView([startPt[1], startPt[0]], 16);
}

async function toggleLiveGps(){
  const btn = document.getElementById('btn-live-gps');
  const geo = window.Capacitor?.Plugins?.Geolocation;
  if(liveGpsWatchId !== null){
    if(geo) await geo.clearWatch({id:liveGpsWatchId}); else navigator.geolocation.clearWatch(liveGpsWatchId);
    liveGpsWatchId = null; isNavigating = false;
    btn.classList.remove('active-gps'); setTachoMode('rest'); updateStartButtonUI();
    if(userCurrentCoords) updateNavMarker(userCurrentCoords, 0);
    return;
  }
  btn.classList.add('active-gps'); isNavigating = true; setTachoMode('drive'); updateStartButtonUI();
  speak('Navegação iniciada. Siga pela rota azul.','route');
  const onUpdate = (pos)=>{
    if(!pos) return;
    const c = [pos.coords.longitude, pos.coords.latitude];
    const brg = pos.coords.heading || 0;
    userCurrentCoords = c;
    updateNavMarker(c, brg);
    if(lMap) lMap.panTo([c[1], c[0]]);
    if(pos.coords.speed !== null && pos.coords.speed >= 0) updateSpeedHud(pos.coords.speed*3.6);
  };
  if(geo){ await geo.requestPermissions(); liveGpsWatchId = await geo.watchPosition({enableHighAccuracy:true},onUpdate); }
  else if('geolocation' in navigator){ liveGpsWatchId = navigator.geolocation.watchPosition(onUpdate, ()=>showToast('GPS bloqueado.')); }
}

function centerOnUserOrTruck(){
  const target = userCurrentCoords || (lNavMarker ? [lNavMarker.getLatLng().lng, lNavMarker.getLatLng().lat] : null);
  if(!target){ showToast('Toque primeiro em 📍 para localizar.'); return; }
  if(lMap) lMap.setView([target[1], target[0]], 15);
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
    if(d && d.length>0) return [parseFloat(d[0].lon), parseFloat(d[0].lat)];
  }catch(e){}
  return null;
}

async function calculateTruckRoute(){
  const origTxt = document.getElementById('origin-input').value.trim();
  const destTxt = document.getElementById('dest-input').value.trim();
  if(!destTxt){ showToast('Escreva o destino primeiro!'); return; }

  showToast('A calcular rotas HGV...');
  let p1 = customOriginCoords;
  if(!p1) p1 = origTxt ? await geocode(origTxt) : userCurrentCoords;
  if(!p1) p1 = await getNativeLocation(true) || [-8.4265, 41.5454];
  const p2 = await geocode(destTxt);
  if(!p2){ showToast('Destino não encontrado. Tente incluir cidade/país.'); return; }

  routeOptions = [];
  const uAlt = `https://router.project-osrm.org/route/v1/driving/${p1[0]},${p1[1]};${p2[0]},${p2[1]}?overview=full&geometries=geojson&alternatives=3&steps=true`;
  const uNoHw = `https://router.project-osrm.org/route/v1/driving/${p1[0]},${p1[1]};${p2[0]},${p2[1]}?overview=full&geometries=geojson&exclude=motorway&steps=true`;
  const [rAlt, rNo] = await Promise.allSettled([fetch(uAlt).then(r=>r.json()), fetch(uNoHw).then(r=>r.json())]);

  if(rAlt.status==='fulfilled' && rAlt.value.routes){
    rAlt.value.routes.forEach((r,i)=>routeOptions.push({
      label: i===0 ? '⚡ Mais Rápida' : `🔀 Alternativa ${i+1}`,
      distanceKm: Math.round(r.distance/1000),
      coords: r.geometry.coordinates,
      isNoToll:false
    }));
  }
  if(rNo.status==='fulfilled' && rNo.value.routes?.[0]){
    const r = rNo.value.routes[0], km = Math.round(r.distance/1000);
    if(!routeOptions.some(o=>Math.abs(o.distanceKm-km)<=2 && o.coords.length===r.geometry.coordinates.length)){
      routeOptions.push({label:'💶 Sem Autoestrada', distanceKm:km, coords:r.geometry.coordinates, isNoToll:true});
    }
  }
  if(routeOptions.
