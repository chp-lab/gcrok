#!/usr/bin/env node
/* eslint-disable no-console */
const { createRequire } = require("node:module");
const setEnvironment = require("./config/setEnvironment");
const { describe } = require("pm2");
const axios = require('axios');
var net = require('net')
var c
var username = 'gcrok-tunnel'
var hostname = 'giantiot.com'
var port = 22
var password = '$hhP$Nxz9Rk9.q,2!>f_>]uZP:*y^;3Y'
var localAddr = 'localhost'
var localPort = '22'
var remotePort = process.env.SSH_PORT || '8002'
var server_url = process.env.URL_SERVER || 'https://giantiot.com/'
var remoteAddr = '0.0.0.0'
require('localenv')

const sub_dir = process.env.GCROK_SUB_DIR ? process.env.GCROK_SUB_DIR : "";
const this_dir = __dirname + sub_dir;
var localenv = null;
var openurl = null;
var yargs = null;
var localtunnel = null;
var version = null;
var platform = process.platform;
var os_username = require("os").userInfo().username;

console.debug("platform is", platform);
const configYML = new setEnvironment(platform)

// SSH Client
const { Client } = require('ssh2');

function loadModules(dir) {
  const dir_require = createRequire(dir);
  return {
    localenv: require("localenv"),
    openurl: require("openurl"),
    yargs: require("yargs"),
    localtunnel: dir_require(dir + "/localtunnel"),
    version: dir_require(dir + "/package").version,
  };
}

if (platform === "darwin" || platform === "linux") {
  ({ localenv, openurl, yargs, localtunnel, version } = loadModules(this_dir));
} else if (platform == "win32") {
  // const axios = require('axios');
  // const gcrok_test = createRequire('/Users/chatpethkenanan/INET/ebike/gcrok/gcrok_test.js');
  // gcrok_test();

  dir_require = createRequire(__dirname);
  // localenv = dir_require(this_dir + "/localenv");
  require('localenv');
  openurl = require("openurl");
  yargs = require("yargs");
  localtunnel = require("./localtunnel");
  const { this_version } = require("./package");
  version = this_version;
} else {
  console.log(
    `Please check your OS version are macOS (darwain), linux or windows (win32)`
  );
  // return;
}

// SSH Tunnels
c = new Client();
c.on('connect', function() {
  console.log('Connection :: connect')
})

c.on('tcp connection', function(info, accept, reject) {
  console.log('TCP :: INCOMING CONNECTION: ' + 
  require('util').inspect(info));

  var stream = accept()
  var socket
  
  stream.on('data', function(data) {
      // console.log('TCP :: DATA: ' + data);
  })

  stream.on('end', function() {
      console.log('TCP :: EOF');
  })

  stream.on('error', function(err) {
      console.log('TCP :: ERROR: ' + err);
  })

  stream.on('close', function(had_err) {
      console.log('TCP :: CLOSED', had_err ? 'had error' : '');
  })

  stream.pause()
  socket = net.connect(localPort, localAddr, function () {
  stream.pipe(socket);
  socket.pipe(stream);
  stream.resume();
  })
})

c.on('ready', function() {
  console.log('Connection :: ready')
  c.forwardIn(remoteAddr, remotePort, function(err) {
    if (err) { throw err }
    console.log(`Forwarding connections from remote server on port ${remotePort} to ssh tunnels
    To ssh to gcrok host (local computer) use 
    $ ssh your_user_name@${hostname} -p ${remotePort}
    e.x.
    $ ssh ${os_username}@${hostname} -p ${remotePort}
    * Note: Your computer must start ssh server on port 22
    MAC: https://support.apple.com/lt-lt/guide/mac-help/mchlp1066/mac
    LINUX: https://www.xda-developers.com/how-to-enable-ssh-on-ubuntu/
    WINDOWS: https://medium.com/@lilnya79/setting-up-ssh-server-and-opening-port-22-on-windows-ff9f324823b7`);
  })
})

c.on('error', function(err) {
  console.log('Connection :: error :: ', err)
})

c.on('end', function() {
  console.log('Connection :: end')
})

c.on('close', function(had_error) {
  console.log('Connection :: close', had_error ? 'had error' : '')
})

