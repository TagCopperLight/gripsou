type PageHeaderProps = {
  title: string;
};

// Page title with today's date above it. Shared by the Dashboard and Accounts pages.
export function PageHeader({ title }: PageHeaderProps) {
  return (
    <div>
      <p className="text-fg-dim text-sm pb-1">
        {new Date().toLocaleDateString("default", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
      </p>
      <h1 className="text-2xl font-bold">{title}</h1>
    </div>
  );
}
