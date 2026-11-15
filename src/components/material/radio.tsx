import React from "react";
import { createComponent } from "@lit/react";
import { MdRadio } from "@material/web/radio/radio.js";

const Radio = createComponent({
  react: React,
  tagName: "md-radio",
  elementClass: MdRadio,
  events: { onChange: "change", onInput: "input" },
});

export default Radio;
