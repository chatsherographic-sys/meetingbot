import { ReactNode } from "react";
import { AdminSidebar } from "@/components/admin-sidebar";
import { MeetingSessionProvider } from "@/components/meeting-session-context";

type AdminShellProps = {
  children: ReactNode;
};

export function AdminShell({ children }: AdminShellProps) {
  return (
    <MeetingSessionProvider>
      <div className="app-shell">
        <AdminSidebar />
        <div className="content-shell">{children}</div>
      </div>
    </MeetingSessionProvider>
  );
}
