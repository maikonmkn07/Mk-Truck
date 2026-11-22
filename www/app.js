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
function resizeActiveMap(){ try{ if(lMap) setTimeout(()=>lMap.invalidateSize(), 150); }catch(e){} }

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
  return new Promise((res, rej)=>{ const s=document.createElement('script'); s.src=src; s.async=true; s.onload=res; s.onerror=rej; document.head.appendChild(s); });
}
function loadCss(href){
  return new Promise((res)=>{ const l=document.createElement('link'); l.rel='stylesheet'; l.href=href; l.onload=res; l.onerror=res; document.head.appendChild(l); setTimeout(res,1800); });
}

async function initMap2D(){
  try{
    try{ await loadCss('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'); }catch(e){ await loadCss('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css'); }
    if(typeof L === 'undefined'){
      try{ await loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'); }catch(e){ await loadScript('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js'); }
    }
    lMap = L.map('map', { zoomControl:false, attributionControl:false }).setView([41.1, -8.4], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19 }).addTo(lMap);
    const pos = await getNativeLocation(true);
    if(pos){
      userCurrentCoords = pos; customOriginCoords = pos;
      document.getElementById('origin-input').value = '📍 A obter rua...';
      updateNavMarker(pos, 0);
      lMap.setView([pos[1], pos[0]], 16);
      reverseFillOrigin(pos);
    }
  }catch(err){ showToast('⚠️ Ligue a internet para carregar o mapa.'); }
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
  if(type === 'arrow') return `<svg style="transform:rotate(${rot}deg)" viewBox="0 0 64 64" width="44" height="44"><circle cx="32" cy="32" r="24" fill="#0f172a" fill-opacity="0.88" stroke="#38bdf8" stroke-width="3"/><path d="M32 10 L48 48 L32 40 L16 48 Z" fill="#38bdf8" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="round"/></svg>`;
  return `<svg style="transform:rotate(${rot}deg)" viewBox="0 0 64 64" width="46" height="46"><circle cx="32" cy="32" r="26" fill="#0f172a" fill-opacity="0.85" stroke="#38bdf8" stroke-width="2.5"/><rect x="20" y="13" width="24" height="36" rx="6" fill="#0ea5e9" stroke="#ffffff" stroke-width="2"/><rect x="23" y="17" width="18" height="8" rx="2" fill="#091326"/><rect x="23" y="10" width="5" height="3" rx="1" fill="#fef08a"/><rect x="36" y="10" width="5" height="3" rx="1" fill="#fef08a"/></svg>`;
}
function updateNavMarker(coords, bearing=0){
  if(!lMap || typeof L === 'undefined') return;
  const icon = L.divIcon({ className:'nav-marker-wrap', html:getNavSvg(getActiveIconType(), bearing), iconSize:[44,44], iconAnchor:[22,22] });
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

async function reverseGeocodeLabel(coords){
  try{
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${coords[1]}&lon=${coords[0]}&zoom=18&addressdetails=1&accept-language=pt`);
    if(r.ok){
      const d = await r.json();
      const a = d.address || {};
      const street = a.road || a.pedestrian || a.residential || a.path || a.footway || a.cycleway || '';
      const num = a.house_number ? ` ${a.house_number}` : '';
      const local = a.neighbourhood || a.quarter || a.suburb || a.hamlet || a.village || a.town || a.city || '';
      const full = [street ? (street + num) : '', local].filter(Boolean).join(', ');
      if(full) return full;
      if(d.display_name) return d.display_name.split(',').slice(0,2).map(s=>s.trim()).join(', ');
    }
  }catch(e){}
  try{
    const r2 = await fetch(`https://photon.komoot.io/reverse?lat=${coords[1]}&lon=${coords[0]}`);
    if(r2.ok){
      const d2 = await r2.json();
      const p = d2.features?.[0]?.properties;
      if(p){
        const street = p.street || p.name || '';
        const num = p.housenumber ? ` ${p.housenumber}` : '';
        const local = p.district || p.locality || p.city || '';
        const full = [street ? (street + num) : '', local].filter(Boolean).join(', ');
        if(full) return full;
      }
    }
  }catch(e){}
  try{
    const r3 = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${coords[1]}&longitude=${coords[0]}&localityLanguage=pt`);
    if(r3.ok){
      const d3 = await r3.json();
      const full = [d3.locality, d3.city].filter(Boolean).join(', ');
      if(full) return full;
    }
  }catch(e){}
  return '';
}

async function reverseFillOrigin(coords){
  const place = await reverseGeocodeLabel(coords);
  document.getElementById('origin-input').value = place ? `📍 ${place}` : '📍 Minha Localização';
}

async function fillSavedAddrWithGps(type){
  showToast('A obter endereço atual pelo GPS...');
  const coords = await getNativeLocation(false);
  if(!coords) return;
  const place = await reverseGeocodeLabel(coords);
  const txt = place || `${coords[1].toFixed(5)}, ${coords[0].toFixed(5)}`;
  document.getElementById(type==='home' ? 'set-home-addr' : 'set-work-addr').value = txt;
  saveSettings();
  showToast((type==='home' ? '🏠 Casa' : '🏢 Trabalho') + ' guardado: ' + txt);
}
function goToSavedPlace(type){
  const addr = type==='home' ? settings.homeAddress : settings.workAddress;
  if(!addr){ showToast(`Defina primeiro o endereço de ${type==='home'?'Casa':'Trabalho'} nas Configurações ⚙️.`); openSettings(); return; }
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
  const s = {'pt-PT':'MK Truck pronto para a viagem. Siga em frente e boa estrada.','pt-BR':'MK Truck pronto para a viagem. Siga em frente e boa viagem.','es-ES':'MK Truck listo para el viaje. Siga adelante.','en-GB':'MK Truck ready for your journey. Drive safely.'};
  speak(s[settings.voiceLang] || s['pt-PT'], 'test', true);
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
          const p = chosenLang.split('-')[0].toLowerCase();
          chosenLang = langs.find(l => l.toLowerCase().startsWith(p)) || langs[0];
        }
      }catch(e){}
      await tts.speak({ text, lang: chosenLang, rate, pitch, volume:1.0 });
      return;
    }catch(err1){
      try{ await tts.speak({ text, rate, pitch, volume:1.0 }); return; }
      catch(err2){ if(interactive){ showToast('Pacote de voz não instalado. A abrir definições...'); try{ await tts.openInstall(); }catch(e3){} } }
    }
  }
  if('speechSynthesis' in window){
    const u = new SpeechSynthesisUtterance(text); u.lang = settings.voiceLang; u.rate = rate; u.pitch = pitch;
    window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
  }else if(interactive) showToast('Voz indisponível neste navegador.');
}

async function getNativeLocation(silent=false){
  const geo = window.Capacitor?.Plugins?.Geolocation;
  if(geo){
    try{
      await geo.requestPermissions();
      if(!silent){
        return await new Promise((resolve)=>{
          let best = null, wid = null, done = false;
          const finish = (c)=>{ if(done) return; done=true; if(wid!==null) geo.clearWatch({id:wid}).catch(()=>{}); resolve(c); };
          const timer = setTimeout(()=>{
            if(best) finish(best);
            else geo.getCurrentPosition({enableHighAccuracy:true, maximumAge:0, timeout:6000})
              .then(p=>finish([p.coords.longitude, p.coords.latitude]))
              .catch(()=>{ showToast('Sem sinal GPS atual. Verifique se o GPS está ligado.'); finish(null); });
          }, 3500);
          geo.watchPosition({enableHighAccuracy:true, maximumAge:0, timeout:10000, minimumUpdateInterval:400}, (pos, err)=>{
            if(err){ if(!best){ clearTimeout(timer); showToast('Ative o GPS do telemóvel.'); finish(null); } return; }
            if(!pos) return;
            const c = [pos.coords.longitude, pos.coords.latitude];
            best = c;
            if(pos.coords.accuracy && pos.coords.accuracy <= 60){ clearTimeout(timer); finish(c); }
          }).then(id=>{ wid = id; if(done && wid!==null) geo.clearWatch({id:wid}).catch(()=>{}); });
        });
      }
      const pos = await geo.getCurrentPosition({enableHighAccuracy:true, maximumAge:0, timeout:10000});
      return [pos.coords.longitude, pos.coords.latitude];
    }catch(e){ if(!silent) showToast('Ative o GPS no telemóvel e permita a localização.'); return null; }
  }
  if('geolocation' in navigator){
    return new Promise(res=>{ navigator.geolocation.getCurrentPosition(p=>res([p.coords.longitude,p.coords.latitude]), ()=>{ if(!silent) showToast('GPS bloqueado neste navegador.'); res(null); }, {enableHighAccuracy:true, maximumAge:0, timeout:7000}); });
  }
  if(!silent) showToast('GPS indisponível.');
  return null;
}

async function useMyLocationAsOrigin(){
  showToast('A procurar a sua localização exata...');
  const coords = await getNativeLocation(false);
  if(!coords) return;
  userCurrentCoords = coords; customOriginCoords = coords;
  updateNavMarker(coords, 0);
  if(lMap) lMap.setView([coords[1], coords[0]], 16);
  const inp = document.getElementById('origin-input');
  inp.value = '📍 A obter nome da rua...';
  const place = await reverseGeocodeLabel(coords);
  inp.value = place ? `📍 ${place}` : `📍 ${coords[1].toFixed(4)}, ${coords[0].toFixed(4)}`;
  showToast(place ? `📍 ${place}` : '📍 Localização atualizada!');
  speak('Localização atual definida como origem.','route');
}

function updateSpeedHud(kmh){
  document.getElementById('hud-speed').innerText = settings.units==='mph' ? Math.round(kmh*0.621371) : Math.round(kmh);
  const box = document.getElementById('speed-box');
  if(settings.speedAlert && kmh>82){
    box.classList.add('overspeed');
    if(Date.now()-lastSpeedWarn>15000){ lastSpeedWarn=Date.now(); speak('Atenção: excesso de velocidade para pesados.','hazard'); }
  }else box.classList.remove('overspeed');
}

function setNavigationUI(active){
  isNavigating = active;
  const btn = document.getElementById('btn-start-nav'), topBar = document.getElementById('map-top-bar'), banner = document.getElementById('nav-banner');
  if(btn){ btn.classList.toggle('running', active); btn.innerHTML = active ? '⏹️ Parar' : '▶️ Iniciar'; }
  if(topBar) topBar.classList.toggle('hidden', active);
  if(banner){
    banner.classList.toggle('visible', active);
    if(active && routeOptions[selectedRouteIdx]){
      const opt = routeOptions[selectedRouteIdx];
      document.getElementById('nav-step-title').innerText = opt.firstStep || 'Siga pela rota azul';
      document.getElementById('nav-step-sub').innerText = `${opt.label} • ${opt.distanceKm} km até ao destino`;
    }
  }
}

async function toggleStartNav(){
  if(isNavigating){
    if(simInterval){ clearInterval(simInterval); simInterval=null; document.getElementById('btn-sim').innerText='▶️'; }
    if(liveGpsWatchId !== null) await toggleLiveGps();
    setNavigationUI(false); setTachoMode('rest');
    if(routeCoords[0]) updateNavMarker(routeCoords[0], 0);
    showToast('Navegação parada.');
    return;
  }
  if(routeCoords.length < 2){ showToast('Escolha um destino e uma rota primeiro!'); return; }
  if(simInterval){ clearInterval(simInterval); simInterval=null; document.getElementById('btn-sim').innerText='▶️'; }
  setNavigationUI(true); setTachoMode('drive');
  const startPt = userCurrentCoords || routeCoords[0];
  const brg = routeCoords.length>1 ? calcBearing(routeCoords[0], routeCoords[1]) : 0;
  updateNavMarker(startPt, brg);
  if(lMap) lMap.setView([startPt[1], startPt[0]], 17);
  const opt = routeOptions[selectedRouteIdx];
  speak('Navegação iniciada. ' + (opt?.firstStep || 'Siga pela rota azul.'), 'route');
  if(liveGpsWatchId === null) await startWatchGpsOnly();
}

async function startWatchGpsOnly(){
  const btn = document.getElementById('btn-live-gps'), geo = window.Capacitor?.Plugins?.Geolocation;
  const onUpdate = (pos)=>{
    if(!pos) return;
    const c = [pos.coords.longitude, pos.coords.latitude], brg = pos.coords.heading || 0;
    userCurrentCoords = c; updateNavMarker(c, brg);
    if(lMap) lMap.panTo([c[1], c[0]]);
    if(pos.coords.speed !== null && pos.coords.speed >= 0) updateSpeedHud(pos.coords.speed*3.6);
  };
  try{
    if(geo){ await geo.requestPermissions(); liveGpsWatchId = await geo.watchPosition({enableHighAccuracy:true, maximumAge:0, minimumUpdateInterval:1000}, onUpdate); btn.classList.add('active-gps'); }
    else if('geolocation' in navigator){ liveGpsWatchId = navigator.geolocation.watchPosition(onUpdate, ()=>showToast('GPS bloqueado.'), {enableHighAccuracy:true, maximumAge:0}); btn.classList.add('active-gps'); }
  }catch(e){}
}

async function toggleLiveGps(){
  const btn = document.getElementById('btn-live-gps'), geo = window.Capacitor?.Plugins?.Geolocation;
  if(liveGpsWatchId !== null){
    if(geo) await geo.clearWatch({id:liveGpsWatchId}); else navigator.geolocation.clearWatch(liveGpsWatchId);
    liveGpsWatchId = null; btn.classList.remove('active-gps');
    setNavigationUI(false); setTachoMode('rest');
    if(userCurrentCoords) updateNavMarker(userCurrentCoords, 0);
    return;
  }
  setNavigationUI(true); setTachoMode('drive');
  speak('Seguimento GPS ao vivo ativado.','route');
  await startWatchGpsOnly();
}

async function centerOnUserOrTruck(){
  showToast('A centrar na posição atual...');
  const fresh = await getNativeLocation(false);
  if(fresh){
    userCurrentCoords = fresh;
    updateNavMarker(fresh, 0);
    if(lMap) lMap.setView([fresh[1], fresh[0]], 16);
    return;
  }
  const target = userCurrentCoords || (lNavMarker ? [lNavMarker.getLatLng().lng, lNavMarker.getLatLng().lat] : null);
  if(target && lMap) lMap.setView([target[1], target[0]], 16);
}
function swapOriginDest(){ const o=document.getElementById('origin-input'), d=document.getElementById('dest-input'); const t=o.value; o.value=d.value; d.value=t; customOriginCoords=null; }
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
function extractFirstStep(route){
  try{
    const steps = route.legs?.[0]?.steps;
    if(!steps || steps.length===0) return 'Siga pela rota azul';
    const st = steps.find(s=>s.name) || steps[0];
    return st.name ? `Siga por ${st.name}` : 'Siga pela rota azul';
  }catch(e){ return 'Siga pela rota azul'; }
}

async function calculateTruckRoute(){
  const origTxt = document.getElementById('origin-input').value.trim(), destTxt = document.getElementById('dest-input').value.trim();
  if(!destTxt){ showToast('Escreva o destino primeiro!'); return; }
  showToast('A calcular rotas HGV...');
  let p1 = null;
  if(origTxt.startsWith('📍')){
    p1 = await getNativeLocation(true) || customOriginCoords || userCurrentCoords;
  }else if(origTxt){
    p1 = await geocode(origTxt);
  }else{
    p1 = await getNativeLocation(true) || userCurrentCoords;
  }
  if(!p1){ showToast('Defina a origem ou toque em 📍.'); return; }
  const p2 = await geocode(destTxt);
  if(!p2){ showToast('Destino não encontrado. Tente incluir cidade/país.'); return; }

  routeOptions = [];
  const uAlt = `https://router.project-osrm.org/route/v1/driving/${p1[0]},${p1[1]};${p2[0]},${p2[1]}?overview=full&geometries=geojson&alternatives=3&steps=true`;
  const uNoHw = `https://router.project-osrm.org/route/v1/driving/${p1[0]},${p1[1]};${p2[0]},${p2[1]}?overview=full&geometries=geojson&exclude=motorway&steps=true`;
  const [rAlt, rNo] = await Promise.allSettled([fetch(uAlt).then(r=>r.json()), fetch(uNoHw).then(r=>r.json())]);

  if(rAlt.status==='fulfilled' && rAlt.value.routes){
    rAlt.value.routes.forEach((r,i)=>routeOptions.push({ label: i===0?'⚡ Mais Rápida':`🔀 Alternativa ${i+1}`, distanceKm:Math.round(r.distance/1000), coords:r.geometry.coordinates, firstStep:extractFirstStep(r), isNoToll:false }));
  }
  if(rNo.status==='fulfilled' && rNo.value.routes?.[0]){
    const r = rNo.value.routes[0], km = Math.round(r.distance/1000);
    if(!routeOptions.some(o=>Math.abs(o.distanceKm-km)<=2 && o.coords.length===r.geometry.coordinates.length)){
      routeOptions.push({label:'💶 Sem Autoestrada', distanceKm:km, coords:r.geometry.coordinates, firstStep:extractFirstStep(r), isNoToll:true});
    }
  }
  if(routeOptions.length===0) routeOptions.push({label:'⚡ Rota Direta', distanceKm:50, coords:[p1,p2], firstStep:'Siga pela rota azul', isNoToll:false});

  let idx = 0;
  if(settings.avoidTolls){ const n=routeOptions.findIndex(o=>o.isNoToll); if(n!==-1) idx=n; }
  setNavigationUI(false);
  selectRoute(idx, origTxt || 'Origem', destTxt);
  speak(`Encontradas ${routeOptions.length} rotas para ${destTxt}. Escolha uma e toque em Iniciar.`, 'route');
}

function computeRouteStats(opt){
  const driveH = opt.distanceKm / (opt.isNoToll ? 58 : 72);
  const totH = driveH + Math.floor(driveH/4.5)*0.75;
  const hh = Math.floor(totH), mm = Math.round((totH-hh)*60);
  const cons = parseFloat(document.getElementById('veh-fuel').value) || 31;
  const toll = opt.isNoToll ? 0 : (document.getElementById('veh-euro').value.includes('ev') ? 0.06 : 0.19);
  const cost = Math.round((opt.distanceKm/100)*cons*1.58 + opt.distanceKm*toll);
  const distDisp = settings.units==='mph' ? `${Math.round(opt.distanceKm*0.621371)} mi` : `${opt.distanceKm} km`;
  return {hh, mm, cost, distDisp};
}

function selectRoute(idx, origTxt, destTxt){
  selectedRouteIdx = idx;
  const opt = routeOptions[idx];
  routeCoords = opt.coords;
  if(lMap && typeof L !== 'undefined'){
    lRouteLayers.forEach(l=>lMap.removeLayer(l)); lRouteLayers = [];
    if(lEndMarker) lMap.removeLayer(lEndMarker);
    routeOptions.forEach((o,i)=>{
      if(i===idx) return;
      const line = L.polyline(o.coords.map(c=>[c[1],c[0]]), {color:'#64748b', weight:4, opacity:0.75, dashArray:'7,7'}).addTo(lMap);
      line.on('click', ()=>selectRoute(i));
      lRouteLayers.push(line);
    });
    const activeLine = L.polyline(routeCoords.map(c=>[c[1],c[0]]), {color:'#38bdf8', weight:6, opacity:0.95}).addTo(lMap);
    lRouteLayers.push(activeLine);
    const end = routeCoords[routeCoords.length-1];
    lEndMarker = L.circleMarker([end[1], end[0]], {radius:8, color:'#ffffff', weight:2, fillColor:'#ef4444', fillOpacity:1}).addTo(lMap);
    lMap.fitBounds(activeLine.getBounds(), {padding:[130, 130]});
  }
  updateNavMarker(routeCoords[0], routeCoords.length>1 ? calcBearing(routeCoords[0], routeCoords[1]) : 0);
  simIndex = 0;

  const st = computeRouteStats(opt);
  const oLbl = (origTxt || document.getElementById('origin-input').value || 'Atual').replace('📍 ','').split(',')[0];
  const dLbl = (destTxt || document.getElementById('dest-input').value || 'Destino').split(',')[0];
  document.getElementById('route-summary').classList.add('visible');
  document.getElementById('summary-title').innerText = `${opt.label} (${oLbl} → ${dLbl})`;
  document.getElementById('summary-details').innerText = `${st.distDisp} • ${st.hh}h ${st.mm}m • Est.: €${st.cost}`;

  const chooser = document.getElementById('routes-chooser');
  chooser.innerHTML = ''; chooser.classList.add('visible');
  routeOptions.forEach((o,i)=>{
    const s = computeRouteStats(o), b = document.createElement('button');
    b.className = 'route-option'+(i===idx?' selected':'');
    b.innerHTML = `<strong>${o.label}</strong>${s.distDisp} • ${s.hh}h${String(s.mm).padStart(2,'0')} • €${s.cost}`;
    b.onclick = ()=>{ selectRoute(i); speak(`${o.label.replace(/[^\w\sÀ-ÿ]/g,'')} selecionada. Toque em Iniciar.`,'route'); };
    chooser.appendChild(b);
  });
}

function calcBearing(c1, c2){
  const rad=d=>d*Math.PI/180, lat1=rad(c1[1]), lat2=rad(c2[1]), dLon=rad(c2[0]-c1[0]);
  return (Math.atan2(Math.sin(dLon)*Math.cos(lat2), Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLon))*180/Math.PI+360)%360;
}

function toggleSimulation(){
  if(simInterval){
    clearInterval(simInterval); simInterval=null;
    document.getElementById('btn-sim').innerText='▶️'; updateSpeedHud(0);
    setNavigationUI(false); setTachoMode('rest');
    if(routeCoords[simIndex]) updateNavMarker(routeCoords[simIndex], 0);
    return;
  }
  if(routeCoords.length<2){ showToast('Escreva um destino e toque em Ver Rotas primeiro!'); return; }
  setNavigationUI(true);
  document.getElementById('btn-sim').innerText='⏸️'; setTachoMode('drive');
  speak('Simulação iniciada. Siga pela rota azul.','route');
  simInterval = setInterval(()=>{
    const step = Math.max(1, Math.floor(routeCoords.length/90)), prev = routeCoords[simIndex];
    simIndex = Math.min(simIndex+step, routeCoords.length-1);
    const pos = routeCoords[simIndex];
    updateNavMarker(pos, calcBearing(prev, pos));
    if(lMap) lMap.panTo([pos[1], pos[0]]);
    updateSpeedHud(76 + Math.floor(Math.random()*9));
    if(simIndex === Math.floor(routeCoords.length*0.35)) speak('Atenção: ponte à frente com altura de 4 metros e 20.','hazard');
    if(simIndex >= routeCoords.length-1){ toggleSimulation(); speak('Chegou ao seu destino.','route'); }
  }, 600);
}

function openReportModal(){ document.getElementById('report-modal').classList.add('open'); }
function closeReportModal(){ document.getElementById('report-modal').classList.remove('open'); }
function addCommunityAlert(label){
  const pos = userCurrentCoords || (lNavMarker ? [lNavMarker.getLatLng().lng, lNavMarker.getLatLng().lat] : [-8.4, 41.1]);
  if(lMap && typeof L !== 'undefined') L.marker([pos[1], pos[0]]).bindPopup(`<b>${label}</b>`).addTo(lMap);
  closeReportModal(); showToast('Alerta partilhado!'); speak('Alerta registado para outros motoristas.','hazard');
}

function setTachoMode(m){
  tacho.mode=m; document.querySelectorAll('.mode-btn').forEach(b=>b.className='mode-btn');
  if(m==='drive') document.getElementById('mode-drive').classList.add('active-drive');
  if(m==='rest') document.getElementById('mode-rest').classList.add('active-rest');
  if(m==='work') document.getElementById('mode-work').classList.add('active-work');
}
function cycleSimSpeed(){ const s=[1,60,600], next=s[(s.indexOf(tacho.speedMult)+1)%s.length]; tacho.speedMult=next; document.getElementById('btn-sim-speed').innerText=`Velocidade: ${next}x`; }
function resetTacho(){ tacho.contUsed=0; tacho.dailyUsed=0; tacho.breakAcc=0; updateTachoUI(); }
function tickTacho(){
  const dt=tacho.speedMult;
  if(tacho.mode==='drive'){
    tacho.contUsed=Math.min(16200,tacho.contUsed+dt); tacho.dailyUsed=Math.min(32400,tacho.dailyUsed+dt);
    if(tacho.contUsed>=14400 && tacho.contUsed-dt<14400) speak('Atenção: restam 30 minutos de condução contínua.','hazard');
  }else if(tacho.mode==='rest'){ tacho.breakAcc=Math.min(2700,tacho.breakAcc+dt); if(tacho.breakAcc>=2700) tacho.contUsed=0; }
  updateTachoUI();
}
function formatHMS(sec){ sec=Math.max(0,Math.floor(sec)); return `${String(Math.floor(sec/3600)).padStart(2,'0')}h ${String(Math.floor((sec%3600)/60)).padStart(2,'0')}m`; }
function updateTachoUI(){
  const cl=16200-tacho.contUsed, dl=32400-tacho.dailyUsed, cp=(cl/16200)*100;
  document.getElementById('mini-drive-left').innerText=formatHMS(cl); document.getElementById('mini-daily-left').innerText=formatHMS(dl);
  document.getElementById('mini-drive-left').style.color=cp<20?'var(--danger)':'var(--success)';
  document.getElementById('lbl-cont').innerText=formatHMS(cl)+' restantes';
  document.getElementById('bar-cont').style.width=cp+'%';
  document.getElementById('bar-cont').style.background=cp<20?'var(--danger)':(cp<40?'var(--warn)':'var(--success)');
  document.getElementById('lbl-daily').innerText=formatHMS(dl)+' restantes';
  document.getElementById('bar-daily').style.width=((dl/32400)*100)+'%';
  document.getElementById('lbl-break').innerText=`${Math.floor(tacho.breakAcc/60)} / 45 min`;
  document.getElementById('bar-break').style.width=((tacho.breakAcc/2700)*100)+'%';
}
function renderPoiList(){
  const filter=document.getElementById('fuel-card-filter').value, remKm=Math.round(((16200-tacho.contUsed)/3600)*75);
  const list=document.getElementById('poi-list'); list.innerHTML='';
  currentPois.filter(p=>filter==='all'||p.cards.includes(filter)).forEach(p=>{
    const badge=p.freeSpots===0?`<span class="tag tag-bad">Lotado</span>`:(p.km<=remKm?`<span class="tag tag-ok">${p.freeSpots} vagas • Alcançável</span>`:`<span class="tag tag-warn">Excede 4h30</span>`);
    list.innerHTML+=`<div class="poi-item"><div><strong>${p.name}</strong><br><span style="color:var(--muted);">Km ${p.km} • Diesel €${p.diesel.toFixed(2)}/L • ${p.cards.join(', ')}</span></div><div>${badge}</div></div>`;
  });
}
function saveProfile(){
  const p={height:document.getElementById('veh-height').value,weight:document.getElementById('veh-weight').value,adr:document.getElementById('veh-adr').value};
  localStorage.setItem('mk_truck_profile',JSON.stringify(p));
  document.getElementById('lbl-h').innerText=p.height+'m'; document.getElementById('lbl-w').innerText=p.weight+'t';
}
function loadProfile(){
  const raw=localStorage.getItem('mk_truck_profile'); if(!raw) return;
  const p=JSON.parse(raw);
  if(p.height) document.getElementById('veh-height').value=p.height;
  if(p.weight) document.getElementById('veh-weight').value=p.weight;
  if(p.adr) document.getElementById('veh-adr').value=p.adr;
  document.getElementById('lbl-h').innerText=(p.height||'4.0')+'m'; document.getElementById('lbl-w').innerText=(p.weight||'40')+'t';
}
function askPreset(q){ document.getElementById('chat-input').value=q; sendChat(); }
function sendChat(){
  const inp=document.getElementById('chat-input'), q=inp.value.trim(); if(!q) return;
  inp.value=''; const box=document.getElementById('chat-messages');
  box.innerHTML+=`<div class="msg user">${q}</div>`;
  setTimeout(()=>{ box.innerHTML+=`<div class="msg bot">${getAiAnswer(q.toLowerCase())}</div>`; box.scrollTop=box.scrollHeight; },250);
}
function getAiAnswer(q){
  if(q.includes('10')||q.includes('conduzir')) return '⏱️ <strong>Condução Diária:</strong> Limite padrão de <strong>9h/dia</strong>, até <strong>10h no máximo 2x/semana</strong> (56h/semana, 90h/quinzena).';
  if(q.includes('45')||q.includes('pausa')) return '☕ <strong>Pausa Dividida:</strong> Os 45 min dividem-se em <strong>15 min primeiro + 30 min depois</strong>.';
  if(q.includes('semana')||q.includes('alemanha')||q.includes('frança')) return '🚫 <strong>Proibições (>7,5t):</strong> Alemanha (domingos 00h–22h) e França (sábado 22h–domingo 22h).';
  if(q.includes('adr')||q.includes('túnel')||q.includes('tunel')) return '☢️ <strong>Túneis ADR:</strong> B (mais restrito) até E (proibido à maioria das cargas ADR).';
  return '🚛 Posso ajudar com <strong>condução (9h/10h)</strong>, <strong>pausa dividida (15+30)</strong>, <strong>fim de semana</strong> ou <strong>ADR</strong>.';
}
// FIM_OK
