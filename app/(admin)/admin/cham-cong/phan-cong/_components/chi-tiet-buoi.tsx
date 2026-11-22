"use client";
// "Chi tiết buổi" trên panel màn Phân công gộp (GĐ7) — những gì trước đây CHỈ có ở "Bảng theo buổi": ba tầng KẾ HOẠCH · THỰC TẾ ·
// XÁC NHẬN cho từng người của buổi, tuân thủ buổi dạy, sửa buổi đã qua, nhật ký sửa, lịch sử phân công.
//
// Mở bằng <details> ngay trong thẻ buổi (không modal, không trang khác — QLCS đang so nhiều buổi cạnh nhau). Dòng tóm tắt của
// <details> mang sẵn trạng thái quan trọng nhất (bằng CHỮ, không chỉ màu) để không phải mở mới biết buổi có vấn đề.
// Dữ liệu dựng ở máy chủ (`docChiTietBuoiGop`) bằng chính hàm của bảng cũ — component này không suy trạng thái nào (luật 12b).
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { HoSoBuoi } from "@/components/cham-cong/ho-so-buoi";
import { PILL } from "@/components/admin/cham-cong/classes";
import type { BuoiGop } from "@/lib/phan-cong/luoi-gop";
import type { ChiTietBuoi } from "@/lib/phan-cong/chi-tiet-buoi-db";
import type { DongPhanCong } from "@/lib/parttime/bang-phan-cong";
import { TONE_CLS, type Tone } from "./loc";
import { ChipChamCong, LichSu, NhatKySua, Pill, SuaBuoiDaQua, type GiaoVien } from "./thao-tac-buoi";

const KIEU: Partial<Record<DongPhanCong["assignmentType"], string>> = {
  SUBSTITUTE: "Dạy thay",
  MANUAL: "Phân tay",
  CUTOVER: "Nhập lúc chuyển đổi",
};

function tinhTrangBuoi(ct: ChiTietBuoi): { nhan: string; tone: Tone } {
  if (ct.tinhTrang === "DA_DONG") return { nhan: ct.lyDoDong ?? "Buổi đã đóng", tone: "muted" };
  if (ct.tinhTrang === "DA_CHOT") return { nhan: "Đã kết thúc", tone: "muted" };
  if (!ct.apDung) return { nhan: "Chính sách cũ", tone: "muted" };
  if (ct.daQua) return { nhan: "Đã qua, chưa chốt", tone: "warning" };
  return { nhan: "Đang mở", tone: "info" };
}

/** Một người của buổi: ba tầng thành ba dòng nhãn — đọc được ở 320px (không bảng ngang). */
function BaTang({ vai, pc, ct }: { vai: string; pc: DongPhanCong; ct: ChiTietBuoi }) {
  const bc = ct.bangChung[pc.id];
  const xn = ct.xacNhan[pc.id];
  return (
    <div className="min-w-0 rounded-md bg-muted/40 px-2.5 py-2" data-ba-tang={pc.id}>
      <p className="text-xs font-semibold text-muted-foreground">{vai}</p>
      <dl className="mt-1 grid grid-cols-[4.75rem_minmax(0,1fr)] items-baseline gap-x-2 gap-y-1 text-sm">
        <dt className="text-xs text-muted-foreground">Kế hoạch</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="font-medium text-foreground">{pc.ten}</span>
          {KIEU[pc.assignmentType] && <Pill tone={pc.assignmentType === "CUTOVER" ? "warning" : "info"}>{KIEU[pc.assignmentType]}</Pill>}
        </dd>
        <dt className="text-xs text-muted-foreground">Thực tế</dt>
        <dd className="min-w-0" data-thuc-te>
          {bc ? <ChipChamCong n={bc} /> : <span className="text-xs text-muted-foreground">Chưa có dữ liệu chấm công</span>}
        </dd>
        <dt className="text-xs text-muted-foreground">Xác nhận</dt>
        <dd className="min-w-0" data-xac-nhan>
          {xn ? (
            <span title={xn.chiTiet} className={cn(PILL, TONE_CLS[xn.tone])}>
              {xn.nhan}
              <span className="sr-only">. {xn.chiTiet}</span>
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Không thuộc đối soát công (ngoài SR.QD.238)</span>
          )}
        </dd>
      </dl>
      {xn && <p className="mt-1 text-xs text-muted-foreground">{xn.chiTiet}</p>}
    </div>
  );
}

