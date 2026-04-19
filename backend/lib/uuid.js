const { v4: uuidv4 } = require("uuid");

function generateUUID() {
  try {
    return uuidv4();
  } catch (err) {
    return Math.random().toString(36).substring(2, 10);
  }
}

module.exports = { generateUUID };
