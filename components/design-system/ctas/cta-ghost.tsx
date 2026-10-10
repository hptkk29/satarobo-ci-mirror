"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ReactNode, ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface CommonProps {
  children: ReactNode;
  className?: string;
  hideArrow?: boolean;
}

type Props =
  | (CommonProps & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined })
  | (CommonProps & { href: string; target?: "_blank" | "_self" });

const BASE =
  "group inline-flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-semibold text-neutral-700 hover:text-orange-600 hover:bg-neutral-50 transition-colors duration-200";

// Ghost CTA — text + arrow only. Subtle link-like action.
export function CTAGhost(props: Props) {
  const { children, className, hideArrow = false } = props;
  const classes = cn(BASE, className);

  const content = (
    <>
      {children}
      {!hideArrow && (
        <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
      )}
    </>
  );

  if ("href" in props && props.href) {
    return (
      <Link href={props.href} target={props.target} className={classes}>
        {content}
      </Link>
    );
  }

  return (
    <button {...(props as ButtonHTMLAttributes<HTMLButtonElement>)} className={classes}>
      {content}
    </button>
  );
}
