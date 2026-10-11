(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const assetVersion = new URL(document.querySelector('script[src^="app.js"]').src).searchParams.get('v') || '1';
  const worldBounds = L.latLngBounds([[-58,-178],[80,178]]);
  const colors = ['#b7774a','#4f7e8a','#807398','#859650','#bd825e','#62739d','#a26780'];
  const countryLayers = new Map(), tracks = [];
  let currentCountry = null, activeDay = null, activeJourneys = [], journeys = [], transport = [], worldLayer, tinyLayer, contextData;
  const routeLayers = L.layerGroup(), transportLayers = L.layerGroup(), cityLayers = L.layerGroup(), contextLabels = L.layerGroup();
  const map = L.map('map', {zoomControl:false,scrollWheelZoom:true,dragging:true,touchZoom:true,zoomSnap:.25,minZoom:1,maxZoom:17,worldCopyJump:true});
  L.control.zoom({position:'topright'}).addTo(map);
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution('<a href="https://www.naturalearthdata.com/">Natural Earth</a>');
  map.fitBounds(worldBounds,{padding:[15,15],animate:false});
  map.createPane('context');map.getPane('context').style.zIndex=410;map.getPane('context').style.pointerEvents='none';
  map.createPane('context-labels');map.getPane('context-labels').style.zIndex=440;map.getPane('context-labels').style.pointerEvents='none';
  const contextRenderer=L.canvas({pane:'context',padding:.5});
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
  const allDays = () => activeJourneys.flatMap(journey=>journey.days||[]);
  const cities = () => COUNTRY_PLACES[currentCountry]||[];

  function styleCountry(feature) {
    const id=String(feature.id),visited=isVisitedShape(id),home=id===HOME_COUNTRY;
    if(id==='010')return {opacity:0,fillOpacity:0};
    if(currentCountry) return {color:'#c9d3d9',weight:.7,opacity:.55,fillColor:'#f7f7f2',fillOpacity:1};
    return {color:'#f5f7f8',weight:.7,opacity:1,fillColor:home?'#557b73':visited?'#b7774a':'#c8d0d5',fillOpacity:visited ? .95 : .8};
  }
  function updateBasemap() {
    const visible=Boolean(currentCountry)||map.getZoom()>3.5;
    map.getPane('context').style.opacity=visible?'1':'0';
    contextLabels.clearLayers();
    if(!visible||!contextData)return;
    const bounds=map.getBounds().pad(.1),occupied=[];
    const visited=cities();
    visited.forEach(city=>occupied.push(map.latLngToContainerPoint(city.coords)));
    contextData.cities.filter(city=>bounds.contains(city.coords)).sort((a,b)=>a.rank-b.rank).forEach(city=>{
      if(visited.some(place=>L.latLng(place.coords).distanceTo(city.coords)<6500))return;
      const point=map.latLngToContainerPoint(city.coords);
      if(occupied.some(other=>point.distanceTo(other)<65))return;
      occupied.push(point);
      L.marker(city.coords,{interactive:false,pane:'context-labels',icon:L.divIcon({className:'context-city',html:escape(city.name),iconSize:[100,16],iconAnchor:[0,8]})}).addTo(contextLabels);
    });
  }
  function renderContext(data) {
    contextData=data;
    const geometry=(type,coordinates,style)=>L.geoJSON({type:'Feature',geometry:{type,coordinates},properties:{}},{interactive:false,renderer:contextRenderer,pane:'context',style}).addTo(map);
    geometry('MultiPolygon',data.lakes,{stroke:false,fillColor:'#dceaf1',fillOpacity:1});
    geometry('MultiLineString',data.rivers,{color:'#c9dfe9',weight:1.1,opacity:.85});
    geometry('MultiLineString',data.roads,{color:'#d5d6cd',weight:1.1,opacity:.85});
    contextLabels.addTo(map);
  }
  function navigate(id) {
    id=canonical(id);
    if(allowed(id))location.hash=`country=${id}`;
  }
  function fitView(bounds,maxZoom=10,animate=true) {
    map.stop();
    map.flyToBounds(bounds,{duration:reduceMotion||!animate?0:1.25,maxZoom,paddingTopLeft:[35,90],paddingBottomRight:[80,40]});
  }
  function countryBounds(id) {
    if(id===HOME_COUNTRY)return L.latLngBounds([[24,-126],[50,-66]]);
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
      const color=colors[index%colors.length];
      daySegments(day).forEach(segment=>{
        if(segment.length<2)return;
        const outline=L.polyline(segment,{color:'white',weight:6,opacity:.9,interactive:false}).addTo(routeLayers);
        const label=journey.id==='tmb'?`Day ${index+1}`:journey.name;
        const line=L.polyline(segment,{color,weight:3.5,opacity:1,className:'activity-route'}).bindTooltip(label).on('click',event=>{
          activeDay=day.id;updateRouteStyles();activityPopup.setLatLng(event.latlng).setContent(activityContent(day,journey,index)).openOn(map);
        }).addTo(routeLayers);
        accessibleRoute(line,day,journey,index,segment);
        tracks.push({id:day.id,color,outline,line});
      });
    }));
  }
  function renderCities() {
    cityLayers.clearLayers();
    cities().forEach(city=>{
      const marker=L.circleMarker(city.coords,{radius:5,color:'white',weight:2,fillColor:'#364c60',fillOpacity:1,className:'city-marker'}).bindTooltip(escape(city.name),{permanent:true,direction:'right',offset:[8,0],className:'city-label'}).bindPopup(`<strong>${escape(city.name)}</strong>`,{className:'city-popup'}).addTo(cityLayers);
      const node=marker.getElement();
      node.setAttribute('role','button');node.setAttribute('tabindex','0');node.setAttribute('aria-label',city.name);
      node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();marker.openPopup();}});
    });
  }
  function renderTransport() {
    transportLayers.clearLayers();
    transport.filter(trip=>trip.countries.includes(currentCountry)).forEach(trip=>{
      const content=`<div class="route-popup"><strong>${escape(trip.name)}</strong><p>${escape(trip.mode)}${trip.operator?' · '+escape(trip.operator):''}</p><time>${trip.dates.map(escape).join(' · ')}</time><p class="route-note">Approximate connection${trip.stops.length>2?' · via '+escape(trip.stops.slice(1,-1).join(', ')):''}</p></div>`;
      const line=L.polyline(trip.coords,{color:'#697c84',weight:2.5,opacity:.8,dashArray:'6 7',className:'transport-route'}).bindTooltip(escape(trip.name)).bindPopup(content,{className:'activity-popup',maxWidth:270}).addTo(transportLayers);
      const node=line.getElement();
      node.setAttribute('role','button');node.setAttribute('tabindex','0');node.setAttribute('aria-label',`${trip.mode}: ${trip.name}`);
      node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();line.openPopup(L.latLng(trip.coords[Math.floor(trip.coords.length/2)]));}});
    });
  }
  function setGeographyAccess() {
    document.querySelectorAll('.visited-country,.tiny-country').forEach(node=>node.setAttribute('tabindex',currentCountry?'-1':'0'));
  }
  function showCountry(id,animate=true) {
    map.closePopup();currentCountry=id;activeDay=null;
    activeJourneys=journeys.filter(journey=>journey.countries.includes(id));
    document.body.dataset.view='country';
    $('#back-world').hidden=false;$('#country-title').hidden=false;$('#country-title').textContent=countryName(id);
    document.title=`${countryName(id)} — Atlas`;$('#map-status').textContent='';
    worldLayer.setStyle(styleCountry);tinyLayer.remove();
    renderTransport();renderRoutes();renderCities();setGeographyAccess();updateBasemap();fitView(countryBounds(id),11,animate);
  }
  function showWorld(animate=true) {
    map.closePopup();currentCountry=null;activeDay=null;activeJourneys=[];
    document.body.dataset.view='world';
    $('#back-world').hidden=true;$('#country-title').hidden=true;
    $('#map-status').textContent='';document.title='Atlas — Ganesh';
    routeLayers.clearLayers();transportLayers.clearLayers();cityLayers.clearLayers();tracks.length=0;
    worldLayer.setStyle(styleCountry);tinyLayer.addTo(map);setGeographyAccess();
    if(animate){map.stop();map.flyToBounds(worldBounds,{padding:[15,15],duration:reduceMotion?0:1.25});}
    updateBasemap();
  }
  function route() {
    const raw=new URLSearchParams(location.hash.slice(1)).get('country');
    const id=canonical(raw);
    if(id&&allowed(id))showCountry(id);
    else {if(raw)history.replaceState(null,'',location.pathname+location.search);showWorld(Boolean(currentCountry));}
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
      style:styleCountry,
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
      const marker=L.circleMarker(item.coords,{radius:5,color:'white',weight:1.5,fillColor:'#b7774a',fillOpacity:1,className:'tiny-country'}).bindTooltip(countryName(item.id)).on('click',()=>navigate(item.id));
      accessibleCountry(marker,item.id,countryName(item.id));marker.addTo(tinyLayer);
    });
    tinyLayer.addTo(map);transportLayers.addTo(map);routeLayers.addTo(map);cityLayers.addTo(map);
    $('#visited-count').textContent=Object.keys(VISITED_COUNTRIES).length;
  }
  $('#back-world').addEventListener('click',()=>location.hash='');
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&currentCountry&&!map.isPopupOpen())location.hash='';});
  map.on('popupclose',event=>{if(event.popup===activityPopup){activeDay=null;updateRouteStyles();}});
  map.on('moveend',updateBasemap);
  map.on('resize',()=>{if(worldLayer){if(currentCountry)fitView(countryBounds(currentCountry),11);else showWorld();}});
  window.addEventListener('hashchange',()=>{if(worldLayer)route();});
  Promise.all([
    fetch('data/world.json').then(response=>{if(!response.ok)throw Error('Geography unavailable');return response.json();}),
    fetch(`data/activities.json?v=${assetVersion}`).then(response=>{if(!response.ok)throw Error('Activities unavailable');return response.json();}),
    fetch(`data/context.json?v=${assetVersion}`).then(response=>{if(!response.ok)throw Error('Context unavailable');return response.json();}),
    fetch(`data/transport.json?v=${assetVersion}`).then(response=>{if(!response.ok)throw Error('Transport unavailable');return response.json();})
  ]).then(([world,activities,context,connections])=>{
    journeys=activities.journeys||[];transport=connections.routes||[];
    renderWorld(world);renderContext(context);$('#map-status').textContent='';route();window.ATLAS_READY=true;
    window.ATLAS_MAP=map;
  }).catch(error=>{$('#map-status').textContent='Map unavailable. Refresh to retry.';console.error(error);});
})();
