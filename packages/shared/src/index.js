const schema = require('./schema');
const redact = require('./redact');

module.exports = {
  ...schema,
  ...redact,
};
