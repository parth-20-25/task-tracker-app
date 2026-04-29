import { createContext, useContext } from "react";
import { Role, User } from "@/types";
import type { UiAccess } from "@/lib/permissions";

interface LoginResult {
  success: boolean;
  error?: string;
}

export interface AuthContextType {
  user: User | null;
  role: Role | null;
  access: UiAccess;
  login: (employeeId: string, password: string) => Promise<LoginResult>;
  logout: () => void;
  isAuthenticated: boolean;
  isReady: boolean;
  hasPermission: (permission: string) => boolean;
  refreshSession: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);

  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return ctx;
}
