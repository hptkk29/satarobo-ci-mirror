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

const BASE = `
  inline-flex items-center justify-center gap-2 rounded-lg font-semibold text-white
  bg-gradient-to-r from-orange-500 to-purple-700
  shadow-[0_4px_18px_rgba(124,58,237,0.35)]
  hover:shadow-[0_6px_24px_rgba(124,58,237,0.5)]
  hover:scale-[1.02] active:scale-[0.99]
  transition-all duration-200
`;

// Premium gradient CTA — cam→tím. Use ở high-converting CTAs (1 per page max).
export function CTAGradient(props: Props) {
  const { children, size = "md", className } = props;
  const classes = cn(BASE, SIZE_CLASS[size], className);

  if ("href" in props && props.href) {
    return (
      <Link href={props.href} target={props.target} className={classes}>
        {children}
      </Link>
    );
  }

  return (
    <button {...(props as ButtonHTMLAttributes<HTMLButtonElement>)} className={classes}>
      {children}
    </button>
  );
}
