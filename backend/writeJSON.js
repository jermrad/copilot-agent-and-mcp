const fs = require('fs');
const { randomUUID } = require('crypto');

function writeJSON(file, data) {
  const temporaryFile = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryFile, JSON.stringify(data, null, 2), { flag: 'wx' });
    fs.renameSync(temporaryFile, file);
  } finally {
    fs.rmSync(temporaryFile, { force: true });
  }
}

module.exports = writeJSON;
