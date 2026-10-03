import { ArrowRight, Info, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
export function PageTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={`notice ${error ? "error" : ""}`}
      role={error ? "alert" : "status"}
    >
      <Info size={18} />
      <div>{children}</div>
    </div>
  );
}
export function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon ?? <ArrowRight />}</div>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Busy({ text = "Working…" }: { text?: string }) {
  return (
    <span className="busy" role="status">
      <LoaderCircle className="spin" size={17} />
      {text}
    </span>
  );
}
