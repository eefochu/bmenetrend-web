/**
 * Builds public/map/google-light.json and public/map/google-dark.json: OpenFreeMap's Liberty style
 * (OpenMapTiles schema, no API key) recoloured to look like the Android app's Google basemap.
 *
 * Dark road, park, water and rail colours are those of Android's map/GoogleBasemapStyle.kt, with land cover,
 * buildings and street edges tinted for detail. Light colours follow Google
 * Maps' default palette, which is what Android shows in light mode. No Google Maps service or data is used.
 *
 * Map text is drawn in Google Sans Flex (SIL OFL 1.1), downloaded from Google Fonts into public/map/fonts/.
 *
 *   bun scripts/build-google-styles.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";

const SOURCE = "https://tiles.openfreemap.org/styles/liberty";

const PALETTES = {
  light: {
    land: "#f5f5f5",
    manMade: "#eef0f2",
    park: "#c3ecb2",
    grass: "#dcefd3",
    wood: "#d3eacb",
    wetland: "#d3eadb",
    sand: "#f3ecd7",
    ice: "#ffffff",
    hospital: "#fbe4e2",
    school: "#f3ead6",
    cemetery: "#d3e8cf",
    water: "#aadaff",
    waterLabel: "#4a7fb7",
    aeroway: "#e6e8eb",
    building: "#e8e9ed",
    buildingOutline: "#dadce0",
    local: "#ffffff",
    localCasing: "#dadce0",
    arterial: "#ffffff",
    arterialCasing: "#d3d6db",
    highway: "#fde293",
    highwayCasing: "#f3c25a",
    highwayLabel: "#5f6368",
    highwayLabelHalo: "#ffffff",
    path: "#d7dbe0",
    rail: "#9aa0a6",
    boundary: "#9aa0a6",
    text: "#5f6368",
    textStrong: "#3c4043",
    halo: "#ffffff",
    badgeRing: "#ffffff",
    // Google's place categories: [badge, label].
    poi: {
      food: ["#e8710a", "#b06000"],
      shopping: ["#1a73e8", "#1967d2"],
      health: ["#d93025", "#c5221f"],
      lodging: ["#d01884", "#a50e6a"],
      culture: ["#129eaf", "#00777f"],
      outdoor: ["#1e8e3e", "#137333"],
      auto: ["#607d8b", "#455a64"],
      civic: ["#70757a", "#5f6368"],
    },
  },
  // Road, park, water and rail colours from map/GoogleBasemapStyle.kt (dark). Android flattens all land
  // cover and street edges to the background colour; here they get dark tints so streets, built-up areas
  // and woodland read as clearly as in the light map.
  dark: {
    land: "#1f1f1f",
    manMade: "#26272a",
    park: "#284d36",
    grass: "#212c24",
    wood: "#1d2e23",
    wetland: "#1f2c2a",
    sand: "#2c2923",
    ice: "#2a2d30",
    hospital: "#34272a",
    school: "#2e2b23",
    cemetery: "#243a2c",
    water: "#163f56",
    waterLabel: "#ffffff",
    aeroway: "#2d2e31",
    building: "#2d2e31",
    buildingOutline: "#393a3d",
    local: "#585a5e",
    localCasing: "#444548",
    arterial: "#79644f",
    arterialCasing: "#54473a",
    highway: "#d6a370",
    highwayCasing: "#775a41",
    highwayLabel: "#ffffff",
    highwayLabelHalo: "#29231d",
    path: "#4c4e51",
    rail: "#8d99a6",
    boundary: "#6a6a6a",
    // Android uses #b9b9b9; the web map labels are white for contrast.
    text: "#ffffff",
    textStrong: "#ffffff",
    halo: "#1f1f1f",
    badgeRing: "#1f1f1f",
    poi: {
      food: ["#c26401", "#fcad70"],
      shopping: ["#1967d2", "#8ab4f8"],
      health: ["#b3261e", "#f28b82"],
      lodging: ["#a8156b", "#f49ac6"],
      culture: ["#0f7f8c", "#78d9ec"],
      outdoor: ["#1b6e33", "#81c995"],
      auto: ["#546e7a", "#b0bec5"],
      civic: ["#5f6368", "#bdc1c6"],
    },
  },
};

/** OpenMapTiles poi classes by Google category, with the Material Symbols glyph drawn on each badge. */
const POI_CLASSES = {
  food: {
    restaurant: "restaurant", fast_food: "fastfood", cafe: "local_cafe", bar: "local_bar", beer: "sports_bar",
    ice_cream: "icecream", bakery: "bakery_dining", sushi: "set_meal",
  },
  shopping: {
    shop: "shopping_bag", grocery: "local_grocery_store", clothing_store: "checkroom", florist: "local_florist",
    furniture: "chair", gift: "shopping_bag", hairdresser: "content_cut", laundry: "local_laundry_service",
    music: "music_note", alcohol_shop: "liquor", butcher: "storefront", mobile_phone: "smartphone", jewelry: "diamond",
    books: "menu_book",
  },
  health: {
    hospital: "local_hospital", doctors: "stethoscope", dentist: "dentistry", pharmacy: "local_pharmacy", veterinary: "pets",
  },
  lodging: { lodging: "hotel", campsite: "camping" },
  culture: {
    museum: "museum", art_gallery: "palette", attraction: "photo_camera", castle: "castle", monument: "photo_camera",
    theatre: "theater_comedy", cinema: "movie", zoo: "pets", aquarium: "set_meal", amusement_park: "attractions",
    stadium: "stadium",
  },
  outdoor: {
    park: "park", garden: "local_florist", playground: "toys", pitch: "sports_soccer", soccer: "sports_soccer",
    tennis: "sports_tennis", basketball: "sports_basketball", golf: "golf_course", swimming: "pool",
    dog_park: "pets", picnic_site: "outdoor_grill", fitness: "fitness_center", sports_centre: "fitness_center",
  },
  auto: {
    fuel: "local_gas_station", parking: "local_parking", car: "directions_car", bicycle: "pedal_bike",
    bicycle_rental: "pedal_bike", charging_station: "ev_station",
  },
  civic: {
    town_hall: "account_balance", bank: "account_balance", post: "local_post_office", police: "local_police",
    fire_station: "local_fire_department", school: "school", college: "school", kindergarten: "child_care",
    library: "local_library", place_of_worship: "church", embassy: "flag", information: "info", toilets: "wc",
    drinking_water: "water_drop", harbor: "anchor",
  },
};
const POI_FALLBACK = ["civic", "location_on"];

