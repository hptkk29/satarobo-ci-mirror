// lib/hoc-bu/su-kien.ts — PHÁT SỰ KIỆN HỌC BÙ (T13, 08/10/2026). Mọi sự kiện nghiệp vụ của case đi qua MỘT cửa này.
//
// Vì sao một cửa: (1) `tx` BẮT BUỘC — sự kiện sinh ra trong giao dịch nghiệp vụ nên rollback thì không có sự kiện (luật outbox); không có chỗ nào được
// phát "sau khi xong" bằng `db` trần rồi nuốt lỗi. (2) Khoá chống trùng và tên sự kiện lấy từ `thong-bao-thuan.ts` — không ai tự nối chuỗi.
import type { Prisma } from "@prisma/client";
import { publishEvent } from "@/lib/events/publish";
import { khoaSuKien, SU_KIEN, type KhungCase } from "@/lib/hoc-bu/thong-bao-thuan";

type Tx = Prisma.TransactionClient;

/** Chỉ ID (+ phiên bản làm khoá). Người nhận đọc nội dung LÚC XỬ LÝ — tin luôn nói đúng dữ liệu hiện tại, không bản chụp cũ. */
export async function phatCaseDaXep(tx: Tx, p: { caseId: string; participantId: string; studentId: string; mucId: string }): Promise<void> {
  await publishEvent(SU_KIEN.CASE_DA_XEP, { ...p }, { tx, dedupeKey: khoaSuKien.caseDaXep(p.participantId, p.mucId) });
}

export async function phatCaseDoi(tx: Tx, p: { caseId: string; phienBanSau: number; truoc: KhungCase; sau: KhungCase }): Promise<void> {
  await publishEvent(SU_KIEN.CASE_DOI, { ...p }, { tx, dedupeKey: khoaSuKien.caseDoi(p.caseId, p.phienBanSau) });
}

/** Một bé bị gỡ / case huỷ ⇒ báo PHỤ HUYNH của bé đó. */
export async function phatBeBiGo(tx: Tx, p: { caseId: string; participantId: string; studentId: string; phienBan: number }): Promise<void> {
  await publishEvent(SU_KIEN.CASE_HUY, { ...p, doiTuong: "PHU_HUYNH" }, { tx, dedupeKey: khoaSuKien.caseHuyBe(p.participantId, p.phienBan) });
}

/** Cả case huỷ ⇒ báo GIÁO VIÊN một lần (dù trước đó gỡ từng bé). */
export async function phatCaseBiHuy(tx: Tx, p: { caseId: string; teacherId: string }): Promise<void> {
  await publishEvent(SU_KIEN.CASE_HUY, { ...p, doiTuong: "GIAO_VIEN" }, { tx, dedupeKey: khoaSuKien.caseHuyGv(p.caseId) });
}

export async function phatHoanThanh(tx: Tx, p: { caseId: string; participantId: string; studentId: string; phienBan: number; sua: boolean }): Promise<void> {
  await publishEvent(SU_KIEN.HOAN_THANH, { ...p }, { tx, dedupeKey: khoaSuKien.hoanThanh(p.participantId, p.phienBan) });
}

export async function phatBeVang(tx: Tx, p: { caseId: string; participantId: string; studentId: string; phienBan: number; sua: boolean }): Promise<void> {
  await publishEvent(SU_KIEN.BE_VANG, { ...p }, { tx, dedupeKey: khoaSuKien.beVang(p.participantId, p.phienBan) });
}

/** `moc` = id khoản hoàn tiền làm phí thu thiếu (T14); `thieu` = số còn thiếu. Bỏ trống cả hai = hết lượt thường. */
export async function phatCanThuPhi(
  tx: Tx,
  p: { makeupNeedId: string; studentId: string; centerId: string | null; moc?: string | null; thieu?: number | null },
): Promise<void> {
  await publishEvent(SU_KIEN.CAN_THU_PHI, { ...p }, { tx, dedupeKey: khoaSuKien.canThuPhi(p.makeupNeedId, p.moc) });
}
