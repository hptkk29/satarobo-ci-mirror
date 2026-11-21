// lib/hoa-hong/quan-tri-dieu-chinh.ts — QUẢN TRỊ ĐIỀU CHỈNH hoa hồng: một người duyệt hay hai? Ai được duyệt? THUẦN — không DB, không đồng hồ.
//
// Nguồn: yêu cầu chủ dự án 10/10/2026 (hướng B+C): "NGƯỠNG CẤU HÌNH, không hard-code"; điều chỉnh bị chặn bởi giới hạn tiền hợp lý của giao dịch
// (|điều chỉnh| ≤ hoa hồng liên quan của giao dịch); vượt ⇒ cấp hai, KHÔNG im lặng cho qua. docs/source-commission/08 §16.
// YÊU CẦU LOGIC (08 §17.v4.Q): ngưỡng còn so với TỔNG của cả yêu cầu (cùng khiếu nại / cùng sự kiện đổi nguồn — nhiều ô, mỗi ô một đề xuất) để không chia một điều chỉnh lớn thành nhiều gói nhỏ.
// TÍCH LUỸ (vá sau gộp, 08 §17.x mục 1): cả ngưỡng lẫn cận so với (số đã điều chỉnh trước đó trên cùng giao dịch + gói này), và cận neo vào hoa hồng GỐC engine tính,
// không phải số ròng hiện tại — nếu không, nhiều khiếu nại nhỏ lần lượt leo qua ngưỡng mà không bao giờ cần người thứ hai.
//
// ── Ba nguyên tắc ──────────────────────────────────────────────────────────────────────────────
//   1. FAIL-CLOSED: ngưỡng thiếu/hỏng, hoặc không tính được cận tiền ⇒ CẤP HAI. Không có nhánh nào mặc định "một người".
//   2. KHÔNG SỐ TIỀN NÀO NẰM Ở ĐÂY: ngưỡng là THAM SỐ (đọc từ cấu hình ở lớp DB, chụp vào đề xuất); mặc định 10.000.000 đ khai ở `lib/settings/registry.ts`.
//      Lưới `[DXD-W2]` canh tệp này không chứa hằng tiền.
//   3. TÁCH NHIỆM: người duyệt cấp 1 ≠ người đề xuất; cấp 2 ≠ cấp 1 ≠ người đề xuất; người duyệt không phải người hưởng của dòng nào trong gói.
//      MỘT hàm (`lyDoKhongDuocDuyet`) cho cả nút (giao diện) lẫn Server Action — luật 12: nút vẽ bằng điều kiện A, action hỏi điều kiện B là lời hứa suông.
import type { KhoaNguoi } from "./khoa-so";

/** MỘT dòng của gói điều chỉnh (đóng băng lúc lập). `chenh` > 0 = trả thêm; < 0 = đòi lại. */
export type DongGoi = { key: KhoaNguoi; chenh: number; kyVong: number; rong: number };

/**
 * Trần của một số nguyên 32 bit — cột `thresholdSnapshot` / `absTotal` / `boundSnapshot` của `CommissionAdjustmentRequest` là INTEGER. Ngưỡng cấu hình lớn hơn mức này không chụp vào đề xuất được
 * (Postgres: "value out of range for type integer" — đề xuất không lập được thay vì cấp hai), nên coi là HỎNG ⇒ fail-closed.
 */
export const TRAN_INT4 = 2 ** 31 - 1; // luỹ thừa: đây là GIỚI HẠN KIỂU CỘT chứ không phải số tiền cấu hình — lưới [DXD-W2] cấm literal tiền ≥ 1000 ở tệp này

export type MucQuanTri = "SINGLE_APPROVAL" | "SECOND_APPROVAL_REQUIRED";

