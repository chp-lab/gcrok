const { EventEmitter } = require('events');
const debug = require('debug')('localtunnel:cluster');
const fs = require('fs');
const net = require('net');
const tls = require('tls');

const HeaderHostTransformer = require('./HeaderHostTransformer');

// manages groups of tunnels
module.exports = class TunnelCluster extends EventEmitter {
  constructor(opts = {}) {
    super(opts);
    this.opts = opts;
  }

  open() {
    const opt = this.opts;
    if(opt === undefined) {
      // debug('opt is undef');
      return;
    }
    // Prefer IP if returned by the server
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

    // connection to localtunnel server
    const remote = net.connect({
      host: remoteHostOrIp,
      port: remotePort,
    });

    remote.setKeepAlive(true);
    remote.setTimeout(60000);

    remote.on('error', err => {
      debug('got remote connection error', err.message);

      // emit connection refused errors immediately, because they
      // indicate that the tunnel can't be established.
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
        // Nirvana
        this.emit('dead');
        return;
      }

      // debug('connecting locally to %s://%s:%d', localProtocol, localHost, localPort);
      remote.pause();

      if (allowInvalidCert) {
        debug('allowing invalid certificates');
      }

      const getLocalCertOpts = () =>
        allowInvalidCert
          ? { rejectUnauthorized: false }
          : {
              cert: fs.readFileSync(opt.local_cert),
              key: fs.readFileSync(opt.local_key),
              ca: opt.local_ca ? [fs.readFileSync(opt.local_ca)] : undefined,
            };

      // connection to local http server
      // debug('isHttps:', opt.local_https);
      const local = opt.local_https
        ? tls.connect({ host: localHost, port: localPort, ...getLocalCertOpts() })
        : net.connect({ host: localHost, port: localPort, keepAlive: false});

      // local.setKeepAlive(true);
      local.setTimeout(60000);
      const remoteClose = () => {
        debug('remote close');
        this.emit('dead');
        local.end();
      };

      remote.once('close', remoteClose);

      // TODO some languages have single threaded servers which makes opening up
      // multiple local connections impossible. We need a smarter way to scale
      // and adjust for such instances to avoid beating on the door of the server
      local.once('error', err => {
        debug('local error %s', err.message);
        local.end();

        remote.removeListener('close', remoteClose);

        if (err.code !== 'ECONNREFUSED'
            && err.code !== 'ECONNRESET') {
          return remote.end();
        }

        // retrying connection to local server
        setTimeout(connLocal, 1000);
      });

      local.once('connect', () => {
        debug('connected locally');
        // fire connect event to Tunnel
        remote.resume();

        let stream = remote;

        // if user requested specific local host
        // then we use host header transform to replace the host header
        if (opt.local_host) {
          debug('transform Host header to %s', opt.local_host);
          stream = remote.pipe(new HeaderHostTransformer({ host: opt.local_host }));
        }

        stream.pipe(local).pipe(remote);

        // when local closes, also get a new remote
        local.once('close', hadError => {
          debug('local connection closed [error: %s]', hadError);
          debug('local socket timeout:', local.timeout);
          // emit close event to Tunnel
          this.emit('close');
          return;
        });
      });
    };

    remote.on('data', data => {
      const match = data.toString().match(/^(\w+) (\S+)/);
      if (match) {
        this.emit('request', {
          method: match[1],
          path: match[2],
        });
      }
    });

    // tunnel is considered open when remote connects
    remote.once('connect', () => {
      this.emit('open', remote);
      connLocal();
    });
  }
};

// const { EventEmitter } = require('events');
// const debug = require('debug')('localtunnel:cluster');
// const fs = require('fs');
// const net = require('net');
// const tls = require('tls');
// const { Throttle } = require('stream-throttle');
// const axios = require('axios');
// const HeaderHostTransformer = require('./HeaderHostTransformer');

// // ขีดจำกัดข้อมูล 1GB (1,073,741,824 bytes)
// const LimitMem = 1024 * 1024 * 1024;
// const MB_DIVISOR = 6 * 1024 * 1024; // แปลงจากไบต์เป็นเมกะไบต์

// module.exports = class TunnelCluster extends EventEmitter {
//   constructor(opts = {}) {
//     super(opts);
//     this.opts = opts;
//     this.totalDataUsed = 0;
//     this.LimitMem = 0;
//   }

//   // ดึงค่า LimitMem และ MB_DIVISOR จาก API
//   async fetchBandwidthSettings() {
//     try {
//       const response = await axios.get(`http://localhost:9090/api/v1/get/memmory/${process.env.TOKEN}`);
//       this.LimitMem = response.data.results.limit_mem;
//       this.totalDataUsed = response.data.results.usage_mem;
//       console.log(response.data.results);
      
//       debug(`----------------------Fetched settings: LimitMem=${this.LimitMem} ----------------------`);
//       debug(`----------------------Fetched settings: totalDataUsed=${this.totalDataUsed}----------------------`);
//     } catch (error) {
//       debug('Error fetching bandwidth settings:', error.message);
//       // ถ้าดึงค่าไม่สำเร็จ กำหนดค่าเริ่มต้นเป็น 1GB และ MB_DIVISOR เป็น 1024*1024
//       this.LimitMem = 1024 * 1024 * 1024;
//       // this.MB_DIVISOR = 1024 * 1024;
//     }
//   }

