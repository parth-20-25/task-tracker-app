export const authQueryKeys = {
  currentUser: ["auth", "current-user"] as const,
};

export const taskQueryKeys = {
  all: ["tasks"] as const,
  activity: (taskId: number) => ["tasks", taskId, "activity"] as const,
  verificationQueue: ["tasks", "verification-queue"] as const,
};

export const adminQueryKeys = {
  users: (scope: "accessible" | "assignable") => ["admin", "users", scope] as const,
  roles: ["admin", "roles"] as const,
  departments: ["admin", "departments"] as const,
  auditLogs: ["admin", "audit-logs"] as const,
  kpiDefinitions: ["admin", "kpi-definitions"] as const,
  escalationRules: ["admin", "escalation-rules"] as const,
};

export const notificationQueryKeys = {
  all: ["notifications"] as const,
};

export const analyticsQueryKeys = {
  all: ["analytics"] as const,
  root: ["analytics"] as const,
  context: ["analytics", "context"] as const,
  overview: (departmentId: string) => ["analytics", "overview", departmentId] as const,
  users: (departmentId: string) => ["analytics", "users", departmentId] as const,
  departments: (departmentId: string) => ["analytics", "departments", departmentId] as const,
  userDrilldown: (userId: string) => ["analytics", "user", userId] as const,
};

export const analyticsOverviewQueryKeys = {
  all: ["analytics", "unified-overview"] as const,
  filtered: (filters: any) => ["analytics", "unified-overview", filters] as const,
};

export const deadlineHonestyQueryKeys = {
  all: ["analytics", "deadline-honesty"] as const,
  filtered: (filters: any) => ["analytics", "deadline-honesty", filters] as const,
};

export const userPerformanceQueryKeys = {
  all: ["analytics", "user-performance"] as const,
  filtered: (filters: any) => ["analytics", "user-performance", filters] as const,
};

export const workflowHealthQueryKeys = {
  all: ["analytics", "workflow-health"] as const,
  filtered: (filters: any) => ["analytics", "workflow-health", filters] as const,
};

export const predictiveInsightsQueryKeys = {
  all: ["analytics", "predictive-insights"] as const,
  filtered: (filters: any) => ["analytics", "predictive-insights", filters] as const,
};


export const projectQueryKeys = {
  all: ["department-projects"] as const,
  designProjectsRoot: ["design", "projects"] as const,
  designProjects: (departmentId = "self") => ["design", "projects", departmentId] as const,
  designScopes: (projectId: string, departmentId = "self") => ["design", "projects", departmentId, projectId, "scopes"] as const,
  designInstances: (scopeId: string) => ["design", "scopes", scopeId, "instances"] as const,
};

export const batchQueryKeys = {
  all: ["batches"] as const,
};

export const issueQueryKeys = {
  my: ["issues", "my"] as const,
  assigned: ["issues", "assigned"] as const,
  comments: (issueId: string) => ["issues", issueId, "comments"] as const,
};
