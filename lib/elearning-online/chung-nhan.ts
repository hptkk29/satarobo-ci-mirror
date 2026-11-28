import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { taoSnapshot } from "./cn-mau";
import { BANG_MA, DO_DAI_DUOI_MA, TIEN_TO_MA_CN, chuanHoaMaChungNhan, hienThiMaChungNhan } from "./ma-chung-nhan";
import { docBanChayChoTienDo, docTienDoKhoaTheoQuyen, laConCuaPhuHuynh, type Cli } from "./hoc-tap";

/**
 * E-LEARNING ONLINE — CHỨNG NHẬN hoàn thành khoá (tách bạch với chứng nhận Nội bộ `TrnCertificate`).
 *
 * Bất biến:
 * 1. MỘT chứng nhận cho (học viên × khoá) — khoá duy nhất ở DB; cấp tự động khi khoá HOÀN THÀNH (`tinhTienDoKhoa.hoanThanh`), idempotent (gọi lại không cấp hai lần).
 * 2. GIỮ NGUYÊN: phát hành bản mới, đặt lại tiến độ, thu hồi/hết hạn quyền học KHÔNG chạm chứng nhận. Chỉ `thuHoiChungNhan` (có lý do) đổi trạng thái.
 * 3. SNAPSHOT tên học viên/khoá/số bản lúc cấp — đổi tên sau đó không đổi giấy đã cấp.
 * 4. Mã tra cứu ngẫu nhiên không đoán được (đuôi 10 ký tự, bỏ ký tự dễ nhầm; mã cấp từ C10 có tiền tố `SRON`, hiển thị `SR-ON-`); tra cứu công khai CHE tên học viên.
 */

type Db = PrismaClient;

/** Mẫu (phôi) ĐANG ÁP DỤNG của khoá, đọc MỘT lần lúc cấp. Không có ⇒ `null` (khuôn mặc định). */
const docMauDangDung = (cli: Cli, courseId: string) =>
  cli.onlCertificateTemplate.findFirst({ where: { courseId, status: "APPROVED" }, select: { id: true, backgroundKey: true, backgroundSha256: true, backgroundMime: true, widthPx: true, heightPx: true, fieldsJson: true } });
type MauCap = Awaited<ReturnType<typeof docMauDangDung>>;

/** Bản chụp dựng lại ĐÚNG giấy đã cấp: mẫu + các dòng chữ + mã. Ghi cùng dòng chứng nhận ⇒ đổi mẫu sau này không đổi giấy cũ. */
function chupKhiCap(mau: MauCap, du: { hoTen: string; tenKhoa: string; finalScore: number | null; capLuc: Date; code: string }) {
  return { templateId: mau?.id ?? null, renderSnapshotJson: taoSnapshot({ mau, du }) as unknown as Prisma.InputJsonValue };
}

export function sinhMaChungNhan(doDai = DO_DAI_DUOI_MA, nguon: (n: number) => Uint8Array = (n) => randomBytes(n)): string {
  const b = nguon(doDai);
  return Array.from(b, (x) => BANG_MA[x % BANG_MA.length]).join("");
}

/** C10 — mã của chứng nhận cấp MỚI: `SRON` + đuôi ngẫu nhiên không đoán được (hiển thị `SR-ON-…`, xem `ma-chung-nhan.ts`). MỌI đường cấp dùng hàm này. */
export const sinhMaChungNhanMoi = (): string => `${TIEN_TO_MA_CN}${sinhMaChungNhan()}`;

/** "Nguyễn Gia Huy" → "N*** G*** H***" — tra cứu công khai không lộ tên đầy đủ của trẻ. */
export function cheTen(ten: string): string {
  return ten.trim().split(/\s+/).filter(Boolean).map((t) => `${[...t][0] ?? ""}***`).join(" ");
}

export type KetQuaCapTuDong = { ok: true; daCo: boolean; code: string } | { ok: false; ma: "CHUA_HOAN_THANH" | "KHONG_CO_QUYEN" | "KHOA_CHUA_PHAT_HANH" };

/**
 * Cấp chứng nhận nếu khoá đã hoàn thành. GỌI ĐƯỢC TRONG giao dịch chấm điểm (cùng sống/chết với kết quả chấm); idempotent.
 * Không kiểm hạn/thu hồi quyền: người đã hoàn thành rồi thì chứng nhận thuộc về họ (nhưng không có đường nào hoàn thành khi quyền đã đóng — cổng chặn từ trước).
 */
