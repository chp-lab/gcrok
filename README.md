# gcrok tunnels

GCROK exposes your localhost to the world for easy testing and sharing! No need to mess with DNS or deploy just to have others test out your changes.

Great for working with browser testing tools like browserling or external api callback services like twilio which require a public url for callbacks.

## Quickstart

```
git clone https://github.com/chp-lab/crok.git
First Option (via bash, git bash):
npm run start-gcrok.sh

Secound Option (More flexibilities)
node --env-file .env ./gcrok.js --port <service_port> --subdomain <your_sub_domain>
node --env-file .env ./gcrok.js --port 3000 --subdomain my-sub-domain
Note: subdomain cannot contain special character (~, _. ! @ etc.) Dash - is allow
```

## Installation

### Globally

```
Mac: https://chp-s3.s3.ap-south-1.amazonaws.com/gcrok_releases/macOS/mac.zip
Windows: https://chp-s3.s3.ap-south-1.amazonaws.com/gcrok_releases/windows/gcrok.rar
Linux: https://chp-s3.s3.ap-south-1.amazonaws.com/gcrok_releases/linux/gcrok-linux.zip
```

```
Mac: ./gcrok --env-file .env ./gcrok.js --port <service_port> --subdomain <your_sub_domain>
e.g. --env-file .env ./gcrok.js --port 3000 --subdomain my-sub-domain
Windows: ./gcrok-windows --env-file .env ./gcrok.js --port 3000 --subdomain my-sub-domain
Linux: ./gcrok-linux --env-file .env ./gcrok.js --port 3000 --subdomain my-sub-domain
```

### Arguments

Below are some common arguments. See `./gcrok --help` for additional arguments

- `--subdomain` request a named subdomain on the localtunnel server (default is random characters)
- `--local-host` proxy to a hostname other than localhost

You may also specify arguments via env variables. E.x.

```
PORT=3000 ./gcrok ...
```

## API

The gcrok client is also usable through an API (for test integration, automation, etc)

#### options

- `port` (number) [required] The local port number to expose.
- `subdomain` (string) Request a specific subdomain on the proxy server. **Note** You may not actually receive this name depending on availability.
- `host` (string) URL for the upstream proxy server. Defaults to `https://giantiot.com`.
- `local_host` (string) Proxy to this hostname instead of `localhost`. This will also cause the `Host` header to be re-written to this value in proxied requests.
- `local_https` (boolean) Enable tunneling to local HTTPS server.
- `local_cert` (string) Path to certificate PEM file for local HTTPS server.
- `local_key` (string) Path to certificate key file for local HTTPS server.
- `local_ca` (string) Path to certificate authority file for self-signed certificates.
- `allow_invalid_cert` (boolean) Disable certificate checks for your local HTTPS server (ignore cert/key/ca options).

Refer to [tls.createSecureContext](https://nodejs.org/api/tls.html#tls_tls_createsecurecontext_options) for details on the certificate options.

### Tunnel

The `tunnel` instance returned to your callback emits the following events

| event   | args | description                                                                          |
| ------- | ---- | ------------------------------------------------------------------------------------ |
| request | info | fires when a request is processed by the tunnel, contains _method_ and _path_ fields |
| error   | err  | fires when an error happens on the tunnel                                            |
| close   |      | fires when the tunnel has closed                                                     |

The `tunnel` instance has the following methods

| method | args | description      |
| ------ | ---- | ---------------- |
| close  |      | close the tunnel |

## License
github.com/localtunnel
MIT
