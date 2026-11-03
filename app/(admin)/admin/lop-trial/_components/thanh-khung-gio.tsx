"use client";

// THANH KHUNG GIỜ của một lớp trải nghiệm.
//
// ── VÌ SAO MÀN NÀY CÓ MỘT TRỤC THỜI GIAN, KHÔNG CHỈ MỘT DANH SÁCH ────────────────────
// Ví dụ thật của chủ dự án: ngày 23/09 lớp mở 17:30–21:00; Sale 1 có một case 18:00–19:00,
// Sale 2 có hai case 17:30–18:30 và 19:00–20:00. Các case CHỒNG LẤN nhau.
//
// Một danh sách dọc trả lời được "có mấy case", nhưng câu người xếp lịch thật sự hỏi là
// **"19:00 còn chỗ không, và ai đang ở đó?"** — và câu đó chỉ đọc được khi thời gian có
// hình. Nên thanh này là phần mang thông tin, không phải phần trang trí.
//
// Mọi phép tính (vị trí, bề rộng, chia làn, mốc giờ) nằm ở `lib/trial/thanh-khung-gio.ts`
// và có test riêng. Ở đây chỉ đổ số ra `style` — không có luật nào sống trong tệp này.

import type { JSX } from "react";
import { xepLenThanh, soLan, mocGio } from "@/lib/trial/thanh-khung-gio";
import type { KhungGio } from "@/lib/trial/lop-moi";

export type OThanh = {
  id: string;
  startTime: string;
  endTime: string;
  /** Case của chính người đang xem — tô đậm bằng màu thương hiệu. */
  cuaToi: boolean;
  daHuy: boolean;
  soHocVien: number;
  /** Tên người tạo case, để đọc khi rê chuột. */
  nguoiTao: string | null;
};

export function ThanhKhungGio({
  khung,
  oCase,
  dangMo,
  onChon,
}: {
  khung: KhungGio | null;
  oCase: OThanh[];
  dangMo: string | null;
  onChon: (id: string) => void;
}): JSX.Element | null {
  const xep = xepLenThanh(khung, oCase);
  // Không đọc được khung lớp (lớp tạo trước 22/09) ⇒ KHÔNG vẽ. Vẽ một thanh mà mọi case
  // đều nằm ở 0% trông như dữ liệu, thật ra là rác.
  if (!khung || xep.length === 0) return null;

  const lan = soLan(xep);
  const moc = mocGio(khung, 30);

  return (
    // Ẩn dưới 640px: ở bề ngang đó một khung 3,5 tiếng chia ra thì mỗi case còn vài chục
    // pixel, chữ không vào nổi và ngón tay không trỏ trúng. KHÔNG mất thông tin — mỗi
    // case bên dưới đều in giờ của nó ngay trên đầu dòng.
    <div className="hidden sm:block" aria-hidden="true">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-2 flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
          <span className="font-semibold uppercase tracking-wide">Khung lớp</span>
          <span className="tabular-nums">
            {khung.startTime}–{khung.endTime}
          </span>
        </div>

        {/* Vạch mốc + nhãn giờ. `pb` chừa chỗ cho hàng nhãn nằm dưới đáy. */}
        <div className="relative" style={{ height: `${lan * 34 + 22}px` }}>
          {moc.map((m) => (
            <div
              key={m.phut}
              className="absolute top-0 border-l border-border/70"
              style={{ left: `${m.left}%`, height: `${lan * 34}px` }}
            />
          ))}

          {xep.map((c) => {
            const o = c.item;
            const nhan = `${o.startTime}–${o.endTime}`;
            const mo = dangMo === o.id;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => onChon(o.id)}
                title={`${nhan} · ${o.soHocVien} học viên${o.nguoiTao ? ` · ${o.nguoiTao}` : ""}`}
                className={[
                  "absolute overflow-hidden rounded-md px-2 text-left text-[11px] font-semibold leading-[26px]",
                  "ring-1 transition-colors",
                  o.daHuy
                    ? "bg-muted text-muted-foreground line-through ring-border"
                    : o.cuaToi
                      ? "bg-primary-soft text-primary-ink ring-primary hover:bg-primary-soft-hover"
                      : "bg-muted text-foreground ring-border hover:bg-state-info-soft",
                  mo ? "ring-2" : "",
                ].join(" ")}
                style={{
                  left: `${c.left}%`,
                  width: `${c.width}%`,
                  top: `${c.lane * 34}px`,
                  height: "26px",
                }}
              >
                <span className="whitespace-nowrap tabular-nums">{nhan}</span>
              </button>
            );
          })}

          {/* Nhãn giờ ở đáy. Mốc cuối kéo lệch trái để không tràn ra khỏi thẻ. */}
          {moc.map((m) => (
            <span
              key={`n${m.phut}`}
              className="absolute bottom-0 text-[11px] tabular-nums text-muted-foreground"
              style={{
                left: `${m.left}%`,
                transform: m.left >= 99 ? "translateX(-100%)" : "translateX(-50%)",
              }}
            >
              {m.nhan}
            </span>
          ))}
        </div>

        {xep.some((c) => c.ngoaiKhung) && (
          <p className="mt-2 text-[11px] text-state-warning-ink">
            Có case nằm ngoài khung lớp (dữ liệu cũ) — thanh vẽ kẹp vào mép, giờ thật đọc ở
            dòng của case.
          </p>
        )}
      </div>
    </div>
  );
}