export type LyDoQuanTri =
  /** Ngưỡng cấu hình thiếu/hỏng lúc lập ⇒ fail-closed. */
  | { ma: "NGUONG_KHONG_DOC_DUOC" }
  /** Giá trị tuyệt đối của gói CỘNG số đã điều chỉnh trước đó trên cùng giao dịch (`tichLuy`) ≥ ngưỡng. */
  | { ma: "TU_NGUONG"; absTotal: number; tichLuy: number; nguong: number }
  /** Giá trị tuyệt đối của gói CỘNG số đã điều chỉnh trước đó (`tichLuy`) vượt hoa hồng GỐC do engine tính cho giao dịch (cận tiền hợp lý). */
  | { ma: "VUOT_CAN"; canTren: number; absTotal: number; tichLuy: number }
  /** Không dựng được cận (khoản chưa có ô tính, hoặc đầu vào cận hỏng) ⇒ fail-closed. */
  | { ma: "KHONG_TINH_DUOC_CAN" }
  /** Không đọc được số đã điều chỉnh trước đó, hoặc tổng của cả yêu cầu (đầu vào hỏng) ⇒ fail-closed. */
  | { ma: "TICH_LUY_KHONG_DOC_DUOC" }
  /** Gói này CỘNG các đề xuất khác của CÙNG yêu cầu logic (cùng khiếu nại / cùng sự kiện đổi nguồn) ≥ ngưỡng — dù mỗi ô riêng lẻ chưa tới. */
  | { ma: "TU_NGUONG_YEU_CAU"; absTotal: number; tongYeuCau: number; nguong: number }
  /** Có cảnh báo gian lận (vd `TU_CLAIM`) ⇒ không bao giờ một người. */
  | { ma: "CANH_BAO_GIAN_LAN"; maCanhBao: readonly string[] };

export type TongGoi = { tongDuong: number; tongAm: number; absTotal: number; net: number };

/** `absTotal = max(Σ dương, Σ |âm|)`: chuyển 5 triệu từ A sang B là 5 triệu, không phải 10 triệu cũng không phải 0. */
export function tongGoi(goi: readonly DongGoi[]): TongGoi {
  let tongDuong = 0;
  let tongAm = 0;
  for (const d of goi) {
    if (d.chenh > 0) tongDuong += d.chenh;
    else tongAm += -d.chenh;
  }
  return { tongDuong, tongAm, absTotal: Math.max(tongDuong, tongAm), net: tongDuong - tongAm };
}

/**
 * Loại dòng sổ do ENGINE ghi khi tính hoa hồng của một ô: tính lần đầu · tính muộn · đảo do hoàn tiền. Điều chỉnh (khiếu nại · đổi nguồn · sửa đầu vào) KHÔNG nằm
 * trong tập này — đó là điểm mấu chốt của cận: điều chỉnh đã ghi không được làm cận lớn thêm.
 */
export const KIND_DONG_DO_ENGINE_GHI = ["ORIGINAL", "LATE_ARRIVAL", "REVERSAL"] as const;

/**
 * CẬN TIỀN HỢP LÝ của một giao dịch = HOA HỒNG GỐC do engine tính cho cả ô (mọi người, mọi vai) = Σ các dòng `KIND_DONG_DO_ENGINE_GHI`; hoàn tiền (REVERSAL, âm) làm cận NHỎ lại.
 * Neo vào số engine tính chứ KHÔNG vào số ròng hiện tại: số ròng tăng sau mỗi lần điều chỉnh, nên cận tính từ nó là cận "đuổi theo" chính khoản vừa điều chỉnh.
 * Đầu vào hỏng (không hữu hạn) ⇒ 0 ⇒ cấp hai. Tổng âm ⇒ 0.
 */
export function canGocCuaO(dong: Iterable<{ entryKind: string; amount: number }>): number {
  let tong = 0;
  for (const d of dong) {
    if (!Number.isFinite(d.amount)) return 0;
    if ((KIND_DONG_DO_ENGINE_GHI as readonly string[]).includes(d.entryKind)) tong += d.amount;
  }
  return Math.max(0, tong);
}

export type KetQuaQuanTri = { quanTri: MucQuanTri; lyDo: readonly LyDoQuanTri[]; tong: TongGoi };

