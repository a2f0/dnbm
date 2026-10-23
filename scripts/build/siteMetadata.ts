// Search and sharing metadata for the standalone site at dnbm.a2f0.net, which only a
// production build adds. Each page keeps its title and description in its own source
// (packages/*/index.html); this adds what names the site's own addresses: a canonical
// link, Open Graph and Twitter tags pointing at the share image (og-image.png, from the
// "social" image target in agent-tool.json), JSON-LD, robots.txt, and a sitemap of the
// pages' canonical URLs. The package's copy of the pages is built without production, so
// a host serving them at its own address gets none of it.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export const SITE_URL = "https://dnbm.a2f0.net";
const SITE_NAME = "dnbm";

/** The share image the "social" image target renders into the build. */
export const SHARE_IMAGE = {
  path: "og-image.png",
  width: 1200,
  height: 630,
  alt: "The dnbm mark, a grid of grey steps on black",
};

interface SitePage {
  /** The built page, relative to the build directory. */
  readonly file: string;
  /** Its path on the site, as the Worker serves it without redirecting. */
  readonly path: string;
  /** The app it holds, for its JSON-LD. */
  readonly name: string;
}

export const SITE_PAGES: readonly SitePage[] = [
  { file: "index.html", path: "/", name: "dnbm" },
  { file: join("player", "index.html"), path: "/player/", name: "dnbm player" },
];

const WEBSITE = {
  "@type": "WebSite",
  "@id": `${SITE_URL}/#website`,
  name: SITE_NAME,
  url: `${SITE_URL}/`,
};

function attribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function unescapeAttribute(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

/** The page's own title and description, which its shared tags repeat. */
function readHead(html: string, file: string): { title: string; description: string } {
  const title = /<title>([^<]+)<\/title>/.exec(html)?.[1];
  const description = /<meta\s+name="description"\s+content="([^"]+)"/.exec(html)?.[1];
  if (!title || !description) throw new Error(`${file} needs a <title> and a description`);
  return { title: unescapeAttribute(title), description: unescapeAttribute(description) };
}

function jsonLd(page: SitePage, url: string, description: string): string {
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      WEBSITE,
      {
        "@type": "WebApplication",
        name: page.name,
        url,
        description,
        applicationCategory: "MultimediaApplication",
        operatingSystem: "Web",
        browserRequirements: "Requires JavaScript and WebAssembly.",
        isPartOf: { "@id": WEBSITE["@id"] },
      },
    ],
  };
  // "<" can't end the script element early when escaped; JSON reads it back the same.
  return JSON.stringify(data).replaceAll("<", "\\u003c");
}

function headTags(page: SitePage, title: string, description: string): string[] {
  const url = `${SITE_URL}${page.path}`;
  const meta = (key: "name" | "property", name: string, content: string | number) =>
    `<meta ${key}="${name}" content="${attribute(String(content))}" />`;
  return [
    `<link rel="canonical" href="${attribute(url)}" />`,
    meta("property", "og:type", "website"),
    meta("property", "og:site_name", SITE_NAME),
    meta("property", "og:title", title),
    meta("property", "og:description", description),
    meta("property", "og:url", url),
    meta("property", "og:image", `${SITE_URL}/${SHARE_IMAGE.path}`),
    meta("property", "og:image:width", SHARE_IMAGE.width),
    meta("property", "og:image:height", SHARE_IMAGE.height),
    meta("property", "og:image:alt", SHARE_IMAGE.alt),
    meta("name", "twitter:card", "summary_large_image"),
    `<script type="application/ld+json">${jsonLd(page, url, description)}</script>`,
  ];
}

async function htmlFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => join(entry.parentPath, entry.name));
}

function sitemap(urls: readonly string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((url) => `  <url><loc>${attribute(url)}</loc></url>`),
    "</urlset>",
    "",
  ].join("\n");
}

/**
 * Adds each page's canonical link, shared tags and JSON-LD after its title, then writes
 * robots.txt and a sitemap listing the canonical link of every page in the build, so the
 * two can't disagree. A page in the build without one fails it.
 */
export async function addSiteMetadata(directory: string): Promise<void> {
  for (const page of SITE_PAGES) {
    const file = join(directory, page.file);
    const html = await readFile(file, "utf8");
    const { title, description } = readHead(html, page.file);
    const marked = /\n([ \t]*)<title>[^<]*<\/title>\n/.exec(html);
    if (!marked) throw new Error(`${page.file} needs its <title> on a line of its own`);
    const indent = marked[1] ?? "";
    const tags = headTags(page, title, description).map((tag) => `${indent}${tag}\n`);
    const end = marked.index + marked[0].length;
    await writeFile(file, `${html.slice(0, end)}${tags.join("")}${html.slice(end)}`);
  }

  const urls: string[] = [];
  for (const file of (await htmlFiles(directory)).sort()) {
    const canonical = /<link rel="canonical" href="([^"]+)"/.exec(await readFile(file, "utf8"));
    const name = relative(directory, file).split(sep).join("/");
    if (!canonical?.[1]) throw new Error(`${name} has no canonical link: add it to SITE_PAGES`);
    urls.push(unescapeAttribute(canonical[1]));
  }
  await writeFile(
    join(directory, "robots.txt"),
    `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`,
  );
  await writeFile(join(directory, "sitemap.xml"), sitemap(urls));
}
