// lib/hoa-hong/phan-bo-khoan.ts — TÁCH THÀNH PHẦN + PHÂN BỔ HỌC VIÊN của MỘT khoản thu (THU).
//
// Nguồn: docs/source-commission/04 §4.3 (thành phần, D17), §4.4 (học viên). THUẦN — dữ liệu đã nạp.
//
// MỘT khoản thu ⇒ tối đa MỘT phần: engine KHÔNG chia một khoản cho nhiều bé / nhiều thành phần (04 §4.3 "Không chia theo
// giá dòng", §4.4 "Không chia tỉ lệ cho nhiều học viên") vì chia theo giá bỏ qua phần đã thu của từng dòng ⇒ trả hoa hồng
// trên tiền học cụ. Gặp ca phải đoán ⇒ HÀNG CHỜ (L7), không đoán.
//
// Thứ tự thử (dừng ở bước đầu cho đúng một đáp án):
//   1. `Payment.orderItemId`                       → dòng đó                        (cachTach DONG)
//   2. `Payment.enrollmentId` khớp ĐÚNG MỘT dòng   → dòng đó                        (cachTach DONG)
//   3. đơn KHÔNG có dòng                           → theo loại đơn                  (MOT_THANH_PHAN)
//   4. mọi dòng cùng một thành phần                → thành phần đó                  (MOT_THANH_PHAN)
//   5. đơn TRỘN, đúng MỘT thành phần còn nợ và khoản ≤ phần nợ ấy → thành phần đó   (CON_NO_DUY_NHAT)
//   6. còn lại                                     → CHUA_GAN_CON
import { thanhPhanTheoLoaiDong, type ThanhPhanDoanhThu } from "./loai-giao-dich";

export type DongDonPhanBo = {
  orderItemId: string;
  /** `OrderItemType` dạng chuỗi — loại lạ ⇒ PENDING_REGULATION, không đoán. */
  loai: string;
  enrollmentId: string | null;
  studentId: string | null;
  /** `Enrollment.studentId` của ghi danh nối với dòng. */
  enrollmentStudentId: string | null;
};

export type DauVaoPhanBo = {
  /** Số tiền gộp của khoản (VND, > 0) — dùng so với phần còn nợ ở bước 5. */
  soTien: number;
  orderItemId: string | null;
  enrollmentId: string | null;
  /** `Enrollment.studentId` của ghi danh gắn trên CHÍNH khoản thu. */
  enrollmentStudentId: string | null;
  /** `OrderType` dạng chuỗi — chỉ dùng khi đơn không có dòng. */
  orderType: string;
  dongDon: readonly DongDonPhanBo[];
  /** `Student.id` khi `Order.leadChildId` khớp ĐÚNG MỘT học viên; ngược lại `null`. */
  hocVienTheoLeadChild: string | null;
  /**
   * Còn nợ từng dòng TRƯỚC khoản này (đã trừ phần các khoản không gắn đứng trước đã được quy cho thành phần đó).
   * Dòng vắng trong map ⇒ 0.
   */
  conNoTheoDong: ReadonlyMap<string, number>;
};

export type CachTach = "DONG" | "MOT_THANH_PHAN" | "CON_NO_DUY_NHAT";

export type KetQuaPhanBo =
  | {
      loai: "TACH";
      orderItemId: string | null;
      thanhPhan: "TUITION";
      cachTach: CachTach;
      studentId: string;
    }
  | { loai: "NGOAI_PHAM_VI"; thanhPhan: Exclude<ThanhPhanDoanhThu, "TUITION">; cachTach: CachTach }
  | { loai: "GIU"; ma: "CHUA_GAN_CON" | "CHO_HOC_VIEN" | "PENDING_REGULATION"; lyDo: string };

const giu = (ma: "CHUA_GAN_CON" | "CHO_HOC_VIEN" | "PENDING_REGULATION", lyDo: string): KetQuaPhanBo => ({ loai: "GIU", ma, lyDo });

/** 04 §4.3 bảng "đơn không có dòng nào": lùi về `OrderType`. `COMBO` là "bundle, defer" ⇒ không quyết được. */
function thanhPhanTheoLoaiDon(orderType: string): ThanhPhanDoanhThu | null {
  switch (orderType) {
    case "COURSE":
    case "PACKAGE":
      return "TUITION";
    case "PRODUCT":
      return "MATERIAL";
    case "EXAM":
      return "OTHER";
    default:
      return null;
  }
}

function ketQuaTheoDong(
  d: DongDonPhanBo,
  cachTach: CachTach,
  hocVienTheoLeadChild: string | null,
): KetQuaPhanBo {
  const tp = thanhPhanTheoLoaiDong(d.loai);
  if (tp === null) return giu("PENDING_REGULATION", `Dòng ${d.orderItemId} có loại "${d.loai}" chưa được phân vào thành phần doanh thu nào.`);
  if (tp !== "TUITION") return { loai: "NGOAI_PHAM_VI", thanhPhan: tp, cachTach };
  const studentId = d.studentId ?? d.enrollmentStudentId ?? hocVienTheoLeadChild;
  if (!studentId) {
    return giu("CHO_HOC_VIEN", `Dòng ${d.orderItemId} chưa có học viên (đơn tạo trước convert) — chờ có Student hoặc ghi danh.`);
  }
  return { loai: "TACH", orderItemId: d.orderItemId, thanhPhan: "TUITION", cachTach, studentId };
}

