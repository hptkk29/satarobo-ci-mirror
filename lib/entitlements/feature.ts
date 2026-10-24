// lib/entitlements/feature.ts — NƠI DUY NHẤT ĐỌC công tắc "Thu học phí theo phạm vi học".
//
// Cùng khuôn `lib/bao-luu/feature.ts`: cờ nằm trong DB để người vận hành bật được và `AuditLog` ghi
// ai bật lúc nào; đọc ở MỘT hàm để "tắt" tắt được MỌI chỗ chứ không 9 trong 10.
//
// ⚠️ `orgUnitId`, KHÔNG `centerId`: `CenterSetting` khoá theo `OrgUnit.id`. Truyền `Center.id` thì tra
// không ra dòng nào và hàm âm thầm rơi về giá trị toàn hệ — cờ riêng của cơ sở không có tác dụng mà
// không lỗi nào báo.
//
// 🔴 MẶC ĐỊNH TẮT (tờ trình chưa ký, Pha 0 chưa đo prod). Caller đầu tiên: `lib/orders/pham-vi/ap-dung.ts` (đường tạo đơn thủ công,
// 11/10/2026, xem docs/thu-hoc-phi-pham-vi/NOI-TAO-DON.md); `lib/entitlements/cap-tu-don.ts` (cấp quyền học khi tiền xác nhận về, 11/10/2026, xem CAP-QUYEN-TU-TIEN.md); các đường khác CHƯA nối. Người thêm caller kế tiếp phải tự hỏi: đường cũ (kế hoạch nhiều đợt, `OrderInstallment`)
// còn nguyên khi cờ tắt không? Tắt ⇒ nút ẨN **và** server action TỪ CHỐI (luật 8) — hai nửa cùng hỏi
// `chanNeuPhamViTat`.
import "server-only";
import { getSetting } from "@/lib/settings/service";
import type { QuyTacBuoiLe, CheDoMocNgay } from "@/lib/pricing/tinh-gia-theo-moc";
import type { CauHinhPhamVi } from "./pham-vi-hoc";
import { caiDatPhamViRoRang, cauHinhPhamViTuCaiDat, quyTacBuoiLeTuCaiDat, thuTuConTuCaiDat, type ThuTuConMacDinh } from "./cai-dat";

export const KHOA_CONG_TAC_PHAM_VI = "billing.scopePurchaseEnabled" as const;

export async function laThuHocPhiTheoPhamViBat(orgUnitId?: string | null): Promise<boolean> {
  // `=== true`, KHÔNG trả thẳng giá trị đọc được [11/10/2026]: một bộ mock `getSetting` trả `50` cho mọi khoá lạ
  // (`order-create-audit.test.ts`) từng biến "truthy" thành CỜ BẬT và đưa test vào nhánh mới. Cờ này gác tiền —
  // chỉ đúng `true` mới là bật; mọi giá trị khác (số, chuỗi "false", null) là TẮT.
  return (await getSetting(KHOA_CONG_TAC_PHAM_VI, { orgUnitId: orgUnitId ?? null })) === true;
}

/** Câu từ chối thống nhất khi công tắc tắt. */
export const LOI_PHAM_VI_TAT = "Thu học phí theo phạm vi học chưa được bật cho cơ sở này.";

/** `null` = được phép; chuỗi = lý do từ chối. Dùng đầu mọi server action MỚI của mô hình này. */
export async function chanNeuPhamViTat(orgUnitId?: string | null): Promise<string | null> {
  return (await laThuHocPhiTheoPhamViBat(orgUnitId)) ? null : LOI_PHAM_VI_TAT;
}

export async function docCauHinhPhamVi(orgUnitId?: string | null): Promise<CauHinhPhamVi> {
  return (await docCauHinhPhamViKemRoRang(orgUnitId)).cauHinh;
}

/** Như `docCauHinhPhamVi`, kèm `roRang` = cấu hình trần có rõ ràng không (xem `caiDatPhamViRoRang`). Một lần đọc, cùng một bộ giá trị. */
export async function docCauHinhPhamViKemRoRang(orgUnitId?: string | null): Promise<{ cauHinh: CauHinhPhamVi; roRang: boolean }> {
  const o = { orgUnitId: orgUnitId ?? null };
  const [lateEntryMaxLessons, catchUpMaxSessions, catchUpOverCapPolicy, graceCountsTowardNextPurchase] =
    await Promise.all([
      getSetting("enrollment.lateEntryMaxLessons", o),
      getSetting("enrollment.catchUpMaxSessions", o),
      getSetting("enrollment.catchUpOverCapPolicy", o),
      getSetting("enrollment.graceCountsTowardNextPurchase", o),
    ]);
  const giaTri = { lateEntryMaxLessons, catchUpMaxSessions, catchUpOverCapPolicy, graceCountsTowardNextPurchase };
  return { cauHinh: cauHinhPhamViTuCaiDat(giaTri), roRang: caiDatPhamViRoRang(giaTri) };
}

export async function docQuyTacBuoiLe(orgUnitId?: string | null): Promise<QuyTacBuoiLe> {
  return quyTacBuoiLeTuCaiDat(await getSetting("pricing.oddSessionsRule", { orgUnitId: orgUnitId ?? null }));
}

/** Thứ tự CON mặc định khi mua cùng lúc (S15). Giá trị lạ rơi về "thấp trước". */
export async function docThuTuConMacDinh(): Promise<ThuTuConMacDinh> {
  return thuTuConTuCaiDat(await getSetting("pricing.sameTimeChildOrder"));
}

export async function docCheDoMocNgay(): Promise<CheDoMocNgay> {
  // Giá trị lạ (không thể có nếu schema chặn đúng) rơi về mặc định đã khai ở registry.
  return (await getSetting("pricing.policyDateBasis")) === "PAYMENT_RECEIVED" ? "PAYMENT_RECEIVED" : "ORDER_CREATED";
}

/** Số bài tối đa một buổi học vượt (`enrollment.catchUpMaxLessonsPerSession`, mặc định 3). Chỉ quyết cách CHIA bài thành buổi, không quyết bài nào phải bù. */
export async function docBaiMoiBuoiHocVuot(orgUnitId?: string | null): Promise<number> {
  const v = await getSetting("enrollment.catchUpMaxLessonsPerSession", { orgUnitId: orgUnitId ?? null });
  return typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : 3;
}
