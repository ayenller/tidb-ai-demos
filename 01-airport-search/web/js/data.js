/* =====================================================================
 *  Offline sample dataset — 105 real airports with real coordinates.
 *
 *  Fields marked (*) exist only for the OFFLINE simulation:
 *    tags[]    – semantic hints that stand in for what an embedding model
 *                would already "know" about a place.
 *    aliases[] – other-language / colloquial names, standing in for the
 *                cross-lingual behaviour of a multilingual embedding model.
 *
 *  When you run against a real TiDB cluster, none of this is used: the
 *  embedding of `doc` does all of it, and these fields are ignored.
 * ===================================================================== */
const AIRPORTS = [
// name, city, country, iata, icao, lat, lon, altFt, region, size, tags, aliases
["Hartsfield–Jackson Atlanta International Airport","Atlanta","United States","ATL","KATL",33.6407,-84.4277,1026,"Americas","hub",["busiest airport in the world","southeast us","delta hub","connecting hub"],[]],
["Beijing Capital International Airport","Beijing","China","PEK","ZBAA",40.0799,116.6031,116,"Asia","hub",["chinese capital","north china gateway","air china hub"],["北京首都国际机场","首都机场","北京机场"]],
["Beijing Daxing International Airport","Beijing","China","PKX","ZBAD",39.5098,116.4105,98,"Asia","hub",["new mega airport","starfish terminal","zaha hadid"],["北京大兴国际机场","大兴机场"]],
["Los Angeles International Airport","Los Angeles","United States","LAX","KLAX",33.9416,-118.4085,125,"Americas","hub",["southern california","pacific gateway","hollywood"],["洛杉矶国际机场"]],
["Dubai International Airport","Dubai","United Arab Emirates","DXB","OMDB",25.2532,55.3657,62,"Asia","hub",["desert","gulf megahub","emirates hub","busiest international traffic"],["迪拜国际机场"]],
["Tokyo Haneda Airport","Tokyo","Japan","HND","RJTT",35.5494,139.7798,21,"Asia","hub",["close to city centre","tokyo bay","domestic and international"],["羽田空港","东京羽田机场"]],
["Narita International Airport","Tokyo","Japan","NRT","RJAA",35.7720,140.3929,141,"Asia","hub",["far from tokyo","long haul gateway"],["成田空港","东京成田机场"]],
["London Heathrow Airport","London","United Kingdom","LHR","EGLL",51.4700,-0.4543,83,"Europe","hub",["transatlantic gateway","british airways hub","busiest in europe"],["希思罗机场","伦敦希思罗"]],
["Charles de Gaulle Airport","Paris","France","CDG","LFPG",49.0097,2.5479,392,"Europe","hub",["roissy","air france hub","european megahub"],["戴高乐机场","巴黎戴高乐"]],
["Shanghai Pudong International Airport","Shanghai","China","PVG","ZSPD",31.1443,121.8083,13,"Asia","hub",["east china gateway","maglev","yangtze delta"],["上海浦东国际机场","浦东机场"]],
["Shanghai Hongqiao International Airport","Shanghai","China","SHA","ZSSS",31.1979,121.3363,10,"Asia","large",["city airport","high speed rail interchange"],["上海虹桥国际机场","虹桥机场"]],
["Guangzhou Baiyun International Airport","Guangzhou","China","CAN","ZGGG",23.3924,113.2988,50,"Asia","hub",["pearl river delta","south china"],["广州白云国际机场","白云机场"]],
["Shenzhen Bao'an International Airport","Shenzhen","China","SZX","ZGSZ",22.6393,113.8108,13,"Asia","hub",["chinese tech city","hardware manufacturing","greater bay area"],["深圳宝安国际机场","宝安机场"]],
["Amsterdam Airport Schiphol","Amsterdam","Netherlands","AMS","EHAM",52.3105,4.7683,-11,"Europe","hub",["below sea level","polder","klm hub","dutch"],["史基浦机场"]],
["Frankfurt Airport","Frankfurt","Germany","FRA","EDDF","50.0379","8.5622",364,"Europe","hub",["lufthansa hub","cargo","german financial centre"],["法兰克福机场"]],
["Istanbul Airport","Istanbul","Turkey","IST","LTFM",41.2753,28.7519,325,"Europe","hub",["between europe and asia","bosphorus","turkish airlines hub"],["伊斯坦布尔机场"]],
["Singapore Changi Airport","Singapore","Singapore","SIN","WSSS",1.3644,103.9915,22,"Asia","hub",["best airport in the world","jewel waterfall","equator","southeast asia gateway"],["樟宜机场","新加坡樟宜"]],
["Incheon International Airport","Seoul","South Korea","ICN","RKSI",37.4602,126.4407,23,"Asia","hub",["korean gateway","reclaimed island"],["仁川国际机场","인천국제공항"]],
["Hong Kong International Airport","Hong Kong","Hong Kong","HKG","VHHH",22.3080,113.9185,28,"Asia","hub",["chek lap kok","artificial island","cargo leader"],["香港国际机场","赤鱲角机场"]],
["Chicago O'Hare International Airport","Chicago","United States","ORD","KORD",41.9742,-87.9073,672,"Americas","hub",["midwest","great lakes","weather delays","snow"],["奥黑尔机场"]],
["Dallas/Fort Worth International Airport","Dallas","United States","DFW","KDFW",32.8998,-97.0403,607,"Americas","hub",["texas","huge land area","american airlines hub"],[]],
["Denver International Airport","Denver","United States","DEN","KDEN",39.8561,-104.6737,5431,"Americas","hub",["mile high","rocky mountains","tent roof","conspiracy theories"],[]],
["John F. Kennedy International Airport","New York","United States","JFK","KJFK",40.6413,-73.7781,13,"Americas","hub",["new york gateway","twa terminal","transatlantic"],["肯尼迪国际机场","纽约肯尼迪"]],
["Newark Liberty International Airport","Newark","United States","EWR","KEWR",40.6895,-74.1745,18,"Americas","hub",["new jersey","new york area","united hub"],[]],
["LaGuardia Airport","New York","United States","LGA","KLGA",40.7769,-73.8740,21,"Americas","large",["short runways","queens","domestic only","recently rebuilt"],[]],
["San Francisco International Airport","San Francisco","United States","SFO","KSFO",37.6213,-122.3790,13,"Americas","hub",["bay area","silicon valley","tech","pacific gateway","fog"],["旧金山国际机场"]],
["Norman Y. Mineta San José International Airport","San Jose","United States","SJC","KSJC",37.3639,-121.9289,62,"Americas","large",["silicon valley","south bay","tech companies","startups","apple google nvidia"],["圣何塞机场"]],
["Oakland International Airport","Oakland","United States","OAK","KOAK",37.7213,-122.2207,9,"Americas","large",["bay area","east bay","low cost carriers"],[]],
["Seattle–Tacoma International Airport","Seattle","United States","SEA","KSEA",47.4502,-122.3088,433,"Americas","hub",["pacific northwest","rain","boeing","amazon microsoft"],[]],
["Miami International Airport","Miami","United States","MIA","KMIA","25.7959","-80.2870",8,"Americas","hub",["latin america gateway","caribbean","hurricanes","cargo"],[]],
["Boston Logan International Airport","Boston","United States","BOS","KBOS",42.3656,-71.0096,20,"Americas","large",["new england","harbour runways","universities"],[]],
["Washington Dulles International Airport","Washington","United States","IAD","KIAD",38.9531,-77.4565,313,"Americas","large",["capital region","saarinen terminal","mobile lounges"],[]],
["Harry Reid International Airport","Las Vegas","United States","LAS","KLAS",36.0840,-115.1537,2181,"Americas","hub",["desert","casinos","mojave","slot machines in terminal"],[]],
["Phoenix Sky Harbor International Airport","Phoenix","United States","PHX","KPHX",33.4342,-112.0116,1135,"Americas","hub",["desert","extreme heat","arizona","sonoran"],[]],
["Daniel K. Inouye International Airport","Honolulu","United States","HNL","PHNL",21.3187,-157.9224,13,"Oceania","large",["island","pacific","hawaii","tropical","open air terminal"],[]],
["Ted Stevens Anchorage International Airport","Anchorage","United States","ANC","PANC",61.1743,-149.9962,152,"Americas","large",["arctic","subarctic","cargo crossroads","northern lights","cold"],[]],
["Toronto Pearson International Airport","Toronto","Canada","YYZ","CYYZ",43.6777,-79.6248,569,"Americas","hub",["canadian gateway","air canada hub","snow and de-icing"],[]],
["Vancouver International Airport","Vancouver","Canada","YVR","CYVR",49.1967,-123.1815,14,"Americas","large",["pacific canada","rain","first nations art","asia pacific gateway"],[]],
["Mexico City International Airport","Mexico City","Mexico","MEX","MMMX",19.4361,-99.0719,7316,"Americas","hub",["high altitude","valley of mexico","thin air","surrounded by city"],[]],
["São Paulo/Guarulhos International Airport","São Paulo","Brazil","GRU","SBGR",-23.4356,-46.4731,2461,"Americas","hub",["largest in south america","brazilian gateway"],[]],
["Rio de Janeiro/Galeão International Airport","Rio de Janeiro","Brazil","GIG","SBGL",-22.8100,-43.2506,28,"Americas","large",["beach city","sugarloaf","carnival"],[]],
["El Dorado International Airport","Bogotá","Colombia","BOG","SKBO",4.7016,-74.1469,8361,"Americas","hub",["andes","high altitude","thin air","colombian gateway","cargo"],[]],
["Jorge Chávez International Airport","Lima","Peru","LIM","SPJC",-12.0219,-77.1143,113,"Americas","hub",["pacific coast","gateway to machu picchu","andes region","desert coast"],[]],
["El Alto International Airport","La Paz","Bolivia","LPB","SLLP",-16.5133,-68.1923,13355,"Americas","regional",["highest international airport in the world","andes","altiplano","thin air","extreme altitude","oxygen"],[]],
["Mariscal Sucre International Airport","Quito","Ecuador","UIO","SEQM",-0.1292,-78.3575,7841,"Americas","large",["andes","high altitude","equator","volcano"],[]],
["Ministro Pistarini International Airport","Buenos Aires","Argentina","EZE","SAEZ",-34.8222,-58.5358,67,"Americas","large",["ezeiza","pampas","southern cone"],[]],
["Comodoro Arturo Merino Benítez International Airport","Santiago","Chile","SCL","SCEL",-33.3930,-70.7858,1555,"Americas","large",["andes backdrop","chilean gateway","mountains on approach"],[]],
["Ushuaia – Malvinas Argentinas International Airport","Ushuaia","Argentina","USH","SAWH",-54.8433,-68.2958,102,"Americas","regional",["southernmost airport","end of the world","patagonia","antarctic gateway","cold windy"],[]],
["Adolfo Suárez Madrid–Barajas Airport","Madrid","Spain","MAD","LEMD",40.4936,-3.5668,1998,"Europe","hub",["iberian gateway","latin america connections","bamboo terminal"],[]],
["Josep Tarradellas Barcelona–El Prat Airport","Barcelona","Spain","BCN","LEBL",41.2971,2.0785,12,"Europe","large",["mediterranean","tourism","catalonia"],[]],
["Leonardo da Vinci–Fiumicino Airport","Rome","Italy","FCO","LIRF",41.8003,12.2389,13,"Europe","hub",["ancient city","mediterranean","pilgrimage"],[]],
["Munich Airport","Munich","Germany","MUC","EDDM",48.3538,11.7861,1487,"Europe","hub",["bavaria","alps nearby","oktoberfest","beer garden in terminal"],[]],
["Zurich Airport","Zurich","Switzerland","ZRH","LSZH",47.4647,8.5492,1416,"Europe","large",["alps","swiss precision","banking"],[]],
["Vienna International Airport","Vienna","Austria","VIE","LOWW",48.1103,16.5697,600,"Europe","large",["central europe","danube","eastern europe connections"],[]],
["Copenhagen Airport","Copenhagen","Denmark","CPH","EKCH",55.6180,12.6560,17,"Europe","large",["nordic hub","oresund bridge","scandinavian design"],[]],
["Oslo Airport, Gardermoen","Oslo","Norway","OSL","ENGM",60.1939,11.1004,681,"Europe","large",["nordic","fjords","timber terminal","snow"],[]],
["Stockholm Arlanda Airport","Stockholm","Sweden","ARN","ESSA",59.6519,17.9186,137,"Europe","large",["nordic","forest","long winter nights"],[]],
["Helsinki-Vantaa Airport","Helsinki","Finland","HEL","EFHK",60.3172,24.9633,179,"Europe","large",["shortcut between europe and asia","nordic","polar route"],[]],
["Dublin Airport","Dublin","Ireland","DUB","EIDW",53.4213,-6.2701,242,"Europe","large",["us preclearance","irish sea","rain"],[]],
["London Gatwick Airport","London","United Kingdom","LGW","EGKK",51.1537,-0.1821,202,"Europe","large",["single runway","leisure traffic","south of london"],[]],
["London Stansted Airport","London","United Kingdom","STN","EGSS",51.8850,0.2350,348,"Europe","large",["low cost carriers","ryanair base","foster terminal"],[]],
["Manchester Airport","Manchester","United Kingdom","MAN","EGCC",53.3654,-2.2725,257,"Europe","large",["northern england","football"],[]],
["Humberto Delgado Airport","Lisbon","Portugal","LIS","LPPT",38.7742,-9.1342,374,"Europe","large",["atlantic gateway","inside the city","short runway approach over rooftops"],[]],
["Athens International Airport","Athens","Greece","ATH","LGAV",37.9364,23.9445,308,"Europe","large",["aegean","islands","ancient ruins"],[]],
["Sheremetyevo International Airport","Moscow","Russia","SVO","UUEE",55.9726,37.4146,622,"Europe","hub",["russian gateway","extreme winter"],[]],
["Keflavík International Airport","Reykjavík","Iceland","KEF","BIKF",63.9850,-22.6056,171,"Europe","large",["island","volcanic","lava field","northern lights","north atlantic stopover","windy"],[]],
["Svalbard Airport, Longyear","Longyearbyen","Norway","LYR","ENSB",78.2461,15.4656,88,"Europe","regional",["northernmost airport with scheduled flights","arctic","polar night","permafrost","polar bears"],[]],
["Hamad International Airport","Doha","Qatar","DOH","OTHH",25.2731,51.6080,13,"Asia","hub",["desert","gulf","qatar airways hub","luxury terminal"],[]],
["Zayed International Airport","Abu Dhabi","United Arab Emirates","AUH","OMAA",24.4330,54.6511,88,"Asia","large",["desert","gulf","etihad hub"],[]],
["King Abdulaziz International Airport","Jeddah","Saudi Arabia","JED","OEJN",21.6796,39.1565,48,"Asia","hub",["hajj pilgrimage terminal","red sea","desert"],[]],
["Ben Gurion Airport","Tel Aviv","Israel","TLV","LLBG",32.0114,34.8867,135,"Asia","large",["levant","mediterranean","tight security"],[]],
["Cairo International Airport","Cairo","Egypt","CAI","HECA",30.1219,31.4056,382,"Africa","hub",["desert","nile","pyramids","african gateway"],[]],
["O. R. Tambo International Airport","Johannesburg","South Africa","JNB","FAOR",-26.1392,28.2460,5558,"Africa","hub",["highveld","high altitude","african gateway","long takeoff roll"],[]],
["Cape Town International Airport","Cape Town","South Africa","CPT","FACT",-33.9649,18.6017,151,"Africa","large",["table mountain","two oceans","windy","cape doctor wind"],[]],
["Jomo Kenyatta International Airport","Nairobi","Kenya","NBO","HKJK",-1.3192,36.9278,5330,"Africa","large",["safari gateway","east africa hub","savannah","high altitude"],[]],
["Addis Ababa Bole International Airport","Addis Ababa","Ethiopia","ADD","HAAB",8.9779,38.7993,7625,"Africa","hub",["highland plateau","high altitude","ethiopian airlines hub","african connections"],[]],
["Murtala Muhammed International Airport","Lagos","Nigeria","LOS","DNMM",6.5774,3.3212,135,"Africa","large",["west africa","gulf of guinea","megacity"],[]],
["Mohammed V International Airport","Casablanca","Morocco","CMN","GMMN",33.3675,-7.5900,656,"Africa","large",["atlantic morocco","north africa","europe africa connections"],[]],
["Indira Gandhi International Airport","Delhi","India","DEL","VIDP",28.5562,77.1000,777,"Asia","hub",["indian capital","monsoon","winter fog delays","north india"],[]],
["Chhatrapati Shivaji Maharaj International Airport","Mumbai","India","BOM","VABB",19.0887,72.8679,39,"Asia","hub",["single runway megacity","arabian sea","bollywood","monsoon"],[]],
["Kempegowda International Airport","Bengaluru","India","BLR","VOBL",13.1986,77.7066,3000,"Asia","large",["indian tech city","software outsourcing","silicon valley of india","startups"],[]],
["Suvarnabhumi Airport","Bangkok","Thailand","BKK","VTBS",13.6900,100.7501,5,"Asia","hub",["southeast asia","tropical","tourism","built on swamp"],[]],
["Kuala Lumpur International Airport","Kuala Lumpur","Malaysia","KUL","WMKK",2.7456,101.7099,69,"Asia","hub",["rainforest terminal","tropical","airport in the jungle"],[]],
["Soekarno–Hatta International Airport","Jakarta","Indonesia","CGK","WIII",-6.1256,106.6558,34,"Asia","hub",["java","tropical","archipelago","sinking city"],[]],
["Ngurah Rai International Airport","Denpasar","Indonesia","DPS","WADD",-8.7482,115.1675,14,"Asia","large",["bali","island","beach","volcanic ash disruptions","tourism"],[]],
["Ninoy Aquino International Airport","Manila","Philippines","MNL","RPLL",14.5086,121.0198,75,"Asia","large",["archipelago","typhoons","congested"],[]],
["Tan Son Nhat International Airport","Ho Chi Minh City","Vietnam","SGN","VVTS",10.8188,106.6520,33,"Asia","large",["mekong delta","tropical","inside the city"],[]],
["Noi Bai International Airport","Hanoi","Vietnam","HAN","VVNB",21.2212,105.8072,39,"Asia","large",["red river delta","northern vietnam"],[]],
["Taiwan Taoyuan International Airport","Taipei","Taiwan","TPE","RCTP",25.0777,121.2328,106,"Asia","hub",["semiconductor island","typhoons","strait"],["桃园机场","台北桃园"]],
["Chengdu Tianfu International Airport","Chengdu","China","TFU","ZUTF",30.3125,104.4413,1345,"Asia","large",["sichuan basin","pandas","spicy food","new airport"],["天府国际机场"]],
["Chengdu Shuangliu International Airport","Chengdu","China","CTU","ZUUU",30.5785,103.9471,1625,"Asia","large",["sichuan","gateway to tibet","pandas"],["双流国际机场"]],
["Kunming Changshui International Airport","Kunming","China","KMG","ZPPP",25.1019,102.9292,6903,"Asia","large",["yunnan plateau","high altitude","spring city","gateway to southeast asia"],["昆明长水国际机场"]],
["Lhasa Gonggar Airport","Lhasa","China","LXA","ZULS",29.2978,90.9119,11713,"Asia","regional",["tibet","himalaya","extreme altitude","thin air","plateau","oxygen"],["拉萨贡嘎机场"]],
["Sydney Kingsford Smith Airport","Sydney","Australia","SYD","YSSY",-33.9399,151.1753,21,"Oceania","hub",["harbour approach","opera house","curfew","southern hemisphere"],[]],
["Melbourne Airport","Melbourne","Australia","MEL","YMML",-37.6690,144.8410,434,"Oceania","large",["24 hour operation","four seasons in one day"],[]],
["Brisbane Airport","Brisbane","Australia","BNE","YBBN",-27.3842,153.1175,13,"Oceania","large",["queensland","great barrier reef gateway","subtropical"],[]],
["Auckland Airport","Auckland","New Zealand","AKL","NZAA",-37.0082,174.7850,23,"Oceania","large",["pacific","long haul to everywhere","volcanic field"],[]],
["Wellington International Airport","Wellington","New Zealand","WLG","NZWN",-41.3272,174.8053,41,"Oceania","regional",["windy","windiest airport","cook strait wind","turbulent approach","short runway between hills","difficult landing"],[]],
["Tribhuvan International Airport","Kathmandu","Nepal","KTM","VNKT",27.6966,85.3591,4390,"Asia","large",["himalaya","mountain valley","monsoon","everest trekking gateway","difficult approach"],[]],
["Tenzing–Hillary Airport","Lukla","Nepal","LUA","VNLK",27.6869,86.7298,9334,"Asia","regional",["most dangerous airport in the world","sloped runway","cliff at the end","everest base camp","himalaya","extreme altitude"],[]],
["Paro International Airport","Paro","Bhutan","PBH","VQPR",27.4032,89.4246,7332,"Asia","regional",["himalaya","only a handful of certified pilots","steep valley approach","dangerous","high altitude"],[]],
["Gibraltar International Airport","Gibraltar","Gibraltar","GIB","LXGB",36.1512,-5.3466,15,"Europe","regional",["runway crosses a public road","rock of gibraltar","crosswinds","dangerous"],[]],
["Princess Juliana International Airport","Sint Maarten","Sint Maarten","SXM","TNCM",18.0409,-63.1089,13,"Americas","regional",["planes land over the beach","maho beach","caribbean island","jet blast","famous landing"],[]],
["Cristiano Ronaldo Madeira International Airport","Funchal","Portugal","FNC","LPMA",32.6979,-16.7745,192,"Europe","regional",["runway on pillars over the sea","atlantic island","severe crosswinds","windy","dangerous landing","cliff"],[]],
["Barra Airport","Barra","United Kingdom","BRR","EGPR",57.0228,-7.4431,5,"Europe","regional",["beach runway","tide dependent schedule","scottish islands","sand"],[]],
["Courchevel Altiport","Courchevel","France","CVF","LFLJ",45.3967,6.6347,6588,"Europe","regional",["ski resort","very short sloped runway","alps","mountain","dangerous","no go around"],[]],
["Ronald Reagan Washington National Airport","Washington","United States","DCA","KDCA",38.8512,-77.0402,15,"Americas","large",["river approach along the potomac","restricted airspace","close to downtown"],[]],
].map((r, i) => ({
  id: 1000 + i,
  name: r[0], city: r[1], country: r[2],
  iata: r[3], icao: r[4],
  lat: +r[5], lon: +r[6], altFt: r[7],
  region: r[8], size: r[9],
  tags: r[10],        // (*) offline only
  aliases: r[11],     // (*) offline only
  // `doc` is EXACTLY what scripts/load_data.py builds and stores in TiDB:
  // it is what both the full-text index and the embedding actually see.
  get doc() {
    const size = { hub: "major international hub very large airport",
                   large: "large international airport",
                   regional: "regional airport limited service" }[this.size];
    const alt = this.altFt > 6000 ? "high altitude mountain airport" : "";
    return [this.name, this.city, this.country, this.iata, this.icao,
            this.region, size, alt].filter(Boolean).join(" ");
  },
}));