/**
 * @param nguong     ngưỡng đã đọc & kiểm (số nguyên ≥ 0); `null` = thiếu/hỏng ⇒ cấp hai.
 * @param canTren    cận tiền hợp lý = hoa hồng GỐC của giao dịch (`canGocCuaO`): (số đã điều chỉnh trước đó + `absTotal` của gói) không được vượt; `null` = không tính được ⇒ cấp hai.
 * @param tichLuy    Σ `absTotal` các điều chỉnh ĐÃ GHI hoặc ĐANG MỞ trên cùng giao dịch (BẮT BUỘC — luật 7: không mặc định 0). Ngưỡng và cận so với (tichLuy + gói này), nên
 *                   nhiều khiếu nại nhỏ không "leo thang" qua ngưỡng mà không ai nhìn vào. Không đọc được ⇒ cấp hai.
 * @param tongYeuCau TỔNG |tiền| của cả YÊU CẦU LOGIC mà gói này thuộc về (cùng khiếu nại · cùng sự kiện đổi nguồn), ĐÃ GỒM chính gói này (BẮT BUỘC — luật 7). Một sự kiện đổi nguồn chạm nhiều ô
 *                   và mỗi ô một đề xuất: nếu chỉ so từng ô thì 4+4+4 triệu né được ngưỡng 10 triệu. Không đọc được, hoặc NHỎ HƠN chính gói này (vô lý) ⇒ cấp hai. Chỉ NÂNG mức, không bao giờ hạ.
 * @param canhBao    mã cảnh báo gian lận còn hiệu lực (rỗng = không có).
 */
export function quyetQuanTri(i: { goi: readonly DongGoi[]; nguong: number | null; canTren: number | null; tichLuy: number; tongYeuCau: number; canhBao: readonly string[] }): KetQuaQuanTri {
  const tong = tongGoi(i.goi);
  const lyDo: LyDoQuanTri[] = [];
  const tichLuyHopLe = Number.isFinite(i.tichLuy) && i.tichLuy >= 0;
  const tongYeuCauHopLe = Number.isFinite(i.tongYeuCau) && i.tongYeuCau >= tong.absTotal;
  if (!tichLuyHopLe || !tongYeuCauHopLe) lyDo.push({ ma: "TICH_LUY_KHONG_DOC_DUOC" });
  const daTinh = tong.absTotal + (tichLuyHopLe ? i.tichLuy : 0);
  const nguongHopLe = i.nguong !== null && Number.isInteger(i.nguong) && i.nguong >= 0 && i.nguong <= TRAN_INT4;
  if (!nguongHopLe) lyDo.push({ ma: "NGUONG_KHONG_DOC_DUOC" });
  else if (daTinh >= (i.nguong as number)) lyDo.push({ ma: "TU_NGUONG", absTotal: tong.absTotal, tichLuy: tichLuyHopLe ? i.tichLuy : 0, nguong: i.nguong as number });
  // Luật THEO Ô ở trên GIỮ NGUYÊN (không nới); luật THEO YÊU CẦU chỉ thêm một đường lên cấp hai. Ô đã đạt ngưỡng thì mã của ô đứng trước, không báo hai lần cùng một việc.
  else if (tongYeuCauHopLe && i.tongYeuCau >= (i.nguong as number)) lyDo.push({ ma: "TU_NGUONG_YEU_CAU", absTotal: tong.absTotal, tongYeuCau: i.tongYeuCau, nguong: i.nguong as number });

  if (i.canTren === null || !Number.isFinite(i.canTren) || i.canTren < 0) lyDo.push({ ma: "KHONG_TINH_DUOC_CAN" });
  else if (daTinh > i.canTren) lyDo.push({ ma: "VUOT_CAN", canTren: i.canTren, absTotal: tong.absTotal, tichLuy: tichLuyHopLe ? i.tichLuy : 0 });

  if (i.canhBao.length > 0) lyDo.push({ ma: "CANH_BAO_GIAN_LAN", maCanhBao: [...i.canhBao] });
  return { quanTri: lyDo.length > 0 ? "SECOND_APPROVAL_REQUIRED" : "SINGLE_APPROVAL", lyDo, tong };
}

