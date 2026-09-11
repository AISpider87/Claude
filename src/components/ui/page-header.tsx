export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3 sm:mb-6">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description && <p className="text-muted mt-1 text-sm">{description}</p>}
      </div>
      {children}
    </div>
  );
}