/**
 * Stops and stations are left off the basemap, like Android's transit.station labels: the app draws its
 * own transit data, so basemap bus, tram, metro, rail and ferry points would only compete with it.
 */
const TRANSIT_POI = ["bus", "railway", "rail", "tram", "subway", "aerialway", "ferry_terminal", "airport", "airfield", "entrance"];

const HIGHWAY = /motorway|trunk/;
const ARTERIAL = /primary|secondary/;

/** Colour role for each Liberty layer id. */
function recolour(layer, c) {
  const id = layer.id;
  const paint = (layer.paint ??= {});
  const set = (key, value) => (paint[key] = value);

  if (id === "background") return set("background-color", c.land);
  if (id === "landcover_grass") return set("fill-color", c.grass), set("fill-opacity", 1);
  if (id === "park" || id === "landuse_pitch" || id === "landuse_track") {
    set("fill-color", c.park);
    delete paint["fill-pattern"];
    return set("fill-opacity", 1);
  }
  if (id === "park_outline") return set("line-opacity", 0);
  if (id === "landcover_wood") return set("fill-color", c.wood), set("fill-opacity", 1);
  if (id === "landcover_wetland") return set("fill-color", c.wetland), delete paint["fill-pattern"];
  if (id === "landcover_sand") return set("fill-color", c.sand), set("fill-opacity", 1);
  if (id === "landcover_ice") return set("fill-color", c.ice);
  if (id === "landuse_residential") return set("fill-color", c.manMade), set("fill-opacity", 1);
  if (id === "landuse_cemetery") return set("fill-color", c.cemetery);
  if (id === "landuse_hospital") return set("fill-color", c.hospital);
  if (id === "landuse_school") return set("fill-color", c.school);
  if (id === "water") return set("fill-color", c.water);
  if (id.startsWith("waterway") && layer.type === "line") return set("line-color", c.water);
  if (id === "aeroway_fill") return set("fill-color", c.aeroway), set("fill-opacity", 1);
  if (id.startsWith("aeroway")) return set("line-color", c.local);
  if (id === "road_area_pattern") return set("fill-color", c.local), delete paint["fill-pattern"];
  if (id === "building") return set("fill-color", c.building), set("fill-outline-color", c.buildingOutline);
  if (id.startsWith("boundary")) return set("line-color", c.boundary);

  if (layer.type === "line" && layer["source-layer"] === "transportation") {
    if (/rail/.test(id)) return set("line-color", c.rail);
    if (/path_pedestrian/.test(id)) return set("line-color", id.endsWith("casing") ? c.localCasing : c.path);
    const casing = id.endsWith("_casing");
    const highway = HIGHWAY.test(id);
    const arterial = !highway && ARTERIAL.test(id);
    if (id.startsWith("tunnel")) set("line-opacity", 0.7);
    if (highway) return set("line-color", casing ? c.highwayCasing : c.highway);
    if (arterial) return set("line-color", casing ? c.arterialCasing : c.arterial);
    return set("line-color", casing ? c.localCasing : c.local);
  }

  if (/^poi_r\d+$/.test(id)) return googlePoi(layer, c);

  if (layer.type === "symbol") {
    const highwayLabel = id === "highway-name-major";
    const water = /water/.test(id);
    const place = id.startsWith("label_");
    set("text-color", water ? c.waterLabel : highwayLabel ? c.highwayLabel : place ? c.textStrong : c.text);
    set("text-halo-color", highwayLabel ? c.highwayLabelHalo : c.halo);
    if (paint["text-halo-width"] == null) set("text-halo-width", 1);
  }
}

