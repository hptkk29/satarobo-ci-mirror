"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createParentRequest } from "@/app/(portal)/portal/yeu-cau/actions";
import { ghepNgayGio, loiDeXuatBu } from "@/lib/portal/yeu-cau-loai";
import type { LuotBu } from "@/lib/portal/chuyen-can-thuan";

// MÀN HỌC BÙ (board M-Yeu-cau-hoc-bu). Chỉ liệt kê buổi ĐANG cần bù — không dựng cả lộ trình:
//   · banner «Còn X / Y lượt bù miễn phí» (sổ lượt, cùng nguồn trang Chuyên cần);
//   · mỗi buổi cần bù một thẻ + nút «Gửi yêu cầu học bù» → hộp nhập NGÀY + GIỜ ba mẹ TỰ ĐỀ XUẤT (tự nhập, không còn khung giờ cố định — 13/11/2026) + ghi chú;
//   · buổi đã gửi yêu cầu ⇒ «Chờ xếp»; đã xếp lịch ⇒ hiện giờ học bù thật.
// Yêu cầu chỉ là BẢN GHI gửi tới Sale + quản lý cơ sở, họ thống nhất ngày bù với ba mẹ rồi xếp lịch — màn này không tự xếp lịch gì.

export type BuoiCanBu = {
  id: string;
  tenBuoi: string;
  ngayVang: string | null;
  lyDo: string;
  /** Tên lớp của buổi vắng (để ba mẹ nhận ra buổi nào khi con học nhiều lớp). */
  lop: string | null;
  trangThai: "CAN_BU" | "CHO_XEP" | "DA_XEP";
  lichBu: string | null;
};

const NUT_CHINH = "h-12 rounded-[14px] bg-[var(--sr-purple)] px-4 text-[15px] font-bold text-white disabled:opacity-70";
const O_NHAP =
  "w-full rounded-xl border border-[#d9c9e4] bg-white px-3 text-base text-[var(--sr-ink,#241133)] outline-none focus:border-[var(--sr-purple)]";

function BangLuot({ luot, soCanBu }: { luot: LuotBu; soCanBu: number }) {
  const vuot = soCanBu > luot.con;
  return (
    <section
      aria-label="Lượt bù"
      className="flex flex-wrap items-center gap-x-5 gap-y-3.5 rounded-[20px] bg-gradient-to-br from-[#620c8b] to-[#8a2d9e] p-[18px] text-white"
    >
      <div className="flex min-w-[200px] flex-1 flex-col gap-1">
        <b className="font-display text-[26px] font-extrabold leading-8">
          Còn {luot.con} / {luot.tong} lượt bù
        </b>
        <span className="text-[13px] leading-[19px] opacity-90">
          Mỗi học phần được {luot.tong} lượt bù miễn phí. Hết lượt, buổi bù tiếp theo có phí — giáo vụ báo trước khi xếp.
        </span>
      </div>
      {vuot ? (
        <span className="basis-full rounded-xl bg-white/15 px-3 py-2 text-[13px] font-semibold leading-[19px]">
          Có {soCanBu} buổi cần bù nhưng còn {luot.con} lượt miễn phí — từ buổi thứ {luot.con + 1} có phí học bù.
        </span>
      ) : null}
      <div aria-hidden="true" className="flex gap-1.5">
        {Array.from({ length: Math.min(luot.tong, 8) }, (_, i) => (
          <span key={i} className={cn("size-3.5 rounded-full", i < luot.con ? "bg-[var(--sr-orange)]" : "bg-white/30")} />
        ))}
      </div>
    </section>
  );
}

