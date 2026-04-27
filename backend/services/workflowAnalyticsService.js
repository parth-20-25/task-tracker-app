"use strict";

const { pool } = require("../db");

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_THROUGHPUT_DAYS = 7;
const CONSISTENCY_WINDOW_DAYS = 14;
const TIMELINE_FIXTURE_LIMIT = 16;

const STAGE_ROWS_QUERY = `
  WITH attempt_rollup AS (
    SELECT
      fixture_id,
      LOWER(BTRIM(stage_name)) AS stage_key,
      MIN(COALESCE(assigned_at, started_at)) AS first_assigned_at,
      MAX(approved_at) AS last_approved_at,
      MAX(completed_at) AS last_completed_at
    FROM fixture_workflow_stage_attempts
    WHERE NULLIF(BTRIM(stage_name), '') IS NOT NULL
    GROUP BY fixture_id, LOWER(BTRIM(stage_name))
  )
  SELECT
    progress.fixture_id,
    fixtures.fixture_no,
    progress.department_id,
    progress.stage_name,
    LOWER(BTRIM(progress.stage_name)) AS stage_key,
    COALESCE(progress.stage_order, 0) AS stage_order,
    progress.status,
    COALESCE(attempt_rollup.first_assigned_at, progress.assigned_at, progress.started_at) AS stage_assigned_at,
    COALESCE(attempt_rollup.last_approved_at, progress.completed_at) AS stage_approved_at,
    COALESCE(attempt_rollup.last_completed_at, progress.completed_at) AS stage_completed_at,
    COALESCE(
      progress.updated_at,
      attempt_rollup.last_approved_at,
      attempt_rollup.last_completed_at,
      progress.completed_at,
      progress.started_at,
      progress.assigned_at
    ) AS updated_at
  FROM fixture_workflow_progress progress
  JOIN design.fixtures fixtures
    ON fixtures.id = progress.fixture_id
  LEFT JOIN attempt_rollup
    ON attempt_rollup.fixture_id = progress.fixture_id
   AND attempt_rollup.stage_key = LOWER(BTRIM(progress.stage_name))
  WHERE NULLIF(BTRIM(progress.stage_name), '') IS NOT NULL
  ORDER BY progress.fixture_id ASC, COALESCE(progress.stage_order, 0) ASC, progress.stage_name ASC
`;

const ATTEMPT_ROWS_QUERY = `
  WITH task_stage_expectations AS (
    SELECT
      fixture_id,
      LOWER(BTRIM(stage)) AS stage_key,
      AVG(NULLIF(planned_minutes, 0)) FILTER (WHERE planned_minutes > 0) AS avg_planned_minutes,
      AVG(
        EXTRACT(
          EPOCH FROM (
            COALESCE(sla_due_date, due_date, deadline) - COALESCE(assigned_at, created_at)
          )
        ) / 60.0
      ) FILTER (
        WHERE COALESCE(sla_due_date, due_date, deadline) IS NOT NULL
          AND COALESCE(assigned_at, created_at) IS NOT NULL
          AND COALESCE(sla_due_date, due_date, deadline) > COALESCE(assigned_at, created_at)
      ) AS avg_sla_minutes
    FROM tasks
    WHERE fixture_id IS NOT NULL
      AND NULLIF(BTRIM(stage), '') IS NOT NULL
    GROUP BY fixture_id, LOWER(BTRIM(stage))
  ),
  stage_expectations AS (
    SELECT
      stage_key,
      AVG(avg_planned_minutes) FILTER (WHERE avg_planned_minutes IS NOT NULL) AS stage_planned_minutes,
      AVG(avg_sla_minutes) FILTER (WHERE avg_sla_minutes IS NOT NULL) AS stage_sla_minutes
    FROM task_stage_expectations
    GROUP BY stage_key
  )
  SELECT
    attempts.fixture_id,
    fixtures.fixture_no,
    attempts.department_id,
    attempts.stage_name,
    LOWER(BTRIM(attempts.stage_name)) AS stage_key,
    attempts.attempt_no,
    attempts.status,
    attempts.assigned_to,
    COALESCE(users.name, attempts.assigned_to) AS designer_name,
    attempts.assigned_at,
    attempts.started_at,
    attempts.completed_at,
    attempts.approved_at,
    attempts.duration_minutes,
    COALESCE(
      task_stage_expectations.avg_planned_minutes,
      task_stage_expectations.avg_sla_minutes,
      stage_expectations.stage_planned_minutes,
      stage_expectations.stage_sla_minutes
    ) / 60.0 AS expected_hours
  FROM fixture_workflow_stage_attempts attempts
  JOIN design.fixtures fixtures
    ON fixtures.id = attempts.fixture_id
  LEFT JOIN task_stage_expectations
    ON task_stage_expectations.fixture_id = attempts.fixture_id
   AND task_stage_expectations.stage_key = LOWER(BTRIM(attempts.stage_name))
  LEFT JOIN stage_expectations
    ON stage_expectations.stage_key = LOWER(BTRIM(attempts.stage_name))
  LEFT JOIN users
    ON users.employee_id = attempts.assigned_to
  WHERE NULLIF(BTRIM(attempts.stage_name), '') IS NOT NULL
  ORDER BY attempts.fixture_id ASC, LOWER(BTRIM(attempts.stage_name)) ASC, attempts.attempt_no ASC
`;

