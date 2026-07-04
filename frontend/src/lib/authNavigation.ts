interface RedirectLocation {
  pathname?: string;
  search?: string;
  hash?: string;
}

interface RedirectState {
  from?: RedirectLocation;
}

export function getPostLoginRedirectPath(state: unknown) {
  const from = (state as RedirectState | null)?.from;

  if (!from?.pathname || from.pathname === "/login" || !from.pathname.startsWith("/")) {
    return "/";
  }

  return `${from.pathname}${from.search ?? ""}${from.hash ?? ""}`;
}
