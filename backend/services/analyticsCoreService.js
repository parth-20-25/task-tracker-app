const { pool } = require("../db");
const { AppError } = require("../lib/AppError");
const { hasPermission } = require("./accessControlService");
const {
  getFixturesForScope,
  getFixturesForProject,
  getFixtureProgressRows,
  getFixtureAttemptRows,
} = require("./designReportService");

async function getWorkflowStages(departmentId) {
  const result = await pool.query(
    `SELECT stage_name, stage_order, workflow_name
     FROM workflow_definitions 
     WHERE department_id = $1 
     ORDER BY stage_order ASC`,
    [departmentId]
  );
  return result.rows;
}

async function buildFixtureAnalyticsDataset({ departmentId, scopeId, projectId }) {
  if (!departmentId) {
    // Attempt to resolve departmentId from scope or project if not provided
    // but usually it's passed from frontend
  }

  const workflowStages = await getWorkflowStages(departmentId || 'design');
  const stageNames = workflowStages.map(s => s.stage_name);
  const workflowName = workflowStages.length > 0 ? workflowStages[0].workflow_name : "Generic Workflow";

  let fixtures = [];
  if (scopeId) {
    fixtures = await getFixturesForScope(scopeId);
  } else if (projectId) {
    fixtures = await getFixturesForProject(projectId);
  } else {
    // Fallback or overall
    const result = await pool.query(`
      SELECT f.id as fixture_id, f.fixture_no, u.name as designer, u.employee_id as user_id,
             t.deadline as task_deadline, d.id as department_id
      FROM design.fixtures f
      LEFT JOIN tasks t ON t.fixture_id = f.id AND (t.stage = 'Release' OR t.stage = 'release')
      LEFT JOIN users u ON u.employee_id = t.assigned_user_id
      LEFT JOIN design.scopes s ON s.id = f.scope_id
      LEFT JOIN design.projects p ON p.id = s.project_id
      LEFT JOIN departments d ON d.id = p.department_id
      WHERE ($1::text IS NULL OR d.id = $1)
    `, [departmentId]);
    fixtures = result.rows.map(r => ({
      fixture_id: r.fixture_id,
      fixture_no: r.fixture_no,
      task_assignee_name: r.designer,
      user_id: r.user_id,
      task_deadline: r.task_deadline,
      department_id: r.department_id
    }));
  }

  const fixtureIds = fixtures.map((f) => f.fixture_id);
  const progressRows = await getFixtureProgressRows(fixtureIds);
  const attemptRows = await getFixtureAttemptRows(fixtureIds);

  const dataset = fixtures.map((fixture) => {
    const fProgress = progressRows.filter((r) => r.fixture_id === fixture.fixture_id);
    const fAttempts = attemptRows.filter((r) => r.fixture_id === fixture.fixture_id);

    const stages = workflowStages.map(ws => {
      const pr = fProgress.find(p => p.stage_name === ws.stage_name);
      const atts = fAttempts.filter(a => a.stage_name === ws.stage_name);
      const maxAttempt = atts.reduce((max, a) => Math.max(max, Number(a.attempt_no) || 1), 0);

      return {
        stage_name: ws.stage_name,
        assigned_at: pr ? (pr.assigned_at || pr.started_at || null) : null,
        completed_at: pr ? (pr.completed_at || null) : null,
        duration: pr ? (Number(pr.duration_minutes) || 0) : 0,
        attempts: maxAttempt || (pr ? 1 : 0)
      };
    });

    const finalStage = stages[stages.length - 1];
    const final_completed_at = finalStage?.completed_at || null;
    
    let total_reworks = 0;
    let total_duration = 0;

    stages.forEach((st) => {
      if (st.attempts > 1) {
        total_reworks += st.attempts - 1;
      }
      total_duration += st.duration;
    });

    let is_delayed = false;
    let delay_minutes = 0;
    let delay_caused_by_stage = null;
    const deadline = fixture.task_deadline || null;

    if (final_completed_at && deadline) {
      const cd = new Date(final_completed_at).getTime();
      const dd = new Date(deadline).getTime();
      if (cd > dd) {
        is_delayed = true;
        delay_minutes = Math.round((cd - dd) / 60000);
        for (const st of stages) {
          if (st.completed_at && new Date(st.completed_at).getTime() > dd) {
            delay_caused_by_stage = st.stage_name;
            break;
          }
        }
      }
    }

    return {
      entity_id: fixture.fixture_id,
      fixture_no: fixture.fixture_no,
      department_id: fixture.department_id || departmentId,
      workflow_name: workflowName,
      user_id: fixture.user_id,
      user_name: fixture.task_assignee_name || "Unknown",
      deadline,
      stages,
      final_completed_at,
      total_duration,
      total_reworks,
      is_delayed,
      delay_minutes,
      delay_caused_by_stage,
    };
  });

  return dataset;
}

