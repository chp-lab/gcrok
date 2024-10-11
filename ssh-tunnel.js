// import { SshTunnel } from 'ssh-tunneling';
// import type { SshConfig } from 'ssh-tunneling';

// const sshConfig: SshConfig = {
//   host: 'giantiot.com',
//   port: 22,
//   username: 'ubuntu',
//   password: 'atop3352'
// };
// const client = new SshTunnel(sshConfig);
// const forwardInfo1 = client.forwardOut('2222:localhost:22');
// console.log(forwardInfo1)
const { SshTunnel } = require("./ssh-tunneling-gc/dist");

sshConfig = {
  host: 'giantiot.com',
  port: 22,
  username: 'gcrok-tunnel',
  password: '$hhP$Nxz9Rk9.q,2!>f_>]uZP:*y^;3Y'
};

const client = new SshTunnel(sshConfig);
const forwardInfo1 = client.forwardOut('2222:localhost:22');
// const remotePortForward1 = client.remotePortForward('8002:localhost:1880');
console.log(forwardInfo1);
// console.log(remotePortForward1);