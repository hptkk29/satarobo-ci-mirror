"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Clock, Users } from "lucide-react";
import { BorderBeam } from "@/components/magic/border-beam";
import { HoverLiftCard } from "@/components/design-system/effects/hover-lift-card";
import { tokens } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

interface CourseCardProps {
  title: string;
  description: string;
  imageUrl?: string;
  href: string;
  badge?: string;
  price?: string;
  duration?: string;
  studentCount?: number;
  className?: string;
  /** Wrap với HoverLiftCard. Default true (Phase 4.UI.1.1). */
  liftOnHover?: boolean;
  /** "large" mở rộng padding + typography cho 2-card layout. */
  size?: "default" | "large";
}

// Course card với BorderBeam hover. Light background.
export function CourseCard({
  title,
  description,
  imageUrl,
  href,
  badge,
  price,
  duration,
  studentCount,
  className,
  liftOnHover = true,
  size = "default",
}: CourseCardProps) {
  const isLarge = size === "large";
  const card = (
    <Link
      href={href}
      className={cn(
        "group relative block bg-white overflow-hidden transition-all duration-300",
        tokens.radius.cardLg,
        "border border-neutral-200 hover:border-orange-300",
        tokens.shadows.card,
        className,
      )}
    >
      {/* BorderBeam — visible on hover */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none rounded-2xl overflow-hidden">
        <BorderBeam size={80} duration={8} colorFrom="#F97316" colorTo="#7C3AED" />
      </div>

      {/* Image or gradient placeholder */}
      <div className="relative aspect-video bg-gradient-to-br from-orange-50 to-purple-50 overflow-hidden">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={title}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-500"
            sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-orange-300">
            <svg className="w-20 h-20" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 14l9-5-9-5-9 5 9 5z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
            </svg>
          </div>
        )}

        {badge && (
          <div className="absolute top-3 left-3 px-3 py-1 bg-white/95 backdrop-blur-sm rounded-full text-xs font-semibold text-orange-600 shadow-sm">
            {badge}
          </div>
        )}
      </div>

      <div className={isLarge ? "p-8 md:p-10" : "p-6"}>
        <h3
          className={cn(
            isLarge ? tokens.typography.heading.h3 : tokens.typography.heading.h4,
            "mb-3 group-hover:text-orange-600 transition-colors",
            isLarge ? "line-clamp-2" : "line-clamp-1",
          )}
        >
          {title}
        </h3>
        <p
          className={cn(
            "text-neutral-600 leading-relaxed mb-5",
            isLarge ? "text-base line-clamp-3" : "text-sm line-clamp-2",
          )}
        >
          {description}
        </p>

        <div
          className={cn(
            "flex items-center gap-4 text-neutral-500 mb-5",
            isLarge ? "text-sm" : "text-xs",
          )}
        >
          {duration && (
            <span className="flex items-center gap-1.5">
              <Clock className={isLarge ? "w-4 h-4" : "w-3.5 h-3.5"} />
              {duration}
            </span>
          )}
          {studentCount && (
            <span className="flex items-center gap-1.5">
              <Users className={isLarge ? "w-4 h-4" : "w-3.5 h-3.5"} />
              {studentCount.toLocaleString()} học viên
            </span>
          )}
        </div>

        <div className="flex items-center justify-between">
          {price && (
            <span
              className={cn(
                "font-bold text-orange-600",
                isLarge ? "text-xl" : "text-lg",
              )}
            >
              {price}
            </span>
          )}
          <span
            className={cn(
              "ml-auto flex items-center gap-1 font-semibold text-purple-700 group-hover:gap-2 transition-all",
              isLarge ? "text-base" : "text-sm",
            )}
          >
            Xem chi tiết
            <ArrowRight className={isLarge ? "w-5 h-5" : "w-4 h-4"} />
          </span>
        </div>
      </div>
    </Link>
  );

  if (liftOnHover) {
    return <HoverLiftCard glowColor="orange">{card}</HoverLiftCard>;
  }
  return card;
}