export function phanBoKhoan(d: DauVaoPhanBo): KetQuaPhanBo {
  if (!Number.isInteger(d.soTien) || d.soTien <= 0) throw new Error(`Khoản thu phải là số nguyên dương: ${d.soTien}`);

  // 1. gắn dòng đơn
  if (d.orderItemId !== null) {
    const dong = d.dongDon.find((x) => x.orderItemId === d.orderItemId);
    if (!dong) return giu("CHUA_GAN_CON", `Khoản gắn dòng ${d.orderItemId} nhưng dòng đó không thuộc đơn — không đoán.`);
    return ketQuaTheoDong(dong, "DONG", d.hocVienTheoLeadChild);
  }

  // 2. gắn ghi danh khớp đúng một dòng
  if (d.enrollmentId !== null) {
    const khop = d.dongDon.filter((x) => x.enrollmentId === d.enrollmentId);
    if (khop.length === 1) return ketQuaTheoDong(khop[0]!, "DONG", d.hocVienTheoLeadChild);
  }

  // 3. đơn không có dòng nào
  if (d.dongDon.length === 0) {
    const tp = thanhPhanTheoLoaiDon(d.orderType);
    if (tp === null) {
      return giu("PENDING_REGULATION", `Đơn loại ${d.orderType} không có dòng nào — không có văn bản nói phần nào là học phí.`);
    }
    if (tp !== "TUITION") return { loai: "NGOAI_PHAM_VI", thanhPhan: tp, cachTach: "MOT_THANH_PHAN" };
    const studentId = d.enrollmentStudentId ?? d.hocVienTheoLeadChild;
    if (!studentId) return giu("CHUA_GAN_CON", "Đơn không có dòng nào và khoản không ra được học viên.");
    return { loai: "TACH", orderItemId: null, thanhPhan: "TUITION", cachTach: "MOT_THANH_PHAN", studentId };
  }

  // 4. mọi dòng cùng một thành phần
  const thanhPhanCuaDong = new Map<string, ThanhPhanDoanhThu | null>();
  for (const x of d.dongDon) thanhPhanCuaDong.set(x.orderItemId, thanhPhanTheoLoaiDong(x.loai));
  const laDong = d.dongDon.find((x) => thanhPhanCuaDong.get(x.orderItemId) === null);
  if (laDong) return giu("PENDING_REGULATION", `Dòng ${laDong.orderItemId} có loại "${laDong.loai}" chưa được phân vào thành phần doanh thu nào.`);
  const tapThanhPhan = new Set(thanhPhanCuaDong.values() as Iterable<ThanhPhanDoanhThu>);

  const hocVienChoKhoanKhongGanDong = (): string | null => d.enrollmentStudentId;

  if (tapThanhPhan.size === 1) {
    const tp = [...tapThanhPhan][0]!;
    if (tp !== "TUITION") return { loai: "NGOAI_PHAM_VI", thanhPhan: tp, cachTach: "MOT_THANH_PHAN" };
    if (d.dongDon.length === 1) return ketQuaTheoDong(d.dongDon[0]!, "MOT_THANH_PHAN", d.hocVienTheoLeadChild);
    const sid = hocVienChoKhoanKhongGanDong();
    if (sid) return { loai: "TACH", orderItemId: null, thanhPhan: "TUITION", cachTach: "MOT_THANH_PHAN", studentId: sid };
    return giu("CHUA_GAN_CON", `Đơn có ${d.dongDon.length} dòng học phí và khoản chưa gắn bé nào — không chia tỉ lệ cho các bé.`);
  }

  // 5. đơn TRỘN
  const no = (id: string) => Math.max(0, d.conNoTheoDong.get(id) ?? 0);
  const noTheoThanhPhan = new Map<ThanhPhanDoanhThu, number>();
  for (const x of d.dongDon) {
    const tp = thanhPhanCuaDong.get(x.orderItemId)!;
    noTheoThanhPhan.set(tp, (noTheoThanhPhan.get(tp) ?? 0) + no(x.orderItemId));
  }
  const conNo = [...noTheoThanhPhan.entries()].filter(([, n]) => n > 0);
  const chiTiet = [...noTheoThanhPhan.entries()].map(([tp, n]) => `${tp}=${n}`).join(", ");
  if (conNo.length !== 1) {
    return giu("CHUA_GAN_CON", `Đơn trộn, khoản chưa gắn dòng; còn nợ theo thành phần: ${chiTiet} — ${conNo.length === 0 ? "không thành phần nào còn nợ" : "nhiều thành phần còn nợ, không đoán"}.`);
  }
  const [tp, soNo] = conNo[0]!;
  if (d.soTien > soNo) {
    return giu("CHUA_GAN_CON", `Đơn trộn; khoản ${d.soTien} lớn hơn phần ${tp} còn nợ (${soNo}) — không đoán phần dư thuộc đâu.`);
  }
  if (tp !== "TUITION") return { loai: "NGOAI_PHAM_VI", thanhPhan: tp, cachTach: "CON_NO_DUY_NHAT" };
  const dongHocPhiConNo = d.dongDon.filter((x) => thanhPhanCuaDong.get(x.orderItemId) === "TUITION" && no(x.orderItemId) > 0);
  if (dongHocPhiConNo.length === 1) return ketQuaTheoDong(dongHocPhiConNo[0]!, "CON_NO_DUY_NHAT", d.hocVienTheoLeadChild);
  const sid = hocVienChoKhoanKhongGanDong();
  if (sid) return { loai: "TACH", orderItemId: null, thanhPhan: "TUITION", cachTach: "CON_NO_DUY_NHAT", studentId: sid };
  return giu("CHUA_GAN_CON", `Đơn trộn có ${dongHocPhiConNo.length} dòng học phí còn nợ — khoản chưa gắn bé nào.`);
}

