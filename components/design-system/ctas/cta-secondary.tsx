"use client";

import Link from "next/link";
import type { ReactNode, ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg";

interface CommonProps {
  children: ReactNode;
  size?: Size;
  className?: string;
}

type Props =
  | (CommonProps & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined })
  | (CommonProps & { href: string; target?: "_blank" | "_self" });

const SIZE_CLASS: Record<Size, string> = {
  sm: "px-4 py-2 text-sm",
  md: "px-6 py-3 text-base",
  lg: "px-8 py-4 text-lg",
};

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg font-semibold border-2 border-purple-700 text-purple-700 bg-white hover:bg-purple-50 active:bg-purple-100 transition-colors duration-200";

// Secondary CTA — Outline tím #7C3AED. Use cho secondary actions.
export function CTASecondary(props: Props) {
  const { children, size = "md", className } = props;
  const classes = cn(BASE, SIZE_CLASS[size], className);

  if ("href" in props && props.href) {
    return (
      <Link href={props.href} target={props.target} className={classes}>
        {children}
      </Link>
    );
  }

  // Strip our props for button passthrough
  const { ...buttonProps } = props as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button {...buttonProps} className={classes}>
      {children}
    </button>
  );
}