export async function capChungNhanTuDong(cli: Cli, entitlementId: string, now: Date): Promise<KetQuaCapTuDong> {
  const q = await cli.onlEntitlement.findUnique({
    where: { id: entitlementId },
    select: { id: true, studentId: true, courseId: true, student: { select: { name: true } }, course: { select: { name: true, code: true, publishedVersionId: true } } },
  });
  if (!q) return { ok: false, ma: "KHONG_CO_QUYEN" };
  const co = await cli.onlCertificate.findUnique({ where: { studentId_courseId: { studentId: q.studentId, courseId: q.courseId } }, select: { code: true } });
  if (co) return { ok: true, daCo: true, code: co.code };
  if (!q.course.publishedVersionId) return { ok: false, ma: "KHOA_CHUA_PHAT_HANH" };
  const td = await docTienDoKhoaTheoQuyen(cli, q.id, q.courseId);
  if (!td.hoanThanh) return { ok: false, ma: "CHUA_HOAN_THANH" };
  const { soBan, cay } = await docBanChayChoTienDo(cli, q.courseId).then((b) => ({ soBan: b.soBan, cay: b.cay }));
  const thi = cay.find((b) => b.kind === "FINAL_EXAM" && !b.hidden);
  const diemThi = thi ? await cli.onlLessonProgress.findUnique({ where: { entitlementId_lessonStableId: { entitlementId: q.id, lessonStableId: thi.stableId } }, select: { bestScore: true } }) : null;
  // `skipDuplicates` = INSERT … ON CONFLICT DO NOTHING: va khoá (học viên × khoá) hay va MÃ đều KHÔNG làm hỏng giao dịch đang chạy
  // (bắt P2002 rồi chạy tiếp trong cùng giao dịch Postgres là lỗi "transaction is aborted").
  const mau = await docMauDangDung(cli, q.courseId);
  for (let lan = 0; lan < 4; lan++) {
    const code = sinhMaChungNhanMoi();
    const r = await cli.onlCertificate.createMany({
      data: [{ studentId: q.studentId, courseId: q.courseId, entitlementId: q.id, code, studentName: q.student.name, courseName: q.course.name, courseCode: q.course.code, versionNumber: soBan, finalScore: diemThi?.bestScore ?? null, issuedAt: now, issuedByUserId: null, ...chupKhiCap(mau, { hoTen: q.student.name, tenKhoa: q.course.name, finalScore: diemThi?.bestScore ?? null, capLuc: now, code }) }],
      skipDuplicates: true,
    });
    if (r.count === 1) return { ok: true, daCo: false, code };
    const lai = await cli.onlCertificate.findUnique({ where: { studentId_courseId: { studentId: q.studentId, courseId: q.courseId } }, select: { code: true } });
    if (lai) return { ok: true, daCo: true, code: lai.code };
    // không có dòng nào cho (học viên × khoá) mà vẫn không chèn được ⇒ va MÃ ⇒ thử mã khác
  }
  throw new Error("Không sinh được mã chứng nhận duy nhất sau 4 lần");
}

export type MaLoiCN = "KHONG_CO_QUYEN" | "DA_CO_CHUNG_NHAN" | "CHUNG_NHAN_KHONG_TON_TAI" | "DA_THU_HOI" | "LY_DO_QUA_NGAN";

/** Cấp TAY (quản trị): cho một quyền học ĐÃ CÓ, kể cả chưa hoàn thành — bắt buộc lý do ≥ 10 ký tự (vào nhật ký ở lớp action). Đã có chứng nhận (kể cả đã thu hồi) ⇒ từ chối. */
export async function capChungNhanTay(db: Db, input: { courseId: string; studentId: string; actorUserId: string; reason: string; now: Date }): Promise<{ ok: true; code: string } | { ok: false; ma: MaLoiCN; thongBao: string }> {
  if (input.reason.trim().length < 10) return { ok: false, ma: "LY_DO_QUA_NGAN", thongBao: "Lý do cấp tay phải có ít nhất 10 ký tự" };
  return db.$transaction(async (tx) => {
    const q = await tx.onlEntitlement.findUnique({
      where: { studentId_courseId: { studentId: input.studentId, courseId: input.courseId } },
      select: { id: true, studentId: true, courseId: true, student: { select: { name: true } }, course: { select: { name: true, code: true, publishedVersionId: true } } },
    });
    if (!q) return { ok: false as const, ma: "KHONG_CO_QUYEN" as const, thongBao: "Học viên chưa có quyền học khoá này" };
    const da = await tx.onlCertificate.findUnique({ where: { studentId_courseId: { studentId: q.studentId, courseId: q.courseId } }, select: { status: true } });
    if (da) return { ok: false as const, ma: "DA_CO_CHUNG_NHAN" as const, thongBao: da.status === "REVOKED" ? "Học viên đã có chứng nhận (đã thu hồi) — không cấp lại bằng đường này" : "Học viên đã có chứng nhận" };
    const ban = q.course.publishedVersionId ? await tx.onlCourseVersion.findUnique({ where: { id: q.course.publishedVersionId }, select: { number: true } }) : null;
    const code = sinhMaChungNhanMoi();
    const mau = await docMauDangDung(tx, q.courseId);
    await tx.onlCertificate.create({
      data: { studentId: q.studentId, courseId: q.courseId, entitlementId: q.id, code, studentName: q.student.name, courseName: q.course.name, courseCode: q.course.code, versionNumber: ban?.number ?? 1, issuedAt: input.now, issuedByUserId: input.actorUserId, ...chupKhiCap(mau, { hoTen: q.student.name, tenKhoa: q.course.name, finalScore: null, capLuc: input.now, code }) },
    });
    return { ok: true as const, code };
  });
}

