import Link from "next/link";
import Image from "next/image";
import { Calendar, Clock } from "lucide-react";
import { tokens } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

interface BlogCardProps {
  title: string;
  excerpt: string;
  coverImageUrl?: string;
  href: string;
  publishedAt?: Date;
  readingTimeMin?: number;
  authorName?: string;
  category?: string;
  className?: string;
}

// Blog post card. Subtle hover effect.
export function BlogCard({
  title,
  excerpt,
  coverImageUrl,
  href,
  publishedAt,
  readingTimeMin,
  authorName,
  category,
  className,
}: BlogCardProps) {
  return (
    <Link
      href={href}
      className={cn(
        "group block bg-white overflow-hidden transition-all duration-300",
        tokens.radius.cardLg,
        "border border-neutral-200 hover:border-orange-300",
        tokens.shadows.card,
        className,
      )}
    >
      <div className="relative aspect-video bg-gradient-to-br from-orange-50 to-purple-50 overflow-hidden">
        {coverImageUrl ? (
          <Image
            src={coverImageUrl}
            alt={title}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-500"
            sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-purple-300">
            <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
            </svg>
          </div>
        )}

        {category && (
          <div className="absolute top-3 left-3 px-2.5 py-1 bg-purple-50/95 backdrop-blur-sm rounded-full text-xs font-semibold text-purple-700">
            {category}
          </div>
        )}
      </div>

      <div className="p-6">
        <h3
          className={cn(
            tokens.typography.heading.h5,
            "mb-2 group-hover:text-orange-600 transition-colors line-clamp-2",
          )}
        >
          {title}
        </h3>
        <p className="text-sm text-neutral-600 leading-relaxed mb-4 line-clamp-3">
          {excerpt}
        </p>

        <div className="flex items-center gap-3 text-xs text-neutral-500">
          {authorName && (
            <>
              <span className="font-medium text-neutral-700">{authorName}</span>
              <span className="text-neutral-300">·</span>
            </>
          )}
          {publishedAt && (
            <span className="flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              {new Date(publishedAt).toLocaleDateString("vi-VN", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            </span>
          )}
          {readingTimeMin && (
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {readingTimeMin} phút đọc
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
