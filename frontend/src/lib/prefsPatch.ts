import type { UpdatePrefsReq, UserPrefs } from "../api/wire";

export type PrefsPatch = Partial<Omit<UserPrefs, "avatar">> & Pick<UpdatePrefsReq, "avatar">;

export function withPatch(prefs: UserPrefs, patch: PrefsPatch): UserPrefs {
  const { avatar, ...rest } = { ...prefs, ...patch };
  return avatar === null || avatar === undefined ? rest : { ...rest, avatar };
}
