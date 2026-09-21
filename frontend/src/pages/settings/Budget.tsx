import { CategoriesSurface } from "../../components/budget/CategoriesSurface";
import { TagsSurface } from "../../components/budget/TagsSurface";

export function SettingsBudget() {
  return (
    <div className="pb-8 md:mt-13 flex flex-col gap-5">
      <CategoriesSurface />
      <TagsSurface />
    </div>
  );
}
