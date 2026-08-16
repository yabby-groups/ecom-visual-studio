import { Link, useLocation } from "react-router-dom";

export function Nav({
  to,
  icon,
  label,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
}) {
  const location = useLocation();
  return (
    <Link
      to={to}
      className={`nav-link ${location.pathname === to ? "active" : ""}`}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}