export function ChiTietBuoiView({
  b,
  ct,
  tenCua,
  giaoVien,
  suaQuaDuoc,
}: {
  b: BuoiGop;
  ct: ChiTietBuoi | undefined;
  tenCua: Map<string, string>;
  giaoVien: GiaoVien[];
  /** Có quyền + công tắc để "Sửa buổi đã qua" (CÙNG cổng với `suaBuoiDaQuaAction`). BẮT BUỘC — luật 7. */
  suaQuaDuoc: boolean;
}) {
  if (!ct) return null;
  const tt = tinhTrangBuoi(ct);
  const lechNguoiDay = b.loai === "LOP" && ct.nguoiDungLop && ct.main && ct.nguoiDungLop !== ct.main.userId;
  const tongTuanThu = ct.hoSo?.tong ?? null;
  return (
    <details className="group mt-1 rounded-md border border-border" data-chi-tiet-buoi={b.key}>
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 text-sm [&::-webkit-details-marker]:hidden">
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
        <span className="font-medium text-foreground">Chi tiết buổi</span>
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          <Pill tone={tt.tone}>{tt.nhan}</Pill>
          {tongTuanThu && <Pill tone={tongTuanThu.tone}>{tongTuanThu.nhan}</Pill>}
          {lechNguoiDay && <Pill tone="warning">Người dạy khác kế hoạch</Pill>}
          {ct.nhatKySua.length > 0 && <Pill tone="muted">Đã sửa {ct.nhatKySua.length} lần</Pill>}
        </span>
      </summary>
      <div className="space-y-3 border-t border-border px-2.5 pb-3 pt-2.5">
        <section aria-label="Kế hoạch · Thực tế · Xác nhận" className="space-y-2">
          {ct.main ? <BaTang vai={b.loai === "LOP" ? "Đứng chính" : "Người dạy"} pc={ct.main} ct={ct} /> : <p className="text-sm text-state-warning-ink">Chưa có người đứng chính.</p>}
          {ct.ta && <BaTang vai="Trợ giảng" pc={ct.ta} ct={ct} />}
          {lechNguoiDay && (
            <p className="text-xs text-state-warning-ink" data-lech-nguoi-day>
              Người được tính công dạy buổi này là <b>{tenCua.get(ct.nguoiDungLop!) ?? "người khác"}</b>, khác người đứng chính theo kế hoạch.
            </p>
          )}
        </section>

        <section aria-label="Tuân thủ buổi dạy">
          <h4 className="mb-1 text-xs font-semibold text-muted-foreground">Tuân thủ buổi dạy</h4>
          {ct.hoSo ? (
            <HoSoBuoi n={ct.hoSo} />
          ) : (
            <p className="text-xs text-muted-foreground">Chưa có dữ liệu — buổi chưa diễn ra, đã huỷ hoặc ngoài SR.QD.238. Không có nghĩa là giáo viên vắng.</p>
          )}
        </section>

        {ct.suaQua &&
          (ct.suaQua.loi ? (
            <p className="rounded-md bg-muted px-2.5 py-2 text-xs text-muted-foreground" data-sua-qua="khoa">
              <b className="text-foreground">Sửa buổi đã qua:</b> {ct.suaQua.loi}
            </p>
          ) : suaQuaDuoc ? (
            <SuaBuoiDaQua b={{ sourceType: b.sourceType, sourceId: b.sourceId, tinhTrang: ct.tinhTrang, nguoiDungLop: ct.nguoiDungLop, main: ct.main, ta: ct.ta }} giaoVien={giaoVien} />
          ) : (
            <p className="rounded-md bg-muted px-2.5 py-2 text-xs text-muted-foreground" data-sua-qua="chi-xem">
              Chỉ người phân công được ở cơ sở này (công tắc đang bật) mới sửa được buổi đã qua.
            </p>
          ))}

        {ct.nhatKySua.length > 0 && <NhatKySua ds={ct.nhatKySua} />}
        {ct.lichSu.length > 0 && <LichSu ds={ct.lichSu} />}
      </div>
    </details>
  );
}
