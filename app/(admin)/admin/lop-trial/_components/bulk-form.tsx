"use client";

// Mở lớp trải nghiệm cho CẢ KỲ — một khoảng ngày + NHIỀU TUỲ CHỌN, cho MỘT HAY NHIỀU cơ sở.
//
// Chủ dự án 22/09/2026 (vòng 2): "chọn từ ngày đến ngày rồi phải chọn thêm giờ của kỳ đó,
// và có thể + thêm tuỳ chọn khác, ví dụ: tạo kỳ 22/09-30/09 lịch t3-t6 và lịch t7-cn
// riêng biệt". 23/09: "thay vì chọn cơ sở thì nên để là áp dụng cho cơ sở nào".
//
// ── MỘT TUỲ CHỌN MANG ĐÚNG MỘT KHUNG ─────────────────────────────────────────────────
// Thứ 7 muốn cả sáng lẫn chiều thì là HAI tuỳ chọn. Ô chọn giờ lấy GIAO các khung của
// những thứ đã tick: tick T3 (tối) cùng T7 (sáng/chiều) thì giao rỗng — màn hình nói
// thẳng là phải tách ra, thay vì bày một khung rồi để server từ chối.
//
// ── XEM TRƯỚC (thiết kế lại 23/09) ───────────────────────────────────────────────────
// Một lượt bấm có thể đẻ hàng chục lớp cho nhiều cơ sở. Cột phải đếm TRƯỚC khi bấm, bằng
// chính các hàm server dùng (`lib/trial/xem-truoc-mo-ky.ts`), và nút mang luôn con số đó —
// người dùng bấm "Mở 16 lớp" chứ không bấm một nút chung chung rồi mới biết.

import type { JSX } from "react";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarRange, Plus, X } from "lucide-react";
import { taoLopTrialTheoThuAction } from "../_actions";
import {
  goiYQuyTac,
  keKhung,
  khungChungChoThu,
  kiemKhungLop,
  TEN_THU,
  THU_KHOA,
  type CauHinhKhung,
  type QuyTacKy,
} from "@/lib/trial/khung-gio-mo-lop";
import { xemTruocMoKy } from "@/lib/trial/xem-truoc-mo-ky";
import type { Option } from "../_lib/types";
import { MucForm, NutChon, OKhungGio, O_NHAP, ngayVn } from "./khung-form-mo-lop";

/** Thứ 2 → CN theo thứ tự người Việt đọc; giá trị là chỉ số `vnWeekday`. */
const THU_HIEN = [1, 2, 3, 4, 5, 6, 0] as const;

/** "T3–T6" khi ≥3 thứ liền nhau, "T7, CN" khi không. Chỉ để HIỂN THỊ. */
function keThu(thu: readonly number[]): string {
  const thuTu = THU_HIEN.filter((t) => thu.includes(t));
  const ngan = (t: number) => THU_KHOA[t]!.toUpperCase();
  if (thuTu.length === 0) return "chưa chọn thứ";
  const viTri = thuTu.map((t) => THU_HIEN.indexOf(t));
  const lienNhau = viTri.every((v, i) => i === 0 || v === viTri[i - 1]! + 1);
  if (lienNhau && thuTu.length >= 3) return `${ngan(thuTu[0]!)}–${ngan(thuTu[thuTu.length - 1]!)}`;
  return thuTu.map(ngan).join(", ");
}

