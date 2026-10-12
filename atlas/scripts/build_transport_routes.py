"""Build saved train/bus paths from OSM networks and confirmed journey stops.
Rails use BRouter’s rail profile; roads use OSRM full geometry.
No live routing service is required by the published atlas.
"""
import argparse, json, math, pathlib, urllib.parse, urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[1]
STOPS={
 'Amsterdam':('528',[52.3791,4.9003]),'Haarlem':('528',[52.3879,4.6384]),'Utrecht':('528',[52.0894,5.1102]),'Keukenhof':('528',[52.2712,4.5463]),
 'Bern':('756',[46.948993,7.4390602]),'Lucerne':('756',[47.0502,8.3102]),'Chur':('756',[46.853,9.529]),'Tirano':('380',[46.2164,10.1678]),'Milan':('380',[45.4863,9.2045]),'Bologna':('380',[44.5061,11.3426]),'Florence':('380',[43.7765,11.2486]),'Rome':('380',[41.901,12.5016]),
 'Oslo':('578',[59.9109,10.7526]),'Bergen':('578',[60.3904,5.3335]),'Cairo':('818',[30.0444,31.2357]),'Luxor':('818',[25.6872,32.6396])}
LEGS=[
 ('Amsterdam','Bern','train','europe',[[50.943,6.958],[50.107,8.663],[47.5464543,7.5884019]]),
 ('Bern','Lucerne','train','europe',[]),('Lucerne','Chur','train','europe',[[47.173,8.517],[47.202,8.778],[47.046,9.443]]),
 ('Chur','Tirano','train','europe',[[46.6976,9.4405],[46.6768,9.6826],[46.6294,9.7455],[46.491,9.901],[46.4082,10.0199],[46.3241,10.0546]]),
 ('Tirano','Milan','train','europe',[[45.856,9.397]]),('Milan','Bologna','train','europe',[]),('Bologna','Florence','train','europe',[]),('Florence','Rome','train','europe',[]),
 ('Amsterdam','Haarlem','train','netherlands',[]),('Utrecht','Haarlem','train','netherlands',[]),('Haarlem','Keukenhof','bus',None,[]),
 ('Oslo','Bergen','train','norway',[]),
 ('Cairo','Luxor','bus',None,[])]
