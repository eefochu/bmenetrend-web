import { readFileSync } from "node:fs";

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);

/** @type {import("next").NextConfig} */
const config = {
  reactStrictMode: true,
  // The frontend is static. The existing Cloudflare Worker owns backend operations.
  output: "export",
  env: { NEXT_PUBLIC_APP_VERSION: version },
};

export default config;
