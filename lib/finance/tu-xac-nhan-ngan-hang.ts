// lib/finance/tu-xac-nhan-ngan-hang.ts — TIỀN ĐÃ VỀ NGÂN HÀNG THÌ HỆ THỐNG TỰ XÁC NHẬN, không chờ kế toán bấm (chủ dự án, 08/11/2026).
//
// ── VÌ SAO CÓ ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Màn /payments «xác nhận» chỉ còn là một nút tick: khoản đến từ webhook SePay / máy POS / giao dịch ngân hàng kế toán đã gắn tay thì tiền đã THẬT sự
// nằm trong tài khoản, không còn gì để duyệt. Trong khi đó hoá đơn tự động (lô 23h `chay-lo-dem.ts`, tự xuất sau n giờ `chay-tu-xuat.ts`) BỎ QUA mọi khoản
// chưa `CONFIRMED` — nên chừng nào còn chờ người bấm, hoá đơn tự động đứng im. Bỏ màn xác nhận mà không có tệp này là làm cả luồng hoá đơn tự động chết.
//
// ── CÁCH LÀM — MỘT BỘ QUÉT, KHÔNG CHÈN VÀO TỪNG CHỖ GHI TIỀN ─────────────────────────────────────────────────────────────────────────────────
// Khoản được TẠO ở nhiều nơi (webhook · POS · gắn tay · tách khoản · gắn ghi danh về sau), mỗi nơi một transaction riêng. Chèn «tự xác nhận» vào từng nơi là
// bốn–năm chỗ phải nhớ, và chỗ thứ sáu sẽ quên. Bộ quét này nhìn KẾT QUẢ: khoản `PENDING` + có bằng chứng ngân hàng + đã đủ điều kiện xác nhận ⇒ xác nhận. Vì nhìn
// kết quả nên nó cũng tự bắt khoản «vừa được gắn ghi danh» ở lượt sau, không cần ai gọi nó. Độ trễ = chu kỳ cron (vài phút) — hoá đơn tự động chạy theo giờ/đêm nên không ảnh hưởng.
//
// ── MỘT ĐỊNH NGHĨA «BẰNG CHỨNG NGÂN HÀNG» ───────────────────────────────────────────────────────────────────────────────────────────────────
// Dùng CHÍNH `WHERE_KHOAN_CHO_CO_BANG_CHUNG_NGAN_HANG` của báo cáo doanh thu (`thuc-thu.ts`) cộng phép thuần `coBangChungNganHang`: «khoản nào được tính doanh thu khi
// chưa xác nhận» và «khoản nào hệ thống tự xác nhận» là một câu hỏi. KHÔNG tự xác nhận: tiền mặt / khoản Sale tự khai, `[ma-gd:…]` (mã do người gõ), khoản nhập lịch sử,
// bút toán đảo, khoản đã bị điều chỉnh / tách / đảo.
//
// ── KHÔNG VIẾT LÕI XÁC NHẬN THỨ HAI ────────────────────────────────────────────────────────────────────────────────────────────────────────
// Xác nhận đi qua `xacNhanKhoanTrongTx` (`payment.ts`) — MỘT chỗ cấp phiếu RCP + MỘT chỗ phát `payment.confirmed` (lưới `truc-a` ghim điều này). Mọi cổng của nó giữ nguyên:
// phải có ghi danh (đơn khoá học), tiền ròng > 0, khoản chưa bị từ chối. Cổng «người ghi ≠ người xác nhận» không vướng vì khoản ngân hàng không có `recordedById`; nếu
// có (`TU_XAC_NHAN`) thì khoản được BỎ QUA chứ không bị ép qua.
//
// ── CÔNG TẮC ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// `payment.tuXacNhanNganHang` — mặc định TẮT, bật được THEO TỪNG CƠ SỞ (`centerOverridable`). Tắt ⇒ bộ quét không xác nhận gì: đúng hành vi cũ.
//
// ⚠️ HỆ QUẢ CẦN BIẾT: sau khi bật, mỗi khoản ngân hàng thành `CONFIRMED` ngay ⇒ công nợ giảm, hoa hồng được tính, phụ huynh nhận thông báo «đã xác nhận» (handler
// `payment.confirmed`), và «Gỡ gắn» giao dịch bị chặn khi khoản đã có phiếu thu. Khớp SAI đơn thì sửa bằng ĐẢO khoản + phiếu thu (việc riêng, PR sau), không bằng Gỡ gắn.
import { db } from "@/lib/db";
import { SYSTEM_USER_ID } from "@/lib/auth/system-actor";
import { getSetting } from "@/lib/settings/service";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { thieuGhiDanh } from "@/lib/finance/can-ghi-danh";
import { LoiXacNhanKhoan, xacNhanKhoanTrongTx } from "@/lib/finance/payment";
import { WHERE_KHOAN_CHO_CO_BANG_CHUNG_NGAN_HANG, coBangChungNganHang } from "@/lib/finance/thuc-thu";

export const KHOA_TU_XAC_NHAN_NGAN_HANG = "payment.tuXacNhanNganHang" as const;

/** Người xác nhận ghi trên khoản + phiếu thu. `system` là id ảo, không có hàng trong `User` (và `Payment.confirmedById` / `Receipt.issuedById` không có khoá ngoại). */
export const NGUOI_XAC_NHAN_TU_DONG = SYSTEM_USER_ID;
const ACTOR: AuditActor = { id: null, name: "Hệ thống (tự xác nhận tiền ngân hàng)" };

