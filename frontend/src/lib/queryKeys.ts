export const authQueryKeys = {
  currentUser: ["auth", "current-user"] as const,
};

export const taskQueryKeys = {
  all: ["tasks"] as const,
  activity: (taskId: number) => ["tasks", taskId, "activity"] as const,
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
};

export const projectQueryKeys = {
  all: ["department-projects"] as const,
  designProjects: ["design", "projects"] as const,
  designScopes: (projectId: string) => ["design", "projects", projectId, "scopes"] as const,
  designInstances: (scopeId: string) => ["design", "scopes", scopeId, "instances"] as const,
};
