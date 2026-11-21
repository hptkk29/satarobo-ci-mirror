// lib/phan-cong/ghi-theo-phan-cong.ts — KẾ HOẠCH ghi cứng công Parttime lúc CHỐT KỲ theo PHÂN CÔNG (chủ dự án chốt 09/11/2026). THUẦN.
//
// "Sửa chốt kỳ ghi theo phân công": lúc chốt kỳ (luật công MỚI, mốc `shift.parttimeLuatCongMoiTuKy`), ghi công cho MỌI tiết / ca trực ĐÃ
// PHÂN CÔNG còn sống — ĐÚNG số engine "Lương dự kiến" (`docLuoiTuan` → `ghepLuoi` → `tinhCaDuKien`): số tiết, trực quy đổi, đơn giá + Rank
// tại ngày. Lượt quét chỉ là BẰNG CHỨNG, KHÔNG còn là điều kiện ghi (bản trước 09/11 chỉ ghi ô đủ lượt quét — `docCongOThang` TU_DONG).
// Muộn / sớm chỉ trừ qua CompensationAdjustment QLCS đã xác nhận (không đổi ở đây).
//
// KHÔNG ghi tự động (vào `boQua`, nói rõ lý do; QLCS xử lý như cũ rồi chốt lại):
//   · tiết lệch chuẩn chưa ghi đè số tiết (Q1) — engine không tính (`ke.tiet[].soTiet == null`);
//   · ca trực engine "chưa tính được" (`thanhTien == null` — ô có tiết lệch chuẩn / quá số tiết);
//   · phân công vượt ranh ca (không nằm trong ô nào ⇒ engine không tính).
// Hỗ trợ Trial (09/11/2026 — chủ dự án: "làm luôn trong PR này"): ghi WorkUnit TRIAL_SUPPORT đúng `xetHoTroTrial` của engine (số HV có
// mặt × mức). Buổi Trial không đủ điều kiện (0đ) ⇒ không có gì để ghi.
// Việc học bù / Trial GHÉP vào việc khác (không cộng tiết) không có trong `ke.tiet` ⇒ không ghi — đúng như engine.
import type { DongGiaoVien } from "@/lib/parttime/luoi-tuan-ghep";

export type MucGhiDay = {
  assignmentId: string;
  userId: string;
  ngay: string;
  ca: string;
  loai: "MAIN_TEACHING" | "ASSISTANT_TEACHING";
  soTiet: number;
  /** Đơn giá MỘT tiết engine dùng (đứng chính theo Rank tại ngày · trợ giảng một giá). */
  donGia: number;
  rank: number | null;
};

export type MucGhiTruc = { dutyId: string; userId: string; ngay: string; ca: string; soCa: number; donGia: number };

/** Hỗ trợ Trial của MỘT phân công đứng chính buổi Trial: `soCoMat × donGia` = `KetQuaTrial.soTien`. */
export type MucGhiTrial = { assignmentId: string; userId: string; ngay: string; ca: string; soCoMat: number; donGia: number };

export type LoaiBoQua = "TIET_CHUA_TINH" | "TRUC_CHUA_TINH" | "VUOT_CA";
export type MucBoQua = { loai: LoaiBoQua; id: string; userId: string; ngay: string; lyDo: string; tien: number | null };

export const LY_DO_BO_QUA: Record<LoaiBoQua, string> = {
  TIET_CHUA_TINH: "Buổi lệch chuẩn chưa có số tiết (Q1) — cần quyết số tiết (ghi đè đơn vị tiết; hệ thống chưa có màn ghi đè — báo quản trị) rồi chốt lại.",
  TRUC_CHUA_TINH: "Ca trực chưa tính được (ô có buổi lệch chuẩn / quá số tiết) — quyết số tiết của buổi lệch chuẩn rồi chốt lại.",
  VUOT_CA: "Phân công vượt ranh ca (không nằm trọn ca nào) — không tính; sửa giờ phân công.",
};

export type KeHoachGhi = {
  day: MucGhiDay[];
  truc: MucGhiTruc[];
  trial: MucGhiTrial[];
  boQua: MucBoQua[];
  /** Σ tiền các mục SẼ ghi (theo số engine) — để đối chiếu với Σ Lương dự kiến trừ phần không ghi. */
  tienSeGhi: number;
};

/**
 * Lập kế hoạch từ dòng `docLuoiTuan` của MỘT cơ sở × kỳ. `apDung(userId, ngay)` = `chamTheoPhanCong` (GV parttime, ngày ≥ mốc) —
 * FULLTIME có đứng lớp giữ công ô ca, không ghi đơn vị Parttime. BẮT BUỘC (luật 7).
 */
