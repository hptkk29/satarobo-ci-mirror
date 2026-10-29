// LƯỢT HỌC BÙ CỦA MỘT GHI DANH — hàm THUẦN (docs/hoc-bu/DAC-TA.md §3.1).
//
// Chốt chủ dự án 29/09/2026:
//   · số học phần đăng ký suy từ SỐ BUỔI MUA (không theo tiền đã về);
//   · [ĐẢO 27/10/2026] CHỈ TÍNH HỌC PHẦN ĐỦ MỐC NGUYÊN (12→1, 24→2, 36→3, 48→4; mua 34 buổi chỉ 2 lượt). Bản 29/09 từng tính thêm một
//     lượt khi phần lẻ > 1/2 học phần ("39 buổi vẫn là 3, 43 buổi thành 4") — chủ dự án bỏ: "đạt các mốc này thì mới được";
//   · mỗi học phần mặc định 1 lượt, sửa được theo khoá; Sata 8 tắt học bù;
//   · lượt là QUỸ CHUNG của ghi danh — dùng trước lượt của học phần sau cũng được.
//
// Màn danh sách cần bù, cổng xếp case (Phiên B) và phí bù (Phiên C) cùng hỏi ở ĐÂY. Đừng
// viết lại phép đếm ở chỗ gọi: hai bản đếm là hai con số lượt cho cùng một bé.

export type HocPhanKhoa = {
  moduleCode: string;
  /** Số buổi của học phần — đếm `Lesson` của khoá theo `moduleCode`. */
  soBuoi: number;
  /** Số lượt bù cấu hình cho học phần (mặc định 1). */
  luotBu: number;
};

function soNguyenKhongAm(x: number): number {
  return Number.isFinite(x) && x > 0 ? Math.floor(x) : 0;
}

/**
 * Số học phần bé được tính là đã đăng ký, đếm từ học phần `viTriBatDau` (học phần của buổi
 * đầu tiên bé học — bé vào giữa khoá không nhận các học phần đã qua).
 */
export function soHocPhanDangKy(
  hocPhan: readonly HocPhanKhoa[],
  viTriBatDau: number,
  soBuoiMua: number,
): number {
  let conBuoi = soNguyenKhongAm(soBuoiMua);
  let dem = 0;
  for (let i = Math.max(0, Math.floor(viTriBatDau)); i < hocPhan.length; i++) {
    const co = soNguyenKhongAm(hocPhan[i]!.soBuoi);
    if (co === 0) continue;
    if (conBuoi >= co) {
      dem += 1;
      conBuoi -= co;
      continue;
    }
    // Phần lẻ KHÔNG đủ một học phần nguyên ⇒ không tính (mốc nguyên — xem đầu tệp).
    break;
  }
  return dem;
}

/** Tổng lượt bù của ghi danh = Σ lượt cấu hình của các học phần được tính. */
export function tongLuotBu(p: {
  hocPhan: readonly HocPhanKhoa[];
  viTriBatDau: number;
  soBuoiMua: number;
  choPhepHocBu: boolean;
}): number {
  if (!p.choPhepHocBu) return 0;
  const batDau = Math.max(0, Math.floor(p.viTriBatDau));
  const n = soHocPhanDangKy(p.hocPhan, batDau, p.soBuoiMua);
  let tong = 0;
  let daDem = 0;
  for (let i = batDau; i < p.hocPhan.length && daDem < n; i++) {
    const hp = p.hocPhan[i]!;
    if (soNguyenKhongAm(hp.soBuoi) === 0) continue;
    tong += soNguyenKhongAm(hp.luotBu);
    daDem += 1;
  }
  return tong;
}

export function conLuotBu(tong: number, daDung: number): number {
  return Math.max(0, soNguyenKhongAm(tong) - soNguyenKhongAm(daDung));
}
