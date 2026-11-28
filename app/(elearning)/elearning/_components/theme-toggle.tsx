"use client";

// Nút Sáng / Tối / Hệ thống của khu e-learning. Biểu tượng lucide (Q4).
import { Check, Monitor, Moon, Sun } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useElearningTheme, type ElearningTheme } from "./elearning-theme";

const LUA_CHON: { value: ElearningTheme; nhan: string; icon: typeof Sun }[] = [
  { value: "light", nhan: "Sáng", icon: Sun },
  { value: "dark", nhan: "Tối", icon: Moon },
  { value: "system", nhan: "Hệ thống", icon: Monitor },
];

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, resolved, setTheme } = useElearningTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Đổi giao diện sáng/tối"
        className={cn(
          "inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        {resolved === "dark" ? <Moon className="h-5 w-5" aria-hidden /> : <Sun className="h-5 w-5" aria-hidden />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {LUA_CHON.map((o) => {
          const Icon = o.icon;
          const dangChon = theme === o.value;
          return (
            <DropdownMenuItem key={o.value} onClick={() => setTheme(o.value)} aria-checked={dangChon}>
              <Icon className="mr-2 h-4 w-4" aria-hidden />
              {o.nhan}
              {dangChon && <Check className="ml-auto h-4 w-4" aria-hidden />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
