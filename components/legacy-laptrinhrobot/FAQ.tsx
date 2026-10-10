"use client";

import { useState } from "react";
import { faqs, type FAQAnswerItem } from "./_data/faqs";
import { HelpCircle, Plus, Minus, MessageCircle, CheckCircle2 } from "lucide-react";
import { SATA_ROBO_PHONE } from "@/lib/locations";

function AnswerBlock({ answer }: { answer: FAQAnswerItem[] | string }) {
  const blocks: FAQAnswerItem[] = Array.isArray(answer)
    ? answer
    : String(answer).split("\n").filter(Boolean);

  return (
    <div className="space-y-3 text-sm leading-7 text-text-muted sm:text-base sm:leading-8">
      {blocks.map((block, index) => {
        if (typeof block === "object" && block?.type === "list") {
          return (
            <ul key={`list-${index}`} className="space-y-2 rounded-2xl bg-white/70 p-3 sm:p-4">
              {block.items.map((item) => (
                <li key={item} className="grid grid-cols-[1.1rem_1fr] gap-2.5">
                  <CheckCircle2 className="mt-1.5 h-3.5 w-3.5 text-success" />
                  <span className="min-w-0">{item}</span>
                </li>
              ))}
            </ul>
          );
        }

        const text = typeof block === "string" ? block : "";
        return (
          <p key={text.slice(0, 24) || `p-${index}`} className="mb-2 last:mb-0">
            {text}
          </p>
        );
      })}
    </div>
  );
}

export default function FAQ() {
  const [openId, setOpenId] = useState<number | null>(() =>
    typeof window !== "undefined" && window.innerWidth >= 640 ? 1 : null,
  );

  const toggle = (id: number) => setOpenId(openId === id ? null : id);

  return (
    <section id="faq" className="section-padding bg-soft-cream">
      <div className="container-site">
        <div className="mb-10 text-center sm:mb-14">
          <div className="badge-orange mb-4">
            <HelpCircle className="h-4 w-4" />
            CÂU HỎI THƯỜNG GẶP
          </div>
          <h2 className="heading-2 mb-4">
            Bố mẹ thường hỏi mình{" "}
            <span className="text-gradient-orange-purple">những câu này</span>
          </h2>
          <p className="mx-auto max-w-2xl text-base text-text-muted sm:text-lg">
            Những câu hỏi phụ huynh thường hỏi nhất trước khi quyết định cho con học.
          </p>
        </div>

        <div className="mx-auto max-w-3xl space-y-3">
          {faqs.map((faq) => {
            const isOpen = openId === faq.id;
            return (
              <div key={faq.id} className={`card-base overflow-hidden transition-all ${isOpen ? "shadow-lg ring-2 ring-primary-orange/30" : ""}`}>
                <button
                  onClick={() => toggle(faq.id)}
                  className="flex w-full items-center justify-between gap-3 p-4 text-left transition hover:bg-soft-cream sm:p-5"
                  aria-expanded={isOpen}
                >
                  <span className="flex flex-1 items-start gap-2 text-sm font-bold text-text-dark sm:text-base">
                    <span className="flex-shrink-0 text-primary-orange">?</span>
                    <span>{faq.question}</span>
                  </span>
                  <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full transition sm:h-8 sm:w-8 ${isOpen ? "rotate-180 bg-primary-orange text-white" : "bg-soft-yellow text-primary-orange"}`}>
                    {isOpen ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                  </span>
                </button>

                <div className={`grid transition-all duration-300 ease-in-out ${isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                  <div className="overflow-hidden">
                    <div className="px-4 pb-4 pt-1 sm:px-5 sm:pb-5">
                      <div className="rounded-2xl border border-primary-orange/15 bg-soft-cream/55 px-4 py-4 sm:px-5">
                        <AnswerBlock answer={faq.answer} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mx-auto mt-10 max-w-2xl rounded-2xl border-2 border-primary-purple/20 bg-white p-6 text-center shadow-md sm:p-7">
          <p className="mb-4 text-sm text-text-dark sm:text-base">
            Còn câu hỏi khác? <strong>Inbox Zalo</strong> - Sata Robo sẽ phản hồi trong{" "}
            <strong className="text-primary-orange">ít phút</strong>.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <a
              href={SATA_ROBO_PHONE.zalo}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl bg-primary-purple px-6 py-3 text-sm font-bold text-white shadow-md transition hover:scale-105 hover:bg-primary-purple-dark sm:text-base"
            >
              <MessageCircle className="h-5 w-5" />
              Chat Zalo →
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
