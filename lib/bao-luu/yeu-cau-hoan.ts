import "server-only";
import { db } from "@/lib/db";
import { publishEvent } from "@/lib/events/publish";
import { KHOAN_DA_DONG } from "@/lib/finance/debt";
import { dongDonDaQuyetToan, loiDaQuyetToan, taoYeuCauHoanTuDungHoc, RefundError } from "@/lib/finance/refund";
import { laBaoLuuBat, LOI_BAO_LUU_TAT } from "@/lib/bao-luu/feature";
import { tienHoanTuCap } from "@/lib/bao-luu/anh-chup";
import { chuyenTrangThai, dongGhiDanhKhiChamDut } from "@/lib/bao-luu/chuyen-trang-thai";
import { dich, LoiNhieu, type KetQua, type NguoiLam } from "@/lib/bao-luu/dich-vu";

// lib/bao-luu/yeu-cau-hoan.ts — SINH YÊU CẦU HOÀN cho hồ sơ loại CENTER (BR-23). PHIÊN 6.
//
// Khi Trung tâm tạm dừng lớp mà quá ngày dự kiến mở lại, quản lý chọn một trong ba: chờ tiếp · chuyển khoá · sinh yêu cầu hoàn. Hàm này là nhánh thứ ba.
//
// ⚠️ CHỈ loại CENTER. Chấm dứt của PARENT/LEGACY "KHÔNG sinh yêu cầu hoàn" (BR-20) — phụ huynh tự dừng thì tiền xử theo quy chế riêng, không phải ở đây.
// ⚠️ SỐ TIỀN tính từ CẶP chưa chia của ảnh chụp (`tienHoanTuCap`), KHÔNG từ `snapUnitPrice` đã làm tròn: 28 × 250.000 = 7.000.000 (TC-17), và với học phí không
//    chia hết cách tính từ cặp không mất tới `còn × 999`đ. Thiếu một trong ba số của ảnh chụp ⇒ TỪ CHỐI (không đoán, không 0): người dùng nhập tay ở `/hoan-tien`.
// ⚠️ KHÔNG hoàn quá số đã thu (`Σ Payment CONFIRMED`): đề xuất bị kẹp về số đã thu và lý do ghi rõ. Chưa thu đồng nào ⇒ không có gì để hoàn.
// ⚠️ KHÔNG chi tiền. Chỉ ĐẶT một yêu cầu PENDING qua `taoYeuCauHoanTuDungHoc` (hàm CÓ SẴN của luồng dừng học, đã có cổng chống đặt hai yêu cầu cho một dòng đơn); kế toán duyệt
//    và chi theo luồng cũ.
// Sau khi đặt yêu cầu, hồ sơ ENDED (endKind REFUNDED) và ghi danh đóng — bé không quay lại lớp nữa; khôi phục không áp dụng (đó là đường của chấm dứt).

const TX = { timeout: 30_000, maxWait: 10_000 } as const;

