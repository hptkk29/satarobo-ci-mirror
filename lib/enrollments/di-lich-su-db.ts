// lib/enrollments/di-lich-su-db.ts — phần ĐỌC/GHI DB của "điểm danh + nhận xét đi theo học viên sang lớp mới".
// Luật + lý do: `ke-hoach-di-lich-su.ts` (thuần). File này chỉ nạp dữ liệu, gọi bộ lập kế hoạch, và ghi đúng kế hoạch trong CÙNG transaction
// của phép chuyển lớp (rollback thì không có chuyện chuyển lớp xong mà lịch sử học nửa vời).
//
// ⚠️ MỌI đường chuyển ghi danh PHẢI gọi hàm này: `chuyenLopTrongTx` (chuyển lớp + đổi khoá) và `approveTransfer` (/chuyen-lop). Lưới
// `[LSH-W*]` (`lib/enrollments/di-lich-su.test.ts`) đỏ nếu một đường quên — ba bản chép tay của một luật thì vá được hai bản là chuyện
// thường (`di-theo-ghi-danh.ts`). Hàm KHÔNG kiểm quyền và KHÔNG kiểm cách ly cơ sở: nó chạy trong transaction của người gọi.
import "server-only";
import { Prisma } from "@prisma/client";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { lapKeHoachDiLichSu, type KeHoachDiLichSu } from "@/lib/enrollments/ke-hoach-di-lich-su";

type Tx = Prisma.TransactionClient;

export type KetQuaDiLichSu = {
  diemDanh: number;
  nhanXet: number;
  nhanXetThay: number;
  boQua: KeHoachDiLichSu["boQua"];
};

/** Số chặng truy ngược tối đa theo chuỗi chuyển lớp (A→B→C…) — chặn vòng lặp do dữ liệu hỏng. */
const SO_CHANG_TOI_DA = 10;

/**
 * Các lớp học viên đã học TRƯỚC ghi danh `enrollmentCuId`, theo chuỗi chuyển lớp (`transferredToId`), tính cả lớp của chính ghi danh cũ.
 * Cần chuỗi vì A→B→C: điểm danh ở A có thể chưa được chép sang B (buổi cùng bài của B lúc đó chưa diễn ra) nhưng đến C thì đã qua.
 */
