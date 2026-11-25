import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  containerClassName?: string;
}

/** Ô tìm kiếm có icon — port từ TeachUI. */
export function SearchInput({
  className,
  containerClassName,
  placeholder = "Tìm kiếm...",
  ...props
}: SearchInputProps) {
  return (
    <div className={cn("relative", containerClassName)}>
      <Search
        className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        type="search"
        placeholder={placeholder}
        className={cn(
          "h-10 w-full rounded-xl border border-border bg-muted/50 pr-4 pl-10 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:bg-card focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        {...props}
      />
    </div>
  );
}
