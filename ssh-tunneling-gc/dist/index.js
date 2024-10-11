"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAvailablePort = exports.SshTunnel = exports.logger = exports.STATUS = void 0;
const net = __importStar(require("net"));
const ssh2_1 = require("ssh2");
const socks_1 = require("socks");
const logger_1 = __importDefault(require("./logger"));
exports.logger = logger_1.default;
const utils_1 = require("./utils");
Object.defineProperty(exports, "getAvailablePort", { enumerable: true, get: function () { return utils_1.getAvailablePort; } });
var STATUS;
(function (STATUS) {
    STATUS[STATUS["INIT"] = 0] = "INIT";
    STATUS[STATUS["CONNECTING"] = 1] = "CONNECTING";
    STATUS[STATUS["READY"] = 2] = "READY";
    STATUS[STATUS["CLOSE"] = 3] = "CLOSE";
})(STATUS = exports.STATUS || (exports.STATUS = {}));
class SshTunnel {
    constructor(sshConfig) {
        this.proxyList = [];
        this.socksStatus = STATUS.INIT;
        this.sshStatus = STATUS.INIT;
        /**
         * 获取 socks 实例
         */
        this.createSocksClient = async () => {
            if (this.socksSocket && this.socksStatus === STATUS.READY) {
                return this.socksSocket;
            }
            if (this.socksPromise !== undefined &&
                this.socksStatus === STATUS.CONNECTING) {
                return this.socksPromise;
            }
            if (this.socksConfig) {
                const socksClient = await socks_1.SocksClient.createConnection(this.socksConfig);
                this.socksStatus = STATUS.CONNECTING;
                this.socksPromise = new Promise((resolve, reject) => {
                    var _a;
                    try {
                        // 清空上一个 socket 的监听函数
                        (_a = this.socksSocket) === null || _a === void 0 ? void 0 : _a.removeAllListeners();
                        this.socksSocket = socksClient.socket;
                        const onClose = (_) => {
                            // logger.info(`socks ${event}`);
                            this.socksStatus = STATUS.CLOSE;
                            this.socksSocket = undefined;
                            this.socksPromise = undefined;
                        };
                        this.socksSocket
                            .on('close', () => onClose('close'))
                            .on('end', () => onClose('end'))
                            .on('error', () => onClose('error'));
                        resolve(this.socksSocket);
                        this.socksStatus = STATUS.READY;
                        this.socksPromise = undefined;
                    }
                    catch (e) {
                        this.socksStatus = STATUS.CLOSE;
                        this.socksSocket = undefined;
                        this.socksPromise = undefined;
                        reject(e);
                    }
                });
                return this.socksPromise;
            }
            else {
                throw new Error('没有读取到 socks 配置');
            }
        };
        /**
         * 获取已经成功连接的 ssh 实例
         */
        this.createSshClient = async () => {
            if (this.sshPromise !== undefined && this.sshStatus === STATUS.CONNECTING) {
                return this.sshPromise;
            }
            this.sshStatus = STATUS.CONNECTING;
            let socksSocket;
            if (this.socksConfig) {
                socksSocket = await this.createSocksClient();
            }
            this.sshPromise = new Promise((resolve, reject) => {
                var _a;
                try {
                    const sshClient = new ssh2_1.Client();
                    const onClose = (event, error) => {
                        var _a;
                        // logger.info(`ssh ${event}`);
                        this.sshStatus = STATUS.CLOSE;
                        this.sshClient = undefined;
                        this.sshPromise = undefined;
                        (_a = this.socksSocket) === null || _a === void 0 ? void 0 : _a.destroy(new Error(error.message || 'closed by sshClient'));
                        reject(error);
                        // error && logger.warn(`ssh ${event} `, error.message);
                    };
                    sshClient
                        .on('ready', () => {
                        var _a, _b;
                        logger_1.default.purple('ssh connection ready');
                        // 清空上一个 ssh client 的监听函数，销毁上一个 sshClient
                        (_a = this.sshClient) === null || _a === void 0 ? void 0 : _a.removeAllListeners();
                        (_b = this.sshClient) === null || _b === void 0 ? void 0 : _b.destroy();
                        this.sshStatus = STATUS.READY;
                        this.sshClient = sshClient;
                        this.heartbeatPromise = Promise.resolve(true).finally(() => {
                            setTimeout(() => {
                                this.heartbeatPromise = undefined;
                            }, 3000);
                        });
                        resolve(sshClient);
                        this.sshPromise = undefined;
                    })
                        .connect({
                        readyTimeout: 10000,
                        ...this.sshConfig,
                        sock: socksSocket,
                    })
                        .on('error', e => {
                        onClose('error', e);
                    })
                        .on('close', e => {
                        onClose('close', e);
                    })
                        .on('timeout', () => {
                        onClose('timeout');
                    })
                        .on('end', () => {
                        onClose('end');
                    });
                }
                catch (e) {
                    this.sshStatus = STATUS.CLOSE;
                    this.sshClient = undefined;
                    this.sshPromise = undefined;
                    (_a = this.socksSocket) === null || _a === void 0 ? void 0 : _a.destroy(new Error('closed by sshClient'));
                    reject(e);
                }
            });
            return this.sshPromise;
        };
        /**
         * 手动查询 ssh 是否被挂起
         */
        this.throttleCheckAlive = () => {
            if (this.heartbeatPromise !== undefined) {
                return this.heartbeatPromise;
            }
            this.heartbeatPromise = new Promise(resolve => {
                if (!this.sshClient) {
                    resolve(false);
                    return;
                }
                try {
                    this.sshClient.exec(`echo 1`, {}, (err, stream) => {
                        if (err) {
                            resolve(false);
                            return;
                        }
                        stream.on('data', () => {
                            resolve(true);
                            stream.close();
                        });
                        stream.stderr.on('data', () => {
                            resolve(true);
                            stream.close();
                        });
                    });
                }
                catch (e) {
                    //  exec 时会判断是否 not connected
                    resolve(false);
                }
                setTimeout(() => {
                    // 手动超时 timeout
                    resolve(false);
                }, 5000);
            }).finally(() => {
                setTimeout(() => {
                    // 防止大量并发请求进来时导致 channel 连接数过大，状态默认缓存 3s 后，自动销毁
                    this.heartbeatPromise = undefined;
                }, 5000);
            });
            return this.heartbeatPromise;
        };
        this._forwardOut = async (proxyConfig) => {
            const { localPort, destHost, destPort, id } = proxyConfig;
            if (this.proxyList.find(item => item.id === id)) {
                throw new Error(`id ${id} is duplicated, use another one please`);
            }
            logger_1.default.bgBlack(this.genSshCommand(proxyConfig));
            if (!this.sshClient) {
                await this.createSshClient();
            }
            // {
            // keepAliveInitialDelay: 10000,
            // keepAlive: true
            // }
            const server = net
                .createServer({
                keepAlive: true,
            }, async (socket) => {
                try {
                    const alive = await this.throttleCheckAlive();
                    if (!alive) {
                        logger_1.default.white('ssh connection was hung up, reconnecting...');
                        await this.createSshClient();
                    }
                    // 并发 exec(`nc ip port`) 数量在超过 服务器 ssh 设置的最大 channel 数时（一般是 10），会有 Channel open failure 的问题
                    // @see https://github.com/mscdex/ssh2/issues/219
                    // forwardOut 的 localPort 可以为任意数字，不影响
                    if (this.sshClient) {
                        this.sshClient.forwardOut('127.0.0.1', 1234, destHost, destPort, (err, stream) => {
                            var _a;
                            if (err) {
                                logger_1.default.warn(`${id} forwardout err: `, err.message);
                                if ((_a = err.message) === null || _a === void 0 ? void 0 : _a.includes('Connection refused')) {
                                    logger_1.default.bgRed(`朋友，检查一下目标服务器端口 ${id} ${destHost}:${destPort} 是否正常`);
                                }
                                socket.end();
                                return;
                            }
                            // https://stackoverflow.com/questions/17245881/how-do-i-debug-error-econnreset-in-node-js
                            // if no error hanlder, it may occur this error which casued by client side.
                            // Then the local server will exit.
                            // Error: read ECONNRESET
                            // at TCP.onStreamRead (node:internal/stream_base_commons:217:20) {
                            //   errno: -54,
                            //   code: 'ECONNRESET',
                            //   syscall: 'read'
                            // }
                            socket.on('error', err => {
                                console.log('[ssh-tunneling]: local socket error\n', err);
                            });
                            stream.on('error', err => {
                                console.log('[ssh-tunneling]: remote stream error\n', err);
                            });
                            // pipeline(socket, stream);
                            // pipeline(stream, socket);
                            socket.pipe(stream);
                            stream.pipe(socket);
                            // socket.on('data', data => {
                            //   logger.orange(`local data, ${data.toString('utf8')}`)
                            //   stream.write(data);
                            // })
                            // stream.on('data', data => {
                            //   logger.green(`remote data, ${data.toString('utf8')}`)
                            //   socket.write(data);
                            // })
                        });
                    }
                    else {
                        throw new Error();
                    }
                }
                catch (e) {
                    logger_1.default.warn(e.message);
                    logger_1.default.white('ssh connection was hung up, reconnecting...');
                    this.createSshClient().catch(err => {
                        logger_1.default.warn(err.message);
                        socket.end();
                    });
                }
            })
                .listen(localPort)
                .on('connection', async () => {
                // console.log('connection');
                // server?.getConnections((err, count) => {
                //   console.log(`当前有${count}个连接`);
                // })
            }).on('listening', () => {
                // console.log(`listening ${localPort}`);
            }).on('close', () => {
                logger_1.default.gray(`proxy server ${id} is closed`);
            });
            this.proxyList.push({
                localPort,
                destHost,
                destPort,
                server,
                id,
                type: 'out'
            });
            logger_1.default.startLine().mint('proxy server ').blue(id).mint(` is listening on 127.0.0.1:${localPort} => ${destHost}:${destPort}`).endLine();
            return proxyConfig;
        };

        this._remotePortForward = async (proxyConfig) => {
            const { serverPort, serverAddress, localPort, id } = proxyConfig;
            if (this.proxyList.find(item => item.id === id)) {
                throw new Error(`id ${id} is duplicated, use another one please`);
            }
            logger_1.default.bgBlack(this.genSshCommandRemote(proxyConfig));
            if (!this.sshClient) {
                await this.createSshClient();
            }
            // {
            // keepAliveInitialDelay: 10000,
            // keepAlive: true
            // }
            const server = net
                .createServer({
                keepAlive: true,
            }, async (socket) => {
                try {
                    const alive = await this.throttleCheckAlive();
                    if (!alive) {
                        logger_1.default.white('ssh connection was hung up, reconnecting...');
                        await this.createSshClient();
                    }
                    // 并发 exec(`nc ip port`) 数量在超过 服务器 ssh 设置的最大 channel 数时（一般是 10），会有 Channel open failure 的问题
                    // @see https://github.com/mscdex/ssh2/issues/219
                    // forwardOut 的 localPort 可以为任意数字，不影响
                    if (this.sshClient) {
                        console.debug("sshClient is ready!");
                        // this.sshClient.forwardOut('127.0.0.1', 1234, destHost, destPort, (err, stream) => {
                        //     var _a;
                        //     if (err) {
                        //         logger_1.default.warn(`${id} forwardout err: `, err.message);
                        //         if ((_a = err.message) === null || _a === void 0 ? void 0 : _a.includes('Connection refused')) {
                        //             logger_1.default.bgRed(`朋友，检查一下目标服务器端口 ${id} ${destHost}:${destPort} 是否正常`);
                        //         }
                        //         socket.end();
                        //         return;
                        //     }
                        //     // https://stackoverflow.com/questions/17245881/how-do-i-debug-error-econnreset-in-node-js
                        //     // if no error hanlder, it may occur this error which casued by client side.
                        //     // Then the local server will exit.
                        //     // Error: read ECONNRESET
                        //     // at TCP.onStreamRead (node:internal/stream_base_commons:217:20) {
                        //     //   errno: -54,
                        //     //   code: 'ECONNRESET',
                        //     //   syscall: 'read'
                        //     // }
                        //     socket.on('error', err => {
                        //         console.log('[ssh-tunneling]: local socket error\n', err);
                        //     });
                        //     stream.on('error', err => {
                        //         console.log('[ssh-tunneling]: remote stream error\n', err);
                        //     });
                        //     // pipeline(socket, stream);
                        //     // pipeline(stream, socket);
                        //     socket.pipe(stream);
                        //     stream.pipe(socket);
                        //     // socket.on('data', data => {
                        //     //   logger.orange(`local data, ${data.toString('utf8')}`)
                        //     //   stream.write(data);
                        //     // })
                        //     // stream.on('data', data => {
                        //     //   logger.green(`remote data, ${data.toString('utf8')}`)
                        //     //   socket.write(data);
                        //     // })
                        // });
                        this.sshClient.forwardIn(serverAddress, serverPort, (err, stream) => {
                            console.debug('Listening for connections on server on port 1234');
                            var _a;
                            if (err) {
                                logger_1.default.warn(`${id} forwardIn err: `, err.message);
                                if ((_a = err.message) === null || _a === void 0 ? void 0 : _a.includes('Connection refused')) {
                                    logger_1.default.bgRed(`朋友，检查一下目标服务器端口 ${id} ${destHost}:${destPort} 是否正常`);
                                }
                                socket.end();
                                return;
                            }
                            if (err) throw err;
                            socket.on('error', err => {
                                console.log('[ssh-tunneling]: local socket error\n', err);
                            });
                            stream.on('error', err => {
                                console.log('[ssh-tunneling]: remote stream error\n', err);
                            });
                            // pipeline(socket, stream);
                            // pipeline(stream, socket);

                            stream.pipe(socket);
                            socket.pipe(stream);

                            socket.on('data', data => {
                              logger.orange(`local data, ${data.toString('utf8')}`)
                              stream.write(data);
                            })
                            
                            stream.on('data', data => {
                              logger.green(`remote data, ${data.toString('utf8')}`)
                              socket.write(data);
                            })
                            
                        });
                    }
                    else {
                        throw new Error();
                    }
                }
                catch (e) {
                    logger_1.default.warn(e.message);
                    logger_1.default.white('ssh connection was hung up, reconnecting...');
                    this.createSshClient().catch(err => {
                        logger_1.default.warn(err.message);
                        socket.end();
                    });
                }
            })
                .listen(localPort)
                .on('connection', async () => {
                // console.log('connection');
                // server?.getConnections((err, count) => {
                //   console.log(`当前有${count}个连接`);
                // })
            }).on('listening', () => {
                // console.log(`listening ${localPort}`);
            }).on('close', () => {
                logger_1.default.gray(`proxy server ${id} is closed`);
            });
            this.proxyList.push({
                localPort,
                destHost,
                destPort,
                server,
                id,
                type: 'out'
            });
            logger_1.default.startLine().mint('proxy server ').blue(id).mint(` is listening on 127.0.0.1:${localPort} => ${destHost}:${destPort}`).endLine();
            return proxyConfig;
        };
        /**
         * @descrption close tunnel and destroy all the instance
         * @params key: The server key you want to close.If passing empty, it will close all the servers and the main ssh client.
         */
        this.close = async (id) => {
            var _a, _b;
            if (!id) {
                (_a = this.sshClient) === null || _a === void 0 ? void 0 : _a.destroy();
                (_b = this.socksSocket) === null || _b === void 0 ? void 0 : _b.destroy();
            }
            const targetList = this.proxyList.filter(item => id ? item.id === id : true);
            targetList.forEach(item => item.server.close());
        };
        const { hoppingServer, ...restConfig } = sshConfig;
        if (hoppingServer) {
            // 初始化 socks 配置
            // socks5://user:password@180.80.80.80:1080
            const socksReg = /socks(\d):\/\/([^:]+(?::[^:]+)?@)?([\d.]+):(\d+)/;
            const [, hoppingSocksType, authInfo = '', hoppingIp, hoppingPort] = socksReg.exec(hoppingServer) || [];
            if (!hoppingIp || !hoppingPort || !hoppingSocksType) {
                throw new Error('socks服务配置错误');
            }
            const [userId, password] = authInfo.slice(0, -1).split(':');
            this.socksConfig = {
                proxy: {
                    host: hoppingIp,
                    port: Number(hoppingPort),
                    type: Number(hoppingSocksType),
                    userId: decodeURIComponent(userId),
                    password: decodeURIComponent(password),
                },
                command: 'connect',
                destination: {
                    host: sshConfig.host || '',
                    port: 22,
                },
                timeout: 10000,
            };
        }
        this.sshConfig = {
            ...restConfig,
            // debug(info) {
            //   console.log(new Date().toISOString(), info);
            // }
        };
    }
    async _exec(command) {
        if (!this.sshClient) {
            await this.createSshClient();
        }
        const alive = await this.throttleCheckAlive();
        if (!alive) {
            logger_1.default.white('ssh connection was hung up, reconnecting...');
            await this.createSshClient();
        }
        let res = '';
        return new Promise((resolve, reject) => {
            var _a;
            (_a = this.sshClient) === null || _a === void 0 ? void 0 : _a.exec(command, (err, stream) => {
                if (err) {
                    reject(err);
                    return;
                }
                stream.on('data', data => {
                    res += data.toString('utf8');
                });
                stream.on('close', () => {
                    resolve(res);
                });
                stream.stderr.on('data', data => {
                    reject(data.toString('utf8'));
                    stream.close();
                });
            });
        });
    }
    /**
     * @description execute command
     * @params a command or commands array
     * @return If passing one command, it will return the result after executed.
     * @return If passing a command array, it will return an array by order after all of them were executed.
     */
    async exec(command) {
        if (Array.isArray(command)) {
            const divider = '__ssh_tunneling_divider__';
            const combinedCommand = command.join(` && echo -n ${divider} && `);
            const res = (await this._exec(combinedCommand)).split(divider);
            return command.map((item, i) => {
                return {
                    command: item,
                    result: res[i]
                };
            });
        }
        return this._exec(command);
    }
    genSshCommand(proxyConfig) {
        var _a, _b, _c;
        const { localPort, destHost, destPort } = proxyConfig;
        if (this.socksConfig) {
            let str = `ssh -o StrictHostKeyChecking=no -o ProxyCommand="nc -X ${(_a = this.socksConfig) === null || _a === void 0 ? void 0 : _a.proxy.type} -x ${(_b = this.socksConfig) === null || _b === void 0 ? void 0 : _b.proxy.host}:${(_c = this.socksConfig) === null || _c === void 0 ? void 0 : _c.proxy.port} %h %p" ${this.sshConfig.username}@${this.sshConfig.host} -L ${localPort}:${destHost}:${destPort}`;
            // if (this.socksConfig.proxy.userId) {
            //   str += ` --proxy-auth "${this.socksConfig.proxy.userId}${this.socksConfig.proxy.password ? `:${this.socksConfig.proxy.password}` : ''}"`;
            // }
            return str;
        }
        return `ssh -o StrictHostKeyChecking=no ${this.sshConfig.username}@${this.sshConfig.host} -L ${localPort}:${destHost}:${destPort}`;
    }

