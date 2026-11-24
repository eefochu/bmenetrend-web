// Hungarian labels copied from the Android app's res/values/*.xml (resource name in comments).
export const t = {
  brand: "BMenetrend", // ui_brand
  navMap: "Térkép", // planner_nav_map
  navPlan: "Tervezés", // planner_nav_plan
  navFavorites: "Kedvencek", // favorites_nav
  back: "Vissza", // ui_back
  close: "Bezárás", // ui_close
  loading: "Az adatok betöltése folyamatban", // ui_loading_data

  searchShort: "Keresés", // ui_search_short
  searchHint: "Megálló vagy járat keresése", // ui_search_hint
  searchInputHint: "Megálló, hely vagy járat", // search_input_hint
  clearSearch: "Keresés törlése", // ui_clear_search
  searchAll: "Mind", // search_all
  searchStations: "Megállók", // search_stations
  searchPlaces: "Helyek", // search_places
  searchVehicles: "Járművek", // search_vehicles
  searchDiscoverTitle: "Hová indulnál?", // search_discover_title
  searchDiscoverBody: "Keress röviden is. A „kelen” például Kelenföldet is megtalálja.", // search_discover_body
  searchExamples: "Próbáld ki", // search_examples
  searchNoMatches: "Nincs találat ebben a kategóriában.", // search_no_matches
  searchPlacesUnavailable:
    "A helykereső átmenetileg nem érhető el. A megállók és járművek továbbra is kereshetők.", // search_places_unavailable
  searchRetry: "Újra", // search_retry
  searchShowMore: "Továbbiak", // search_show_more
  searchPlacesAttribution: "© OpenStreetMap közreműködők · Photon", // search_places_attribution
  searchClosePlace: "Kiválasztott hely bezárása", // search_close_place

  settings: "Beállítások", // volan_settings
  nearestStopAction: "Legközelebbi megálló a helyzetem alapján", // ui_nearest_stop_action
  showDepartures: "Indulások megjelenítése", // ui_show_departures
  expandDepartures: "Indulások kibontása", // ui_expand_departures
  collapseDepartures: "Indulások részleges nézete", // ui_collapse_departures
  hideDepartures: "Indulások elrejtése, térkép nagyítása", // ui_hide_departures
  nearbyTitle: "Közeli járatok", // nearby_title
  nearbyYou: "A hozzád közeli megállókban", // nearby_you
  nearbyMap: "A térképen látható környék megállóiban", // nearby_map
  findStop: "Megálló keresése", // design_find_stop
  departures: "Indulások", // ui_departures
  transitData: "Adatforrások", // design_transit_data
  nationwide: "Országos hálózat", // volan_nationwide
  localScope:
    "Az EMMA/MÁVPlusz országosan szolgáltat Volán-buszokat, Budapesten pedig BKK-járműveket is. A Volán jelölői sárgák; a BKK-buszok világoskék, a trolik piros, a villamosok sárga ikont kapnak.", // volan_local_scope
  nationwideHint:
    "Alapból bekapcsolva. Kikapcsolva a Biatorbágyot, Pátyot és Budaörsöt érintő Volán-vonalak, valamint a Budapesten belüli BKK-járművek jelennek meg. A vonatok és a HÉV-ek országosan elérhetők maradnak. A követés a forrástól függ; a hiányzó pozíció nem jelent járatkimaradást.", // volan_nationwide_hint
  downloadedTimetables: "Letöltött menetrendek", // ui_downloaded_timetables
  noDownloadedTimetables: "Nincsenek letöltött offline menetrendek", // ui_no_downloaded_timetables
  locationDenied: "Helyhozzáférés nélkül válassz megállót a térképen vagy a keresőben.", // engine_location_denied
  locating: "Helyzet meghatározása…", // engine_locating

  themeTitle: "Megjelenés", // theme_title
  themeAuto: "Automatikus", // design_theme_auto
  themeLight: "Világos", // design_theme_light
  themeDark: "Sötét", // design_theme_dark
  accentTitle: "Kiemelőszín", // accent_title
  accentHint:
    "A Rendszer színei a háttérképhez igazodnak. Egyéni kiemelőszínnél a felületek is a választott színt követik.", // accent_hint
  accents: {
    system: "Rendszer",
    green: "Zöld",
    blue: "Kék",
    purple: "Lila",
    rose: "Rózsaszín",
    orange: "Narancssárga",
    custom: "Egyéni",
  },
  customColorTitle: "Egyéni színválasztó", // custom_color_title
  customColorHex: "Hexadecimális szín", // custom_color_hex
  customColorRed: "Piros",
  customColorGreen: "Zöld",
  customColorBlue: "Kék",
  customColorHint:
    "Válassz színt a csúszkákkal, vagy adj meg hatjegyű hexadecimális kódot. A színt az app az olvasható világos és sötét témához igazítja.", // custom_color_hint
  mapCreditsTitle: "Térképforrások és licencek", // map_credits_title
  // Web: the street map is OpenFreeMap Liberty recoloured to the app's Google basemap palette.
  mapStyleCredit:
    "Az utcatérkép az OpenFreeMap Liberty (OSM Liberty / OSM Bright, BSD 3-Clause, CC BY 4.0) stílusának a Google-térképhez igazított színezésű változata. Google-szolgáltatást nem használ.",
  about: "Névjegy", // ota_about_title
  aboutVersion: (version: string) => `Verzió: ${version}`, // ota_about_version
  aboutAppDescription:
    "A BMenetrend egy modern, nyílt tömegközlekedési menetrend és valós idejű járműkövető alkalmazás. Segítségével valós időben követhetők a MÁV vasúti járatok, a HÉV, a Volánbusz, a BKK járatok (busz, villamos, troli, metró), valamint a helyi ViaBusz, KanyarGO és HOMM járatok menetrendjei és élő adatai.", // ota_about_app_description
  aboutAction: "Az alkalmazásról és az adatokról", // ui_about_action
  aboutDescription:
    "ViaBusz-, KanyarGO- és HOMM-megállók, járatok és indulások Biatorbágyon, Pátyon és Budaörsön. Nem hivatalos alkalmazás.", // ui_about_description
  aboutLiveData:
    "A menetrendi indulásokat külön felirat jelöli. Az élő buszhelyzet és az igazolt érkezési becslés az üzemeltetők nyilvános adataiból érkezik, ha elérhető. Egyes élő jelzésekhez a forrás nem ad járatszámot.", // ui_about_live_data
  volanAbout:
    "A Volán-, BKK- és HÉV--járművek pozíciói az EMMA/MÁVPlusz rendszeréből érkeznek. Közvetlen BKK API-t nem használunk. Csak friss forrásadatokat mutatunk; a követés hiánya nem jelent járatkimaradást. A megállók és indulási táblák is az EMMA rendszeréből érkeznek. Csak az élőként jelölt indulások tartalmaznak valós idejű előrejelzést. A járművek távolabbról is láthatók, a megállókat apró pontok jelzik. A járművekre koppintva megnyílnak a menet adatai és megállói.", // volan_about
  linkMavplusz: "MÁVPlusz térkép", // volan_source_link
  linkOpenFreeMap: "OpenFreeMap · térképforrás", // map_provider_source
  linkPhoton: "Helyek: Photon / OpenStreetMap", // search_places_source
  linkViabusz: "ViaBusz hivatalos weboldal",
  linkKanyargo: "KanyarGO hivatalos weboldal",
  linkHomm: "HOMM hivatalos weboldal",

  favoritesTitle: "Kedvenc megállók", // favorites_title
  favoritesIntro: "A megszokott útjaid, egy helyen", // design_favorites_intro
  favoritesEmpty:
    "A megálló indulási tábláján lévő szívvel mentheted ide a kedvenceidet. Itt az összes hozzájuk tartozó járatot megtalálod.", // favorites_empty
  addStop: "Megálló hozzáadása", // design_add_stop

  plannerTitle: "Utazástervezés", // planner_title
  plannerFrom: "Honnan?", // planner_from
  plannerTo: "Hová?", // planner_to
  plannerSwap: "Kiindulópont és cél felcserélése", // planner_swap
  plannerCurrent: "Jelenlegi pozícióm", // planner_current
  plannerSubtitle: "Hova szeretnél menni?", // planner_subtitle
  plannerChoose: "Válassz helyet vagy megállót", // planner_choose
  plannerLeaveNow: "Indulás most", // planner_leave_now
  plannerLeaveLater: "Dátum és időpont kiválasztása", // planner_leave_later
  plannerDeparture: "Indulás", // planner_departure
  plannerDepartureZone:
    "Budapesti idő szerint. Az út a megadott időpontban kezdődik; a sétával és az átszállási tartalékkal is számolunk.", // planner_departure_zone
  plannerDepartureInvalid:
    "Válassz jövőbeli időpontot. Óraátállításkor válassz az ismétlődő vagy kimaradó órán kívüli időt.", // planner_departure_invalid
  plannerApply: "Alkalmaz", // planner_apply
  plannerCancel: "Mégse", // planner_cancel
  plannerLocalServices: "Helyi járatok", // planner_local_services
  plannerLocalServicesDetail:
    "Az EMMA országos útvonalai mellett ezeknek a szolgáltatóknak az ellenőrzött helyi menetrendjeit is használjuk. Átszállással kombinált útvonalakat is keresünk.", // planner_local_services_detail
  plannerLocalServicesDone: "Kész", // planner_local_services_done
  plannerFind: "Mutasd az útvonalakat", // planner_find
  plannerRefresh: "Újratervezés", // planner_refresh
  plannerLocationError:
    "A helyzeted még nem érhető el. Engedélyezd a helyhozzáférést, vagy válassz kiindulópontot.", // planner_location_error
  plannerOutsideArea: "A tervezés Magyarországon érhető el. Válassz magyarországi kiindulópontot és célt.", // planner_outside_area
  plannerSamePlace: "Válassz a kiindulóponttól távolabbi célt.", // planner_same_place
  plannerDeparturePassed: "A megadott indulási idő elmúlt. Válassz későbbi időpontot, vagy indulj most.", // planner_departure_passed
  plannerNoRoute:
    "A megadott időpontban nem találtunk megfelelő útvonalat. Próbálj másik időpontot vagy kiindulópontot.", // planner_no_route
  plannerUnavailable: "Az útvonaltervezés átmenetileg nem érhető el. Ellenőrizd a kapcsolatot, és próbáld újra.", // planner_unavailable
  plannerPartial:
    "Egyes menetrendek vagy gyalogos kapcsolatok most nem érhetők el, ezért további útvonalak is lehetségesek. Próbálj újratervezni.", // planner_partial
  plannerNoPlaces: "Nincs találat. Próbálj pontosabb nevet megadni.", // planner_no_places
  plannerSearchError:
    "A helykeresés nem érhető el. Próbálj megállónévre keresni, vagy ellenőrizd a kapcsolatot.", // planner_search_error

  // Web-only status lines for features whose data sources are not ported yet. They use the same
  // status slots as Android (stopStatus / lineCatalogueStatus) and never claim an empty result.
  webNearbyPending:
    "A közeli indulások a webes változatban még nem érhetők el. Addig keress helyre, vagy mozdítsd el a térképet.",
  webStopSearchPending: "A megálló- és járatkeresés a webes változatban még nem érhető el.",
  webPlannerPending: "Az útvonaltervezés a webes változatban még nem érhető el.",

  mapLoading: "Térkép betöltése…",
  mapFailed: "A térkép nem tölthető be. Ellenőrizd az internetkapcsolatot.",
  mapRetry: "Újrapróbálás",
  mapLabel: "Interaktív térkép",
};
