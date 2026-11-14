// lib/hoa-hong/de-xuat-dieu-chinh.ts — TẦNG DỮ LIỆU của ĐỀ XUẤT ĐIỀU CHỈNH (`CommissionAdjustmentRequest`): quyết quản trị trong transaction + lưu đề xuất.
//
// Nguồn: docs/source-commission/08 §16. Hàm THUẦN quyết "một hay hai người": `quan-tri-dieu-chinh.ts`. Tệp này CHỈ nối hàm thuần với DB.
//
// ── Luật bất di bất dịch ────────────────────────────────────────────────────────────────────────
//   1. Ngưỡng đọc THẲNG từ `SystemSetting` TRONG transaction rồi CHỤP (`thresholdSnapshot`) — sửa setting sau đó không đổi cách duyệt đề xuất đã lập.
//   2. Cận tiền chụp luôn (`boundSnapshot`): `null` = không tính được ⇒ cấp hai (fail-closed). Cận = hoa hồng GỐC do engine tính (không phải số ròng đã bị điều chỉnh).
//   2b. TÍCH LUỸ: ngưỡng và cận so với (số đã điều chỉnh trước đó trên cùng ô + gói này) — `docNenQuanTri` là chỗ DUY NHẤT đọc các số nền ấy.
//   2c. YÊU CẦU LOGIC (08 §17.v4.Q): ngưỡng còn so với TỔNG của cả yêu cầu — cùng khiếu nại (`disputeId`) hoặc cùng sự kiện đổi nguồn (`refEventId`) — qua mọi ô nó chạm. KHÔNG ôm cả đời học viên.
//   3. Sổ APPEND-ONLY: tệp này không bao giờ ghi/sửa `CommissionTransaction`. Dòng điều chỉnh do chỗ gọi ghi qua `ghiDong` (`ghi-so.ts`).
//   4. `scopedDb` không che WRITE: `luuDeXuat` bắt buộc `centerId` + `orgUnitId` (luật 7: không mặc định).
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";

import { docNguongDuyetHaiCap, type NguongDuyet } from "./quan-tri-nguong";
import { KIND_DONG_DO_ENGINE_GHI, canGocCuaO, quyetQuanTri, tongGoi, type KetQuaQuanTri, type LyDoQuanTri, type MucQuanTri } from "./quan-tri-dieu-chinh";

type Khach = PrismaClient | Prisma.TransactionClient;

export type NguonGocDeXuat = "DISPUTE" | "SOURCE_CHANGE";

/**
 * MỘT dòng của gói, đóng băng lúc lập. `mauDongId` + `roleCode` chỉ có ở gói KHIẾU NẠI (cần để dựng lại dòng điều chỉnh y như người duyệt cấp 1 đã thấy);
 * gói ĐỔI NGUỒN dựng lại từ chính engine lúc duyệt và đối chiếu với các số này.
 */
export const dongGoiSchema = z
  .object({
    key: z.string().min(1),
    chenh: z.number().int().refine((v) => v !== 0, "chênh phải khác 0"),
    kyVong: z.number().int(),
    rong: z.number().int(),
    mauDongId: z.string().min(1).nullable().optional(),
    roleCode: z.string().min(1).nullable().optional(),
  })
  .strict();
export const goiSchema = z.array(dongGoiSchema).min(1);
export type GoiDong = z.infer<typeof dongGoiSchema>;

export function docGoi(raw: unknown): GoiDong[] {
  return goiSchema.parse(raw);
}

/**
 * KHOÁ của một YÊU CẦU LOGIC — thứ phân biệt "một việc chia nhỏ" với "nhiều việc khác nhau". Đã có sẵn trong lược đồ nên không cần cột mới:
 *   · khiếu nại tiền ⇒ `disputeId`; · đổi nguồn sau thu ⇒ `refEventId` (`DomainEvent.id`, hoặc `audit:<id>` ở đường backfill). Cùng sự kiện × ô chỉ đẻ MỘT đề xuất (chỉ mục `…_su_kien_key`).
 * Phạm vi cố ý HẸP: ba sự kiện đổi nguồn KHÁC nhau là ba yêu cầu khác nhau (mỗi cái có đường duyệt riêng), không gom theo lead hay học viên.
 */
export type KhoaYeuCau = { origin: "DISPUTE"; disputeId: string } | { origin: "SOURCE_CHANGE"; refEventId: string };

