const state = { place: null, days: [], meta: {}, activeDay: 0, activeEvent: 'sunset' };
const $ = (id) => document.getElementById(id);
const circumference = 2 * Math.PI * 58;
const LAST_PLACE_KEY = 'sunscape:last-place:v1';

function esc(value='') { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function text(id, value='') { const el=$(id); if (el) el.textContent=value; }
function html(id, value='') { const el=$(id); if (el) el.innerHTML=value; }
function hidden(id, value) { const el=$(id); if (el) el.hidden=value; }
function formatTime(value) {
  const match = String(value || '').match(/T(\d{2}):(\d{2})/);
  if (!match) return '—';
  const date = new Date(Date.UTC(2000, 0, 1, Number(match[1]), Number(match[2])));
  return new Intl.DateTimeFormat(undefined, {hour:'2-digit', minute:'2-digit', timeZone:'UTC'}).format(date);
}
function formatDay(value) { return new Date(`${value}T12:00:00`).toLocaleDateString(undefined,{weekday:'short'}).toUpperCase(); }
function formatDate(value) { return new Date(`${value}T12:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric'}); }
function formatDaylight(seconds) {
  if (!Number.isFinite(Number(seconds))) return '—';
  const totalMinutes = Math.round(Number(seconds) / 60);
  return `${Math.floor(totalMinutes / 60)}h ${String(totalMinutes % 60).padStart(2,'0')}m`;
}
function showError(message='') { const el=$('error'); if (!el) return; el.textContent=message; el.hidden=!message; }
function setLocationBusy(busy,label='Use my location') {
  const b=$('location-button'); if (b) b.disabled=busy;
  text('location-label',busy?'Detecting location…':label);
}
function setSearchBusy(busy) {
  const b=$('search-button'); if (!b) return;
  b.disabled=busy; b.textContent=busy?'READING SKY':'READ THE SKY';
}
function finishBoot() {
  requestAnimationFrame(() => {
    document.body.classList.remove('booting');
    const boot = $('boot-screen');
    if (boot) boot.setAttribute('aria-hidden','true');
  });
}
function savePlace(place) {
  try { localStorage.setItem(LAST_PLACE_KEY, JSON.stringify(place)); } catch (_) {}
}
function getSavedPlace() {
  try {
    const value = JSON.parse(localStorage.getItem(LAST_PLACE_KEY) || 'null');
    return value && Number.isFinite(Number(value.latitude)) && Number.isFinite(Number(value.longitude)) ? value : null;
  } catch (_) { return null; }
}

async function searchPlaces(event) {
  event.preventDefault();
  const query=$('query')?.value.trim() || ''; if(query.length<2) return;
  showError(); setSearchBusy(true);
  try {
    const r=await fetch(`/api/search?q=${encodeURIComponent(query)}`, {cache:'no-store'}); const data=await r.json();
    if(!r.ok) throw new Error(data.error || 'Search failed');
    const box=$('results');
    if (box) {
      box.innerHTML=(data.results||[]).map((p,i)=>`<button type='button' data-place='${i}'><span><strong>${esc(p.name)}</strong><small>${esc([p.admin1,p.country].filter(Boolean).join(', '))}</small></span><b>→</b></button>`).join('');
      box.hidden=!(data.results||[]).length; box._places=data.results||[];
    }
  } catch(e){ showError(e.message||'Search failed'); }
  finally { setSearchBusy(false); }
}

async function loadForecast(place,{boot=false}={}) {
  state.place=place; hidden('results',true); showError(); setSearchBusy(true);
  try {
    const elevation = Number.isFinite(Number(place.elevation)) ? `&elevation=${encodeURIComponent(place.elevation)}` : '';
    const r=await fetch(`/api/forecast?lat=${encodeURIComponent(place.latitude)}&lon=${encodeURIComponent(place.longitude)}${elevation}`, {cache:'no-store'}); const data=await r.json();
    if(!r.ok) throw new Error(data.error || 'Forecast failed');
    if (!Array.isArray(data.days) || !data.days.length) throw new Error('Forecast returned no days');
    state.days=data.days;
    state.meta={timezone:data.timezone, timezoneAbbreviation:data.timezoneAbbreviation, elevation:data.elevation, historyDays:data.historyDays, method:data.method, modelStrategy:data.modelStrategy, build:data.build};
    state.activeDay=0; state.activeEvent='sunset';
    savePlace(place);
    render();
    return true;
  } catch(e){
    console.error('Sunscape forecast load failed', e);
    if (boot) {
      try { localStorage.removeItem(LAST_PLACE_KEY); } catch (_) {}
    } else {
      showError(e.message||'Forecast failed');
    }
    return false;
  } finally {
    setSearchBusy(false);
    if (boot) finishBoot();
  }
}

function detectLocation({silent=false,boot=false}={}) {
  return new Promise(resolve => {
    if (!navigator.geolocation) {
      if (!silent) showError('Location detection is not supported by this browser.');
      if (boot) finishBoot();
      resolve(false);
      return;
    }
    setLocationBusy(true);
    navigator.geolocation.getCurrentPosition(
      async pos => {
        const {latitude, longitude, altitude} = pos.coords;
        const place = {name:'Current location', admin1:'GPS detected', country:'', latitude, longitude};
        if (Number.isFinite(Number(altitude))) place.elevation = altitude;
        const ok = await loadForecast(place,{boot});
        if (ok) {
          const query=$('query'); if (query) query.value='Current location';
          setLocationBusy(false,'Location detected');
        } else {
          setLocationBusy(false);
        }
        resolve(ok);
      },
      err => {
        setLocationBusy(false);
        if (boot) finishBoot();
        if (!silent) {
          const message = err.code===1 ? 'Location permission was denied.' : 'Could not detect your location.';
          showError(message);
        }
        resolve(false);
      },
      {enableHighAccuracy:true, timeout:8000, maximumAge:10*60*1000}
    );
  });
}

function metric(label,value,sub=''){ return `<div class='metric'><span>${label}</span><strong>${value}</strong>${sub?`<small>${sub}</small>`:''}</div>`; }
function historyText(history) {
  if (!history || history.percentile == null) return '—';
  const percentile = Math.max(0, Math.min(100, Number(history.percentile)));
  const top = Math.max(1, 100 - percentile);
  return top <= 50 ? `Top ${top}%` : `${Math.round(percentile)}th pct`;
}
function render() {
  if(!state.place || !state.days.length) return;
  const day=state.days[state.activeDay];
  const featured=day?.[state.activeEvent];
  if (!day || !featured?.score || !featured?.conditions) {
    showError('Forecast data is incomplete. Refresh to try again.');
    return;
  }

  document.body.classList.remove('landing');
  hidden('dashboard',false); hidden('teasers',true);
  text('place-name',state.place.name || 'Selected location');
  const metaBits=[state.place.admin1,state.place.country].filter(Boolean);
  if(state.meta.timezoneAbbreviation) metaBits.push(state.meta.timezoneAbbreviation);
  if(Number.isFinite(Number(state.meta.elevation))) metaBits.push(`${Math.round(Number(state.meta.elevation))} m elevation`);
  text('place-meta',metaBits.join(' · '));
  document.querySelectorAll('[data-event]').forEach(b=>b.classList.toggle('active',b.dataset.event===state.activeEvent));

  text('event-kicker',`${state.activeEvent.toUpperCase()} POTENTIAL`);
  text('score-value',featured.score.score ?? '—');
  text('score-label',featured.score.label || '');
  text('event-time',formatTime(featured.time));
  text('reason',(featured.score.reasons || []).slice(0,2).join(' '));
  text('history-rank',historyText(featured.history));
  text('history-rank-sub',featured.history?.sampleDays ? `vs ${featured.history.sampleDays} recent weather-pattern days` : 'historical context unavailable');
  text('confidence',featured.confidence?.label || '—');
  text('confidence-sub',featured.confidence?.detail || '');
  text('daylight',formatDaylight(day.daylightSeconds));

  const progress=$('score-progress');
  if (progress) {
    const score=Math.max(0,Math.min(100,Number(featured.score.score)||0));
    progress.style.strokeDasharray=circumference;
    progress.style.strokeDashoffset=circumference-(score/100)*circumference;
  }

  const c=featured.conditions;
  html('cloud-profile',[['HIGH',c.highCloud],['MID',c.midCloud],['LOW',c.lowCloud]].map(([n,v])=>{
    const value=Number(v)||0;
    return `<div class='cloud-layer'><div class='layer-meta'><span>${n}</span><strong>${Math.round(value)}%</strong></div><div class='layer-track'><span style='width:${Math.max(2,Math.min(100,value))}%'></span></div></div>`;
  }).join('')+`<div class='horizon-marker'><span>HORIZON</span></div>`);

  const spread=Number(c.dewpointSpread||0);
  const pressure=Number(c.pressureMsl||0);
  const wind=Number(c.windSpeed||0);
  html('metrics',
    metric('Visibility',`${Number(c.visibilityKm||0).toFixed(1)} km`,'lower-air clarity')+
    metric('Humidity',`${Math.round(Number(c.humidity)||0)}%`,'surface moisture')+
    metric('Precipitation',`${Number(c.precipitation||0).toFixed(1)} mm`,'event window')+
    metric('Dew-point spread',`${spread.toFixed(1)}°C`,spread<=2?'fog/mist risk':'air not saturated')+
    metric('Pressure',pressure?`${Math.round(pressure)} hPa`:'—','sea-level pressure')+
    metric('Wind',`${Math.round(wind)} km/h`,'surface flow')
  );

  html('day-strip',state.days.map((d,i)=>{const e=d[state.activeEvent]; if(!e?.score) return ''; return `<button class='day ${i===state.activeDay?'active':''}' data-day='${i}'><span>${formatDay(d.date)}</span><strong>${e.score.score}</strong><span class='mini-track'><i style='width:${Math.max(0,Math.min(100,Number(e.score.score)||0))}%'></i></span><small>${formatTime(e.time)}</small></button>`}).join(''));
  html('forecast-grid',state.days.map(d=>`<article class='forecast-day panel'><div class='forecast-date'><span>${formatDay(d.date)}</span><small>${formatDate(d.date)}</small></div>${compact('☼','Sunrise',d.sunrise)}${compact('◐','Sunset',d.sunset)}</article>`).join(''));
}
function compact(icon,title,f){
  if (!f?.score) return '';
  return `<div class='compact-forecast'><div class='compact-main'><span class='event-icon'>${icon}</span><div><small>${title}</small><strong>${formatTime(f.time)}</strong></div></div><div class='compact-score'><strong>${f.score.score}</strong><span>${esc(f.score.label||'')}</span></div></div>`;
}

async function init() {
  $('search-form')?.addEventListener('submit',searchPlaces);
  $('location-button')?.addEventListener('click',()=>detectLocation({silent:false}));
  $('results')?.addEventListener('click',e=>{const b=e.target.closest('[data-place]'); const box=$('results'); if(b && box?._places) loadForecast(box._places[Number(b.dataset.place)]);});
  document.querySelector('.event-toggle')?.addEventListener('click',e=>{const b=e.target.closest('[data-event]'); if(b){state.activeEvent=b.dataset.event; render();}});
  $('day-strip')?.addEventListener('click',e=>{const b=e.target.closest('[data-day]'); if(b){state.activeDay=Number(b.dataset.day); render();}});

  const saved = getSavedPlace();
  if (saved) {
    const query=$('query'); if (query) query.value=saved.name || '';
    const loaded = await loadForecast(saved,{boot:true});
    if (loaded) return;
    document.body.classList.add('booting');
  }

  await detectLocation({silent:true,boot:true});
}

document.addEventListener('DOMContentLoaded',init);