/** Dòng nào đòi lại QUÁ số ròng hiện có của người đó ⇒ từ chối cứng (không phải chuyện quản trị: số tiền không tồn tại để đòi). `null` = hợp lệ. */
export function dongDoiQuaRong(goi: readonly DongGoi[]): DongGoi | null {
  return goi.find((d) => d.chenh < 0 && d.rong + d.chenh < 0) ?? null;
}

// ── Ai được duyệt ────────────────────────────────────────────────────────────────────────────

export type NguonGocDeXuat = "DISPUTE" | "SOURCE_CHANGE";
export type CapDuyet = 1 | 2;

/**
 * KHOÁ QUYỀN của người duyệt, theo NGUỒN GỐC đề xuất — một bảng cho nút VÀ action (luật 12; lưới `[DXD-W4]`). Không đẻ quyền mới:
 * khiếu nại ⇒ `commission_disputes:review` (như nhận/quyết khiếu nại); đổi nguồn ⇒ `commission_periods:manage` (như giải hàng chờ INPUT_DRIFT mà nó thay thế).
 * Cùng một khoá cho cấp 1 và cấp 2: tách NGƯỜI, không tách quyền (đẻ quyền mới = bấm seed-prod-roles, quãng giữa là không ai duyệt nổi).
 */
export const KHOA_DUYET_DE_XUAT: Readonly<Record<NguonGocDeXuat, "commission_disputes:review" | "commission_periods:manage">> = {
  DISPUTE: "commission_disputes:review",
  SOURCE_CHANGE: "commission_periods:manage",
};

export type NguCanhDuyet = {
  nguoiDuyetId: string;
  requestedById: string;
  approver1Id: string | null;
  /** `User.id` của mọi người hưởng có mặt trong gói (người duyệt không được nằm trong đó). */
  nguoiHuongTrongGoi: ReadonlySet<string>;
  cap: CapDuyet;
  quanTri: MucQuanTri;
  /** Trạng thái hiện tại của đề xuất. */
  trangThai: "PENDING" | "APPROVED_L1" | "POSTED" | "REJECTED" | "STALE";
};

/**
 * Lý do KHÔNG được duyệt ở cấp `cap` (câu tiếng Việt cho giao diện), hoặc `null` nếu được. Thứ tự: trạng thái → tách nhiệm. Quyền chức năng
 * (`KHOA_DUYET_DE_XUAT`) hỏi riêng ở tầng gọi — hàm này chỉ trả lời câu hỏi về NGƯỜI × ĐỀ XUẤT.
 */
export function lyDoKhongDuocDuyet(c: NguCanhDuyet): string | null {
  if (c.trangThai === "POSTED" || c.trangThai === "REJECTED" || c.trangThai === "STALE") return "Đề xuất này đã kết thúc.";
  if (c.cap === 1 && c.trangThai !== "PENDING") return "Đề xuất đã qua cấp 1.";
  if (c.cap === 2) {
    if (c.quanTri !== "SECOND_APPROVAL_REQUIRED") return "Đề xuất này chỉ cần một người duyệt.";
    if (c.trangThai !== "APPROVED_L1") return "Chưa qua cấp 1 — người duyệt cấp 1 phải duyệt trước.";
  }
  if (c.nguoiDuyetId === c.requestedById) return "Bạn là người đề xuất/khiếu nại nên không được duyệt chính đề xuất này.";
  if (c.cap === 2 && c.nguoiDuyetId === c.approver1Id) return "Bạn đã duyệt cấp 1 — cấp 2 phải là một người khác.";
  if (c.nguoiHuongTrongGoi.has(c.nguoiDuyetId)) return "Bạn là người hưởng của một dòng trong gói điều chỉnh này nên không được duyệt.";
  return null;
}
