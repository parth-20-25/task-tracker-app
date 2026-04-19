import { v4 as uuidv4 } from "uuid";

export function generateUUID(): string {
  try {
    return uuidv4();
  } catch {
    return Math.random().toString(36).substring(2, 10);
  }
}
