const Tunnel = require('./Tunnel');

module.exports = function localtunnel(arg1, arg2, arg3) {
  const options = typeof arg1 === 'object' ? arg1 : { ...arg2, port: arg1 };
  // console.debug("arg1=", arg1);
  console.debug("options:", options);
  const callback = typeof arg1 === 'object' ? arg2 : arg3;
  const client = new Tunnel(options);
  if (callback) {
    client.open(err => (err ? callback(err) : callback(null, client)));
    return client;
  }
  return new Promise((resolve, reject) =>
    client.open(err => (err ? reject(err) : resolve(client)))
  );
};
