// components/admin/nguon-hoa-hong/referral/lich-su-xu-ly.tsx — «LỊCH SỬ XỬ LÝ» của một referral (AFF-L3b): ai làm gì, lúc nào, từ trạng thái nào sang trạng thái nào, lý do, ghi chú bằng chứng.
//
// Server component thuần (không JS xuống trình duyệt). Dữ liệu từ `docLichSuReferral` — nhật ký CHỈ-THÊM, đọc qua scopedDb; không có tên/SĐT/email khách (tầng ghi chặn, tầng đọc chỉ chọn cột đã biết).
// Lượt tự động chưa từng được xử lý tay thì nhật ký rỗng: nói đúng điều đó, không bịa dòng nào.
import { thoiDiemHienThi, NHAN_TRANG_THAI_REFERRAL } from "@/lib/affiliate/ghi-referral-dau-vao";
import type { DongLichSu } from "@/lib/affiliate/doc-xu-ly-referral";
import { NHAN_LOAI_SU_KIEN } from "@/lib/affiliate/xu-ly-referral";

const NHAN_GHI_NGUON: Readonly<Record<NonNullable<DongLichSu["ghiNguon"]>, string>> = {
  TAO_MOI: "Đã ghi nguồn vào hồ sơ khách (khách chưa có nguồn).",
  DE_NHOM_CHO: "Đã thay nhóm «chờ» của hồ sơ khách bằng nguồn của đối tác.",
  DA_DUNG_NGUOI: "Hồ sơ khách đã ghi đúng đối tác này từ trước — không ghi lại.",
};

export function LichSuXuLy({ dong }: { dong: readonly DongLichSu[] }) {
  if (dong.length === 0) {
    return <p className="text-sm text-muted-foreground">Chưa có thao tác xử lý tay nào với lượt này.</p>;
  }
  return (
    <ol className="space-y-4" aria-label="Lịch sử xử lý">
      {dong.map((d) => (
        <li key={d.id} className="min-w-0 border-l-2 border-border pl-4">
          <p className="text-sm font-medium text-foreground">
            {NHAN_LOAI_SU_KIEN[d.loai]}
            {d.tu !== d.den && (
              <span className="font-normal text-muted-foreground">
                {" "}
                · {d.tu ? NHAN_TRANG_THAI_REFERRAL[d.tu] : "—"} → {NHAN_TRANG_THAI_REFERRAL[d.den]}
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {d.nguoi} · {thoiDiemHienThi(d.luc)}
            {d.tuDuyet && " · người khai tự duyệt (không còn người khác có quyền)"}
          </p>
          <p className="mt-1 break-words text-sm text-foreground">
            <span className="text-muted-foreground">Lý do: </span>
            {d.lyDo}
          </p>
          {d.ghiChu && (
            <p className="mt-0.5 break-words text-sm text-foreground">
              <span className="text-muted-foreground">Bằng chứng: </span>
              {d.ghiChu}
            </p>
          )}
          {d.ghiNguon && <p className="mt-0.5 text-sm text-muted-foreground">{NHAN_GHI_NGUON[d.ghiNguon]}</p>}
        </li>
      ))}
    </ol>
  );
}
