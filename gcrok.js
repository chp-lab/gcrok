#!/usr/bin/env node
/* eslint-disable no-console */

// const openurl = require('openurl');
// /Users/chatpethkenanan/INET/ebike/gcrok/node_modules/openurl/openurl.js
const { createRequire } = require("node:module");
const sub_dir = process.env.GCROK_SUB_DIR ? process.env.GCROK_SUB_DIR : "";
const this_dir = __dirname + sub_dir;
const axios = require('axios');

const platform = process.platform;

function loadModules(dir) {
  const dir_require = createRequire(dir);
  return {
    localenv: dir_require(dir + '/localenv'),
    openurl: dir_require(dir + '/openurl'),
    yargs: dir_require(dir + '/yargs'),
    localtunnel: dir_require(dir + '/localtunnel'),
    version: dir_require(dir + '/package').this_version,
  };
}

if (platform === 'darwin' || platform === 'linux') {
  ({ localenv, openurl, yargs, localtunnel, version } = loadModules(this_dir));
} else if (platform === 'win32') {
  openurl = require('openurl');
  yargs = require('yargs');
  localtunnel = require('./localtunnel');
  version = require('./package').this_version;
} else {
  console.log('Please define ARCH_BUILD in your environment variables.');
  return;
}

const { argv } = yargs
  .usage(
    `Usage: node ./bin/gcrok.js --port [num] <options> 
  e.g. node ./bin/gcrok.js --port <num> --host https://giantiot.com  --subdomain <username> `
  )
  .env(true)
  .options({
    'p': { alias: 'port', describe: 'Internal HTTP server port', demandOption: true },
    'h': { alias: 'host', describe: 'Upstream server', default: 'https://giantiot.com' },
    's': { alias: 'subdomain', describe: 'Request this subdomain' },
    'l': { alias: 'local-host', describe: 'Tunnel traffic to this host instead of localhost' },
    'local-https': { describe: 'Tunnel traffic to a local HTTPS server', type: 'boolean' },
    'local-cert': { describe: 'Path to certificate PEM file for local HTTPS server' },
    'local-key': { describe: 'Path to certificate key file for local HTTPS server' },
    'local-ca': { describe: 'Path to certificate authority file' },
    'allow-invalid-cert': { describe: 'Disable certificate checks', type: 'boolean' },
    'o': { alias: 'open', describe: 'Opens the tunnel URL in your browser' },
    'print-requests': { describe: 'Print basic request info', type: 'boolean' }
  })
  .require("port")
  .boolean("local-https")
  .boolean("allow-invalid-cert")
  .boolean("print-requests")
  .help("help", "Show this help and exit")
  .version(version);

if (typeof argv.port !== "number") {
  yargs.showHelp();
  console.error("\nInvalid argument: `port` must be a number");
  process.exit(1);
}

(async () => {
  const tunnel = await localtunnel({
    port: argv.port,
    host: argv.host,
    subdomain: argv.subdomain,
    local_host: argv.localHost,
    local_https: argv.localHttps,
    local_cert: argv.localCert,
    local_key: argv.localKey,
    local_ca: argv.localCa,
    allow_invalid_cert: argv.allowInvalidCert,
  }).catch(err => {
    console.error('Error creating tunnel:', err.message);
    process.exit(1);
  });

  tunnel.on("error", (err) => {
    let tag = "tunnel_err";
    console.debug(tag, err.message);
    throw err;
  });

  function keepAlive(url) {
    const config = {
      method: 'get',
      maxBodyLength: Infinity,
      url,
    };
  
    axios.request(config)
      .then(() => {
        console.debug('Keep-alive request successful');
      })
      .catch((error) => {
        const status = error.response ? error.response.status : 'No response';
        console.debug('Keep-alive error:', status);
      });
  
    console.debug('Keep-alive URL:', url);
  }
  
  // let nIntervId;
  // let this_url = tunnel.url;
  console.log("your url is: %s", tunnel.url);
  // if (!nIntervId) {
  //   nIntervId = setInterval(keepAlive, 15000, this_url);
  // }

  /**
   * `cachedUrl` is set when using a proxy server that support resource caching.
   * This URL generally remains available after the tunnel itself has closed.
   * @see https://github.com/localtunnel/localtunnel/pull/319#discussion_r319846289
   */
  if (tunnel.cachedUrl) {
    console.log("your cachedUrl is: %s", tunnel.cachedUrl);
  }

  if (argv.open) {
    openurl.open(tunnel.url);
  }

  if (argv["print-requests"]) {
    tunnel.on("request", (info) => {
      console.log(new Date().toString(), info.method, info.path);
    });
  }
})();
