import { type AppType } from "next/app";

import { api } from "~/utils/api";

import "maplibre-gl/dist/maplibre-gl.css";
import "~/styles/globals.css";
import "~/styles/app.css";

// The transit app needs no sign-in. The scaffolded next-auth route stays available, but its
// SessionProvider is not mounted: it would request /api/auth/session on every visit.
const MyApp: AppType = ({ Component, pageProps }) => <Component {...pageProps} />;

export default api.withTRPC(MyApp);
