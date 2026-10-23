// The standalone site's search and sharing metadata (scripts/build/siteMetadata.ts): a
// production build gives each page a canonical URL, shared tags and JSON-LD, renders the
// share image, lists the pages for crawlers, and adds the 404 page unknown paths get.
// test/package.test.ts checks that the package's pages name the same canonical URLs and
// leave out the site root's files.

import { beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWeb, DIST, NOT_FOUND_PAGE, ROOT } from "../scripts/build/build";
import { addCrawlerFiles, SHARE_IMAGE, SITE_PAGES, SITE_URL } from "../scripts/build/siteMetadata";

function content(html: string, key: "name" | "property", name: string): string[] {
  const pattern = new RegExp(`<meta\\s+${key}="${name}"\\s+content="([^"]*)"`, "g");
  return [...html.matchAll(pattern)].map((match) => match[1] ?? "");
}

describe("the production site's metadata", () => {
  const pages = new Map<string, string>();

  beforeAll(async () => {
    await buildWeb(true);
    for (const page of SITE_PAGES) {
      pages.set(page.path, await readFile(join(DIST, page.file), "utf8"));
    }
  }, 60_000);

  for (const page of SITE_PAGES) {
    test(`${page.path} names its canonical URL, shared tags and JSON-LD`, () => {
      const html = pages.get(page.path) ?? "";
      const url = `${SITE_URL}${page.path}`;
      const title = /<title>([^<]+)<\/title>/.exec(html)?.[1] ?? "";
      const [description = ""] = content(html, "name", "description");
      expect(title).toEndWith(" · dnbm");
      expect(title.length).toBeLessThanOrEqual(60);
      expect(description.length).toBeGreaterThanOrEqual(120);
      expect(description.length).toBeLessThanOrEqual(160);

      expect([...html.matchAll(/<link rel="canonical" href="([^"]+)"/g)].map((m) => m[1])).toEqual([
        url,
      ]);
      expect(content(html, "property", "og:url")).toEqual([url]);
      expect(content(html, "property", "og:title")).toEqual([title]);
      expect(content(html, "property", "og:description")).toEqual([description]);
      expect(content(html, "property", "og:site_name")).toEqual(["dnbm"]);
      expect(content(html, "property", "og:image")).toEqual([`${SITE_URL}/${SHARE_IMAGE.path}`]);
      expect(content(html, "property", "og:image:width")).toEqual([String(SHARE_IMAGE.width)]);
      expect(content(html, "property", "og:image:height")).toEqual([String(SHARE_IMAGE.height)]);
      expect(content(html, "property", "og:image:alt")).toEqual([SHARE_IMAGE.alt]);
      expect(content(html, "name", "twitter:card")).toEqual(["summary_large_image"]);
      // The production site is indexable: no robots meta tag at all.
      expect(content(html, "name", "robots")).toEqual([]);

      const scripts = [
        ...html.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g),
      ].map((match) => match[1] ?? "");
      expect(scripts).toHaveLength(1);
      const data = JSON.parse(scripts[0] ?? "") as {
        "@context": string;
        "@graph": { "@type": string; url: string; [key: string]: unknown }[];
      };
      expect(data["@context"]).toBe("https://schema.org");
      expect(data["@graph"].map((node) => node["@type"])).toEqual(["WebSite", "WebApplication"]);
      expect(data["@graph"][0]).toMatchObject({ name: "dnbm", url: `${SITE_URL}/` });
      expect(data["@graph"][1]).toMatchObject({
        name: page.name,
        url,
        description,
        operatingSystem: "Web",
      });
      expect(data["@graph"][1]).not.toHaveProperty("offers");
    });
  }

  test("robots.txt allows crawling and names the sitemap", async () => {
    expect(await readFile(join(DIST, "robots.txt"), "utf8")).toBe(
      `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`,
    );
  });

  test("the sitemap lists every page's canonical URL", async () => {
    const sitemap = await readFile(join(DIST, "sitemap.xml"), "utf8");
    expect(sitemap).toStartWith(
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    expect([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])).toEqual(
      SITE_PAGES.map((page) => `${SITE_URL}${page.path}`),
    );
  });

  test("the share image is an opaque PNG of the size the tags give", async () => {
    const png = new Uint8Array(await readFile(join(DIST, SHARE_IMAGE.path)));
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect([...png.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([
      SHARE_IMAGE.width,
      SHARE_IMAGE.height,
    ]);
    // Colour type 2 is RGB without alpha.
    expect(png[25]).toBe(2);
  });

  test("the headers keep every response indexable", async () => {
    expect(await readFile(join(DIST, "_headers"), "utf8")).not.toMatch(/x-robots-tag/i);
  });

  test("unknown paths get a noindexed 404 page that links to the site's pages", async () => {
    // Cloudflare answers a path it has no file for with the 404 page and status 404.
    expect(await readFile(join(ROOT, "wrangler.jsonc"), "utf8")).toMatch(
      /"not_found_handling":\s*"404-page"/,
    );
    const html = await readFile(join(DIST, NOT_FOUND_PAGE), "utf8");
    expect(/<title>([^<]+)<\/title>/.exec(html)?.[1]).toEndWith(" · dnbm");
    expect(content(html, "name", "robots")).toEqual(["noindex"]);
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain("og:url");
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    // It answers at every depth, so its URLs start at the root: its links are the pages'
    // canonical paths, and everything it loads is in the build.
    const links = [...html.matchAll(/<a href="([^"]+)"/g)].map((match) => match[1]);
    expect(links).toEqual(SITE_PAGES.map((page) => page.path));
    const loads = [...html.matchAll(/<link [^>]*href="([^"]+)"/g)].map((match) => match[1] ?? "");
    expect(loads.length).toBeGreaterThan(0);
    for (const path of loads) {
      expect(path).toStartWith("/");
      expect(await Bun.file(join(DIST, path)).exists()).toBe(true);
    }
  });
});

describe("the sitemap", () => {
  test("leaves out noindexed pages, and fails on another page without a canonical link", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dnbm-sitemap-"));
    try {
      await writeFile(
        join(directory, "index.html"),
        `<link rel="canonical" href="${SITE_URL}/" />`,
      );
      await writeFile(
        join(directory, "404.html"),
        '<meta name="robots" content="noindex" /><title>Page Not Found · dnbm</title>',
      );
      await addCrawlerFiles(directory);
      const sitemap = await readFile(join(directory, "sitemap.xml"), "utf8");
      expect([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])).toEqual([
        `${SITE_URL}/`,
      ]);

      await mkdir(join(directory, "extra"));
      await writeFile(join(directory, "extra", "index.html"), "<title>Extra · dnbm</title>");
      await expect(addCrawlerFiles(directory)).rejects.toThrow(
        "extra/index.html has no canonical link",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
