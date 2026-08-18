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
  const active =
    location.pathname === to ||
    (to !== "/" && location.pathname.startsWith(`${to}/`));
  return (
    <Link
      to={to}
      className={`nav-link ${active ? "active" : ""}`}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}
