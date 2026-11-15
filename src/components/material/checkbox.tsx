import React from "react";
import { createComponent } from "@lit/react";
import { MdCheckbox } from "@material/web/checkbox/checkbox.js";

const Checkbox = createComponent({
  react: React,
  tagName: "md-checkbox",
  elementClass: MdCheckbox,
  events: { onChange: "change", onInput: "input" },
});

export default Checkbox;
