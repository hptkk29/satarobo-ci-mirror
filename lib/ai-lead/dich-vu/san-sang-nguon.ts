// lib/ai-lead/dich-vu/san-sang-nguon.ts — CỔNG «nguồn đã cấu hình chưa» TRƯỚC khi tạo lead chính thức từ hồ sơ AI (FIX nguồn Marketing HO).
//
// Vì sao có cổng: lead do AI tạo đi qua `ingestIntakeLead` với đường vào `messenger-ai` — KHÔNG nằm trong `DUONG_VAO_MAC_DINH` của bộ quy nguồn. Nếu Owner chưa cấu hình nguồn cho Page
// (nhóm «Marketing HO» + dòng `nguon.bangNguonTheoPage` + Page trong `FacebookPageMapping`) thì bộ quy nguồn âm thầm rơi UNKNOWN, hoặc — khi cờ `nguon.enabled` TẮT (mặc định) —
// KHÔNG ghi `LeadAttribution` nào. Cả hai đều là «lead chính thức không có nguồn nghiệp vụ»: hoa hồng/báo cáo sai mà không ai biết. Cổng này chặn trước khi ghi, hồ sơ đi vào Ngoại lệ
// (`NGUON_CHUA_CAU_HINH`, thử lại được) — khách KHÔNG mất, vì hồ sơ vẫn còn.
//
// KHÔNG chép điều kiện của lõi `lib/nguon`: cổng CHẠY THỬ chính bộ quy nguồn thật (`chuanBiQuyNguon` — chỉ đọc, không ghi) với tín hiệu duy nhất của đường này (`pageId`), rồi đòi kết quả là
// luật `PAGE_MAPPING`. Lõi đổi điều kiện thì cổng đổi theo, không lệch. Cố ý KHÔNG truyền SĐT: luật `KE_THUA_SDT` (kế thừa nguồn của lead cũ) là chuyện của TỪNG khách, không phải «cấu hình Page».
// Không sửa lõi nguồn, không tạo nhóm, không tạo chính sách hoa hồng, không đổi attribution cũ.
import { db } from "@/lib/db";
import { chuanBiQuyNguon, type NguonDaChuanBi } from "@/lib/nguon/noi-day";
import { KHONG_CO_TIN_HIEU_NGUON } from "@/lib/nguon/tin-hieu";

export type MaChuaSanSangNguon =
  /** Cờ `nguon.enabled` tắt, hoặc bộ quy nguồn lỗi/không chạy được (fail-closed: không đoán). */
  | "NGUON_TAT_HOAC_LOI"
  /** Bộ quy nguồn chạy được nhưng Page này KHÔNG ra nguồn theo luật `PAGE_MAPPING` (cờ pageMapping tắt · Page chưa trong danh mục CRM · chưa gán nhóm · nhóm không dùng được). */
  | "PAGE_CHUA_GAN_NGUON";

export type KetQuaSanSangNguon = { san: true; groupCode: string } | { san: false; ma: MaChuaSanSangNguon };

/** THUẦN: kết quả chạy thử của bộ quy nguồn → sẵn sàng hay không. Mọi thứ khác `PAGE_MAPPING` (kể cả UNKNOWN, luật mặc định, luật khác) đều KHÔNG sẵn sàng. */
export function danhGiaSanSangNguon(chuanBi: NguonDaChuanBi): KetQuaSanSangNguon {
  if (!chuanBi.bat) return { san: false, ma: "NGUON_TAT_HOAC_LOI" };
  const k = chuanBi.ketQua;
  if (k.luat === "PAGE_MAPPING" && k.groupCode !== "UNKNOWN") return { san: true, groupCode: k.groupCode };
  return { san: false, ma: "PAGE_CHUA_GAN_NGUON" };
}

/** Chạy thử quy nguồn cho MỘT Page. `now` do chỗ gọi truyền (luật 19). Lỗi bất kỳ ⇒ KHÔNG sẵn sàng (fail-closed). */
export async function docSanSangNguon(x: { pageId: string; centerId: string | null; now: Date }): Promise<KetQuaSanSangNguon> {
  try {
    const [chuanBi] = await chuanBiQuyNguon(db, [
      {
        bayGio: x.now,
        duongVao: "messenger-ai",
        conversionEntry: "messenger-ai",
        nhanKhai: null,
        laNhapExcel: false,
        sdtKhach: null,
        maNvNguoiNhap: null,
        nguoiNhapUserId: null,
        nhanSuGioiThieuEmployeeId: null,
        phuHuynhGioiThieu: null,
        nguonChon: null,
        affiliate: null,
        ref: null,
        refSau: [],
        quangCao: KHONG_CO_TIN_HIEU_NGUON.quangCao,
        utm: KHONG_CO_TIN_HIEU_NGUON.utm,
        pageId: x.pageId,
        orgUnitId: null,
        centerId: x.centerId,
      },
    ]);
    return chuanBi ? danhGiaSanSangNguon(chuanBi) : { san: false, ma: "NGUON_TAT_HOAC_LOI" };
  } catch {
    return { san: false, ma: "NGUON_TAT_HOAC_LOI" };
  }
}