export async function thuHoiChungNhan(db: Db, input: { courseId: string; studentId: string; actorUserId: string; reason: string; now: Date }): Promise<{ ok: true } | { ok: false; ma: MaLoiCN; thongBao: string }> {
  const lyDo = input.reason.trim();
  if (lyDo.length < 10) return { ok: false, ma: "LY_DO_QUA_NGAN", thongBao: "Lý do thu hồi phải có ít nhất 10 ký tự" };
  const c = await db.onlCertificate.findUnique({ where: { studentId_courseId: { studentId: input.studentId, courseId: input.courseId } }, select: { id: true, status: true } });
  if (!c) return { ok: false, ma: "CHUNG_NHAN_KHONG_TON_TAI", thongBao: "Học viên chưa có chứng nhận khoá này" };
  if (c.status === "REVOKED") return { ok: false, ma: "DA_THU_HOI", thongBao: "Chứng nhận đã bị thu hồi" };
  await db.onlCertificate.update({ where: { id: c.id }, data: { status: "REVOKED", revokedAt: input.now, revokedReason: lyDo, revokedByUserId: input.actorUserId } });
  return { ok: true };
}

export type TraCuuChungNhan = { hopLe: true; trangThai: "ISSUED" | "REVOKED"; tenChe: string; khoa: string; maKhoa: string; capLuc: Date; soBan: number } | { hopLe: false };

/** Tra cứu CÔNG KHAI theo mã. Mã sai định dạng ⇒ không chạm DB. Che tên học viên. Chứng nhận đã thu hồi vẫn trả (trạng thái REVOKED) để người kiểm tra biết giấy không còn giá trị. */
export async function xacThucChungNhan(db: Db, code: string): Promise<TraCuuChungNhan> {
  const m = chuanHoaMaChungNhan(code);
  if (!/^[A-Z0-9]{8,32}$/.test(m)) return { hopLe: false };
  const c = await db.onlCertificate.findUnique({ where: { code: m }, select: { status: true, studentName: true, courseName: true, courseCode: true, issuedAt: true, versionNumber: true } });
  if (!c) return { hopLe: false };
  return { hopLe: true, trangThai: c.status, tenChe: cheTen(c.studentName), khoa: c.courseName, maKhoa: c.courseCode, capLuc: c.issuedAt, soBan: c.versionNumber };
}

/** Chứng nhận của MỘT con (phụ huynh xem). Sai phụ huynh ⇒ `null`. Giữ cả chứng nhận của khoá đã thu hồi quyền / đã lưu trữ. `code` là KHOÁ (tải PDF/tra cứu); `maHienThi` là chuỗi in cho người đọc (C10). */
export async function docChungNhanCuaHocVien(db: Db, input: { parentUserId: string; studentId: string }) {
  if (!(await laConCuaPhuHuynh(db, input.parentUserId, input.studentId))) return null;
  const ds = await db.onlCertificate.findMany({
    where: { studentId: input.studentId },
    orderBy: { issuedAt: "desc" },
    select: { code: true, status: true, courseName: true, courseCode: true, versionNumber: true, finalScore: true, issuedAt: true },
  });
  return ds.map((c) => ({ ...c, maHienThi: hienThiMaChungNhan(c.code) }));
}

/**
 * Danh sách chứng nhận ONLINE của MỌI khoá (màn Chứng nhận, tab "Học viên online"). Chỉ đọc, bảng `OnlCertificate` (miền Online — KHÔNG đọc `TrnCertificate`).
 * Mới nhất trước, cắt ở `take` (mặc định 200) và trả `tong` thật để màn nói "chỉ hiện N trong M".
 */
export async function docChungNhanOnlineTatCa(db: Db, input: { take?: number } = {}) {
  const take = Math.min(Math.max(input.take ?? 200, 1), 500);
  const [tong, dong] = await Promise.all([
    db.onlCertificate.count(),
    db.onlCertificate.findMany({
      orderBy: { issuedAt: "desc" },
      take,
      select: { id: true, code: true, status: true, studentName: true, courseId: true, courseName: true, courseCode: true, issuedAt: true, revokedReason: true },
    }),
  ]);
  return { tong, dong };
}

/** Danh sách chứng nhận của MỘT khoá (quản trị). */
export async function docChungNhanTrongKhoa(db: Db, input: { courseId: string; trang?: number; coTrang?: number }) {
  const coTrang = Math.min(Math.max(input.coTrang ?? 20, 1), 100);
  const trang = Math.max(input.trang ?? 1, 1);
  const [tong, dong] = await Promise.all([
    db.onlCertificate.count({ where: { courseId: input.courseId } }),
    db.onlCertificate.findMany({ where: { courseId: input.courseId }, orderBy: { issuedAt: "desc" }, skip: (trang - 1) * coTrang, take: coTrang, select: { id: true, code: true, status: true, studentId: true, studentName: true, versionNumber: true, finalScore: true, issuedAt: true, issuedByUserId: true, revokedAt: true, revokedReason: true } }),
  ]);
  return { tong, dong };
}
