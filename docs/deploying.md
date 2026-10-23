# Deploying

The site is static: `bun run build` writes `dist/`, with the sequencer at its root and
the player at `/player/`, and an assets-only Cloudflare Worker named `dnbm` serves it
(`wrangler.jsonc`). The build renders the favicons (`favicon.svg`, `favicon.ico` and
`apple-touch-icon.png`, and `icon.svg` for links to the earlier favicon) into `dist/`
from `assets/brand/logo.svg` with `agent-tool images build favicons`; they are never
committed. `packages/sequencer/_headers` sets the security headers for both,
including a content security policy that allows WebAssembly compilation, the site's
own files and click collection at `https://ct.a2f0.net`.

Production builds initialize CT only on the exact `https://dnbm.a2f0.net` origin.
Development builds, previews, automated browsers and reusable mount APIs do not
initialize collection. The site is registered as `dnbm`, with apps `sequencer`
and `player`, and environment `production`; page values are fixed at `/` and
`/player`. See [click tracking](click-tracking.md) for data and opt-outs.

## Search and sharing

Each page's `<title>` and description live in its source (`packages/sequencer/index.html`
and `packages/player/index.html`). Every build adds the rest of each page's head from
`scripts/build/siteMetadata.ts`, naming the fixed `https://dnbm.a2f0.net` URLs rather
than the address a page is served from: a canonical link (`/` and `/player/`, the forms
the Worker serves without redirecting), Open Graph and Twitter tags, and `WebSite` and
`WebApplication` JSON-LD. The package's copies of the pages carry them too, so a host
that serves them, such as a2f0.net at `/dnbm/`, presents a duplicate that names the site
as canonical. Only the production build (`bun run build`) adds the site root's own files:
`og-image.png`, the share image the tags name, rendered from `assets/brand/logo.svg` by
the `social` image target in `agent-tool.json`; `robots.txt`; `sitemap.xml`, which
lists the canonical link of every page in the build; and `404.html`
(`packages/sequencer/404.html`). A page without a canonical link fails the build, so add
a new page to `SITE_PAGES`; only a page marked `noindex`, as the 404 page is, stays out
of the sitemap. Unknown paths answer 404 with that page (`not_found_handling` is
`404-page`), which links to the sequencer and the player; `/404` itself answers 200, and
its `noindex` keeps it out of search. `bun run dev` answers missing paths with the same
page, and `test/siteMetadata.test.ts` checks the production build's answers under
`wrangler dev`, the Workers runtime. There is no staging site.

The sequencer's page title names the open song once the app loads, as
"Undertow · Drum and Bass Sequencer · dnbm", so a crawler that runs the script still
reads what the page is.

## Deploy by hand

```sh
bunx wrangler login   # once
bun run deploy        # build, then wrangler deploy
```

## Deploy from CI

The `deploy` job in `.github/workflows/ci.yml` deploys every push to `main` once:
1. the repository has `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets, and
2. the repository variable `DNBM_DEPLOY` is `true`.

## Custom domain

Terraform in [a2f0/a2f0.net](https://github.com/a2f0/a2f0.net) owns the `a2f0.net`
zone and binds each Worker to its host. dnbm needs the same binding as the other apps
there, in `terraform/cloudflare.tf`:

```hcl
# Host for the dnbm drum and bass sequencer, deployed with Wrangler from a2f0/dnbm.
resource "cloudflare_workers_custom_domain" "dnbm" {
  account_id = var.cloudflare_account_id
  zone_id    = data.cloudflare_zone.resume.id
  hostname   = "dnbm.${var.domain}"
  service    = "dnbm"
}
```

Deploy the Worker first: the domain can only point at a Worker that exists.
