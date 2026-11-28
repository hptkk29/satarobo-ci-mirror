import { cn } from "@/lib/utils";

interface Props {
  className?: string;
}

// Classroom scene with robots on desks — SP2 offline class hero.
export function HeroClassroom({ className }: Props) {
  return (
    <svg
      className={cn("w-full h-auto", className)}
      viewBox="0 0 500 400"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Lớp học robotics với học sinh và robot"
    >
      <defs>
        <linearGradient id="classroom-bg" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FFEDD5" />
          <stop offset="100%" stopColor="#FAFAFA" />
        </linearGradient>
      </defs>

      {/* Wall + floor */}
      <rect x="0" y="0" width="500" height="250" fill="url(#classroom-bg)" opacity="0.4" />
      <rect x="0" y="250" width="500" height="150" fill="#F5F5F5" />

      {/* Whiteboard */}
      <rect x="50" y="40" width="180" height="100" rx="4" fill="white" stroke="#E5E5E5" strokeWidth="2" />
      <line x1="70" y1="65" x2="200" y2="65" stroke="#7C3AED" strokeWidth="2" strokeLinecap="round" />
      <line x1="70" y1="80" x2="180" y2="80" stroke="#F97316" strokeWidth="2" strokeLinecap="round" />
      <line x1="70" y1="95" x2="160" y2="95" stroke="#7C3AED" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
      <circle cx="180" cy="115" r="8" fill="#F97316" opacity="0.4" />

      {/* Desk 1 */}
      <rect x="60" y="240" width="100" height="50" rx="4" fill="#A78BFA" opacity="0.3" />
      <rect x="65" y="290" width="6" height="40" fill="#262626" opacity="0.3" />
      <rect x="149" y="290" width="6" height="40" fill="#262626" opacity="0.3" />
      {/* Small robot on desk 1 */}
      <rect x="90" y="210" width="40" height="35" rx="6" fill="#F97316" />
      <rect x="98" y="217" width="24" height="14" rx="2" fill="white" />
      <circle cx="105" cy="224" r="3" fill="#F97316" />
      <circle cx="117" cy="224" r="3" fill="#F97316" />
      <line x1="110" y1="200" x2="110" y2="210" stroke="#F97316" strokeWidth="2" />
      <circle cx="110" cy="198" r="3" fill="#7C3AED" />

      {/* Desk 2 */}
      <rect x="200" y="240" width="100" height="50" rx="4" fill="#FDBA74" opacity="0.3" />
      <rect x="205" y="290" width="6" height="40" fill="#262626" opacity="0.3" />
      <rect x="289" y="290" width="6" height="40" fill="#262626" opacity="0.3" />
      {/* Robot on desk 2 */}
      <rect x="230" y="210" width="40" height="35" rx="6" fill="#7C3AED" />
      <rect x="238" y="217" width="24" height="14" rx="2" fill="white" />
      <circle cx="245" cy="224" r="3" fill="#7C3AED" />
      <circle cx="257" cy="224" r="3" fill="#7C3AED" />
      <line x1="250" y1="200" x2="250" y2="210" stroke="#7C3AED" strokeWidth="2" />
      <circle cx="250" cy="198" r="3" fill="#F97316" />

      {/* Desk 3 */}
      <rect x="340" y="240" width="100" height="50" rx="4" fill="#C4B5FD" opacity="0.3" />
      <rect x="345" y="290" width="6" height="40" fill="#262626" opacity="0.3" />
      <rect x="429" y="290" width="6" height="40" fill="#262626" opacity="0.3" />
      {/* Robot on desk 3 */}
      <rect x="370" y="210" width="40" height="35" rx="6" fill="#F97316" />
      <rect x="378" y="217" width="24" height="14" rx="2" fill="white" />
      <circle cx="385" cy="224" r="3" fill="#F97316" />
      <circle cx="397" cy="224" r="3" fill="#F97316" />
      <line x1="390" y1="200" x2="390" y2="210" stroke="#F97316" strokeWidth="2" />
      <circle cx="390" cy="198" r="3" fill="#7C3AED" />

      {/* Floating elements */}
      <text x="280" y="80" fill="#F97316" fontSize="16" fontWeight="600" opacity="0.6">STEM</text>
      <text x="380" y="120" fill="#7C3AED" fontSize="14" fontWeight="600" opacity="0.5">{"<code/>"}</text>
    </svg>
  );
}
