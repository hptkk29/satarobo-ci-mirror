// lib/hoc-bu/sua-du-lieu-db.ts — PHẦN GHI của script sửa dữ liệu học bù (T15, 08/10/2026). Kế hoạch (ai sửa, sửa bằng gì): `ke-hoach-sua.ts`.
//
// Mỗi hàm sửa:
//   · CHỈ nhận phát hiện đã được `tuDongDuoc` xác nhận (checker nói AUTO_FIXABLE + đủ dữ liệu máy đọc);
//   · kiểm lại điều kiện TRƯỚC khi ghi (dữ liệu có thể đã đổi kể từ lúc checker đọc) — đổi rồi thì BỎ QUA và nói rõ, không ghi đè;
//   · ghi MỘT dòng nhật ký `hoc-bu.sua-du-lieu` (luật gốc, bằng chứng, giá trị cũ → mới);
//   · idempotent — chạy lại không sửa lần hai (điều kiện đã không còn).
// Toàn lô chạy trong MỘT transaction của người gọi: một lỗi thật ⇒ rollback cả lô.
import "server-only";
import type { AttendanceStatus, Prisma } from "@prisma/client";
import type { Finding, MaLuat } from "@/lib/hoc-bu/toan-ven";
import { chotCase } from "@/lib/hoc-bu/case-nhieu-bai-thuan";
import { nangCapCase } from "@/lib/hoc-bu/case-nang-cap-db";
import { chotLaiCaseTrongTx } from "@/lib/hoc-bu/case-diem-danh-db";
import { xetLaiSauKhiHoanMotPhan } from "@/lib/hoc-bu/don-doi-db";
import { ghiNhatKy } from "@/lib/hoc-bu/nhat-ky";
import { kiemExpect, type KeHoachSua } from "@/lib/hoc-bu/ke-hoach-sua";

type Tx = Prisma.TransactionClient;

export type KetQuaSuaMot = { ok: true } | { ok: false; lyDo: string };
export type KetQuaApDung = {
  luat: MaLuat;
  /** Số phát hiện đủ điều kiện (= `--expect`). */
  duDieuKien: number;
  daSua: number;
  boQua: { id: string; lyDo: string }[];
};

const TEN_SCRIPT = "Hệ thống (script sửa dữ liệu học bù)";

/** Trạng thái VẮNG hợp lệ của điểm danh gốc — script chỉ được khôi phục VỀ một trong các giá trị này. */
const TRANG_THAI_VANG: readonly AttendanceStatus[] = ["ABSENT", "EXCUSED", "ABSENT_EXCUSED", "ABSENT_UNEXCUSED"];

async function ghiVetSua(tx: Tx, f: Finding, p: { entityType: "MakeupNeed" | "MakeupCase" | "MakeupCaseParticipant"; entityId: string; oldValues?: Record<string, unknown>; newValues: Record<string, unknown> }) {
  await ghiNhatKy(tx, {
    actorId: null,
    ten: TEN_SCRIPT,
    entityType: p.entityType,
    entityId: p.entityId,
    action: "hoc-bu.sua-du-lieu",
    oldValues: p.oldValues,
    newValues: { luatGoc: f.luat, ...p.newValues },
    reason: `Sửa theo checker ${f.luat} (${f.phanLoai}): ${f.lyDo}`.slice(0, 900),
  });
}

const boQua = (lyDo: string): KetQuaSuaMot => ({ ok: false, lyDo });

/** TV-03 — điền `missedLessonId` còn thiếu từ bài của buổi gốc (điền chỗ trống, không đè giá trị đã có). */
async function suaTV03(tx: Tx, f: Finding): Promise<KetQuaSuaMot> {
  const baiId = f.lienQuan?.baiBuoiGoc;
  if (!baiId) return boQua("thiếu bài của buổi gốc");
  const bai = await tx.lesson.findUnique({ where: { id: baiId }, select: { id: true } });
  if (!bai) return boQua("bài của buổi gốc không còn");
  const r = await tx.makeupNeed.updateMany({ where: { id: f.id, missedLessonId: null, status: { not: "CANCELLED" } }, data: { missedLessonId: baiId } });
  if (r.count !== 1) return boQua("dòng đã có bài hoặc đã huỷ kể từ lúc kiểm");
  await ghiVetSua(tx, f, { entityType: "MakeupNeed", entityId: f.id, oldValues: { missedLessonId: null }, newValues: { missedLessonId: baiId } });
  return { ok: true };
}

