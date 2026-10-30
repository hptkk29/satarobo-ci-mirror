"use client";

// components/admin/use-gia-han-ve-scorm.ts — gia hạn CHỦ ĐỘNG vé mở SCORM/PDF (24/10/2026).
//
// Vì sao: vé + cookie sống 10 phút. Route asset chỉ gia hạn khi CÓ request tới — giáo viên chiếu một slide tĩnh >10 phút rồi bấm
// sang slide có ảnh/video lazy-load thì request đó ăn 403 và viewer câm (khung trắng, không ai báo gì). Hook này gọi
// `POST /api/scorm/gia-han` {ticket} định kỳ ~4 phút khi tab ĐANG HIỆN và ngay khi tab hiện lại sau lúc ẩn; response đặt lại cookie
// vé theo gói (iframe dùng cookie ⇒ KHÔNG cần nạp lại iframe) và trả vé mới để giữ trong ref (dùng cho "Thử lại").
//
// Hợp đồng với route (A3): 200 {ok:true, ticket, expiresInSec} · 401/403 {ok:false, reason:"phien"|"ve-sai"|"het-han-toi-da"} ·
// 429 giới hạn. 404/405/501 (route chưa có) ⇒ dừng im lặng, KHÔNG báo "hết hạn" oan.
//
// Luật:
//  · Hết hạn thật (401/403) ⇒ dừng hẳn + báo `phien: het-han` (viewer hiện biểu ngữ "Tải lại trang"; KHÔNG chặn nội dung đã mở).
//  · Lỗi mạng/5xx/429 ⇒ thử lại NHẸ theo bậc 15s→30s→60s→120s (trần), không bao giờ dồn dập.
//  · Không gọi khi tab ẩn (bỏ phí request + dễ bị giới hạn); chỉ một lượt bay cùng lúc; hiện lại <30s sau lần thành công thì bỏ qua.
//  · FAIL-OPEN: mọi lỗi của chính hook này (JSON hỏng…) chỉ là "lỗi tạm" — không ném ra ngoài, không chặn việc dạy.
import { useCallback, useEffect, useRef, useState } from "react";

export const GIA_HAN_CHU_KY_MS = 4 * 60 * 1000;
export const GIA_HAN_DOI_TOI_THIEU_MS = 30 * 1000;
export const GIA_HAN_LUI_BAC_MS = [15_000, 30_000, 60_000, 120_000] as const;

export type LyDoHetHan = "phien" | "ve-sai" | "het-han-toi-da";
export type KetQuaGiaHan = "ok" | "het-han" | "loi-tam" | "khong-ho-tro";
export type PhienVe = { loai: "ok" } | { loai: "het-han"; lyDo: LyDoHetHan };

const LY_DO: readonly LyDoHetHan[] = ["phien", "ve-sai", "het-han-toi-da"];
const laLyDo = (v: unknown): v is LyDoHetHan => typeof v === "string" && (LY_DO as readonly string[]).includes(v);

export type TuyChonGiaHan = {
  /** Vé hiện có (từ trang). Đổi prop ⇒ ref theo. */
  ticket: string;
  /** false ⇒ KHÔNG chạy định kỳ (PDF: tải nguyên tệp một lần, không còn request nào sau đó); vẫn dùng được `giaHanNgay`. */
  chuDong?: boolean;
};

