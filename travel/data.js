// User-confirmed places. Hong Kong SAR is scoped to its own geometry; the US is home.
const VISITED_COUNTRIES = {
  '124':{name:'Canada'}, '152':{name:'Chile'}, '156':{name:'Hong Kong SAR',geometry:'344'},
  '203':{name:'Czechia'}, '818':{name:'Egypt'}, '250':{name:'France'},
  '300':{name:'Greece'}, '352':{name:'Iceland'}, '356':{name:'India'},
  '380':{name:'Italy'}, '392':{name:'Japan'}, '400':{name:'Jordan'},
  '484':{name:'Mexico'}, '504':{name:'Morocco'}, '528':{name:'Netherlands'},
  '578':{name:'Norway'}, '724':{name:'Spain'}, '756':{name:'Switzerland'},
  '788':{name:'Tunisia'}, '792':{name:'Turkey'}, '826':{name:'United Kingdom'},
  '336':{name:'Vatican City'}, '040':{name:'Austria'}
};
const HOME_COUNTRY = '840';

// City-level locations from travel records and user confirmation. No addresses or booking identifiers.
const COUNTRY_PLACES = {
  "124": [
    {
      "name": "Montréal",
      "coords": [
        45.5019,
        -73.5674
      ]
    }
  ],
  "152": [
    {
      "name": "Puerto Natales",
      "coords": [
        -51.7309,
        -72.4977
      ]
    },
    {
      "name": "Torres del Paine",
      "coords": [
        -50.9423,
        -73.4068
      ]
    }
  ],
  "156": [
    {
      "name": "Hong Kong",
      "coords": [
        22.3193,
        114.1694
      ]
    }
  ],
  "203": [
    {
      "name": "Prague",
      "coords": [
        50.0755,
        14.4378
      ]
    }
  ],
  "818": [
    {
      "name": "Cairo",
      "coords": [
        30.0444,
        31.2357
      ]
    },
    {
      "name": "Luxor",
      "coords": [
        25.6872,
        32.6396
      ]
    }
  ],
  "250": [
    {
      "name": "Paris",
      "coords": [
        48.8566,
        2.3522
      ]
    },
    {
      "name": "Chamonix",
      "coords": [
        45.9237,
        6.8694
      ]
    },
    {
      "name": "Les Houches",
      "coords": [
        45.8902,
        6.798
      ]
    },
    {
      "name": "Les Contamines-Montjoie",
      "coords": [
        45.821,
        6.7273
      ]
    },
    {
      "name": "Bourg-Saint-Maurice",
      "coords": [
        45.6188,
        6.7694
      ]
    }
  ],
  "300": [
    {
      "name": "Athens",
      "coords": [
        37.9838,
        23.7275
      ]
    },
    {
      "name": "Naxos",
      "coords": [
        37.1036,
        25.3761
      ]
    },
    {
      "name": "Meteora",
      "coords": [
        39.7217,
        21.6306
      ]
    }
  ],
  "352": [
    {
      "name": "Hvolsvöllur",
      "coords": [
        63.75,
        -20.2245
      ]
    },
    {
      "name": "Heimaey",
      "coords": [
        63.4427,
        -20.2734
      ]
    }
  ],
  "356": [
    {
      "name": "Delhi",
      "coords": [
        28.6139,
        77.209
      ]
    },
    {
      "name": "Jodhpur",
      "coords": [
        26.2389,
        73.0243
      ]
    },
    {
      "name": "Jaipur",
      "coords": [
        26.9124,
        75.7873
      ]
    },
    {
      "name": "Agra",
      "coords": [
        27.1767,
        78.0081
      ]
    }
  ],
  "380": [
    {
      "name": "Tirano",
      "coords": [
        46.2167,
        10.1667
      ]
    },
    {
      "name": "Milan",
      "coords": [
        45.4642,
        9.19
      ]
    },
    {
      "name": "Florence",
      "coords": [
        43.7696,
        11.2558
      ]
    },
    {
      "name": "Rome",
      "coords": [
        41.9028,
        12.4964
      ]
    },
    {
      "name": "La Spezia",
      "coords": [
        44.1025,
        9.8241
      ]
    },
    {
      "name": "Naples",
      "coords": [
        40.8518,
        14.2681
      ]
    },
    {
      "name": "Salerno",
      "coords": [
        40.6824,
        14.7681
      ]
    },
    {
      "name": "Courmayeur",
      "coords": [
        45.7969,
        6.9686
      ]
    }
  ],
  "392": [
    {
      "name": "Tokyo",
      "coords": [
        35.6762,
        139.6503
      ]
    }
  ],
  "400": [
    {
      "name": "Aqaba",
      "coords": [
        29.5321,
        35.0063
      ]
    },
    {
      "name": "Wadi Rum",
      "coords": [
        29.5734,
        35.421
      ]
    },
    {
      "name": "Wadi Musa",
      "coords": [
        30.3216,
        35.4801
      ]
    },
    {
      "name": "Petra",
      "coords": [
        30.3285,
        35.4444
      ]
    },
    {
      "name": "Amman",
      "coords": [
        31.9539,
        35.9106
      ]
    }
  ],
  "484": [
    {
      "name": "Mexico City",
      "coords": [
        19.4326,
        -99.1332
      ]
    },
    {
      "name": "Oaxaca",
      "coords": [
        17.0732,
        -96.7266
      ]
    }
  ],
  "504": [
    {
      "name": "Marrakech",
      "coords": [
        31.6295,
        -7.9811
      ]
    },
    {
      "name": "Fez",
      "coords": [
        34.0181,
        -5.0078
      ]
    }
  ],
  "528": [
    {
      "name": "Amsterdam",
      "coords": [
        52.3676,
        4.9041
      ]
    },
    {
      "name": "Haarlem",
      "coords": [
        52.3874,
        4.6462
      ]
    },
    {
      "name": "Keukenhof",
      "coords": [
        52.2712,
        4.5463
      ]
    },
    {
      "name": "Zaanse Schans",
      "coords": [
        52.4739,
        4.8162
      ]
    },
    {
      "name": "Utrecht",
      "coords": [
        52.0907,
        5.1214
      ]
    }
  ],
  "578": [
    {
      "name": "Oslo",
      "coords": [
        59.9139,
        10.7522
      ]
    },
    {
      "name": "Bergen",
      "coords": [
        60.3913,
        5.3221
      ]
    },
    {
      "name": "Flåm",
      "coords": [
        60.8608,
        7.1144
      ]
    }
  ],
  "724": [
    {
      "name": "Barcelona",
      "coords": [
        41.3874,
        2.1686
      ]
    }
  ],
  "756": [
    {
      "name": "Geneva",
      "coords": [
        46.2044,
        6.1432
      ]
    },
    {
      "name": "Orsières",
      "coords": [
        46.0293,
        7.145
      ]
    },
    {
      "name": "Champex-Lac",
      "coords": [
        46.0312,
        7.1186
      ]
    },
    {
      "name": "Trient",
      "coords": [
        46.0569,
        7.0019
      ]
    },
    {
      "name": "Finhaut",
      "coords": [
        46.0832,
        6.9769
      ]
    },
    {
      "name": "Ferret",
      "coords": [
        45.9339,
        7.0974
      ]
    }
  ],
  "788": [
    {
      "name": "Tunis",
      "coords": [
        36.8065,
        10.1815
      ]
    },
    {
      "name": "Matmata",
      "coords": [
        33.5445,
        9.9716
      ]
    },
    {
      "name": "Ksar Ghilane",
      "coords": [
        32.9855,
        9.6371
      ]
    }
  ],
  "792": [
    {
      "name": "Istanbul",
      "coords": [
        41.0082,
        28.9784
      ]
    }
  ],
  "826": [
    {
      "name": "London",
      "coords": [
        51.5074,
        -0.1278
      ]
    }
  ],
  "336": [
    {
      "name": "Vatican City",
      "coords": [
        41.9029,
        12.4534
      ]
    }
  ],
  "040": [
    {
      "name": "Vienna",
      "coords": [
        48.2082,
        16.3738
      ]
    }
  ]
};

