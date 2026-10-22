(() => {
  'use strict';
  const L = window.ATLAS_RENDERER || window.L;
  const $ = selector => document.querySelector(selector);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const worldBounds = L.latLngBounds([[-58,-178],[80,178]]);
  const colors = ['#b7774a','#4f7e8a','#807398','#859650','#bd825e','#62739d','#a26780'];
  const visitColors = {visited:'#c79572',home:'#829e94'};
  const countryLayers = new Map(), tracks = [];
  let currentCountry = null, currentState = null, stateLayer, activeDay = null, journeys = [], transport = [], worldLayer, tinyLayer;
  const stateLayers=new Map(), cityMarkers=[], airportMarkers=[];
  const routeLayers = L.layerGroup(), transportLayers = L.layerGroup(), cityLayers = L.layerGroup();
  const flightLayers = L.layerGroup(), airportLayers = L.layerGroup();
  const routeEntries = {transport: [], activities: [], flights: []};
  const activityGeometry = new WeakMap();
  let flightLog = {airports:{},flights:[],routes:[]};
  let labelTimer = null, routeFrame = null, cameraMoving = false;
  const map = L.map('map', {zoomControl:false,scrollWheelZoom:false,dragging:true,touchZoom:true,zoomSnap:0,zoomDelta:.5,zoomAnimation:false,minZoom:1,maxZoom:17,worldCopyJump:true});
  map.atlasRenderer = L;
  const smoothZoom = installSmoothZoom(map, reduceMotion);
  // With zoomSnap 0, Leaflet's stop() fires viewreset and re-projects every
  // route, a long pause before the next animation. Only stop one that runs.
  const stopCamera = () => { smoothZoom.finish(); if (cameraMoving) map.stop(); };
  const CityTooltip = L.Tooltip.extend({
    _initLayout() {
      L.Tooltip.prototype._initLayout.call(this);
      this.layoutVisible=false;this.fadeUntil=0;this.layoutDirection=null;
    },
    setLayoutVisible(visible) {
      if (this.layoutVisible && !visible) this.fadeUntil = performance.now() + 180;
      this.layoutVisible = visible;
      if (visible) this._updatePosition();
      const node = this.getElement();
      node.classList.toggle('label-visible', visible);
      node.setAttribute('aria-hidden', String(!visible));
    },
    _setPosition(point) {
      if (!this.labelSize || !this.layoutVisible && performance.now() >= (this.fadeUntil || 0)) return;
      // Text dimensions are measured once by declutterLabels, not interleaved
      // with thousands of marker writes in Leaflet's zoom listeners.
      const {width, height} = this.labelSize, direction = this.options.direction;
      const x = direction === 'left' ? width : direction === 'right' ? 0 : width / 2;
      const y = direction === 'top' ? height : direction === 'bottom' ? 0 : height / 2;
      if (this.layoutDirection !== direction) {
        ['right', 'left', 'top', 'bottom'].forEach(value => this._container.classList.toggle(`leaflet-tooltip-${value}`, value === direction));
        this.layoutDirection = direction;
      }
      L.DomUtil.setPosition(this._container, point.subtract(L.point(x, y, true)).add(L.point(this.options.offset)).add(this._getAnchor()));
    }
  });
  map.createPane('states');map.getPane('states').style.zIndex=360;
  map.createPane('routes');map.getPane('routes').style.zIndex=420;
  map.createPane('flights');map.getPane('flights').style.zIndex=420;
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
  const atlasPhotos = installAtlasPhotos(map, {onLayout: () => declutterLabels(), focus: target => {
    stopCamera();
    currentCountry=target.country||null;currentState=null;
    stateLayer.setStyle(styleState);
    const complete=()=>{map.off('moveend',complete);target.complete?.();};
    if(target.complete)map.once('moveend',complete);
    if(target.coords) {
      const coords=L.latLng(target.coords),zoom=Math.min(17,target.zoom);
      if(map.getCenter().equals(coords)&&map.getZoom()===zoom)complete();
      else if(reduceMotion)map.setView(coords,zoom,{animate:false});
      else map.flyTo(coords,zoom,{duration:1.1});
    } else fitView(target.bounds,target.maxZoom);
    return ()=>map.off('moveend',complete);
  }});
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution('Routes © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>');
  map.attributionControl.addAttribution('<a href="https://www.naturalearthdata.com/">Natural Earth</a>');
  map.attributionControl.addAttribution('Airports: <a href="https://ourairports.com/data/">OurAirports</a>');
  map.fitBounds(worldBounds,{padding:[15,15],animate:false});
  // Leaflet maps have no isPopupOpen(); any open popup is in the DOM.
  const popupOpen=()=>Boolean(map.getContainer().querySelector('.leaflet-popup'));
  const cards=installRouteCards(L);
  const settings=$('#map-settings');
  let distanceUnit='km';
  try {if(localStorage.getItem('atlas-distance-unit')==='mi')distanceUnit='mi';}catch{}
  cards.setDistanceUnit(distanceUnit);
  settings.querySelector(`input[value="${distanceUnit}"]`).checked=true;
  const globeView=Boolean(window.ATLAS_RENDERER);
  settings.querySelector(`input[name="map-view"][value="${globeView?'globe':'flat'}"]`).checked=true;
  if(!window.ATLAS_GLOBE_SUPPORTED){settings.querySelector('input[name="map-view"][value="globe"]').disabled=true;settings.querySelector('.map-view-note').hidden=false;}
  const showPhotos=$('#show-photos');
  try {showPhotos.checked=localStorage.getItem('atlas-show-photos')!=='false';}catch{}
  atlasPhotos.setVisible(showPhotos.checked);
  $('#map-settings-button').addEventListener('click',()=>settings.showModal());
  settings.addEventListener('change',event=>{
    if(event.target===showPhotos){
      atlasPhotos.setVisible(showPhotos.checked);
      try {localStorage.setItem('atlas-show-photos',String(showPhotos.checked));}catch{}
      return;
    }
    if(event.target.matches('input[name="map-view"]')){
      // Each view builds its own renderer, so reload into the chosen one.
      // The hash keeps the place, card and trip that were open.
      try {localStorage.setItem('atlas-map-view',event.target.value);}catch{}
      location.reload();
      return;
    }
    if(!event.target.matches('input[name="distance-unit"]'))return;
    distanceUnit=event.target.value;
    cards.setDistanceUnit(distanceUnit);
    itineraries.refresh();
    try {localStorage.setItem('atlas-distance-unit',distanceUnit);}catch{}
  });
  settings.addEventListener('keydown',event=>event.stopPropagation());
  settings.addEventListener('click',event=>{
    if(event.target!==settings)return;
    const rect=settings.getBoundingClientRect();
    if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)settings.close();
  });
  const cardOptions={className:'route-card-popup',maxWidth:320,minWidth:300,autoPanPaddingTopLeft:[20,70],autoPanPaddingBottomRight:[20,20]};
  const activityPopup=L.popup(cardOptions);
  const badgeLayers=L.layerGroup(),flightLines=[],hitLines=[];
  let allPhotos=[];
  const AIRLINES={DL:'Delta',UA:'United',WN:'Southwest',B6:'JetBlue',AA:'American',NK:'Spirit',LA:'LATAM',F9:'Frontier',DY:'Norwegian',FR:'Ryanair',CX:'Cathay Pacific',AS:'Alaska',FI:'Icelandair',TK:'Turkish Airlines',AI:'Air India',BA:'British Airways',PD:'Porter',LX:'Swiss',A3:'Aegean',RJ:'Royal Jordanian',VB:'Viva Aerobus',W9:'Wizz Air',W4:'Wizz Air',EC:'easyJet','6E':'IndiGo'};
  // Treks keep their recorded day titles; other activity titles name the place.
  const TREKS={tmb:'Tour du Mont Blanc','chile-activities':'W Trek'};
  const ACTIVITY_NOUNS={hiking:'Hike',walking:'Walk',running:'Run',cycling:'Bike ride'};
  const routeHover=new Map();let hotRoutes=[];
  const itineraries=installTripItineraries({cards,modes:ROUTE_MODES,
    onFit:fitBesidePanel,onHighlight:highlightRoutes,onToggle:panelToggled,
    closePopup:()=>map.closePopup(),geometry:legPoints,photos:()=>allPhotos,showPhotos:ids=>atlasPhotos.show(ids)});
  const GENERIC_NAME=/^(morning|lunch|afternoon|evening|night) (walk|hike|ride|run|e-bike ride)$/i;
  const routeHint=document.createElement('p');routeHint.id='route-hint';routeHint.hidden=true;
  routeHint.innerHTML='<span class="hint-dot"></span>Tap any route for details';$('#main').append(routeHint);
  const hintSeen=()=>{try{return localStorage.getItem('route-hint-seen')==='1';}catch{return false;}};
  const canonical = id => id === '344' ? '156' : id;
  const allowed = id => Boolean(VISITED_COUNTRIES[id]) || id === HOME_COUNTRY;
  const geometryId = id => VISITED_COUNTRIES[id]?.geometry || id;
  const countryName = id => id === HOME_COUNTRY ? 'United States' : VISITED_COUNTRIES[id].name + (VISITED_COUNTRIES[id].scope ? ` · ${VISITED_COUNTRIES[id].scope}` : '');
  const isVisitedShape = id => id !== '156' && allowed(canonical(id));
  const formatDuration = s => {const m=Math.round(s/60);return m<60?`${m}m`:`${Math.floor(m/60)}h ${m%60}m`;};
  const daySegments = day => {
    if (activityGeometry.has(day)) return activityGeometry.get(day).segments;
    const segments=day.segments || (day.coords ? [day.coords] : []);
    const split=[];
    if(day.sport==='Walk')segments.forEach(segment=>{
      let current=[];
      segment.forEach(point=>{
        if(current.length&&cards.haversine(current[current.length-1],point)>.5){if(current.length>1)split.push(current);current=[];}
        current.push(point);
      });
      if(current.length>1)split.push(current);
    });
    const display = day.sport === 'Walk' ? split : segments;
    const points = display.flat();
    activityGeometry.set(day, {segments: display, points, bounds: L.latLngBounds(points)});
    return display;
  };
  const dayPoints = day => { daySegments(day); return activityGeometry.get(day).points; };
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
    map.getPane('countries').style.pointerEvents='auto';
    const stateOpacity=Math.max(0,Math.min(1,(zoom-3.3)/1.2));
    map.getPane('states').style.opacity=stateOpacity;
    map.getPane('states').style.pointerEvents=stateOpacity>.1?'auto':'none';
    const cityOpacity=Math.max(0,Math.min(1,(zoom-3.4)/1.2));
    map.getPane('cities').style.opacity=1;
    const routeOpacity=Math.max(0,Math.min(1,(zoom-3)/1.5));
    map.getPane('routes').style.opacity=routeOpacity;map.getPane('routes').style.pointerEvents=routeOpacity>.1?'auto':'none';
    map.getPane('airports').hidden=zoom<4.5;
    $('#route-legend').hidden=!$('#route-legend').textContent;
    map.getContainer().style.setProperty('--city-opacity',cityOpacity);
    const closeView=Math.max(0,Math.min(1,(zoom-7)/4));
    map.getContainer().style.setProperty('--flight-context',1-closeView*.88);
  }
  function fitView(bounds,maxZoom=10,animate=true) {
    stopCamera();
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
      const center=activityGeometry.get(day).bounds.getCenter();
      const nearest=[...candidates].sort((a,b)=>center.distanceTo(a.coords)-center.distanceTo(b.coords))[0];
      if(nearest&&center.distanceTo(nearest.coords)<80000){nearest.weight++;nearest.points.push(...points.filter(point=>L.latLng(point).distanceTo(nearest.coords)<100000));}
      else if(outline.contains(center))candidates.push({coords:[center.lat,center.lng],weight:1,points:[...points]});
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
  const longestSegment=day=>daySegments(day).reduce((a,b)=>b.length>a.length?b:a,[]);
  function nearestPlace(coords) {
    let best=null,distance=Infinity;
    cities().forEach(place=>{const d=cards.haversine(coords,place.coords);if(d<distance){distance=d;best=place;}});
    return distance<30?best.name:null;
  }
  const countriesLabel=ids=>(ids||[]).map(canonical).filter(allowed).map(countryName).join(' · ');
  // Titles say what and where; a Strava name that is not a default one becomes the quote.
  function activityTitle(day,journey) {
    const trek=TREKS[journey.id],days=journey.days||[];
    if(trek)return journey.id==='tmb'?(day.name||'').replace(/^TMB/,trek):`${trek} · Day ${days.indexOf(day)+1}`;
    const noun=ACTIVITY_NOUNS[day.type]||'Activity',place=nearestPlace(cards.midpoint(longestSegment(day)));
    if(place)return `${noun} ${day.type==='hiking'?'near':'in'} ${place}`;
    const country=(day.countries||[]).map(canonical).filter(allowed).map(id=>VISITED_COUNTRIES[id]?.name||countryName(id))[0];
    return country?`${noun} in ${/^(United|Netherlands)/.test(country)?'the ':''}${country}`:noun;
  }
  function activityContent(day,journey) {
    const trek=TREKS[journey.id],days=journey.days||[],index=days.indexOf(day),minutes=Math.round((day.elapsed_s||0)/60);
    const context=itineraries.forActivity(day),trip=itineraries.card(context);
    const stats=[];
    if(Number.isFinite(day.distance_m))stats.push(cards.distance(day.distance_m/1000,1));
    if(Number.isFinite(day.elapsed_s))stats.push([`${Math.floor(minutes/60)}:${String(minutes%60).padStart(2,'0')}`,'Hours']);
    if(Number.isFinite(day.elevation_m))stats.push([Math.round(day.elevation_m).toLocaleString(),'Climb m']);
    return cards.html({modeKey:day.type,modeName:ACTIVITY_NOUNS[day.type]||'Activity',color:ROUTE_MODES[day.type]?.color||colors[0],
      context:trip?`Day ${trip.index+1} of ${trip.steps.length}`:trek&&days.length>1?`${index+1} of ${days.length} · ${trek}`:'',
      title:trek&&trip?trip.title:activityTitle(day,journey),quote:!trek&&day.name&&!GENERIC_NAME.test(day.name)?day.name:'',
      subtitle:countriesLabel(day.countries),stats,photos:cards.photosNear(allPhotos,dayPoints(day),1.5),trip,
      // Trip days are browsed in the itinerary panel; only a trek without one steps here.
      stepper:!trip&&trek&&days.length>1?{index,total:days.length}:null,
      attrs:`data-journey="${journeys.indexOf(journey)}" data-day="${index}"`});
  }
  function openActivity(day,journey,latlng) {
    itineraries.sync(itineraries.forActivity(day));
    activeDay=day.id;updateRouteStyles();
    activityPopup.setLatLng(latlng||cards.midpoint(longestSegment(day))).setContent(activityContent(day,journey)).openOn(map);
  }
  function stepActivity(journeyIndex,dayIndex) {
    const journey=journeys[journeyIndex],day=journey?.days?.[dayIndex];if(!day)return;
    stopCamera();
    activeDay=day.id;updateRouteStyles();
    // Move the card to this section before deciding whether the camera must pan.
    const autoPan=activityPopup.options.autoPan;
    activityPopup.options.autoPan=false;
    try {activityPopup.setLatLng(cards.midpoint(longestSegment(day))).setContent(activityContent(day,journey));}
    finally {activityPopup.options.autoPan=autoPan;}
    panRoutePopupIntoView();
  }
  function panRoutePopupIntoView() {
    if(!activityPopup.isOpen())return;
    const container=map.getContainer(),card=activityPopup.getElement().getBoundingClientRect(),view=container.getBoundingClientRect();
    // Leaflet resets browser scrolling caused by button focus; ignore that temporary offset.
    const left=card.left-view.left+container.scrollLeft,top=card.top-view.top+container.scrollTop;
    const x=left+card.width>view.width-20?left+card.width-view.width+20:left<20?left-20:0;
    const y=top+card.height>view.height-20?top+card.height-view.height+20:top<70?top-70:0;
    // Only reveal overflow; panBy keeps the zoom fixed, even for distant sections.
    if(x||y)map.panBy([x,y],{animate:!reduceMotion,duration:.6,easeLinearity:.25});
  }
  function legRecord(ref) {
    const journey=ref.kind==='activity'?journeys.find(item=>item.days?.some(day=>day.id===ref.id)):null;
    return {journey,day:journey?.days.find(item=>item.id===ref.id),connection:ref.kind==='transport'?transport.find(item=>item.id===ref.id):null};
  }
  function legPoints(ref) {
    if(ref.kind==='flight')return flightLog.routes.find(route=>route.airports.join('-')===ref.id)?.segments.flat()||[];
    const {day,connection}=legRecord(ref);
    return day?dayPoints(day):connection?.coords||[];
  }
  // Itinerary hovers reuse the map's own route hover: lift these, fade the rest.
  function highlightRoutes(refs) {
    hotRoutes.forEach(node=>node?.classList.remove('itinerary-hot'));
    hotRoutes=(refs||[]).flatMap(ref=>routeHover.get(`${ref.kind}:${ref.id}`)?.()||[]);
    hotRoutes.forEach(node=>node?.classList.add('itinerary-hot'));
    map.getContainer().classList.toggle('itinerary-hovering',hotRoutes.length>0);
  }
  // The panel covers the map's right side (bottom on phones); fit routes in the rest.
  function panelPadding() {
    const panel=$('#trip-itinerary'),phone=matchMedia('(max-width: 600px)').matches;
    return phone?{paddingTopLeft:[20,64],paddingBottomRight:[20,panel.offsetHeight+16]}:{paddingTopLeft:[35,90],paddingBottomRight:[panel.offsetWidth+56,40]};
  }
  function fitBesidePanel(points) {
    if(!points?.length)return;
    stopCamera();atlasPhotos.cancel();
    const bounds=L.latLngBounds(points),options={maxZoom:13,...panelPadding()};
    if(reduceMotion)map.fitBounds(bounds,{...options,animate:false});
    else map.flyToBounds(bounds,{...options,duration:1.1});
  }
  // The map slides aside for the panel and back when it closes. A trip view
  // already fits beside the panel, so it only needs the slide back.
  let panelShift=null;
  function panelToggled(open,pan) {
    const padding=panelPadding(),panel=$('#trip-itinerary'),phone=matchMedia('(max-width: 600px)').matches;
    activityPopup.options.autoPanPaddingBottomRight=open?padding.paddingBottomRight.map(value=>value+4):[20,20];
    // Pan with the panel's own slide: same duration, and easeLinearity 1/3 is
    // Leaflet's cubic ease-out, the curve of the panel's CSS transition. The
    // transition starts at the next frame's style pass, so the pan does too.
    const options={animate:!reduceMotion,duration:parseFloat(getComputedStyle(panel).transitionDuration)||.34,easeLinearity:1/3};
    if(open) {
      panelShift=phone?[0,Math.round(panel.offsetHeight/2)]:[Math.round(panel.offsetWidth/2),0];
      if(pan){stopCamera();const shift=panelShift;requestAnimationFrame(()=>map.panBy(shift,options));}
    } else {
      highlightRoutes(null);
      if(panelShift){stopCamera();const shift=panelShift.map(value=>-value);requestAnimationFrame(()=>map.panBy(shift,options));}
      panelShift=null;
    }
  }
  // Hovering a route or its badge lifts it and fades the rest.
  function hoverRoute(elements,on) {
    map.getContainer().classList.toggle('route-hovering',on);
    elements().forEach(node=>node?.classList.toggle('route-hot',on));
  }
  // An invisible line makes thin routes easy to click; the badge marks the route once.
  // Both widen only at regional zoom, where they would otherwise cover whole countries.
  const REGIONAL_ZOOM=6.5,hitWeight=()=>map.getZoom()>=REGIONAL_ZOOM?18:6;
  function routeTarget({coords,group,label,open,hover}) {
    const line=L.polyline(coords,{pane:'routes',color:'#000',opacity:0,weight:hitWeight(),className:'route-hit'}).bindTooltip(escapeHtml(label),{sticky:true})
      .on('click',event=>open(event.latlng)).on('mouseover',()=>hoverRoute(hover,true)).on('mouseout',()=>hoverRoute(hover,false)).addTo(group);
    hitLines.push(line);return line;
  }
  function routeBadge({coords,modeKey,color,label,open,hover,entry}) {
    const mid=cards.midpoint(coords);
    entry.badge=L.marker(mid,{icon:cards.badge(modeKey,color),keyboard:false,riseOnHover:true}).bindTooltip(escapeHtml(label),{direction:'top',offset:[0,-12]})
      .on('click',()=>open(L.latLng(mid))).on('mouseover',()=>hoverRoute(hover,true)).on('mouseout',()=>hoverRoute(hover,false)).addTo(badgeLayers);
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
    routeLayers.clearLayers();tracks.length=0;routeEntries.activities.length=0;
    journeys.forEach(journey=>(journey.days||[]).forEach((day,index)=>{
      const color=ROUTE_MODES[day.type]?.color||colors[index%colors.length];
      const segments=daySegments(day), entry={mode:day.type,bounds:[activityGeometry.get(day).bounds],layers:[]};
      if(entry.bounds[0].isValid())routeEntries.activities.push(entry);
      const label=activityTitle(day,journey),open=latlng=>openActivity(day,journey,latlng);
      const hover=()=>[...entry.layers.map(layer=>layer.getElement()),entry.badge?.getElement()];
      routeHover.set(`activity:${day.id}`,hover);
      segments.forEach(segment=>{
        if(segment.length<2)return;
        const outline=L.polyline(segment,{pane:'routes',color:'white',weight:6,opacity:.9,interactive:false,className:'route-flow'}).addTo(routeLayers);
        const line=L.polyline(segment,{pane:'routes',color,weight:3.5,opacity:1,interactive:false,className:'activity-route route-flow'}).addTo(routeLayers);
        routeTarget({coords:segment,group:routeLayers,label,open,hover});
        accessibleRoute(line,day,journey,segment);
        tracks.push({id:day.id,color,outline,line});
        entry.layers.push(outline,line);
      });
      if(entry.layers.length)routeBadge({coords:longestSegment(day),modeKey:day.type,color,label,open,hover,entry});
    }));
  }
  function renderCities() {
    cityLayers.clearLayers();cityMarkers.length=0;
    cities().forEach(city=>{
      const marker=L.marker(city.coords,{pane:'cities',icon:L.divIcon({className:'city-marker',html:`<i style="background:${city.park?'#648243':'#364c60'}"></i>`,iconSize:[8,8],iconAnchor:[4,4]})})
        .bindTooltip(new CityTooltip({permanent:true,interactive:true,direction:'right',offset:[8,0],className:'city-label'}).setContent(escapeHtml(city.name))).addTo(cityLayers);
      const reveal=()=>{
        marker.openTooltip();const tooltip=marker.getTooltip(),label=tooltip.getElement();
        if(label){if(!tooltip.labelSize)tooltip.labelSize={width:label.offsetWidth,height:label.offsetHeight};tooltip.setLayoutVisible(true);}
      };
      marker.on('click',reveal);
      const node=marker.getElement();node.setAttribute('role','button');node.setAttribute('tabindex','0');node.setAttribute('aria-label',city.name+(city.park?' National park':''));
      node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();reveal();}});
      node.addEventListener('focus',reveal);
      cityMarkers.push({marker,city});
    });
    declutterLabels();
  }
  function queueLabelLayout() {
    if (labelTimer !== null) return;
    labelTimer=setTimeout(()=>{labelTimer=null;if(worldLayer)declutterLabels();},cameraMoving?300:120);
  }
  function declutterLabels() {
    const zoom=map.getZoom(),bounds=map.getBounds(),size=map.getSize();
    const root=map.getContainer().getBoundingClientRect();
    const occupied=[...document.querySelectorAll('.map-toolbar,.map-settings-button,#route-legend')].filter(node=>!node.hidden).map(node=>node.getBoundingClientRect());
    occupied.push(...atlasPhotos.occupied());
    layoutAirportLabels(occupied,root,size);
    const visible=cityMarkers.filter(({city})=>bounds.contains(city.coords)&&(!map.isLocationVisible||map.isLocationVisible(city.coords)));
    const selected=entry=>Number(entry.city.state===currentState&&Boolean(currentState)||entry.city.country===currentCountry);
    const wasVisible=entry=>Boolean(entry.marker.getTooltip()?.getElement()?.classList.contains('label-visible'));
    visible.sort((a,b)=>selected(b)-selected(a)||Number(wasVisible(b))-Number(wasVisible(a)));
    // Measure text in one batch, then place labels with projected rectangles.
    // Avoid repeated tooltip updates and forced layout for every candidate.
    visible.forEach(entry=>{if(!entry.marker.isTooltipOpen())entry.marker.openTooltip();const tooltip=entry.marker.getTooltip(),node=tooltip.getElement();if(node&&!entry.labelSize)entry.labelSize={width:node.offsetWidth,height:node.offsetHeight};tooltip.labelSize=entry.labelSize;});
    cityMarkers.filter(item=>!visible.includes(item)).forEach(({marker})=>marker.closeTooltip());
    visible.forEach(({marker,labelSize})=>{
      const tooltip=marker.getTooltip(),node=tooltip.getElement();if(!node||!labelSize)return;
      const retained=node.classList.contains('label-visible');let placed=false;
      if(zoom>=(retained?3.35:3.6)) {
        const directions=[...new Set([tooltip.options.direction,'right','left','top','bottom'])];
        for(const direction of directions) {
          const offset=L.point(direction==='right'?8:direction==='left'?-8:0,direction==='top'?-6:direction==='bottom'?6:0);
          const point=map.latLngToContainerPoint(marker.getLatLng()),anchor=L.point(marker.options.icon.options.tooltipAnchor||[0,0]);
          const left=root.left+point.x+offset.x+anchor.x+(direction==='right'?6:direction==='left'?-6:0)-(direction==='left'?labelSize.width:direction==='right'?0:Math.round(labelSize.width/2));
          const top=root.top+point.y+offset.y+anchor.y+(direction==='bottom'?6:direction==='top'?-6:0)-(direction==='top'?labelSize.height:direction==='bottom'?0:Math.round(labelSize.height/2));
          const rect={left,top,right:left+labelSize.width,bottom:top+labelSize.height};
          const inside=rect.left>=root.left+8&&rect.right<=root.left+size.x-8&&rect.top>=root.top+8&&rect.bottom<=root.top+size.y-25;
          const gap=retained?3:7;
          const collides=occupied.some(other=>rect.left<other.right+gap&&rect.right+gap>other.left&&rect.top<other.bottom+gap&&rect.bottom+gap>other.top);
          if(inside&&!collides){
            if(tooltip.options.direction!==direction){tooltip.options.direction=direction;tooltip.options.offset=offset;tooltip.update();}
            occupied.push(rect);placed=true;break;
          }
        }
      }
      tooltip.setLayoutVisible(placed);
    });
    backgroundLabels.layout(occupied,new Set(visible.map(({city})=>city.name.toLocaleLowerCase())));
  }
  function layoutAirportLabels(occupied,root,size) {
    const zoom=map.getZoom(),bounds=map.getBounds();
    airportMarkers.forEach(({marker})=>marker.getElement().classList.remove('airport-code-visible','airport-code-left'));
    if(zoom<4.5)return;
    const visible=airportMarkers.filter(({marker})=>bounds.contains(marker.getLatLng())&&(!map.isLocationVisible||map.isLocationVisible(marker.getLatLng())));
    const positions=visible.map(({marker})=>({node:marker.getElement(),point:map.latLngToContainerPoint(marker.getLatLng())}));
    // Reserve every badge before placing codes, then give busier airports priority.
    positions.forEach(({point})=>occupied.push({left:root.left+point.x-14,right:root.left+point.x+14,top:root.top+point.y-14,bottom:root.top+point.y+14}));
    if(zoom<6.5)return;
    positions.forEach(({node,point})=>{
      for(const left of [false,true]) {
        const x=root.left+point.x+(left?-58:18),y=root.top+point.y-11;
        const rect={left:x,right:x+40,top:y,bottom:y+22};
        if(rect.left<root.left+8||rect.right>root.right-8||rect.top<root.top+8||rect.bottom>root.top+size.y-25)continue;
        if(occupied.some(other=>rect.left<other.right+3&&rect.right+3>other.left&&rect.top<other.bottom+3&&rect.bottom+3>other.top))continue;
        node.classList.add('airport-code-visible');node.classList.toggle('airport-code-left',left);occupied.push(rect);break;
      }
    });
  }
  function renderTransport() {
    transportLayers.clearLayers();routeEntries.transport.length=0;
    transport.forEach(trip=>{
      const color=ROUTE_MODES[trip.mode]?.color||'#697c84';
      const outline=L.polyline(trip.coords,{pane:'routes',color:'white',weight:6,opacity:.85,interactive:false,className:'route-flow'}).addTo(transportLayers);
      const line=L.polyline(trip.coords,{pane:'routes',color,weight:3.5,opacity:1,interactive:false,className:'transport-route route-flow'}).addTo(transportLayers);
      const entry={mode:trip.mode,bounds:[line.getBounds()],layers:[outline,line]};routeEntries.transport.push(entry);
      const open=latlng=>openTransport(trip,latlng);
      const hover=()=>[outline.getElement(),line.getElement(),entry.badge?.getElement()];
      routeHover.set(`transport:${trip.id}`,hover);
      routeTarget({coords:trip.coords,group:transportLayers,label:trip.name,open,hover});
      routeBadge({coords:trip.coords,modeKey:trip.mode,color,label:trip.name,open,hover,entry});
      const node=line.getElement();node.setAttribute('role','button');node.setAttribute('tabindex','0');node.setAttribute('aria-label',`${trip.mode}: ${trip.name}`);
      node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open();}});
    });
    updateRouteLegend();
  }
  function openTransport(trip,latlng) {
    activeDay=null;updateRouteStyles();
    itineraries.sync(itineraries.forTransport(trip));
    const color=ROUTE_MODES[trip.mode]?.color||'#697c84';
    activityPopup.setLatLng(latlng||cards.midpoint(trip.coords)).setContent(transportContent(trip,color)).openOn(map);
  }
  // Names like "Chamonix → Courmayeur · Skyway" keep the arrow part as the title.
  function transportContent(trip,color) {
    const itinerary=itineraries.card(itineraries.forTransport(trip));
    const [head,...rest]=trip.name.split(' · '),arrow=/[→↔]/.test(head);
    const title=arrow?head:`${trip.stops[0]} → ${trip.stops[trip.stops.length-1]}`;
    if(trip.mode==='Bus')return busContent(trip,color,title,arrow?rest:[trip.name]);
    const details=[...(arrow?rest:[trip.name]),trip.operator,trip.vessel,countriesLabel(trip.countries)].filter(Boolean);
    const stats=[cards.distance(cards.km(trip.coords))];
    if(trip.stops.length>2)stats.push([trip.stops.length,'Stops']);
    if(trip.countries?.length>1)stats.push([trip.countries.length,'Countries']);
    return cards.html({modeKey:trip.mode,modeName:trip.mode,color,title,subtitle:details.join(' · '),
      stops:trip.stops,stats,photos:cards.photosNear(allPhotos,trip.coords,3),trip:itinerary,
      context:itinerary?`Day ${itinerary.index+1} of ${itinerary.steps.length}`:''});
  }
  function busContent(trip,color,title,context) {
    const bus=trip.bus||{},returnService=bus.return_service;
    const stats=[cards.distance(cards.km(trip.coords))];
    if(!returnService&&Number.isFinite(bus.scheduled_duration_s))stats.push([clock(bus.scheduled_duration_s),'Hours']);
    const services=returnService?[bus,returnService].map((service,index)=>({
      title:`To ${index?service.destination:trip.stops[trip.stops.length-1]}`,
      subtitle:(index?service.operator:trip.operator)||'',
      duration:Number.isFinite(service.scheduled_duration_s)?formatDuration(service.scheduled_duration_s).replace(/ 0m$/,''):''
    })):[];
    return cards.html({modeKey:'Bus',modeName:'Bus',color,title:returnService?title.replace('→','↔'):title,
      subtitle:[...context,...(!returnService&&trip.operator?[trip.operator]:[])].filter(Boolean).join(' · '),
      services,stats,photos:cards.photosNear(allPhotos,trip.coords,3)});
  }
  const airline=number=>{const name=AIRLINES[number.slice(0,2)];return name?`${name} ${number}`:number;};
  const clock=seconds=>{const minutes=Math.round(seconds/60);return `${Math.floor(minutes/60)}:${String(minutes%60).padStart(2,'0')}`;};
  function flightContent(connection) {
    const records=connection.flights.map(index=>flightLog.flights[index]),first=records[0];
    const from=flightLog.airports[first.from],to=flightLog.airports[first.to],both=records.some(flight=>flight.from===first.to);
    const timed=records.filter(flight=>flight.duration_s);
    const stats=[cards.distance(cards.haversine(from.coords,to.coords))];
    if(timed.length)stats.push([clock(timed.reduce((sum,flight)=>sum+flight.duration_s,0)/timed.length),'In the air']);
    stats.push([`${records.length}×`,'Flown']);
    return cards.html({modeKey:'Flight',modeName:'Flight',color:ROUTE_MODES.Flight.color,title:`${first.from} ${both?'↔':'→'} ${first.to}`,
      subtitle:`${from.city} ${both?'↔':'→'} ${to.city}`,stats,
      rows:records.map(flight=>({cells:[airline(flight.number),`${flight.from} → ${flight.to}`,flight.duration_s?formatDuration(flight.duration_s):'']}))});
  }
  function airportContent(code) {
    const airport=flightLog.airports[code],routes=flightLog.routes.map((route,index)=>({route,index})).filter(({route})=>route.airports.includes(code));
    const flights=routes.reduce((sum,{route})=>sum+route.flights.length,0);
    routes.sort((a,b)=>b.route.flights.length-a.route.flights.length);
    return cards.html({modeKey:'Flight',modeName:'Airport',color:ROUTE_MODES.Flight.color,title:`${code} · ${airport.city}`,subtitle:airport.name,
      stats:[[flights,flights===1?'Flight':'Flights'],[routes.length,routes.length===1?'Destination':'Destinations']],
      rowsLabel:'View a connection',
      rows:routes.map(({route,index})=>{const other=route.airports.find(item=>item!==code)||code;
        return {cells:[other,flightLog.airports[other]?.city||'',`${route.flights.length}×`],attrs:`type="button" data-connection="${index}" aria-label="${escapeHtml(`View connection: ${code} ↔ ${other} · ${flightLog.airports[other]?.city||other}`)}"`};})});
  }
  function openConnection(index) {
    const line=flightLines[index],segment=flightLog.routes[index]?.segments[0];if(!line||!segment)return;
    map.closePopup();map.once('moveend',()=>line.openPopup(L.latLng(segment[Math.floor(segment.length/2)])));
    fitView(L.latLngBounds(flightLog.routes[index].segments.flat()),6);
  }
  function renderFlights() {
    flightLayers.clearLayers();airportLayers.clearLayers();routeEntries.flights.length=0;airportMarkers.length=0;
    flightLog.routes.forEach(connection=>{
      const label=connection.airports.join(' ↔ ');
      // Flight geometry follows sorted airport codes, not necessarily the flown direction.
      // Use the first recorded flight to keep shared return connections flowing one way.
      const flight=flightLog.flights[connection.flights[0]];
      const direction=flight.from===connection.airports[0]?'':' route-flow-reverse';
      const quiet={color:ROUTE_MODES.Flight.color,weight:1.5,opacity:.43};
      const line=L.polyline(connection.segments,{pane:'flights',...quiet,className:`flight-route route-flow${direction}`})
        .bindTooltip(escapeHtml(label)).bindPopup(()=>flightContent(connection),cardOptions).addTo(flightLayers);
      flightLines.push(line);
      routeHover.set(`flight:${connection.airports.join('-')}`,()=>[line.getElement()]);
      routeEntries.flights.push({mode:'Flight',bounds:connection.segments.map(segment=>L.latLngBounds(segment)),layers:[line]});
      const highlight=()=>{line.setStyle({weight:2.2,opacity:.8});line.getElement().classList.add('flight-emphasis');};
      const reset=()=>{line.setStyle(quiet);line.getElement().classList.remove('flight-emphasis');};
      line.on('mouseover popupopen',highlight).on('mouseout',()=>{if(!line.isPopupOpen())reset();}).on('popupclose',reset);
      const node=line.getElement();node.setAttribute('role','button');node.setAttribute('tabindex','0');node.setAttribute('aria-label',label);
      node.addEventListener('focus',highlight);node.addEventListener('blur',()=>{if(!line.isPopupOpen())reset();});
      node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();const segment=connection.segments[0];line.openPopup(L.latLng(segment[Math.floor(segment.length/2)]));}});
    });
    Object.entries(flightLog.airports).forEach(([code,airport])=>{
      const label=`${airport.city} · ${code}`;
      const marker=L.marker(airport.coords,{pane:'airports',icon:cards.airportBadge(code,ROUTE_MODES.Flight.color),riseOnHover:true})
        .bindPopup(()=>airportContent(code),cardOptions).addTo(airportLayers);
      const node=marker.getElement();node.setAttribute('role','button');node.setAttribute('aria-label',`${label} · View flights`);
      node.addEventListener('focus',()=>marker.setZIndexOffset(1000));node.addEventListener('blur',()=>marker.setZIndexOffset(0));
      node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();marker.openPopup();}});
      airportMarkers.push({marker,flights:flightLog.flights.filter(flight=>flight.from===code||flight.to===code).length});
    });
    airportMarkers.sort((a,b)=>b.flights-a.flights);
  }
  function updateRouteLegend() {
    const bounds=map.getBounds();
    const types=new Set(Object.values(routeEntries).flat().filter(entry=>entry.bounds.some(routeBounds=>routeBounds.intersects(bounds))).map(entry=>entry.mode));
    const modes=[...types].filter(type=>ROUTE_MODES[type]&&(map.getZoom()>=3.5||type==='Flight'));
    const visits=map.getZoom()<5?`<span><i style="background:${visitColors.visited}"></i>Visited</span><span><i style="background:${visitColors.home}"></i>Home</span>`:'';
    const content=visits+modes.map(type=>`<span><i style="background:${ROUTE_MODES[type].color}"></i>${ROUTE_MODES[type].name}</span>`).join('');
    if($('#route-legend').innerHTML!==content)$('#route-legend').innerHTML=content;
    $('#route-legend').hidden=!visits&&!modes.length;
    routeHint.style.bottom=`${$('#route-legend').offsetHeight+34}px`;
  }
  function updateRouteAnimations() {
    routeFrame=null;
    const bounds=map.getBounds(),zoom=map.getZoom();
    Object.values(routeEntries).flat().forEach(entry=>{
      const visible=!document.hidden&&(entry.mode==='Flight'||zoom>3)&&entry.bounds.some(routeBounds=>routeBounds.intersects(bounds));
      entry.layers.forEach(layer=>{
        // Leaflet clips paths to its renderer bounds at moveend. An empty
        // clipped path needs no animation even when its broad bounds overlap.
        const active=visible&&layer._parts?.some(part=>part.length>1);
        layer.getElement()?.classList.toggle('route-flow-active',Boolean(active));
      });
    });
    map.getContainer().classList.toggle('map-moving',cameraMoving);
  }
  function queueRouteAnimations() {
    if(routeFrame===null)routeFrame=requestAnimationFrame(updateRouteAnimations);
  }
  function focusCountry(id,animate=true) {
    atlasPhotos.cancel();
    map.closePopup();currentCountry=id;activeDay=null;
    worldLayer.eachLayer(layer=>layer.closeTooltip());
    stateLayer.eachLayer(layer=>layer.closeTooltip());
    if(id!==HOME_COUNTRY)currentState=null;
    stateLayer.setStyle(styleState);
    updateRouteStyles();$('#map-status').textContent='';
    fitView(countryBounds(id),12,animate);
  }
  function showWorld(animate=true) {
    atlasPhotos.cancel();
    smoothZoom.finish();map.closePopup();currentCountry=null;currentState=null;stateLayer.setStyle(styleState);activeDay=null;updateRouteStyles();
    $('#map-status').textContent='';document.title='Travel — Ganesh';
    worldLayer.setStyle(styleCountry);
    if(animate){stopCamera();if(reduceMotion)map.fitBounds(worldBounds,{padding:[15,15],animate:false});else map.flyToBounds(worldBounds,{padding:[15,15],duration:1.25});}
    updateBasemap();
  }
  function route(animate=true) {
    const params=new URLSearchParams(location.hash.slice(1));
    const raw=params.get('country');currentState=raw===HOME_COUNTRY&&US_VISITS[params.get('state')]?params.get('state'):null;
    const id=canonical(raw);
    if(id&&allowed(id))focusCountry(id,animate);
    else {if(raw)history.replaceState(null,'',location.pathname+location.search);showWorld(animate);}
  }
  function styleState(feature) {
    const id=String(feature.id).padStart(2,'0'),visited=Boolean(US_VISITS[id]),selected=currentState===id;
    return {color:selected?'#858e95':visited?'#b6bdc2':'#d9dde0',weight:selected?1.5:.7,fillOpacity:0};
  }
  function renderStates(states) {
    const features=topojson.feature(states,states.objects.states).features.filter(feature=>!['11','60','66','69','72','78'].includes(String(feature.id).padStart(2,'0')));
    backgroundLabels.geography(features,'state');
    stateLayer=L.geoJSON(features,{
      pane:'states',interactive:false,style:styleState,
      onEachFeature(feature,layer) {
        // States are scenery like countries: labels name them and the viewer zooms by hand.
        const id=String(feature.id).padStart(2,'0');
        stateLayers.set(id,layer);layer.options.interactive=false;
      }
    }).addTo(map);
  }
  function accessibleRoute(layer,day,journey,segment) {
    const node=layer.getElement();if(!node)return;
    node.setAttribute('role','button');node.setAttribute('tabindex','0');node.setAttribute('aria-label',activityTitle(day,journey));
    node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openActivity(day,journey,segment[Math.floor(segment.length/2)]);}});
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
      style:feature=>({stroke:false,fillColor:feature.id===HOME_COUNTRY?visitColors.home:visitColors.visited,fillOpacity:.38})
    }).addTo(map);
    worldLayer=L.geoJSON(features,{
      pane:'countries',style:styleCountry,
      onEachFeature(feature,layer){
        // Countries are scenery: labels name them and the viewer zooms by hand.
        const id=String(feature.id);
        countryLayers.set(id,layer);layer.options.interactive=false;
        layer.options.className=`country-shape ${isVisitedShape(id)?'visited-country':''}`;
      }
    }).addTo(map);
    tinyLayer=L.layerGroup();
    [{id:'156',coords:[22.32,114.17]},{id:'336',coords:[41.9029,12.4534]}].forEach(item=>{
      L.marker(item.coords,{icon:L.divIcon({className:'tiny-country',html:`<i style="background:${visitColors.visited}"></i>`,iconSize:[10,10],iconAnchor:[5,5]}),interactive:false,keyboard:false}).addTo(tinyLayer);
    });
    tinyLayer.addTo(map);flightLayers.addTo(map);airportLayers.addTo(map);transportLayers.addTo(map);routeLayers.addTo(map);cityLayers.addTo(map);

  }
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&itineraries.isOpen()&&!settings.open&&!atlasPhotos.isOpen()&&!popupOpen()){event.stopImmediatePropagation();itineraries.close();}});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!settings.open&&!itineraries.isOpen()&&!atlasPhotos.isOpen()&&currentCountry&&!popupOpen())location.hash=currentState?`country=${HOME_COUNTRY}`:'';});
  map.on('popupclose',event=>{if(event.popup===activityPopup){activeDay=null;updateRouteStyles();}});
  map.on('popupopen',event=>{
    if(!event.popup.getElement()?.querySelector('.route-card'))return;
    routeHint.hidden=true;try{localStorage.setItem('route-hint-seen','1');}catch{}
  });
  map.getContainer().addEventListener('click',event=>{
    const print=event.target.closest('.route-card [data-photo]');
    if(print){atlasPhotos.show([print.dataset.photo]);return;}
    const connection=event.target.closest('.route-card [data-connection]');
    if(connection){openConnection(Number(connection.dataset.connection));return;}
    const itinerary=event.target.closest('.route-card [data-itinerary]');
    if(itinerary){itineraries.open(itinerary.dataset.itinerary,Number(itinerary.dataset.tripStep));return;}
    const step=event.target.closest('.route-card [data-step]'),card=step?.closest('.route-card');
    if(step&&card)stepActivity(Number(card.dataset.journey),Number(card.dataset.day)+Number(step.dataset.step));
  });
  // Badges and the hint appear once routes are legible.
  function updateBadges() {
    const show=map.getZoom()>=REGIONAL_ZOOM,weight=hitWeight();
    if(show!==map.hasLayer(badgeLayers)){if(show)badgeLayers.addTo(map);else map.removeLayer(badgeLayers);}
    if(hitLines[0]&&hitLines[0].options.weight!==weight)hitLines.forEach(line=>line.setStyle({weight}));
    routeHint.hidden=hintSeen()||!show||popupOpen();
  }
  map.on('zoomend moveend',updateBadges);
  map.on('zoom',updateBasemap);
  map.on('movestart',()=>{cameraMoving=true;if(routeFrame!==null)cancelAnimationFrame(routeFrame);routeFrame=null;map.getContainer().classList.add('map-moving');});
  map.on('move',queueLabelLayout);
  map.on('moveend',()=>{cameraMoving=false;clearTimeout(labelTimer);labelTimer=null;queueRouteAnimations();requestAnimationFrame(()=>{if(worldLayer)updateRouteLegend();declutterLabels();});});
  const visibilityChanged=()=>{
    if(document.hidden){if(routeFrame!==null)cancelAnimationFrame(routeFrame);updateRouteAnimations();}
    else queueRouteAnimations();
  };
  document.addEventListener('visibilitychange',visibilityChanged);
  map.on('unload',()=>{clearTimeout(labelTimer);if(routeFrame!==null)cancelAnimationFrame(routeFrame);document.removeEventListener('visibilitychange',visibilityChanged);});
  updateBasemap();
  map.on('resize',()=>{cityMarkers.forEach(entry=>{delete entry.labelSize;});if(worldLayer){updateBasemap();declutterLabels();}});
  window.addEventListener('hashchange',()=>{if(worldLayer)route();});
  // Optional files fall back to their empty value; any other failure stops the map.
  const loadJSON=(file,fallback)=>{
    const request=fetch(travelAsset(`data/${file}`)).then(response=>{if(!response.ok)throw Error(`${file} unavailable`);return response.json();});
    return fallback?request.catch(error=>{console.warn(error);return fallback;}):request;
  };
  Promise.all([
    loadJSON('context.json'),loadJSON('us-states.json'),loadJSON('world.json'),
    loadJSON('activities.json'),loadJSON('transport.json'),loadJSON('flights.json'),
    loadJSON('photos.json',{photos:[],unavailable:true}),loadJSON('itineraries.json',{trips:[]})
  ]).then(async ([context,states,world,activities,connections,flights,photos,tripDefinitions])=>{
    await map.ready;
    journeys=activities.journeys||[];transport=connections.routes||[];flightLog=flights;
    map.configureFlights?.(flightLog);
    itineraries.load(tripDefinitions,journeys,transport,flightLog);
    backgroundLabels.cities(context.cities||[]);
    renderStates(states);renderWorld(world);renderFlights();renderTransport();renderRoutes();renderCities();$('#map-status').textContent='';route(false);window.ATLAS_READY=true;
    atlasPhotos.load(photos.photos||[]);allPhotos=(Array.isArray(photos.photos)?photos.photos:[]).filter(photo=>Array.isArray(photo?.coords)&&photo.variants?.thumbnail?.src);itineraries.refresh();updateBadges();
    if(photos.unavailable)$('#map-status').textContent='Photos unavailable. Refresh to retry.';
    const viewParams=new URLSearchParams(location.search),photoLat=Number(viewParams.get('lat')),photoLng=Number(viewParams.get('lng')),photoZoom=Number(viewParams.get('zoom'))||13;
    if(viewParams.has('lat')&&viewParams.has('lng')&&Number.isFinite(photoLat)&&Number.isFinite(photoLng)&&photoLat>=-90&&photoLat<=90&&photoLng>=-180&&photoLng<=180)map.setView([photoLat,photoLng],Math.max(1,Math.min(17,photoZoom)),{animate:false});
    queueRouteAnimations();window.ATLAS_MAP=map;
  }).catch(error=>{$('#map-status').textContent='Map unavailable. Refresh to retry.';console.error(error);});
})();
