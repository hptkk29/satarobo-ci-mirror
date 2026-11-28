import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { cn } from "@/lib/utils";
import { phanLoaiCotDienThoai, type VaiTroDienThoai } from "@/lib/elearning/cot-dien-thoai";
import type { NhomMau } from "@/lib/elearning/nhom-mau-trang-thai";
import { ChamMau, ChuThichTrangThai } from "./trang-thai-nhom";

export type CotDuLieu<T> = {
  id: string;
  nhan: string;
  /** Nội dung ô — dùng chung cho bảng (≥ 720px) và danh sách gọn (< 720px). */
  hien: (hang: T) => React.ReactNode;
  canPhai?: boolean;
  /** Vai trò trên điện thoại: đúng 1 "tieu-de", 2–4 "thong-tin", còn lại "an" (mặc định). */
  dienThoai?: VaiTroDienThoai;
  /** Cột thao tác (nút/menu): bảng = cột cuối, điện thoại = cạnh phải dòng. */
  thaoTac?: boolean;
};

/**
 * MỘT định nghĩa cột → HAI hình dạng (HANDOFF §4): bảng từ 720px trở lên, danh sách gọn có chú thích màu ở dưới 720px.
 * Không xếp thẻ dài — mỗi dòng chỉ còn chấm màu + tiêu đề + 2–4 thông tin + thao tác. Cả hai cùng nằm trong HTML, CSS chọn
 * hình nào hiện (phần tử `display:none` bị loại khỏi cây trợ năng), nên không cần JS và không nháy khi tải.
 *
 * Bảng đi qua `PhanTrangBang` (lưới `bang-coverage.test.ts`: mọi `<table>` phải phân trang). `hang` nên là MỘT TRANG dữ liệu
 * đã cắt ở server — danh sách gọn không tự phân trang. `trong` là nội dung khi không có dòng (thường `KhoiRong`).
 */
export function DanhSachDuLieu<T>({
  hang,
  khoa,
  cot,
  nhomMau,
  nhanTrangThai,
  tenDonVi,
  nhanDanhSach,
  trong,
  className,
}: {
  hang: readonly T[];
  khoa: (h: T) => string;
  cot: readonly CotDuLieu<T>[];
  /** Nhóm màu của dòng (dùng `nhomMauCuaTrangThai`). */
  nhomMau: (h: T) => NhomMau;
  /** Nhãn chữ của trạng thái, đi cạnh chấm (màu không đứng một mình). */
  nhanTrangThai: (h: T) => string;
  tenDonVi: string;
  /** Tên danh sách cho trình đọc màn hình. */
  nhanDanhSach: string;
  trong?: React.ReactNode;
  className?: string;
}) {
  if (hang.length === 0) return <>{trong ?? null}</>;

  const dt = phanLoaiCotDienThoai(cot);
  const cacNhom = hang.map(nhomMau);

  return (
    <div className={cn("min-w-0", className)}>
      {/* ── Bảng: từ 721px ───────────────────────────────────────────── */}
      <div className="min-w-0 max-[720px]:hidden">
        <PhanTrangBang tenDonVi={tenDonVi} cuonNgang>
          <table className="w-full border-collapse text-sm" aria-label={nhanDanhSach}>
            <thead>
              <tr>
                {cot.map((c) => (
                  <th
                    key={c.id}
                    scope="col"
                    className={cn(
                      "whitespace-nowrap border-b border-input px-3 py-2.5 text-xs font-medium text-muted-foreground",
                      c.canPhai ? "text-right" : "text-left",
                    )}
                  >
                    {c.thaoTac ? <span className="sr-only">{c.nhan}</span> : c.nhan}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hang.map((h) => (
                <tr key={khoa(h)} className="hover:bg-primary-soft">
                  {cot.map((c) => (
                    <td
                      key={c.id}
                      className={cn(
                        "whitespace-nowrap border-b border-border px-3 py-3 align-middle",
                        c.canPhai && "text-right",
                      )}
                    >
                      {c.hien(h)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>

      {/* ── Danh sách gọn: đến 720px ─────────────────────────────────── */}
      <div className="min-[721px]:hidden">
        <ChuThichTrangThai cac={cacNhom} className="mb-1" />
        <ul aria-label={nhanDanhSach} className="m-0 list-none p-0">
          {hang.map((h, i) => (
            <li key={khoa(h)} className="flex items-start gap-2.5 border-b border-border py-3">
              <ChamMau nhom={cacNhom[i]} nhan={nhanTrangThai(h)} className="mt-[7px]" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="min-w-0 text-sm leading-5">{dt.tieuDe.hien(h)}</div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs leading-[18px] text-muted-foreground">
                  {dt.thongTin.map((c) => (
                    <span key={c.id}>
                      <em className="not-italic text-muted-foreground">{c.nhan}</em> {c.hien(h)}
                    </span>
                  ))}
                </div>
              </div>
              {dt.thaoTac.length > 0 && (
                <div className="flex shrink-0 items-center gap-1">{dt.thaoTac.map((c) => <span key={c.id}>{c.hien(h)}</span>)}</div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );

}