export async function sinhYeuCauHoan(
  input: { reserveId: string; lyDo: string },
  nguoi: NguoiLam,
  now: Date,
): Promise<KetQua<{ reserveId: string; refundRequestId: string; soTien: number; biKepVeSoDaThu: boolean }>> {
  const lyDo = input.lyDo.trim();
  if (lyDo.length < 5) return { ok: false, loi: ["Ghi lý do (ít nhất 5 ký tự)."] };
  try {
    return await db.$transaction(async (tx) => {
      const hs = await tx.studentReserve.findUnique({
        where: { id: input.reserveId },
        select: {
          id: true, status: true, type: true, studentId: true, enrollmentId: true, centerId: true, orgUnitId: true,
          snapTuitionNet: true, snapSoBuoiMua: true, snapSessionsRemaining: true, snapUnitPrice: true, snapSoBuoiSuyRa: true,
        },
      });
      if (!hs) throw new LoiNhieu(["Không tìm thấy hồ sơ bảo lưu."]);
      if (!(await laBaoLuuBat(hs.orgUnitId))) throw new LoiNhieu([LOI_BAO_LUU_TAT]);
      if (hs.type !== "CENTER") throw new LoiNhieu(["Chỉ hồ sơ do Trung tâm tạm dừng mới sinh yêu cầu hoàn. Chấm dứt bảo lưu của phụ huynh không hoàn tiền."]);
      if (hs.status !== "ACTIVE" && hs.status !== "RESUME_PENDING") throw new LoiNhieu(["Hồ sơ không còn ở trạng thái đang tạm dừng."]);
      if (!hs.enrollmentId) throw new LoiNhieu(["Hồ sơ không gắn ghi danh."]);

      const soTienDeXuat = tienHoanTuCap(hs);
      if (soTienDeXuat === null) {
        throw new LoiNhieu(["Ảnh chụp quyền lợi thiếu học phí hoặc số buổi — không tính được số hoàn. Lập yêu cầu hoàn tay ở màn Hoàn tiền."]);
      }
      if (soTienDeXuat <= 0) throw new LoiNhieu(["Học viên đã dùng hết số buổi đã mua — không có gì để hoàn."]);

      const dong = await tx.orderItem.findFirst({
        where: { enrollmentId: hs.enrollmentId, status: { not: "STOPPED" } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (!dong) throw new LoiNhieu(["Ghi danh chưa gắn dòng đơn nào — không đặt yêu cầu hoàn được. Lập tay ở màn Hoàn tiền."]);
      const daQuyetToan = await dongDonDaQuyetToan(tx, hs.enrollmentId);
      if (daQuyetToan) throw new LoiNhieu([loiDaQuyetToan(daQuyetToan).message]);

      const agg = await tx.payment.aggregate({ where: { enrollmentId: hs.enrollmentId, ...KHOAN_DA_DONG }, _sum: { amount: true } });
      const daThu = agg._sum.amount ?? 0;
      if (daThu <= 0) throw new LoiNhieu(["Chưa thu đồng nào — không có gì để hoàn."]);
      const soTien = Math.min(soTienDeXuat, daThu);
      const biKep = soTien < soTienDeXuat;

      const yc = await taoYeuCauHoanTuDungHoc({
        tx, orderItemId: dong.id, enrollmentId: hs.enrollmentId, centerId: hs.centerId, trigger: "MANUAL", soTien,
        reason: `Trung tâm tạm dừng lớp, hoàn theo số buổi chưa học: ${lyDo}${biKep ? " (đề xuất bị kẹp về số đã thu)" : ""}`,
        paidConfirmed: daThu, soBuoiCamKet: hs.snapSoBuoiMua ?? 0,
        soBuoiDaDung: Math.max(0, (hs.snapSoBuoiMua ?? 0) - (hs.snapSessionsRemaining ?? 0)),
        donGiaBuoi: hs.snapUnitPrice ?? 0, requestedById: nguoi.id, actorName: nguoi.name,
      });

      // Bé không quay lại lớp: đóng ghi danh rồi đóng hồ sơ.
      const dongGd = await dongGhiDanhKhiChamDut(tx, {
        hoSo: { id: hs.id, studentId: hs.studentId, enrollmentId: hs.enrollmentId, centerId: hs.centerId, orgUnitId: hs.orgUnitId },
        actor: nguoi, now, lyDo: `Hoàn tiền do Trung tâm tạm dừng lớp: ${lyDo}`,
      });
      // ACTIVE | RESUME_PENDING → ENDED trực tiếp (kind TERMINATE: hồ sơ KẾT THÚC vì hoàn tiền, không phải phục học).
      await chuyenTrangThai(tx, {
        reserveId: hs.id, den: "ENDED", actor: nguoi, now, kind: "TERMINATE", note: lyDo,
        patch: { endKind: "REFUNDED", endReason: lyDo },
        sauThem: { refundRequestId: yc.id, soTien, biKep, snapSoBuoiSuyRa: hs.snapSoBuoiSuyRa, studentTruoc: dongGd.studentTruoc },
      });
      await publishEvent(
        "bao-luu.yeu-cau-hoan",
        { reserveId: hs.id, refundRequestId: yc.id, enrollmentId: hs.enrollmentId, centerId: hs.centerId, soTien },
        { tx, dedupeKey: `bao-luu.yeu-cau-hoan:${hs.id}` },
      );
      return { ok: true as const, data: { reserveId: hs.id, refundRequestId: yc.id, soTien, biKepVeSoDaThu: biKep } };
    }, TX);
  } catch (err) {
    if (err instanceof RefundError) return { ok: false, loi: [err.message] };
    return dich(err);
  }
}
