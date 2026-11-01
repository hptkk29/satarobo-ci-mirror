"use client";

import Link from "next/link";
import type { HonorCategory } from "@prisma/client";
import { CATEGORY_META } from "@/lib/honors/category-meta";
import type { HonorWithEmployee } from "@/lib/honors/honor-view";
import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";

interface HonorCategoryGridProps {
  stats: Record<string, number>;
  previewHonors: HonorWithEmployee[];
}

export function HonorCategoryGrid({ stats }: HonorCategoryGridProps) {
  const categories: HonorCategory[] = ["SPARK", "GROWTH", "IMPACT", "GRAND_CHAMPION"];

  return (
    <section className="container max-w-6xl mx-auto px-4 py-16">
      <div className="text-center mb-12">
        <p className="text-sm uppercase tracking-widest text-orange-600 font-semibold mb-2">
          4 hạng mục danh hiệu
        </p>
        <h2 className="text-3xl md:text-4xl font-bold">Theo chính sách SR.QD.209</h2>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {categories.map((cat, idx) => {
          const meta = CATEGORY_META[cat];
          const Icon = meta.icon;
          const count = stats[cat] || 0;

          return (
            <motion.div
              key={cat}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: idx * 0.1 }}
            >
              <Link
                href={`/vinh-danh/${meta.slug}`}
                className="block h-full p-6 rounded-2xl transition-all hover:shadow-xl hover:-translate-y-1"
                style={{ backgroundColor: meta.bgColor }}
              >
                <div
                  className="w-14 h-14 rounded-full flex items-center justify-center mb-4 text-white"
                  style={{ backgroundColor: meta.accentColor }}
                >
                  <Icon className="w-7 h-7" />
                </div>

                <h3 className="text-xl font-bold mb-2" style={{ color: meta.textColor }}>
                  {meta.title}
                </h3>
                <p
                  className="text-sm leading-relaxed mb-4 opacity-80"
                  style={{ color: meta.textColor }}
                >
                  {meta.description}
                </p>

                <div
                  className="flex items-center justify-between text-sm"
                  style={{ color: meta.textColor }}
                >
                  <span className="font-semibold">{count} người</span>
                  <ArrowRight className="w-4 h-4" />
                </div>
              </Link>
            </motion.div>
          );
        })}
      </div>

      <div className="text-center mt-12">
        <Link
          href="/vinh-danh/tat-ca"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-full border-2 border-gray-300 hover:border-orange-500 hover:text-orange-600 transition-colors font-semibold"
        >
          Xem tất cả nhân sự được vinh danh
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </section>
  );
}
