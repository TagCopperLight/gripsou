import { createRouter } from "../router.ts";
import type { Store } from "../store.ts";
import { authRoutes } from "./auth.ts";
import { budgetRoutes } from "./budget.ts";
import { portfolioRoutes } from "./portfolio.ts";
import { settingsRoutes } from "./settings.ts";

export const router = createRouter<Store>();
authRoutes(router);
portfolioRoutes(router);
budgetRoutes(router);
settingsRoutes(router);