// ── Còn nợ từng dòng TRƯỚC một khoản (04 §4.3 bước 3) ────────────────────────────────────────────

export type DongNo = DongDonPhanBo & { phaiThu: number };

export type KhoanTruoc = {
  amount: number;
  orderItemId: string | null;
  enrollmentId: string | null;
  enrollmentStudentId: string | null;
};

/**
 * Còn nợ từng dòng đơn tại thời điểm TRƯỚC khoản đang xét. `khoanTruoc` là các khoản THU dương đứng trước, ĐÃ sắp theo
 * `(paidDate, id)`.
 *
 * `tinhNoTheoCon` chỉ cộng khoản CÓ `orderItemId` (`lib/finance/no-theo-con.ts:323`), nên phần các khoản KHÔNG gắn đứng trước đã
 * được quy cho thành phần nào phải trừ thêm — bằng CHÍNH `phanBoKhoan` chạy tuần tự (cùng một luật, không bản thứ hai):
 *   · khoản gắn dòng                    → trừ vào dòng đó;
 *   · khoản không gắn, ra TACH có dòng  → trừ vào dòng đó;
 *   · khoản không gắn, ra NGOÀI PHẠM VI → trừ lần lượt vào các dòng CÙNG thành phần (dư thì dồn dòng đầu — nợ có thể âm);
 *   · khoản không gắn, bị giữ           → KHÔNG trừ (không đoán).
 * Nợ có thể ÂM (đóng thừa); `phanBoKhoan` đọc phần dương.
 */
export function tinhConNoTheoDongTruocKhoan(input: {
  dong: readonly DongNo[];
  khoanTruoc: readonly KhoanTruoc[];
  orderType: string;
  hocVienTheoLeadChild: string | null;
}): Map<string, number> {
  const no = new Map<string, number>(input.dong.map((d) => [d.orderItemId, d.phaiThu]));
  const dongDon: DongDonPhanBo[] = input.dong.map((d) => ({
    orderItemId: d.orderItemId,
    loai: d.loai,
    enrollmentId: d.enrollmentId,
    studentId: d.studentId,
    enrollmentStudentId: d.enrollmentStudentId,
  }));
  for (const k of input.khoanTruoc) {
    if (k.amount <= 0) continue;
    if (k.orderItemId !== null && no.has(k.orderItemId)) {
      no.set(k.orderItemId, no.get(k.orderItemId)! - k.amount);
      continue;
    }
    const r = phanBoKhoan({
      soTien: k.amount,
      orderItemId: null,
      enrollmentId: k.enrollmentId,
      enrollmentStudentId: k.enrollmentStudentId,
      orderType: input.orderType,
      dongDon,
      hocVienTheoLeadChild: input.hocVienTheoLeadChild,
      conNoTheoDong: new Map(no),
    });
    if (r.loai === "TACH" && r.orderItemId !== null) {
      no.set(r.orderItemId, (no.get(r.orderItemId) ?? 0) - k.amount);
    } else if (r.loai === "NGOAI_PHAM_VI") {
      const cungThanhPhan = dongDon.filter((d) => thanhPhanTheoLoaiDong(d.loai) === r.thanhPhan);
      let con = k.amount;
      for (const d of cungThanhPhan) {
        const co = Math.max(0, no.get(d.orderItemId) ?? 0);
        const tru = Math.min(con, co);
        no.set(d.orderItemId, (no.get(d.orderItemId) ?? 0) - tru);
        con -= tru;
        if (con === 0) break;
      }
      if (con > 0 && cungThanhPhan[0]) no.set(cungThanhPhan[0].orderItemId, (no.get(cungThanhPhan[0].orderItemId) ?? 0) - con);
    }
  }
  return no;
}
