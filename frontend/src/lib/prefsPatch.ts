import type { UpdatePrefsReq, UserPrefs } from "../api/wire";

/** The settings one save changes, the rest untouched. `avatar: null` removes it. */
export type PrefsPatch = Partial<Omit<UserPrefs, "avatar">> & Pick<UpdatePrefsReq, "avatar">;

export function withPatch(prefs: UserPrefs, patch: PrefsPatch): UserPrefs {
  const { avatar, ...rest } = { ...prefs, ...patch };
  return avatar === null || avatar === undefined ? rest : { ...rest, avatar };
}
