import Image from "next/image";
import Link from "next/link";
import { tokens } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

interface EmployeeCardProps {
  fullName: string;
  jobTitle: string;
  avatarUrl?: string | null;
  bio?: string | null;
  /** Optional link to detail page (e.g. honor page) */
  href?: string;
  /** Department badge */
  department?: string;
  className?: string;
}

// Employee profile card. Light, subtle, hoverable nếu có href.
export function EmployeeCard({
  fullName,
  jobTitle,
  avatarUrl,
  bio,
  href,
  department,
  className,
}: EmployeeCardProps) {
  const content = (
    <div
      className={cn(
        "group bg-white overflow-hidden h-full",
        tokens.radius.cardLg,
        "border border-neutral-200",
        tokens.shadows.card,
        href && "hover:border-orange-300",
        className,
      )}
    >
      <div className="relative aspect-square bg-gradient-to-br from-orange-50 to-purple-50 overflow-hidden">
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt={fullName}
            fill
            className={cn(
              "object-cover",
              href && "group-hover:scale-105 transition-transform duration-500",
            )}
            sizes="(max-width: 768px) 50vw, 25vw"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-6xl font-bold text-orange-300">
            {fullName.charAt(0)}
          </div>
        )}
      </div>

      <div className="p-5">
        {department && (
          <p className={cn(tokens.typography.eyebrow, "mb-2 text-xs")}>{department}</p>
        )}
        <h3
          className={cn(
            tokens.typography.heading.h5,
            "mb-1 line-clamp-1",
            href && "group-hover:text-orange-600 transition-colors",
          )}
        >
          {fullName}
        </h3>
        <p className="text-sm text-neutral-600 line-clamp-1 mb-3">{jobTitle}</p>
        {bio && (
          <p className="text-sm text-neutral-500 leading-relaxed line-clamp-3">{bio}</p>
        )}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block h-full">
        {content}
      </Link>
    );
  }
  return content;
}
