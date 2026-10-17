import { Logo } from "./logo";
import { SidebarNav } from "./sidebar-nav";

/** Ruột sidebar (logo + nav + footer) — dùng chung desktop & drawer mobile. */
export function SidebarContent({
  onNavigate,
  chatUnread = 0,
}: {
  onNavigate?: () => void;
  /** Badge "Tin nhắn". Số SỐNG do `AppShell` giữ (một hook, hai nơi vẽ). */
  chatUnread?: number;
}) {
  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex h-16 shrink-0 items-center px-5">
        <Logo />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SidebarNav onNavigate={onNavigate} chatUnread={chatUnread} />
      </div>
      <div className="shrink-0 border-t border-border px-5 py-4 text-xs leading-relaxed text-muted-foreground">
        <p>Sata Robo</p>
      </div>
    </div>
  );
}

/** Sidebar cố định trên desktop. */
export function Sidebar({ chatUnread = 0 }: { chatUnread?: number }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-border lg:block print:hidden">
      <SidebarContent chatUnread={chatUnread} />
    </aside>
  );
}
