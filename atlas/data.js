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
      "name": "Giza",
      "coords": [
        29.9792,
        31.1342
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
    },
    {
      "name": "Cambridge",
      "coords": [
        52.2053,
        0.1218
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
