import { createRouter } from "../router";
import type { Store } from "../store";
import { authRoutes } from "./auth";
import { budgetRoutes } from "./budget";
import { portfolioRoutes } from "./portfolio";
import { settingsRoutes } from "./settings";

export const router = createRouter<Store>();
authRoutes(router);
portfolioRoutes(router);
budgetRoutes(router);
settingsRoutes(router);
