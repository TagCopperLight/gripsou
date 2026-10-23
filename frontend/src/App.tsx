import { useEffect } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { useAuth } from "./auth/context";
import { setUnauthorizedHandler } from "./api/client";

function InnerApp() {
  const auth = useAuth();

  // Route guards (beforeLoad) read auth from the router context, which only
  // refreshes on render — they don't re-run by themselves. When auth flips
  // (login/logout, or finishing the welcome screen), invalidate so the current
  // match re-evaluates its guard and redirects, instead of leaving the user on
  // a now-wrong page.
  useEffect(() => {
    void router.invalidate();
  }, [auth.isAuthenticated, auth.user?.welcomeDone]);

  return <RouterProvider router={router} context={{ auth }} />;
}

export function App() {
  const auth = useAuth();
  // Not while bootstrapping: a stored token the server refuses is cleared by
  // the bootstrap itself, before there is a page to leave.
  useEffect(() => {
    if (auth.isBootstrapping) return;
    setUnauthorizedHandler(() => {
      auth.logout();
      router.navigate({ to: "/login" });
    });
  }, [auth]);

  if (auth.isBootstrapping) {
    return <div className="h-screen bg-bg" />;
  }

  return <InnerApp />;
}
