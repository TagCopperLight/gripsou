import { useEffect } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { useAuth } from "./auth/context";
import { setUnauthorizedHandler } from "./api/client";
import { ErrorToasts } from "./shell/ErrorToasts";
import { ShellSkeleton } from "./shell/RootLayout";

function InnerApp() {
  const auth = useAuth();

  // Route guards only re-run on render, so invalidate when auth flips to make the current match redirect.
  useEffect(() => {
    void router.invalidate();
  }, [auth.isBootstrapping, auth.isAuthenticated, auth.user?.welcomeDone]);

  return <RouterProvider router={router} context={{ auth }} />;
}

/** The page at `pathname` needs nothing of the user, so it can draw and load while a saved session is checked. */
function drawnBeforeSession(pathname: string): boolean {
  return router.matchRoutes(pathname).some((m) => m.staticData.beforeSession);
}

export function App() {
  const auth = useAuth();
  // A stored token the server refuses is cleared by the bootstrap itself.
  useEffect(() => {
    if (auth.isBootstrapping) return;
    setUnauthorizedHandler(() => {
      auth.logout();
      router.navigate({ to: "/login" });
    });
  }, [auth]);

  if (auth.isBootstrapping && !drawnBeforeSession(window.location.pathname)) {
    return <ShellSkeleton />;
  }

  return (
    <>
      <InnerApp />
      <ErrorToasts />
    </>
  );
}
