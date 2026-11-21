"use client";

import { useId, useState } from "react";
import { st } from "./st";

/** Danh sách câu hỏi dạng mở/gập của trang khoá học. Mở sẵn câu đầu, như bản thiết kế. */
export function FaqAccordion({ faqs }: { faqs: readonly (readonly [string, string])[] }) {
  const [mo, setMo] = useState(0);
  const id = useId();
  return (
    <div style={st("display: flex; flex-direction: column; gap: 10px")}>
      {faqs.map(([q, a], i) => {
        const dangMo = mo === i;
        return (
          <div
            key={q}
            className="sv a-acc"
            style={st("background: var(--panel); border: 1px solid var(--line); border-radius: 14px")}
          >
            <button
              type="button"
              onClick={() => setMo(dangMo ? -1 : i)}
              aria-expanded={dangMo}
              aria-controls={`${id}-${i}`}
              style={st(
                "width: 100%; display: flex; align-items: center; gap: 12px; text-align: left; background: transparent; border: 0; padding: 16px 18px; font: inherit; font-weight: 700; color: var(--text); cursor: pointer; min-height: 56px",
              )}
            >
              <span style={st("flex-grow: 1")}>{q}</span>
              <span
                aria-hidden="true"
                style={st(
                  `width: 30px; height: 30px; flex-shrink: 0; border-radius: 999px; display: flex; align-items: center; justify-content: center; font-weight: 700; ${
                    dangMo ? "background: #fe8f2d; color: #241133" : "background: var(--chip); color: var(--purT)"
                  }`,
                )}
              >
                {dangMo ? "−" : "+"}
              </span>
            </button>
            {dangMo && (
              <p id={`${id}-${i}`} style={st("margin: 0; padding: 0 18px 16px; color: var(--muted)")}>
                {a}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