//   async updateUsageSettings(usedMB) {
//     try {
//       const response = await axios.put(`http://localhost:9090/api/v1/get/memmory`,{userKey :process.env.TOKEN, usage_mem : this.totalDataUsed});
//       // this.LimitMem = response.data.results.limit_mem;
//       debug(`updateUsageSettings settings: this.totalDataUsed=${this.totalDataUsed}`);
//     } catch (error) {
//       debug('updateUsageSettings settings:', error.message);
//       // ถ้าดึงค่าไม่สำเร็จ กำหนดค่าเริ่มต้นเป็น 1GB และ MB_DIVISOR เป็น 1024*1024
//       // this.LimitMem = 1024 * 1024 * 1024;
//       // this.MB_DIVISOR = 1024 * 1024;
//     }
//   }

//   async open() {
//     const opt = this.opts;
//     if (opt === undefined) {
//       return;
//     }

//     await this.fetchBandwidthSettings();
    
//     const remoteHostOrIp = opt.remote_ip || opt.remote_host;
//     const remotePort = opt.remote_port;
//     const localHost = opt.local_host || 'localhost';
//     const localPort = opt.local_port;
//     const localProtocol = opt.local_https ? 'https' : 'http';
//     const allowInvalidCert = opt.allow_invalid_cert;

//     debug(
//       'establishing tunnel %s://%s:%s <> %s:%s',
//       localProtocol,
//       localHost,
//       localPort,
//       remoteHostOrIp,
//       remotePort
//     );

//     const remote = net.connect({
//       host: remoteHostOrIp,
//       port: remotePort,
//     });

//     remote.setKeepAlive(true);
//     remote.setTimeout(60000);

//     remote.on('error', err => {
//       debug('got remote connection error', err.message);

//       if (err.code === 'ECONNREFUSED') {
//         this.emit(
//           'error',
//           new Error(
//             `connection refused: ${remoteHostOrIp}:${remotePort} (check your firewall settings)`
//           )
//         );
//       }

//       remote.end();
//     });

//     const connLocal = () => {
//       if (remote.destroyed) {
//         debug('remote destroyed');
//         this.emit('dead');
//         return;
//       }

//       remote.pause();

//       const getLocalCertOpts = () =>
//         allowInvalidCert
//           ? { rejectUnauthorized: false }
//           : {
//               cert: fs.readFileSync(opt.local_cert),
//               key: fs.readFileSync(opt.local_key),
//               ca: opt.local_ca ? [fs.readFileSync(opt.local_ca)] : undefined,
//             };

//       const local = opt.local_https
//         ? tls.connect({ host: localHost, port: localPort, ...getLocalCertOpts() })
//         : net.connect({ host: localHost, port: localPort, keepAlive: false });

//       local.setTimeout(60000);

//       const remoteClose = () => {
//         debug('remote close');
//         this.emit('dead');
//         local.end();
//       };

//       remote.once('close', remoteClose);

//       local.once('error', err => {
//         debug('local error %s', err.message);
//         local.end();
//         remote.removeListener('close', remoteClose);

//         if (err.code !== 'ECONNREFUSED' && err.code !== 'ECONNRESET') {
//           return remote.end();
//         }

//         setTimeout(connLocal, 1000);
//       });

//       local.once('connect', () => {
//         debug('connected locally');
//         remote.resume();

//         const throttleStream = new Throttle({ rate: 1024 * 1024 }); // จำกัดแบนด์วิดท์ที่ 1MB/s

//         let stream = remote;

//         if (opt.local_host) {
//           stream = remote.pipe(new HeaderHostTransformer({ host: opt.local_host }));
//         }

//         const trackDataUsage = async (chunk) => {
//           this.totalDataUsed += chunk.length; // นับจำนวนข้อมูลที่ถูกส่ง
//           const usedMB = this.totalDataUsed / MB_DIVISOR; // แปลงจากไบต์เป็นเมกะไบต์
          
//           // log ปริมาณข้อมูลที่ใช้ไป
//           debug(`Data used: ${usedMB.toFixed(2)} MB`);

//           if (this.totalDataUsed >= this.LimitMem) {
//             debug('Reached 1GB limit, closing connection');
//             local.end(); // ปิดการเชื่อมต่อเมื่อใช้ข้อมูลถึง 1GB
//             remote.end();
//             process.exit(1);
//           } else {
//             await this.updateUsageSettings()
//           }
//         };

//         // ตรวจสอบข้อมูลที่ถูกส่งผ่านทั้ง remote และ local
//         // stream.on('data', trackDataUsage);
//         local.on('data', trackDataUsage);

//         // จำกัดแบนด์วิดท์และเชื่อมต่อ stream
//         stream.pipe(throttleStream).pipe(local).pipe(remote);

//         local.once('close', hadError => {
//           debug('local connection closed [error: %s]', hadError);
//           this.emit('close');
//         });
//       });
//     };

//     remote.on('data', data => {
//       const match = data.toString().match(/^(\w+) (\S+)/);
//       if (match) {
//         this.emit('request', {
//           method: match[1],
//           path: match[2],
//         });
//       }
//     });

//     remote.once('connect', () => {
//       this.emit('open', remote);
//       connLocal();
//     });
//   }
// };