/* A few dozen real long-haul pairs, used to draw arcs on the globe. */
const ROUTES = [
  ["LHR","JFK"],["LHR","SIN"],["LHR","DXB"],["LHR","HKG"],["LHR","LAX"],["LHR","PEK"],
  ["CDG","JFK"],["CDG","NRT"],["CDG","GRU"],["CDG","DXB"],["CDG","CMN"],
  ["JFK","LAX"],["JFK","GRU"],["JFK","FRA"],["JFK","MEX"],["JFK","SFO"],
  ["SFO","HND"],["SFO","SIN"],["SFO","ICN"],["SFO","PVG"],["SFO","SEA"],["SFO","DEN"],
  ["LAX","SYD"],["LAX","HNL"],["LAX","TPE"],["LAX","MEX"],
  ["DXB","SIN"],["DXB","JNB"],["DXB","BOM"],["DXB","SYD"],["DXB","LOS"],["DXB","IST"],
  ["SIN","SYD"],["SIN","CGK"],["SIN","BKK"],["SIN","HKG"],["SIN","DEL"],
  ["PEK","PVG"],["PEK","CAN"],["PEK","HKG"],["PEK","ICN"],["PEK","LXA"],["PEK","CTU"],
  ["PVG","NRT"],["PVG","TPE"],["PVG","SZX"],["PVG","KMG"],
  ["HND","ICN"],["HND","HKG"],["HND","SIN"],
  ["FRA","IST"],["FRA","ORD"],["FRA","NBO"],["FRA","MUC"],["FRA","ARN"],
  ["AMS","KEF"],["AMS","YYZ"],["AMS","CPT"],["AMS","BCN"],
  ["IST","DOH"],["IST","ADD"],["IST","MAD"],
  ["ATL","ORD"],["ATL","MIA"],["ATL","DFW"],["ORD","YYZ"],["DFW","MEX"],
  ["GRU","EZE"],["GRU","SCL"],["GRU","BOG"],["BOG","LIM"],["LIM","LPB"],["LIM","UIO"],
  ["SCL","USH"],["EZE","USH"],
  ["JNB","CPT"],["JNB","NBO"],["NBO","ADD"],["ADD","CAI"],["CAI","JED"],
  ["DEL","BOM"],["DEL","KTM"],["KTM","LUA"],["KTM","PBH"],["DEL","BLR"],
  ["BKK","DPS"],["BKK","HAN"],["KUL","CGK"],["MNL","HKG"],["SGN","TPE"],
  ["SYD","AKL"],["SYD","MEL"],["MEL","BNE"],["AKL","HNL"],
  ["KEF","OSL"],["OSL","LYR"],["CPH","HEL"],["HEL","ICN"],["ARN","ANC"],
  ["MAD","LIS"],["LIS","FNC"],["MAD","GIB"],["FCO","ATH"],["MUC","ZRH"],["ZRH","CVF"],
  ["LGW","SXM"],["MIA","SXM"],["MAN","BRR"],["DUB","BOS"],["DCA","BOS"],
  ["YVR","YYZ"],["ANC","SEA"],["LAS","PHX"],["IAD","LHR"],["EWR","LGA"],["OAK","SJC"],
];

