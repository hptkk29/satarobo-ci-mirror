// lib/parttime/luong-tuan.ts — lương TUẦN của một giáo viên theo LOẠI (PR8 lưới phân công GV, 25/10/2026). THUẦN.
// KẾ HOẠCH tách từ chính các dòng tiền `ke.dong` của từng ô (không tính lại — luật 12b: tổng các loại = tổng tuần màn in);
// ĐÃ XÁC NHẬN tách từ đơn vị đã xác nhận `thucTe.dong`. Công tắc tiền Parttime tắt ⇒ đây là xem trước / đối soát, không phải số chi.
import type { DongGiaoVien, HoatDongHien } from "./luoi-tuan-ghep";

export type NhomTien = "DAY_CHINH" | "DAY_BU" | "DAY_THAY" | "HOC_VUOT" | "TRO_GIANG" | "TRUC_DU" | "TRUC_NUA" | "HO_TRO_TRIAL";
export const NHOM_TIEN: readonly NhomTien[] = ["DAY_CHINH", "DAY_BU", "DAY_THAY", "HOC_VUOT", "TRO_GIANG", "TRUC_DU", "TRUC_NUA", "HO_TRO_TRIAL"];
export const NHAN_NHOM_TIEN: Record<NhomTien, string> = {
  DAY_CHINH: "Dạy chính (lớp cố định)",
  DAY_BU: "Dạy bù",
  DAY_THAY: "Dạy thay",
  HOC_VUOT: "Học vượt",
  TRO_GIANG: "Trợ giảng",
  TRUC_DU: "Trực đủ ca",
  TRUC_NUA: "Nửa ca trực",
  HO_TRO_TRIAL: "Hỗ trợ Trial",
};

const NHOM_MAIN: Record<HoatDongHien["loai"], NhomTien> = { REGULAR: "DAY_CHINH", MAKEUP: "DAY_BU", SUBSTITUTE: "DAY_THAY", ADVANCE: "HOC_VUOT", TRIAL: "DAY_CHINH" };

export type TongHopTuan = {
  nhom: { loai: NhomTien; keHoach: number; daXacNhan: number }[];
  keHoach: number;
  daXacNhan: number;
  /** Số dòng tiền CHƯA TÍNH được (buổi lệch chuẩn, trực chờ quyết…) — không cộng vào, màn phải nói ra. */
  chuaTinh: number;
};

export function tongHopTuan(d: DongGiaoVien): TongHopTuan {
  const ke = new Map<NhomTien, number>(NHOM_TIEN.map((n) => [n, 0]));
  const xn = new Map<NhomTien, number>(NHOM_TIEN.map((n) => [n, 0]));
  const cong = (m: Map<NhomTien, number>, n: NhomTien, v: number) => m.set(n, m.get(n)! + v);
  let chuaTinh = 0;
  for (const ngay of Object.values(d.o))
    for (const o of Object.values(ngay)) {
      const loaiCua = new Map(o.hoatDong.map((h) => [h.id, h.loai]));
      for (const dong of o.ke?.dong ?? []) {
        if (dong.thanhTien == null) {
          chuaTinh++;
          continue;
        }
        if (dong.loai === "TRIAL") cong(ke, "HO_TRO_TRIAL", dong.thanhTien);
        else if (dong.loai === "TA") cong(ke, "TRO_GIANG", dong.thanhTien);
        else if (dong.loai === "TRUC") cong(ke, dong.soLuong >= 1 ? "TRUC_DU" : "TRUC_NUA", dong.thanhTien);
        else if (dong.nguon.length === 0) cong(ke, "DAY_CHINH", dong.thanhTien);
        else {
          // Một dòng MAIN gộp mọi tiết đứng chính của ô — chia đều theo hoạt động, phần lẻ vào hoạt động cuối (tổng giữ nguyên).
          const n = dong.nguon.length;
          const moi = Math.floor(dong.thanhTien / n);
          dong.nguon.forEach((id, i) => cong(ke, NHOM_MAIN[loaiCua.get(id) ?? "REGULAR"], i === n - 1 ? dong.thanhTien! - moi * (n - 1) : moi));
        }
      }
      for (const u of o.thucTe?.dong ?? []) {
        if (u.loai === "ASSISTANT_TEACHING") cong(xn, "TRO_GIANG", u.thanhTien);
        else if (u.loai === "OPERATIONS_DUTY") cong(xn, u.quantity >= 1 ? "TRUC_DU" : "TRUC_NUA", u.thanhTien);
        else cong(xn, NHOM_MAIN[loaiCua.get(u.assignmentId) ?? "REGULAR"], u.thanhTien);
      }
    }
  const nhom = NHOM_TIEN.map((loai) => ({ loai, keHoach: ke.get(loai)!, daXacNhan: xn.get(loai)! }));
  return { nhom, keHoach: nhom.reduce((s, n) => s + n.keHoach, 0), daXacNhan: nhom.reduce((s, n) => s + n.daXacNhan, 0), chuaTinh };
}
