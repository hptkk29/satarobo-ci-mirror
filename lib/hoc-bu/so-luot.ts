// lib/hoc-bu/so-luot.ts — NƠI DUY NHẤT ghi SỔ LƯỢT học bù (MakeupCreditAccount / MakeupCreditEntry). T06, 07/10/2026.
//
// Một tài khoản mỗi (học viên, khoá). Gọi BÊN TRONG giao dịch của người gọi (xếp case, gỡ, huỷ case, điểm danh bù…): bút toán và
// sự kiện sinh ra nó commit hoặc rollback CÙNG nhau — "lượt đã giữ mà case không tồn tại" không có chỗ để sống.
//
// Hàng tài khoản bị KHOÁ (SELECT … FOR UPDATE) trước mọi phép ghi: hai lượt đồng thời cho cùng một bé xếp hàng và nhìn thấy kết quả
// đã commit của nhau (HB-20). Bút toán có `idemKey` duy nhất trong tài khoản nên chạy lại một bước không ghi hai lần.
//
// ⚠️ KHÔNG có `import "server-only"`: R3 nạp `dong-service` → mọi thứ nó kéo theo, và cấu hình R3 không có shim (cùng lý do T05).
import type { Prisma } from "@prisma/client";
import { LoiHocBu } from "@/lib/hoc-bu/loi";
import {
  apButToan,
  butToanDaoTieu,
  butToanDieuChinh,
  butToanGiu,
  butToanKhoiTao,
  butToanNha,
  butToanTieu,
  conLai,
  gioiHanDieuChinhGiam,
  type ButToan,
  type SoLuot,
} from "@/lib/hoc-bu/so-luot-thuan";
import { tongLuotCongThuc } from "@/lib/hoc-bu/luot-cong-thuc-db";

type Tx = Prisma.TransactionClient;

export type MaLoiLuot = "HET_LUOT" | "SO_AM";

/** Lỗi nghiệp vụ của sổ lượt — `message` nói được thẳng với người dùng; ném ⇒ giao dịch của người gọi rollback. */
export class LoiLuot extends LoiHocBu {
  constructor(
    readonly ma: MaLoiLuot,
    message: string,
  ) {
    super(message);
    this.name = "LoiLuot";
  }
}

export type KhoaTaiKhoan = { id: string; studentId: string; courseId: string; version: number } & SoLuot;

export type DinhDanhLuot = {
  studentId: string;
  courseId: string;
  /** Lớp của dòng cần bù — chỉ để tính công thức lúc KHỞI TẠO tài khoản. */
  classId: string;
};

async function ghiNhieuButToan(tx: Tx, tk: KhoaTaiKhoan, tatCa: readonly ButToan[], actorId: string | null): Promise<KhoaTaiKhoan> {
  // Chống lặp ĐỨNG TRƯỚC phép áp: bút toán đã có (cùng `idemKey`) thì BỎ QUA, không áp lại lên ba số. Phải kiểm trước chứ không dựa vào
  // chỉ mục duy nhất: chạy lại `tieuLuot` thì phép áp thứ hai đã ném "âm" (held 0 − 1) TRƯỚC khi chạm tới chỉ mục. Tài khoản đang bị
  // khoá nên hai lượt không chen vào giữa lần kiểm này và lần ghi bên dưới.
  const daCo = tatCa.length
    ? await tx.makeupCreditEntry.findMany({
        where: { accountId: tk.id, idemKey: { in: tatCa.map((b) => b.idemKey) } },
        select: { idemKey: true },
      })
    : [];
  const khoaDaCo = new Set(daCo.map((e) => e.idemKey));
  const buts = tatCa.filter((b) => !khoaDaCo.has(b.idemKey));
  let sau: SoLuot = { granted: tk.granted, held: tk.held, consumed: tk.consumed };
  const ghi: Prisma.MakeupCreditEntryCreateManyInput[] = [];
  for (const b of buts) {
    const r = apButToan(sau, b);
    if (!r.ok) {
      throw new LoiLuot(
        r.ma === "VUOT" ? "HET_LUOT" : "SO_AM",
        r.ma === "VUOT" ? "Học viên đã hết lượt học bù" : `${r.lyDo} (${b.type} ${b.idemKey})`,
      );
    }
    sau = r.sau;
    ghi.push({
      accountId: tk.id,
      type: b.type,
      grantedDelta: b.grantedDelta,
      heldDelta: b.heldDelta,
      consumedDelta: b.consumedDelta,
      makeupNeedId: b.makeupNeedId ?? null,
      caseStudentId: b.caseStudentId ?? null,
      reason: b.reason ?? null,
      actorId,
      idemKey: b.idemKey,
    });
  }
  if (ghi.length === 0) return tk;
  // `createMany` KHÔNG skipDuplicates: đã lọc ở trên và đang giữ khoá, nên trùng ở đây là lỗi thật (ném, rollback) chứ không phải chạy lại.
  await tx.makeupCreditEntry.createMany({ data: ghi });
  await tx.makeupCreditAccount.update({
    where: { id: tk.id },
    data: { ...sau, version: { increment: 1 } },
  });
  return { ...tk, ...sau, version: tk.version + 1 };
}