def meters(a,b):
 lat1,lon1,lat2,lon2=map(math.radians,(*a,*b));dlat=lat2-lat1;dlon=lon2-lon1
 return 6371000*2*math.asin(min(1,math.sqrt(math.sin(dlat/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2)))
def routed(points,mode,cache,slug):
 path=cache/(slug+'.json')
 if not path.exists():
  if mode=='Train':
   lonlats='|'.join(str(p[1])+','+str(p[0]) for p in points)
   url='https://brouter.de/brouter?'+urllib.parse.urlencode({'lonlats':lonlats,'profile':'rail','alternativeidx':'0','format':'geojson'})
  else:
   coords=';'.join(str(p[1])+','+str(p[0]) for p in points)
   url='https://router.project-osrm.org/route/v1/driving/'+coords+'?overview=full&geometries=geojson'
  with urllib.request.urlopen(url,timeout=100) as response:raw=response.read()
  data=json.loads(raw)
  if mode=='Train' and not data.get('features'):raise ValueError('Rail routing returned no path')
  if mode!='Train' and data.get('code')!='Ok':raise ValueError('Road routing returned no path')
  path.write_bytes(raw)
 data=json.loads(path.read_text())
 if mode=='Train':
  feature=data['features'][0];points=feature['geometry']['coordinates']
  tags=[row[9] for row in feature.get('properties',{}).get('messages',[])[1:] if len(row)>9]
  if not tags or any('railway=' not in tag for tag in tags):raise ValueError('Train path leaves railway network')
 else:points=data['routes'][0]['geometry']['coordinates']
 coords=[[lat,lon] for lon,lat,*alt in points]
 return coords
def simplify(points,tolerance=0.000025):
 # Retain every bend on roads/rails; only remove effectively collinear points.
 if len(points)<3:return points
 out=[points[0]]
 for i in range(1,len(points)-1):
  a,b,c=out[-1],points[i],points[i+1];dx=c[1]-a[1];dy=c[0]-a[0];length=math.hypot(dx,dy)
  deviation=abs(dx*(a[0]-b[0])-(a[1]-b[1])*dy)/length if length else math.hypot(b[0]-a[0],b[1]-a[1])
  if deviation>tolerance:out.append(b)
 out.append(points[-1]);return [[round(lat,6),round(lon,6)] for lat,lon in out]
STATION_COORDS={
 'London':[51.5179,-.0820],'Cambridge':[52.1945,.1374],
 'Myrdal':[60.7351,7.1226],'Flåm':[60.8631,7.1138],
 'Marrakech':[31.6308,-8.0174],'Fez':[34.0463,-5.0048],
 'Prague':[50.0831,14.4353],'Vienna':[48.185,16.376],
 'Genoa':[44.4168,8.9202],'La Spezia':[44.111,9.8134],
 'Salerno':[40.675,14.773],'Naples':[40.8523,14.272],
 'Jodhpur':[26.2837,73.0231],'Jaipur':[26.9192,75.7871],'Agra':[27.1823,78.0214]
}
STATION_COORDS.update({name:coords for name,(country,coords) in STOPS.items()})
VIA={
 'london-paris':[[50.9513,1.8587]],
 'prague-vienna':[[49.191,16.612],[48.753,16.895]],
 'laspezia-salerno':[[43.708,10.398],[41.901,12.502]],
}
def main():
 parser=argparse.ArgumentParser();parser.add_argument('cache',type=pathlib.Path);args=parser.parse_args();args.cache.mkdir(exist_ok=True)
 source=json.loads((ROOT/'data/transport.json').read_text())['routes']
 routes=[]
 for trip in source:
  if trip.get('geometry_source'):
   start=STATION_COORDS.get(trip['stops'][0])
   if start and meters(trip['coords'][0],start)>meters(trip['coords'][-1],start):trip['coords'].reverse()
   routes.append(trip);continue
  points=[STATION_COORDS.get(stop,coord) for stop,coord in zip(trip['stops'],trip['coords'])]
  if trip['id'] in VIA:points=[points[0],*VIA[trip['id']],points[-1]]
  coords=routed(points,trip['mode'],args.cache,trip['id'])
  if meters(coords[0],points[0])>meters(coords[-1],points[0]):coords.reverse()
  trip['coords']=simplify(coords);trip.pop('approximate',None)
  trip['geometry_source']='BRouter rail · OpenStreetMap' if trip['mode']=='Train' else 'OSRM driving · OpenStreetMap'
  routes.append(trip);print(trip['name'],trip['mode'],len(coords),'vertices',flush=True)
  # Save each completed request, so the operation can resume without repeating it.
  (ROOT/'data/transport.json').write_text(json.dumps({'routes':routes+source[len(routes):]},separators=(',',':'))+'\n')
 ids={trip['id'] for trip in routes}
 for origin,dest,mode,network,via in LEGS:
  slug=origin.lower().replace(' ','-')+'-'+dest.lower().replace(' ','-')
  if slug in ids:continue
  points=[STOPS[origin][1],*via,STOPS[dest][1]];mode=mode.title()
  if origin=='Tirano':points[0]=[46.21586,10.16743]
  coords=routed(points,mode,args.cache,slug)
  name=origin+' → '+dest
  if origin=='Chur' and dest=='Tirano':name+=' · Bernina Express'
  trip={'id':slug,'name':name,'stops':[origin,dest],'countries':list(dict.fromkeys([STOPS[origin][0],STOPS[dest][0]])),'mode':mode,'operator':'Bernina Express' if origin=='Chur' and dest=='Tirano' else '', 'dates':[], 'coords':simplify(coords),'geometry_source':'BRouter rail · OpenStreetMap' if mode=='Train' else 'OSRM driving · OpenStreetMap'}
  routes.append(trip);print(name,mode,len(coords),'vertices',flush=True)
  (ROOT/'data/transport.json').write_text(json.dumps({'routes':routes},separators=(',',':'))+'\n')
 activities=json.loads((ROOT/'data/activities.json').read_text())
 if any(j['id']=='iceland-activities' for j in activities['journeys']):
  from build_iceland_routes import build_routes
  document=build_routes({'routes':routes},activities,args.cache)
 else:
  points=[[64.1466,-21.9426],[63.9886,-16.399]]
  coords=routed(points,'Drive',args.cache,'reykjavik-mulagljufur')
  routes=[trip for trip in routes if trip['id']!='reykjavik-mulagljufur']
  routes.append({'id':'reykjavik-mulagljufur','name':'Reykjavík → Múlagljúfur Canyon','stops':['Reykjavík','Múlagljúfur Canyon'],'countries':['352'],'mode':'Drive','operator':'','dates':[],'coords':simplify(coords),'geometry_source':'OSRM driving · OpenStreetMap'})
  document={'routes':routes}
 if (ROOT/'data/ferries.json').exists():
  from build_ferry_routes import merge_ferries
  document=merge_ferries(document,json.loads((ROOT/'data/ferries.json').read_text()))
 (ROOT/'data/transport.json').write_text(json.dumps(document,separators=(',',':'),ensure_ascii=False)+'\n')
 print('Saved',len(document['routes']),'routes',flush=True)
if __name__=='__main__':main()
