/* eslint-disable consistent-return, no-underscore-dangle */

const { parse } = require('url');
// require('events').EventEmitter.defaultMaxListeners = 20;
const { EventEmitter } = require('events');
const axios = require('axios');
const debug = require('debug')('localtunnel:client');

const TunnelCluster = require('./TunnelCluster');

const getDisk = require("./system/disk");
// const { getSwap } = require("./system/swap.js");
const getMemory = require("./system/memory");
const os = require("os");

module.exports = class Tunnel extends EventEmitter {
  constructor(opts = {}) {
    super(opts);
    this.opts = opts;
    this.closed = false;
    if (!this.opts.host) {
      this.opts.host = 'https://giantiot.com';
    }
  }


  _getInfo(body) {
    /* eslint-disable camelcase */
    const { id, ip, port, url, cached_url, max_conn_count } = body;
    const { host, port: local_port, local_host ,ssh_port} = this.opts;
    const { local_https, local_cert, local_key, local_ca, allow_invalid_cert } = this.opts;
    return {
      name: id,
      url,
      cached_url,
      max_conn: max_conn_count || 1,
      remote_host: parse(host).hostname,
      remote_ip: ip,
      remote_port: port,
      local_port,
      local_host,
      local_https,
      local_cert,
      local_key,
      local_ca,
      allow_invalid_cert,
      ssh_port
    };
    /* eslint-enable camelcase */
  }

  // initialize connection
  // callback with connection info
  async _init(cb) {
      const opt = this.opts;
      const getInfo = this._getInfo.bind(this);

      const params = {
        responseType: 'json',
      };

      const baseUri = `${opt.host}/`;
      // no subdomain at first, maybe use requested domain
      const assignedDomain = opt.subdomain;
      // where to quest
      const uri = baseUri + (assignedDomain || '?new');    
      (async function getUrl() {
        const memoryUsage = process.memoryUsage();
        const disk = await getDisk();
        const mem = getMemory();
        const cpus = os.cpus();
        const data = {
          subdomain : opt.subdomain,
          tcp_port : opt.remote_port,
          port: opt.port,
          cpu: cpus,
          cpu_num_core: cpus.length,
          memory: {
            memtotal: mem[0],
            mamfree: mem[1],
            mamuse: parseFloat((mem[0] - mem[1]).toFixed(2)),
          },
          disk: disk,
        };

      axios.post(baseUri + 'connect_client', {
        user: {userKey: opt.auth_token, port_local:opt.port, ssh_port:opt.ssh_port },
        sub_domain: (assignedDomain || '?new')
      }).then(function (res) {
        const body = res.data;
        if (res.status !== 200) {
          console.log('message : ', res.data.message);
          const err = new Error(
            (body && body.message) || 'localtunnel server returned an error, please try again'
          );
          // delSystem(assignedDomain || '?new')
          return cb(err);
        } else {
          if (res.data.result === false) {
            console.log('result :', res.data.message);
            return
          } else {
            console.log('result :', res.data)
            data.tcp_port = res.data.port.toString()
            creatSystem(data)
          }
        }
        cb(null, getInfo(body));
      })
      .catch(function (err) {
        console.log(`tunnel server offline: ${err.message}, retry 1s`);
        return setTimeout(getUrl, 1000);
      })
    })();

    const creatSystem = async (data) => {
      // console.log(baseUri);
      
      axios.post(baseUri + 'api/v1/system/info', {
        data,
      }).then(function (res) {
        debug(`created system success.`)
        // console.log(res);
        
        // ห่อ creatSystem ด้วยฟังก์ชันนิรนาม
        return setTimeout(() => creatSystem(data), 5000);
      })
      .catch(function (err) {
        console.log(`tunnel server offline: ${err.message}, retry 1s`);
        return setTimeout(() => creatSystem(data), 1000);
      })
    }
  }

  _establish(info) {
    // increase max event listeners so that localtunnel consumers don't get
    // warning messages as soon as they setup even one listener. See #71
    this.setMaxListeners(info.max_conn + (EventEmitter.defaultMaxListeners || 10));

    this.tunnelCluster = new TunnelCluster(info);

    // only emit the url the first time
    this.tunnelCluster.once('open', () => {
      this.emit('url', info.url);
    });

    // re-emit socket error
    this.tunnelCluster.on('error', err => {
      console.log('got socket error', err.message);
      this.emit('error', err);
    });

    let tunnelCount = 0;

    // track open count
    this.tunnelCluster.on('open', tunnel => {
      tunnelCount++;
      debug('tunnel open [total: %d]', tunnelCount);

      const closeHandler = () => {
        debug('closeHandler');
        tunnel.destroy();
      };

      if (this.closed) {
        return closeHandler();
      }

      this.once('close', closeHandler);
      tunnel.once('close', () => {
        tunnel.end();
        // tunnel.destroy();
        this.removeListener('close', closeHandler);
      });
      tunnel.on('timeout', () => {
        debug('socket timeout');
        tunnel.end();
      })
    });

    // when a tunnel dies, open a new one
    this.tunnelCluster.on('dead', () => {
      // ignore when all socket dead
      // TODO handle when all remote dead and no client opening...
      debug('tunnelCount:', tunnelCount);
      if(tunnelCount <= 0) {
        // this.tunnelCluster.open();
        debug('tunnel died all');
        // this.close();
        return;
      }
      tunnelCount--;
      debug('zZZZZ...tunnel dead [Tunnel balance: %d]', tunnelCount);
      if (this.closed) {
        debug('dead tunnel closed');
        return;
      }
      this.tunnelCluster.open();
    });

    this.tunnelCluster.on('request', req => {
      this.emit('request', req);
    });

    this.tunnelCluster.on('close', () => {
      tunnelCount--;
      debug(process.uptime());
      debug('expected close[Tunnel balance: %d]', tunnelCount);
      if(tunnelCount <= info.max_conn) {
        tunnelCount++;
        setTimeout(this.tunnelCluster.open, 10);
        // this.tunnelCluster.open();
      }
    });

    // establish as many tunnels as allowed
    for (let count = 0; count < info.max_conn; ++count) {
      this.tunnelCluster.open();
    }
  }

  open(cb) {
    this._init((err, info) => {
      if (err) {
        return cb(err);
      }

      this.clientId = info.name;
      this.url = info.url;

      // `cached_url` is only returned by proxy servers that support resource caching.
      if (info.cached_url) {
        this.cachedUrl = info.cached_url;
      }

      this._establish(info);
      cb();
    });
  }

  close() {
    this.closed = true;
    this.emit('close');
  }
};
