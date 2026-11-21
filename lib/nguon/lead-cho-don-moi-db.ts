// lib/nguon/lead-cho-don-moi-db.ts — cửa gọi KHÔNG scope cho `leadChoDonMoi` từ `app/(admin)/**` (ESLint cấm import `@/lib/db` trần ở đó).
// Lý do không scope và các cổng cách ly: xem đầu `lead-cho-don-moi.ts`. Chỉ trả id + loại.
import { db } from "@/lib/db";
import { leadChoDonMoi, type KetQuaLeadChoDonMoi, type PhamViCoSoNoiLead } from "@/lib/nguon/lead-cho-don-moi";

export async function leadChoDonMoiKhongScope(p: {
  customerPhone: string | null | undefined;
  hocVienIds: readonly string[];
  phamVi: PhamViCoSoNoiLead;
}): Promise<KetQuaLeadChoDonMoi> {
  return leadChoDonMoi(db, p);
}

export type KetQuaNoiLeadDonTay = {
  /** Lead được nối tự động (đơn vẫn mang `data.leadId` của form nếu có — hàm này chỉ chạy khi form KHÔNG khai). */
  leadNoiTuDong: { leadId: string; nguon: "HOC_VIEN" | "SDT" } | null;
  /** ≥ 2 lead ứng viên: KHÔNG tự gắn, báo người tạo. */
  canhBaoLead: { soLead: number } | null;
};

/**
 * Quyết định nối `Order.leadId` cho đơn lập TAY (O1, doc 03 §5.4) — TẤT CẢ điều kiện nằm ở đây để test được bằng Postgres (bản đầu viết thẳng trong Server Action: reviewer cấy
 * `hocVienIds: []`, `NHIEU ⇒ gắn leadIds[0]`, bỏ `canhBaoLead` mà KHÔNG ca nào đỏ).
 *
 * Chỉ chạy khi: người tạo là quản lý (`canManageAll` — Sale chỉ-có-`orders:create` đã bị ép gắn lead CỦA MÌNH ở cổng G-A), form KHÔNG khai lead, và đơn là KHOÁ HỌC (đơn bán lẻ không sinh hoa hồng học phí).
 */
export async function noiLeadChoDonTay(p: {
  canManageAll: boolean;
  leadKhaiTrenForm: string | null;
  loaiDon: string;
  customerPhone: string;
  hocVienIds: readonly string[];
  /** Cơ sở khai trên đơn (`null` = không khai ⇒ fail-closed, xem `PhamViCoSoNoiLead`). */
  centerIdDon: string | null;
  /** BẮT BUỘC (luật 7): người tạo nhìn được MỌI cơ sở (`getModelVisibleCenterIds("Order", actor) === "ALL"`)? Chỉ khi đó đơn không khai cơ sở mới không bị cách ly. */
  nhinThayMoiCoSo: boolean;
}): Promise<KetQuaNoiLeadDonTay> {
  const khong: KetQuaNoiLeadDonTay = { leadNoiTuDong: null, canhBaoLead: null };
  if (!p.canManageAll || p.leadKhaiTrenForm !== null || p.loaiDon !== "COURSE") return khong;
  const kq = await leadChoDonMoiKhongScope({ customerPhone: p.customerPhone, hocVienIds: p.hocVienIds, phamVi: p.nhinThayMoiCoSo ? "TAT_CA" : { coSo: p.centerIdDon } });
  if (kq.loai === "MOT") return { leadNoiTuDong: { leadId: kq.leadId, nguon: kq.nguon }, canhBaoLead: null };
  if (kq.loai === "NHIEU") return { leadNoiTuDong: null, canhBaoLead: { soLead: kq.leadIds.length } };
  return khong;
}