/** Số khoản tối đa MỘT lượt chạy xử lý — chặn lượt quá dài; phần còn lại là việc của lượt sau (cũ nhất trước). */
export const TOI_DA_MOT_LUOT = 100;
/** Số ứng viên nạp mỗi lượt (lớn hơn `TOI_DA_MOT_LUOT` để khoản thiếu ghi danh nằm đầu hàng không chặn khoản đủ điều kiện đứng sau). */
const NAP_UNG_VIEN = 500;

export type LyDoBoQuaTuXacNhan = "KHONG_BANG_CHUNG_NGAN_HANG" | "THIEU_GHI_DANH" | "CO_SO_TAT";

export type UngVienTuXacNhan = {
  note: string | null;
  enrollmentId: string | null;
  loaiDon: string | null;
  /** Công tắc `payment.tuXacNhanNganHang` đã phân giải cho CƠ SỞ của khoản. */
  coSoBat: boolean;
};

/** THUẦN — khoản này có nên được tự xác nhận không; `null` = nên. Thứ tự lý do là thứ tự người vận hành nên hỏi: tắt công tắc → không phải tiền ngân hàng → thiếu ghi danh. */
export function lyDoBoQuaTuXacNhan(k: UngVienTuXacNhan): LyDoBoQuaTuXacNhan | null {
  if (!k.coSoBat) return "CO_SO_TAT";
  if (!coBangChungNganHang(k.note)) return "KHONG_BANG_CHUNG_NGAN_HANG";
  if (thieuGhiDanh({ enrollmentId: k.enrollmentId }, k.loaiDon)) return "THIEU_GHI_DANH";
  return null;
}

export type KetQuaTuXacNhan = {
  ungVien: number;
  daXacNhan: number;
  /** Đã được người/lượt khác xác nhận đúng lúc (không sinh phiếu thứ hai). */
  daCoNguoiXacNhan: number;
  boQua: Record<string, number>;
  /** Lỗi bất ngờ (không phải cổng nghiệp vụ) — in ra để người vận hành thấy; không chặn các khoản khác. */
  loi: string[];
};

const cong = (m: Record<string, number>, k: string) => {
  m[k] = (m[k] ?? 0) + 1;
};

/**
 * Chạy MỘT lượt quét. Công tắc tắt ở mọi cơ sở có ứng viên ⇒ không xác nhận gì (vẫn đếm lý do để báo cáo).
 * `now` BẮT BUỘC (luật 19: không đọc đồng hồ thật trong lõi).
 */
export async function chayTuXacNhanKhoanNganHang(input: { now: Date; toiDa?: number }): Promise<KetQuaTuXacNhan> {
  const kq: KetQuaTuXacNhan = { ungVien: 0, daXacNhan: 0, daCoNguoiXacNhan: 0, boQua: {}, loi: [] };
  const ungVien = await db.payment.findMany({
    where: { AND: [{ deletedAt: null }, WHERE_KHOAN_CHO_CO_BANG_CHUNG_NGAN_HANG] },
    select: { id: true, note: true, enrollmentId: true, centerId: true, order: { select: { type: true } } },
    orderBy: { createdAt: "asc" },
    take: NAP_UNG_VIEN,
  });
  kq.ungVien = ungVien.length;
  if (ungVien.length === 0) return kq;

  // Công tắc phân giải MỘT lần cho mỗi cơ sở (đọc có cache; không N+1 theo khoản).
  const coSoBat = new Map<string | null, boolean>();
  for (const cid of new Set(ungVien.map((u) => u.centerId))) {
    const orgUnitId = await orgUnitIdForCenter(cid);
    coSoBat.set(cid, await getSetting(KHOA_TU_XAC_NHAN_NGAN_HANG, { orgUnitId }));
  }

  const toiDa = input.toiDa ?? TOI_DA_MOT_LUOT;
  for (const u of ungVien) {
    if (kq.daXacNhan + kq.daCoNguoiXacNhan >= toiDa) break;
    const lyDo = lyDoBoQuaTuXacNhan({ note: u.note, enrollmentId: u.enrollmentId, loaiDon: u.order?.type ?? null, coSoBat: coSoBat.get(u.centerId) ?? false });
    if (lyDo) {
      cong(kq.boQua, lyDo);
      continue;
    }
    try {
      const r = await db.$transaction(async (tx) => {
        const x = await xacNhanKhoanTrongTx(tx, {
          paymentId: u.id,
          confirmedById: NGUOI_XAC_NHAN_TU_DONG,
          actor: ACTOR,
          now: input.now,
          // Đơn SCOPE «xác nhận trước khi có ghi danh» là NGOẠI LỆ do kế toán chủ động chọn (`xac-nhan-truoc.ts`); bộ quét tự động không đoán hộ ⇒ giữ nguyên chữ.
          choPhepTruocGhiDanh: false,
        });
        if (!x.raced) {
          // Vết RIÊNG để lần sau hỏi «khoản này do máy hay do người xác nhận» không phải suy từ `confirmedById`.
          await writeAudit({
            actor: ACTOR,
            module: "finance",
            entityType: "Payment",
            entityId: u.id,
            action: "TU_XAC_NHAN_NGAN_HANG",
            newValues: { receiptCode: x.receiptCode ?? null, nguon: "bo-quet-ngan-hang" },
            tx,
          });
        }
        return x;
      });
      if (r.raced) kq.daCoNguoiXacNhan++;
      else kq.daXacNhan++;
    } catch (e) {
      if (e instanceof LoiXacNhanKhoan) cong(kq.boQua, e.ma);
      else kq.loi.push(`${u.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return kq;
}
