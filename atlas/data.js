// User-confirmed countries. China represents Hong Kong only; the US is home.
const VISITED_COUNTRIES = {
  '124':{name:'Canada'}, '152':{name:'Chile'}, '156':{name:'China',scope:'Hong Kong',geometry:'344'},
  '203':{name:'Czechia'}, '818':{name:'Egypt'}, '250':{name:'France'},
  '300':{name:'Greece'}, '352':{name:'Iceland'}, '356':{name:'India'},
  '380':{name:'Italy'}, '392':{name:'Japan'}, '400':{name:'Jordan'},
  '484':{name:'Mexico'}, '504':{name:'Morocco'}, '528':{name:'Netherlands'},
  '578':{name:'Norway'}, '724':{name:'Spain'}, '756':{name:'Switzerland'},
  '788':{name:'Tunisia'}, '792':{name:'Turkey'}, '826':{name:'United Kingdom'},
  '336':{name:'Vatican City'}, '040':{name:'Austria'}
};
const HOME_COUNTRY = '840';
const TMB_COUNTRIES = ['250','380','756'];
// A viewing area, not a claimed route or itinerary.
const TMB_BOUNDS = [[45.65,6.6],[46.15,7.2]];

// User-confirmed places, marked independently of the recorded cycling route.
const COUNTRY_PLACES = {
  '528': [
    {name:'Amsterdam',coords:[52.3676,4.9041]},
    {name:'Haarlem',coords:[52.3874,4.6462]},
    {name:'Keukenhof',coords:[52.2712,4.5463]},
    {name:'Zaanse Schans',coords:[52.4739,4.8162]},
    {name:'Utrecht',coords:[52.0907,5.1214]}
  ]
};