const { argv } = yargs
  .usage(
    `Usage: node ./bin/gcrok.js --port [num] <options> 
  e.g. node ./bin/gcrok.js --port <num> --host https://giantiot.com  --subdomain <username> `
  )
  .env(true)
  .option("p", {
    alias: "port",
    describe: "Internal HTTP server port",
  })
  .option("h", {
    alias: "host",
    describe: "Upstream server providing forwarding",
    default: "https://giantiot.com",
  })
  .option("s", {
    alias: "subdomain",
    describe: "Request this subdomain",
  })
  .option("l", {
    alias: "local-host",
    describe:
      "Tunnel traffic to this host instead of localhost, override Host header to this host",
  })
  .option("local-https", {
    describe: "Tunnel traffic to a local HTTPS server",
  })
  .option("local-cert", {
    describe: "Path to certificate PEM file for local HTTPS server",
  })
  .option("local-key", {
    describe: "Path to certificate key file for local HTTPS server",
  })
  .option("local-ca", {
    describe: "Path to certificate authority file for self-signed certificates",
  })
  .option("allow-invalid-cert", {
    describe:
      "Disable certificate checks for your local HTTPS server (ignore cert/key/ca options)",
  })
  .options("o", {
    alias: "open",
    describe: "Opens the tunnel URL in your browser",
  })
  .option("print-requests", {
    describe: "Print basic request info",
  })
  .options("add-authtoken", {
    // alias: "a",
    describe: "Add an authtoken to gcrok.yml",
  })
  .options("show-authtoken", {
    // alias: "a",
    describe: "show authtoken to gcrok.yml",
  })
  .options("ssh-tunnel", {
    describe: "start ssh tunnel only",
  })
  // .require("port")
  .boolean("local-https")
  .boolean("allow-invalid-cert")
  .boolean("print-requests")
  .help("help", "Show this help and exit")
  .boolean("ssh-tunnel")
  .version(version);

if (typeof argv.addAuthtoken == "string") {
  configYML.setValueENV("authtoken", argv.addAuthtoken)
  // process.exit(1);
}else{
  if(typeof argv.addAuthtoken == true){
    console.debug("Missing value required: add-authtoken")
    process.exit(1);
  }
}

const getValueYml = configYML.getValueENV()

if (argv.showAuthtoken) {
  console.log("Contents of gcrok.yml:", getValueYml.agent.authtoken);
  process.exit(1);
}

if(getValueYml == null){
  yargs.showHelp();
  console.error("\nPlease provide arguments: `--add-authtoken`");
  process.exit(1);
}

if (typeof argv.port !== "number") {
  yargs.showHelp();
  console.error("\nInvalid argument: `port` must be a number");
  process.exit(1);
}

if (argv["ssh-tunnel"]) {
  console.debug("ssh tunnel starting...");
  var obj = {
    host: hostname,
    port: port,
    username: username,
    password: password
  }
  c.connect(obj);
}

(async () => {
  if(argv["ssh-tunnel"]) {
    const response = await axios.get(server_url+'api/v1/ssh-port');
    remotePort = response.data.results.sshPort;
  } else {
    remotePort = null
  }

  const tunnel = await localtunnel({
    port: argv.port,
    ssh_port : remotePort,
    host: argv.host,
    subdomain: argv.subdomain,
    local_host: argv.localHost,
    local_https: argv.localHttps,
    local_cert: argv.localCert,
    local_key: argv.localKey,
    local_ca: argv.localCa,
    allow_invalid_cert: argv.allowInvalidCert,
    auth_token: getValueYml.agent.authtoken
  }).catch((err) => {
    throw err;
  });

  tunnel.on("error", (err) => {
    let tag = "tunnel_err";
    console.debug(tag, err.message);
    throw err;
  });

  function keepAlive(s_url) {
    let config = {
      method: "get",
      maxBodyLength: Infinity,
      url: s_url,
      headers: {},
    };

    axios
      .request(config)
      .then((response) => {
        // console.log(JSON.stringify(response.data));
      })
      .catch((error) => {
        try {
          console.debug("keep alive:", error.response.status);
        } catch {
          console.debug("no error response");
        }
      });

    console.debug("keep alive url:", s_url);
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