const FIXTURE_DEADLINES_QUERY = `
  SELECT
    fixture_id,
    MAX(COALESCE(sla_due_date, due_date, deadline)) AS deadline_at
  FROM tasks
  WHERE fixture_id IS NOT NULL
    AND COALESCE(sla_due_date, due_date, deadline) IS NOT NULL
  GROUP BY fixture_id
`;

function toDate(value) {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function round(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function average(values) {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values) {
  if (values.length <= 1) {
    return 0;
  }

  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function endOfUtcDay(date) {
  return new Date(startOfUtcDay(date).getTime() + DAY_MS - 1);
}

function addUtcDays(date, days) {
  return new Date(date.getTime() + (days * DAY_MS));
}

function toDateKey(date) {
  return startOfUtcDay(date).toISOString().slice(0, 10);
}

function slugifyStageKey(value) {
  const normalized = String(value || "stage")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!normalized) {
    return "stage";
  }

  return /^[0-9]/.test(normalized) ? `stage_${normalized}` : normalized;
}

function computeDurationHours(startValue, endValue, durationMinutes) {
  if (Number.isFinite(Number(durationMinutes)) && Number(durationMinutes) > 0) {
    return Number(durationMinutes) / 60;
  }

  const start = toDate(startValue);
  const end = toDate(endValue);

  if (!start || !end || end < start) {
    return null;
  }

  return (end.getTime() - start.getTime()) / 3600000;
}

function buildStageRegistry(stageRows, attemptRows) {
  const stageInfo = new Map();

  for (const row of stageRows) {
    const existing = stageInfo.get(row.stageId);
    const candidate = {
      id: row.stageId,
      label: row.stageName,
      order: Number.isFinite(row.stageOrder) ? row.stageOrder : Number.MAX_SAFE_INTEGER,
    };

    if (!existing) {
      stageInfo.set(row.stageId, candidate);
      continue;
    }

    if (candidate.order < existing.order) {
      existing.order = candidate.order;
    }

    if (!existing.label && candidate.label) {
      existing.label = candidate.label;
    }
  }

  let fallbackOrder = Math.max(0, ...Array.from(stageInfo.values()).map((stage) => stage.order || 0)) + 1;

  for (const row of attemptRows) {
    if (stageInfo.has(row.stageId)) {
      continue;
    }

    stageInfo.set(row.stageId, {
      id: row.stageId,
      label: row.stageName,
      order: fallbackOrder,
    });
    fallbackOrder += 1;
  }

  const usedKeys = new Set();

  return Array.from(stageInfo.values())
    .sort((left, right) => {
      if (left.order !== right.order) {
        return left.order - right.order;
      }

      return String(left.label || left.id).localeCompare(String(right.label || right.id));
    })
    .map((stage) => {
      const baseKey = slugifyStageKey(stage.label || stage.id);
      let dataKey = baseKey;
      let suffix = 2;

      while (usedKeys.has(dataKey)) {
        dataKey = `${baseKey}_${suffix}`;
        suffix += 1;
      }

      usedKeys.add(dataKey);

      return {
        id: stage.id,
        key: dataKey,
        label: stage.label || stage.id,
        order: stage.order,
      };
    });
}

function buildDateRange(lifecycleByFixture, attemptRows) {
  const dates = [];
  let hasOpenFixtures = false;

  for (const lifecycle of lifecycleByFixture.values()) {
    if (lifecycle.firstAssignedAt) {
      dates.push(lifecycle.firstAssignedAt);
    }
    if (lifecycle.lastApprovedAt) {
      dates.push(lifecycle.lastApprovedAt);
    }
    if (lifecycle.lastActivityAt) {
      dates.push(lifecycle.lastActivityAt);
    }
    if (!lifecycle.isComplete) {
      hasOpenFixtures = true;
    }
  }

  for (const attempt of attemptRows) {
    if (attempt.assignedAt) {
      dates.push(attempt.assignedAt);
    }
    if (attempt.completedAt) {
      dates.push(attempt.completedAt);
    }
    if (attempt.approvedAt) {
      dates.push(attempt.approvedAt);
    }
  }

  if (!dates.length) {
    return { start: null, end: null };
  }

  const sorted = dates
    .filter(Boolean)
    .sort((left, right) => left.getTime() - right.getTime());

  const today = startOfUtcDay(new Date());
  const start = startOfUtcDay(sorted[0]);
  const end = startOfUtcDay(hasOpenFixtures ? new Date(Math.max(today.getTime(), sorted[sorted.length - 1].getTime())) : sorted[sorted.length - 1]);

  return { start, end };
}

function buildFixtureLifecycle(stageRows, deadlinesByFixture) {
  const lifecycleByFixture = new Map();

  for (const row of stageRows) {
    if (!lifecycleByFixture.has(row.fixtureId)) {
      lifecycleByFixture.set(row.fixtureId, {
        fixtureId: row.fixtureId,
        fixtureNo: row.fixtureNo,
        deadlineAt: deadlinesByFixture.get(row.fixtureId) || null,
        stages: [],
      });
    }

    lifecycleByFixture.get(row.fixtureId).stages.push(row);
  }

  for (const lifecycle of lifecycleByFixture.values()) {
    lifecycle.stages.sort((left, right) => {
      if (left.stageOrder !== right.stageOrder) {
        return left.stageOrder - right.stageOrder;
      }

      return left.stageName.localeCompare(right.stageName);
    });

    const firstAssignedAt = lifecycle.stages
      .map((stage) => stage.stageAssignedAt)
      .filter(Boolean)
      .sort((left, right) => left.getTime() - right.getTime())[0] || null;

    const lastApprovedAt = lifecycle.stages
      .map((stage) => stage.stageApprovedAt)
      .filter(Boolean)
      .sort((left, right) => right.getTime() - left.getTime())[0] || null;

    const lastActivityAt = lifecycle.stages
      .flatMap((stage) => [
        stage.stageAssignedAt,
        stage.stageCompletedAt,
        stage.stageApprovedAt,
        stage.updatedAt,
      ])
      .filter(Boolean)
      .sort((left, right) => right.getTime() - left.getTime())[0] || null;

    lifecycle.firstAssignedAt = firstAssignedAt;
    lifecycle.lastApprovedAt = lastApprovedAt;
    lifecycle.lastActivityAt = lastActivityAt;
    lifecycle.isComplete = lifecycle.stages.length > 0
      && lifecycle.stages.every((stage) => stage.status === "APPROVED" || Boolean(stage.stageApprovedAt));
  }

  return lifecycleByFixture;
}

function resolveActiveStageKeyForDate(stages, snapshotDate) {
  for (const stage of stages) {
    if (stage.stageApprovedAt && stage.stageApprovedAt <= snapshotDate) {
      continue;
    }

    return stage.stageKey;
  }

  return null;
}

function listDateKeys(range) {
  if (!range.start || !range.end) {
    return [];
  }

  const dates = [];

  for (let cursor = range.start; cursor.getTime() <= range.end.getTime(); cursor = addUtcDays(cursor, 1)) {
    dates.push(toDateKey(cursor));
  }

  return dates;
}

async function buildAnalyticsContext() {
  const [stageResult, attemptResult, deadlineResult] = await Promise.all([
    pool.query(STAGE_ROWS_QUERY),
    pool.query(ATTEMPT_ROWS_QUERY),
    pool.query(FIXTURE_DEADLINES_QUERY),
  ]);

  const stageRows = stageResult.rows.map((row) => ({
    fixtureId: row.fixture_id,
    fixtureNo: row.fixture_no,
    departmentId: row.department_id,
    stageId: row.stage_key,
    stageName: row.stage_name,
    stageOrder: toNumber(row.stage_order),
    status: row.status,
    stageAssignedAt: toDate(row.stage_assigned_at),
    stageCompletedAt: toDate(row.stage_completed_at),
    stageApprovedAt: toDate(row.stage_approved_at),
    updatedAt: toDate(row.updated_at),
  }));

  const attemptRows = attemptResult.rows.map((row) => {
    const assignedAt = toDate(row.assigned_at);
    const completedAt = toDate(row.completed_at);
    const approvedAt = toDate(row.approved_at);
    const durationHours = computeDurationHours(
      assignedAt || row.started_at,
      approvedAt || completedAt,
      row.duration_minutes,
    );

    return {
      fixtureId: row.fixture_id,
      fixtureNo: row.fixture_no,
      departmentId: row.department_id,
      stageId: row.stage_key,
      stageName: row.stage_name,
      attemptNo: toNumber(row.attempt_no),
      status: row.status,
      assignedTo: row.assigned_to || null,
      designerName: row.designer_name || row.assigned_to || "Unassigned",
      assignedAt,
      completedAt,
      approvedAt,
      durationHours,
      expectedHours: row.expected_hours === null || row.expected_hours === undefined
        ? null
        : Number(row.expected_hours),
    };
  });

  const deadlinesByFixture = new Map(
    deadlineResult.rows.map((row) => [row.fixture_id, toDate(row.deadline_at)]),
  );

  const stageRegistry = buildStageRegistry(stageRows, attemptRows);
  const stageKeyMap = new Map(stageRegistry.map((stage) => [stage.id, stage.key]));

  for (const row of stageRows) {
    row.stageKey = stageKeyMap.get(row.stageId) || slugifyStageKey(row.stageName);
  }

  for (const row of attemptRows) {
    row.stageKey = stageKeyMap.get(row.stageId) || slugifyStageKey(row.stageName);
  }

  const lifecycleByFixture = buildFixtureLifecycle(stageRows, deadlinesByFixture);
  const range = buildDateRange(lifecycleByFixture, attemptRows);

  return {
    stageRows,
    attemptRows,
    stageRegistry,
    deadlinesByFixture,
    lifecycleByFixture,
    range,
  };
}

function ensureContext(context) {
  return context || buildAnalyticsContext();
}

function computeOnTimeDelivery(context) {
  const now = new Date();
  const eligibleFixtures = Array.from(context.lifecycleByFixture.values()).filter(
    (fixture) => fixture.deadlineAt && (fixture.isComplete || fixture.deadlineAt <= now),
  );

  if (!eligibleFixtures.length) {
    return {
      onTimePercent: 0,
      overdueCount: 0,
    };
  }

  let onTimeCount = 0;
  let overdueCount = 0;

  for (const fixture of eligibleFixtures) {
    const referenceAt = fixture.isComplete
      ? fixture.lastApprovedAt
      : now;

    if (fixture.isComplete && fixture.lastApprovedAt && fixture.lastApprovedAt <= fixture.deadlineAt) {
      onTimeCount += 1;
      continue;
    }

    if (referenceAt && referenceAt > fixture.deadlineAt) {
      overdueCount += 1;
    }
  }

  return {
    onTimePercent: round((onTimeCount / eligibleFixtures.length) * 100, 2),
    overdueCount,
  };
}

async function getThroughputAndWIP(context = null) {
  const analytics = await ensureContext(context);
  const throughputCounts = new Map();
  const completionTimes = [];
  const dateKeys = listDateKeys(analytics.range);

  for (const lifecycle of analytics.lifecycleByFixture.values()) {
    if (lifecycle.isComplete && lifecycle.lastApprovedAt) {
      const dateKey = toDateKey(lifecycle.lastApprovedAt);
      throughputCounts.set(dateKey, (throughputCounts.get(dateKey) || 0) + 1);

      if (lifecycle.firstAssignedAt && lifecycle.lastApprovedAt >= lifecycle.firstAssignedAt) {
        completionTimes.push(
          (lifecycle.lastApprovedAt.getTime() - lifecycle.firstAssignedAt.getTime()) / 3600000,
        );
      }
    }
  }

  const throughput = dateKeys.map((dateKey) => ({
    date: dateKey,
    completed: throughputCounts.get(dateKey) || 0,
  }));

  const wip = dateKeys.map((dateKey) => {
    const snapshotEnd = endOfUtcDay(new Date(`${dateKey}T00:00:00.000Z`));
    let count = 0;

    for (const lifecycle of analytics.lifecycleByFixture.values()) {
      if (!lifecycle.firstAssignedAt || lifecycle.firstAssignedAt > snapshotEnd) {
        continue;
      }

      if (!lifecycle.isComplete || !lifecycle.lastApprovedAt || lifecycle.lastApprovedAt > snapshotEnd) {
        count += 1;
      }
    }

    return { date: dateKey, count };
  });

  return {
    throughput,
    wip,
    avgCompletionTime: round(average(completionTimes), 2),
  };
}

async function getCumulativeFlow(context = null) {
  const analytics = await ensureContext(context);
  const dateKeys = listDateKeys(analytics.range);

  return dateKeys.map((dateKey) => {
    const snapshotEnd = endOfUtcDay(new Date(`${dateKey}T00:00:00.000Z`));
    const row = { date: dateKey };

    for (const stage of analytics.stageRegistry) {
      row[stage.key] = 0;
    }

    row.done = 0;

    for (const lifecycle of analytics.lifecycleByFixture.values()) {
      if (!lifecycle.firstAssignedAt || lifecycle.firstAssignedAt > snapshotEnd) {
        continue;
      }

      if (lifecycle.isComplete && lifecycle.lastApprovedAt && lifecycle.lastApprovedAt <= snapshotEnd) {
        row.done += 1;
        continue;
      }

      const activeStageKey = resolveActiveStageKeyForDate(lifecycle.stages, snapshotEnd);
      if (activeStageKey) {
        row[activeStageKey] += 1;
      }
    }

    return row;
  });
}

async function getReworkAnalysis(context = null) {
  const analytics = await ensureContext(context);
  const reworkCounts = new Map();
  let totalReworks = 0;

  for (const attempt of analytics.attemptRows) {
    if (attempt.status !== "REJECTED") {
      continue;
    }

    totalReworks += 1;
    reworkCounts.set(attempt.stageName, (reworkCounts.get(attempt.stageName) || 0) + 1);
  }

  return {
    totalReworks,
    reworkPerStage: Array.from(reworkCounts.entries())
      .map(([stage, count]) => ({ stage, count }))
      .sort((left, right) => {
        if (right.count !== left.count) {
          return right.count - left.count;
        }

        return left.stage.localeCompare(right.stage);
      }),
  };
}

async function getStageEfficiency(context = null) {
  const analytics = await ensureContext(context);
  const groups = new Map();

  for (const attempt of analytics.attemptRows) {
    if (!attempt.durationHours || attempt.durationHours <= 0) {
      continue;
    }

    if (!groups.has(attempt.stageId)) {
      groups.set(attempt.stageId, {
        stage: attempt.stageName,
        durations: [],
        activeTimes: [],
        delayTimes: [],
        delayed: 0,
        eligible: 0,
      });
    }

    const group = groups.get(attempt.stageId);
    const duration = attempt.durationHours;
    const expected = attempt.expectedHours;
    const activeTime = expected && expected > 0 ? Math.min(duration, expected) : duration;
    const delayTime = expected && expected > 0 ? Math.max(duration - expected, 0) : 0;

    group.durations.push(duration);
    group.activeTimes.push(activeTime);
    group.delayTimes.push(delayTime);

    if (expected && expected > 0) {
      group.eligible += 1;
      if (duration > expected) {
        group.delayed += 1;
      }
    }
  }

  return Array.from(groups.values())
    .map((group) => ({
      stage: group.stage,
      avgTime: round(average(group.durations), 2),
      delayRate: round(group.eligible > 0 ? (group.delayed / group.eligible) * 100 : 0, 2),
      activeTime: round(average(group.activeTimes), 2),
      delayTime: round(average(group.delayTimes), 2),
      attempts: group.durations.length,
    }))
    .sort((left, right) => {
      if (right.avgTime !== left.avgTime) {
        return right.avgTime - left.avgTime;
      }

      return left.stage.localeCompare(right.stage);
    });
}

async function getDesignerPerformance(context = null) {
  const analytics = await ensureContext(context);
  const designers = new Map();

  for (const attempt of analytics.attemptRows) {
    if (!attempt.assignedTo) {
      continue;
    }

    if (!designers.has(attempt.assignedTo)) {
      designers.set(attempt.assignedTo, {
        name: attempt.designerName,
        completed: 0,
        durations: [],
        reworks: 0,
        overdueEligible: 0,
        overdueCount: 0,
      });
    }

    const designer = designers.get(attempt.assignedTo);

    if (attempt.status === "APPROVED") {
      designer.completed += 1;
      if (attempt.durationHours && attempt.durationHours > 0) {
        designer.durations.push(attempt.durationHours);
      }

      if (attempt.expectedHours && attempt.expectedHours > 0) {
        designer.overdueEligible += 1;
        if (attempt.durationHours && attempt.durationHours > attempt.expectedHours) {
          designer.overdueCount += 1;
        }
      }
    }

    if (attempt.status === "REJECTED") {
      designer.reworks += 1;
    }
  }

  return Array.from(designers.values())
    .map((designer) => ({
      name: designer.name,
      completed: designer.completed,
      avgTime: round(average(designer.durations), 2),
      reworks: designer.reworks,
      overdueRate: round(
        designer.overdueEligible > 0
          ? (designer.overdueCount / designer.overdueEligible) * 100
          : 0,
        2,
      ),
    }))
    .filter((designer) => designer.completed > 0 || designer.reworks > 0)
    .sort((left, right) => {
      if (right.completed !== left.completed) {
        return right.completed - left.completed;
      }

      if (left.avgTime !== right.avgTime) {
        return left.avgTime - right.avgTime;
      }

      return left.name.localeCompare(right.name);
    });
}

async function getWorkflowHealthScore(context = null) {
  const analytics = await ensureContext(context);
  const throughputAndWip = await getThroughputAndWIP(analytics);
  const reworkAnalysis = await getReworkAnalysis(analytics);
  const stageEfficiency = await getStageEfficiency(analytics);

  const throughputValues = throughputAndWip.throughput.map((point) => point.completed);
  const recentThroughput = throughputValues.slice(-RECENT_THROUGHPUT_DAYS);
  const recentAverage = average(recentThroughput);
  const currentWip = throughputAndWip.wip.length
    ? throughputAndWip.wip[throughputAndWip.wip.length - 1].count
    : 0;
  const backlogDays = recentAverage > 0
    ? currentWip / recentAverage
    : currentWip > 0
      ? Number.POSITIVE_INFINITY
      : 0;

  const throughputScore = Number.isFinite(backlogDays)
    ? clamp(100 - Math.max(0, backlogDays - 2) * 12)
    : 0;

  const consistencyWindow = throughputValues.slice(-CONSISTENCY_WINDOW_DAYS);
  const consistencyScore = recentAverage > 0
    ? clamp(100 - ((standardDeviation(consistencyWindow) / recentAverage) * 100))
    : throughputValues.length > 0
      ? 35
      : 0;

  const approvedAttempts = analytics.attemptRows.filter((attempt) => attempt.status === "APPROVED").length;
  const reworkPenalty = clamp(
    approvedAttempts > 0
      ? (reworkAnalysis.totalReworks / approvedAttempts) * 100
      : reworkAnalysis.totalReworks > 0
        ? 100
        : 0,
  );

  const totalEligibleDelayedAttempts = analytics.attemptRows.filter(
    (attempt) => attempt.durationHours && attempt.expectedHours && attempt.expectedHours > 0,
  );
  const delayedAttempts = totalEligibleDelayedAttempts.filter(
    (attempt) => attempt.durationHours > attempt.expectedHours,
  ).length;

  const delayPenalty = clamp(
    totalEligibleDelayedAttempts.length > 0
      ? (delayedAttempts / totalEligibleDelayedAttempts.length) * 100
      : average(stageEfficiency.map((stage) => stage.delayRate)),
  );

  const score = clamp(
    Math.round(
      (throughputScore * 0.45) +
      (consistencyScore * 0.25) -
      (reworkPenalty * 0.15) -
      (delayPenalty * 0.15),
    ),
  );

  return {
    score,
    breakdown: {
      throughputScore: round(throughputScore, 2),
      reworkPenalty: round(reworkPenalty, 2),
      delayPenalty: round(delayPenalty, 2),
      consistencyScore: round(consistencyScore, 2),
    },
  };
}

async function getDesignerHeatmap(context = null) {
  const analytics = await ensureContext(context);
  const hourLabels = Array.from({ length: 24 }, (_, index) => index);
  const designers = new Map();

  for (const attempt of analytics.attemptRows) {
    const timestamp = attempt.approvedAt || attempt.completedAt;
    if (!attempt.assignedTo || !timestamp) {
      continue;
    }

    if (!designers.has(attempt.assignedTo)) {
      designers.set(attempt.assignedTo, {
        name: attempt.designerName,
        total: 0,
        values: new Array(24).fill(0),
      });
    }

    const row = designers.get(attempt.assignedTo);
    const hour = timestamp.getHours();

    row.values[hour] += 1;
    row.total += 1;
  }

  const designerRows = Array.from(designers.values())
    .sort((left, right) => {
      if (right.total !== left.total) {
        return right.total - left.total;
      }

      return left.name.localeCompare(right.name);
    })
    .map((row) => ({
      name: row.name,
      total: row.total,
      values: hourLabels.map((hour) => ({
        hour,
        value: row.values[hour],
      })),
    }));

  return {
    hours: hourLabels,
    maxValue: Math.max(0, ...designerRows.flatMap((row) => row.values.map((value) => value.value))),
    designers: designerRows,
  };
}

async function getWorkflowTimeline(context = null) {
  const analytics = await ensureContext(context);
  const fixtures = Array.from(analytics.lifecycleByFixture.values())
    .map((lifecycle) => {
      const segments = lifecycle.stages
        .filter((stage) => stage.stageAssignedAt)
        .map((stage) => {
          const start = stage.stageAssignedAt;
          const end = stage.stageApprovedAt || stage.stageCompletedAt || stage.updatedAt || stage.stageAssignedAt;
          const durationHours = end && start && end >= start
            ? (end.getTime() - start.getTime()) / 3600000
            : 0;

          return {
            stage: stage.stageName,
            stageKey: stage.stageKey,
            status: stage.status,
            start,
            end,
            durationHours: round(durationHours, 2),
          };
        })
        .filter((segment) => segment.start && segment.end)
        .sort((left, right) => left.start.getTime() - right.start.getTime());

      if (!segments.length) {
        return null;
      }

      const start = segments[0].start;
      const end = segments
        .map((segment) => segment.end)
        .sort((left, right) => right.getTime() - left.getTime())[0];

      return {
        fixtureId: lifecycle.fixtureId,
        fixtureNo: lifecycle.fixtureNo,
        start,
        end,
        totalHours: round((end.getTime() - start.getTime()) / 3600000, 2),
        lastActivityAt: lifecycle.lastActivityAt || end,
        segments,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.lastActivityAt.getTime() - left.lastActivityAt.getTime())
    .slice(0, TIMELINE_FIXTURE_LIMIT);

  if (!fixtures.length) {
    return {
      rangeStart: null,
      rangeEnd: null,
      fixtures: [],
    };
  }

  const rangeStart = fixtures
    .map((fixture) => fixture.start)
    .sort((left, right) => left.getTime() - right.getTime())[0];
  const rangeEnd = fixtures
    .map((fixture) => fixture.end)
    .sort((left, right) => right.getTime() - left.getTime())[0];

  return {
    rangeStart: rangeStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
    fixtures: fixtures.map((fixture) => ({
      fixtureId: fixture.fixtureId,
      fixtureNo: fixture.fixtureNo,
      start: fixture.start.toISOString(),
      end: fixture.end.toISOString(),
      totalHours: fixture.totalHours,
      segments: fixture.segments.map((segment) => ({
        stage: segment.stage,
        stageKey: segment.stageKey,
        status: segment.status,
        start: segment.start.toISOString(),
        end: segment.end.toISOString(),
        durationHours: segment.durationHours,
      })),
    })),
  };
}

async function getAnalyticsOverview() {
  const analytics = await buildAnalyticsContext();
  const [throughputAndWip, cumulativeFlow, reworkAnalysis, stageEfficiency, designerPerformance, workflowHealthScore, designerHeatmap, workflowTimeline] = await Promise.all([
    getThroughputAndWIP(analytics),
    getCumulativeFlow(analytics),
    getReworkAnalysis(analytics),
    getStageEfficiency(analytics),
    getDesignerPerformance(analytics),
    getWorkflowHealthScore(analytics),
    getDesignerHeatmap(analytics),
    getWorkflowTimeline(analytics),
  ]);

  const onTime = computeOnTimeDelivery(analytics);
  const currentThroughputWindow = throughputAndWip.throughput.slice(-RECENT_THROUGHPUT_DAYS);
  const latestWip = throughputAndWip.wip.length
    ? throughputAndWip.wip[throughputAndWip.wip.length - 1].count
    : 0;

  return {
    throughputAndWIP: throughputAndWip,
    cumulativeFlow,
    reworkAnalysis,
    stageEfficiency,
    designerPerformance,
    workflowHealthScore,
    onTimePercent: onTime.onTimePercent,
    overdueCount: onTime.overdueCount,
    stageMeta: analytics.stageRegistry.map((stage) => ({
      key: stage.key,
      label: stage.label,
      order: stage.order,
    })),
    heatmap: designerHeatmap,
    workflowTimeline,
    summary: {
      throughput: round(average(currentThroughputWindow.map((point) => point.completed)), 2),
      wip: latestWip,
      avgCompletionTime: throughputAndWip.avgCompletionTime,
      onTimePercent: onTime.onTimePercent,
      reworkCount: reworkAnalysis.totalReworks,
    },
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  getAnalyticsOverview,
  getCumulativeFlow,
  getDesignerPerformance,
  getStageEfficiency,
  getThroughputAndWIP,
  getReworkAnalysis,
  getWorkflowHealthScore,
};
