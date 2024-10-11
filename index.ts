import { SshTunnel } from 'ssh-tunneling';
import type { SshConfig } from 'ssh-tunneling';

const sshConfig: SshConfig = {
  host: 'giantiot.com',
  port: 22,
  username: 'ubuntu',
  password: 'atop3352'
};
const client = new SshTunnel(sshConfig);
const forwardInfo1 = client.forwardOut('2222:localhost:22');
console.log(forwardInfo1);