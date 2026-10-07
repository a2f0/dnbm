// The site's own page mounts the editor the way a host does, through the same shell
// (src/shell.ts) and app module, from the assets beside this script. `?embed` shows it
// as a host would, without the wordmark.

import { mountApp, SEQUENCER } from "../../../src/shell";

const container = document.getElementById("app");
if (container) {
  mountApp(container, {
    ...SEQUENCER,
    assetsUrl: new URL("./", import.meta.url),
    embed: new URLSearchParams(location.search).has("embed"),
    onTitle: (title) => {
      document.title = title;
    },
  });
}