/** TV-31 — nối lại `originalAttendanceId` với điểm danh hiện có của đúng (học viên, buổi gốc). */
async function suaTV31(tx: Tx, f: Finding): Promise<KetQuaSuaMot> {
  const diemDanhId = f.lienQuan?.diemDanh;
  if (!diemDanhId) return boQua("thiếu id điểm danh");
  const dong = await tx.makeupNeed.findUnique({ where: { id: f.id }, select: { studentId: true, missedSessionId: true, sourceType: true, originalAttendanceId: true } });
  if (!dong || dong.sourceType !== "ABSENCE") return boQua("dòng không còn là nguồn ABSENCE");
  const a = await tx.attendance.findUnique({ where: { id: diemDanhId }, select: { sessionId: true, studentId: true } });
  if (!a || a.sessionId !== dong.missedSessionId || a.studentId !== dong.studentId) return boQua("điểm danh không còn đúng (học viên, buổi gốc) của dòng");
  if (dong.originalAttendanceId === diemDanhId) return boQua("đã nối");
  const r = await tx.makeupNeed.updateMany({ where: { id: f.id, originalAttendanceId: dong.originalAttendanceId }, data: { originalAttendanceId: diemDanhId } });
  if (r.count !== 1) return boQua("dòng vừa đổi");
  await ghiVetSua(tx, f, { entityType: "MakeupNeed", entityId: f.id, oldValues: { originalAttendanceId: dong.originalAttendanceId }, newValues: { originalAttendanceId: diemDanhId } });
  return { ok: true };
}

/** TV-10 / TV-11 — chốt lại case theo điểm danh các bé (nâng case đời cũ lên trước, để không huỷ nhầm case còn mục). */
async function suaChotCase(tx: Tx, f: Finding): Promise<KetQuaSuaMot> {
  await tx.$queryRaw`SELECT id FROM "MakeupCase" WHERE id = ${f.id} FOR UPDATE`;
  const c = await tx.makeupCase.findUnique({ where: { id: f.id }, select: { status: true } });
  if (!c) return boQua("case không còn");
  if (c.status !== "SCHEDULED") return boQua(`case đã ${c.status} kể từ lúc kiểm`);
  await nangCapCase(tx, f.id);
  const be = await tx.makeupCaseParticipant.findMany({ where: { caseId: f.id }, select: { attendanceStatus: true } });
  const dich = chotCase(be);
  if (dich === null) return boQua("còn bé chờ điểm danh — không chốt được");
  // TV-10 là "hết bé mà vẫn sắp dạy": đích duy nhất hợp lệ là huỷ. Bé đã điểm danh thì đó là TV-11, không phải việc của luật này.
  if (f.luat === "TV-10" && dich !== "CANCELLED") return boQua(`case còn bé (đích chốt = ${dich}) — không phải case rỗng`);
  const moi = await chotLaiCaseTrongTx(tx, f.id, new Date(), null);
  if (moi === null) return boQua("không chốt được");
  await ghiVetSua(tx, f, { entityType: "MakeupCase", entityId: f.id, oldValues: { status: "SCHEDULED" }, newValues: { status: moi } });
  return { ok: true };
}

/**
 * TV-20 — khôi phục trạng thái VẮNG gốc. ĐIỀU KIỆN SỐNG CÒN: giá trị khôi phục lấy NGUYÊN từ nhật ký (`lienQuan.trangThaiGoc`, checker chỉ điền khi mọi
 * mốc audit trước lúc bù xong cùng MỘT trạng thái vắng). Không có thì phát hiện không `tuDongDuoc` và không bao giờ tới đây — script KHÔNG tự chọn
 * "vắng có phép hay không phép".
 */
