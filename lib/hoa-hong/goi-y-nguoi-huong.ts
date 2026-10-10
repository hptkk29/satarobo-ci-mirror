// lib/hoa-hong/goi-y-nguoi-huong.ts — GỢI Ý ở bước «Người hưởng»: vai nào cần nguồn có gì, TRƯỚC khi bấm Kích hoạt mới bị chặn. THUẦN, an toàn cho client.
//
// Ba điều kiện này đã có ở guardrail kích hoạt (máy chủ là cổng thật): `NGUON_CHUA_CO_NGUOI_PHU_TRACH` · `NGUON_KHONG_CO_PHU_HUYNH_GIOI_THIEU` · `NGUON_TOAN_CUC_THIEU_NGUOI_PHU_TRACH`.
// Hiện lại ở bước chọn vai là để người soạn biết SỚM — không phải đi qua bảy bước rồi mới gặp dòng đỏ. Mã trả về là CHÍNH mã của guardrail (một tên cho một việc), và ca [GYV-PAR]
// đưa cùng một đầu vào cho CẢ HAI rồi đòi tập mã khớp nhau: guardrail đổi điều kiện mà hàm này không đổi (hoặc ngược lại) là đỏ ngay.
//
// ⚠️ So theo KIỂU/KHOÁ của vai (`resolverType` · `resolverKey`) và THUỘC TÍNH của nguồn (`referrerRequirement` · có người phụ trách) — không so mã nguồn (lưới [DYN-NOHARD]).
import type { NguonSoan } from "./nguon-cho-soan";

export type VaiGoiY = { code: string; name: string; resolverType: string; resolverKey: string | null };

export type PhamViGoiY = { loai: "GLOBAL" } | { loai: "SOURCE_GROUP"; sourceGroupId: string } | { loai: "ORG_UNIT" };

export type MaGoiY = "NGUON_CHUA_CO_NGUOI_PHU_TRACH" | "NGUON_KHONG_CO_PHU_HUYNH_GIOI_THIEU" | "NGUON_TOAN_CUC_THIEU_NGUOI_PHU_TRACH";

export type GoiYVai = {
  ma: MaGoiY;
  vai: string;
  noiDung: string;
  /** Tên nguồn thiếu — chỉ có ở `NGUON_TOAN_CUC_THIEU_NGUOI_PHU_TRACH`. */
  nguonThieu: readonly string[];
};

/** Nguồn nào được coi là «đang hoạt động» ở phạm vi chung: ĐÚNG `status = ACTIVE` như guardrail (`dangHoatDong`), không xét khoảng hiệu lực. */
const dangHoatDongTheoGuardrail = (n: NguonSoan) => n.trangThai === "HOAT_DONG" || n.trangThai === "CHUA_HIEU_LUC" || n.trangThai === "HET_HAN";

export function goiYVaiVoiNguon(d: { vai: readonly VaiGoiY[]; phamVi: PhamViGoiY; nguon: readonly NguonSoan[] }): GoiYVai[] {
  const ra: GoiYVai[] = [];
  const idNguon = d.phamVi.loai === "SOURCE_GROUP" ? d.phamVi.sourceGroupId : null;
  const g = idNguon === null ? undefined : d.nguon.find((n) => n.id === idNguon);
  for (const v of d.vai) {
    if (d.phamVi.loai === "SOURCE_GROUP") {
      if (!g) continue; // chưa chọn nguồn / nguồn không có trong danh sách: guardrail báo `NGUON_KHONG_HOAT_DONG`, không phải ba mã này
      if (v.resolverType === "SOURCE_OWNER" && !g.coNguoiPhuTrach) {
        ra.push({
          ma: "NGUON_CHUA_CO_NGUOI_PHU_TRACH",
          vai: v.code,
          noiDung: `Vai «${v.name}» trả cho người phụ trách của nguồn, mà nguồn «${g.name}» chưa khai người phụ trách — khoản thu nào của nguồn này cũng vào hàng chờ và không ai nhận. Khai người phụ trách ở cấu hình nguồn trước.`,
          nguonThieu: [],
        });
      }
      if (v.resolverKey === "REFERRER_PARENT_SALE" && g.referrerRequirement !== "PARENT") {
        ra.push({
          ma: "NGUON_KHONG_CO_PHU_HUYNH_GIOI_THIEU",
          vai: v.code,
          noiDung: `Vai «${v.name}» chỉ có người khi nguồn là kiểu «phụ huynh giới thiệu»; nguồn «${g.name}» không phải kiểu đó nên khoản thu nào cũng vào hàng chờ. Dùng vai này cho nguồn kiểu phụ huynh giới thiệu, hoặc chọn vai khác.`,
          nguonThieu: [],
        });
      }
    } else if (v.resolverType === "SOURCE_OWNER") {
      const thieu = d.nguon.filter((n) => dangHoatDongTheoGuardrail(n) && !n.coNguoiPhuTrach).map((n) => n.name);
      if (thieu.length > 0) {
        ra.push({
          ma: "NGUON_TOAN_CUC_THIEU_NGUOI_PHU_TRACH",
          vai: v.code,
          noiDung: `Vai «${v.name}» ở phạm vi chung áp cho MỌI nguồn, mà ${thieu.length} nguồn đang hoạt động chưa khai người phụ trách (${thieu.slice(0, 5).join(", ")}${thieu.length > 5 ? ` và ${thieu.length - 5} nguồn khác` : ""}) — khoản thu của các nguồn đó vào hàng chờ. Khai người phụ trách cho các nguồn ấy, hoặc đặt chính sách ở phạm vi riêng của nguồn có chủ.`,
          nguonThieu: thieu,
        });
      }
    }
  }
  return ra;
}
