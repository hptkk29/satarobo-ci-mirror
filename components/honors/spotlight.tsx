"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import { CATEGORY_META } from "@/lib/honors/category-meta";
import { getHonorView, type HonorWithEmployee } from "@/lib/honors/honor-view";

interface HonorSpotlightProps {
  honor: HonorWithEmployee;
}

export function HonorSpotlight({ honor }: HonorSpotlightProps) {
  const meta = CATEGORY_META[honor.category];
  const Icon = meta.icon;
  const view = getHonorView(honor);

  return (
    <section className="container max-w-6xl mx-auto px-4 py-16">
      <div className="text-center mb-8">
        <p className="text-sm uppercase tracking-widest text-orange-600 font-semibold mb-2">
          Nhân vật tháng này
        </p>
        <h2 className="text-3xl md:text-4xl font-bold">Person of the Month</h2>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="bg-white rounded-2xl shadow-xl overflow-hidden grid md:grid-cols-2 gap-0"
      >
        <div className="relative aspect-square md:aspect-auto bg-gradient-to-br from-purple-100 to-orange-100">
          {view.avatarUrl ? (
            <Image
              src={view.avatarUrl}
              alt={view.fullName}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 50vw"
              priority
            />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center text-9xl font-bold text-white"
              style={{ backgroundColor: meta.accentColor }}
            >
              {view.fullName.charAt(0)}
            </div>
          )}
        </div>

        <div className="p-8 md:p-12 flex flex-col justify-center">
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold mb-4 self-start"
            style={{ backgroundColor: meta.bgColor, color: meta.textColor }}
          >
            <Icon className="w-4 h-4" />
            {honor.awardName}
          </div>

          <h3 className="text-3xl md:text-4xl font-bold mb-2">{view.fullName}</h3>
          <p className="text-lg text-gray-600 mb-4">
            {view.jobTitle}
            {view.years != null && view.years > 0 && ` · ${view.years} năm gắn bó`}
          </p>

          {honor.shortBio && (
            <p className="text-gray-700 leading-relaxed mb-6">{honor.shortBio}</p>
          )}

          <Link
            href={`/vinh-danh/${honor.slug}`}
            className="inline-flex items-center gap-2 text-orange-600 font-semibold hover:text-orange-700 self-start"
          >
            Đọc câu chuyện đầy đủ
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </motion.div>
    </section>
  );
}