/**
 * @param khoa      khoá yêu cầu logic của gói đang xét.
 * @param duBaoTong DỰ BÁO tổng |tiền| của cả yêu cầu, gồm gói này và các gói CHƯA lập (BẮT BUỘC — luật 7). Một sự kiện đổi nguồn lập đề xuất từng ô, mỗi ô một giao dịch; cái lập
 *                  ĐẦU TIÊN không thấy cái sau nên phải được báo trước. Khiếu nại chỉ có một gói ⇒ 0. Con số này chỉ được NÂNG mức duyệt (max với tổng đo được), không bao giờ hạ.
 */
export type YeuCauLogic = { khoa: KhoaYeuCau; duBaoTong: number };

export type QuyetDinhQuanTri = KetQuaQuanTri & {
  /** Ngưỡng đã đọc (chụp vào `thresholdSnapshot`); `nguong.nguong === null` ⇒ hỏng. */
  nguong: NguongDuyet;
  /** Cận đã dùng (chụp vào `boundSnapshot`) = hoa hồng GỐC engine tính cho ô; `null` = không tính được. */
  canTren: number | null;
  /** Σ `absTotal` các điều chỉnh đã ghi / đang mở trên cùng ô lúc lập (chụp vào `governanceWhy`). */
  tichLuy: number;
  /** Tổng |tiền| của cả YÊU CẦU LOGIC lúc lập, gồm gói này (chụp vào `governanceWhy`). */
  tongYeuCau: number;
};

/** Trạng thái đề xuất còn TÍNH vào số đã điều chỉnh của một ô: đã ghi (POSTED) và đang mở (chưa ghi nhưng sẽ ghi). REJECTED / STALE không bao giờ ghi nên không tính. */
export const TRANG_THAI_TINH_TICH_LUY = ["POSTED", "PENDING", "APPROVED_L1"] as const;

/**
 * BA SỐ NỀN của quyết quản trị cho một ô, đọc TRONG `tx` — chỗ DUY NHẤT (mọi đường lập đề xuất đi qua `quyetDinhQuanTriTrongTx`, không ai tự đọc):
 *   · `tichLuyAnhEm` — Σ `absTotal` đề xuất POSTED/PENDING/APPROVED_L1 của cùng YÊU CẦU LOGIC (`KhoaYeuCau`) ở MỌI ô; không phụ thuộc `calcSlotId`.
 *   · `canGoc`  — hoa hồng GỐC engine tính (Σ ORIGINAL + LATE_ARRIVAL + REVERSAL của ô); `null` khi khoản không có ô (⇒ cấp hai). Không đếm điều chỉnh.
 *   · `tichLuy` — Σ `absTotal` đề xuất POSTED/PENDING/APPROVED_L1 của ô, mọi nguồn gốc (khiếu nại lẫn đổi nguồn). Dùng `absTotal` chứ không phải số trên sổ để một lần CHUYỂN x
 *                 tính là x, không phải 2x; +600k rồi −600k tính là 1,2 triệu (không bù nhau).
 * Gọi SAU `khoaO` của ô: hai khiếu nại nhỏ đồng thời trên cùng ô xếp hàng qua khoá ấy nên cái sau thấy cái trước.
 */
export async function docNenQuanTri(tx: Khach, calcSlotId: string | null, khoa: KhoaYeuCau): Promise<{ canGoc: number | null; tichLuy: number; tichLuyAnhEm: number }> {
  // Các đề xuất ANH EM của cùng yêu cầu logic (kể cả ở ô khác) — cùng tập trạng thái với `tichLuy`: đã ghi hoặc đang mở, không đếm REJECTED / STALE.
  const anhEm = tx.commissionAdjustmentRequest.aggregate({
    where: { status: { in: [...TRANG_THAI_TINH_TICH_LUY] }, ...(khoa.origin === "DISPUTE" ? { origin: "DISPUTE", disputeId: khoa.disputeId } : { origin: "SOURCE_CHANGE", refEventId: khoa.refEventId }) },
    _sum: { absTotal: true },
  });
  if (!calcSlotId) return { canGoc: null, tichLuy: 0, tichLuyAnhEm: (await anhEm)._sum.absTotal ?? 0 };
  const [dong, dx, ae] = await Promise.all([
    tx.commissionTransaction.findMany({ where: { calcSlotId, entryKind: { in: [...KIND_DONG_DO_ENGINE_GHI] } }, select: { entryKind: true, amount: true } }),
    tx.commissionAdjustmentRequest.aggregate({ where: { calcSlotId, status: { in: [...TRANG_THAI_TINH_TICH_LUY] } }, _sum: { absTotal: true } }),
    anhEm,
  ]);
  return { canGoc: canGocCuaO(dong), tichLuy: dx._sum.absTotal ?? 0, tichLuyAnhEm: ae._sum.absTotal ?? 0 };
}

