import { useEffect } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { useAuth } from "./auth/context";
import { setUnauthorizedHandler } from "./api/client";

export function App() {
  const auth = useAuth();
  useEffect(() => {
    setUnauthorizedHandler(() => {
      auth.logout();
      router.navigate({ to: "/login" });
    });
  }, [auth]);

  // Route guards (beforeLoad) read auth from the router context, which only
  // refreshes on render — they don't re-run by themselves. When auth flips
  // (login/logout), invalidate so the current match re-evaluates its guard and
  // redirects, instead of leaving the user on a now-wrong page.
  useEffect(() => {
    void router.invalidate();
  }, [auth.isAuthenticated]);

  if (auth.isBootstrapping) {
    return <div className="h-screen bg-bg" />;
  }
  return <RouterProvider router={router} context={{ auth }} />;
}
