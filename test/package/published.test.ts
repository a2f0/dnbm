// Packs @a2f0/dnbm exactly as npm publishes it and uses the tarball as a consumer
// would: no repository sources, only what the package ships. The suites in this
// directory share the packed package and one Chrome (support.ts).

import { beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { copyAssets, type Packed, packedPackage, ROOT, SETUP_TIMEOUT } from "./support";

interface Metadata {
  readonly name: string;
  readonly private?: boolean;
  readonly license: string;
  readonly publishConfig?: { readonly access?: string };
  readonly scripts: Record<string, string>;
  readonly exports: Record<string, unknown>;
}

let temporary = "";
let consumer = "";
let installed = "";
let packed: Packed;

beforeAll(async () => {
  ({ temporary, consumer, installed, packed } = await packedPackage());
}, SETUP_TIMEOUT);

describe("the published package", () => {
  test("ships the app and declarations, and nothing from the repository besides docs", async () => {
    const files = packed.files.map((file) => file.path);
    expect(
      files.filter(
        (file) =>
          !/^(lib\/|site\/|docs\/(package|song-format)\.md$|README\.md$|package\.json$)/.test(file),
      ),
    ).toEqual([]);
    for (const file of [
      "lib/index.js",
      "lib/index.d.ts",
      "lib/shell.js",
      "lib/shell.d.ts",
      "lib/control.js",
      "lib/control.d.ts",
      "lib/build.js",
      "lib/build.d.ts",
      "site/index.html",
      "site/page.css",
      "site/favicon.svg",
      "site/favicon.ico",
      "site/apple-touch-icon.png",
      // The favicon before 0.4.8, kept in the asset layout for hosts that link it.
      "site/icon.svg",
      "site/main.js",
      "site/mount.js",
      "site/styles.css",
      "site/worklet.js",
      "site/renderWorker.js",
      "site/engine.wasm",
      "site/songs/index.json",
      "site/songs/undertow.dnbm.json",
      "site/song.schema.json",
      "site/player/index.html",
      "site/player/main.js",
      "site/player/mount.js",
      "site/player/styles.css",
      "docs/package.md",
    ]) {
      expect(files).toContain(file);
    }
    // Cloudflare reads _headers only at a deployment's root; in a host it would just be served.
    expect(files).not.toContain("site/_headers");
    // A host's copy of the pages names the site as their canonical URL, so search engines
    // count it a duplicate of dnbm.a2f0.net. The site root's own files stay out: a host
    // has its own robots.txt, sitemap and 404 handling, and the tags name the site's
    // share image.
    for (const file of [
      "site/robots.txt",
      "site/sitemap.xml",
      "site/og-image.png",
      "site/404.html",
    ]) {
      expect(files).not.toContain(file);
    }
    for (const [page, url] of [
      ["index.html", "https://dnbm.a2f0.net/"],
      ["player/index.html", "https://dnbm.a2f0.net/player/"],
    ] as const) {
      const html = await readFile(join(installed, "site", page), "utf8");
      expect(html).toContain(`<link rel="canonical" href="${url}" />`);
      expect(html).toContain(`<meta property="og:url" content="${url}" />`);
    }

    const metadata = JSON.parse(
      await readFile(join(installed, "package.json"), "utf8"),
    ) as Metadata;
    expect(metadata.name).toBe("@a2f0/dnbm");
    expect(metadata.private).toBeUndefined();
    expect(metadata.license).toBe("UNLICENSED");
    // npm publishes a scoped package as restricted unless told otherwise.
    expect(metadata.publishConfig?.access).toBe("public");
    expect(metadata.scripts["postinstall"]).toBeUndefined();
    expect(metadata.scripts["prepare"]).toBeUndefined();
    expect(Object.keys(metadata.exports)).toEqual([".", "./build", "./assets/*", "./package.json"]);
  });

  test("imports without a DOM, and type-checks in a strict consumer through its exports", async () => {
    await writeFile(
      join(consumer, "entry.ts"),
      `import {
  mountDnbm,
  mountDnbmPlayer,
  type DnbmControls,
  type DnbmInstance,
  type DnbmOptions,
  type DnbmPlayerCommand,
  type DnbmPlayerInstance,
  type DnbmPlayerOptions,
  type DnbmPlayerState,
  type DnbmSequencerCommand,
  type DnbmSequencerInstance,
  type DnbmSequencerState,
} from "@a2f0/dnbm";
import { copyDnbmAssets } from "@a2f0/dnbm/build";

export function mount(container: HTMLElement): DnbmInstance {
  const options: DnbmOptions = { assetsUrl: "/dnbm/", branding: false, title: "dnbm" };
  const instance = mountDnbm(container, options);
  const element: HTMLElement = instance.element;
  const ready: Promise<void> = instance.ready;
  void ready.then(() => element.shadowRoot?.querySelector(".cell"));
  return instance;
}
export function mountPlayer(container: HTMLElement): DnbmInstance {
  const options: DnbmPlayerOptions = {
    assetsUrl: "/dnbm/",
    songs: ["/dnbm/songs/undertow.dnbm.json", new URL("https://example.com/a.dnbm.json")],
  };
  return mountDnbmPlayer(container, options);
}
// A host's chrome, built from the instances' commands and state alone.
export function chrome(container: HTMLElement): () => void {
  const sequencer: DnbmSequencerInstance = mountDnbm(container, {
    assetsUrl: "/dnbm/",
    actions: false,
  });
  const player: DnbmPlayerInstance = mountDnbmPlayer(container, {
    assetsUrl: "/dnbm/",
    actions: false,
  });
  const controls: DnbmControls<DnbmSequencerCommand, DnbmSequencerState> = sequencer;
  const save: DnbmSequencerCommand = "saveAs";
  const ran: boolean = controls.run(save);
  const state: DnbmSequencerState = sequencer.state;
  const label = \`\${state.dirty ? "● " : ""}\${state.title} (\${state.fileName}) \${ran}\`;
  const canSave: boolean = state.available.save && !state.playing;
  const next: DnbmPlayerCommand = "next";
  player.run(next);
  // @ts-expect-error The player has no save.
  player.run("save");
  // @ts-expect-error The sequencer has no next.
  sequencer.run("next");
  const subscribe = player.subscribe;
  const unsubscribe: () => void = subscribe((now: DnbmPlayerState) => {
    void [now.playing, now.paused, now.title, now.shuffle, now.repeat, now.available.togglePlay];
  });
  void [label, canSave];
  return () => {
    unsubscribe();
    sequencer.destroy();
    player.destroy();
  };
}
const copy: (destination: string | URL) => Promise<void> = copyDnbmAssets;
console.log(
  JSON.stringify({
    dom: typeof document,
    mount: typeof mountDnbm,
    player: typeof mountDnbmPlayer,
    copy: typeof copy,
  }),
);
`,
    );
    await writeFile(
      join(consumer, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          exactOptionalPropertyTypes: true,
          noEmit: true,
          module: "nodenext",
          moduleResolution: "nodenext",
          target: "es2023",
          lib: ["es2023", "dom"],
          types: [],
        },
        include: ["entry.ts"],
      }),
    );
    const output = execFileSync("bun", ["entry.ts"], { cwd: consumer, encoding: "utf8" });
    expect(JSON.parse(output)).toEqual({
      dom: "undefined",
      mount: "function",
      player: "function",
      copy: "function",
    });
    const tsc = join(ROOT, "node_modules", "typescript", "bin", "tsc");
    // tsc prints errors on stdout and exits non-zero, which throws here with them.
    execFileSync(process.execPath, [tsc, "-p", "tsconfig.json"], {
      cwd: consumer,
      encoding: "utf8",
    });
  }, 60_000);

  test("leaves the app module's import to the browser when a host bundles it", async () => {
    // The app's code is served with the assets; a host's bundler must not try to bundle
    // it. webpack, Turbopack and Vite read these comments; Bun leaves the import alone.
    const shell = await readFile(join(installed, "lib", "shell.js"), "utf8");
    expect(shell).toContain(
      "import(/* webpackIgnore: true */ /* @vite-ignore */ /* turbopackIgnore: true */ url)",
    );
    const bundled = await Bun.build({
      entrypoints: [join(installed, "lib", "index.js")],
      target: "browser",
      format: "esm",
    });
    expect(bundled.success).toBe(true);
    const [output] = bundled.outputs;
    expect(await output?.text()).toContain("return import(url);");
  });

  test("copies an app that serves from a nested path", async () => {
    const publicDirectory = join(temporary, "public");
    await copyAssets(join(publicDirectory, "apps", "dnbm"));
    const server = Bun.serve({
      port: 0,
      fetch: (request) => {
        const path = new URL(request.url).pathname;
        const file = Bun.file(
          join(publicDirectory, path.endsWith("/") ? `${path}index.html` : path),
        );
        return file.size > 0 ? new Response(file) : new Response("Not found", { status: 404 });
      },
    });
    try {
      const page = new URL("/apps/dnbm/", server.url);
      const html = await (await fetch(page)).text();
      // What the page loads from beside it; its canonical link names the site, wherever
      // the copy is served.
      const relativeReferences = (text: string) =>
        [...text.matchAll(/(?:src|href)="([^"]+)"/g)]
          .map((match) => match[1] ?? "")
          .filter((reference) => !/^[a-z][a-z0-9+.-]*:/i.test(reference));
      const referenced = relativeReferences(html);
      expect(html).toContain('<link rel="canonical" href="https://dnbm.a2f0.net/" />');
      const favicons = ["favicon.ico", "favicon.svg", "apple-touch-icon.png"];
      expect(referenced).toEqual(
        expect.arrayContaining(["page.css", "mount.js", "styles.css", "main.js", ...favicons]),
      );
      // What the page, its app module and the shell load, relative to the assets.
      for (const path of [...referenced, "worklet.js", "renderWorker.js", "songs/index.json"]) {
        expect([path, (await fetch(new URL(path, page))).status]).toEqual([path, 200]);
      }
      const wasm = new Uint8Array(await (await fetch(new URL("engine.wasm", page))).arrayBuffer());
      expect([...wasm.subarray(0, 4)]).toEqual([0x00, 0x61, 0x73, 0x6d]);

      // The player, one directory down, loads the same engine and songs.
      const player = new URL("player/", page);
      const playerHtml = await (await fetch(player)).text();
      const playerReferenced = relativeReferences(playerHtml);
      expect(playerHtml).toContain('<link rel="canonical" href="https://dnbm.a2f0.net/player/" />');
      // Both pages share the favicons at the assets' root, so a nested copy serves them too.
      expect(playerReferenced).toEqual(
        expect.arrayContaining(favicons.map((favicon) => `../${favicon}`)),
      );
      for (const path of [
        ...playerReferenced,
        "../engine.wasm",
        "../worklet.js",
        "../songs/index.json",
      ]) {
        expect([path, (await fetch(new URL(path, player))).status]).toEqual([path, 200]);
      }
    } finally {
      await server.stop(true);
    }
  });

  test("refuses assets it can't serve before touching the page", async () => {
    const { mountDnbm, mountDnbmPlayer } = (await import(
      pathToFileURL(join(installed, "lib", "index.js")).href
    )) as typeof import("../../src/index");
    const container = {
      ownerDocument: {
        baseURI: "https://example.com/apps/",
        createElement: () => {
          throw new Error("touched the page");
        },
      },
    } as unknown as HTMLElement;
    expect(() => mountDnbm(container, { assetsUrl: "file:///dnbm/" })).toThrow("HTTP or HTTPS");
    expect(() => mountDnbm(container, { assetsUrl: "/dnbm/?v=1" })).toThrow("without a query");
    expect(() => mountDnbmPlayer(container, { assetsUrl: "file:///dnbm/" })).toThrow(
      "HTTP or HTTPS",
    );
    expect(() => mountDnbmPlayer(container, { assetsUrl: "/dnbm/#top" })).toThrow(
      "without a query",
    );
  });
});
