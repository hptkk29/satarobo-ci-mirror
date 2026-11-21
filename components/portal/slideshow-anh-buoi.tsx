"use client";

// Slideshow ảnh một buổi học cho phụ huynh — dựng theo board M-San-pham (artifact thiết kế):
// nền tối toàn màn hình, ảnh lớn, mũi tên ‹ ›, dải ảnh nhỏ, tự chạy 4 giây/ảnh, vuốt ngang.
//
// 12/11/2026 — LƯỚT NGANG THẬT: các ảnh nằm cạnh nhau trong một dải cuộn (`scroll-snap`), nên ngón tay kéo thấy ảnh trượt theo tay và
// «nhả» vào đúng ảnh kế tiếp (trước đó là đổi ảnh tức thì sau cú vuốt). Mũi tên, dải ảnh nhỏ, bàn phím và tự chạy cùng cuộn mượt tới đúng
// ảnh. `prefers-reduced-motion` ⇒ nhảy thẳng, không hoạt ảnh.
//
// Không thêm thư viện nào (luật "không auto-add UI library"): chỉ state + CSS. Ảnh phụ huynh xem
// ở đây là ảnh ĐÃ DUYỆT và đã qua cổng consent ở lib/portal/photos.ts — component này chỉ NHẬN
// danh sách URL đã lọc, không tự tra thêm gì.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Download, Images, Pause, Play, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type AnhSlide = { id: string; url: string; caption: string | null };

type Props = {
  anh: AnhSlide[];
  /** "Buổi 7 · Trở Về Tuổi Thơ" */
  tieuDe: string;
  /** "T7, 31/10 · 5 ảnh" */
  phu?: string;
  /** chinh = nút cam to (thẻ mới nhất); phu = nút viền nhỏ (thẻ các buổi trước). */
  kieu?: "chinh" | "phu";
};

const TU_CHAY_MS = 4000;

