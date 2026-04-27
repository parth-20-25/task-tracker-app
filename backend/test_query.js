const { pool } = require("./db");

async function run() {
  try {
    const res = await pool.query("SELECT * FROM workflow_stages");
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
