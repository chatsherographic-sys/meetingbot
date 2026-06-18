"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMeetingSession } from "@/components/meeting-session-context";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/sessions", label: "Sessions" },
  { href: "/bots", label: "Bots" },
  { href: "/scheduled-bots", label: "Scheduled Bots" },
  { href: "/live-chat", label: "Live Chat" },
  { href: "/settings", label: "Settings" },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const { currentSessionId, loading, meetingSessions, setCurrentSessionId } =
    useMeetingSession();

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <p className="sidebar-kicker">Recall.ai MVP</p>
        <h1>Zoom Bot Control Panel</h1>
        <p className="muted">
          Create bots, schedule joins, and send live Zoom chat through saved
          templates.
        </p>
      </div>

      <div className="field" style={{ marginTop: 20 }}>
        <label htmlFor="current-session-selector">Current Session</label>
        <select
          id="current-session-selector"
          value={currentSessionId}
          disabled={loading}
          onChange={(event) => setCurrentSessionId(event.target.value)}
        >
          {meetingSessions.map((session) => (
            <option key={session.id} value={session.id}>
              {session.name} ({session.status})
            </option>
          ))}
        </select>
      </div>

      <nav className="sidebar-nav" aria-label="Admin sections">
        {navItems.map((item) => {
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-link${isActive ? " active" : ""}`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
