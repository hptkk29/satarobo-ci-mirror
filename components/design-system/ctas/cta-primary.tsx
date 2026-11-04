"use client";

import Link from "next/link";
import type { ReactNode, ButtonHTMLAttributes } from "react";
import { ShimmerButton } from "@/components/magic/shimmer-button";
import { MagneticCTA } from "@/components/design-system/effects/magnetic-cta";
import { cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg";

interface CommonProps {
  children: ReactNode;
  size?: Size;
  className?: string;
  /** Wrap with MagneticCTA cursor-following effect. Default false. Phase 4.UI.1.1. */
  magnetic?: boolean;
}

type ButtonProps = CommonProps &
  ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };

type LinkProps = CommonProps & {
  href: string;
  target?: "_blank" | "_self";
};

type Props = ButtonProps | LinkProps;

const SIZE_CLASS: Record<Size, string> = {
  sm: "!px-4 !py-2 text-sm",
  md: "!px-6 !py-3 text-base",
  lg: "!px-8 !py-4 text-lg",
};

// Primary CTA — Cam shimmer button. Use cho important actions.
export function CTAPrimary(props: Props) {
  const { children, size = "md", className, magnetic = false } = props;

  const button = (
    <ShimmerButton
      className={cn(
        "font-semibold shadow-[0_4px_14px_rgba(249,115,22,0.4)]",
        "hover:scale-[1.02] transition-transform duration-200",
        SIZE_CLASS[size],
        className,
      )}
      shimmerColor="rgba(255,255,255,0.7)"
      background="#F97316"
      onClick={"onClick" in props && !("href" in props) ? props.onClick : undefined}
    >
      {children}
    </ShimmerButton>
  );

  let wrapped: ReactNode = button;

  if ("href" in props && props.href) {
    wrapped = (
      <Link href={props.href} target={props.target} className="inline-block">
        {button}
      </Link>
    );
  }

  if (magnetic) {
    return <MagneticCTA>{wrapped}</MagneticCTA>;
  }
  return wrapped;
}
