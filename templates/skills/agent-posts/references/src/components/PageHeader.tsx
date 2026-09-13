import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-black/[.06] pb-6 sm:flex-row sm:items-end sm:justify-between dark:border-white/[.12]">
      <div>
        <h1 className="font-serif text-[28px] italic leading-none tracking-tight">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-sm text-neutral-600 dark:text-[#b6bac2]">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