/* Preset queries live in i18n.js — they are localised, not just labelled. */

/* ---------------------------------------------------------------------
 *  Multilingual aliases (*) — offline simulation only.
 *
 *  A real multilingual embedding model already knows that "aeroporto mais
 *  alto dos Andes" and "安第斯山脉海拔最高的机场" point at El Alto. The
 *  offline simulation has no model, so it needs to be told. Kept in one
 *  block rather than sprinkled through the table above, and merged into
 *  `aliases` — which the vector simulation reads and nothing else does.
 *
 *  Connected to a real TiDB cluster, none of this is used: the embedding
 *  of `doc` does the whole job.
 * ------------------------------------------------------------------- */
const ML_ALIASES = {
  // cross-language name lookups
  PEK: ["Pequim", "Pekín", "北京"],
  PKX: ["Pequim", "Pekín", "北京"],
  LHR: ["伦敦", "Londres", "希思罗"],
  LGW: ["伦敦", "Londres", "盖特威克"],
  STN: ["伦敦", "Londres", "斯坦斯特德"],
  JFK: ["纽约", "Nova York", "Nueva York"],
  LAX: ["洛杉矶", "Los Ángeles"],
  SFO: ["旧金山", "湾区", "硅谷", "São Francisco", "San Francisco",
        "Vale do Silício", "Valle del Silicio", "baía", "bahía"],
  SJC: ["硅谷", "圣何塞", "San José", "Vale do Silício", "Valle del Silicio",
        "empresas de tecnologia", "empresas de tecnología"],
  CDG: ["巴黎", "París", "Paris"],
  MAD: ["马德里", "Madri", "Barajas"],
  BCN: ["巴塞罗那", "Barcelona", "mediterrâneo", "mediterráneo"],
  LIS: ["里斯本", "Lisboa"],
  GRU: ["圣保罗", "São Paulo", "Guarulhos", "maior da América do Sul"],
  GIG: ["里约热内卢", "Rio de Janeiro", "praia"],
  EZE: ["布宜诺斯艾利斯", "Buenos Aires", "Ezeiza"],
  MEX: ["墨西哥城", "Ciudad de México", "gran altitud", "grande altitude"],
  FRA: ["法兰克福", "Frankfurt"],
  AMS: ["阿姆斯特丹", "Ámsterdam"],
  FCO: ["罗马", "Roma"],
  IST: ["伊斯坦布尔", "Estambul", "Istambul"],
  DXB: ["迪拜", "Dubái", "deserto", "desierto"],
  SYD: ["悉尼", "Sídney"],

  // concept lookups the preset queries lean on
  LPB: ["安第斯", "海拔最高", "最高的机场", "拉巴斯",
        "Andes", "mais alto", "más alto",
        "mais alto do mundo", "más alto del mundo", "altiplano"],
  BOG: ["安第斯", "波哥大", "Andes", "grande altitude", "gran altitud"],
  UIO: ["安第斯", "基多", "Quito", "Andes", "grande altitude", "gran altitud"],
  LIM: ["安第斯", "利马", "Lima", "Andes"],
  SCL: ["安第斯", "圣地亚哥", "Santiago", "Andes", "cordilheira", "cordillera"],
  WLG: ["风大", "大风", "着陆困难", "惠灵顿",
        "vento forte", "ventoso", "pouso difícil",
        "viento fuerte", "aterrizaje difícil"],
  FNC: ["风大", "着陆困难", "马德拉", "Madeira",
        "vento forte", "ventoso", "pouso difícil", "penhasco",
        "viento fuerte", "aterrizaje difícil", "acantilado"],
  KEF: ["冰岛", "风大", "Islândia", "Islandia", "ventoso"],
  CPT: ["风大", "开普敦", "Cidade do Cabo", "Ciudad del Cabo", "ventoso"],
  SXM: ["海滩", "沙滩降落", "praia", "pouso na praia", "playa", "aterrizaje en la playa"],
  BRR: ["海滩", "praia", "playa", "areia", "arena"],
  LUA: ["珠峰", "最危险", "Everest", "perigoso", "peligroso"],
  PBH: ["喜马拉雅", "危险", "Himalaia", "Himalaya", "perigoso", "peligroso"],
  LXA: ["西藏", "拉萨", "海拔最高", "Tibete", "Tíbet", "grande altitude", "gran altitud"],
  CVF: ["滑雪", "esqui", "esquí", "montanha", "montaña"],
  LYR: ["最北", "北极", "mais ao norte", "más al norte", "ártico"],
  USH: ["最南", "世界尽头", "mais ao sul", "más al sur", "fim do mundo", "fin del mundo"],
  DEN: ["丹佛", "montanhas rochosas", "montañas rocosas"],
  ADD: ["海拔最高", "grande altitude", "gran altitud"],
  JNB: ["约翰内斯堡", "Joanesburgo", "Johannesburgo", "grande altitude", "gran altitud"],
};
AIRPORTS.forEach((a) => {
  const extra = ML_ALIASES[a.iata];
  if (extra) a.aliases = a.aliases.concat(extra);
});
