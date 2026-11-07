// app/(admin)/admin/ai-lead/cau-hinh/_components/khac-biet-quy-tac.ts — TÓM TẮT KHÁC BIỆT giữa bộ SLA/thông báo đang áp dụng và bản sắp lưu. THUẦN (không React, không đồng hồ).
//
// Vì sao có: hộp «Lưu phiên bản mới» từng chỉ hỏi lý do — người bấm không thấy mình sắp đổi gì, mà phiên bản đã lưu là bất biến (chỉ khôi phục bằng phiên bản MỚI). Bản tóm tắt dùng đúng
// khoá nhận diện của máy chủ (`khoaQuyTac`) nên «thêm / sửa / xoá» ở đây trùng với cách máy chủ so hai bộ. Không có ở đây: mọi logic kiểm hợp lệ (máy chủ kiểm lại).
import { CAU_NHOM_NGUOI_NHAN, khoaQuyTac, type QuyTac, type SuKienThongBao } from "@/lib/ai-lead/dich-vu/bo-quy-tac-schema";

export const CAU_SU_KIEN: Record<SuKienThongBao, string> = {
  DRAFT_NEEDS_STAFF: "Hồ sơ mới cần người xử lý",
  SLA_CLAIM_OVERDUE: "Quá hạn NHẬN hồ sơ",
  SLA_RESOLVE_OVERDUE: "Quá hạn XỬ LÝ hồ sơ (đã nhận mà bỏ dở)",
  INCIDENT: "Sự cố Agent mức cao",
};

export type KhacBiet = { them: string[]; sua: string[]; xoa: string[] };

type TenCoSo = (centerId: string) => string;

/** Mô tả MỘT quy tắc SLA/thông báo bằng chữ cho người vận hành. Quy tắc loại khác (ROUTE/AUTO) không thuộc màn này ⇒ chuỗi rỗng. */
export function moTaQuyTac(r: QuyTac, tenCoSo: TenCoSo): string {
  if (r.kind === "SLA") {
    const pham = r.scope.type === "DEFAULT" ? "mặc định" : r.scope.type === "PAGE" ? `Page ${r.scope.pageId}` : `cơ sở ${tenCoSo(r.scope.centerId)}`;
    return `SLA ${pham}: nhận trong ${r.claimMinutes}′, xử lý trong ${r.resolveMinutes}′`;
  }
  if (r.kind === "NOTIFY") {
    const co = r.centerId === null ? "mọi cơ sở" : `cơ sở ${tenCoSo(r.centerId)}`;
    const luc = r.afterMinutes === 0 ? "ngay" : `sau ${r.afterMinutes}′ (leo thang)`;
    return `Báo «${CAU_SU_KIEN[r.event]}» ${luc} · ${co} → ${r.to.map((n) => CAU_NHOM_NGUOI_NHAN[n]).join(", ")}`;
  }
  return "";
}

const laSlaHoacTb = (r: QuyTac): boolean => r.kind === "SLA" || r.kind === "NOTIFY";

/**
 * So hai danh sách theo khoá của máy chủ. `sua` chỉ có ở cùng khoá mà nội dung khác (SLA đổi phút · thông báo đổi nhóm nhận). Thông báo đổi «sau bao nhiêu phút» là KHOÁ khác (khoá chứa afterMinutes)
 * nên hiện thành «xoá» + «thêm» — đúng với cách máy chủ lưu.
 */
export function tomTatKhacBiet(cu: QuyTac[], moi: QuyTac[], tenCoSo: TenCoSo): KhacBiet {
  const theoKhoa = (ds: QuyTac[]) => new Map(ds.filter(laSlaHoacTb).map((r) => [khoaQuyTac(r), r] as const));
  const a = theoKhoa(cu);
  const b = theoKhoa(moi);
  const kq: KhacBiet = { them: [], sua: [], xoa: [] };
  for (const [k, r] of b) {
    const truoc = a.get(k);
    if (!truoc) kq.them.push(moTaQuyTac(r, tenCoSo));
    else if (JSON.stringify(truoc) !== JSON.stringify(r)) kq.sua.push(`${moTaQuyTac(truoc, tenCoSo)}  ⇒  ${moTaQuyTac(r, tenCoSo)}`);
  }
  for (const [k, r] of a) if (!b.has(k)) kq.xoa.push(moTaQuyTac(r, tenCoSo));
  return kq;
}

export const soThayDoi = (k: KhacBiet): number => k.them.length + k.sua.length + k.xoa.length;
