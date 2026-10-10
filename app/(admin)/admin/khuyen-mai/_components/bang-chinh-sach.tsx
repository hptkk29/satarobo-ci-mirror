"use client";

// Bảng danh sách chính sách khuyến mãi — chủ dự án chọn bố cục "bảng danh sách chuẩn" 26/09/2026.
//
// Một ô tìm + chip trạng thái MANG SỐ + một bảng (cùng ngữ pháp màn Tra cứu). Tìm ở client vì
// danh mục nhỏ (vài chục văn bản/năm) và đã nằm sẵn trong trang — gõ là ra, không vòng máy chủ.
//
// Mở ở "Đang áp dụng" khi có văn bản đang chạy: câu hỏi hay gặp nhất của cả Sale lẫn kế toán là
// "hôm nay đang áp gì". Không có thì mở "Tất cả" — đổ người dùng vào một bảng rỗng trong khi
// các chip bên cạnh có hàng là bắt họ bấm thử từng chip mới biết trang không hỏng.
//
// Cả HÀNG là vùng bấm (luật 12): `<tr relative cursor-pointer>` + link mã văn bản phủ
// `after:inset-0`. Không có mũi tên trơ nào hứa suông.
import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { EmptyState } from "@/components/admin/ui/states";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { NHAN_TRANG_THAI, type TrangThaiChinhSach } from "@/lib/khuyen-mai/hieu-luc";
import { boDau } from "@/lib/ui/bo-dau";
import { cn } from "@/lib/utils";
import { TONE_TRANG_THAI } from "./dinh-dang";

export type DongChinhSach = {
  id: string;
  maVanBan: string;
  ten: string;
  uuDai: string;
  trangThai: TrangThaiChinhSach;
  hieuLuc: string;
  nhac: string | null;
  phamVi: string;
  khoa: string;
  soMa: number;
  maDauTien: string[];
  tim: string;
};

type Loc = "tat_ca" | TrangThaiChinhSach;

const THU_TU_CHIP: { id: Loc; nhan: string }[] = [
  { id: "dang_ap_dung", nhan: NHAN_TRANG_THAI.dang_ap_dung },
  { id: "sap_ap_dung", nhan: NHAN_TRANG_THAI.sap_ap_dung },
  { id: "het_han", nhan: NHAN_TRANG_THAI.het_han },
  { id: "da_thu_hoi", nhan: NHAN_TRANG_THAI.da_thu_hoi },
  { id: "tat_ca", nhan: "Tất cả" },
];

const CHIP =
  "inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-xl border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const CHIP_ACTIVE = "border-primary bg-primary-soft text-primary-ink";
const CHIP_IDLE = "border-border bg-card text-muted-foreground hover:bg-muted";

