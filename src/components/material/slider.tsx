import React from "react";
import { createComponent } from "@lit/react";
import { MdSlider } from "@material/web/slider/slider.js";

const Slider = createComponent({
  react: React,
  tagName: "md-slider",
  elementClass: MdSlider,
  events: { onChange: "change", onInput: "input" },
});

export default Slider;