const giamChuyenDong = (): boolean =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function NutXemAnhBuoi({ anh, tieuDe, phu, kieu = "chinh" }: Props) {
  const [mo, setMo] = useState(false);
  const [i, setI] = useState(0);
  const [chay, setChay] = useState(false);
  const nutDong = useRef<HTMLButtonElement | null>(null);
  const nutMo = useRef<HTMLButtonElement | null>(null);
  const dai = useRef<HTMLDivElement | null>(null);
  const nho = useRef<(HTMLButtonElement | null)[]>([]);
  // Đích của lần cuộn do CHƯƠNG TRÌNH ra lệnh (mũi tên/dải nhỏ/tự chạy/phím): trong lúc cuộn, onScroll đi ngang qua các ảnh ở giữa mà KHÔNG được
  // kéo `i` về theo (nếu không, nhảy từ ảnh 1 sang ảnh 5 sẽ giật lại ở ảnh 2).
  const dich = useRef<number | null>(null);
  const hetHan = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tong = anh.length;

  const dong = useCallback(() => {
    setMo(false);
    setChay(false);
    nutMo.current?.focus();
  }, []);

  const di = useCallback(
    (k: number) => {
      if (tong === 0) return;
      const v = ((k % tong) + tong) % tong;
      setI(v);
      const el = dai.current;
      if (!el) return;
      const nhay = giamChuyenDong();
      dich.current = v;
      if (hetHan.current) clearTimeout(hetHan.current);
      // Chốt an toàn: nếu trình duyệt không báo đủ sự kiện cuộn (đã ở đúng chỗ, hoặc cuộn bị ngắt) thì thôi giữ đích sau 700ms.
      hetHan.current = setTimeout(() => (dich.current = null), nhay ? 50 : 700);
      el.scrollTo({ left: v * el.clientWidth, behavior: nhay ? "auto" : "smooth" });
    },
    [tong],
  );
  const truoc = useCallback(() => di(i - 1), [di, i]);
  const sau = useCallback(() => di(i + 1), [di, i]);

  // Bàn phím + khoá cuộn nền khi đang mở.
  useEffect(() => {
    if (!mo) return;
    const kb = (e: KeyboardEvent) => {
      if (e.key === "Escape") dong();
      else if (e.key === "ArrowLeft") truoc();
      else if (e.key === "ArrowRight") sau();
    };
    window.addEventListener("keydown", kb);
    const cu = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    nutDong.current?.focus();
    return () => {
      window.removeEventListener("keydown", kb);
      document.body.style.overflow = cu;
    };
  }, [mo, dong, truoc, sau]);

  // Tự chạy — tôn trọng prefers-reduced-motion: không bao giờ tự bật, chỉ chạy khi PH bấm.
  useEffect(() => {
    if (!mo || !chay || tong < 2) return;
    const t = setInterval(() => di(i + 1), TU_CHAY_MS);
    return () => clearInterval(t);
  }, [mo, chay, tong, di, i]);

  // Dải ảnh nhỏ: giữ ảnh đang xem ở giữa dải khi đổi ảnh (kể cả khi vuốt tay).
  useEffect(() => {
    if (!mo) return;
    nho.current[i]?.scrollIntoView({ inline: "center", block: "nearest", behavior: giamChuyenDong() ? "auto" : "smooth" });
  }, [mo, i]);

  useEffect(() => () => void (hetHan.current && clearTimeout(hetHan.current)), []);

  // Tay vuốt: ảnh đang nằm giữa khung = ảnh hiện tại. Chỉ cập nhật khi KHÔNG có lệnh cuộn của chương trình đang chạy.
  const khiCuon = useCallback(() => {
    const el = dai.current;
    if (!el || el.clientWidth === 0) return;
    const k = Math.round(el.scrollLeft / el.clientWidth);
    if (dich.current !== null) {
      if (k === dich.current) dich.current = null;
      return;
    }
    setI((v) => (v === k ? v : Math.max(0, Math.min(tong - 1, k))));
  }, [tong]);

  if (tong === 0) return null;
  const cur = anh[Math.min(i, tong - 1)]!;

  return (
    <>
      <button
        ref={nutMo}
        type="button"
        onClick={() => {
          setI(0);
          dich.current = null;
          setMo(true);
        }}
        className={cn(
          "inline-flex items-center justify-center gap-2 font-bold transition-colors",
          kieu === "chinh"
            ? "h-12 w-full rounded-xl bg-[var(--sr-orange)] px-4 text-[15px] text-[var(--sr-on-orange)] hover:brightness-95"
            : "h-10 w-full rounded-[10px] border border-border bg-[var(--sr-surface)] text-[13px] text-[var(--sr-purple-text)] hover:bg-[var(--sr-tint-purple)]",
        )}
      >
        <Images className={kieu === "chinh" ? "size-5" : "size-4"} aria-hidden="true" />
        {kieu === "chinh" ? `Xem ảnh chi tiết (${tong})` : "Xem ảnh"}
      </button>

      {mo && typeof document !== "undefined"
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`Ảnh ${tieuDe}`}
              className="fixed inset-0 z-[100] flex flex-col bg-[rgba(18,8,28,0.96)] text-white"
            >
              <div className="flex items-center gap-3 px-3 py-2.5">
                <div className="flex min-w-0 flex-1 flex-col">
                  <b className="truncate text-[15px] leading-[22px]">{tieuDe}</b>
                  {phu ? <span className="truncate text-[13px] text-[#d9c6e6]">{phu}</span> : null}
                </div>
                <span className="flex-none whitespace-nowrap text-sm font-bold text-[#ffc48a]" aria-live="polite">
                  {Math.min(i, tong - 1) + 1} / {tong}
                </span>
                <button
                  ref={nutDong}
                  type="button"
                  onClick={dong}
                  aria-label="Đóng xem ảnh"
                  className="flex size-11 flex-none items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
                >
                  <X className="size-5" aria-hidden="true" />
                </button>
              </div>

              <div className="relative flex min-h-0 flex-1 items-stretch">
                {/* Dải cuộn ngang có bắt điểm dừng: kéo tay thì ảnh trượt theo, nhả tay thì «nhả» vào đúng một ảnh. */}
                <div
                  ref={dai}
                  onScroll={khiCuon}
                  data-testid="dai-anh"
                  className="flex min-h-0 w-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  {anh.map((a, k) => (
                    <div
                      key={a.id}
                      role="group"
                      aria-roledescription="ảnh"
                      aria-label={`Ảnh ${k + 1} trên ${tong}`}
                      aria-hidden={k === Math.min(i, tong - 1) ? undefined : true}
                      className="flex h-full w-full flex-none snap-center snap-always items-center justify-center px-2"
                    >
                      {/* URL R2 ký động ⇒ <img> thường (xem san-pham-page). Ảnh xa khung hiện tại để trình duyệt tự nạp lười. */}
                      <img
                        src={a.url}
                        alt={a.caption ?? `Ảnh ${k + 1} của ${tieuDe}`}
                        loading={Math.abs(k - i) <= 1 ? "eager" : "lazy"}
                        decoding="async"
                        draggable={false}
                        className="max-h-full max-w-full select-none rounded-[14px] object-contain"
                      />
                    </div>
                  ))}
                </div>
                {tong > 1 ? (
                  <>
                    <button
                      type="button"
                      onClick={truoc}
                      aria-label="Ảnh trước"
                      className="absolute left-3 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 hover:bg-white/25"
                    >
                      <ChevronLeft className="size-6" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={sau}
                      aria-label="Ảnh sau"
                      className="absolute right-3 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 hover:bg-white/25"
                    >
                      <ChevronRight className="size-6" aria-hidden="true" />
                    </button>
                  </>
                ) : null}
              </div>

              <div className="flex flex-col items-center gap-3 px-3 pb-4 pt-2.5">
                {cur.caption ? (
                  <span className="max-w-[720px] text-center text-sm leading-[22px]">{cur.caption}</span>
                ) : null}
                {tong > 1 ? (
                  <div role="tablist" aria-label="Chọn ảnh" className="flex max-w-full gap-2 overflow-x-auto p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {anh.map((a, k) => (
                      <button
                        key={a.id}
                        ref={(el) => {
                          nho.current[k] = el;
                        }}
                        type="button"
                        role="tab"
                        aria-selected={k === i}
                        aria-label={`Ảnh ${k + 1}`}
                        onClick={() => di(k)}
                        className={cn(
                          "h-11 w-14 flex-none overflow-hidden rounded-[10px] transition-[opacity,transform] duration-200",
                          k === i ? "scale-105 border-[3px] border-[var(--sr-orange)]" : "border border-white/25 opacity-70",
                        )}
                      >
                        <img src={a.url} alt="" loading="lazy" className="size-full object-cover" />
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="flex flex-wrap justify-center gap-2">
                  {tong > 1 ? (
                    <button
                      type="button"
                      onClick={() => setChay((v) => !v)}
                      className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/30 px-4 text-sm font-semibold hover:bg-white/10"
                    >
                      {chay ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
                      {chay ? "Dừng tự chạy" : "Tự chạy (4 giây/ảnh)"}
                    </button>
                  ) : null}
                  <a
                    href={cur.url}
                    download
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-11 items-center gap-2 rounded-xl bg-[var(--sr-orange)] px-4 text-sm font-bold text-[var(--sr-on-orange)] hover:brightness-95"
                  >
                    <Download className="size-4" aria-hidden="true" />
                    Tải ảnh này
                  </a>
                </div>
                {tong > 1 ? <span className="text-xs text-[#b9a6c9]">Vuốt ngang để xem ảnh tiếp</span> : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