export function BangChinhSach({ dong, coQuanLy }: { dong: DongChinhSach[]; coQuanLy: boolean }) {
  const idTim = useId();
  const [q, setQ] = useState("");
  const [loc, setLoc] = useState<Loc>(() => (dong.some((d) => d.trangThai === "dang_ap_dung") ? "dang_ap_dung" : "tat_ca"));

  const tuKhoa = boDau(q);
  const khopTim = useMemo(() => (tuKhoa ? dong.filter((d) => d.tim.includes(tuKhoa)) : dong), [dong, tuKhoa]);
  const dem = useMemo(() => {
    const m = new Map<Loc, number>([["tat_ca", khopTim.length]]);
    for (const d of khopTim) m.set(d.trangThai, (m.get(d.trangThai) ?? 0) + 1);
    return m;
  }, [khopTim]);
  const hien = loc === "tat_ca" ? khopTim : khopTim.filter((d) => d.trangThai === loc);

  if (dong.length === 0) {
    return (
      <EmptyState
        title="Chưa có chính sách khuyến mãi nào trên hệ thống."
        description={
          coQuanLy
            ? "Ban hành văn bản đầu tiên — Sale trong phạm vi áp dụng nhận thông báo ngay khi bạn bấm Ban hành."
            : "Khi Ban lãnh đạo ban hành chính sách, bạn sẽ nhận thông báo và thấy nó ở đây."
        }
        action={
          coQuanLy ? (
            <Link
              href="/khuyen-mai/moi"
              className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-dark"
            >
              Ban hành chính sách
            </Link>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Ô tìm co lại ở màn rộng để năm chip nằm MỘT hàng (smoke 26/09: ô tìm rộng đẩy chip
          "Tất cả" xuống hàng hai ở 1280px). */}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="relative w-full xl:max-w-xs">
          <label htmlFor={idTim} className="sr-only">
            Tìm chính sách
          </label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            id={idTim}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm văn bản hoặc mã voucher…"
            className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label="Xoá từ khoá tìm"
              className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>

        <div role="group" aria-label="Lọc theo trạng thái" className="flex flex-wrap gap-2 xl:flex-nowrap">
          {THU_TU_CHIP.map((c) => {
            const n = dem.get(c.id) ?? 0;
            const chon = c.id === loc;
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={chon}
                onClick={() => setLoc(c.id)}
                className={cn(CHIP, chon ? CHIP_ACTIVE : CHIP_IDLE)}
              >
                {c.nhan}
                <span className="tabular-nums">{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {hien.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-semibold text-foreground">
              {tuKhoa
                ? `Không có chính sách nào khớp “${q}” ở mục này`
                : loc === "dang_ap_dung"
                  ? "Hôm nay không có chính sách khuyến mãi nào đang áp dụng."
                  : `Không có chính sách nào ở mục “${THU_TU_CHIP.find((c) => c.id === loc)?.nhan}”.`}
            </p>
            {(tuKhoa || loc !== "tat_ca") && (
              <button
                type="button"
                onClick={() => {
                  setQ("");
                  setLoc("tat_ca");
                }}
                className="mt-2 text-sm font-medium text-primary-ink hover:underline"
              >
                Xem tất cả chính sách
              </button>
            )}
          </div>
        ) : (
          <PhanTrangBang tenDonVi="chính sách" khoaGhiNho={`khuyen-mai-${loc}`} cuonNgang className="[&>div:last-child]:px-5 [&>div:last-child]:pb-4">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th scope="col" className={cn(adminTh, "hidden sm:table-cell")}>
                    Văn bản
                  </th>
                  <th scope="col" className={cn(adminTh, "w-full")}>
                    {/* Tiêu đề `nowrap` quyết độ rộng TỐI THIỂU của cột: bản dài ép bảng rộng hơn 375px
                        (smoke 26/09) dù ô dữ liệu đã cắt chữ. Điện thoại dùng bản ngắn. */}
                    <span className="sm:hidden">Chính sách</span>
                    <span className="hidden sm:inline">Chương trình · ưu đãi</span>
                  </th>
                  <th scope="col" className={cn(adminTh, "hidden md:table-cell")}>
                    Hiệu lực
                  </th>
                  <th scope="col" className={cn(adminTh, "hidden xl:table-cell")}>
                    Áp dụng
                  </th>
                </tr>
              </thead>
              <tbody>
                {/* Trạng thái nằm DƯỚI mã văn bản, không ở cột cuối: bản đầu có 6 cột và ở 1280px
                    cột Trạng thái trôi ra ngoài vùng cuộn (smoke 26/09) — đúng thứ Sale cần nhìn.
                    Mã voucher cũng dời vào ô chương trình vì cùng lý do. */}
                {hien.map((d) => (
                  <tr key={d.id} className={cn(adminTr, "relative cursor-pointer", d.trangThai === "het_han" && "text-muted-foreground")}>
                    <td className={cn(adminTd, "hidden align-top sm:table-cell")}>
                      <Link
                        href={`/khuyen-mai/${d.id}`}
                        className="font-semibold tabular-nums text-primary-ink after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-none focus-visible:underline"
                      >
                        {d.maVanBan}
                      </Link>
                      <div className="mt-1">
                        <StatusPill tone={TONE_TRANG_THAI[d.trangThai]}>{NHAN_TRANG_THAI[d.trangThai]}</StatusPill>
                      </div>
                    </td>
                    {/* Dưới 640px bảng còn MỘT cột: mã + nhãn cùng dòng đầu, tên và ưu đãi được xuống
                        tối đa 2 dòng. Bản hai cột cắt mọi dòng còn ~14 ký tự (rà thiết kế 26/09). Mỗi độ
                        rộng có ĐÚNG MỘT link phủ hàng — link nằm trong phần tử ẩn không vẽ lớp phủ. */}
                    <td className={cn(adminTd, "max-w-0 align-top")}>
                      <div className="mb-1 flex items-center gap-2 sm:hidden">
                        <Link
                          href={`/khuyen-mai/${d.id}`}
                          className="font-semibold tabular-nums text-primary-ink after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:underline"
                        >
                          {d.maVanBan}
                        </Link>
                        <StatusPill tone={TONE_TRANG_THAI[d.trangThai]}>{NHAN_TRANG_THAI[d.trangThai]}</StatusPill>
                      </div>
                      <p className="line-clamp-2 whitespace-normal font-medium text-foreground sm:line-clamp-none sm:truncate sm:whitespace-nowrap">
                        {d.ten}
                      </p>
                      <p className="line-clamp-2 whitespace-normal text-xs text-muted-foreground sm:line-clamp-none sm:truncate sm:whitespace-nowrap">
                        {d.uuDai}
                      </p>
                      {/* Dưới 768px cột Hiệu lực ẩn — đưa khoảng ngày vào đây để điện thoại không mất nó. */}
                      <p className="truncate text-xs text-muted-foreground md:hidden">
                        {d.hieuLuc}
                        {d.nhac ? ` · ${d.nhac}` : ""}
                      </p>
                      {d.soMa > 0 && (
                        <p className="truncate text-xs">
                          <span className="text-muted-foreground">Mã </span>
                          <span className="font-semibold tracking-wide text-foreground">{d.maDauTien.join(", ")}</span>
                          {d.soMa > d.maDauTien.length && (
                            <span className="text-muted-foreground"> +{d.soMa - d.maDauTien.length}</span>
                          )}
                        </p>
                      )}
                    </td>
                    <td className={cn(adminTd, "hidden align-top tabular-nums md:table-cell")}>
                      <p>{d.hieuLuc}</p>
                      {d.nhac && <p className="text-xs text-muted-foreground">{d.nhac}</p>}
                    </td>
                    <td className={cn(adminTd, "hidden max-w-[13rem] align-top xl:table-cell")}>
                      <p className="truncate">{d.phamVi}</p>
                      <p className="truncate text-xs text-muted-foreground">{d.khoa}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        )}
      </div>
    </div>
  );
}
