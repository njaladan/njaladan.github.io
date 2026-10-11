/* Field Notes: static, browser-only prototype. No personal data is imported or sent. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const image = key => PHOTO_ASSETS[key] || PHOTO_ASSETS.mountain;
  let countries = [], countryIndex = new Map(), map, currentId, data, activeTrip = 'all', activeTab = 'route', selected = null, modalPhoto = null;
  let layerGroups = {}, visibleLayers = {cities:true,photos:true,activities:true,route:true};
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const included = item => activeTrip === 'all' || item.trip === activeTrip;
  const tripName = id => data.trips.find(t => t.id === id)?.name || '';
  const stats = a => `<div class="activity-stats"><div class="activity-stat"><strong>${escape(a.distance)} <small>km</small></strong>Distance</div><div class="activity-stat"><strong>${escape(a.elevation)} <small>m</small></strong>Elevation</div><div class="activity-stat"><strong>${escape(a.duration)}</strong>Moving time</div></div>`;

  function goCountry(id) { location.hash = `country=${encodeURIComponent(id)}`; }
  function showWorld() {
    if ($('#photo-dialog').open) $('#photo-dialog').close();
    $('#world-view').hidden = false; $('#country-view').hidden = true;
    document.title = "Field Notes — Ganesh's adventure atlas";
    currentId = null;
    if (map) { map.stop(); map.remove(); map = null; }
    window.scrollTo({top:0,behavior:'instant'});
  }
  function countryBounds(feature) {
    const b = d3.geoBounds(feature);
    let east = b[1][0];
    if (east < b[0][0]) east += 360;
    return [[Math.max(-80,b[0][1]),b[0][0]],[Math.min(80,b[1][1]),east]];
  }
  function fitJourney() {
    const points = [...data.stops.filter(included).map(s=>s.coords),...data.activities.filter(included).flatMap(a=>a.coords),...data.routes.filter(included).flatMap(r=>r.coords)];
    if (points.length) map.fitBounds(L.latLngBounds(points), {padding:[55,65],maxZoom:11,animate:!reduceMotion});
    else map.fitBounds(countryBounds(countryIndex.get(currentId)), {padding:[35,35],maxZoom:9,animate:!reduceMotion});
  }
  function ensureLayer(name) {
    visibleLayers[name] = true;
    if (!map.hasLayer(layerGroups[name])) layerGroups[name].addTo(map);
    $(`[data-layer="${name}"]`).setAttribute('aria-pressed','true');
  }
  function selectStop(id, pan=true) {
    const s = data.stops.find(s=>s.id===id); if (!s) return;
    selected = {type:'stop',id};
    ensureLayer('cities');
    if (pan) map.flyTo(s.coords, s.kind.includes('PARK') ? 10 : 12, {duration:reduceMotion?0:.75});
    $('#selection-card').className = 'selection-card';
    $('#selection-card').innerHTML = `<img src="${image(s.photo)}" alt="Illustrative image for ${escape(s.name)}"><div class="selection-body"><p class="eyebrow">${escape(s.kind)} · EXAMPLE STOP</p><h3>${escape(s.name)}</h3><p>${escape(s.text)}</p></div>`;
    renderJournal();
  }
  function selectActivity(id) {
    const a = data.activities.find(a=>a.id===id); if (!a) return;
    selected={type:'activity',id}; ensureLayer('activities');
    map.fitBounds(L.latLngBounds(a.coords),{padding:[65,65],maxZoom:14,animate:!reduceMotion});
    $('#selection-card').className='selection-card';
    $('#selection-card').innerHTML=`<img src="${image(a.photo)}" alt="Illustrative activity photo"><div class="selection-body"><p class="eyebrow"><span class="strava-symbol">▲</span> ${escape(a.type.toUpperCase())} · SAMPLE ACTIVITY</p><h3>${escape(a.title)}</h3>${stats(a)}<a class="sample-strava" href="https://www.strava.com/athletes/14026876" target="_blank" rel="noopener">Open Ganesh's Strava profile ↗</a></div>`;
    renderJournal();
  }
  function openPhoto(id) {
    const p=data.photos.find(p=>p.id===id);if(!p)return;
    modalPhoto=p;selected={type:'photo',id};
    $('#modal-photo').src=image(p.asset);$('#modal-photo').alt=`Illustrative photograph: ${p.title}`;
    $('#photo-dialog-title').textContent=p.title;$('#modal-caption').textContent=p.caption;
    if (!$('#photo-dialog').open) $('#photo-dialog').showModal();
  }
  function locatePhoto() {
    if(!modalPhoto)return;
    const p=modalPhoto;$('#photo-dialog').close();ensureLayer('photos');
    map.flyTo(p.coords,12,{duration:reduceMotion?0:.75});
    $('#selection-card').className='selection-card';
    $('#selection-card').innerHTML=`<img src="${image(p.asset)}" alt="Illustrative photo"><div class="selection-body"><p class="eyebrow">PHOTO PIN · SAMPLE LOCATION</p><h3>${escape(p.title)}</h3><p>${escape(p.caption)}</p></div>`;
    if(window.innerWidth<760) $('#country-map').scrollIntoView({behavior:reduceMotion?'instant':'smooth',block:'center'});
  }
  function overviewCard() {
    selected=null;$('#selection-card').className='selection-card empty-selection';
    $('#selection-card').innerHTML=data.trips.length?'<p class="eyebrow">ALL THE MOMENTS, IN CONTEXT</p><h3>Choose a stop. Follow a trail. Open a photo.</h3><p>The map and journal stay connected as you explore.</p>':'<p class="eyebrow">A PLACE FOR A FUTURE STORY</p><h3>No journeys added here yet.</h3><p>This country is selectable. Its map is ready for cities, photos, and activity tracks.</p>';
  }
  function renderJournal() {
    const content=$('#journal-content');
    $$('.journal-tabs button').forEach(b=>{b.setAttribute('aria-selected',String(b.dataset.tab===activeTab));b.setAttribute('aria-controls','journal-content');});
    if(!data.trips.length){content.innerHTML='<div class="empty-country"><div class="empty-icon">⌖</div><h3>An open page in the atlas.</h3><p>There aren’t any visits in this example country yet. Chile, the Alps, and the US demonstrate how the journal fills up.</p><a href="#country=152">Explore Chile instead ↗</a></div>';return;}
    if(activeTab==='route') {
      content.innerHTML=data.trips.filter(t=>activeTrip==='all'||t.id===activeTrip).map(t=>`<div class="trip-label">${escape(t.name)}<span>SAMPLE</span></div><div class="stop-list">${data.stops.filter(s=>s.trip===t.id).map(s=>{
        const n=data.stops.indexOf(s)+1;
        const photos=data.photos.filter(p=>p.trip===s.trip&&L.latLng(p.coords).distanceTo(s.coords)<85000).slice(0,3);
        return `<div class="stop-item"><span class="stop-number">${n}</span><button class="stop-button ${selected?.type==='stop'&&selected.id===s.id?'selected':''}" data-stop="${s.id}"><span class="stop-name">${escape(s.name)}</span><span class="stop-kind">${escape(s.kind)}</span><span class="stop-description">${escape(s.text)}</span></button>${photos.length?`<div class="stop-thumbs">${photos.map(p=>`<button class="stop-thumb" data-photo="${p.id}" aria-label="Open sample photo: ${escape(p.title)}"><img src="${image(p.asset)}" alt=""></button>`).join('')}<span class="stop-count">Photo pins ↗</span></div>`:''}</div>`;
      }).join('')}</div>`).join('');
    } else if(activeTab==='photos') {
      content.innerHTML=`<div class="photo-grid">${data.photos.filter(included).map(p=>`<button class="photo-card" data-photo="${p.id}"><img src="${image(p.asset)}" alt="Illustrative photo: ${escape(p.title)}"><strong>${escape(p.title)}</strong><small>⌖ Sample location · ${escape(tripName(p.trip).split(' · ')[0])}</small></button>`).join('')}</div>`;
    } else {
      content.innerHTML=data.activities.filter(included).map(a=>`<button class="activity-card ${selected?.type==='activity'&&selected.id===a.id?'selected':''}" data-activity="${a.id}"><span class="activity-top"><span><span class="strava-symbol">▲</span> ${escape(a.type.toUpperCase())}</span><span>SAMPLE</span></span><h3>${escape(a.title)}</h3>${stats(a)}<span class="activity-bottom"><span>Highlight the track</span><span>↗</span></span></button>`).join('');
    }
  }
  function renderLayers() {
    Object.values(layerGroups).forEach(g=>g.clearLayers());
    data.routes.filter(included).forEach(r=>L.polyline(r.coords,{color:'#355546',weight:3,opacity:.75,dashArray:'7 6',interactive:false}).addTo(layerGroups.route));
    data.activities.filter(included).forEach(a=>{
      L.polyline(a.coords,{color:'#fff',weight:8,opacity:.85,interactive:false}).addTo(layerGroups.activities);
      L.polyline(a.coords,{color:'#ef742e',weight:4,opacity:1}).bindTooltip(`${a.type}: ${a.title} · ${a.distance} km (sample)`).on('click',()=>selectActivity(a.id)).addTo(layerGroups.activities);
      L.marker(a.coords[Math.floor(a.coords.length/2)],{title:`${a.title} — sample ${a.type}`,icon:L.divIcon({className:'activity-pin',html:'<span>▲</span>',iconSize:[27,27],iconAnchor:[13,13]})}).on('click',()=>selectActivity(a.id)).addTo(layerGroups.activities);
    });
    data.stops.filter(included).forEach(s=>L.marker(s.coords,{title:`City stop: ${s.name}`,icon:L.divIcon({className:'city-pin',html:`<span>${data.stops.indexOf(s)+1}</span>`,iconSize:[27,27],iconAnchor:[13,13]})}).bindTooltip(s.name,{direction:'top',offset:[0,-14]}).on('click',()=>selectStop(s.id)).addTo(layerGroups.cities));
    data.photos.filter(included).forEach(p=>L.marker(p.coords,{title:`Open photo: ${p.title}`,icon:L.divIcon({className:'photo-pin',html:`<span><img src="${image(p.asset)}" alt=""></span>`,iconSize:[44,41],iconAnchor:[22,41]})}).bindTooltip(`${p.title} · sample photo`,{offset:[0,-32],direction:'top'}).on('click',()=>openPhoto(p.id)).addTo(layerGroups.photos));
  }
  function openCountry(id) {
    const feature=countryIndex.get(id);if(!feature){$('#world-status').textContent='Country not found. Try a name from the search list.';showWorld();return;}
    currentId=id;activeTrip='all';activeTab='route';selected=null;visibleLayers={cities:true,photos:true,activities:true,route:true};
    data=SAMPLE_COUNTRIES[id]||{name:feature.properties.name,region:'THE WORLD / COUNTRY JOURNAL',hero:'mountain',subtitle:'Every place has a story. This one is still an open page.',intro:'No visits have been added to this country in the mockup. Explore the terrain or return to one of the complete examples.',trips:[],stops:[],routes:[],photos:[],activities:[]};
    $('#world-view').hidden=true;$('#country-view').hidden=false;
    $('#country-title').textContent=data.name==='United States of America'?'United States':data.name;
    $('#country-title').classList.toggle('long-name',data.name.length>15);
    $('#country-region').textContent=data.region;$('#country-subtitle').textContent=data.subtitle;
    $('#country-hero-photo').src=image(data.hero);$('#country-hero-photo').alt='Illustrative landscape, not a personal travel photograph';
    $('#journal-intro').textContent=data.intro;$('#journal-title').textContent=data.trips.length?'A country, many paths.':'The next story starts here.';
    $('.sample-badge').textContent=data.trips.length?'Illustrative itinerary & photos':'No visits added · illustrative photo';
    $('#country-summary').innerHTML=`<span class="summary-item"><strong>${data.trips.length}</strong> example ${data.trips.length===1?'visit':'visits'}</span><span class="summary-item"><strong>${data.stops.length}</strong> stops</span><span class="summary-item"><strong>${data.photos.length}</strong> photos</span><span class="summary-item"><strong>${data.activities.length}</strong> activities</span>`;
    $('#trip-select').innerHTML='<option value="all">All visits together</option>'+data.trips.map(t=>`<option value="${t.id}">${escape(t.name)}</option>`).join('');
    $('#trip-select').disabled=!data.trips.length;
    $('#country-map-title').textContent='All visits on one map';
    $$('[data-layer]').forEach(b=>b.setAttribute('aria-pressed','true'));
    document.title=`${data.name} — Field Notes`;
    if(map){map.stop();map.remove();}
    map=L.map('country-map',{zoomControl:false,scrollWheelZoom:false,worldCopyJump:true,zoomAnimation:false,fadeAnimation:false});
    L.control.zoom({position:'topright'}).addTo(map);
    const tiles=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',{maxZoom:17,attribution:'Tiles © Esri · Sources: Esri, HERE, Garmin, USGS, NGA, EPA, NPS'}).addTo(map);
    let tileErrors=0;
    tiles.on('tileerror',()=>{tileErrors++;if(tileErrors===6&&!$('.map-unavailable')){const note=document.createElement('p');note.className='map-unavailable';note.textContent='Terrain tiles are unavailable. Route, city, photo, and activity layers still work.';$('.country-map-shell').append(note);}});
    $('.map-unavailable')?.remove();
    // Terrain tiles carry detailed boundaries; a subtle outline orients an empty country.
    if(!data.trips.length)L.geoJSON(feature,{style:{color:'#54734d',weight:1.5,fillColor:'#6d915d',fillOpacity:.1}}).addTo(map);
    layerGroups={route:L.layerGroup().addTo(map),activities:L.layerGroup().addTo(map),cities:L.layerGroup().addTo(map),photos:L.layerGroup().addTo(map)};
    renderLayers();renderJournal();overviewCard();fitJourney();
    window.scrollTo({top:0,behavior:'instant'});
    requestAnimationFrame(()=>map.invalidateSize());
  }
  function route() {
    const query=new URLSearchParams(location.hash.slice(1));
    const id=query.get('country');
    if(id)openCountry(id);else showWorld();
  }
  function renderWorld() {
    const w=1000,h=495;
    const projection=d3.geoNaturalEarth1().fitExtent([[28,20],[w-28,h-15]],{type:'Sphere'});
    const path=d3.geoPath(projection);
    const svg=d3.select('#world-map').append('svg').attr('viewBox',`0 0 ${w} ${h}`).attr('role','img').attr('aria-label','World countries. Chile, France, Italy, Switzerland, and the United States have sample journeys.');
    svg.append('path').datum(d3.geoGraticule10()).attr('d',path).attr('class','graticule');
    const tooltip=$('#map-tooltip');
    svg.selectAll('.world-country').data(countries).join('path').attr('d',path).attr('class',f=>`world-country ${SAMPLE_COUNTRIES[f.id]?'has-trips':''}`).attr('data-country-code',f=>f.id).attr('role','button').attr('aria-label',f=>`Explore ${f.properties.name}${SAMPLE_COUNTRIES[f.id]?', sample journeys available':''}`).attr('tabindex',f=>SAMPLE_COUNTRIES[f.id]?0:-1).on('click',(e,f)=>goCountry(f.id)).on('keydown',(e,f)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();goCountry(f.id);}}).on('pointermove',(e,f)=>{
      tooltip.style.display='block';tooltip.textContent=f.properties.name+(SAMPLE_COUNTRIES[f.id]?' · Explore journeys':'');
      const rect=$('.world-map-wrap').getBoundingClientRect();const x=e.clientX-rect.left,y=e.clientY-rect.top;
      tooltip.style.left=Math.min(x+12,rect.width-tooltip.offsetWidth-10)+'px';tooltip.style.top=Math.max(y-32,8)+'px';
    }).on('pointerleave',()=>tooltip.style.display='none');
    const markers=[{id:'152',coords:[-72.3,-43.5],number:'01'},{id:'250',coords:[7,46],number:'02'},{id:'840',coords:[-99,39],number:'03'}];
    markers.forEach(m=>{
      const p=projection(m.coords);const g=svg.append('g').attr('transform',`translate(${p[0]},${p[1]})`).attr('class','sample-marker').attr('role','button').attr('tabindex',0).attr('aria-label',`Open ${countryIndex.get(m.id).properties.name} sample`).on('click',()=>goCountry(m.id)).on('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();goCountry(m.id);}});
      g.append('circle').attr('r',14);g.append('text').text(m.number);
    });
    $('#world-status').textContent='';
    $('#country-options').innerHTML=countries.map(f=>`<option value="${escape(f.properties.name)}"></option>`).join('');
  }
  document.addEventListener('click',e=>{
    const country=e.target.closest('[data-country]');if(country)goCountry(country.dataset.country);
    const stop=e.target.closest('[data-stop]');if(stop)selectStop(stop.dataset.stop);
    const photo=e.target.closest('[data-photo]');if(photo)openPhoto(photo.dataset.photo);
    const activity=e.target.closest('[data-activity]');if(activity)selectActivity(activity.dataset.activity);
    const tab=e.target.closest('[data-tab]');if(tab){activeTab=tab.dataset.tab;renderJournal();}
    const layer=e.target.closest('[data-layer]');if(layer&&map){const name=layer.dataset.layer;visibleLayers[name]=!visibleLayers[name];layer.setAttribute('aria-pressed',String(visibleLayers[name]));if(visibleLayers[name])layerGroups[name].addTo(map);else map.removeLayer(layerGroups[name]);}
  });
  $('#back-world').addEventListener('click',()=>location.hash='');
  $('#fit-map').addEventListener('click',()=>{fitJourney();overviewCard();renderJournal();});
  $('#trip-select').addEventListener('change',e=>{activeTrip=e.target.value;$('#country-map-title').textContent=activeTrip==='all'?'All visits on one map':tripName(activeTrip);renderLayers();overviewCard();renderJournal();fitJourney();});
  $('.modal-close').addEventListener('click',()=>$('#photo-dialog').close());
  $('#photo-dialog').addEventListener('click',e=>{if(e.target===$('#photo-dialog'))$('#photo-dialog').close();});
  $('#photo-show-map').addEventListener('click',locatePhoto);
  $('#country-search').addEventListener('submit',e=>{
    e.preventDefault();const term=$('#country-input').value.trim().toLowerCase();
    const aliases={'usa':'840','us':'840','united states':'840','uk':'826','united kingdom':'826','south korea':'410','north korea':'408','vatican city':'336'};
    const match=countryIndex.get(aliases[term])||countries.find(f=>f.properties.name.toLowerCase()===term)||countries.find(f=>term&&f.properties.name.toLowerCase().startsWith(term));
    if(match){goCountry(match.id);$('#country-input').value='';}else $('#world-status').textContent='Choose a country from the search list.';
  });
  ['all','samples'].forEach(mode=>$(`#show-${mode}`).addEventListener('click',()=>{
    $('#show-all').classList.toggle('selected',mode==='all');$('#show-samples').classList.toggle('selected',mode==='samples');
    $('#show-all').setAttribute('aria-pressed',String(mode==='all'));$('#show-samples').setAttribute('aria-pressed',String(mode==='samples'));
    d3.selectAll('.world-country').classed('dimmed',f=>mode==='samples'&&!SAMPLE_COUNTRIES[f.id]);
  }));
  $('.journal-tabs').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const tabs=$$('.journal-tabs button');let i=tabs.indexOf(document.activeElement);i=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[i].focus();activeTab=tabs[i].dataset.tab;renderJournal();});
  window.addEventListener('hashchange',()=>{if(countries.length)route();});
  fetch('data/world.json').then(r=>{if(!r.ok)throw new Error('Atlas geography could not load');return r.json();}).then(world=>{
    countries=topojson.feature(world,world.objects.countries).features;
    const used=new Set();countries.forEach(f=>{f.id=String(f.id);if(used.has(f.id))f.id=f.properties.name.toLowerCase().replace(/\W+/g,'-');used.add(f.id);countryIndex.set(f.id,f);});
    countries.sort((a,b)=>a.properties.name.localeCompare(b.properties.name));
    renderWorld();route();window.ATLAS_READY=true;
  }).catch(error=>{$('#world-status').textContent='The atlas could not load. Please refresh to try again.';console.error(error);});
})();