export function keHoachGhiTheoPhanCong(dong: readonly DongGiaoVien[], apDung: (userId: string, ngay: string) => boolean): KeHoachGhi {
  const kq: KeHoachGhi = { day: [], truc: [], trial: [], boQua: [], tienSeGhi: 0 };
  for (const d of dong) {
    for (const [ngay, theoCa] of Object.entries(d.o)) {
      if (!apDung(d.userId, ngay)) continue;
      for (const v of d.ngoaiCa[ngay] ?? []) kq.boQua.push({ loai: "VUOT_CA", id: v.id, userId: d.userId, ngay, lyDo: LY_DO_BO_QUA.VUOT_CA, tien: null });
      for (const [ca, o] of Object.entries(theoCa)) {
        const ke = o.ke;
        if (!ke) continue;
        const gia = (vai: "MAIN" | "TA") => ke.dong.find((x) => x.loai === vai)?.donGia ?? null;
        for (const t of ke.tiet) {
          const donGia = gia(t.vai);
          if (t.soTiet == null || donGia == null) {
            kq.boQua.push({ loai: "TIET_CHUA_TINH", id: t.id, userId: d.userId, ngay, lyDo: LY_DO_BO_QUA.TIET_CHUA_TINH, tien: null });
            continue;
          }
          kq.day.push({ assignmentId: t.id, userId: d.userId, ngay, ca, loai: t.vai === "MAIN" ? "MAIN_TEACHING" : "ASSISTANT_TEACHING", soTiet: t.soTiet, donGia, rank: t.vai === "MAIN" ? (d.rankTheoNgay[ngay] ?? null) : null });
          kq.tienSeGhi += t.soTiet * donGia;
        }
        for (const x of ke.dong) {
          if (x.loai === "TRUC") {
            if (x.thanhTien == null) kq.boQua.push({ loai: "TRUC_CHUA_TINH", id: x.nguon[0] ?? `${d.userId}|${ngay}|${ca}`, userId: d.userId, ngay, lyDo: LY_DO_BO_QUA.TRUC_CHUA_TINH, tien: null });
            else if (x.soLuong > 0) {
              kq.truc.push({ dutyId: x.nguon[0]!, userId: d.userId, ngay, ca, soCa: x.soLuong, donGia: x.donGia });
              kq.tienSeGhi += x.soLuong * x.donGia;
            }
          }
        }
        // Hỗ trợ Trial: CÙNG danh sách `tinhCaDuKien` cộng (mọi buổi Trial đứng chính của ô có kết quả xét), mỗi buổi một đơn vị.
        for (const h of o.hoatDong) {
          if (h.vai !== "MAIN" || !h.trial || h.trial.soTien <= 0 || h.trial.soCoMat <= 0) continue;
          kq.trial.push({ assignmentId: h.id, userId: d.userId, ngay, ca, soCoMat: h.trial.soCoMat, donGia: h.trial.soTien / h.trial.soCoMat });
          kq.tienSeGhi += h.trial.soTien;
        }
      }
    }
  }
  kq.tienSeGhi = Math.round(kq.tienSeGhi);
  return kq;
}

export type TongGhiNguoi = { userId: string; tietChinh: number; tietTroGiang: number; caTruc: number; buoiTrial: number; tien: number; boQua: number; chuaTinh: number };

/** Tổng kế hoạch ghi theo người — màn "Tổng hợp tự động" in đúng thứ chốt kỳ SẼ ghi (cộng mục của kế hoạch, không tính lại). */
export function tongGhiTheoNguoi(ke: KeHoachGhi): TongGhiNguoi[] {
  const m = new Map<string, TongGhiNguoi>();
  const lay = (userId: string) => {
    let x = m.get(userId);
    if (!x) m.set(userId, (x = { userId, tietChinh: 0, tietTroGiang: 0, caTruc: 0, buoiTrial: 0, tien: 0, boQua: 0, chuaTinh: 0 }));
    return x;
  };
  for (const d of ke.day) {
    const x = lay(d.userId);
    if (d.loai === "MAIN_TEACHING") x.tietChinh += d.soTiet;
    else x.tietTroGiang += d.soTiet;
    x.tien += d.soTiet * d.donGia;
  }
  for (const t of ke.truc) {
    const x = lay(t.userId);
    x.caTruc += t.soCa;
    x.tien += t.soCa * t.donGia;
  }
  for (const t of ke.trial) {
    const x = lay(t.userId);
    x.buoiTrial++;
    x.tien += t.soCoMat * t.donGia;
  }
  for (const b of ke.boQua) {
    const x = lay(b.userId);
    x.boQua++;
    if (b.loai === "TIET_CHUA_TINH" || b.loai === "TRUC_CHUA_TINH") x.chuaTinh++;
  }
  return [...m.values()].map((x) => ({ ...x, tien: Math.round(x.tien) }));
}