async function suaTV20(tx: Tx, f: Finding): Promise<KetQuaSuaMot> {
  const sessionId = f.lienQuan?.buoiGoc;
  const studentId = f.lienQuan?.hocVien;
  const goc = f.lienQuan?.trangThaiGoc as AttendanceStatus | undefined;
  if (!sessionId || !studentId || !goc) return boQua("thiếu bằng chứng trạng thái gốc");
  if (!TRANG_THAI_VANG.includes(goc)) return boQua(`trạng thái gốc ${goc} không phải trạng thái vắng`);
  const a = await tx.attendance.findUnique({ where: { sessionId_studentId: { sessionId, studentId } }, select: { id: true, status: true } });
  if (!a) return boQua("điểm danh gốc không còn");
  if (a.status === goc) return boQua("đã đúng trạng thái gốc");
  if (a.status !== "PRESENT" && a.status !== "LATE") return boQua(`điểm danh đã đổi sang ${a.status} kể từ lúc kiểm — không đè`);
  const r = await tx.attendance.updateMany({ where: { id: a.id, status: a.status }, data: { status: goc } });
  if (r.count !== 1) return boQua("điểm danh vừa đổi");
  await ghiVetSua(tx, f, {
    entityType: "MakeupNeed",
    entityId: f.lienQuan?.dong ?? f.id,
    oldValues: { attendanceStatus: a.status },
    newValues: { attendanceId: a.id, attendanceStatus: goc, bangChung: "attendance.edited (một trạng thái vắng duy nhất trước lúc bù xong)" },
  });
  return { ok: true };
}

/** TV-50 — xét lại phí thu thiếu của đơn (dùng đúng hàm của handler `payment.refunded`). Nhiều dòng cùng đơn ⇒ chạy một lần cho đơn. */
async function suaTV50(tx: Tx, f: Finding, daXetDon: Set<string>): Promise<KetQuaSuaMot> {
  const orderId = f.lienQuan?.donPhi;
  if (!orderId) return boQua("thiếu id đơn phí");
  if (daXetDon.has(orderId)) return { ok: true }; // đơn đã được xét trong lượt này: các dòng cùng đơn đã được xử lý cùng nhau
  daXetDon.add(orderId);
  const kq = await xetLaiSauKhiHoanMotPhan(tx, { orderId, paymentId: null });
  if (kq.khongThieu) return boQua("đơn phí đã thu đủ kể từ lúc kiểm");
  if (kq.goKhoiCase + kq.daBuXong === 0) return boQua("không còn bé nào dựa vào phí này");
  return { ok: true };
}

/**
 * Áp dụng sửa cho MỘT luật. `--expect` kiểm TRƯỚC khi ghi (lệch ⇒ ném `LoiExpect`, chưa ghi gì). Từng phát hiện kiểm lại điều kiện rồi mới ghi;
 * không đủ thì ghi vào `boQua` (kèm lý do) chứ không ném — một dòng đã đổi không được làm hỏng cả lô.
 */
export async function apDungSua(tx: Tx, kh: KeHoachSua, p: { luat: MaLuat; expect: number }): Promise<KetQuaApDung> {
  const ds = kiemExpect(kh, p.luat, p.expect);
  const kq: KetQuaApDung = { luat: p.luat, duDieuKien: ds.length, daSua: 0, boQua: [] };
  const daXetDon = new Set<string>();
  for (const d of [...ds].sort((a, b) => a.id.localeCompare(b.id))) {
    const f = d.finding;
    const r =
      f.luat === "TV-03"
        ? await suaTV03(tx, f)
        : f.luat === "TV-31"
          ? await suaTV31(tx, f)
          : f.luat === "TV-10" || f.luat === "TV-11"
            ? await suaChotCase(tx, f)
            : f.luat === "TV-20"
              ? await suaTV20(tx, f)
              : f.luat === "TV-50"
                ? await suaTV50(tx, f, daXetDon)
                : boQua("luật không có hàm sửa");
    if (r.ok) kq.daSua++;
    else kq.boQua.push({ id: f.id, lyDo: r.lyDo });
  }
  return kq;
}
