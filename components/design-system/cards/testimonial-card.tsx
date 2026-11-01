import Image from "next/image";
import { Quote } from "lucide-react";
import { tokens } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

interface TestimonialCardProps {
  quote: string;
  authorName: string;
  authorRole?: string; // "Phụ huynh học viên lớp 5"
  avatarUrl?: string | null;
  rating?: number; // 1-5 stars
  className?: string;
}

// Parent/student testimonial card với pull-quote style.
export function TestimonialCard({
  quote,
  authorName,
  authorRole,
  avatarUrl,
  rating,
  className,
}: TestimonialCardProps) {
  return (
    <div
      className={cn(
        "bg-white p-6 md:p-8 h-full flex flex-col",
        tokens.radius.cardLg,
        "border border-neutral-200",
        tokens.shadows.card,
        className,
      )}
    >
      <Quote className="w-8 h-8 text-orange-200 mb-3" aria-hidden="true" />

      {rating != null && rating > 0 && (
        <div className="flex items-center gap-0.5 mb-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <svg
              key={i}
              className={cn("w-4 h-4", i < rating ? "text-orange-500" : "text-neutral-200")}
              fill="currentColor"
              viewBox="0 0 20 20"
              aria-hidden="true"
            >
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
          ))}
        </div>
      )}

      <p className="text-base text-neutral-800 leading-relaxed flex-1 mb-6">
        &ldquo;{quote}&rdquo;
      </p>

      <div className="flex items-center gap-3 pt-4 border-t border-neutral-100">
        {avatarUrl ? (
          <div className="w-12 h-12 rounded-full overflow-hidden ring-2 ring-orange-100 shrink-0">
            <Image
              src={avatarUrl}
              alt={authorName}
              width={48}
              height={48}
              className="w-full h-full object-cover"
            />
          </div>
        ) : (
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-orange-100 to-purple-100 flex items-center justify-center text-orange-600 font-bold text-lg shrink-0">
            {authorName.charAt(0)}
          </div>
        )}
        <div className="min-w-0">
          <p className="font-semibold text-neutral-900 truncate">{authorName}</p>
          {authorRole && (
            <p className="text-xs text-neutral-500 truncate">{authorRole}</p>
          )}
        </div>
      </div>
    </div>
  );
}
