"use client";

import { useState } from "react";
import faqs from "./_data/faqs";
import { SATA_ROBO_PHONE } from "@/lib/locations";

export default function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggle = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section className="lp-faq section section-alt" id="faq" aria-labelledby="faq-heading">
      <div className="container">
        <h2 id="faq-heading" className="section-title text-center">
          BỐ MẸ THƯỜNG HỎI MÌNH NHỮNG CÂU NÀY
        </h2>
        <p className="section-subtitle text-center">
          Mình tổng hợp 6 câu hỏi phụ huynh hay hỏi nhất —<br />
          trước khi quyết định cho con đăng ký Khoá Luyện Thi RoboSim.
        </p>

        <div className="faq-list" role="list">
          {faqs.map((faq, index) => {
            const isOpen = openIndex === index;
            return (
              <div key={index} className={`faq-item${isOpen ? " open" : ""}`} role="listitem">
                <button
                  className="faq-q"
                  onClick={() => toggle(index)}
                  aria-expanded={isOpen}
                  aria-controls={`faq-answer-${index}`}
                  id={`faq-btn-${index}`}
                >
                  <span>❓ {faq.question}</span>
                  <span className="faq-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </span>
                </button>
                <div
                  className="faq-a"
                  id={`faq-answer-${index}`}
                  role="region"
                  aria-labelledby={`faq-btn-${index}`}
                >
                  <div className="faq-a-inner">{faq.answer}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="lp-faq__footer">
          <p>Vẫn còn câu hỏi khác? Inbox mình Zalo — phản hồi trong 30 phút.</p>
          <a
            href={SATA_ROBO_PHONE.zalo}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-zalo"
            aria-label="Chat Zalo — phản hồi trong 30 phút"
          >
            💬 Chat Zalo →
          </a>
        </div>
      </div>
    </section>
  );
}