async function getAnalyticsOverview(filters, user) {
  const requestedDepartmentId = filters.departmentId;
  const resolvedDepartmentId = requestedDepartmentId
    ?? (hasPermission(user, "view_all_departments_analytics") ? null : user.department_id);
  const { userId } = filters;
  const isOverall = resolvedDepartmentId === 'overall' || !resolvedDepartmentId;
  const isSelf = userId === 'self' || (!userId && !hasPermission(user, "view_all_users_analytics"));

  // Permission Checks
  if (isOverall) {
    if (!hasPermission(user, "view_all_departments_analytics")) {
      throw new AppError(403, "Access Denied: view_all_departments_analytics required for overall view");
    }
  } else {
    // If not admin and trying to view another department
    if (user.department_id !== resolvedDepartmentId && !hasPermission(user, "view_all_departments_analytics")) {
      throw new AppError(403, "Access Denied: Cannot view other department analytics");
    }
    if (!hasPermission(user, "view_department_analytics") && !isSelf) {
       throw new AppError(403, "Access Denied: view_department_analytics required");
    }
  }

  const dataset = await buildFixtureAnalyticsDataset({
    ...filters,
    departmentId: isOverall ? null : resolvedDepartmentId,
  });
  const workflowStages = await getWorkflowStages(isOverall ? 'design' : (resolvedDepartmentId || 'design'));
  const stageNames = workflowStages.map(s => s.stage_name);

  // Filter dataset based on permissions
  let filteredDataset = dataset;
  if (!hasPermission(user, "view_all_users_analytics")) {
    const currentUserId = user.employee_id;
    // We always keep self
    const selfData = dataset.filter(d => d.user_id === currentUserId);
    
    if (hasPermission(user, "view_department_analytics")) {
      // Get User Performance to find top 5
      const performance = await getUserPerformance({ departmentId: resolvedDepartmentId || user.department_id }, user);
      const top5UserIds = performance.designers.slice(0, 5).map(d => d.user_id);
      
      filteredDataset = dataset.filter(d => 
        d.user_id === currentUserId || top5UserIds.includes(d.user_id)
      );
    } else {
      filteredDataset = selfData;
    }
  }

  if (isOverall) {
    // Cross-department comparison
    const deptGroups = {};
    dataset.forEach(d => {
      const dept = d.department_id || 'Unknown';
      if (!deptGroups[dept]) deptGroups[dept] = [];
      deptGroups[dept].push(d);
    });

    const departments = (await Promise.all(Object.entries(deptGroups).map(async ([deptId, items]) => {
      try {
        const health = await getWorkflowHealth({ departmentId: deptId }, user, items);
        return {
          department: deptId,
          workflow_health: health.overall_score,
          on_time_rate: health.raw.on_time_rate,
          rework_rate: health.raw.rework_rate
        };
      } catch (err) {
        console.error(`[Analytics] Failed to aggregate metrics for department ${deptId}:`, err.message);
        return null;
      }
    }))).filter(Boolean);

    return { departments };
  }

  // Single Department/User View
  const rework_by_stage = {};
  const stageDurationSum = {};
  const stageDurationCount = {};
  stageNames.forEach(name => {
    rework_by_stage[name] = 0;
    stageDurationSum[name] = 0;
    stageDurationCount[name] = 0;
  });

  const userReworkMap = {};
  let on_time = 0;
  let delayed = 0;
  let total_delay_minutes = 0;
  const delay_by_stage = {};

  filteredDataset.forEach((d) => {
    if (!d.stages || !Array.isArray(d.stages)) return;

    d.stages.forEach(st => {
      const extraAttempts = st.attempts > 1 ? st.attempts - 1 : 0;
      if (extraAttempts > 0) {
        rework_by_stage[st.stage_name] = (rework_by_stage[st.stage_name] || 0) + extraAttempts;
      }
      if (st.duration > 0) {
        stageDurationSum[st.stage_name] = (stageDurationSum[st.stage_name] || 0) + st.duration;
        stageDurationCount[st.stage_name] = (stageDurationCount[st.stage_name] || 0) + 1;
      }
    });

    if (d.total_reworks > 0) {
      userReworkMap[d.user_name] = (userReworkMap[d.user_name] || 0) + d.total_reworks;
    }

    if (d.final_completed_at) {
      if (d.is_delayed) {
        delayed += 1;
        total_delay_minutes += d.delay_minutes;
        if (d.delay_caused_by_stage) {
          delay_by_stage[d.delay_caused_by_stage] = (delay_by_stage[d.delay_caused_by_stage] || 0) + 1;
        }
      } else {
        on_time += 1;
      }
    }
  });

  const by_user = Object.entries(userReworkMap).map(([name, reworks]) => ({ name, reworks }));
  const avg_stage_duration = {};
  let bottleneck_stage = "UNKNOWN";
  let maxAvgDur = -1;

  stageNames.forEach(name => {
    const count = stageDurationCount[name];
    if (count > 0) {
      const avgDur = Math.round(stageDurationSum[name] / count);
      avg_stage_duration[name] = avgDur;
      if (avgDur > maxAvgDur) {
        maxAvgDur = avgDur;
        bottleneck_stage = name;
      }
    }
  });

  return {
    rework: {
      by_stage: rework_by_stage,
      by_user,
    },
    deadline: {
      on_time,
      delayed,
      avg_delay_minutes: delayed > 0 ? Math.round(total_delay_minutes / delayed) : 0,
      delay_by_stage,
    },
    efficiency: {
      avg_stage_duration,
      bottleneck_stage,
    },
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CREDIBILITY_TOLERANCE_MINUTES = 120; // ±2 hours
const LATE_BOUNDARY_MINUTES = 120;         // >+2h = late
const SEVERE_BOUNDARY_MINUTES = 1440;      // >+24h = severe

const ORDERED_STAGE_BUCKETS = ["concept", "dap", "three_d_finish", "two_d_finish"];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeMedian(sortedNumbers) {
  if (!sortedNumbers.length) return 0;
  const mid = Math.floor(sortedNumbers.length / 2);
  return sortedNumbers.length % 2 !== 0
    ? sortedNumbers[mid]
    : Math.round((sortedNumbers[mid - 1] + sortedNumbers[mid]) / 2);
}

function classifyErrorBucket(errorMinutes) {
  if (errorMinutes <= -CREDIBILITY_TOLERANCE_MINUTES) return "early";
  if (errorMinutes <= LATE_BOUNDARY_MINUTES) return "on_target";
  if (errorMinutes <= SEVERE_BOUNDARY_MINUTES) return "late";
  return "severe";
}

// ─── getDeadlineHonesty ───────────────────────────────────────────────────────

async function getDeadlineHonesty(filters, user) {
  const dataset = await buildFixtureAnalyticsDataset(filters);

  // Filter based on permissions if needed
  let filteredDataset = dataset;
  if (!hasPermission(user, "view_all_users_analytics") && !hasPermission(user, "view_department_analytics")) {
    filteredDataset = dataset.filter(d => d.user_id === user.employee_id);
  }

  // Only fixtures with both a deadline and an actual completion timestamp are measurable
  const measurable = filteredDataset.filter((d) => d.deadline && d.final_completed_at);

  if (!measurable.length) {
    return {
      summary: { total: 0, on_time: 0, delayed: 0, credibility_score: 0 },
      error_distribution: { early: 0, on_target: 0, late: 0, severe: 0 },
      error_stats: { avg_error_minutes: 0, median_error_minutes: 0, max_delay_minutes: 0 },
      delay_origin: {},
      by_user: [],
    };
  }

  const errorDistribution = { early: 0, on_target: 0, late: 0, severe: 0 };
  const delayOrigin = {};
  const userMap = new Map();
  const allErrors = [];

  let onTime = 0;
  let delayed = 0;
  let credibleCount = 0;

  measurable.forEach((d) => {
    const deadlineMs = new Date(d.deadline).getTime();
    const completedMs = new Date(d.final_completed_at).getTime();
    const errorMinutes = Math.round((completedMs - deadlineMs) / 60000);

    allErrors.push(errorMinutes);

    // 1. Delivery accuracy
    if (errorMinutes <= 0) {
      onTime += 1;
    } else {
      delayed += 1;
    }

    // 2. Credibility
    if (Math.abs(errorMinutes) <= CREDIBILITY_TOLERANCE_MINUTES) {
      credibleCount += 1;
    }

    // 3. Error distribution
    const bucket = classifyErrorBucket(errorMinutes);
    errorDistribution[bucket] += 1;

    // 4. Delay origin — first stage whose completed_at already exceeded the deadline
    if (errorMinutes > 0) {
      for (const st of d.stages) {
        if (st.completed_at) {
          const stageDoneMs = new Date(st.completed_at).getTime();
          if (stageDoneMs > deadlineMs) {
            delayOrigin[st.stage_name] = (delayOrigin[st.stage_name] || 0) + 1;
            break;
          }
        }
      }
    }

    // 5. Per-user accumulation
    const userName = d.user_name || "Unknown";
    const userId = d.user_id;
    if (!userMap.has(userId)) {
      userMap.set(userId, { name: userName, totalError: 0, count: 0, credible: 0, late: 0 });
    }
    const ds = userMap.get(userId);
    ds.totalError += errorMinutes;
    ds.count += 1;
    if (Math.abs(errorMinutes) <= CREDIBILITY_TOLERANCE_MINUTES) ds.credible += 1;
    if (errorMinutes > LATE_BOUNDARY_MINUTES) ds.late += 1;
  });

  // 6. Error stats
  const sortedErrors = [...allErrors].sort((a, b) => a - b);
  const avgError = Math.round(allErrors.reduce((s, v) => s + v, 0) / allErrors.length);
  const medianError = computeMedian(sortedErrors);
  const maxDelay = Math.max(0, ...allErrors);

  // 7. Per-user — sorted worst → best (highest avg error first)
  const byUser = Array.from(userMap.entries())
    .map(([userId, stats]) => ({
      user_id: userId,
      name: stats.name,
      avg_error_minutes: Math.round(stats.totalError / stats.count),
      credibility_score: parseFloat((stats.credible / stats.count).toFixed(3)),
      late_rate: parseFloat((stats.late / stats.count).toFixed(3)),
    }))
    .sort((a, b) => b.avg_error_minutes - a.avg_error_minutes);

  const credibilityScore = parseFloat((credibleCount / measurable.length).toFixed(3));

  return {
    summary: {
      total: measurable.length,
      on_time: onTime,
      delayed,
      credibility_score: credibilityScore,
    },
    error_distribution: errorDistribution,
    error_stats: {
      avg_error_minutes: avgError,
      median_error_minutes: medianError,
      max_delay_minutes: maxDelay,
    },
    delay_origin: delayOrigin,
    by_user: byUser,
  };
}

async function getUserPerformance(filters, user) {
  const dataset = await buildFixtureAnalyticsDataset(filters);
  const workflowStages = await getWorkflowStages(filters.departmentId || user.department_id || 'design');
  const stageNames = workflowStages.map(s => s.stage_name);

  if (!dataset.length) {
    return {
      designers: [],
      users: [],
      team_summary: {
        total_users: 0,
        avg_score: 0,
        best_performer: null,
        highest_rework_risk: null
      }
    };
  }

  const userStats = new Map();

  // 1. Group metrics by user
  dataset.forEach((d) => {
    const userId = d.user_id;
    const userName = d.user_name || "Unknown";
    if (!userStats.has(userId)) {
      const initialStageSums = {};
      const initialStageCounts = {};
      stageNames.forEach(name => {
        initialStageSums[name] = 0;
        initialStageCounts[name] = 0;
      });

      userStats.set(userId, {
        user_id: userId,
        name: userName,
        fixtures_completed: 0,
        total_duration: 0,
        stage_sums: initialStageSums,
        stage_counts: initialStageCounts,
        total_reworks: 0,
        measurable_deadlines: 0,
        on_time_count: 0,
        planning_error_sum: 0,
      });
    }

    const ds = userStats.get(userId);

    if (d.final_completed_at) {
      ds.fixtures_completed += 1;
      ds.total_duration += d.total_duration;
      ds.total_reworks += d.total_reworks;

      d.stages.forEach((st) => {
        if (st.duration > 0) {
          ds.stage_sums[st.stage_name] = (ds.stage_sums[st.stage_name] || 0) + st.duration;
          ds.stage_counts[st.stage_name] = (ds.stage_counts[st.stage_name] || 0) + 1;
        }
      });

      if (d.deadline) {
        ds.measurable_deadlines += 1;
        if (!d.is_delayed) {
          ds.on_time_count += 1;
        }
        
        const completedMs = new Date(d.final_completed_at).getTime();
        const deadlineMs = new Date(d.deadline).getTime();
        const errorMin = Math.round((completedMs - deadlineMs) / 60000);
        ds.planning_error_sum += errorMin;
      }
    }
  });

  // 2. Compute raw averages
  const rawUsers = Array.from(userStats.entries())
    .filter(([_, stats]) => stats.fixtures_completed > 0)
    .map(([userId, stats]) => {
      const avg_duration_minutes = Math.round(stats.total_duration / stats.fixtures_completed);
      const rework_rate = parseFloat((stats.total_reworks / stats.fixtures_completed).toFixed(2));
      const on_time_rate = stats.measurable_deadlines > 0 
        ? parseFloat((stats.on_time_count / stats.measurable_deadlines).toFixed(2)) 
        : 0;
      const avg_planning_error_minutes = stats.measurable_deadlines > 0 
        ? Math.round(stats.planning_error_sum / stats.measurable_deadlines) 
        : 0;

      const avg_stage_duration = {};
      Object.keys(stats.stage_sums).forEach(stage => {
        avg_stage_duration[stage] = stats.stage_counts[stage] > 0 
          ? Math.round(stats.stage_sums[stage] / stats.stage_counts[stage]) 
          : 0;
      });

      return {
        user_id: userId,
        name: stats.name,
        fixtures_completed: stats.fixtures_completed,
        avg_duration_minutes,
        avg_stage_duration,
        rework_rate,
        on_time_rate,
        avg_planning_error_minutes,
      };
    });

  if (!rawUsers.length) {
    return {
      designers: [],
      users: [],
      team_summary: {
        total_users: 0,
        avg_score: 0,
        best_performer: null,
        highest_rework_risk: null,
      },
    };
  }

  // 3. Normalization (min-max)
  const maxThroughput = Math.max(...rawUsers.map(d => d.fixtures_completed), 1);
  const minAvgDur = Math.min(...rawUsers.map(d => d.avg_duration_minutes));
  const maxAvgDur = Math.max(...rawUsers.map(d => d.avg_duration_minutes), minAvgDur + 1);
  const minRework = Math.min(...rawUsers.map(d => d.rework_rate));
  const maxRework = Math.max(...rawUsers.map(d => d.rework_rate), minRework + 0.01);
  const minError = Math.min(...rawUsers.map(d => Math.abs(d.avg_planning_error_minutes)));
  const maxError = Math.max(...rawUsers.map(d => Math.abs(d.avg_planning_error_minutes)), minError + 1);

  // Compute medians / quartiles for classification
  const sortedSpeed = [...rawUsers].sort((a,b) => a.avg_duration_minutes - b.avg_duration_minutes);
  const fastQuartileDur = sortedSpeed[Math.floor(sortedSpeed.length * 0.25)]?.avg_duration_minutes || maxAvgDur;
  const slowQuartileDur = sortedSpeed[Math.floor(sortedSpeed.length * 0.75)]?.avg_duration_minutes || minAvgDur;
  
  const sortedRework = [...rawUsers].sort((a,b) => a.rework_rate - b.rework_rate);
  const medianRework = sortedRework[Math.floor(sortedRework.length * 0.5)]?.rework_rate || 0;
  const highReworkQuartile = sortedRework[Math.floor(sortedRework.length * 0.75)]?.rework_rate || 0;

  // 4. Score and Classify
  const users = rawUsers.map(d => {
    // Throughput (higher is better)
    const t_norm = d.fixtures_completed / maxThroughput;
    
    // Efficiency (lower duration is better)
    const e_norm = 1 - ((d.avg_duration_minutes - minAvgDur) / (maxAvgDur - minAvgDur));
    
    // Quality (lower rework is better)
    const q_norm = 1 - ((d.rework_rate - minRework) / (maxRework - minRework));

    // Reliability (combination of on-time rate and low planning error magnitude)
    const error_norm = 1 - ((Math.abs(d.avg_planning_error_minutes) - minError) / (maxError - minError));
    const r_norm = (d.on_time_rate * 0.6) + (error_norm * 0.4);

    // Composite 
    // 30% Throughput, 25% Efficiency, 25% Quality, 20% Reliability
    let score = (0.30 * t_norm) + (0.25 * e_norm) + (0.25 * q_norm) + (0.20 * r_norm);
    
    // Penalty for 0 completed measurable deadlines to not skew score too high based on subset data
    if(d.fixtures_completed < 3) {
      score = score * 0.8;
    }

    const performance_score = parseFloat(score.toFixed(3));

    // Determine Classification
    let classification = "Average";
    if (performance_score >= 0.75) {
      classification = "High Performer";
    } else if (d.avg_duration_minutes <= fastQuartileDur && d.rework_rate > medianRework) {
      classification = "Fast but Careless";
    } else if (d.avg_duration_minutes >= slowQuartileDur && d.rework_rate <= medianRework) {
      classification = "Careful but Slow";
    } else if (d.rework_rate >= highReworkQuartile && d.rework_rate > 0) {
      classification = "High Rework Risk";
    } else if (d.on_time_rate < 0.5) {
      if (Math.abs(d.avg_planning_error_minutes) > 480) {
        classification = "Planning Issue";
      } else {
        classification = "Execution Issue";
      }
    }

    return { ...d, performance_score, classification };
  });

  // Sort highest score first
  users.sort((a, b) => b.performance_score - a.performance_score);

  // 5. Team Summary
  let avg_score = 0;
  if(users.length > 0) {
     avg_score = users.reduce((acc, d) => acc + d.performance_score, 0) / users.length;
  }
  
  let highest_rework_risk = null;
  const reworkSorted = [...users].filter(d => d.rework_rate > 0).sort((a,b) => b.rework_rate - a.rework_rate);
  if(reworkSorted.length > 0) {
    highest_rework_risk = reworkSorted[0].name;
  }

  return {
    designers: users, // keep designers key for compatibility if needed, but the prompt said rename module to user_performance
    users,
    team_summary: {
      total_users: users.length,
      avg_score: parseFloat(avg_score.toFixed(3)),
      best_performer: users.length > 0 ? users[0].name : null,
      highest_rework_risk
    }
  };
}

// ─── getWorkflowHealth ────────────────────────────────────────────────────────

/**
 * Clamp a value to [0, 100] and round to nearest integer.
 */
function clamp100(v) {
  return Math.round(Math.min(100, Math.max(0, v)));
}

/**
 * Normalize a value within [min, max] to a 0-100 scale.
 * lower_is_better = true  → min maps to 100, max maps to 0
 * lower_is_better = false → min maps to 0,   max maps to 100
 * When min ≈ max (single observation or no variance) return neutral sentinel 75.
 */
function normalize(value, min, max, lowerIsBetter) {
  if (Math.abs(max - min) < 1e-9) return 75;
  const ratio = (value - min) / (max - min);
  return clamp100(lowerIsBetter ? (1 - ratio) * 100 : ratio * 100);
}

/**
 * Compute population standard deviation of an array of numbers.
 */
function stdDev(arr) {
  if (!arr.length) return 0;
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / arr.length;
  return Math.sqrt(variance);
}

async function getWorkflowHealth(filters, user, precomputedDataset = null) {
  const dataset = precomputedDataset || await buildFixtureAnalyticsDataset(filters);

  // Filter based on permissions
  let filteredDataset = dataset;
  if (!precomputedDataset && !hasPermission(user, "view_all_users_analytics") && !hasPermission(user, "view_department_analytics")) {
    filteredDataset = dataset.filter(d => d.user_id === user.employee_id);
  }

  // Only completed fixtures contribute meaningful signal
  const completed = filteredDataset.filter((d) => d.final_completed_at);

  if (!completed.length) {
    return {
      overall_score: 0,
      breakdown: { efficiency: 0, quality: 0, reliability: 0, stability: 0 },
      status: "CRITICAL",
      weakest_dimension: "efficiency",
      raw: {
        avg_duration_minutes: 0,
        rework_rate: 0,
        on_time_rate: 0,
        planning_error_std_dev: 0,
        fixture_count: 0,
        measurable_count: 0,
      },
    };
  }

  // ── 1. Raw signal extraction ──────────────────────────────────────────────

  const durations = completed.map((d) => d.total_duration);
  const avgDuration = durations.reduce((s, v) => s + v, 0) / durations.length;

  const totalReworks = completed.reduce((s, d) => s + d.total_reworks, 0);
  const reworkRate = totalReworks / completed.length;

  // Measurable = has deadline AND completion timestamp
  const measurable = completed.filter((d) => d.deadline && d.final_completed_at);
  const onTimeCount = measurable.filter((d) => !d.is_delayed).length;
  const onTimeRate = measurable.length > 0 ? onTimeCount / measurable.length : 0;

  // Planning error per fixture (signed minutes: positive = late, negative = early)
  const planningErrors = measurable.map((d) => {
    const completedMs = new Date(d.final_completed_at).getTime();
    const deadlineMs = new Date(d.deadline).getTime();
    return Math.round((completedMs - deadlineMs) / 60000);
  });
  const planningErrorStdDev = stdDev(planningErrors);

  // ── 2. Normalization to 0–100 ─────────────────────────────────────────────

  // Efficiency: lower avg duration → higher score
  const minDur = Math.min(...durations);
  const maxDur = Math.max(...durations);
  const efficiencyScore = normalize(avgDuration, minDur, maxDur, true);

  // Quality: lower rework rate → higher score
  const qualityScore = clamp100(100 - reworkRate * 100);

  // Reliability: on-time rate directly maps to 0–100
  const reliabilityScore = clamp100(onTimeRate * 100);

  // Stability: lower planning error std dev → higher score
  const stdDevCap = 10080;
  const cappedStdDev = Math.min(planningErrorStdDev, stdDevCap);
  const stabilityScore = clamp100(100 - (cappedStdDev / stdDevCap) * 100);

  // ── 3. Weighted composite ─────────────────────────────────────────────────

  const overallScore = clamp100(
    0.30 * efficiencyScore +
    0.25 * qualityScore +
    0.25 * reliabilityScore +
    0.20 * stabilityScore
  );

  // ── 4. Status classification ─────────────────────────────────────────────

  let status;
  if (overallScore >= 80) status = "HEALTHY";
  else if (overallScore >= 60) status = "MODERATE";
  else if (overallScore >= 40) status = "UNSTABLE";
  else status = "CRITICAL";

  // ── 5. Weakest dimension ─────────────────────────────────────────────────

  const pillars = {
    efficiency: efficiencyScore,
    quality: qualityScore,
    reliability: reliabilityScore,
    stability: stabilityScore,
  };
  const weakestDimension = Object.entries(pillars).reduce(
    (a, b) => (b[1] < a[1] ? b : a)
  )[0];

  return {
    overall_score: overallScore,
    breakdown: {
      efficiency: efficiencyScore,
      quality: qualityScore,
      reliability: reliabilityScore,
      stability: stabilityScore,
    },
    status,
    weakest_dimension: weakestDimension,
    raw: {
      avg_duration_minutes: Math.round(avgDuration),
      rework_rate: parseFloat(reworkRate.toFixed(3)),
      on_time_rate: parseFloat(onTimeRate.toFixed(3)),
      planning_error_std_dev: Math.round(planningErrorStdDev),
      fixture_count: completed.length,
      measurable_count: measurable.length,
    },
  };
}

module.exports = {
  buildFixtureAnalyticsDataset,
  getAnalyticsOverview,
  getDeadlineHonesty,
  getUserPerformance,
  getWorkflowHealth,
};
