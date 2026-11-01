import Link from "next/link";
import { ArrowRight, MapPin, Briefcase, Banknote } from "lucide-react";
import { tokens } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

interface JobCardProps {
  title: string;
  department: string;
  location: string;
  type: string; // "Toàn thời gian", "Part-time", "Thực tập"
  salaryRange?: string; // "10-15 triệu"
  href: string;
  openings?: number;
  className?: string;
}

// Job posting card. Minimal, scannable, focus call-to-action.
export function JobCard({
  title,
  department,
  location,
  type,
  salaryRange,
  href,
  openings,
  className,
}: JobCardProps) {
  return (
    <Link
      href={href}
      className={cn(
        "group block bg-white p-6 transition-all duration-300",
        tokens.radius.cardLg,
        "border border-neutral-200 hover:border-orange-300",
        tokens.shadows.card,
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <p className={cn(tokens.typography.eyebrow, "mb-2 text-xs")}>{department}</p>
          <h3
            className={cn(
              tokens.typography.heading.h4,
              "group-hover:text-orange-600 transition-colors line-clamp-2",
            )}
          >
            {title}
          </h3>
        </div>
        {openings && openings > 1 && (
          <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 text-xs font-semibold">
            {openings} người
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-neutral-600 mb-5">
        <span className="flex items-center gap-1">
          <MapPin className="w-3.5 h-3.5" />
          {location}
        </span>
        <span className="flex items-center gap-1">
          <Briefcase className="w-3.5 h-3.5" />
          {type}
        </span>
        {salaryRange && (
          <span className="flex items-center gap-1">
            <Banknote className="w-3.5 h-3.5" />
            {salaryRange}
          </span>
        )}
      </div>

      <div className="flex items-center justify-end text-sm font-semibold text-purple-700 group-hover:text-orange-600 transition-colors">
        Ứng tuyển ngay
        <ArrowRight className="w-4 h-4 ml-1 transition-transform group-hover:translate-x-1" />
      </div>
    </Link>
  );
}
