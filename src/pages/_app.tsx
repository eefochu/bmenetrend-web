import { type AppType } from "next/app";

import "maplibre-gl/dist/maplibre-gl.css";
import "~/styles/globals.css";
import "~/styles/app.css";

// Next serves a static document; the interactive app and data clients run in the browser.
const MyApp: AppType = ({ Component, pageProps }) => (
  <Component {...pageProps} />
);

export default MyApp;
