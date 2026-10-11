(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const assetVersion = new URL(document.querySelector('script[src^="app.js"]').src).searchParams.get('v') || '1';
  const worldBounds = L.latLngBounds([[-58,-178],[80,178]]);
  const colors = ['#b7774a','#4f7e8a','#807398','#859650','#bd825e','#62739d','#a26780'];
  const countryLayers = new Map(), tracks = [];
  let currentCountry = null, currentState = null, stateLayer, activeDay = null, activeJourneys = [], journeys = [], transport = [], worldLayer, tinyLayer;
  const stateLayers=new Map(), cityMarkers=[];
  const routeLayers = L.layerGroup(), transportLayers = L.layerGroup(), cityLayers = L.layerGroup();
  const map = L.map('map', {zoomControl:false,scrollWheelZoom:false,dragging:true,touchZoom:true,zoomSnap:0,zoomDelta:.5,zoomAnimation:false,minZoom:1,maxZoom:17,worldCopyJump:true});
  const smoothZoom = installSmoothZoom(map, reduceMotion);
  map.createPane('states');map.getPane('states').style.zIndex=360;
  map.createPane('routes');map.getPane('routes').style.zIndex=420;
  map.createPane('cities');map.getPane('cities').style.zIndex=450;
  map.createPane('countries');map.getPane('countries').style.zIndex=350;
  const terrain=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',{maxNativeZoom:19,maxZoom:19,noWrap:true,attribution:'Tiles © Esri · HERE, Garmin, USGS'}).addTo(map);
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution('Routes © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>');
  map.attributionControl.addAttribution('<a href="https://www.naturalearthdata.com/">Natural Earth</a>');
  map.fitBounds(worldBounds,{padding:[15,15],animate:false});
  const activityPopup=L.popup({maxWidth:270,minWidth:180,className:'activity-popup'});
  const canonical = id => id === '344' ? '156' : id;
  const allowed = id => Boolean(VISITED_COUNTRIES[id]) || id === HOME_COUNTRY;
  const geometryId = id => VISITED_COUNTRIES[id]?.geometry || id;
  const countryName = id => id === HOME_COUNTRY ? 'United States' : VISITED_COUNTRIES[id].name + (VISITED_COUNTRIES[id].scope ? ` · ${VISITED_COUNTRIES[id].scope}` : '');
  const isVisitedShape = id => id !== '156' && allowed(canonical(id));
  const formatDistance = m => `${(m/1000).toFixed(1)} km`;
  const formatDuration = s => {const m=Math.round(s/60);return m<60?`${m}m`:`${Math.floor(m/60)}h ${m%60}m`;};
  const daySegments = day => day.segments || (day.coords ? [day.coords] : []);
  const dayPoints = day => daySegments(day).flat();
  function statePlaces(id) {
    const visit=US_VISITS[id];
    return [...visit.cities.map(([name,lat,lon])=>({name,coords:[lat,lon],state:id})),...visit.parks.map(([name,lat,lon])=>({name,coords:[lat,lon],park:true,state:id}))];
  }
  const cities = () => [...Object.entries(COUNTRY_PLACES).flatMap(([country,places])=>places.map(place=>({...place,country}))),...Object.keys(US_VISITS).flatMap(statePlaces)];

  function styleCountry(feature) {
    const id=String(feature.id),visited=isVisitedShape(id),home=id===HOME_COUNTRY;
    if(id==='010')return {opacity:0,fillOpacity:0};
    return {color:'#f5f7f8',weight:.7,opacity:1,fillColor:home?'#557b73':visited?'#b7774a':'#c8d0d5',fillOpacity:visited ? .8 : .25};
  }
  function updateBasemap() {
    const zoom=map.getZoom();
    const countryOpacity=Math.max(0,Math.min(1,(5-zoom)/2.5));
    map.getPane('countries').style.opacity=countryOpacity;
    map.getPane('countries').style.pointerEvents=countryOpacity>.1?'auto':'none';
    const stateOpacity=Math.max(0,Math.min(1,(zoom-3.3)/1.2,(8-zoom)/2));
    map.getPane('states').style.opacity=stateOpacity;
    map.getPane('states').style.pointerEvents=stateOpacity>.1?'auto':'none';
    const cityOpacity=Math.max(0,Math.min(1,(zoom-3.4)/1.2));
    map.getPane('cities').style.opacity=cityOpacity;
    map.getPane('cities').style.pointerEvents=cityOpacity>.1?'auto':'none';
    const routeOpacity=Math.max(0,Math.min(1,(zoom-3)/1.5));
    map.getPane('routes').style.opacity=routeOpacity;map.getPane('routes').style.pointerEvents=routeOpacity>.1?'auto':'none';
    $('#route-legend').hidden=zoom<3.5||!$('#route-legend').textContent;
    map.getContainer().style.setProperty('--city-opacity',cityOpacity);
    if(cityOpacity<.1)cityMarkers.forEach(({marker})=>marker.closeTooltip());
  }
  function navigate(id) {
    id=canonical(id);
    if(allowed(id))location.hash=`country=${id}`;
  }
  function fitView(bounds,maxZoom=10,animate=true) {
    smoothZoom.finish();map.stop();
    map.flyToBounds(bounds,{duration:reduceMotion||!animate?0:1.25,maxZoom,paddingTopLeft:[35,90],paddingBottomRight:[80,40]});
  }
  function countryBounds(id) {
    if(id===HOME_COUNTRY)return currentState?stateLayers.get(currentState).getBounds():L.latLngBounds([[24,-126],[50,-66]]);
    if(id==='528')return L.latLngBounds([[50.75,3.25],[53.6,7.25]]);
    return countryLayers.get(geometryId(id)).getBounds();
  }
  function activityContent(day,journey,index) {
    const label=journey.id==='tmb'?`Day ${index+1}`:journey.name;
    const stats=[['distance_m',formatDistance,'Distance'],['elapsed_s',formatDuration,'Elapsed'],['elevation_m',n=>`~${Math.round(n).toLocaleString()} m`,'Ascent']];
    return `<div class="route-popup"><strong>${escape(label)}</strong><time datetime="${escape(day.date)}">${escape(day.date)}</time><div class="route-stats">${stats.filter(([field])=>Number.isFinite(day[field])).map(([field,format,name])=>`<div><b>${format(day[field])}</b><span>${name}</span></div>`).join('')}</div></div>`;
  }
  function updateRouteStyles() {
    tracks.forEach(({id,color,outline,line})=>{
      const selected=activeDay===null||activeDay===id;
      outline.setStyle({weight:selected?6:4,opacity:selected ? .9 : .35});
      line.setStyle({color:selected?color:'#8d999e',weight:selected?3.5:2,opacity:selected?1:.45});
      if(selected){outline.bringToFront();line.bringToFront();}
    });
  }
  function renderRoutes() {
    routeLayers.clearLayers();tracks.length=0;
    activeJourneys.forEach(journey=>(journey.days||[]).forEach((day,index)=>{
      const color=ROUTE_MODES[day.type]?.color||colors[index%colors.length];
      daySegments(day).forEach(segment=>{
        if(segment.length<2)return;
        const outline=L.polyline(segment,{pane:'routes',color:'white',weight:6,opacity:.9,interactive:false}).addTo(routeLayers);
        const label=journey.id==='tmb'?`Day ${index+1}`:journey.name;
        const line=L.polyline(segment,{pane:'routes',color,weight:3.5,opacity:1,className:'activity-route'}).bindTooltip(label).on('click',event=>{
          activeDay=day.id;updateRouteStyles();activityPopup.setLatLng(event.latlng).setContent(activityContent(day,journey,index)).openOn(map);
        }).addTo(routeLayers);
        accessibleRoute(line,day,journey,index,segment);
        tracks.push({id:day.id,color,outline,line});
      });
    }));
  }
  function renderCities() {
    cityLayers.clearLayers();cityMarkers.length=0;
    cities().forEach(city=>{
      const marker=L.marker(city.coords,{pane:'cities',icon:L.divIcon({className:'city-marker',html:`<i style="background:${city.park?'#648243':'#364c60'}"></i>`,iconSize:[12,12],iconAnchor:[6,6]})})
        .bindTooltip(escape(city.name),{permanent:true,interactive:true,direction:'right',offset:[8,0],className:'city-label'}).addTo(cityLayers);
      // A city already has a map label; clicking only reveals a hidden label.
      const reveal=()=>{if(!marker.isTooltipOpen()){marker.openTooltip();const label=marker.getTooltip().getElement();if(label)label.style.visibility='visible';}};
      marker.on('click',reveal);
      const node=marker.getElement();node.setAttribute('role','button');node.setAttribute('tabindex','0');node.setAttribute('aria-label',city.name+(city.park?' National park':''));
      node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();reveal();}});
      node.addEventListener('focus',reveal);
      cityMarkers.push({marker,city});
    });
    declutterLabels();
  }
  function declutterLabels() {
    const zoom=map.getZoom(),bounds=map.getBounds(),size=map.getSize();
    const root=map.getContainer().getBoundingClientRect();
    const occupied=[...document.querySelectorAll('.map-toolbar,.leaflet-control-zoom')].map(node=>node.getBoundingClientRect());
    const visible=cityMarkers.filter(({city})=>bounds.contains(city.coords));
    visible.sort((a,b)=>Number(b.city.state===currentState&&Boolean(currentState))-Number(a.city.state===currentState&&Boolean(currentState)));
    cityMarkers.filter(item=>!visible.includes(item)).forEach(({marker})=>marker.closeTooltip());
    visible.forEach(({marker})=>{
      if(zoom<3.5){marker.closeTooltip();return;}
      marker.openTooltip();const tooltip=marker.getTooltip(),node=tooltip.getElement();if(!node)return;
      node.style.visibility='hidden';let placed=false;
      for(const direction of ['right','left','top','bottom']) {
        tooltip.options.direction=direction;tooltip.options.offset=L.point(direction==='right'?8:direction==='left'?-8:0,direction==='top'?-6:direction==='bottom'?6:0);tooltip.update();
        const rect=node.getBoundingClientRect();
        const inside=rect.left>=root.left+8&&rect.right<=root.left+size.x-8&&rect.top>=root.top+8&&rect.bottom<=root.top+size.y-25;
        const collides=occupied.some(other=>rect.left<other.right+5&&rect.right+5>other.left&&rect.top<other.bottom+4&&rect.bottom+4>other.top);
        if(inside&&!collides){occupied.push(rect);node.style.visibility='visible';placed=true;break;}
      }
      if(!placed)marker.closeTooltip();
    });
  }
  function renderTransport() {
    transportLayers.clearLayers();
    transport.forEach(trip=>{
      const content=`<div class="route-popup"><strong>${escape(trip.name)}</strong><p>${escape(trip.mode)}${trip.operator?' · '+escape(trip.operator):''}</p>${trip.dates.length?`<time>${trip.dates.map(escape).join(' · ')}</time>`:''}${trip.stops.length>2?`<p>Via ${escape(trip.stops.slice(1,-1).join(', '))}</p>`:''}</div>`;
      const color=ROUTE_MODES[trip.mode]?.color||'#697c84';
      L.polyline(trip.coords,{pane:'routes',color:'white',weight:6,opacity:.85,interactive:false}).addTo(transportLayers);
      const line=L.polyline(trip.coords,{pane:'routes',color,weight:3.5,opacity:1,className:'transport-route'}).bindTooltip(escape(trip.name)).bindPopup(content,{className:'activity-popup',maxWidth:270}).addTo(transportLayers);
      const node=line.getElement();node.setAttribute('role','button');node.setAttribute('tabindex','0');node.setAttribute('aria-label',`${trip.mode}: ${trip.name}`);
      node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();line.openPopup(L.latLng(trip.coords[Math.floor(trip.coords.length/2)]));}});
    });
    updateRouteLegend();
  }
  function updateRouteLegend() {
    const bounds=map.getBounds();
    const types=new Set(transport.filter(trip=>L.latLngBounds(trip.coords).intersects(bounds)).map(trip=>trip.mode));
    journeys.forEach(journey=>(journey.days||[]).forEach(day=>{if(dayPoints(day).length&&L.latLngBounds(dayPoints(day)).intersects(bounds))types.add(day.type);}));
    const modes=[...types].filter(type=>ROUTE_MODES[type]);
    $('#route-legend').innerHTML=modes.map(type=>`<span><i style="background:${ROUTE_MODES[type].color}"></i>${ROUTE_MODES[type].name}</span>`).join('');
    $('#route-legend').hidden=map.getZoom()<3.5||!modes.length;
  }
  function setGeographyAccess() {
    document.querySelectorAll('.visited-country,.tiny-country').forEach(node=>node.setAttribute('tabindex',currentCountry?'-1':'0'));
  }
  function showCountry(id,animate=true) {
    map.closePopup();currentCountry=id;activeDay=null;
    if(id!==HOME_COUNTRY)currentState=null;
    $('#back-us').hidden=!currentState;stateLayer.setStyle(styleState);
    activeJourneys=journeys;
    document.body.dataset.view='country';
    $('#back-world').hidden=false;$('#country-title').hidden=false;$('#country-title').textContent=currentState?US_VISITS[currentState].name:countryName(id);
    document.title=`${currentState?US_VISITS[currentState].name:countryName(id)} — Atlas`;$('#map-status').textContent='';
    worldLayer.setStyle(styleCountry);tinyLayer.remove();
    renderTransport();renderRoutes();renderCities();setGeographyAccess();updateBasemap();fitView(countryBounds(id),11,animate);
  }
  function showWorld(animate=true) {
    smoothZoom.finish();map.closePopup();currentCountry=null;currentState=null;$('#back-us').hidden=true;stateLayer.setStyle(styleState);activeDay=null;activeJourneys=journeys;
    document.body.dataset.view='world';
    $('#back-world').hidden=true;$('#country-title').hidden=true;
    $('#map-status').textContent='';document.title='Atlas — Ganesh';
    renderTransport();renderRoutes();
    worldLayer.setStyle(styleCountry);tinyLayer.addTo(map);setGeographyAccess();
    if(animate){map.stop();map.flyToBounds(worldBounds,{padding:[15,15],duration:reduceMotion?0:1.25});}
    updateBasemap();
  }
  function route() {
    const params=new URLSearchParams(location.hash.slice(1));
    const raw=params.get('country');currentState=raw===HOME_COUNTRY&&US_VISITS[params.get('state')]?params.get('state'):null;
    const id=canonical(raw);
    if(id&&allowed(id))showCountry(id);
    else {if(raw)history.replaceState(null,'',location.pathname+location.search);showWorld(Boolean(currentCountry));}
  }
  function styleState(feature) {
    const id=String(feature.id).padStart(2,'0'),visited=Boolean(US_VISITS[id]),selected=currentState===id;
    return {color:selected?'#31594f':'#ffffff',weight:selected?2:1,fillColor:visited?'#557b73':'#c8d0d5',fillOpacity:currentState?(selected ? .25 : .07):(visited ? .55 : .18)};
  }
  function renderStates(states) {
    const features=topojson.feature(states,states.objects.states).features.filter(feature=>!['11','60','66','69','72','78'].includes(String(feature.id).padStart(2,'0')));
    stateLayer=L.geoJSON(features,{
      pane:'states',style:styleState,
      onEachFeature(feature,layer) {
        const id=String(feature.id).padStart(2,'0'),visit=US_VISITS[id];
        stateLayers.set(id,layer);layer.options.className='state-shape';
        const label=visit?visit.name:feature.properties.name;
        layer.bindTooltip(escape(label),{sticky:true});
        const content=visit?`<strong>${escape(visit.name)}</strong><h2>Cities / areas visited</h2><p>${[...visit.cities.map(city=>city[0]),...(visit.areas||[])].map(escape).join(' · ')}</p>${visit.parks.length?`<h2>National parks visited</h2><p>${visit.parks.map(park=>escape(park[0])).join(' · ')}</p>`:''}`:`<strong>${escape(label)}</strong><p>No visits recorded</p>`;
        layer.bindPopup(content,{className:'state-popup',maxWidth:290});
        const select=()=>{if(visit){if(currentState===id)layer.openPopup();else location.hash=`country=${HOME_COUNTRY}&state=${id}`;}else layer.openPopup();};
        layer.on('click',select);
        layer.on('add',()=>{const node=layer.getElement();if(!node)return;node.setAttribute('role','button');node.setAttribute('tabindex','0');node.setAttribute('aria-label',label+(visit?' — visited':''));node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select();}});});
      }
    }).addTo(map);
  }
  function accessibleRoute(layer,day,journey,index,segment) {
    const node=layer.getElement();if(!node)return;
    node.setAttribute('role','button');node.setAttribute('tabindex','0');node.setAttribute('aria-label',journey.id==='tmb'?`Day ${index+1}`:journey.name);
    node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();activeDay=day.id;updateRouteStyles();activityPopup.setLatLng(segment[Math.floor(segment.length/2)]).setContent(activityContent(day,journey,index)).openOn(map);}});
  }
  function accessibleCountry(layer,id,label) {
    layer.on('add',()=>{
      const node=layer.getElement();if(!node)return;
      node.setAttribute('role','button');node.setAttribute('tabindex','0');node.setAttribute('aria-label',label);
      node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();if(!currentCountry)navigate(id);}});
    });
  }
  // Split dateline crossings so Leaflet does not draw Russia and Fiji across the world.
  function splitDateline(feature) {
    if(!['643','242'].includes(String(feature.id)))return feature;
    const polygons=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates;
    const clip=(ring,edge,keep)=>{
      const result=[];
      ring.forEach((point,i)=>{
        const previous=ring[(i+ring.length-1)%ring.length];
        if(keep(previous[0])!==keep(point[0])){
          const t=(edge-previous[0])/(point[0]-previous[0]);
          result.push([edge,previous[1]+t*(point[1]-previous[1])]);
        }
        if(keep(point[0]))result.push(point);
      });return result;
    };
    const pieces=[];
    polygons.forEach(polygon=>{
      const rings=polygon.map(ring=>{
        let longitude=ring[0][0];
        return ring.slice(0,-1).map(([lon,lat])=>{
          while(lon-longitude>180)lon-=360;
          while(lon-longitude< -180)lon+=360;
          longitude=lon;return [lon,lat];
        });
      });
      const longitudes=rings[0].map(point=>point[0]);
      for(let part=Math.floor((Math.min(...longitudes)+180)/360);part<=Math.floor((Math.max(...longitudes)+180)/360);part++){
        const west=-180+part*360,east=180+part*360;
        const clipped=rings.map(ring=>clip(clip(ring,west,lon=>lon>=west),east,lon=>lon<=east));
        if(clipped[0].length<3)continue;
        pieces.push(clipped.filter(ring=>ring.length>=3).map(ring=>{
          const shifted=ring.map(([lon,lat])=>[lon-part*360,lat]);return [...shifted,shifted[0]];
        }));
      }
    });
    return {...feature,geometry:{type:'MultiPolygon',coordinates:pieces}};
  }
  function scopeFrance(feature) {
    if(String(feature.id)!=='250')return [feature];
    const polygons=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates;
    const metropolitan=polygons.filter(polygon=>polygon[0].every(([lon,lat])=>lon>=-6&&lon<=10&&lat>=40&&lat<=52));
    const overseas=polygons.filter(polygon=>!metropolitan.includes(polygon));
    return [
      {...feature,geometry:{type:'MultiPolygon',coordinates:metropolitan}},
      {...feature,id:'250-overseas',properties:{name:'France (overseas)'},geometry:{type:'MultiPolygon',coordinates:overseas}}
    ];
  }
  function renderWorld(world) {
    const features=topojson.feature(world,world.objects.countries).features.map(splitDateline).flatMap(scopeFrance);
    features.forEach(feature=>{feature.id=String(feature.id);});
    worldLayer=L.geoJSON(features,{
      pane:'countries',style:styleCountry,
      onEachFeature(feature,layer){
        const id=String(feature.id),selectable=isVisitedShape(id);
        countryLayers.set(id,layer);layer.options.interactive=selectable;
        layer.options.className=`country-shape ${selectable?'visited-country':''}`;
        if(selectable){
          layer.bindTooltip(countryName(canonical(id)),{sticky:true});
          layer.on('click',()=>{if(!currentCountry)navigate(canonical(id));});
          layer.on('mouseover',()=>{if(!currentCountry)layer.setStyle({fillColor:'#ce956c'});});
          layer.on('mouseout',()=>layer.setStyle(styleCountry(feature)));
          accessibleCountry(layer,canonical(id),countryName(canonical(id)));
        }
      }
    }).addTo(map);
    tinyLayer=L.layerGroup();
    [{id:'156',coords:[22.32,114.17]},{id:'336',coords:[41.9029,12.4534]}].forEach(item=>{
      const marker=L.marker(item.coords,{icon:L.divIcon({className:'tiny-country',html:'<i></i>',iconSize:[10,10],iconAnchor:[5,5]})}).bindTooltip(countryName(item.id)).on('click',()=>navigate(item.id));
      accessibleCountry(marker,item.id,countryName(item.id));marker.addTo(tinyLayer);
    });
    tinyLayer.addTo(map);transportLayers.addTo(map);routeLayers.addTo(map);cityLayers.addTo(map);

  }
  $('#back-us').addEventListener('click',()=>location.hash=`country=${HOME_COUNTRY}`);
  $('#back-world').addEventListener('click',()=>location.hash='');
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&currentCountry&&!map.isPopupOpen())location.hash=currentState?`country=${HOME_COUNTRY}`:'';});
  map.on('popupclose',event=>{if(event.popup===activityPopup){activeDay=null;updateRouteStyles();}});
  map.on('zoom',updateBasemap);
  map.on('moveend',()=>{declutterLabels();if(worldLayer)updateRouteLegend();});
  updateBasemap();
  map.on('resize',()=>{if(worldLayer){if(currentCountry)fitView(countryBounds(currentCountry),11);else showWorld();}});
  window.addEventListener('hashchange',()=>{if(worldLayer)route();});
  Promise.all([
    fetch('data/us-states.json').then(response=>{if(!response.ok)throw Error('State geography unavailable');return response.json();}),
    fetch('data/world.json').then(response=>{if(!response.ok)throw Error('Geography unavailable');return response.json();}),
    fetch(`data/activities.json?v=${assetVersion}`).then(response=>{if(!response.ok)throw Error('Activities unavailable');return response.json();}),
    fetch(`data/transport.json?v=${assetVersion}`).then(response=>{if(!response.ok)throw Error('Transport unavailable');return response.json();})
  ]).then(([states,world,activities,connections])=>{
    journeys=activities.journeys||[];transport=connections.routes||[];
    renderStates(states);renderWorld(world);renderCities();$('#map-status').textContent='';route();window.ATLAS_READY=true;
    window.ATLAS_MAP=map;
  }).catch(error=>{$('#map-status').textContent='Map unavailable. Refresh to retry.';console.error(error);});
})();