/**
 * Quyết quản trị cho MỘT gói, đọc ngưỡng + hai số nền (`docNenQuanTri`) TRONG `tx`. Gọi SAU khi đã giữ khoá ô/khoản.
 * `calcSlotId` BẮT BUỘC khai (luật 7): `null` = khoản không có ô ⇒ không có cận ⇒ cấp hai.
 */
export async function quyetDinhQuanTriTrongTx(
  tx: Khach,
  i: { goi: readonly GoiDong[]; calcSlotId: string | null; yeuCau: YeuCauLogic; canhBao: readonly string[] },
): Promise<QuyetDinhQuanTri> {
  const [nguong, nen] = await Promise.all([docNguongDuyetHaiCap(tx), docNenQuanTri(tx, i.calcSlotId, i.yeuCau.khoa)]);
  // Tổng của cả yêu cầu = max(DỰ BÁO, các gói anh em ĐÃ CÓ + gói này). Dự báo phủ lượt lập đầu (các ô chưa có đề xuất); tổng đo được phủ lượt chạy lại sau khi một số ô đã được
  // duyệt. Lấy MAX nên đếm dư chỉ đẩy về phía cấp hai (an toàn); không đường nào làm tổng nhỏ đi.
  const absGoi = tongGoi(i.goi).absTotal;
  const tongYeuCau = Math.max(i.yeuCau.duBaoTong, nen.tichLuyAnhEm + absGoi);
  const r = quyetQuanTri({ goi: i.goi, nguong: nguong.nguong, canTren: nen.canGoc, tichLuy: nen.tichLuy, tongYeuCau, canhBao: i.canhBao });
  return { ...r, nguong, canTren: nen.canGoc, tichLuy: nen.tichLuy, tongYeuCau };
}

export type DauAn = { userId: string; at: Date; lyDo: string };

export type TrangThaiKhoiTao =
  /** Đề xuất do hệ thống lập (đổi nguồn sau thu): chờ người duyệt cấp 1. */
  | { loai: "CHO_DUYET" }
  /** Khiếu nại tiền cần cấp hai: người xử lý (cấp 1) đã quyết, chờ cấp 2. */
  | { loai: "DA_QUA_CAP_1"; approver1: DauAn }
  /** Đã ghi sổ ngay lúc lập (khiếu nại tiền dưới ngưỡng — một người duyệt): đi cùng một đường kiểm toán. */
  | { loai: "DA_GHI"; approver1: DauAn; postedEntryIds: readonly string[]; postingPeriodId: string };

export type LuuDeXuat = {
  origin: NguonGocDeXuat;
  disputeId: string | null;
  leadId: string | null;
  paymentId: string;
  calcSlotId: string | null;
  refEventType: string;
  refEventId: string;
  goi: readonly GoiDong[];
  qd: QuyetDinhQuanTri;
  canhBao: readonly string[];
  requestedById: string;
  /** BẮT BUỘC (luật 7): `scopedDb` không che ghi. */
  centerId: string;
  orgUnitId: string;
  holdId: string | null;
  trangThai: TrangThaiKhoiTao;
};

/** Mô tả vì sao ra mức quản trị này — lưu `governanceWhy` để màn hình đọc lại mà không tính lại. */
export function moTaQuanTri(qd: QuyetDinhQuanTri): Prisma.InputJsonValue {
  return {
    lyDo: qd.lyDo as unknown as Prisma.InputJsonValue,
    absTotal: qd.tong.absTotal,
    tichLuy: qd.tichLuy,
    tongYeuCau: qd.tongYeuCau,
    net: qd.tong.net,
    nguong: qd.nguong.nguong,
    nguonNguong: qd.nguong.nguon,
    canTren: qd.canTren,
  };
}