/**
 * Google-style place badges: a filled circle in the category colour with a white glyph, label beside it in
 * the same colour. The badge images are drawn at runtime from style metadata (src/components/map/style-images.ts).
 */
function googlePoi(layer, c) {
  const poiClass = ["get", "class"];
  const labelColour = ["match", poiClass];
  for (const [category, classes] of Object.entries(POI_CLASSES)) {
    labelColour.push(Object.keys(classes), c.poi[category][1]);
  }
  labelColour.push(c.poi[POI_FALLBACK[0]][1]);

  layer.filter = ["all", layer.filter, ["!", ["match", poiClass, TRANSIT_POI, true, false]]];
  const layout = layer.layout;
  layout["icon-image"] = ["concat", "bm-poi:", ["to-string", poiClass]];
  layout["icon-size"] = 1;
  layout["text-variable-anchor"] = ["left", "right", "top"];
  layout["text-radial-offset"] = 1.05;
  layout["text-justify"] = "auto";
  layout["text-max-width"] = 8;
  delete layout["text-anchor"];
  delete layout["text-offset"];
  Object.assign(layer.paint, {
    "text-color": labelColour,
    "text-halo-color": c.halo,
    "text-halo-width": 1.2,
    "text-halo-blur": 0,
  });
}

/** Everything style-images.ts needs to draw the badge images for one palette. */
function imageMetadata(c) {
  const poi = { "*": [c.poi[POI_FALLBACK[0]][0], POI_FALLBACK[1]] };
  for (const [category, classes] of Object.entries(POI_CLASSES)) {
    for (const [poiClass, glyph] of Object.entries(classes)) poi[poiClass] = [c.poi[category][0], glyph];
  }
  return { ring: c.badgeRing, poi };
}

