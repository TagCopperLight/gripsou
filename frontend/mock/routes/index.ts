import { createRouter } from "../router";
import type { Store } from "../store";
import { authRoutes } from "./auth";

export const router = createRouter<Store>();
authRoutes(router);