export async function luuDeXuat(tx: Khach, i: LuuDeXuat): Promise<{ id: string }> {
  const t = tongGoi(i.goi);
  if (t.absTotal !== i.qd.tong.absTotal) throw new Error("Gói và quyết định quản trị lệch nhau (lỗi lập trình).");
  const chung: Prisma.CommissionAdjustmentRequestUncheckedCreateInput = {
    origin: i.origin,
    disputeId: i.disputeId,
    leadId: i.leadId,
    paymentId: i.paymentId,
    calcSlotId: i.calcSlotId,
    refEventType: i.refEventType,
    refEventId: i.refEventId,
    goi: i.goi as unknown as Prisma.InputJsonValue,
    absTotal: t.absTotal,
    netTotal: t.net,
    governance: i.qd.quanTri,
    governanceWhy: moTaQuanTri(i.qd),
    thresholdSnapshot: i.qd.nguong.nguong,
    boundSnapshot: i.qd.canTren,
    canhBao: i.canhBao.length > 0 ? ([...i.canhBao] as unknown as Prisma.InputJsonValue) : undefined,
    requestedById: i.requestedById,
    holdId: i.holdId,
    centerId: i.centerId,
    orgUnitId: i.orgUnitId,
  };
  const a1 = (d: DauAn) => ({ approver1Id: d.userId, approver1At: d.at, approver1Reason: d.lyDo });
  const data: Prisma.CommissionAdjustmentRequestUncheckedCreateInput =
    i.trangThai.loai === "CHO_DUYET"
      ? { ...chung, status: "PENDING" }
      : i.trangThai.loai === "DA_QUA_CAP_1"
        ? { ...chung, status: "APPROVED_L1", ...a1(i.trangThai.approver1) }
        : { ...chung, status: "POSTED", ...a1(i.trangThai.approver1), postedEntryIds: [...i.trangThai.postedEntryIds], postingPeriodId: i.trangThai.postingPeriodId };
  const r = await tx.commissionAdjustmentRequest.create({ data, select: { id: true } });
  return r;
}

/** Số cấp duyệt mà mức quản trị đòi. */
export const soCapDuyet = (q: MucQuanTri): 1 | 2 => (q === "SECOND_APPROVAL_REQUIRED" ? 2 : 1);

/** Câu tiếng Việt cho từng lý do quản trị — màn hình và nhật ký dùng chung. */
export function chuLyDoQuanTri(l: LyDoQuanTri, dinhDang: (n: number) => string): string {
  switch (l.ma) {
    case "NGUONG_KHONG_DOC_DUOC":
      return "Ngưỡng duyệt hai cấp đang thiếu hoặc nhập sai nên hệ thống yêu cầu hai người duyệt.";
    case "TU_NGUONG": {
      const truoc = l.tichLuy ?? 0;
      return truoc > 0
        ? `Số điều chỉnh lần này ${dinhDang(l.absTotal)} cộng ${dinhDang(truoc)} đã điều chỉnh trước đó trên cùng giao dịch = ${dinhDang(l.absTotal + truoc)}, đạt hoặc vượt ngưỡng ${dinhDang(l.nguong)}.`
        : `Số tiền điều chỉnh ${dinhDang(l.absTotal)} đạt hoặc vượt ngưỡng ${dinhDang(l.nguong)}.`;
    }
    case "TU_NGUONG_YEU_CAU":
      return `Số điều chỉnh của ô này ${dinhDang(l.absTotal)} thuộc một yêu cầu gồm nhiều ô (cùng khiếu nại hoặc cùng lần đổi nguồn) có tổng ${dinhDang(l.tongYeuCau)}, đạt hoặc vượt ngưỡng ${dinhDang(l.nguong)} — nên cần hai người duyệt dù từng ô riêng lẻ chưa tới.`;
    case "VUOT_CAN": {
      const truoc = l.tichLuy ?? 0;
      return truoc > 0
        ? `Số điều chỉnh lần này ${dinhDang(l.absTotal)} cộng ${dinhDang(truoc)} đã điều chỉnh trước đó trên cùng giao dịch = ${dinhDang(l.absTotal + truoc)}, vượt hoa hồng gốc engine đã tính cho giao dịch này (${dinhDang(l.canTren)}).`
        : `Số điều chỉnh ${dinhDang(l.absTotal)} vượt hoa hồng gốc engine đã tính cho giao dịch này (${dinhDang(l.canTren)}).`;
    }
    case "KHONG_TINH_DUOC_CAN":
      return "Không tính được giới hạn hợp lý của giao dịch này (khoản chưa có ô tính) nên cần hai người duyệt.";
    case "TICH_LUY_KHONG_DOC_DUOC":
      return "Không đọc được số đã điều chỉnh trước đó trên giao dịch này nên cần hai người duyệt.";
    case "CANH_BAO_GIAN_LAN":
      return `Có cảnh báo cần soát (${l.maCanhBao.join(", ")}) nên cần hai người duyệt.`;
  }
}
