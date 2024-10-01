#!/usr/bin/env node
/* eslint-disable no-console */

// const openurl = require('openurl');
// /Users/chatpethkenanan/INET/ebike/gcrok/node_modules/openurl/openurl.js
const { createRequire } = require('node:module');
const sub_dir = process.env.GCROK_SUB_DIR ? process.env.GCROK_SUB_DIR : '';
const this_dir = __dirname + sub_dir;
var localenv = null;
var openurl = null;
var yargs = null;
var localtunnel = null;
var version = null;
var platform = process.platform;

console.debug("platform is", platform);
if(platform == 'darwin') {
  // mac only
  require = createRequire(__filename);
  dir_require = createRequire(__dirname);

  // shared libs
  localenv = dir_require(this_dir + '/localenv');
  openurl = dir_require(this_dir + '/openurl');
  yargs = dir_require(this_dir + '/yargs');
  localtunnel = dir_require(this_dir + '/localtunnel');
  const { this_version } = dir_require(this_dir + '/package');
  version = this_version;

} else if(platform == 'LINUX') {
  // mac only
  require = createRequire(__filename);
  dir_require = createRequire(__dirname);

  // shared libs
  localenv = dir_require(this_dir + '/localenv');
  openurl = dir_require(this_dir + '/openurl');
  yargs = dir_require(this_dir + '/yargs');
  localtunnel = dir_require(this_dir + '/localtunnel');
  const { this_version } = dir_require(this_dir + '/package');
  version = this_version;

} else if(process.env.ARCH_BUILD == 'WINDOWS') {
// const axios = require('axios');
// const gcrok_test = createRequire('/Users/chatpethkenanan/INET/ebike/gcrok/gcrok_test.js');
// gcrok_test();

  openurl = require('openurl');
  yargs = require('yargs');
  localtunnel = require('./localtunnel');
  const { this_version } = require('./package');
  version = this_version;
} else {
  console.log(`Please check your OS version are macOS (darwain), linux or windows (win32)`);
  return;
}

const { argv } = yargs
  .usage(`Usage: node ./bin/gcrok.js --port [num] <options> 
  e.g. node ./bin/gcrok.js --port <num> --host https://giantiot.com  --subdomain <username> `)
  .env(true)
  .option('p', {
    alias: 'port',
    describe: 'Internal HTTP server port',
  })
  .option('h', {
    alias: 'host',
    describe: 'Upstream server providing forwarding',
    default: 'https://giantiot.com',
  })
  .option('s', {
    alias: 'subdomain',
    describe: 'Request this subdomain',
  })
  .option('l', {
    alias: 'local-host',
    describe: 'Tunnel traffic to this host instead of localhost, override Host header to this host',
  })
  .option('local-https', {
    describe: 'Tunnel traffic to a local HTTPS server',
  })
  .option('local-cert', {
    describe: 'Path to certificate PEM file for local HTTPS server',
  })
  .option('local-key', {
    describe: 'Path to certificate key file for local HTTPS server',
  })
  .option('local-ca', {
    describe: 'Path to certificate authority file for self-signed certificates',
  })
  .option('allow-invalid-cert', {
    describe: 'Disable certificate checks for your local HTTPS server (ignore cert/key/ca options)',
  })
  .options('o', {
    alias: 'open',
    describe: 'Opens the tunnel URL in your browser',
  })
  .option('print-requests', {
    describe: 'Print basic request info',
  })
  .require('port')
  .boolean('local-https')
  .boolean('allow-invalid-cert')
  .boolean('print-requests')
  .help('help', 'Show this help and exit')
  .version(version);

if (typeof argv.port !== 'number') {
  yargs.showHelp();
  console.error('\nInvalid argument: `port` must be a number');
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
    throw err;
  });

  tunnel.on('error', err => {
    let tag = "tunnel_err"
    console.debug(tag, err.message)
    throw err;
  });

  function keepAlive(s_url) {
    let config = {
      method: 'get',
      maxBodyLength: Infinity,
      url: s_url,
      headers: { }
    };
    
    axios.request(config)
    .then((response) => {
      // console.log(JSON.stringify(response.data));
    })
    .catch((error) => {
      try {
        console.debug('keep alive:', error.response.status);
      } catch {
        console.debug('no error response');
      }
    });

    console.debug("keep alive url:", s_url);
  }

  // let nIntervId;
  // let this_url = tunnel.url;
  console.log('your url is: %s', tunnel.url);
  // if (!nIntervId) {
  //   nIntervId = setInterval(keepAlive, 15000, this_url);
  // }

  /**
   * `cachedUrl` is set when using a proxy server that support resource caching.
   * This URL generally remains available after the tunnel itself has closed.
   * @see https://github.com/localtunnel/localtunnel/pull/319#discussion_r319846289
   */
  if (tunnel.cachedUrl) {
    console.log('your cachedUrl is: %s', tunnel.cachedUrl);
  }

  if (argv.open) {
    openurl.open(tunnel.url);
  }

  if (argv['print-requests']) {
    tunnel.on('request', info => {
      console.log(new Date().toString(), info.method, info.path);
    });
  }
})();
