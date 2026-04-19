const { pool } = require("../db");

async function enqueueJob(type, payload, priority = 0) {
  const result = await pool.query(
    `
      INSERT INTO jobs (type, payload, priority)
      VALUES ($1, $2, $3)
      RETURNING id
    `,
    [type, JSON.stringify(payload), priority],
  );
  return result.rows[0].id;
}

async function dequeueJob() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const result = await client.query(
      `
        SELECT id, type, payload
        FROM jobs
        WHERE status = 'pending'
        ORDER BY priority DESC, created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `,
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return null;
    }

    const job = result.rows[0];

    await client.query(
      `UPDATE jobs SET status = 'processing', started_at = NOW() WHERE id = $1`,
      [job.id],
    );

    await client.query("COMMIT");

    return {
      id: job.id,
      type: job.type,
      payload: job.payload,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function completeJob(jobId) {
  await pool.query(
    `UPDATE jobs SET status = 'completed', completed_at = NOW() WHERE id = $1`,
    [jobId],
  );
}

async function failJob(jobId, errorMessage) {
  await pool.query(
    `UPDATE jobs SET status = 'failed', failed_at = NOW(), error_message = $2 WHERE id = $1`,
    [jobId, errorMessage],
  );
}

async function processJobs() {
  const job = await dequeueJob();
  if (!job) return;

  try {
    // Process based on type
    if (job.type === 'send_notification') {
      // Import here to avoid circular deps
      const { notifyTaskAssignees } = require("./notificationService");
      await notifyTaskAssignees(job.payload.task, job.payload.title, job.payload.body, job.payload.type);
    } else if (job.type === 'send_email') {
      const { sendEmail } = require("./notificationService");
      await sendEmail(job.payload.to, job.payload.subject, job.payload.html);
    }
    // Add more job types as needed

    await completeJob(job.id);
  } catch (error) {
    await failJob(job.id, error.message);
  }
}

module.exports = {
  enqueueJob,
  processJobs,
};