/** Hungarian names first, like the Android app's labels; Liberty prefers English. */
function hungarianNames(value) {
  if (Array.isArray(value)) {
    if (value[0] === "get" && value[1] === "name_en") return ["get", "name:hu"];
    return value.map(hungarianNames);
  }
  return value;
}

/**
 * Google Sans Flex for map text. Liberty's font stacks keep their names, so characters outside Latin and Latin Extended
 * (Hungarian is covered) fall back to OpenFreeMap's Noto Sans glyphs; italics become upright, as on Google.
 */
const FONT_FILES = { 400: "GoogleSansFlex-Regular.ttf", 700: "GoogleSansFlex-Bold.ttf" };
const LATIN = ["U+0000-024F", "U+0259", "U+1E00-1EFF", "U+2000-206F", "U+20A0-20CF", "U+2100-214F"];
const FONT_FACES = {
  "Noto Sans Regular": [{ url: `/map/fonts/${FONT_FILES[400]}`, "unicode-range": LATIN }],
  "Noto Sans Italic": [{ url: `/map/fonts/${FONT_FILES[400]}`, "unicode-range": LATIN }],
  "Noto Sans Bold": [{ url: `/map/fonts/${FONT_FILES[700]}`, "unicode-range": LATIN }],
};

async function downloadFonts() {
  const fonts = new URL("../public/map/fonts/", import.meta.url);
  mkdirSync(fonts, { recursive: true });
  // An older user agent makes Google Fonts serve one static TrueType file per weight instead of the
  // variable woff2, whose default instance would draw bold labels at regular weight.
  const css = await (
    await fetch("https://fonts.googleapis.com/css2?family=Google+Sans+Flex:wght@400;700", {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh) Chrome/130" },
    })
  ).text();
  for (const [weight, file] of Object.entries(FONT_FILES)) {
    const url = new RegExp(`font-weight: ${weight};[^}]*?url\\((https:[^)]+\\.ttf)\\)`).exec(css)?.[1];
    if (!url) throw new Error(`Google Sans Flex ${weight}: no TrueType URL in Google Fonts CSS`);
    writeFileSync(new URL(file, fonts), Buffer.from(await (await fetch(url)).arrayBuffer()));
  }
  const licence = await fetch("https://raw.githubusercontent.com/google/fonts/main/ofl/googlesansflex/OFL.txt");
  writeFileSync(new URL("OFL.txt", fonts), await licence.text());
  console.log(`public/map/fonts/: ${Object.values(FONT_FILES).join(", ")}, OFL.txt`);
}

await downloadFonts();
const liberty = await (await fetch(SOURCE)).json();

for (const [mode, palette] of Object.entries(PALETTES)) {
  const style = structuredClone(liberty);
  style.name = `BMenetrend Google-like ${mode}`;
  style.metadata = {
    "bmenetrend:source": `${SOURCE} (OpenFreeMap Liberty, BSD 3-Clause / CC BY 4.0), recoloured by scripts/build-google-styles.mjs`,
  };
  style.metadata["bmenetrend:images"] = imageMetadata(palette);
  style["font-faces"] = FONT_FACES;
  delete style.sources.ne2_shaded;
  // No transit stop points and, unlike Google, no road number shields.
  const dropped = new Set(["poi_transit", "highway-shield-non-us", "highway-shield-us-interstate", "road_shield_us"]);
  style.layers = style.layers.filter(
    (layer) => layer.source !== "ne2_shaded" && layer.type !== "fill-extrusion" && !dropped.has(layer.id),
  );
  for (const layer of style.layers) {
    recolour(layer, palette);
    if (layer.layout?.["text-field"]) layer.layout["text-field"] = hungarianNames(layer.layout["text-field"]);
  }
  writeFileSync(new URL(`../public/map/google-${mode}.json`, import.meta.url), `${JSON.stringify(style)}\n`);
  console.log(`public/map/google-${mode}.json: ${style.layers.length} layers`);
}