function BangGui({ buoi, homNay, onClose }: { buoi: BuoiCanBu; homNay: string; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ngay, setNgay] = useState("");
  const [gio, setGio] = useState("");
  const [ghiChu, setGhiChu] = useState("");
  const [loi, setLoi] = useState<string | null>(null);

  useEffect(() => {
    const kb = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", kb);
    const cu = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", kb);
      document.body.style.overflow = cu;
    };
  }, [onClose]);

  function gui() {
    const dx = ghepNgayGio(ngay, gio);
    const sai = loiDeXuatBu(ngay, gio, homNay);
    if (!dx || sai) return setLoi(sai ?? "Ba mẹ chọn ngày và giờ giúp nhé.");
    start(async () => {
      const r = await createParentRequest({
        type: "MAKEUP",
        makeupNeedId: buoi.id,
        preferredDate: dx,
        content: ghiChu.trim().length >= 5 ? ghiChu.trim() : `Xin học bù ${buoi.tenBuoi}`,
      });
      if (!r.ok) return void toast.error(r.error ?? "Chưa gửi được yêu cầu, ba mẹ thử lại nhé.");
      toast.success("Đã gửi yêu cầu học bù. Sale sẽ liên hệ để thống nhất ngày giờ với ba mẹ.");
      onClose();
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-[rgba(36,17,51,0.5)] sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bu-t"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-[520px] flex-col gap-3.5 overflow-y-auto rounded-t-[22px] bg-white px-[18px] pb-[22px] pt-[18px] sm:rounded-[22px] sm:px-6 sm:pb-6 sm:pt-6"
      >
        <div aria-hidden="true" className="h-1 w-10 self-center rounded bg-[#e6daee] sm:hidden" />
        <div className="flex flex-col gap-0.5">
          <b id="bu-t" className="text-lg">
            Học bù {buoi.tenBuoi}
          </b>
          <span className="text-[13px] text-[var(--sr-ink-muted)]">
            Ba mẹ đề xuất ngày và giờ thuận tiện. Sale của trung tâm sẽ liên hệ để thống nhất lịch bù rồi xếp lớp.
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-[minmax(0,1fr)_minmax(0,140px)]">
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Ngày ba mẹ muốn bù
            <input
              type="date"
              value={ngay}
              min={homNay}
              onChange={(e) => {
                setNgay(e.target.value);
                setLoi(null);
              }}
              className={cn(O_NHAP, "h-12")}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Giờ
            <input
              type="time"
              value={gio}
              step={300}
              onChange={(e) => {
                setGio(e.target.value);
                setLoi(null);
              }}
              className={cn(O_NHAP, "h-12")}
            />
          </label>
        </div>
        <span className="-mt-1.5 text-xs text-[var(--sr-ink-muted)]">Ba mẹ tự chọn ngày giờ phù hợp với gia đình. Nếu khung đó trung tâm chưa xếp được, Sale sẽ gọi để hẹn lại.</span>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Ghi chú (không bắt buộc)
          <textarea
            rows={3}
            value={ghiChu}
            onChange={(e) => setGhiChu(e.target.value)}
            placeholder="Ví dụ: con thường rảnh sau 17h, hoặc có thể đổi sang ngày khác"
            className={cn(O_NHAP, "resize-y py-2.5")}
          />
        </label>
        {loi ? (
          <span role="alert" className="text-[13px] font-semibold text-[#b42318]">
            {loi}
          </span>
        ) : null}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-12 flex-1 rounded-[14px] border border-[#e6daee] bg-white text-[15px] font-semibold"
          >
            Để sau
          </button>
          <button type="button" disabled={pending} onClick={gui} className={cn(NUT_CHINH, "flex-[2]")}>
            {pending ? "Đang gửi…" : "Gửi yêu cầu"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ManHocBu({
  tenCon,
  luot,
  buoi,
  homNay,
  moSan,
}: {
  tenCon: string;
  luot: LuotBu | null;
  buoi: BuoiCanBu[];
  /** `YYYY-MM-DD` giờ VN — ngày sớm nhất chọn được. */
  homNay: string;
  /** Mở sẵn bảng gửi cho buổi này (đến từ liên kết `?bu=` ở thông báo). */
  moSan: string | null;
}) {
  const [mo, setMo] = useState<string | null>(moSan);
  const dangMo = buoi.find((b) => b.id === mo && b.trangThai === "CAN_BU") ?? null;
  const soCanBu = buoi.filter((b) => b.trangThai === "CAN_BU").length;

  return (
    <div className="flex flex-col gap-4">
      {luot ? <BangLuot luot={luot} soCanBu={soCanBu} /> : null}

      <section aria-labelledby="can-t" className="flex flex-col gap-2.5">
        <h2 id="can-t" className="text-lg font-bold">
          Buổi đang cần bù{tenCon ? ` của ${tenCon}` : ""}
        </h2>
        {buoi.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-border p-5 text-center text-sm leading-[21px] text-[var(--sr-ink-muted)]">
            Hiện không có buổi nào cần bù. Khi con vắng một buổi, buổi đó sẽ hiện ở đây để ba mẹ gửi yêu cầu.
          </div>
        ) : (
          buoi.map((b) => (
            <article key={b.id} className="flex flex-col gap-2.5 rounded-[18px] border border-border bg-card px-4 py-3.5">
              <div className="flex items-start justify-between gap-2.5">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <b className="text-base">{b.tenBuoi}</b>
                  <span className="text-[13px] text-[var(--sr-ink-muted)]">
                    {[b.ngayVang ? `Vắng ${b.ngayVang}` : null, b.lyDo, b.lop ? `Lớp ${b.lop}` : null].filter(Boolean).join(" · ")}
                  </span>
                </div>
                <span
                  className={cn(
                    "flex-none rounded-full px-2.5 py-1 text-xs font-bold",
                    b.trangThai === "CAN_BU" ? "bg-[#fde8e8] text-[#b42318]" : b.trangThai === "CHO_XEP" ? "bg-[#fff1d6] text-[#7a4a00]" : "bg-[#e3f4ee] text-[#0f5c55]",
                  )}
                >
                  {b.trangThai === "CAN_BU" ? "Cần bù" : b.trangThai === "CHO_XEP" ? "Chờ xếp" : "Đã xếp lịch"}
                </span>
              </div>
              {b.trangThai === "DA_XEP" && b.lichBu ? (
                <span className="rounded-xl bg-[var(--sr-tint-purple)] px-3 py-2 text-[13px] leading-[19px]">
                  Lịch học bù: <b>{b.lichBu}</b>
                </span>
              ) : null}
              {b.trangThai === "CHO_XEP" ? (
                <span className="rounded-xl bg-[var(--sr-tint-purple)] px-3 py-2 text-[13px] leading-[19px]">
                  Trung tâm đã nhận yêu cầu của ba mẹ. Khi xếp xong giờ, lịch học bù sẽ hiện ngay tại đây.
                </span>
              ) : null}
              {b.trangThai === "CAN_BU" ? (
                <button type="button" onClick={() => setMo(b.id)} className={NUT_CHINH}>
                  Gửi yêu cầu học bù
                </button>
              ) : null}
            </article>
          ))
        )}
        <span className="text-[13px] leading-[19px] text-[var(--sr-ink-muted)]">
          Chỉ hiện buổi con vắng mà chưa được bù. Buổi đã bù xong xem ở mục Chuyên cần &amp; kết quả.
        </span>
      </section>

      {dangMo ? <BangGui buoi={dangMo} homNay={homNay} onClose={() => setMo(null)} /> : null}
    </div>
  );
}
