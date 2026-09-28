import { AiSurface } from "../../components/budget/AiSurface";
import { CategoriesSurface } from "../../components/budget/CategoriesSurface";
import { ListPrefsSurface } from "../../components/budget/ListPrefsSurface";
import { TagsSurface } from "../../components/budget/TagsSurface";

export function SettingsBudget() {
  return (
    <div className="pb-8 md:mt-13 flex flex-col gap-5">
      <CategoriesSurface />
      <TagsSurface />
      <AiSurface />
      <ListPrefsSurface />
    </div>
  );
}