/**
 * Khoá tài khoản (học viên, khoá) — TẠO nếu chưa có, và khi tạo thì KHỞI TẠO từ dữ liệu trước T06: cấp theo công thức hiện tại rồi
 * phát lại lượt đã giữ/đã tiêu (xem `butToanKhoiTao`). Hai lượt cùng tạo: lượt thứ hai chờ ở chỉ mục duy nhất, thấy hàng đã commit.
 */
export async function khoaTaiKhoan(tx: Tx, p: DinhDanhLuot, actorId: string | null): Promise<KhoaTaiKhoan> {
  const moi = await tx.makeupCreditAccount.createMany({
    data: [{ studentId: p.studentId, courseId: p.courseId }],
    skipDuplicates: true,
  });
  const hang = await tx.$queryRaw<{ id: string; granted: number; held: number; consumed: number; version: number }[]>`
    SELECT "id", "granted", "held", "consumed", "version" FROM "MakeupCreditAccount"
    WHERE "studentId" = ${p.studentId} AND "courseId" = ${p.courseId} FOR UPDATE`;
  const h = hang[0];
  if (!h) throw new LoiLuot("SO_AM", "Không khoá được tài khoản lượt bù");
  const tk: KhoaTaiKhoan = { ...h, studentId: p.studentId, courseId: p.courseId };
  if (moi.count !== 1) return tk;

  const [lop, hv, dangGiu, daTieu] = await Promise.all([
    tx.class.findUnique({
      where: { id: p.classId },
      select: { course: { select: { id: true, totalSessions: true, choPhepHocBu: true } } },
    }),
    tx.student.findUnique({ where: { id: p.studentId }, select: { leadChildId: true } }),
    tx.makeupCaseStudent.findMany({
      where: { status: "PLACED", dungLuot: true, makeupNeed: { studentId: p.studentId, courseId: p.courseId } },
      select: { id: true, makeupNeedId: true },
    }),
    tx.makeupNeed.findMany({
      where: { studentId: p.studentId, courseId: p.courseId, usedQuota: true },
      select: { id: true },
    }),
  ]);
  if (!lop) throw new LoiLuot("SO_AM", "Lớp của dòng cần bù không tồn tại — không khởi tạo được sổ lượt");
  const theoCap = await tongLuotCongThuc(tx, tx, [
    { studentId: p.studentId, classId: p.classId, leadChildId: hv?.leadChildId ?? null, course: lop.course },
  ]);
  const tongCongThuc = [...theoCap.values()][0] ?? 0;
  const buts = butToanKhoiTao({
    tongCongThuc,
    dangGiu: dangGiu.map((g) => ({ caseStudentId: g.id, makeupNeedId: g.makeupNeedId })),
    daTieu: daTieu.map((n) => ({ makeupNeedId: n.id, caseStudentId: null })),
  });
  return ghiNhieuButToan(tx, tk, buts, actorId);
}

/** Xếp bé vào case BẰNG LƯỢT ⇒ giữ chỗ một lượt. Hết lượt ⇒ ném `HET_LUOT` (rollback cả case). */
export async function giuLuot(
  tx: Tx,
  p: DinhDanhLuot & { makeupNeedId: string; caseStudentId: string; actorId: string | null },
): Promise<void> {
  const tk = await khoaTaiKhoan(tx, p, p.actorId);
  await ghiNhieuButToan(tx, tk, [butToanGiu({ caseStudentId: p.caseStudentId, makeupNeedId: p.makeupNeedId })], p.actorId);
}

/** Gỡ bé / huỷ case / bé vắng buổi bù ⇒ nhả lượt đang giữ. */
export async function nhaLuot(
  tx: Tx,
  p: DinhDanhLuot & { makeupNeedId: string; caseStudentId: string; lyDo: string; actorId: string | null },
): Promise<void> {
  const tk = await khoaTaiKhoan(tx, p, p.actorId);
  await ghiNhieuButToan(
    tx,
    tk,
    [butToanNha({ caseStudentId: p.caseStudentId, makeupNeedId: p.makeupNeedId, reason: p.lyDo })],
    p.actorId,
  );
}

