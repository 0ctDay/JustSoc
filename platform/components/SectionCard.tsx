import type { ReactNode } from 'react';

export default function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <section className={`card section-card${className ? ` ${className}` : ''}`}>
      <header className="section-card-header">
        <div>
          <h2 className="section-card-title">{title}</h2>
          {description ? <p className="section-card-description">{description}</p> : null}
        </div>
        {actions ? <div className="section-card-actions">{actions}</div> : null}
      </header>
      <div className={contentClassName}>{children}</div>
    </section>
  );
}
