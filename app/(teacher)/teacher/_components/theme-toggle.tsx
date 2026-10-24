"use client";

import { Sun, Moon, Monitor, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useTeacherTheme, type TeacherTheme } from "./teacher-theme";

const OPTIONS: { value: TeacherTheme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Sáng", icon: Sun },
  { value: "dark", label: "Tối", icon: Moon },
  { value: "system", label: "Hệ thống", icon: Monitor },
];

export function ThemeToggle() {
  const { theme, resolved, setTheme } = useTeacherTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="rounded-xl p-2.5 text-muted-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Đổi giao diện sáng/tối"
      >
        {resolved === "dark" ? (
          <Moon className="h-5 w-5" aria-hidden />
        ) : (
          <Sun className="h-5 w-5" aria-hidden />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {OPTIONS.map((o) => {
          const Icon = o.icon;
          const active = theme === o.value;
          return (
            <DropdownMenuItem
              key={o.value}
              onClick={() => setTheme(o.value)}
              className={cn(active && "text-primary-ink dark:text-primary-ink")}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {o.label}
              {active && <Check className="ml-auto h-4 w-4" aria-hidden />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
