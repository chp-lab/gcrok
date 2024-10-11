import { Client as SshClient, ConnectConfig as SshConnectConfig } from 'ssh2';
import logger from './logger';
import { getAvailablePort } from './utils';
export declare enum STATUS {
    INIT = 0,
    CONNECTING = 1,
    READY = 2,
    CLOSE = 3
}
type ProxyConfig = {
    localPort: number;
    destHost: string;
    destPort: number;
    id: string | number;
};
export type SshConfig = SshConnectConfig & {
    /**
     * @description socks hopping server for ssh connection
     * @example socks5://user:password@180.80.80.80:1080
     */
    hoppingServer?: string;
};
declare class SshTunnel {
    constructor(sshConfig: SshConfig);
    private readonly socksConfig?;
    private readonly sshConfig;
    private proxyList;
    private socksSocket?;
    private sshClient?;
    private socksStatus;
    private sshStatus;
    private socksPromise?;
    private sshPromise?;
    /**
     * 获取 socks 实例
     */
    private readonly createSocksClient;
    /**
     * 获取已经成功连接的 ssh 实例
     */
    private readonly createSshClient;
    private _exec;
    exec(command: string): Promise<string>;
    exec(command: string[]): Promise<{
        command: string;
        result: string;
    }[]>;
    /**
     * ssh hearbeat
     */
    private heartbeatPromise?;
    /**
     * 手动查询 ssh 是否被挂起
     */
    private readonly throttleCheckAlive;
    private genSshCommand;
    private _forwardOut;
    forwardOut(proxyConfig: string): Promise<ProxyConfig>;
    forwardOut(proxyConfig: {
        id: string | number;
        proxy: string;
    }): Promise<ProxyConfig>;
    forwardOut(proxyConfig: string[]): Promise<ProxyConfig[]>;
    forwardOut(proxyConfig: {
        id: string | number;
        proxy: string;
    }[]): Promise<ProxyConfig[]>;
    /**
     * @descrption close tunnel and destroy all the instance
     * @params key: The server key you want to close.If passing empty, it will close all the servers and the main ssh client.
     */
    close: (id?: string | number) => Promise<void>;
    getSSHClient(): SshClient | undefined;
    getSocksStatus(): STATUS;
}
export { logger, SshTunnel, getAvailablePort };
