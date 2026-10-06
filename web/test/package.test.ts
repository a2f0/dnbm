// Packs @a2f0/dnbm exactly as npm publishes it and uses the tarball as a consumer
// would: no repository sources, only what the package ships.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildPackage } from "../../scripts/buildPackage";

const ROOT = join(import.meta.dir, "..", "..");

interface Packed {
  readonly filename: string;
  readonly files: readonly { readonly path: string }[];
}

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
  await buildPackage();
  temporary = await mkdtemp(join(tmpdir(), "dnbm-package-"));
  consumer = join(temporary, "consumer");
  installed = join(consumer, "node_modules", "@a2f0", "dnbm");
  await mkdir(installed, { recursive: true });
  const output = execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary],
    {
      cwd: ROOT,
      encoding: "utf8",
    },
  );
  [packed] = JSON.parse(output) as [Packed];
  execFileSync("tar", [
    "-xzf",
    join(temporary, packed.filename),
    "--strip-components=1",
    "-C",
    installed,
  ]);
  await writeFile(
    join(consumer, "package.json"),
    '{ "name": "dnbm-consumer", "type": "module" }\n',
  );
}, 120_000);

afterAll(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

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
      "lib/build.js",
      "lib/build.d.ts",
      "site/index.html",
      "site/main.js",
      "site/styles.css",
      "site/worklet.js",
      "site/renderWorker.js",
      "site/engine.wasm",
      "site/songs/index.json",
      "site/songs/undertow.dnbm.json",
      "site/song.schema.json",
      "docs/package.md",
    ]) {
      expect(files).toContain(file);
    }
    // Cloudflare reads _headers only at a deployment's root; in a host it would just be served.
    expect(files).not.toContain("site/_headers");

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
      `import { mountDnbm, type DnbmInstance, type DnbmOptions } from "@a2f0/dnbm";
import { copyDnbmAssets } from "@a2f0/dnbm/build";

export function mount(container: HTMLElement): DnbmInstance {
  const options: DnbmOptions = { assetsUrl: "/dnbm/", branding: false };
  return mountDnbm(container, options);
}
const copy: (destination: string | URL) => Promise<void> = copyDnbmAssets;
console.log(JSON.stringify({ dom: typeof document, mount: typeof mountDnbm, copy: typeof copy }));
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
    expect(JSON.parse(output)).toEqual({ dom: "undefined", mount: "function", copy: "function" });
    const tsc = join(ROOT, "node_modules", "typescript", "bin", "tsc");
    // tsc prints errors on stdout and exits non-zero, which throws here with them.
    execFileSync(process.execPath, [tsc, "-p", "tsconfig.json"], {
      cwd: consumer,
      encoding: "utf8",
    });
  }, 60_000);

  test("copies an app that serves from a nested path", async () => {
    const { copyDnbmAssets } = (await import(
      pathToFileURL(join(installed, "lib", "build.js")).href
    )) as {
      copyDnbmAssets: (destination: string) => Promise<void>;
    };
    const publicDirectory = join(temporary, "public");
    await copyDnbmAssets(join(publicDirectory, "apps", "dnbm"));
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
      const referenced = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(
        (match) => match[1] ?? "",
      );
      // What the page and its scripts load, relative to the page.
      for (const path of [...referenced, "worklet.js", "renderWorker.js", "songs/index.json"]) {
        expect([path, (await fetch(new URL(path, page))).status]).toEqual([path, 200]);
      }
      const wasm = new Uint8Array(await (await fetch(new URL("engine.wasm", page))).arrayBuffer());
      expect([...wasm.subarray(0, 4)]).toEqual([0x00, 0x61, 0x73, 0x6d]);
    } finally {
      await server.stop(true);
    }
  });

  test("mounts the app in a frame, and refuses assets it can't serve", async () => {
    const { mountDnbm } = (await import(
      pathToFileURL(join(installed, "lib", "index.js")).href
    )) as typeof import("../src/package/index");
    const appended: unknown[] = [];
    let removed = false;
    const frame = {
      title: "",
      src: "",
      allow: "",
      style: { cssText: "" },
      remove: () => {
        removed = true;
      },
    };
    const container = {
      ownerDocument: { baseURI: "https://example.com/apps/", createElement: () => frame },
      append: (node: unknown) => appended.push(node),
    } as unknown as HTMLElement;

    const app = mountDnbm(container, { assetsUrl: "../static/dnbm" });
    expect(appended).toEqual([frame]);
    expect(frame.src).toBe("https://example.com/static/dnbm/index.html?embed=1");
    expect(frame.allow).toBe("autoplay");
    expect(frame.title).toBe("dnbm drum and bass sequencer");
    app.destroy();
    expect(removed).toBe(true);

    mountDnbm(container, { assetsUrl: "/dnbm/", branding: true, title: "dnbm" });
    expect([frame.src, frame.title]).toEqual(["https://example.com/dnbm/index.html", "dnbm"]);
    expect(() => mountDnbm(container, { assetsUrl: "file:///dnbm/" })).toThrow("HTTP or HTTPS");
    expect(() => mountDnbm(container, { assetsUrl: "/dnbm/?v=1" })).toThrow("without a query");
  });
});
