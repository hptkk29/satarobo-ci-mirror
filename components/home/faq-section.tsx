"use client";

import { useState } from "react";
import { HelpCircle, Plus, Minus, MessageCircle, CheckCircle2 } from "lucide-react";
import { SATA_ROBO_PHONE } from "@/lib/locations";
import {
  MAX_DISCOUNT_OFFLINE,
  MAX_DISCOUNT_ONLINE,
  PROGRAM_NAME,
  TOTAL_GIFT_VALUE,
  TRIAL_LABEL,
  TRIAL_SESSION_MINUTES,
  TRIAL_TEST_MINUTES,
} from "@/lib/uu-dai";

// FAQ answer = mảng các block. Mỗi block là:
// - string → 1 đoạn paragraph
// - { type: "list", items: string[] } → bullet list (mỗi item 1 checkmark)
type FAQAnswerItem = string | { type: "list"; items: string[] };

interface FAQItem {
  q: string;
  a: FAQAnswerItem[];
}

// ─── NỘI DUNG FAQ — sửa nội dung tại đây ─────────────────────────────
// Mỗi item: { q: "Câu hỏi?", a: [ "đoạn 1", "đoạn 2", { type: "list", items: [...] }, "đoạn cuối" ] }
// String = paragraph riêng. Object list = bullet list với CheckCircle2 icon.
// Order trong mảng quyết định thứ tự hiển thị trên UI.
const FAQS: FAQItem[] = [
  {
    q: "Khoá học Sata Robo phù hợp với con từ độ tuổi nào?",
    a: [
      "Sata Robo có lộ trình đầy đủ cho học sinh từ lớp 1 đến lớp 8 (6-14 tuổi).",
      "Mỗi khoá học được thiết kế phù hợp với năng lực tư duy và độ tinh xảo của từng độ tuổi.",
      {
        type: "list",
        items: [
          "Sata3 — Ươm Mầm Tài Năng: dành cho lớp 1-2.",
          "Sata4–Sata7 — Chắp Cánh Tương Lai: AI cho lớp 3-8.",
          "Sata1–Sata2: luyện thi Robotics 2026 ngắn hạn.",
        ],
      },
    ],
  },
  {
    q: "Học phí các khoá học bao nhiêu?",
    a: [
      "Học phí khác nhau theo từng khoá và lộ trình. Vui lòng liên hệ Sata Robo để nhận bảng giá và ưu đãi mới nhất cho khoá phù hợp với con.",
      {
        type: "list",
        items: [
          "Sata1 — Sata2: khoá luyện thi Robotics 2026 ngắn hạn.",
          "Sata3 — Sata7: lộ trình chuyên sâu 48 buổi (12 tháng).",
          "Combo Sata1 + Sata2: trọn lộ trình luyện thi, ưu đãi hơn so với học riêng.",
        ],
      },
      `Đang có ${PROGRAM_NAME} (giảm đến ${MAX_DISCOUNT_OFFLINE}% khoá offline, đến ${MAX_DISCOUNT_ONLINE}% khoá luyện thi online, kèm bộ quà tặng ${TOTAL_GIFT_VALUE}) và hỗ trợ trả góp 0% qua VPBank / Sacombank / Home Credit cho khoá 48 buổi — liên hệ để được tư vấn chi tiết.`,
    ],
  },
  {
    q: "Sata Robo có cam kết hoàn tiền không?",
    a: [
      "Có 2 cam kết bằng văn bản:",
      {
        type: "list",
        items: [
          "Hoàn 100% học phí nếu phụ huynh không hài lòng sau buổi học đầu tiên — không câu hỏi.",
          "Với khoá Sata8 — Vé Vàng Chung Kết: hoàn 100% học phí trong 7 ngày làm việc nếu học viên hoàn thành đầy đủ cam kết chuyên cần nhưng không vượt vòng loại để thi chung kết Khu vực Miền Trung tại Nghệ An ngày 13/09/2026.",
        ],
      },
    ],
  },
  {
    q: "Sata Robo có bao nhiêu cơ sở tại Đà Nẵng?",
    a: [
      "Hiện có 2 cơ sở tại Đà Nẵng — phụ huynh chọn cơ sở thuận tiện nhất.",
      {
        type: "list",
        items: [
          "Cơ sở Nguyễn Hữu Thọ: 211 Nguyễn Hữu Thọ.",
          "Cơ sở Hoàng Diệu: 114 Hoàng Diệu (Hải Châu).",
        ],
      },
      "Ngoài giờ học offline, học sinh có thể học online qua Robosim toàn quốc.",
    ],
  },
  {
    q: "Con học xong có thi đấu được không?",
    a: [
      "Có. Sata Robo là đơn vị duy nhất tại Đà Nẵng đào tạo Robosim — phần mềm bắt buộc trong Cuộc thi Sáng tạo Robotics 2026 do TW Đoàn phát động.",
      "Chương trình kết hợp các điểm nổi bật:",
      {
        type: "list",
        items: [
          "Hệ thống bài test theo gamification.",
          "AI đánh giá kết quả học tập tự động.",
          "Trao chứng nhận tự động từ Sata Robo.",
        ],
      },
      "Chương trình được biên tập theo sát thể lệ Cuộc thi Sáng tạo Robotics 2026.",
    ],
  },
  {
    q: "Con có được học thử 1-1 miễn phí trước khi đăng ký không?",
    a: [
      `Có. Sata Robo tặng mỗi học viên mới 1 ${TRIAL_LABEL} — con học 1 kèm 1 cùng giáo viên tại cơ sở, làm quen RoboSim và được tư vấn lộ trình phù hợp.`,
      "Buổi học thử gồm:",
      {
        type: "list",
        items: [
          `${TRIAL_TEST_MINUTES} phút test năng lực đầu vào.`,
          `${TRIAL_SESSION_MINUTES} phút học thử 1-1 trên RoboSim cùng giáo viên.`,
        ],
      },
      "Hoàn toàn 0 đồng, không ràng buộc đăng ký.",
    ],
  },
];

