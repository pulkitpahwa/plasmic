import {
  InitOptions,
  initPlasmicLoader as initPlasmicLoaderReact,
} from "@plasmicapp/loader-react";
import * as Gatsby from "gatsby";
import * as React from "react";
import * as ReactDom from "react-dom";

export function initPlasmicLoader(opts: InitOptions) {
  const loader = initPlasmicLoaderReact({
    ...opts,
    platform: "gatsby",
  });

  loader.registerModules({
    react: React,
    "react-dom": ReactDom,
    gatsby: Gatsby,
  });

  return loader;
}
