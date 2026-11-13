"use client";

/**
 * Màn làm bài — chỉ là KHUNG: nhận `BoDeDisc` từ động cơ (qua hợp đồng) và vẽ từng câu với thang
 * Likert. Không chứa nội dung câu hỏi/chấm điểm DISC nào (chưa có giấy phép — audit P0 §B1).
 *
 * Thang trả lời là prop (mặc định 5 mức 1–5): giá trị đi nguyên xi vào `engine.cham`; ý nghĩa
 * từng mức do động cơ quyết định, nên nhãn mức là chữ trung tính "mức độ đúng với ...".
 */
import { useEffect, useRef } from "react";
import { ArrowLeft, ArrowRight, Info } from "lucide-react";
import type { BoDeDisc } from "@/lib/disc/engine";
import { NUT_CHINH, NUT_PHU, THE } from "./kieu";

export type MucThang = { gia: number; nhan: string; mat?: string };
export const THANG_MAC_DINH: readonly MucThang[] = [
  { gia: 1, nhan: "Hoàn toàn không đúng" },
  { gia: 2, nhan: "Ít khi đúng" },
  { gia: 3, nhan: "Đôi khi đúng" },
  { gia: 4, nhan: "Thường đúng" },
  { gia: 5, nhan: "Rất đúng" },
];

export function ManLamBai({
  boDe,
  tenNguoi,
  traLoi,
  cau,
  onTraLoi,
  onCau,
  onXong,
  onQuayLai,
  thang: thangNgoai,
  loi,
}: {
  boDe: BoDeDisc;
  /** Tên người đang được đánh giá (ba/mẹ hoặc bé) — chỉ để hiển thị. */
  tenNguoi: string;
  traLoi: Readonly<Record<string, number>>;
  cau: number;
  onTraLoi: (idCau: string, gia: number) => void;
  onCau: (viTri: number) => void;
  onXong: () => void;
  onQuayLai: () => void;
  thang?: readonly MucThang[];
  loi?: string | null;
}) {
  // Thang của BỘ ĐỀ (engine quyết định) thắng thang mặc định: bộ Tiểu học chỉ có 3 mức, gửi 4/5 là server từ chối cả bài.
  const thang: readonly MucThang[] = thangNgoai ?? boDe.thang ?? THANG_MAC_DINH;
  const tong = boDe.cauHoi.length;
  const viTri = Math.min(Math.max(cau, 0), Math.max(tong - 1, 0));
  const c = boDe.cauHoi[viTri];
  const tieuDe = useRef<HTMLHeadingElement>(null);
  const lanDau = useRef(true);

  // Sang câu mới thì đưa tiêu đề vào tầm đọc của trình đọc màn hình (không cuộn trang).
  useEffect(() => {
    if (lanDau.current) {
      lanDau.current = false;
      return;
    }
    tieuDe.current?.focus({ preventScroll: true });
  }, [viTri]);

  if (!c) {
    return (
      <div role="alert" className={THE}>
        Bộ câu hỏi này chưa có câu nào. Vui lòng quay lại và thử lại sau.
      </div>
    );
  }

  const daChon = traLoi[c.id];
  const laCauCuoi = viTri === tong - 1;
  const thieuCau = boDe.cauHoi.filter((q) => traLoi[q.id] === undefined).length;

  return (
    <section aria-labelledby="disc-cau-tieu-de" data-testid="disc-lam-bai" className="space-y-5">
      <p className="text-sm font-semibold text-violet-800">
        {boDe.nguoiLonTraLoiHo ? `Ba/mẹ trả lời hộ cho ${tenNguoi}` : `Bài của ${tenNguoi}`}
      </p>

      {boDe.nguoiLonTraLoiHo && (
        <div className="flex gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm leading-relaxed text-violet-950" data-testid="disc-nguoi-lon-tra-loi-ho">
          <Info className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>
            Bé còn nhỏ nên <strong>người lớn quan sát và trả lời hộ</strong>. Hãy chọn theo những gì bạn thường thấy ở bé, không theo điều bạn mong bé như thế.
          </p>
        </div>
      )}

      <div className={THE}>
        <p className="text-sm font-medium text-neutral-600" aria-live="polite">
          Câu {viTri + 1} / {tong}
        </p>
        {boDe.cauDan && (
          <p className="mt-2 text-sm text-neutral-700" data-testid="disc-cau-dan">
            {boDe.cauDan}
          </p>
        )}
        <h2 id="disc-cau-tieu-de" ref={tieuDe} tabIndex={-1} className="mt-2 text-balance text-xl font-bold leading-snug text-neutral-900 outline-none sm:text-2xl">
          {c.noiDung}
        </h2>

        <fieldset className="mt-5">
          <legend className="sr-only">Mức độ đúng với {boDe.nguoiLonTraLoiHo ? "bé" : "bạn"}</legend>
          <div className={"grid gap-2 " + (thang.length <= 3 ? "sm:grid-cols-3" : thang.length === 4 ? "sm:grid-cols-4" : "sm:grid-cols-5")}>
            {thang.map((m) => {
              const chon = daChon === m.gia;
              return (
                <label
                  key={m.gia}
                  className={
                    "flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-base font-semibold transition-colors motion-reduce:transition-none sm:min-h-24 sm:flex-col sm:justify-center sm:gap-1 sm:px-2 sm:text-center sm:text-sm " +
                    "has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-violet-300 " +
                    (chon ? "border-violet-700 bg-violet-700 text-white" : "border-neutral-300 bg-white text-neutral-800 hover:border-violet-500 hover:bg-violet-50")
                  }
                >
                  <input type="radio" name={`cau-${c.id}`} value={m.gia} checked={chon} onChange={() => onTraLoi(c.id, m.gia)} className="sr-only" />
                  <span aria-hidden="true" className={"grid h-7 w-7 shrink-0 place-items-center rounded-full border text-sm font-bold " + (chon ? "border-white" : "border-neutral-400")}>
                    {m.gia}
                  </span>
                  {m.mat ? (
                    <span aria-hidden="true" className="text-2xl leading-none">
                      {m.mat}
                    </span>
                  ) : null}
                  <span>{m.nhan}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>

      {loi && (
        <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-medium text-red-900">
          {loi}
        </p>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button type="button" className={NUT_PHU} onClick={viTri === 0 ? onQuayLai : () => onCau(viTri - 1)} data-testid="disc-cau-truoc">
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          {viTri === 0 ? "Quay lại hồ sơ" : "Câu trước"}
        </button>
        {laCauCuoi ? (
          <button type="button" className={NUT_CHINH} disabled={thieuCau > 0} onClick={onXong} data-testid="disc-cau-xong" aria-describedby={thieuCau > 0 ? "disc-con-thieu" : undefined}>
            Hoàn thành phần này
            <ArrowRight className="h-5 w-5" aria-hidden="true" />
          </button>
        ) : (
          <button type="button" className={NUT_CHINH} disabled={daChon === undefined} onClick={() => onCau(viTri + 1)} data-testid="disc-cau-tiep">
            Câu tiếp
            <ArrowRight className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>
      {laCauCuoi && thieuCau > 0 && (
        <p id="disc-con-thieu" className="text-sm text-neutral-700">
          Còn {thieuCau} câu chưa trả lời. Dùng “Câu trước” để quay lại những câu còn trống.
        </p>
      )}
    </section>
  );
}
