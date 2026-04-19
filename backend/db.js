const { Pool } = require("pg");
const { env } = require("./config/env");

const pool = new Pool({
  user: env.db.user,
  host: env.db.host,
  database: env.db.database,
  password: env.db.password,
  port: env.db.port,
});

module.exports = {
  pool,
};
