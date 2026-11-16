import { useState } from "react";
import { useEnabledProviders, useInitConnection } from "../../api/connections";
import { useErrorToast } from "../../lib/errorToasts";
import { goTo } from "../../lib/navigate";

export function useStartConnection({ returnTo, errorMessage }: { returnTo: string; errorMessage: string }) {
  const providers = useEnabledProviders();
  const init = useInitConnection();
  const [pickerOpen, setPickerOpen] = useState(false);
  useErrorToast(init.isError && errorMessage);

  const connect = (providerKey: string) =>
    init.mutate(providerKey, {
      onSuccess: ({ redirectUrl }) => goTo(redirectUrl ?? returnTo),
    });

  const start = () => {
    const only = providers.data?.length === 1 ? providers.data[0] : null;
    if (only) connect(only.key);
    else setPickerOpen(true);
  };

  return {
    providers,
    start,
    connect,
    pending: init.isPending,
    pickerOpen,
    closePicker: () => setPickerOpen(false),
  };
}
