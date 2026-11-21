"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  QUY_DINH_MA_VAN_BAN,
  QUY_DINH_MUC,
  QUY_DINH_TIEU_DE,
} from "@/lib/legal/quy-dinh-dao-tao-content";
import { dongYQuyDinhAction } from "../actions";

// MÀN CỔNG «Quy định đào tạo học viên» — dựng theo board M-Quy-dinh-dong-y.
//
// KHÔNG có nút đóng, KHÔNG phải modal đè lên nội dung: cổng thật nằm ở `portal/layout.tsx` — khi phụ huynh có
// con đã đăng ký mà chưa đồng ý, layout trả CHÍNH màn này thay cho cả cổng (`children` không vào cây React ⇒ page RSC
// không chạy ⇒ không dữ liệu nào rời DB). Xoá phần tử bằng F12 chỉ để lộ trang trống. «Cuộn hết mới có nút» chỉ là
// trải nghiệm đọc; thứ duy nhất server tin là dòng đồng ý trong sổ `SitePolicyAcceptance`.
//
// ⚠️ Import nội dung từ `quy-dinh-dao-tao-content`, KHÔNG từ `quy-dinh-dao-tao` (file kia chạm `@/lib/db`).
export function QuyDinhGate() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [phanTram, setPhanTram] = useState(0);
  const cuon = useRef<HTMLDivElement | null>(null);

  const tinh = useCallback(() => {
    const el = cuon.current;
    if (!el) return;
    // Nội dung ngắn hơn khung (màn lớn) ⇒ không có gì để cuộn ⇒ coi như đã đọc hết.
    const het = el.scrollHeight - el.clientHeight <= 8 || el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
    const p = het ? 100 : Math.round(((el.scrollTop + el.clientHeight) / el.scrollHeight) * 100);
    setPhanTram((cu) => (p > cu ? p : cu));
  }, []);

  useEffect(() => {
    tinh();
    window.addEventListener("resize", tinh);
    return () => window.removeEventListener("resize", tinh);
  }, [tinh]);

  const daHet = phanTram >= 100;

  function dongY() {
    start(async () => {
      const r = await dongYQuyDinhAction();
      if (!r.ok) {
        toast.error(r.error ?? "Chưa ghi nhận được đồng ý, ba mẹ thử lại nhé.");
        return;
      }
      // `refresh`: cây RSC dựng lại, cổng biến mất và cổng phụ huynh hiện ra TẠI CHỖ.
      router.refresh();
    });
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[var(--sr-purple,#620c8b)] px-4 py-5 text-[var(--sr-ink,#241133)]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="qd-t"
        aria-describedby="qd-mo"
        className="flex h-[min(92dvh,820px)] w-full max-w-[680px] flex-col overflow-hidden rounded-3xl bg-white shadow-[0_24px_64px_rgba(20,6,32,0.4)]"
      >
        <div className="flex flex-none flex-col gap-1 border-b border-[#efe6f5] px-[22px] pb-3.5 pt-5">
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-[#a5561a]">
            Trước khi bắt đầu · {QUY_DINH_MA_VAN_BAN}
          </span>
          <h1 id="qd-t" className="font-display text-2xl font-extrabold leading-[30px]">
            {QUY_DINH_TIEU_DE}
          </h1>
          <span id="qd-mo" className="text-sm leading-[21px] text-[#6b5a78]">
            Ba mẹ đọc hết quy định để dùng cổng phụ huynh. Đồng ý một lần, ghi nhận vĩnh viễn cho tài khoản này.
          </span>
        </div>

        <div
          ref={cuon}
          onScroll={tinh}
          tabIndex={0}
          aria-label="Nội dung quy định, cuộn để đọc"
          className="flex flex-1 flex-col gap-[18px] overflow-y-auto px-[22px] py-[18px] text-[15px] leading-6"
        >
          {QUY_DINH_MUC.map((m) => (
            <section key={m.ten} className="flex flex-col gap-2">
              <h2 className="text-base font-bold">{m.ten}</h2>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {m.dong.map((d) => (
                  <li key={d} className="flex gap-2">
                    <span aria-hidden="true" className="mt-[9px] size-1.5 flex-none rounded-full bg-[#fe8f2d]" />
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <span className="text-center text-[13px] text-[#6b5a78]">— Hết quy định —</span>
        </div>

        <div className="flex flex-none flex-col gap-2.5 border-t border-[#efe6f5] px-[22px] pb-[18px] pt-3.5">
          {!daHet ? (
            <div role="status" className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold text-[#6b5a78]">Cuộn xuống đọc hết để đồng ý · {phanTram}%</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-[#efe6f5]">
                <span className="block h-full rounded-full bg-[#fe8f2d] transition-[width]" style={{ width: `${phanTram}%` }} />
              </span>
            </div>
          ) : (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={dongY}
                className="h-[52px] rounded-[14px] bg-[#620c8b] text-base font-bold text-white hover:opacity-95 disabled:opacity-60"
              >
                {pending ? "Đang ghi nhận…" : "Tôi đã đọc và đồng ý"}
              </button>
              <span className="text-center text-xs leading-[18px] text-[#6b5a78]">
                Trung tâm lưu thời điểm, phiên bản quy định và tài khoản đồng ý. Ba mẹ xem lại bất cứ lúc nào ở mục Quy định đào tạo trong Hồ sơ.
              </span>
            </>
          )}
          {/* Lối thoát DUY NHẤT khỏi màn cổng: đăng xuất (không phải «bỏ qua»). Link thường, không JS. */}
          <a href="/dang-xuat" className="self-center text-xs font-semibold text-[#6b5a78] underline">
            Đăng xuất
          </a>
        </div>
      </div>
    </div>
  );
}
