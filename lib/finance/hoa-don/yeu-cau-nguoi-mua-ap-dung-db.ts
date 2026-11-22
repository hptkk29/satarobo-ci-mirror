import "server-only";
import type { Actor } from "@/lib/auth/actor";
import { writeAudit } from "@/lib/audit/audit-log";
import { db } from "@/lib/db";
import { anhXaNguoiMuaSangDon, cotDonDaDoi } from "./yeu-cau-nguoi-mua-ap-dung";
import { TuChoi, sangLoi, xacNhanYeuCauTrongTx, type Loi } from "./yeu-cau-nguoi-mua-db";

// lib/finance/hoa-don/yeu-cau-nguoi-mua-ap-dung-db.ts — ÁP DỤNG thông tin người mua ĐÃ ĐỦ vào đơn (Invoice Hub S11). Người chạy DB.
//
// Xác nhận yêu cầu (DANG_MO → DA_AP_DUNG) và ghi `Order.invoice*` / địa chỉ là MỘT giao dịch: sập giữa chừng không để lại «yêu cầu đã áp dụng mà đơn chưa đổi» (không xác nhận lại được).
//  · Từ chối = NÉM `TuChoi` ⇒ rollback CẢ xác nhận. Đường này không có chỗ nào `return` từ chối sau một phép ghi.
//  · Đơn bị sửa SAU khi yêu cầu được tạo (so băm từng cột `invoice*` đã lưu lúc tạo): mặc định TỪ CHỐI và nói tên cột; chỉ ghi đè khi người gọi nói rõ `GHI_DE` (tham số BẮT BUỘC, luật 7).
//  · Hoá đơn đang `DANG_PHAT_HANH` ⇒ từ chối (đổi người mua giữa lúc nhà cung cấp đang phát hành là tạo bản lệch). Hoá đơn NHAP / DA_XAC_NHAN: cho áp dụng nhưng TRẢ KÈM danh sách để màn nói
//    «chỉ áp cho hoá đơn tạo sau» — hoá đơn đã phát hành KHÔNG bị sửa (không chạm `HoaDonDienTu` / `Payment`).
//  · Audit trên đơn chỉ nêu TÊN cột đã đổi — không giá trị (tên, email, MST, địa chỉ là PII).
//  · `tx` không scope: quyền + phạm vi cơ sở được kiểm bởi `xacNhanYeuCauTrongTx`; đơn đọc/ghi thêm `centerId` của chính yêu cầu.

export type KetQuaApDung =
  | { ok: true; orderId: string; cotDaDoi: string[]; hoaDonConHieuLuc: { id: string; trangThai: string; so: string | null }[] }
  | Loi;

export async function apDungYeuCauVaoDon(input: {
  actor: Actor;
  nguoi: { id: string; name: string };
  id: string;
  /** BẮT BUỘC: đơn bị sửa sau khi tạo yêu cầu thì từ chối hay ghi đè. */
  khiDonDaDoi: "TU_CHOI" | "GHI_DE";
  now: Date;
}): Promise<KetQuaApDung> {
  try {
    return await db.$transaction(async (tx) => {
      const xn = await xacNhanYeuCauTrongTx(tx, { actor: input.actor, nguoi: input.nguoi, id: input.id, now: input.now });
      const yc = await tx.hoaDonYeuCauNguoiMua.findUniqueOrThrow({ where: { id: xn.id }, select: { giaTriGocHash: true } });
      const don = await tx.order.findFirst({
        where: { id: xn.orderId, centerId: xn.centerId },
        select: {
          id: true,
          centerId: true,
          updatedAt: true,
          invoiceBuyerName: true,
          invoiceCompanyName: true,
          invoiceTaxCode: true,
          invoiceEmail: true,
          customerAddress: true,
          customerWard: true,
          customerCity: true,
          customerCccd: true,
          invoiceParentPhone: true,
          invoiceStudentName: true,
          invoiceStudentDob: true,
          invoiceStudentCccd: true,
          hoaDonDienTu: { where: { trangThai: { in: ["NHAP", "DANG_PHAT_HANH", "DA_XAC_NHAN"] } }, select: { id: true, trangThai: true, kyHieu: true, soHoaDon: true } },
        },
      });
      if (!don) throw new TuChoi("KHONG_CO_QUYEN", "Không tìm thấy đơn của yêu cầu này.");
      if (don.hoaDonDienTu.some((h) => h.trangThai === "DANG_PHAT_HANH")) {
        throw new TuChoi("HOA_DON_DANG_PHAT_HANH", "Đơn đang có hoá đơn trong quá trình phát hành — đợi phát hành xong (hoặc xử lý lỗi) rồi áp dụng thông tin người mua.");
      }
      const ghi = anhXaNguoiMuaSangDon(xn.nguoiMua);
      const daDoi = cotDonDaDoi(xn.id, yc.giaTriGocHash, don, ghi);
      if (daDoi.length > 0 && input.khiDonDaDoi === "TU_CHOI") {
        throw new TuChoi("DON_DA_DOI", `Thông tin hoá đơn của đơn đã được sửa sau khi tạo yêu cầu (${daDoi.join(", ")}). Xem lại rồi chọn ghi đè nếu đúng ý.`);
      }
      const upd = await tx.order.updateMany({ where: { id: don.id, centerId: don.centerId, updatedAt: don.updatedAt }, data: ghi });
      if (upd.count !== 1) throw new TuChoi("DON_DA_DOI", "Đơn vừa được người khác sửa — mở lại màn đơn rồi thử lại.");
      // Ngày (`invoiceStudentDob`) so theo GIÁ TRỊ thời gian, không theo tham chiếu — so tham chiếu làm cột này luôn bị ghi vào vết «đã đổi».
      const giaTri = (v: unknown): unknown => (v instanceof Date ? v.getTime() : (v ?? null));
      const cotDoi = (Object.keys(ghi) as (keyof typeof ghi)[]).filter((c) => giaTri(don[c]) !== giaTri(ghi[c]));
      await writeAudit({
        tx,
        actor: input.nguoi,
        module: "orders",
        entityType: "Order",
        entityId: don.id,
        action: "AP_DUNG_YEU_CAU_NGUOI_MUA",
        oldValues: { yeuCauId: xn.id },
        newValues: { yeuCauId: xn.id, nguonTheoO: xn.nguonTheoO, ghiDe: daDoi.length > 0 },
        changedFields: cotDoi,
        orgUnitId: don.centerId,
      });
      return {
        ok: true as const,
        orderId: don.id,
        cotDaDoi: cotDoi,
        hoaDonConHieuLuc: don.hoaDonDienTu.map((h) => ({ id: h.id, trangThai: h.trangThai, so: [h.kyHieu, h.soHoaDon].filter(Boolean).join("-") || null })),
      };
    });
  } catch (e) {
    if (e instanceof TuChoi) return sangLoi(e);
    throw e;
  }
}
