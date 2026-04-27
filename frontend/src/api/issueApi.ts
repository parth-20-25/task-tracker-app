import { apiRequest } from "@/api/http";
import { Issue, IssueComment, IssuePriority, IssueStatus } from "@/types";

export type IssueTarget = "higher_ups" | "admin" | "specific_user";

export interface CreateIssuePayload {
  title: string;
  description: string;
  priority?: IssuePriority;
  target: IssueTarget;
  assigned_to?: string;
}

export function createIssue(payload: CreateIssuePayload) {
  return apiRequest<{ issues: Issue[] }>("/issues", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchMyIssues() {
  return apiRequest<Issue[]>("/issues/my");
}

export function fetchAssignedIssues() {
  return apiRequest<Issue[]>("/issues/assigned");
}

export function fetchIssueComments(issueId: string) {
  return apiRequest<IssueComment[]>(`/issues/${issueId}/comments`);
}

export function addIssueComment(issueId: string, message: string) {
  return apiRequest<IssueComment>(`/issues/${issueId}/comment`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

export function updateIssueStatus(issueId: string, status: IssueStatus) {
  return apiRequest<Issue>(`/issues/${issueId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}
