const { EventEmitter } = require('events');
const debug = require('debug')('localtunnel:cluster');
const debug_limit = require('debug')('localtunnel:limit');
const fs = require('fs');
const net = require('net');
const tls = require('tls');
const { Throttle } = require('stream-throttle');
const axios = require('axios');
const HeaderHostTransformer = require('./HeaderHostTransformer');

var platform = process.platform;
const setEnvironment = require("./config/setEnvironment");
const configYML = new setEnvironment(platform)

const getValueYml = configYML.getValueENV()

// ขีดจำกัดข้อมูล 1GB (1,073,741,824 bytes)
const LimitMem = 1024 * 1024 * 1024;
const MB_DIVISOR = 1024 * 1024; // แปลงจากไบต์เป็นเมกะไบต์

const token = process.env.TOKEN || getValueYml.agent.authtoken
const url = process.env.URL_SERVER || 'https://giantiot.com/'

module.exports = class TunnelCluster extends EventEmitter {
  constructor(opts = {}) {
    super(opts);
    this.opts = opts;
    this.totalDataUsed = 0;
    this.LimitMem = 0;
    this.result = {}
  }

  // ดึงค่า LimitMem และ MB_DIVISOR จาก API
  async fetchBandwidthSettings() {
    try {
      const response = await axios.get(`${url}api/v1/get/memmory/${token}`);
      this.LimitMem = response.data.results.limit_mem;
      this.totalDataUsed = response.data.results.usage_mem;
      this.result = response.data.results
    } catch (error) {
      debug_limit('Error fetching bandwidth settings:', error.message);
      this.LimitMem = 1024 * 1024 * 1024;
    }
  }

  async updateUsageSettings(usedMB) {
    try {
      const response = await axios.put(`${url}api/v1/get/memmory`,{userKey :token, usage_mem : this.totalDataUsed});
    } catch (error) {
      debug_limit('updateUsageSettings settings:', error.message);
    }
  }

  async open() {
    const opt = this.opts;
    if (opt === undefined) {
      return;
    }

    await this.fetchBandwidthSettings();
    
    const remoteHostOrIp = opt.remote_ip || opt.remote_host;
    const remotePort = opt.remote_port;
    const localHost = opt.local_host || 'localhost';
    const localPort = opt.local_port;
    const localProtocol = opt.local_https ? 'https' : 'http';
    const allowInvalidCert = opt.allow_invalid_cert;

    debug(
      'establishing tunnel %s://%s:%s <> %s:%s',
      localProtocol,
      localHost,
      localPort,
      remoteHostOrIp,
      remotePort
    );

    const remote = net.connect({
      host: remoteHostOrIp,
      port: remotePort,
    });

    remote.setKeepAlive(true);
    remote.setTimeout(60000);

    remote.on('error', err => {
      debug('got remote connection error', err.message);

      if (err.code === 'ECONNREFUSED') {
        this.emit(
          'error',
          new Error(
            `connection refused: ${remoteHostOrIp}:${remotePort} (check your firewall settings)`
          )
        );
      }

      remote.end();
    });

    const connLocal = () => {
      if (remote.destroyed) {
        debug('remote destroyed');
        this.emit('dead');
        return;
      }

      remote.pause();

      const getLocalCertOpts = () =>
        allowInvalidCert
          ? { rejectUnauthorized: false }
          : {
              cert: fs.readFileSync(opt.local_cert),
              key: fs.readFileSync(opt.local_key),
              ca: opt.local_ca ? [fs.readFileSync(opt.local_ca)] : undefined,
            };

      const local = opt.local_https
        ? tls.connect({ host: localHost, port: localPort, ...getLocalCertOpts() })
        : net.connect({ host: localHost, port: localPort, keepAlive: false });

      local.setTimeout(60000);

      const remoteClose = () => {
        debug('remote close');
        this.emit('dead');
        local.end();
      };

      remote.once('close', remoteClose);

      local.once('error', err => {
        debug('local error %s', err.message);
        local.end();
        remote.removeListener('close', remoteClose);

        if (err.code !== 'ECONNREFUSED' && err.code !== 'ECONNRESET') {
          return remote.end();
        }

        setTimeout(connLocal, 1000);
      });

      local.once('connect', () => {
        debug('connected locally');
        remote.resume();

        const throttleStream = new Throttle({ rate: 1024 * 1024 }); // จำกัดแบนด์วิดท์ที่ 1MB/s

        let stream = remote;

        if (opt.local_host) {
          stream = remote.pipe(new HeaderHostTransformer({ host: opt.local_host }));
        }

        const trackDataUsage = async (chunk) => {
          this.totalDataUsed += chunk.length; // นับจำนวนข้อมูลที่ถูกส่ง
          const usedMB = this.totalDataUsed / MB_DIVISOR; // แปลงจากไบต์เป็นเมกะไบต์ (MB)
          
          if(this.LimitMem != null) {
            if (this.totalDataUsed >= this.LimitMem) {
              console.log('Reached over limit : closing connection');
              local.end();
              remote.end();
              process.exit(1);
            } else {
              let show_limit_mem = LimitMem/ MB_DIVISOR;
              show_limit_mem = show_limit_mem.toFixed(3);
              this.printProgress("Data Usage: " + usedMB.toFixed(3) + " MB, Package Limit: " + show_limit_mem + " MB");
              await this.updateUsageSettings()
            }
          } else {
            // console.log("result_limit :",{limit : this.result.limit_mem, usage : this.totalDataUsed})
            // console.log(`Data used: ${usedMB.toFixed(2)} MB/ - GิB`);
            this.printProgress("Data Usage: " + usedMB.toFixed(3) + " MB, no package limit with Ultra crok promotion!");
            await this.updateUsageSettings()
          }
        };

        // ตรวจสอบข้อมูลที่ถูกส่งผ่านทั้ง remote และ local
        // stream.on('data', trackDataUsage);
        local.on('data', trackDataUsage);

        // จำกัดแบนด์วิดท์และเชื่อมต่อ stream
        stream.pipe(throttleStream).pipe(local).pipe(remote);

        local.once('close', hadError => {
          debug('local connection closed [error: %s]', hadError);
          this.emit('close');
        });
      });
    };

    remote.on('data', data => {
      // console.log("result_limit :",this.result)
      const match = data.toString().match(/^(\w+) (\S+)/);
      if (match) {
        this.emit('request', {
          method: match[1],
          path: match[2],
        });
      }
    });

    remote.once('connect', () => {
      this.emit('open', remote);
      connLocal();
    });
  }

  async printProgress(progress){
    try {
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(progress);
    } catch (e) {
      console.debug(progress);
    }
    
  }
};