export function useGiaHanVeScorm({ ticket, chuDong = true }: TuyChonGiaHan) {
  const veRef = useRef(ticket);
  const [phien, setPhien] = useState<PhienVe>({ loai: "ok" });
  const dungRef = useRef(false); // hết hạn thật / route không có ⇒ không gọi nữa
  const bayRef = useRef<Promise<KetQuaGiaHan> | null>(null);
  const lanOkCuoiRef = useRef(0);
  const dongRef = useRef(false); // unmount

  useEffect(() => {
    veRef.current = ticket;
  }, [ticket]);

  const layVe = useCallback(() => veRef.current, []);

  // Một lượt gọi route. Dùng chung cho hẹn giờ, tab hiện lại và `giaHanNgay` (một lượt bay cùng lúc: các nơi gọi chia nhau kết quả).
  const giaHanNgay = useCallback((): Promise<KetQuaGiaHan> => {
    if (dungRef.current) return Promise.resolve("het-han");
    if (bayRef.current) return bayRef.current;
    const lan = (async (): Promise<KetQuaGiaHan> => {
      try {
        const res = await fetch("/api/scorm/gia-han", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticket: veRef.current }),
        });
        // 404/405/501: route chưa có (hoặc cờ SCORM tắt). 400/413: chính yêu cầu của viewer bị từ chối vì định dạng — thử lại cũng vô ích.
        // Cả hai: dừng IM LẶNG (fail-open), không báo "hết hạn" oan.
        if ([400, 404, 405, 413, 501].includes(res.status)) {
          dungRef.current = true;
          // Dừng im lặng với NGƯỜI DÙNG, nhưng không im lặng với người vận hành/UAT: có dấu vết để phân biệt "gia hạn đã tắt" với "đang chạy".
          console.warn("[scorm] gia hạn vé dừng (route không dùng được):", res.status);
          return "khong-ho-tro";
        }
        type ThanGiaHan = { ok?: unknown; ticket?: unknown; reason?: unknown };
        let data: ThanGiaHan | null = null;
        try {
          data = (await res.json()) as ThanGiaHan | null;
        } catch {
          data = null;
        }
        if (res.ok && data?.ok === true && typeof data.ticket === "string" && data.ticket) {
          veRef.current = data.ticket;
          lanOkCuoiRef.current = Date.now();
          return "ok";
        }
        if (res.status === 401 || res.status === 403) {
          dungRef.current = true;
          const lyDo = data?.reason;
          // 401 = mất phiên đăng nhập. 403 chỉ là "hết hạn" khi route NÓI lý do hết hạn (phien · ve-sai · het-han-toi-da); lý do khác
          // (vd `nguon-goc`: kiểm cùng nguồn gốc hỏng) là sự cố hệ thống chứ không phải việc của người dạy ⇒ dừng im lặng.
          if (res.status === 403 && !laLyDo(lyDo)) {
            console.warn("[scorm] gia hạn vé dừng (403 không phải hết hạn):", lyDo);
            return "khong-ho-tro";
          }
          if (!dongRef.current) setPhien({ loai: "het-han", lyDo: laLyDo(lyDo) ? lyDo : "phien" });
          return "het-han";
        }
        return "loi-tam"; // 429 / 5xx / thân hỏng
      } catch {
        return "loi-tam"; // mạng
      }
    })();
    bayRef.current = lan;
    void lan.finally(() => {
      if (bayRef.current === lan) bayRef.current = null;
    });
    return lan;
  }, []);

  useEffect(() => {
    dongRef.current = false;
    if (!chuDong) {
      return () => {
        dongRef.current = true;
      };
    }
    let hen: ReturnType<typeof setTimeout> | undefined;
    let lanLoi = 0;
    const xoaHen = () => {
      if (hen !== undefined) clearTimeout(hen);
      hen = undefined;
    };
    const lenLich = (ms: number) => {
      xoaHen();
      hen = setTimeout(() => void chay(), ms);
    };
    const chay = async () => {
      if (dongRef.current || dungRef.current) return;
      // Tab ẩn: KHÔNG gọi, KHÔNG hẹn lại — `visibilitychange` sẽ chạy ngay khi hiện lại.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const kq = await giaHanNgay();
      if (dongRef.current) return;
      if (kq === "ok") {
        lanLoi = 0;
        lenLich(GIA_HAN_CHU_KY_MS);
      } else if (kq === "loi-tam") {
        lenLich(GIA_HAN_LUI_BAC_MS[Math.min(lanLoi, GIA_HAN_LUI_BAC_MS.length - 1)]);
        lanLoi += 1;
      } // het-han / khong-ho-tro: dừng hẳn
    };
    const khiDoiHienThi = () => {
      if (document.visibilityState !== "visible") return;
      if (dungRef.current) return;
      // Vừa gia hạn xong mà lật tab qua lại liên tục thì thôi — vé còn dài.
      if (Date.now() - lanOkCuoiRef.current < GIA_HAN_DOI_TOI_THIEU_MS && lanOkCuoiRef.current > 0) return;
      xoaHen();
      void chay();
    };
    document.addEventListener("visibilitychange", khiDoiHienThi);
    lenLich(GIA_HAN_CHU_KY_MS);
    return () => {
      dongRef.current = true;
      xoaHen();
      document.removeEventListener("visibilitychange", khiDoiHienThi);
    };
  }, [chuDong, giaHanNgay]);

  return { layVe, giaHanNgay, phien };
}