    genSshCommandRemote(proxyConfig) {
        var _a, _b, _c;
        const { localPort, destHost, destPort } = proxyConfig;
        if(this.socksConfig) {
            let str = `ssh -R 1234:localhost:22 gcrok@giantiot.com`;
            return str;
        }
        return `ssh -R 1234:localhost:22 gcrok@giantiot.com`;
    }
    /**
     * @description ssh port forwarding
     * @expample proxy('3000:192.168.1.1:3000')
     * @expample proxy(['3000:192.168.1.1:3000', '3001:192.168.1.1:3001'])
     */
    async forwardOut(proxyConfig) {
        if (Array.isArray(proxyConfig)) {
            const result = [];
            await proxyConfig.reduce((pre, config) => {
                return pre.then(async () => {
                    let localPort = '';
                    let destHost = '';
                    let destPort = '';
                    let id = '';
                    if (typeof config === 'string') {
                        [localPort, destHost, destPort] = config.split(':') || [];
                        id = config;
                    }
                    if (Object.prototype.toString.call(config) === '[object Object]') {
                        [localPort, destHost, destPort] = config.proxy.split(':') || [];
                        id = config.id;
                    }
                    if ([localPort, destHost, destPort, id].some(s => !s)) {
                        throw new Error(`params ${typeof proxyConfig === 'string' ? proxyConfig : JSON.stringify(proxyConfig)} is invalid`);
                    }
                    localPort = await (0, utils_1.getAvailablePort)(Number(localPort));
                    const params = {
                        localPort: Number(localPort),
                        destHost,
                        destPort: Number(destPort),
                        id
                    };
                    await this._forwardOut(params);
                    result.push(params);
                });
            }, Promise.resolve());
            return result;
        }
        if (typeof proxyConfig === 'string') {
            const [localPort, destHost, destPort] = proxyConfig.split(':');
            const availablePort = await (0, utils_1.getAvailablePort)(Number(localPort));
            const params = {
                localPort: availablePort,
                destHost,
                destPort: Number(destPort),
                id: proxyConfig
            };
            await this._forwardOut(params);
            return params;
        }
        if (Object.prototype.toString.call(proxyConfig) === '[object Object]') {
            const [localPort, destHost, destPort] = proxyConfig.proxy.split(':') || [];
            const availablePort = await (0, utils_1.getAvailablePort)(Number(localPort));
            const params = {
                localPort: availablePort,
                destHost,
                destPort: Number(destPort),
                id: proxyConfig.id
            };
            await this._forwardOut(params);
            return params;
        }
        throw new Error(`params ${proxyConfig} is invalid`);
    }

