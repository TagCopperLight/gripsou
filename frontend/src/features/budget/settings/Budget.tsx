import { AiSurface } from "./AiSurface";
import { CategoriesSurface } from "./CategoriesSurface";
import { ListPrefsSurface } from "./ListPrefsSurface";
import { TagsSurface } from "./TagsSurface";

export function SettingsBudget() {
  return (
    <div className="pb-8 md:mt-13 flex flex-col gap-5">
      <AiSurface />
      <ListPrefsSurface />
      <CategoriesSurface />
      <TagsSurface />
    </div>
  );
}
