// Import these SSR-safe entry points instead of the browser implementations.
import dynamic from "next/dynamic";

export const FilledButton = dynamic(() => import("./filled-button"), {
  ssr: false,
});
export const OutlinedButton = dynamic(() => import("./outlined-button"), {
  ssr: false,
});
export const Checkbox = dynamic(() => import("./checkbox"), { ssr: false });
export const Switch = dynamic(() => import("./switch"), { ssr: false });
export const OutlinedTextField = dynamic(
  () => import("./outlined-text-field"),
  { ssr: false },
);
export const Radio = dynamic(() => import("./radio"), { ssr: false });
export const Slider = dynamic(() => import("./slider"), { ssr: false });
