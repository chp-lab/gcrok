# gcrok tunnels

GCROK exposes your localhost to the world for easy testing and sharing! No need to mess with DNS or deploy just to have others test out your changes.

Great for working with browser testing tools like browserling or external api callback services like twilio which require a public url for callbacks.

## Quickstart

```
git clone https://github.com/chp-lab/crok.git
node ./gcrok.js --port 1880 --host https://giantiot.com
```

## Installation

### Globally

```
Mac: https://chp-s3.s3.ap-south-1.amazonaws.com/gcrok_releases/macOS/mac.zip
Windows: https://chp-s3.s3.ap-south-1.amazonaws.com/gcrok_releases/windows/gcrok.rar
Linux: https://chp-s3.s3.ap-south-1.amazonaws.com/gcrok_releases/linux/gcrok-linux.zip
```

### As a dependency in your project

```
-
```

## CLI usage

When localtunnel is installed globally, just use the `lt` command to start the tunnel.

```
Mac: ./gcrok --port <port_num> --host https://giantiot.com 
e.g. ./gcrok --port 1880 --host https://giantiot.com
Windows: ./gcrok-windows ...
Linux: ./gcrok-linux ....
```

Thats it! It will connect to the tunnel server, setup the tunnel, and tell you what url to use for your testing. This url will remain active for the duration of your session; so feel free to share it with others for happy fun time!

### Arguments

Below are some common arguments. See `./gcrok --help` for additional arguments

- `--subdomain` request a named subdomain on the localtunnel server (default is random characters)
- `--local-host` proxy to a hostname other than localhost

You may also specify arguments via env variables. E.x.

```
PORT=3000 ./gcrok
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
