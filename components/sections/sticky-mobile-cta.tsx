"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { Calendar, Phone } from "lucide-react";
import { SATA_ROBO_PHONE } from "@/lib/locations";

// F-UI-4 — Bottom-pinned bar (mobile only). Đối trọng với
// <FloatingCta /> (bubble bottom-right, đã scope desktop only).
// Ẩn trên admin/login.
const HIDDEN_PREFIXES = ["/admin", "/login"];

export function StickyMobileCta() {
  const [isVisible, setIsVisible] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const handleScroll = () => setIsVisible(window.scrollY > 300);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl lg:hidden"
        >
          <div className="flex items-center gap-2 p-3">
            <a
              href={`tel:${SATA_ROBO_PHONE.tho}`}
              aria-label={`Gọi Sata Robo ${SATA_ROBO_PHONE.hien}`}
              className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-orange-100 text-orange-700 transition-colors hover:bg-orange-200"
            >
              <Phone className="h-5 w-5" />
            </a>
            <Link
              href="/lien-he?free-trial=true"
              className="cta-pulse cta-shine flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-gradient-sata-warm text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              <Calendar className="h-4 w-4" />
              Đặt buổi học thử 1-1 miễn phí
            </Link>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
