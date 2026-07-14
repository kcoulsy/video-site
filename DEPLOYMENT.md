# Coolify And Cloudflare Deployment

This runbook deploys Watchbox as a Coolify Service Stack behind Cloudflare.

## Recommended Domains

Use one level of subdomain per public service:

```text
Web: https://videos.example.com
API: https://api-videos.example.com
```

Do not use `api.videos.example.com` with Cloudflare Universal SSL. Universal SSL
normally covers the zone apex and one wildcard level, such as `*.example.com`.
It does not cover a second-level hostname such as `api.videos.example.com`.

## Prerequisites

- A Coolify server with its proxy installed and ports 80 and 443 open.
- A Cloudflare DNS zone for your domain.
- This repository available to Coolify.
- Long random values for the PostgreSQL, Redis, and auth secrets.

## Configure Cloudflare

Create these DNS records in your DNS zone. Replace `<VPS_IP>` with the
public IPv4 address of the Coolify server.

| Type | Name | Target | Proxy |
| --- | --- | --- | --- |
| A | `videos` | `<VPS_IP>` | Proxied |
| A | `api-videos` | `<VPS_IP>` | Proxied |

In **SSL/TLS -> Overview**, set encryption mode to **Full (strict)**. This
requires Coolify to present a valid certificate at the origin.

Cloudflare SSL/TLS mode is zone-wide; it cannot be enabled for only selected
hostnames. However, the DNS records above are the only hostnames routed to this
VPS, and Coolify will request certificates only for domains assigned to its
services.

## Create The Coolify Stack

1. Create a **Service Stack** from this repository.
2. Select `docker-compose.coolify.yml` as the Compose file.
3. Set the following environment variables in Coolify:

```text
VITE_WEB_URL=https://videos.example.com
VITE_SERVER_URL=https://api-videos.example.com
VITE_APP_NAME=Watchbox

POSTGRES_USER=watchbox
POSTGRES_DB=watchbox
POSTGRES_PASSWORD=<long-random-password-without-URL-reserved-characters>
REDIS_PASSWORD=<long-random-password-without-URL-reserved-characters>
BETTER_AUTH_SECRET=<output-of-openssl-rand-base64-48>
AUTH_COOKIE_DOMAIN=.example.com

CONCURRENCY=1
DELETE_RAW_AFTER_TRANSCODE=false
```

Generate the auth secret with:

```sh
openssl rand -base64 48
```

4. In Coolify, assign these service domains:

```text
web: https://videos.example.com:3001
server: https://api-videos.example.com:3000
```

5. Deploy the stack. The `migrate` container applies database migrations before
the API and worker start.

`VITE_WEB_URL` and `VITE_SERVER_URL` are build arguments. Redeploy after
changing either value; changing only the Coolify runtime environment does not
update the already-built browser application.

`AUTH_COOKIE_DOMAIN` lets the web service receive the API authentication cookie
during server-side route loads. Set it to the shared parent domain, prefixed by
a dot, when the API and web use different subdomains.

## TLS Options

### Cloudflare Proxied Records

Use the orange-cloud setting for Cloudflare DDoS protection, caching, and IP
masking. Keep SSL/TLS in **Full (strict)**. Coolify must serve a valid origin
certificate for both public names.

If Coolify cannot initially obtain a Let's Encrypt certificate, temporarily set
the affected DNS record to **DNS only**, deploy until the certificate is issued,
then re-enable the proxy.

### Coolify Certificates Only

Set the records to **DNS only** (grey cloud) and let Coolify/Let's Encrypt serve
the certificates directly. This issues certificates only for the configured
service names, but removes Cloudflare proxy, cache, and DDoS protection.

### Nested Subdomains

To keep `api.videos.example.com` proxied through Cloudflare, obtain a custom
certificate that explicitly includes that hostname, such as Cloudflare Advanced
Certificate Manager. This is not needed when using `api-videos.example.com`.

## Verification

After deployment, verify both endpoints:

```sh
curl --fail --verbose https://videos.example.com
curl --fail --verbose https://api-videos.example.com
```

Then create an account and verify the browser sends authentication requests to:

```text
https://api-videos.example.com/api/auth/sign-up/email
```

## Common Failures

### `ERR_SSL_VERSION_OR_CIPHER_MISMATCH`

This occurs before the request reaches the application. For this deployment, it
usually means Cloudflare has no edge certificate for the requested hostname.

- Replace `api.videos.example.com` with `api-videos.example.com`, then update the
  Coolify server domain and `VITE_SERVER_URL` and redeploy.
- Or add a custom certificate covering the nested hostname.
- Confirm the DNS record targets the Coolify VPS and is not a stale address.

### Cloudflare Error 525 Or 526

Cloudflare can reach the origin but cannot complete or validate TLS.

- Confirm the Coolify proxy has a certificate for the exact hostname.
- Confirm inbound ports 80 and 443 reach the Coolify VPS.
- Use **Full (strict)** only after the origin certificate is valid.
- Temporarily use DNS-only mode to isolate Cloudflare from an origin TLS issue.

### Browser Requests The Old API Host

The web bundle still contains an earlier `VITE_SERVER_URL`. Update the variable
in Coolify and redeploy the stack. Clear any CDN cache after the deployment if
Cloudflare is proxying the web domain.

### CORS Or Trusted-Origin Errors

Keep these values aligned:

```text
VITE_WEB_URL=https://videos.example.com
VITE_SERVER_URL=https://api-videos.example.com
```

The Compose file supplies `VITE_WEB_URL` as `CORS_ORIGIN` and
`VITE_SERVER_URL` as `BETTER_AUTH_URL` to the API and worker.

## Operations

- Do not expose PostgreSQL, Redis, the worker, or the migration container.
- Back up both `postgres-data` and `media-data`; the latter contains uploads,
  streams, thumbnails, avatars, and resumable upload state.
- Keep the API and worker at one replica while using the local `media-data`
  volume. Multiple replicas require shared/object storage.
- Start with `CONCURRENCY=1` on a single VPS because FFmpeg transcodes are
  CPU-intensive. Increase it only after monitoring CPU, RAM, disk I/O, and API
  response time.
