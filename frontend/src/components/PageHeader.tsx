type PageHeaderProps = {
  title: string;
};

// Page title. Shared by the Dashboard, Accounts, Investments and Budget pages.
export function PageHeader({ title }: PageHeaderProps) {
  return <h1 className="text-2xl font-bold">{title}</h1>;
}
