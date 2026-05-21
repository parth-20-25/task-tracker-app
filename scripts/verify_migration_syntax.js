#!/usr/bin/env node
const { ensureDesignDepartmentSchema } = require('../backend/repositories/designSchemaRepository');

(async () => {
  const queries = [];
  const fakeClient = {
    query: async (sql) => {
      queries.push(sql);
      console.log('--- QUERY START ---');
      console.log(sql.slice(0, 1000));
      console.log('--- QUERY END ---\n');
      return { rowCount: 0, rows: [] };
    },
  };

  try {
    console.log('Running ensureDesignDepartmentSchema with fake client...');
    await ensureDesignDepartmentSchema(fakeClient);
    console.log('ensureDesignDepartmentSchema executed without throwing.');
    console.log(`Total queries executed: ${queries.length}`);
    process.exit(0);
  } catch (err) {
    console.error('Error executing ensureDesignDepartmentSchema:', err);
    process.exit(1);
  }
})();