    async remotePortForward(proxyConfig) {
        if (Array.isArray(proxyConfig)) {
            const result = [];
            await proxyConfig.reduce((pre, config) => {
                return pre.then(async () => {
                    let localPort = '';
                    let destHost = '';
                    let destPort = '';
                    let id = '';
                    if (typeof config === 'string') {
                        // e.x. $ '1234:localhost:22'
                        [localPort, destHost, destPort] = config.split(':') || [];
                        id = config;
                    }
                    if (Object.prototype.toString.call(config) === '[object Object]') {
                        [localPort, destHost, destPort] = config.proxy.split(':') || [];
                        id = config.id;
                    }
                    if ([localPort, destHost, destPort, id].some(s => !s)) {
                        throw new Error(`params ${typeof proxyConfig === 'string' ? proxyConfig : JSON.stringify(proxyConfig)} is invalid`);
                    }
                    localPort = await (0, utils_1.getAvailablePort)(Number(localPort));
                    const params = {
                        localPort: Number(localPort),
                        destHost,
                        destPort: Number(destPort),
                        id
                    };
                    await this._forwardOut(params);
                    result.push(params);
                });
            }, Promise.resolve());
            return result;
        }
        if (typeof proxyConfig === 'string') {
            const [localPort, destHost, destPort] = proxyConfig.split(':');
            const availablePort = await (0, utils_1.getAvailablePort)(Number(localPort));
            const params = {
                localPort: availablePort,
                destHost,
                destPort: Number(destPort),
                id: proxyConfig
            };
            await this._remotePortForward(params);
            return params;
        }
        if (Object.prototype.toString.call(proxyConfig) === '[object Object]') {
            const [localPort, destHost, destPort] = proxyConfig.proxy.split(':') || [];
            const availablePort = await (0, utils_1.getAvailablePort)(Number(localPort));
            const params = {
                localPort: availablePort,
                destHost,
                destPort: Number(destPort),
                id: proxyConfig.id
            };
            await this._forwardOut(params);
            return params;
        }
        throw new Error(`params ${proxyConfig} is invalid`);
    }

    getSSHClient() {
        return this.sshClient;
    }
    getSocksStatus() {
        return this.socksStatus;
    }
}
exports.SshTunnel = SshTunnel;
