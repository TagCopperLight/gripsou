// What each server route takes and answers, in the generated wire types: the
// request body and response body of its handler in backend/api. The keys are
// checked against the server's routes (src/api/routes.ts): a key the server
// lacks doesn't compile, and routes.test fails on a server route with no mock
// handler that isn't in NOT_MOCKED. `void`: no body.

import type { Route } from "../src/api/routes.ts";
import type * as W from "../src/api/wire.ts";
import type { PrefsPatch } from "../src/lib/prefsPatch.ts";

type Endpoint = { body?: unknown; res: unknown };

type Contract<T extends { [K in keyof T]: K extends Route ? Endpoint : never }> = T;

export type Api = Contract<{
  "GET /health": { res: W.Health };

  "POST /auth/login": { body: W.LoginReq; res: W.LoginOutcome };
  "POST /auth/login/verify": { body: W.LoginVerifyReq; res: W.SessionResponse };
  "POST /auth/passkey/options": { res: W.PasskeyOptions };
  "POST /auth/passkey": { body: W.PasskeySignInReq; res: W.SessionResponse };
  "POST /auth/reauth": { body: W.ReauthReq; res: W.ReauthResponse };
  "GET /auth/mfa/status": { res: W.MfaStatus };
  "POST /auth/mfa/totp/setup": { body: W.ReauthTokenReq; res: W.TotpSetup };
  "POST /auth/mfa/totp/confirm": { body: W.TotpConfirmReq; res: W.RecoveryCodes };
  "DELETE /auth/mfa/totp": { body: W.ReauthTokenReq; res: void };
  "POST /auth/mfa/recovery/regenerate": { body: W.ReauthTokenReq; res: W.RecoveryCodes };
  "POST /auth/mfa/passkeys/register/options": { body: W.ReauthTokenReq; res: W.PasskeyOptions };
  "POST /auth/mfa/passkeys/register": { body: W.PasskeyRegisterReq; res: W.Passkey };
  "PATCH /auth/mfa/passkeys/:id": { body: W.RenamePasskeyReq; res: void };
  "DELETE /auth/mfa/passkeys/:id": { res: void };
  "GET /auth/me": { res: W.SessionUser };
  "PATCH /auth/me": { body: W.UpdateProfileReq; res: W.SessionUser };
  "POST /auth/logout": { res: void };
  "GET /auth/token/:token": { res: W.TokenInfo };
  "POST /auth/invite/:token/redeem": { body: W.RedeemInviteReq; res: W.SessionResponse };
  "POST /auth/reset/:token/redeem": { body: W.RedeemResetReq; res: W.SessionResponse };
  "PATCH /auth/prefs": { body: PrefsPatch; res: W.SessionUser };
  "POST /auth/welcome": { res: void };
  "POST /auth/change-password": { body: W.ChangePasswordReq; res: void };
  "DELETE /auth/account": { body: W.DeleteAccountReq; res: void };
  "GET /auth/sessions": { res: W.Session[] };
  "DELETE /auth/sessions": { res: void };
  "DELETE /auth/sessions/:id": { res: void };

  "GET /dashboard/net-worth": { res: W.NetWorthResponse };
  "GET /accounts": { res: W.Account[] };
  "GET /accounts/series": { res: W.AccountSeries };
  "PATCH /accounts/:id": { body: W.UpdateAccountReq; res: W.UpdatedAccount };
  "GET /account-types": { res: string[] };

  "GET /transactions": { res: W.Transaction[] };
  "GET /transactions/counts": { res: W.TransactionCounts };
  "PATCH /transactions/:id": { body: W.TransactionPatch; res: W.PatchResult };
  "POST /transactions/:id/apply-to-description": { body: W.ApplyToDescriptionBody; res: W.WriteResult };
  "POST /transactions/bulk": { body: W.BulkBody; res: W.WriteResult };

  "GET /budget/categories": { res: W.BudgetCategory[] };
  "POST /budget/categories": { body: W.CategoryBody; res: W.BudgetCategory };
  "PUT /budget/categories/order": { body: W.ReorderBody; res: void };
  "PATCH /budget/categories/:id": { body: W.CategoryBody; res: W.BudgetCategory };
  "DELETE /budget/categories/:id": { res: void };
  "GET /budget/tags": { res: W.BudgetTag[] };
  "POST /budget/tags": { body: W.TagBody; res: W.BudgetTag };
  "PATCH /budget/tags/:id": { body: W.TagBody; res: W.BudgetTag };
  "DELETE /budget/tags/:id": { res: void };
  "GET /budget/summary": { res: W.BudgetSummary };
  "GET /budget/trend": { res: W.BudgetTrend };
  "POST /budget/categorize": { res: void };
  "GET /budget/categorize/status": { res: W.AiStatus };
  "POST /budget/review/:id/accept": { res: W.AcceptReviewResponse };
  "POST /budget/review/:id/undo": { body: W.UndoReviewReq; res: void };

  "GET /holdings": { res: W.Holding[] };
  "GET /investments/returns": { res: W.InvestmentReturns };
  "GET /holdings/:id/prices": { res: W.PricePoint[] };
  "GET /holdings/:id/lots": { res: W.Lot[] };
  "PUT /holdings/:id/lots": { body: W.SaveLotsReq; res: void };
  "POST /holdings/:id/lots/preview": { body: W.PreviewLotsReq; res: W.BasisPreview };
  "GET /holdings/:id/lots/suggestions": { res: W.LotSuggestion[] };

  "GET /connections": { res: W.ProviderGroup[] };
  "POST /connections/init": { body: W.InitConnectionReq; res: W.InitConnectionResp };
  "POST /connections/complete": { body: W.CompleteConnectionReq; res: void };
  "DELETE /connections/:id": { res: void };
  "POST /connections/:id/sync": { res: W.ConnectionState };
  "POST /connections/:id/manage": { res: W.ManageResp };
  "POST /sync": { res: W.SyncAllResp };
  "GET /providers/enabled": { res: W.EnabledProvider[] };

  "GET /users": { res: W.User[] };
  "PATCH /users/:id": { body: W.SetRoleReq; res: void };
  "DELETE /users/:id": { body: W.DeleteUserReq; res: void };
  "POST /users/:id/reset-link": { body: W.ReauthTokenReq; res: W.InviteLinkResp };
  "POST /invites": { res: W.InviteLinkResp };
  "GET /providers": { res: W.Provider[] };
  "PATCH /providers/:key": { body: W.SetProviderReq; res: W.Provider };
  "GET /settings/budget-ai": { res: W.BudgetAiSettings };
  "PATCH /settings/budget-ai": { body: W.SetBudgetAiSettingsReq; res: void };
  "GET /settings/budget-ai/usage": { res: W.BudgetAiUsage };
  "GET /settings/budget-ai/models/:provider": { res: string[] };
  "PUT /settings/budget-ai/prices": { body: Record<string, W.BudgetAiPriceReq>; res: void };
  "GET /settings/api-keys": { res: W.ApiKeyProvider[] };
  "PATCH /settings/api-keys/:provider": { body: W.SetApiKeyReq; res: W.ApiKeyProvider };
}>;

/** Server routes the app never calls, so the mock leaves them out. */
export const NOT_MOCKED = [
  // Providers call it, not the app.
  "POST /webhooks/:provider",
] as const satisfies readonly Route[];

export type Key = keyof Api;
export type Body<K extends Key> = Api[K] extends { body: infer B } ? B : undefined;
export type Res<K extends Key> = Api[K]["res"];
