import { Head, Html, Main, NextScript } from "next/document";

// Keep in sync with the <Icon> names used in src/components (Google Fonts requires alphabetical order).
const ICONS = [
  "add",
  "arrow_back",
  "arrow_forward",
  "calendar_month",
  "cancel",
  "check",
  "chevron_right",
  "close",
  "delete",
  "directions_bus",
  "directions_railway",
  "directions_walk",
  "expand_less",
  "expand_more",
  "favorite",
  "info",
  "keyboard_arrow_down",
  "location_on",
  "map",
  "more_vert",
  "my_location",
  "near_me",
  "open_in_new",
  "refresh",
  "route",
  "schedule",
  "search",
  "search_off",
  "sensors",
  "settings",
  "subway",
  "swap_vert",
  "train",
  "tram",
  "trip_origin",
  "tune",
  "wifi_off",
];

// Applies the saved light/dark choice before first paint, so the page never flashes the other theme.
const THEME_BOOTSTRAP = `try{var p=JSON.parse(localStorage.getItem("bmenetrend:preferences")||"{}");if(p.themeMode==="light"||p.themeMode==="dark")document.documentElement.dataset.theme=p.themeMode}catch(e){}`;

export default function Document() {
  return (
    <Html lang="hu">
      <Head>
        <meta name="theme-color" content="#f6f7f9" />
        <link rel="icon" href="/favicon.ico" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Google+Sans+Flex:wght@400..700&display=swap" />
        <link
          rel="stylesheet"
          href={`https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,400,0..1,0&icon_names=${ICONS.join(",")}&display=block`}
        />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
