import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/ApiError";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => !(error instanceof ApiError && [401, 403, 404].includes(error.status)) && failureCount < 3,
    },
  },
});