// State visits supplied by Ganesh. Coordinates are place centers, not a route.
const US_VISITS = {
  '06': {name:'California', cities:[['Berkeley',37.8715,-122.273],['San Francisco',37.7749,-122.4194],['San Jose',37.3382,-121.8863],['Los Angeles',34.0522,-118.2437],['Irvine',33.6846,-117.8265],['San Diego',32.7157,-117.1611],['Mount Shasta',41.3099,-122.3106]], parks:[['Kings Canyon',36.8879,-118.5551],['Yosemite',37.7459,-119.5332],['Lassen Volcanic',40.4977,-121.4207],['Redwood',41.2132,-124.0046],['Sequoia',36.4864,-118.5658]]},
  '11': {name:'District of Columbia', cities:[['Washington, DC',38.9072,-77.0369]], parks:[]},
  '08': {name:'Colorado', cities:[['Denver',39.7392,-104.9903],['Estes Park',40.3772,-105.5217],['Copper Mountain',39.5022,-106.1518],['Steamboat Springs',40.485,-106.8317]], parks:[['Rocky Mountain',40.3428,-105.6836]]},
  '09': {name:'Connecticut', cities:[['New Haven',41.3083,-72.9279]], parks:[]},
  '12': {name:'Florida', cities:[['Orlando',28.5383,-81.3792],['Kissimmee',28.2919,-81.4076],['Miami',25.7617,-80.1918]], parks:[]},
  '13': {name:'Georgia', cities:[['Atlanta',33.749,-84.388]], parks:[]},
  '17': {name:'Illinois', cities:[['Chicago',41.8781,-87.6298]], parks:[]},
  '22': {name:'Louisiana', cities:[['New Orleans',29.9511,-90.0715]], parks:[]},
  '23': {name:'Maine', cities:[['Bangor',44.8016,-68.7712]], parks:[['Acadia',44.3386,-68.2733]]},
  '25': {name:'Massachusetts', cities:[['Boston',42.3601,-71.0589]], parks:[]},
  '29': {name:'Missouri', cities:[['St. Louis',38.627,-90.1994]], parks:[]},
  '32': {name:'Nevada', cities:[['Las Vegas',36.1699,-115.1398]], parks:[]},
  '34': {name:'New Jersey', cities:[['Jersey City',40.7178,-74.0431],['Princeton',40.3573,-74.6672]], parks:[]},
  '36': {name:'New York', cities:[['NYC',40.7128,-74.006],['Mount Marcy',44.1126,-73.9235]], parks:[]},
  '37': {name:'North Carolina', cities:[['Asheville',35.5951,-82.5515]], parks:[]},
  '41': {name:'Oregon', cities:[['Portland',45.5152,-122.6784],['Bend',44.0582,-121.3153],['Mount Hood',45.3735,-121.6959],['Cannon Beach',45.8918,-123.9615]], parks:[['Crater Lake',42.9446,-122.109]]},
  '42': {name:'Pennsylvania', cities:[['Philadelphia',39.9526,-75.1652],['Pittsburgh',40.4406,-79.9959]], parks:[]},
  '44': {name:'Rhode Island', cities:[['Providence',41.824,-71.4128]], parks:[]},
  '47': {name:'Tennessee', cities:[['Nashville',36.1627,-86.7816]], parks:[]},
  '48': {name:'Texas', cities:[['Austin',30.2672,-97.7431]], parks:[]},
  '49': {name:'Utah', cities:[['Salt Lake City',40.7608,-111.891]], areas:['ski areas'], parks:[['Zion',37.2982,-113.0263]]},
  '50': {name:'Vermont', cities:[['Killington',43.6045,-72.8201]], parks:[]},
  '53': {name:'Washington', cities:[['Seattle',47.6062,-122.3321]], parks:[['Mount Rainier',46.8523,-121.7603],['Olympic',47.8021,-123.6044]]}
};

