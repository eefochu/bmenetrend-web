import React from "react";
import { createComponent } from "@lit/react";
import { MdSwitch } from "@material/web/switch/switch.js";

const Switch = createComponent({
  react: React,
  tagName: "md-switch",
  elementClass: MdSwitch,
  events: { onChange: "change", onInput: "input" },
});

export default Switch;
