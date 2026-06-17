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
  return <RouterProvider router={router} context={{ auth }} />;
}
