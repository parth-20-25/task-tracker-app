const { Pool } = require("pg");
const { env } = require("./config/env");

const poolConfig = env.db.connectionString
  ? {
      connectionString: env.db.connectionString,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
    }
  : {
      user: env.db.user,
      host: env.db.host,
      database: env.db.database,
      password: env.db.password,
      port: env.db.port,
    };

const pool = new Pool(poolConfig);

module.exports = {
  pool,
};