export function BulkForm({
  centers,
  coSoMacDinh,
  cauHinhKhung,
  homNay,
}: {
  centers: Option[];
  coSoMacDinh: string;
  cauHinhKhung: CauHinhKhung;
  homNay: string;
}): JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Áp dụng cho NHỮNG cơ sở nào (chủ dự án 23/09) — mặc định cơ sở của người mở form.
  const [centerIds, setCenterIds] = useState<string[]>(coSoMacDinh ? [coSoMacDinh] : []);
  const [tu, setTu] = useState(homNay);
  const [den, setDen] = useState(homNay);
  // Mở form ra là đã có sẵn bộ tuỳ chọn suy từ cấu hình — với cấu hình mặc định, đúng ba
  // dòng T3–T6 tối · T7+CN sáng · T7+CN chiều, tức đúng ví dụ chủ dự án đưa ra.
  const [quyTac, setQuyTac] = useState<QuyTacKy[]>(() => goiYQuyTac(cauHinhKhung));
  const [boQua, setBoQua] = useState<string[]>([]);

  const xemTruoc = useMemo(
    () => xemTruocMoKy({ tu, den, quyTac, soCoSo: centerIds.length, cauHinh: cauHinhKhung }),
    [tu, den, quyTac, centerIds.length, cauHinhKhung],
  );

  function suaQuyTac(i: number, moi: Partial<QuyTacKy>) {
    setQuyTac((cu) => cu.map((q, k) => (k === i ? { ...q, ...moi } : q)));
  }

  function doiThu(i: number, t: number) {
    setQuyTac((cu) =>
      cu.map((q, k) => {
        if (k !== i) return q;
        const thu = q.thu.includes(t) ? q.thu.filter((x) => x !== t) : [...q.thu, t].sort();
        // 23/09 — giờ là của NGƯỜI DÙNG (khung linh hoạt): đổi thứ KHÔNG ghi đè giờ đã gõ.
        // Chỉ điền sẵn khung chung đầu tiên khi tuỳ chọn chưa có giờ nào. Giờ lệch với
        // thứ mới thì `loiTuyChon` nói ngay những thứ nào sẽ bị bỏ qua.
        if (q.startTime && q.endTime) return { ...q, thu };
        const k0 = khungChungChoThu(thu, cauHinhKhung)[0];
        return { ...q, thu, startTime: k0?.startTime ?? "", endTime: k0?.endTime ?? "" };
      }),
    );
  }

  /**
   * Câu báo cho MỘT tuỳ chọn: thiếu thứ / thiếu giờ / những thứ mà khung đang gõ nằm
   * ngoài giờ mở (các ngày đó server sẽ bỏ qua). Dùng CHÍNH `kiemKhungLop` server dùng.
   */
  function loiTuyChon(q: QuyTacKy): string | null {
    if (q.thu.length === 0) return "Chọn ít nhất một thứ.";
    if (!q.startTime || !q.endTime) return "Nhập đủ giờ bắt đầu và giờ kết thúc.";
    const lech = THU_HIEN.filter((t) => q.thu.includes(t)).filter((t) => {
      const khung = khungChungChoThu([t], cauHinhKhung);
      return !kiemKhungLop({
        khungHopLe: khung,
        startTime: q.startTime,
        endTime: q.endTime,
        tenThu: TEN_THU[THU_KHOA[t]!],
      }).ok;
    });
    if (lech.length === 0) return null;
    if (q.startTime >= q.endTime) return "Giờ kết thúc phải sau giờ bắt đầu.";
    // Gộp các thứ cùng giờ mở: "T7, CN mở 08:00–11:30 hoặc 14:00–17:30".
    const theoGio = new Map<string, string[]>();
    for (const t of lech) {
      const gio = keKhung(khungChungChoThu([t], cauHinhKhung)) || "—";
      theoGio.set(gio, [...(theoGio.get(gio) ?? []), THU_KHOA[t]!.toUpperCase()]);
    }
    const moTa = [...theoGio].map(([gio, thu]) => `${thu.join(", ")} mở ${gio}`).join("; ");
    return `${q.startTime}–${q.endTime} nằm ngoài giờ mở (${moTa}) — các ngày đó sẽ bị bỏ qua.`;
  }

  function doiCoSo(id: string) {
    setCenterIds((cu) => (cu.includes(id) ? cu.filter((x) => x !== id) : [...cu, id]));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (centerIds.length === 0) {
      toast.error("Chọn ít nhất một cơ sở áp dụng");
      return;
    }
    if (quyTac.length === 0) {
      toast.error("Thêm ít nhất một tuỳ chọn");
      return;
    }
    const thieu = quyTac.findIndex((q) => q.thu.length === 0 || !q.startTime || !q.endTime);
    if (thieu >= 0) {
      toast.error(`Tuỳ chọn ${thieu + 1} chưa chọn đủ thứ và khung giờ`);
      return;
    }
    startTransition(async () => {
      const res = await taoLopTrialTheoThuAction({ centerIds, tu, den, quyTac });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const daTao = res.daTao ?? 0;
      const bq = res.boQua ?? [];
      setBoQua(bq);
      if (daTao === 0) {
        // KHÔNG báo "thành công" khi không mở được lớp nào — đó là lời khen cho một lượt
        // bấm không làm gì, và người dùng sẽ đi tìm lớp không tồn tại.
        toast.error(bq[0] ?? "Không mở được lớp nào trong khoảng đã chọn");
        return;
      }
      toast.success(
        bq.length > 0 ? `Đã mở ${daTao} lớp; bỏ qua ${bq.length} ngày` : `Đã mở ${daTao} lớp`,
      );
      router.refresh();
    });
  }

  const chuaDuTuyChon =
    quyTac.length === 0 || quyTac.some((q) => q.thu.length === 0 || !q.startTime || !q.endTime);
  // Nút khoá khi xem trước ra 0 lớp — bấm một nút sẽ không mở được lớp nào là nút nói dối.
  const khoaNut = pending || xemTruoc.tong === 0 || chuaDuTuyChon;

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start 2xl:grid-cols-[minmax(0,1fr)_24rem]"
    >
      <div className="min-w-0 divide-y divide-border rounded-xl border border-border bg-card">
        <MucForm
          tieuDe="Áp dụng cho cơ sở"
          moTa="Chọn một hay nhiều cơ sở — mỗi cơ sở nhận đủ bộ lớp của kỳ."
        >
          <div className="flex flex-wrap gap-2" role="group" aria-label="Áp dụng cho cơ sở">
            {centers.map((c) => (
              <NutChon
                key={c.id}
                chon={centerIds.includes(c.id)}
                onClick={() => doiCoSo(c.id)}
                disabled={pending}
                xuongDong
              >
                {c.name}
              </NutChon>
            ))}
          </div>
          {centerIds.length === 0 && (
            <p role="alert" className="text-xs text-state-warning-ink">
              Chọn ít nhất một cơ sở.
            </p>
          )}
        </MucForm>

        <MucForm tieuDe="Khoảng ngày" moTa="Lớp được mở cho mọi ngày khớp thứ trong khoảng này.">
          <div className="grid max-w-md gap-3 min-[400px]:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
              Từ ngày
              <input
                type="date"
                value={tu}
                onChange={(e) => setTu(e.target.value)}
                disabled={pending}
                required
                aria-label="Từ ngày"
                className={`${O_NHAP} min-w-0`}
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
              Đến ngày
              <input
                type="date"
                value={den}
                min={tu}
                onChange={(e) => setDen(e.target.value)}
                disabled={pending}
                required
                aria-label="Đến ngày"
                className={`${O_NHAP} min-w-0`}
              />
            </label>
          </div>
        </MucForm>

        <MucForm
          tieuDe="Lịch trong kỳ"
          moTa={
            <>
              Mỗi tuỳ chọn là{" "}
              <strong className="font-semibold text-foreground">một nhóm thứ + một khung giờ</strong>{" "}
              — gõ giờ tuỳ ý hoặc bấm khung gợi ý. Thứ 7 muốn cả sáng lẫn chiều thì tách thành
              hai tuỳ chọn.
            </>
          }
        >
          <ol className="divide-y divide-border rounded-lg border border-border">
            {quyTac.map((q, i) => {
              const chung = khungChungChoThu(q.thu, cauHinhKhung);
              const soLop = xemTruoc.theoTuyChon[i]?.soLop ?? 0;
              return (
                <li key={i} className="space-y-3 p-3 sm:p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-foreground">
                      Tuỳ chọn {i + 1}
                      <span className="ml-2 font-normal text-muted-foreground tabular-nums">
                        {soLop} lớp / cơ sở
                      </span>
                    </p>
                    {quyTac.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setQuyTac((cu) => cu.filter((_, k) => k !== i))}
                        disabled={pending}
                        aria-label={`Xoá tuỳ chọn ${i + 1}`}
                        className="-m-1.5 inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground pointer-coarse:h-11 pointer-coarse:w-11"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
                    <div
                      className="flex flex-wrap gap-1.5"
                      role="group"
                      aria-label={`Các thứ của tuỳ chọn ${i + 1}`}
                    >
                      {THU_HIEN.map((t) => {
                        const khoa = THU_KHOA[t]!;
                        const coKhung = khungChungChoThu([t], cauHinhKhung).length > 0;
                        return (
                          <NutChon
                            key={t}
                            chon={q.thu.includes(t)}
                            onClick={() => doiThu(i, t)}
                            // Thứ không có khung thì KHOÁ nút và nói lý do, thay vì cho tick
                            // rồi im lặng bỏ qua — tick được mà không ra lớp nào là nút nói dối.
                            disabled={pending || !coKhung}
                            ariaLabel={TEN_THU[khoa]}
                            title={
                              coKhung
                                ? TEN_THU[khoa]
                                : `${TEN_THU[khoa]} không mở lớp trải nghiệm — sửa ở Cấu hình vận hành`
                            }
                          >
                            {khoa.toUpperCase()}
                          </NutChon>
                        );
                      })}
                    </div>
                  </div>

                  <OKhungGio
                    startTime={q.startTime}
                    endTime={q.endTime}
                    goiY={chung}
                    onDoi={(g) => suaQuyTac(i, g)}
                    disabled={pending}
                    loi={loiTuyChon(q)}
                    nhan={`tuỳ chọn ${i + 1}`}
                  />
                </li>
              );
            })}
          </ol>

          <button
            type="button"
            onClick={() => setQuyTac((cu) => [...cu, { thu: [], startTime: "", endTime: "" }])}
            disabled={pending || quyTac.length >= 10}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-primary transition-colors duration-150 hover:bg-muted pointer-coarse:h-11 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Thêm tuỳ chọn
          </button>
        </MucForm>
      </div>

      {/* ── Xem trước + nút mở lớp. Đứng yên khi cuộn ở màn rộng: đây là chỗ quyết định. */}
      <aside className="space-y-4 rounded-xl border border-border bg-card p-5 lg:sticky lg:top-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CalendarRange className="h-4 w-4 text-muted-foreground" aria-hidden />
          Sẽ mở
        </div>

        <div aria-live="polite">
          {xemTruoc.loi ? (
            <p className="text-sm text-state-warning-ink">{xemTruoc.loi}</p>
          ) : (
            <div className="space-y-1">
              <p className="text-2xl font-semibold text-foreground tabular-nums">
                {xemTruoc.tong} lớp
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {xemTruoc.moiCoSo} lớp × {centerIds.length} cơ sở
                {xemTruoc.ngayDau && xemTruoc.ngayCuoi
                  ? ` · ${ngayVn(xemTruoc.ngayDau, true)} → ${ngayVn(xemTruoc.ngayCuoi, true)}`
                  : ""}
              </p>
            </div>
          )}
        </div>

        {quyTac.length > 0 && !xemTruoc.loi && (
          <ul className="space-y-1.5 border-t border-border pt-3 text-xs">
            {quyTac.map((q, i) => {
              const t = xemTruoc.theoTuyChon[i];
              return (
                <li key={i} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-muted-foreground">
                    {keThu(q.thu)}
                    {q.startTime ? ` · ${q.startTime}–${q.endTime}` : ""}
                  </span>
                  <span className="shrink-0 font-medium text-foreground tabular-nums">
                    {t?.loi ? "—" : `${t?.soLop ?? 0} lớp`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <button
          type="submit"
          disabled={khoaNut}
          className="h-10 w-full rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors duration-150 hover:bg-primary-dark pointer-coarse:h-11 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending
            ? "Đang mở lớp…"
            : xemTruoc.tong > 0
              ? `Mở ${xemTruoc.tong} lớp`
              : "Mở lớp cho cả kỳ"}
        </button>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Mở xong, Sale vào từng lớp để thêm case trong khung giờ của lớp đó.
        </p>

        {boQua.length > 0 && (
          <div
            role="status"
            className="space-y-1 border-t border-border pt-3 text-xs text-muted-foreground"
          >
            <p className="font-semibold text-foreground">Đã bỏ qua {boQua.length} ngày:</p>
            <ul className="max-h-60 list-disc space-y-0.5 overflow-y-auto pl-4">
              {boQua.slice(0, 50).map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
            {boQua.length > 50 && <p>…và {boQua.length - 50} dòng nữa.</p>}
          </div>
        )}
      </aside>
    </form>
  );
}
