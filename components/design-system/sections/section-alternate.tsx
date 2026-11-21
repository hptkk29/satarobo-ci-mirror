import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { SectionBase } from "./section-base";

// Off-white section (bg-neutral-50). Alternate với SectionBase để tạo rhythm thị giác.
export function SectionAlternate(props: ComponentProps<typeof SectionBase>) {
  return (
    <SectionBase {...props} className={cn("bg-neutral-50", props.className)} />
  );
}