// Route colors are shared by recorded GPS tracks and confirmed transport legs.
const ROUTE_MODES={hiking:{name:'Hike',color:'#859650'},walking:{name:'Walk',color:'#527b58'},running:{name:'Run',color:'#bd5574'},cycling:{name:'Bike',color:'#287f96'},Train:{name:'Train',color:'#8368a6'},Drive:{name:'Drive',color:'#b28c2c'},Ferry:{name:'Ferry',color:'#3269ac'},Flight:{name:'Flight',color:'#1b62a0'}};

const CONFIRMED_ROUTE_PLACES={
 '300':[{name:'Piraeus',coords:[37.942569,23.642746]},{name:'Syros',coords:[37.440886,24.941164]}],
 '756':[{name:'Bern',coords:[46.948,7.4474]},{name:'Lucerne',coords:[47.0502,8.3093]},{name:'Chur',coords:[46.8508,9.532]}],
 '578':[{name:'Myrdal',coords:[60.7351,7.1226]}],
 '352':[{name:'Reykjavík',coords:[64.1466,-21.9426]},{name:'Múlagljúfur Canyon',coords:[63.9935,-16.394]},{name:'Landeyjahöfn',coords:[63.530904,-20.116991]}],
 '380':[{name:'Bologna',coords:[44.4949,11.3426]},{name:'Minori',coords:[40.6483,14.6262]},{name:'Positano',coords:[40.628,14.4863]}],
 '152':[{name:'Paine Grande',coords:[-51.072421,-73.093889]},{name:'Pudeto',coords:[-51.062769,-72.990295]}]
};
Object.entries(CONFIRMED_ROUTE_PLACES).forEach(([country,places])=>{
 COUNTRY_PLACES[country]||=[];
 places.forEach(place=>{if(!COUNTRY_PLACES[country].some(existing=>existing.name===place.name))COUNTRY_PLACES[country].push(place);});
});
