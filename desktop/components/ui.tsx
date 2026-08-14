import type { PropsWithChildren, ReactNode } from "react";
import type { IconName } from "./Icon.js";
import { Icon } from "./Icon.js";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions === undefined ? null : <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Button({
  children,
  variant = "primary",
  icon,
  ...props
}: PropsWithChildren<
  {
    variant?: "primary" | "secondary" | "quiet" | "danger";
    icon?: IconName;
  } & React.ButtonHTMLAttributes<HTMLButtonElement>
>) {
  return (
    <button className={`button button-${variant}`} {...props}>
      {icon === undefined ? null : <Icon name={icon} />}
      {children}
    </button>
  );
}

export function StatusPill({ status }: { status: string }) {
  const normalized = status.toLowerCase().replaceAll("_", "-");
  return (
    <span className={`status-pill status-${normalized}`}>
      <span className="status-dot" />
      {status.replaceAll("_", " ").toLowerCase()}
    </span>
  );
}

export function MetricCard({
  label,
  value,
  note,
  tone,
  icon,
}: {
  label: string;
  value: string | number;
  note: string;
  tone: "blue" | "mint" | "amber" | "rose";
  icon: IconName;
}) {
  return (
    <article className={`metric metric-${tone}`}>
      <div className="metric-icon">
        <Icon name={icon} />
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </article>
  );
}

export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
}: PropsWithChildren<{
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
}>) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          {subtitle === undefined ? null : <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon: IconName;
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon name={icon} />
      </div>
      <h3>{title}</h3>
      <p>{message}</p>
      {action}
    </div>
  );
}

export function ProgressBar({ value, max = 100 }: { value: number; max?: number }) {
  const percentage = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="progress" role="progressbar" aria-valuenow={value} aria-valuemax={max}>
      <span style={{ width: `${percentage}%` }} />
    </div>
  );
}
