# Click tracking

The standalone sequencer and player use CT, operated by Tearleads, LLC and hosted
on Cloudflare. Only production builds on `https://dnbm.a2f0.net` initialize the
tracker. Local development, previews, automated browsers and imported mount APIs
do not collect clicks. Hosts that embed either app manage their own tracking.

Clicks are queued in memory and flushed to `https://ct.a2f0.net/v1/clicks`. Events
contain a random event ID, timestamp, element tag, site `dnbm`, app `sequencer` or
`player`, environment `production` and fixed page `/` or `/player`. They omit song
titles, text, form values, URLs, query strings, fragments and user identifiers.
Inputs, editable fields and elements marked `data-ct-ignore` are excluded.

The collector records the request IP and Cloudflare geolocation, including country,
region and city when available. Location is approximate, not GPS. Clicks are
retained for 90 days and viewable only through the authenticated CT admin dashboard
and data API. Registration is disabled; administrators are provisioned by CLI.

This site explicitly overrides Global Privacy Control. Do Not Track, the CT
browser extension and the site's saved CT opt-out still stop collection. To opt
out for this origin without the extension, set `ct:opt-out` to `1` in local storage
and reload. Removing that setting restores the default. CT stores no visitor
identity or analytics cookie.

The [CT documentation](https://github.com/a2f0/ct#readme) describes the client,
browser extension and collector.
