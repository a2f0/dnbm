# Deploying

The site is static: `bun run build` writes `dist/`, and an assets-only Cloudflare
Worker named `dnbm` serves it (`wrangler.jsonc`). `web/_headers` sets the security
headers, including a content security policy that allows WebAssembly compilation and
nothing else beyond the site's own files.

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
