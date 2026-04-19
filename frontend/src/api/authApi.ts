import { apiRequest } from "@/api/http";
import { User } from "@/types";

interface AuthResponse {
  token: string;
  user: User;
}

export function loginRequest(employeeId: string, password: string) {
  return apiRequest<AuthResponse>("/login", {
    method: "POST",
    body: JSON.stringify({
      employee_id: employeeId,
      password,
    }),
  });
}

export async function getCurrentUser() {
  const response = await apiRequest<{ user: User }>("/me");
  return response.user;
}
