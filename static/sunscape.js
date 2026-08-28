const state = { place: null, days: [], activeDay: 0, activeEvent: 'sunset' };
const $ = (id) => document.getElementById(id);
const circumference = 2 * Math.PI * 58;

function esc(value='') { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function formatTime(value) { return new Date(value).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}); }
function formatDay(value) { return new Date(`${value}T12:00:00`).toLocaleDateString(undefined,{weekday:'short'}).toUpperCase(); }
function formatDate(value) { return new Date(`${value}T12:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric'}); }
function showError(message='') { const el=$('error'); el.textContent=message; el.hidden=!message; }
function setLocationBusy(busy,label='Use my location') { const b=$('location-button'); b.disabled=busy; $('location-label').textContent=busy?'Detecting location…':label; }

async function searchPlaces(event) {
  event.preventDefault();
  const query=$('query').value.trim(); if(query.length<2) return;
  showError(); $('search-button').disabled=true; $('search-button').textContent='SCANNING';
  try {
    const r=await fetch(`/api/search?q=${encodeURIComponent(query)}`); const data=await r.json();
    if(!r.ok) throw new Error(data.error || 'Search failed');
    const box=$('results'); box.innerHTML=(data.results||[]).map((p,i)=>`<button data-place='${i}'><span><strong>${esc(p.name)}</strong><small>${esc([p.admin1,p.country].filter(Boolean).join(', '))}</small></span><b>→</b></button>`).join('');
    box.hidden=!(data.results||[]).length; box._places=data.results||[];
  } catch(e){ showError(e.message||'Search failed'); }
  finally { $('search-button').disabled=false; $('search-button').textContent='SCAN SKY'; }
}

async function loadForecast(place) {
  state.place=place; $('results').hidden=true; showError(); $('search-button').disabled=true; $('search-button').textContent='SCANNING';
  try {
    const r=await fetch(`/api/forecast?lat=${encodeURIComponent(place.latitude)}&lon=${encodeURIComponent(place.longitude)}`); const data=await r.json();
    if(!r.ok) throw new Error(data.error || 'Forecast failed');
    state.days=data.days||[]; state.activeDay=0; state.activeEvent='sunset'; render();
  } catch(e){ showError(e.message||'Forecast failed'); }
  finally { $('search-button').disabled=false; $('search-button').textContent='SCAN SKY'; }
}

function detectLocation({silent=false}={}) {
  if (!navigator.geolocation) {
    if (!silent) showError('Location detection is not supported by this browser.');
    return;
  }
  setLocationBusy(true);
  navigator.geolocation.getCurrentPosition(
    async pos => {
      const {latitude, longitude} = pos.coords;
      const place = {name:'Current location', admin1:'GPS detected', country:'', latitude, longitude};
      try {
        await loadForecast(place);
        $('query').value='Current location';
        setLocationBusy(false,'Location detected');
      } catch (_) {
        setLocationBusy(false);
      }
    },
    err => {
      setLocationBusy(false);
      if (!silent) {
        const message = err.code===1 ? 'Location permission was denied.' : 'Could not detect your location.';
        showError(message);
      }
    },
    {enableHighAccuracy:false, timeout:8000, maximumAge:15*60*1000}
  );
}

function metric(label,value){ return `<div class='metric'><span>${label}</span><strong>${value}</strong></div>`; }
function render() {
  if(!state.place || !state.days.length) return;
  document.body.classList.remove('landing');
  $('dashboard').hidden=false; $('teasers').hidden=true;
  $('place-name').textContent=state.place.name; $('place-meta').textContent=[state.place.admin1,state.place.country].filter(Boolean).join(', ');
  document.querySelectorAll('[data-event]').forEach(b=>b.classList.toggle('active',b.dataset.event===state.activeEvent));
  const featured=state.days[state.activeDay][state.activeEvent];
  $('event-kicker').textContent=`${state.activeEvent.toUpperCase()} POTENTIAL`; $('score-value').textContent=featured.score.score; $('score-label').textContent=featured.score.label;
  $('event-time').textContent=formatTime(featured.time); $('reason').textContent=featured.score.reasons[0]||'';
  const progress=$('score-progress'); progress.style.strokeDasharray=circumference; progress.style.strokeDashoffset=circumference-(featured.score.score/100)*circumference;
  const c=featured.conditions;
  $('cloud-profile').innerHTML=[['HIGH',c.highCloud],['MID',c.midCloud],['LOW',c.lowCloud]].map(([n,v])=>`<div class='cloud-layer'><div class='layer-meta'><span>${n}</span><strong>${Math.round(v)}%</strong></div><div class='layer-track'><span style='width:${Math.max(2,v)}%'></span></div></div>`).join('')+`<div class='horizon-marker'><span>HORIZON</span></div>`;
  $('metrics').innerHTML=metric('Visibility',`${c.visibilityKm} km`)+metric('Humidity',`${Math.round(c.humidity)}%`)+metric('Precipitation',`${Number(c.precipitation).toFixed(1)} mm`);
  $('day-strip').innerHTML=state.days.map((d,i)=>{const e=d[state.activeEvent]; return `<button class='day ${i===state.activeDay?'active':''}' data-day='${i}'><span>${formatDay(d.date)}</span><strong>${e.score.score}</strong><span class='mini-track'><i style='width:${e.score.score}%'></i></span><small>${formatTime(e.time)}</small></button>`}).join('');
  $('forecast-grid').innerHTML=state.days.map(d=>`<article class='forecast-day panel'><div class='forecast-date'><span>${formatDay(d.date)}</span><small>${formatDate(d.date)}</small></div>${compact('☼','Sunrise',d.sunrise)}${compact('◐','Sunset',d.sunset)}</article>`).join('');
}
function compact(icon,title,f){ return `<div class='compact-forecast'><div class='compact-main'><span class='event-icon'>${icon}</span><div><small>${title}</small><strong>${formatTime(f.time)}</strong></div></div><div class='compact-score'><strong>${f.score.score}</strong><span>${f.score.label}</span></div></div>`; }

document.addEventListener('DOMContentLoaded',()=>{
  $('search-form').addEventListener('submit',searchPlaces);
  $('location-button').addEventListener('click',()=>detectLocation({silent:false}));
  $('results').addEventListener('click',e=>{const b=e.target.closest('[data-place]'); if(b) loadForecast($('results')._places[Number(b.dataset.place)]);});
  document.querySelector('.event-toggle').addEventListener('click',e=>{const b=e.target.closest('[data-event]'); if(b){state.activeEvent=b.dataset.event; render();}});
  $('day-strip').addEventListener('click',e=>{const b=e.target.closest('[data-day]'); if(b){state.activeDay=Number(b.dataset.day); render();}});
  setTimeout(()=>detectLocation({silent:true}),250);
});
