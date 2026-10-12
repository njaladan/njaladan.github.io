(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const assetVersion = new URL(document.querySelector('script[src^="app.js"]').src).searchParams.get('v') || '1';
  const worldBounds = L.latLngBounds([[-58,-178],[80,178]]);
  const colors = ['#b7774a','#4f7e8a','#807398','#859650','#bd825e','#62739d','#a26780'];
  const visitColors = {visited:'#c79572',home:'#829e94'};
  const countryLayers = new Map(), tracks = [];
  let currentCountry = null, currentState = null, stateLayer, activeDay = null, activeJourneys = [], journeys = [], transport = [], worldLayer, tinyLayer;
  const stateLayers=new Map(), cityMarkers=[];
  const routeLayers = L.layerGroup(), transportLayers = L.layerGroup(), cityLayers = L.layerGroup();
  const flightLayers = L.layerGroup(), airportLayers = L.layerGroup();
  let flightLog = {airports:{},flights:[],routes:[]};
  const map = L.map('map', {zoomControl:false,scrollWheelZoom:false,dragging:true,touchZoom:true,zoomSnap:0,zoomDelta:.5,zoomAnimation:false,minZoom:1,maxZoom:17,worldCopyJump:true});
  const smoothZoom = installSmoothZoom(map, reduceMotion);
  map.createPane('states');map.getPane('states').style.zIndex=360;
  map.createPane('routes');map.getPane('routes').style.zIndex=420;
  map.createPane('flights');map.getPane('flights').style.zIndex=440;
  map.createPane('airports');map.getPane('airports').style.zIndex=430;
  map.createPane('cities');map.getPane('cities').style.zIndex=450;
  map.createPane('countries');map.getPane('countries').style.zIndex=350;
  map.createPane('visitShading');map.getPane('visitShading').style.zIndex=355;
  map.getPane('visitShading').style.pointerEvents='none';
  map.createPane('detail');map.getPane('detail').style.zIndex=370;
  map.getPane('detail').style.pointerEvents='none';
  const detailOptions={pane:'detail',minZoom:5,maxNativeZoom:16,maxZoom:17,noWrap:true};
  const detail=L.layerGroup([
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',{
      ...detailOptions,attribution:'Tiles © Esri · HERE · Garmin · OpenStreetMap contributors'
    }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',detailOptions)
  ]);
  const backgroundLabels = installBasemapLabels(map);
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution('Routes © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>');
  map.attributionControl.addAttribution('<a href="https://www.naturalearthdata.com/">Natural Earth</a>');
  map.attributionControl.addAttribution('Airports: <a href="https://ourairports.com/data/">OurAirports</a>');
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
  const activityLabel = (day, journey) => day.name || journey.name;
  function statePlaces(id) {
    const visit=US_VISITS[id];
    return [...visit.cities.map(([name,lat,lon])=>({name,coords:[lat,lon],state:id})),...visit.parks.map(([name,lat,lon])=>({name,coords:[lat,lon],park:true,state:id}))];
  }
  const cities = () => [...Object.entries(COUNTRY_PLACES).flatMap(([country,places])=>places.map(place=>({...place,country}))),...Object.keys(US_VISITS).flatMap(statePlaces)];

  function styleCountry(feature) {
    const id=String(feature.id),visited=isVisitedShape(id),home=id===HOME_COUNTRY;
    if(id==='010')return {opacity:0,fillOpacity:0};
    return {color:visited||home?'#b6bdc2':'#d9dde0',weight:visited||home?1:.7,opacity:1,fillColor:'#fafafa',fillOpacity:.95};
  }
  function updateBasemap() {
    const zoom=map.getZoom();
    map.getPane('visitShading').style.opacity=Math.max(0,Math.min(1,(5-zoom)/1.5));
    const detailOpacity=Math.max(0,Math.min(1,(zoom-5)/2));
    map.getPane('detail').style.opacity=detailOpacity;
    if(detailOpacity>0&&!map.hasLayer(detail))detail.addTo(map);
    if(detailOpacity===0&&map.hasLayer(detail))map.removeLayer(detail);
    map.getPane('backgroundLabels').style.opacity=1-detailOpacity;
    map.getPane('countries').style.pointerEvents=zoom<5?'auto':'none';
    const stateOpacity=Math.max(0,Math.min(1,(zoom-3.3)/1.2));
    map.getPane('states').style.opacity=stateOpacity;
    map.getPane('states').style.pointerEvents=stateOpacity>.1?'auto':'none';
    const cityOpacity=Math.max(0,Math.min(1,(zoom-3.4)/1.2));
    map.getPane('cities').style.opacity=1;
    const routeOpacity=Math.max(0,Math.min(1,(zoom-3)/1.5));
    map.getPane('routes').style.opacity=routeOpacity;map.getPane('routes').style.pointerEvents=routeOpacity>.1?'auto':'none';
    const airportOpacity=Math.max(0,Math.min(1,zoom-4));
    map.getPane('airports').style.opacity=airportOpacity*.45;map.getPane('airports').style.pointerEvents=airportOpacity>.1?'auto':'none';
    $('#route-legend').hidden=!$('#route-legend').textContent;
    map.getContainer().style.setProperty('--city-opacity',cityOpacity);
    if(cityOpacity<.1)cityMarkers.forEach(({marker})=>marker.closeTooltip());
  }
  function navigate(id) {
    id=canonical(id);
    if(allowed(id))location.hash=`country=${id}`;
  }
  function fitView(bounds,maxZoom=10,animate=true) {
    smoothZoom.finish();map.stop();
    const options={maxZoom,paddingTopLeft:[35,90],paddingBottomRight:[80,40]};
    if(reduceMotion||!animate)map.fitBounds(bounds,{...options,animate:false});
    else map.flyToBounds(bounds,{...options,duration:1.25});
  }
  function countryBounds(id) {
    const outline=id===HOME_COUNTRY?(currentState?stateLayers.get(currentState).getBounds():L.latLngBounds([[24,-126],[50,-66]])):countryLayers.get(geometryId(id)).getBounds();
    if(id===HOME_COUNTRY&&!currentState)return outline;
    const places=currentState?statePlaces(currentState):COUNTRY_PLACES[id]||[];
    const candidates=places.map(place=>({...place,weight:1,points:[place.coords]}));
    journeys.filter(journey=>journey.countries.includes(id)).forEach(journey=>(journey.days||[]).forEach(day=>{
      const points=dayPoints(day);
      if(!points.length)return;
      const center=L.latLngBounds(points).getCenter();
      const nearest=[...candidates].sort((a,b)=>center.distanceTo(a.coords)-center.distanceTo(b.coords))[0];
      if(nearest&&center.distanceTo(nearest.coords)<80000){nearest.weight++;nearest.points.push(...points.filter(point=>L.latLng(point).distanceTo(nearest.coords)<100000));}
      else if(outline.contains(center))candidates.push({coords:[center.lat,center.lng],weight:1,points});
    }));
    if(!candidates.length)return outline;
    const neighborhoods=candidates.map(seed=>({seed,members:candidates.filter(candidate=>L.latLng(seed.coords).distanceTo(candidate.coords)<65000)}));
    neighborhoods.forEach(group=>group.weight=group.members.reduce((sum,member)=>sum+member.weight,0));
    neighborhoods.sort((a,b)=>b.weight-a.weight);
    const busiest=neighborhoods[0],total=candidates.reduce((sum,candidate)=>sum+candidate.weight,0);
    const selected=busiest.weight/total>=.6?busiest.members:candidates;
    const bounds=L.latLngBounds(selected.flatMap(candidate=>candidate.points));
    const center=bounds.getCenter();
    bounds.extend([center.lat-.035,center.lng-.055]);bounds.extend([center.lat+.035,center.lng+.055]);
    return bounds.pad(.12);
  }
  function activityContent(day,journey,index) {
    const label=activityLabel(day,journey);
    const ascent=n=>`${day.source?.statistics==='Strava CSV'?'':'~'}${Math.round(n).toLocaleString()} m`;
    const stats=[['distance_m',formatDistance,'Distance'],['elapsed_s',formatDuration,'Elapsed'],['elevation_m',ascent,'Ascent']];
    return `<div class="route-popup"><strong>${escape(label)}</strong><span class="route-mode">${escape(day.sport||ROUTE_MODES[day.type]?.name||'Activity')}</span><time datetime="${escape(day.date)}">${escape(day.date)}</time><div class="route-stats">${stats.filter(([field])=>Number.isFinite(day[field])).map(([field,format,name])=>`<div><b>${format(day[field])}</b><span>${name}</span></div>`).join('')}</div></div>`;
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
        const label=activityLabel(day,journey);
        const line=L.polyline(segment,{pane:'routes',color,weight:3.5,opacity:1,className:'activity-route'}).bindTooltip(escape(label)).on('click',event=>{
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
      const marker=L.marker(city.coords,{pane:'cities',icon:L.divIcon({className:'city-marker',html:`<i style="background:${city.park?'#648243':'#364c60'}"></i>`,iconSize:[8,8],iconAnchor:[4,4]})})
        .bindTooltip(escape(city.name),{permanent:true,interactive:true,direction:'right',offset:[8,0],className:'city-label'}).addTo(cityLayers);
      const reveal=()=>{
        if(map.getZoom()<3.5){if(city.country)navigate(city.country);else if(city.state)location.hash=`country=${HOME_COUNTRY}&state=${city.state}`;return;}
        if(!marker.isTooltipOpen()){marker.openTooltip();const label=marker.getTooltip().getElement();if(label)label.style.visibility='visible';}
      };
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
    const occupied=[...document.querySelectorAll('.map-toolbar,.leaflet-control-zoom,#route-legend')].filter(node=>!node.hidden).map(node=>node.getBoundingClientRect());
    const visible=cityMarkers.filter(({city})=>bounds.contains(city.coords));
    visible.sort((a,b)=>Number(b.city.state===currentState&&Boolean(currentState)||b.city.country===currentCountry)-Number(a.city.state===currentState&&Boolean(currentState)||a.city.country===currentCountry));
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
    backgroundLabels.layout(occupied,new Set(visible.map(({city})=>city.name.toLocaleLowerCase())));
  }
  function renderTransport() {
    transportLayers.clearLayers();
    transport.forEach(trip=>{
      const content=`<div class="route-popup"><strong>${escape(trip.name)}</strong><p>${escape(trip.mode)}${trip.operator?' · '+escape(trip.operator):''}</p>${trip.dates.length?`<time>${trip.dates.map(escape).join(' · ')}</time>`:''}${trip.stops.length>2?`<p>Via ${escape(trip.stops.slice(1,-1).join(', '))}</p>`:''}</div>`;
      const color=ROUTE_MODES[trip.mode]?.color||'#697c84';
      L.polyline(trip.coords,{pane:'routes',color:'white',weight:6,opacity:.85,interactive:false}).addTo(transportLayers);
      const line=L.polyline(trip.coords,{pane:'routes',color,weight:3.5,opacity:1,dashArray:trip.approximate?'5 5':trip.mode==='Ferry'?'8 6':null,className:'transport-route'}).bindTooltip(escape(trip.name)).bindPopup(content,{className:'activity-popup',maxWidth:270}).addTo(transportLayers);
      const node=line.getElement();node.setAttribute('role','button');node.setAttribute('tabindex','0');node.setAttribute('aria-label',`${trip.mode}: ${trip.name}`);
      node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();line.openPopup(L.latLng(trip.coords[Math.floor(trip.coords.length/2)]));}});
    });
    updateRouteLegend();
  }
  function flightContent(connection) {
    const [a,b]=connection.airports;
    const records=connection.flights.map(index=>flightLog.flights[index]).sort((a,b)=>b.date.localeCompare(a.date));
    return `<div class="route-popup flight-popup"><strong>${escape(a)} ↔ ${escape(b)}</strong><p>${escape(flightLog.airports[a].city)} · ${escape(flightLog.airports[b].city)}</p><ol class="flight-history">${records.map(flight=>`<li><time datetime="${escape(flight.date)}">${escape(flight.date)}</time><b>${escape(flight.number)} · ${escape(flight.from)} → ${escape(flight.to)}</b><span>${flight.airline?escape(flight.airline)+' · ':''}${formatDuration(flight.duration_s)}</span></li>`).join('')}</ol></div>`;
  }
  function renderFlights() {
    flightLayers.clearLayers();airportLayers.clearLayers();
    flightLog.routes.forEach(connection=>{
      const label=connection.airports.join(' ↔ ');
      const quiet={color:ROUTE_MODES.Flight.color,weight:1.8,opacity:.62,dashArray:'5 4'};
      const line=L.polyline(connection.segments,{pane:'flights',...quiet,className:'flight-route'})
        .bindTooltip(escape(label)).bindPopup(()=>flightContent(connection),{className:'activity-popup',maxWidth:300}).addTo(flightLayers);
      const highlight=()=>line.setStyle({weight:2.6,opacity:.95});
      const reset=()=>line.setStyle(quiet);
      line.on('mouseover popupopen',highlight).on('mouseout',()=>{if(!line.isPopupOpen())reset();}).on('popupclose',reset);
      const node=line.getElement();node.setAttribute('role','button');node.setAttribute('tabindex','0');node.setAttribute('aria-label',label);
      node.addEventListener('focus',highlight);node.addEventListener('blur',()=>{if(!line.isPopupOpen())reset();});
      node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();const segment=connection.segments[0];line.openPopup(L.latLng(segment[Math.floor(segment.length/2)]));}});
    });
    Object.entries(flightLog.airports).forEach(([code,airport])=>{
      const label=`${airport.city} · ${code}`;
      const marker=L.circleMarker(airport.coords,{pane:'airports',radius:4,color:'white',weight:1.5,fillColor:ROUTE_MODES.Flight.color,fillOpacity:1,className:'airport-marker'})
        .bindTooltip(escape(label)).bindPopup(`<strong>${escape(code)} · ${escape(airport.name)}</strong><p>${escape(airport.city)}</p>`,{maxWidth:270}).addTo(airportLayers);
      const node=marker.getElement();node.setAttribute('role','button');node.setAttribute('tabindex','0');node.setAttribute('aria-label',label);
      node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();marker.openPopup();}});
    });
  }
  function updateRouteLegend() {
    const bounds=map.getBounds();
    const types=new Set(transport.filter(trip=>L.latLngBounds(trip.coords).intersects(bounds)).map(trip=>trip.mode));
    journeys.forEach(journey=>(journey.days||[]).forEach(day=>{if(dayPoints(day).length&&L.latLngBounds(dayPoints(day)).intersects(bounds))types.add(day.type);}));
    if(flightLog.routes.some(connection=>connection.segments.some(segment=>L.latLngBounds(segment).intersects(bounds))))types.add('Flight');
    const modes=[...types].filter(type=>ROUTE_MODES[type]&&(map.getZoom()>=3.5||type==='Flight'));
    const visits=map.getZoom()<5?`<span><i style="background:${visitColors.visited}"></i>Visited</span><span><i style="background:${visitColors.home}"></i>Home</span>`:'';
    $('#route-legend').innerHTML=visits+modes.map(type=>`<span><i style="background:${ROUTE_MODES[type].color}"></i>${ROUTE_MODES[type].name}</span>`).join('');
    $('#route-legend').hidden=!visits&&!modes.length;
  }
  function setGeographyAccess() {
    document.querySelectorAll('.visited-country,.tiny-country').forEach(node=>node.setAttribute('tabindex',currentCountry?'-1':'0'));
  }
  function showCountry(id,animate=true) {
    map.closePopup();currentCountry=id;activeDay=null;
    worldLayer.eachLayer(layer=>layer.closeTooltip());
    stateLayer.eachLayer(layer=>layer.closeTooltip());
    if(id!==HOME_COUNTRY)currentState=null;
    $('#back-us').hidden=!currentState;stateLayer.setStyle(styleState);
    activeJourneys=journeys;
    document.body.dataset.view='country';
    $('#back-world').hidden=false;$('#country-title').hidden=false;$('#country-title').textContent=currentState?US_VISITS[currentState].name:countryName(id);
    document.title=`${currentState?US_VISITS[currentState].name:countryName(id)} — Travel`;$('#map-status').textContent='';
    worldLayer.setStyle(styleCountry);tinyLayer.remove();
    renderTransport();renderRoutes();renderCities();setGeographyAccess();updateBasemap();fitView(countryBounds(id),12,animate);
  }
  function showWorld(animate=true) {
    smoothZoom.finish();map.closePopup();currentCountry=null;currentState=null;$('#back-us').hidden=true;stateLayer.setStyle(styleState);activeDay=null;activeJourneys=journeys;
    document.body.dataset.view='world';
    $('#back-world').hidden=true;$('#country-title').hidden=true;
    $('#map-status').textContent='';document.title='Travel — Ganesh';
    renderTransport();renderRoutes();
    worldLayer.setStyle(styleCountry);tinyLayer.addTo(map);setGeographyAccess();
    if(animate){map.stop();if(reduceMotion)map.fitBounds(worldBounds,{padding:[15,15],animate:false});else map.flyToBounds(worldBounds,{padding:[15,15],duration:1.25});}
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
    return {color:selected?'#858e95':visited?'#b6bdc2':'#d9dde0',weight:selected?1.5:.7,fillOpacity:0};
  }
  function renderStates(states) {
    const features=topojson.feature(states,states.objects.states).features.filter(feature=>!['11','60','66','69','72','78'].includes(String(feature.id).padStart(2,'0')));
    backgroundLabels.geography(features,'state');
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
    node.setAttribute('role','button');node.setAttribute('tabindex','0');node.setAttribute('aria-label',activityLabel(day,journey));
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
    backgroundLabels.geography(features,'country');
    L.geoJSON(features.filter(feature=>isVisitedShape(feature.id)),{
      pane:'visitShading',interactive:false,
      style:feature=>({stroke:false,fillColor:feature.id===HOME_COUNTRY?visitColors.home:visitColors.visited,fillOpacity:.8})
    }).addTo(map);
    worldLayer=L.geoJSON(features,{
      pane:'countries',style:styleCountry,
      onEachFeature(feature,layer){
        const id=String(feature.id),selectable=isVisitedShape(id);
        countryLayers.set(id,layer);layer.options.interactive=selectable;
        layer.options.className=`country-shape ${selectable?'visited-country':''}`;
        if(selectable){
          layer.bindTooltip(countryName(canonical(id)),{sticky:true});
          layer.on('click',()=>{if(!currentCountry)navigate(canonical(id));});
          layer.on('mouseover',()=>{if(!currentCountry)layer.setStyle({color:'#8c959c',weight:1.4});});
          layer.on('mouseout',()=>layer.setStyle(styleCountry(feature)));
          accessibleCountry(layer,canonical(id),countryName(canonical(id)));
        }
      }
    }).addTo(map);
    tinyLayer=L.layerGroup();
    [{id:'156',coords:[22.32,114.17]},{id:'336',coords:[41.9029,12.4534]}].forEach(item=>{
      const marker=L.marker(item.coords,{icon:L.divIcon({className:'tiny-country',html:`<i style="background:${visitColors.visited}"></i>`,iconSize:[10,10],iconAnchor:[5,5]})}).bindTooltip(countryName(item.id)).on('click',()=>navigate(item.id));
      accessibleCountry(marker,item.id,countryName(item.id));marker.addTo(tinyLayer);
    });
    tinyLayer.addTo(map);flightLayers.addTo(map);airportLayers.addTo(map);transportLayers.addTo(map);routeLayers.addTo(map);cityLayers.addTo(map);

  }
  $('#back-us').addEventListener('click',()=>location.hash=`country=${HOME_COUNTRY}`);
  $('#back-world').addEventListener('click',()=>location.hash='');
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&currentCountry&&!map.isPopupOpen())location.hash=currentState?`country=${HOME_COUNTRY}`:'';});
  map.on('popupclose',event=>{if(event.popup===activityPopup){activeDay=null;updateRouteStyles();}});
  map.on('zoom',updateBasemap);
  map.on('moveend',()=>requestAnimationFrame(()=>{if(worldLayer)updateRouteLegend();declutterLabels();}));
  updateBasemap();
  map.on('resize',()=>{if(worldLayer){if(currentCountry)fitView(countryBounds(currentCountry),12);else showWorld();}});
  window.addEventListener('hashchange',()=>{if(worldLayer)route();});
  Promise.all([
    fetch(`data/context.json?v=${assetVersion}`).then(response=>{if(!response.ok)throw Error('Background labels unavailable');return response.json();}),
    fetch('data/us-states.json').then(response=>{if(!response.ok)throw Error('State geography unavailable');return response.json();}),
    fetch('data/world.json').then(response=>{if(!response.ok)throw Error('Geography unavailable');return response.json();}),
    fetch(`data/activities.json?v=${assetVersion}`).then(response=>{if(!response.ok)throw Error('Activities unavailable');return response.json();}),
    fetch(`data/transport.json?v=${assetVersion}`).then(response=>{if(!response.ok)throw Error('Transport unavailable');return response.json();}),
    fetch(`data/flights.json?v=${assetVersion}`).then(response=>{if(!response.ok)throw Error('Flights unavailable');return response.json();})
  ]).then(([context,states,world,activities,connections,flights])=>{
    journeys=activities.journeys||[];transport=connections.routes||[];flightLog=flights;
    backgroundLabels.cities(context.cities||[]);
    renderStates(states);renderWorld(world);renderFlights();renderCities();$('#map-status').textContent='';route();window.ATLAS_READY=true;
    window.ATLAS_MAP=map;
  }).catch(error=>{$('#map-status').textContent='Map unavailable. Refresh to retry.';console.error(error);});
})();
