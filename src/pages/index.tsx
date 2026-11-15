import dynamic from "next/dynamic";
import Head from "next/head";

// The app reads browser-only state (theme, storage, location) and MapLibre needs WebGL: render it
// on the client only, behind a background that already matches the theme.
const AppShell = dynamic(() => import("~/components/app/app-shell"), {
  ssr: false,
  loading: () => <div className="app-loading" role="status" aria-label="Betöltés…" />,
});

export default function Home() {
  return (
    <>
      <Head>
        <title>BMenetrend</title>
        <meta name="description" content="BMenetrend – közösségi közlekedés, térképen." />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />
      </Head>
      <AppShell />
    </>
  );
}
