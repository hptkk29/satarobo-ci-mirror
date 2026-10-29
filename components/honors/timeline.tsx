"use client";

import { TimelineItem } from "@prisma/client";
import { MarkdownRenderer } from "@/components/blog/markdown-renderer";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

interface HonorTimelineProps {
  items: TimelineItem[];
}

export function HonorTimeline({ items }: HonorTimelineProps) {
  return (
    <section className="bg-gradient-to-b from-gray-50 to-white py-16">
      <div className="container max-w-4xl mx-auto px-4">
        <div className="text-center mb-12">
          <p className="text-sm uppercase tracking-widest text-orange-600 font-semibold mb-2">
            Hành trình
          </p>
          <h2 className="text-3xl md:text-4xl font-bold">Cùng nhau viết nên câu chuyện</h2>
        </div>

        <div className="relative">
          <div className="absolute left-4 md:left-1/2 top-0 bottom-0 w-0.5 bg-gradient-to-b from-purple-600 to-orange-500 md:-translate-x-1/2" />

          {items.map((item, idx) => {
            const isLeft = idx % 2 === 0;
            const dateLabel = item.occurredAt.toLocaleDateString("vi-VN", {
              year: "numeric",
              month: "long",
            });

            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5 }}
                className={cn(
                  "relative mb-12 md:flex md:items-center",
                  isLeft ? "md:flex-row" : "md:flex-row-reverse",
                )}
              >
                <div className="absolute left-4 md:left-1/2 w-4 h-4 rounded-full bg-gradient-to-br from-purple-600 to-orange-500 md:-translate-x-1/2 ring-4 ring-white z-10" />

                <div
                  className={cn(
                    "ml-12 md:ml-0 md:w-5/12",
                    isLeft ? "md:mr-auto md:pr-12" : "md:ml-auto md:pl-12",
                  )}
                >
                  <div className="bg-white rounded-xl shadow-md p-6 hover:shadow-lg transition-shadow">
                    <div className="text-sm text-orange-600 font-semibold mb-2 uppercase tracking-wider">
                      {dateLabel}
                    </div>
                    <h3 className="text-xl font-bold mb-3">{item.title}</h3>
                    <div className="prose prose-sm text-gray-700 max-w-none">
                      <MarkdownRenderer content={item.description} />
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