export async function lopNguonTheoChuoiChuyen(tx: Tx, enrollmentCuId: string): Promise<string[]> {
  const lop: string[] = [];
  let hienTai: string | null = enrollmentCuId;
  for (let i = 0; i < SO_CHANG_TOI_DA && hienTai; i++) {
    const e: { classId: string } | null = await tx.enrollment.findFirst({
      where: { id: hienTai, deletedAt: null },
      select: { classId: true },
    });
    if (!e) break;
    if (!lop.includes(e.classId)) lop.push(e.classId);
    const truoc: { id: string } | null = await tx.enrollment.findFirst({
      where: { transferredToId: hienTai, deletedAt: null },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    hienTai = truoc?.id ?? null;
  }
  return lop;
}

const ngayVn = (d: Date) => d.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
const json = (v: Prisma.JsonValue | null) => (v === null ? Prisma.JsonNull : (v as Prisma.InputJsonValue));

/**
 * Chuyển điểm danh (có mặt/trễ) + nhận xét của `studentId` từ các lớp nguồn sang buổi ĐÃ DIỄN RA cùng bài của lớp đích.
 * Idempotent. Trả số dòng đã chuyển để người gọi đưa vào kết quả/audit.
 */
export async function diLichSuHocSangLopMoi(
  tx: Tx,
  p: {
    studentId: string;
    lopNguonIds: readonly string[];
    lopDichId: string;
    /** Ghi danh MỚI ở lớp đích — làm thực thể của dòng audit. */
    enrollmentMoiId: string;
    actor: AuditActor;
    lyDo: string;
    now?: Date;
  },
): Promise<KetQuaDiLichSu> {
  const khong: KetQuaDiLichSu = {
    diemDanh: 0,
    nhanXet: 0,
    nhanXetThay: 0,
    boQua: {
      khongCoBaiHoc: 0,
      khongCoBuoiTuongUng: 0,
      buoiDichChuaDienRa: 0,
      diemDanhVang: 0,
      diemDanhDaCoOLopMoi: 0,
      nhanXetDichDaSomHon: 0,
      trungBuoiNguonCungBai: 0,
    },
  };
  const nguon = p.lopNguonIds.filter((id) => id !== p.lopDichId);
  if (nguon.length === 0) return khong;
  const now = p.now ?? new Date();

  const buoiDich = await tx.classSession.findMany({
    where: { classId: p.lopDichId },
    select: { id: true, lessonId: true, date: true, status: true, centerId: true, orgUnitId: true },
  });
  if (buoiDich.length === 0) return khong;
  const idBuoiDich = buoiDich.map((b) => b.id);

  const [ddNguon, nxNguon, ddDich, nxDich, lopDich] = await Promise.all([
    tx.attendance.findMany({
      where: { studentId: p.studentId, session: { classId: { in: nguon } } },
      select: {
        id: true,
        sessionId: true,
        status: true,
        note: true,
        absenceReason: true,
        session: { select: { lessonId: true, date: true, class: { select: { classCode: true } } } },
      },
    }),
    tx.studentSessionFeedback.findMany({
      where: { studentId: p.studentId, classSession: { classId: { in: nguon } } },
      select: {
        id: true,
        classSessionId: true,
        comment: true,
        rating: true,
        projectName: true,
        notes: true,
        rubric: true,
        createdById: true,
        createdAt: true,
        classSession: { select: { lessonId: true } },
      },
    }),
    tx.attendance.findMany({ where: { studentId: p.studentId, sessionId: { in: idBuoiDich } }, select: { sessionId: true } }),
    tx.studentSessionFeedback.findMany({
      where: { studentId: p.studentId, classSessionId: { in: idBuoiDich } },
      select: { id: true, classSessionId: true, comment: true, rating: true, projectName: true, notes: true, rubric: true, createdById: true, createdAt: true },
    }),
    tx.class.findUnique({ where: { id: p.lopDichId }, select: { centerId: true } }),
  ]);

  const ke = lapKeHoachDiLichSu({
    buoiDich: buoiDich.map((b) => ({ id: b.id, lessonId: b.lessonId, date: b.date, status: b.status })),
    diemDanhNguon: ddNguon.map((a) => ({
      id: a.id,
      sessionId: a.sessionId,
      lessonId: a.session.lessonId,
      ngayBuoi: a.session.date,
      status: a.status,
    })),
    nhanXetNguon: nxNguon.map((f) => ({
      id: f.id,
      sessionId: f.classSessionId,
      lessonId: f.classSession.lessonId,
      createdAt: f.createdAt,
    })),
    diemDanhDichCoSan: new Set(ddDich.map((a) => a.sessionId)),
    nhanXetDichCoSan: new Map(nxDich.map((f) => [f.classSessionId, { id: f.id, createdAt: f.createdAt }])),
    now,
  });

  const buoiTheoId = new Map(buoiDich.map((b) => [b.id, b]));
  const ddTheoId = new Map(ddNguon.map((a) => [a.id, a]));
  const nxTheoId = new Map(nxNguon.map((f) => [f.id, f]));
  const nxDichTheoId = new Map(nxDich.map((f) => [f.id, f]));

  for (const t of ke.diemDanhTao) {
    const a = ddTheoId.get(t.nguonId)!;
    const b = buoiTheoId.get(t.buoiDichId)!;
    const goc = `Học ở lớp trước (${a.session.class.classCode ?? "—"}), buổi ${ngayVn(a.session.date)}`;
    await tx.attendance.create({
      data: {
        sessionId: b.id,
        studentId: p.studentId,
        status: a.status,
        note: a.note ? `${goc} — ${a.note}` : goc,
        absenceReason: a.absenceReason,
        centerId: b.centerId ?? lopDich?.centerId ?? null,
        orgUnitId: b.orgUnitId,
        // Dòng này là LỊCH SỬ, không phải điểm danh mới: đặt mốc đã thông báo để `notifyAttendance` (lấy `notifiedAt: null` của buổi)
        // không gửi lại tin điểm danh cũ cho phụ huynh mỗi khi giáo viên lớp mới lưu điểm danh một em khác.
        notifiedAt: now,
        makeupStatus: "NONE",
      },
    });
  }

  for (const t of ke.nhanXetTao) {
    const f = nxTheoId.get(t.nguonId)!;
    await tx.studentSessionFeedback.create({
      data: {
        classSessionId: t.buoiDichId,
        studentId: p.studentId,
        comment: f.comment,
        rating: f.rating,
        projectName: f.projectName,
        notes: json(f.notes),
        rubric: json(f.rubric),
        createdById: f.createdById,
        createdAt: f.createdAt,
      },
    });
  }

  const biThay: { nhanXetDichId: string; buoiDichId: string; cu: unknown }[] = [];
  for (const t of ke.nhanXetThay) {
    const f = nxTheoId.get(t.nguonId)!;
    const cu = nxDichTheoId.get(t.nhanXetDichId)!;
    biThay.push({ nhanXetDichId: t.nhanXetDichId, buoiDichId: t.buoiDichId, cu });
    await tx.studentSessionFeedback.update({
      where: { id: t.nhanXetDichId },
      data: {
        comment: f.comment,
        rating: f.rating,
        projectName: f.projectName,
        notes: json(f.notes),
        rubric: json(f.rubric),
        createdById: f.createdById,
        createdAt: f.createdAt,
      },
    });
  }

  const kq: KetQuaDiLichSu = {
    diemDanh: ke.diemDanhTao.length,
    nhanXet: ke.nhanXetTao.length,
    nhanXetThay: ke.nhanXetThay.length,
    boQua: ke.boQua,
  };

  if (kq.diemDanh + kq.nhanXet + kq.nhanXetThay > 0) {
    await writeAudit({
      tx,
      actor: p.actor,
      module: "enrollment",
      entityType: "Enrollment",
      entityId: p.enrollmentMoiId,
      action: "DI_LICH_SU_HOC",
      // Nhận xét bị thay (giáo viên nhận xét chồng ⇒ lấy bản đầu) được GIỮ NGUYÊN VĂN ở đây: thay là bỏ nội dung, phải còn đường lấy lại.
      oldValues: biThay.length > 0 ? { nhanXetBiThay: biThay } : undefined,
      newValues: {
        studentId: p.studentId,
        lopNguonIds: nguon,
        lopDichId: p.lopDichId,
        diemDanhDaChuyen: kq.diemDanh,
        nhanXetDaChuyen: kq.nhanXet,
        nhanXetDaThay: kq.nhanXetThay,
        boQua: kq.boQua,
      },
      reason: p.lyDo,
      orgUnitId: lopDich?.centerId ?? null,
    });
  }
  return kq;
}
