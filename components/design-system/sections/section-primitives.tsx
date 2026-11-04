import type { LucideIcon } from "lucide-react";

const EYEBROW_TONE = {
  orange: "text-orange-600",
  purple: "text-purple-600",
  amber: "text-amber-600",
  green: "text-green-600",
  blue: "text-blue-600",
  neutral: "text-neutral-500",
} as const;

export type EyebrowTone = keyof typeof EYEBROW_TONE;

export function SectionEyebrow({
  icon: Icon,
  label,
  tone = "orange",
}: {
  icon: LucideIcon;
  label: string;
  tone?: EyebrowTone;
}) {
  return (
    <div className={`flex items-center justify-center gap-2 mb-3 ${EYEBROW_TONE[tone]}`}>
      <Icon className="w-4 h-4" aria-hidden="true" />
      <span className="text-xs font-bold uppercase tracking-wider">{label}</span>
    </div>
  );
}

export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-center text-3xl md:text-4xl font-black text-neutral-900 leading-tight">
      {children}
    </h2>
  );
}

export function SectionLead({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-center text-neutral-600 mt-3 max-w-2xl mx-auto leading-relaxed">
      {children}
    </p>
  );
}

/** Standard card shadow + hover lift (Soft UI Evolution). */
export const SOFT_CARD =
  "shadow-[0_4px_20px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)] hover:-translate-y-1 transition-all duration-300";
