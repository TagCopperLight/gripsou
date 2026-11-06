import { POWENS_GUIDE, POWENS_KEY, type GuidePoint } from "../../lib/powens";

/** What each provider adds after the general "read-only" point, by provider
 *  key. A provider without an entry gets the general point only. */
export const PROVIDER_GUIDE: Record<string, GuidePoint[]> = {
  [POWENS_KEY]: POWENS_GUIDE,
};