/** Bé CÓ MẶT ở buổi bù (đã xếp bằng lượt) ⇒ lượt đang giữ chuyển thành đã tiêu. */
export async function tieuLuot(
  tx: Tx,
  p: DinhDanhLuot & {
    makeupNeedId: string;
    caseStudentId: string;
    actorId: string | null;
    /** Lượt đang được GIỮ (HOLD) ⇒ tiêu = held→consumed. Sửa điểm danh tiêu lại lượt đã nhả thì `false` và cần còn lượt. BẮT BUỘC khai. */
    daGiu: boolean;
    /** Khoá chống lặp riêng của lần tiêu này (T07: theo mục + lần sửa). Bỏ trống = khoá theo dòng cần bù (đường cũ). */
    khoa?: string;
  },
): Promise<void> {
  const tk = await khoaTaiKhoan(tx, p, p.actorId);
  await ghiNhieuButToan(
    tx,
    tk,
    [butToanTieu({ makeupNeedId: p.makeupNeedId, caseStudentId: p.caseStudentId, daGiu: p.daGiu, khoa: p.khoa })],
    p.actorId,
  );
}

/** T07 — sửa điểm danh đảo một lần tiêu: trả lại đúng một lượt (consumed −1), giữ nguyên bút toán tiêu cũ làm lịch sử. */
export async function daoTieuLuot(
  tx: Tx,
  p: DinhDanhLuot & { makeupNeedId: string; caseStudentId: string; lan: number; lyDo: string; actorId: string | null },
): Promise<void> {
  const tk = await khoaTaiKhoan(tx, p, p.actorId);
  await ghiNhieuButToan(
    tx,
    tk,
    [butToanDaoTieu({ makeupNeedId: p.makeupNeedId, caseStudentId: p.caseStudentId, lan: p.lan, reason: p.lyDo })],
    p.actorId,
  );
}

/**
 * Điều chỉnh có lý do (đơn huỷ / hoàn / đổi số buổi). GIẢM không kéo "còn" xuống âm — lượt đã giữ/đã tiêu là sự thật đã xảy ra:
 * phần không rút được ghi NGAY vào lý do của bút toán chứ không bị bỏ im lặng. Trả mức áp thực tế (0 nếu không đổi gì).
 */
export async function dieuChinhLuot(
  tx: Tx,
  p: DinhDanhLuot & { delta: number; nguon: string; lyDo: string; actorId: string | null; makeupNeedId?: string | null },
): Promise<number> {
  const tk = await khoaTaiKhoan(tx, p, p.actorId);
  const { ap, giuLai } = gioiHanDieuChinhGiam(tk, p.delta);
  if (ap === 0) return 0;
  const lyDo = giuLai > 0 ? `${p.lyDo} — yêu cầu ${p.delta}, chỉ áp được ${ap}: ${giuLai} lượt không rút được vì đã giữ/đã tiêu` : p.lyDo;
  const sau = await ghiNhieuButToan(
    tx,
    tk,
    [butToanDieuChinh({ delta: ap, nguon: p.nguon, reason: lyDo, makeupNeedId: p.makeupNeedId ?? null })],
    p.actorId,
  );
  return sau.version === tk.version ? 0 : ap;
}

export type SoLuotDoc = SoLuot & { con: number };

/** Đọc sổ cho màn hình: Map `${studentId}|${courseId}` → số. Không có tài khoản ⇒ không có khoá (nơi gọi rơi về công thức). */
export async function docSoLuot(
  nguon: Pick<Tx, "makeupCreditAccount">,
  cap: readonly { studentId: string; courseId: string }[],
): Promise<Map<string, SoLuotDoc>> {
  const ra = new Map<string, SoLuotDoc>();
  if (cap.length === 0) return ra;
  const rows = await nguon.makeupCreditAccount.findMany({
    where: {
      studentId: { in: [...new Set(cap.map((c) => c.studentId))] },
      courseId: { in: [...new Set(cap.map((c) => c.courseId))] },
    },
    select: { studentId: true, courseId: true, granted: true, held: true, consumed: true },
  });
  for (const r of rows) {
    ra.set(`${r.studentId}|${r.courseId}`, {
      granted: r.granted,
      held: r.held,
      consumed: r.consumed,
      con: conLai(r),
    });
  }
  return ra;
}
