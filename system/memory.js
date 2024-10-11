const os = require("os");

function getMemory() {
  const mamTotal = parseFloat((os.totalmem() / (1024 * 1024 * 1024)).toFixed(2));
  const mamFree = parseFloat((os.freemem() / (1024 * 1024 * 1024)).toFixed(2));
  return [mamTotal,mamFree]
}

module.exports = getMemory