// Render block: string → <p>, list object → <ul> với checkmark
function AnswerBlock({ answer }: { answer: FAQAnswerItem[] }) {
  return (
    <div className="space-y-3 text-sm leading-7 text-neutral-700 sm:text-base sm:leading-8">
      {answer.map((block, index) => {
        if (typeof block === "string") {
          return (
            <p key={`p-${index}`} className="mb-2 last:mb-0">
              {block}
            </p>
          );
        }
        // block narrowed to { type: "list"; items: string[] }
        return (
          <ul
            key={`list-${index}`}
            className="space-y-2 rounded-xl bg-white/70 p-3 sm:p-4"
          >
            {block.items.map((item) => (
              <li key={item} className="grid grid-cols-[1.1rem_1fr] gap-2.5">
                <CheckCircle2 className="mt-1.5 h-3.5 w-3.5 text-green-600" />
                <span className="min-w-0">{item}</span>
              </li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}

export function FAQSection() {
  // First FAQ open by default (đồng nhất với design laptrinhrobot)
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  const toggle = (i: number) => setOpenIdx(openIdx === i ? null : i);

  return (
    <section
      id="faq"
      className="bg-gradient-to-b from-orange-50 via-amber-50/40 to-white py-16"
    >
      <div className="container mx-auto max-w-3xl px-4">
        {/* Header */}
        <div className="mb-10 text-center sm:mb-14">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-orange-100 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-orange-700">
            <HelpCircle className="h-4 w-4" />
            CÂU HỎI THƯỜNG GẶP
          </div>
          <h2 className="mb-4 text-3xl font-black text-neutral-900 md:text-4xl">
            Bố mẹ thường hỏi mình{" "}
            <span className="bg-gradient-to-r from-orange-500 to-purple-600 bg-clip-text text-transparent">
              những câu này
            </span>
          </h2>
          <p className="mx-auto max-w-2xl text-base text-neutral-600 sm:text-lg">
            Những câu hỏi phụ huynh thường hỏi nhất trước khi quyết định cho
            con học.
          </p>
        </div>

        {/* Accordion */}
        <div className="space-y-3">
          {FAQS.map((faq, i) => {
            const isOpen = openIdx === i;
            return (
              <div
                key={faq.q}
                className={`overflow-hidden rounded-2xl border bg-white transition-all ${
                  isOpen
                    ? "border-orange-300 shadow-lg ring-2 ring-orange-500/30"
                    : "border-neutral-200 shadow-sm"
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggle(i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-3 p-4 text-left transition hover:bg-orange-50/50 sm:p-5"
                >
                  <span className="flex flex-1 items-start gap-2 text-sm font-bold text-neutral-900 sm:text-base">
                    <span className="flex-shrink-0 text-orange-500">?</span>
                    <span>{faq.q}</span>
                  </span>
                  <span
                    className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full transition sm:h-8 sm:w-8 ${
                      isOpen
                        ? "rotate-180 bg-orange-500 text-white"
                        : "bg-amber-100 text-orange-600"
                    }`}
                  >
                    {isOpen ? (
                      <Minus className="h-4 w-4" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                  </span>
                </button>

                <div
                  className={`grid transition-all duration-300 ease-in-out ${
                    isOpen
                      ? "grid-rows-[1fr] opacity-100"
                      : "grid-rows-[0fr] opacity-0"
                  }`}
                >
                  <div className="overflow-hidden">
                    <div className="px-4 pb-4 pt-1 sm:px-5 sm:pb-5">
                      <div className="rounded-2xl border border-orange-500/15 bg-orange-50/55 px-4 py-4 sm:px-5">
                        <AnswerBlock answer={faq.a} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom Zalo CTA card */}
        <div className="mx-auto mt-10 max-w-2xl rounded-2xl border-2 border-purple-200 bg-white p-6 text-center shadow-md sm:p-7">
          <p className="mb-4 text-sm text-neutral-700 sm:text-base">
            Còn câu hỏi khác? <strong>Inbox Zalo</strong> — Sata Robo sẽ phản
            hồi trong{" "}
            <strong className="text-orange-600">ít phút</strong>.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <a
              href={SATA_ROBO_PHONE.zalo}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-6 py-3 text-sm font-bold text-white shadow-md transition hover:scale-105 hover:bg-purple-700 sm:text-base"
            >
              <MessageCircle className="h-5 w-5" />
              Chat Zalo {SATA_ROBO_PHONE.hien}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
