// prisma/seed-cham-cong-uat.ts — dữ liệu nghiệm thu CHẤM CÔNG cho đúng các tài khoản `uat.*`.
//
// Được gọi ở cuối `prisma/seed-cham-cong-demo.ts` (bước mà workflow `seed-test-data.yml` đã chạy sẵn), nên KHÔNG cần
// sửa workflow. Chạy tay trên máy: `pnpm exec tsx prisma/seed-cham-cong-demo.ts --nguoi=1` (DB local).
//
// ── Ba nhóm, và vì sao mỗi nhóm đi qua hàm THẬT ───────────────────────────────────────────────────────────────────
//   1. NHÂN SỰ CA THƯỜNG — `layNhanSuUat()` đưa mọi nhân sự UAT vào khối của script demo (khung ca → lưới → lượt quét →
//      công ngày). Script demo chọn "N người đầu theo mã NV" nên không đảm bảo có UAT; hàm này chặn việc đó.
//   2. GV PARTTIME CHẤM THEO PHÂN CÔNG (từ 01/11/2026) — `uat.giaovien` được đặt `contractType = PARTTIME`, có một lớp
//      riêng (id `uat-cc-lop-pt-cs1`), các buổi ở nhiều tình huống, phân công đi qua `phanCongVaoBuoi` (cửa tạo DUY NHẤT
//      của app), lượt quét + tính công đi qua `recomputeAttendanceDay`.
//   3. ĐƠN TỪ — nộp bằng `submitAttendanceRequest`, duyệt/từ chối bằng `decideRequest` (đúng hàm màn Đơn từ gọi), để đơn
//      có `effectVersion` + `appliedEffect` và thật sự chảy vào bảng công. Seed UAT cũ chèn thẳng `WorkRequest` nên đơn
//      không bao giờ tác động lưới.
//
// ── Chốt chặn (luật của chủ dự án: KHÔNG dựng giờ quét giả cho nhân sự thật, KHÔNG nộp đơn thay nhân sự thật) ─────
// Mọi lượt quét / đơn / phân công trong file này chỉ ghi cho người có email thuộc `emailUatTatCa()`. `chiChoUat()` NÉM
// LỖI nếu gặp người ngoài danh sách — đó là cổng thật, không phải chú thích.
//
// ── Idempotent ────────────────────────────────────────────────────────────────────────────────────────────────────
// Id cố định tiền tố `uat-cc-`; đơn từ nhận diện bằng tiền tố lý do `[UAT-CC] <mã>`; lượt quét bỏ qua (người × ngày) đã có.
// Chạy lại không đẻ thêm dòng.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { emailUatTatCa } from "./seed-uat/00-tai-khoan";
import { loadCenterMap } from "@/lib/cham-cong/home-center";
import { recomputeAttendanceDay } from "@/lib/cham-cong/recompute";
import { getOrCreatePeriod } from "@/lib/cham-cong/period";
import { decideRequest, submitAttendanceRequest } from "@/lib/cham-cong/requests";
import { huyPhanCongCuaBuoi, phanCongVaoBuoi } from "@/lib/parttime/phan-cong-db";
import { docBangChungCuaToi } from "@/lib/parttime/bang-chung-cong-db";
import { vnDateAt, vnDateOnly, vnParts, vnYmd } from "@/lib/time/vn";

export const GV_PARTTIME_UAT_EMAIL = "uat.giaovien@satarobo.vn";
const GV_EMAIL = GV_PARTTIME_UAT_EMAIL;
const DAU_LUOT_UAT = "UAT_CC";
const QLCS_EMAIL = "uat.giamdoc@satarobo.vn";
const ADMIN_EMAIL = "uat.admin@satarobo.vn";
const TIEN_TO_DON = "[UAT-CC]";
const LOP_PT_ID = "uat-cc-lop-pt-cs1";

type NguoiUat = { userId: string; email: string; ten: string; employeeId: string | null; centerIdNhanSu: string | null };

// ─── Chốt chặn: chỉ UAT ───────────────────────────────────────────────────────────────────────────────────────────

let uatIds: Set<string> | null = null;
async function tapUserUat(): Promise<Set<string>> {
  if (uatIds) return uatIds;
  const u = await db.user.findMany({ where: { email: { in: emailUatTatCa() } }, select: { id: true } });
  uatIds = new Set(u.map((x) => x.id));
  return uatIds;
}
/** NÉM nếu có người KHÔNG thuộc tài khoản UAT — mọi phép ghi dữ liệu thử đi qua cổng này trước khi ghi. */
async function chiChoUat(userIds: readonly string[]): Promise<void> {
  const uat = await tapUserUat();
  const la = userIds.filter((id) => !uat.has(id));
  if (la.length > 0) throw new Error(`seed-cham-cong-uat: ${la.length} người KHÔNG thuộc tài khoản uat.* — dừng, không ghi dữ liệu thử cho nhân sự thật.`);
}

/** Nhân sự (có hồ sơ + tài khoản) của các tài khoản UAT — để script demo luôn đưa họ vào lưới ca. Bỏ GV parttime (xem nhóm 2). */
export async function layNhanSuUat(): Promise<NguoiUat[]> {
  const u = await db.user.findMany({
    where: { email: { in: emailUatTatCa() }, employeeId: { not: null }, isActive: true },
    select: { id: true, email: true, name: true, employeeId: true, employee: { select: { fullName: true, centerId: true, isActive: true, status: true } } },
    orderBy: { email: "asc" },
  });
  return u
    .filter((x) => x.email !== GV_EMAIL && x.employee?.isActive && x.employee.status === "ACTIVE")
    .map((x) => ({ userId: x.id, email: x.email ?? "", ten: x.employee?.fullName ?? x.name ?? "UAT", employeeId: x.employeeId, centerIdNhanSu: x.employee?.centerId ?? null }));
}

const pad = (n: number) => String(n).padStart(2, "0");

// ─── Nhóm 2 · GV parttime chấm theo phân công ────────────────────────────────────────────────────────────────────

type KichBan = "DU" | "HUY" | "MUON" | "QUEN_RA" | "VE_SOM" | "KHONG_QUET" | "CHUA_HOAN_TAT";
/** Ngày trong tháng → tình huống (khi ngày đã qua). Ngày chưa tới chỉ được phân công, chưa có gì khác. */
const BUOI_QUA: { ngay: number; kb: KichBan }[] = [
  { ngay: 3, kb: "DU" },
  { ngay: 4, kb: "HUY" },
  { ngay: 5, kb: "MUON" },
  { ngay: 6, kb: "QUEN_RA" },
  { ngay: 7, kb: "VE_SOM" },
  { ngay: 8, kb: "KHONG_QUET" },
  { ngay: 9, kb: "CHUA_HOAN_TAT" },
];
const BUOI_TUONG_LAI = [12, 13, 14, 17, 19, 21, 24];

const GIO_VAO_LOP = "18:00";
const GIO_RA_LOP = "19:30";

function gio(y: number, m0: number, d: number, hhmm: string, lech = 0): Date {
  const [h, mi] = hhmm.split(":").map(Number);
  return vnDateAt(y, m0, d, h!, mi! + lech);
}

function luotCuaKichBan(kb: KichBan): { dir: "CHECK_IN" | "CHECK_OUT"; hhmm: string; lech: number }[] {
  switch (kb) {
    case "DU":
    case "CHUA_HOAN_TAT":
      return [{ dir: "CHECK_IN", hhmm: "18:00", lech: -16 }, { dir: "CHECK_OUT", hhmm: "19:30", lech: 6 }];
    case "MUON":
      return [{ dir: "CHECK_IN", hhmm: "18:00", lech: 14 }, { dir: "CHECK_OUT", hhmm: "19:30", lech: 5 }];
    case "QUEN_RA":
      return [{ dir: "CHECK_IN", hhmm: "18:00", lech: -16 }];
    case "VE_SOM":
      return [{ dir: "CHECK_IN", hhmm: "18:00", lech: -16 }, { dir: "CHECK_OUT", hhmm: "19:30", lech: -25 }];
    case "KHONG_QUET":
    case "HUY":
      return [];
  }
}

async function seedGvParttime(ctx: { centerCs1: string; orgUnitCs1: string | null }): Promise<{ trangThai: Record<string, number>; soBuoi: number; soLuot: number } | null> {
  const [gv, qlcs] = await Promise.all([
    db.user.findUnique({ where: { email: GV_EMAIL }, select: { id: true, name: true, employeeId: true } }),
    db.user.findUnique({ where: { email: QLCS_EMAIL }, select: { id: true, name: true } }),
  ]);
  if (!gv || !qlcs) {
    console.log("[uat-cc] GV parttime: thiếu uat.giaovien / uat.giamdoc — bỏ qua (chạy db:seed:uat trước).");
    return null;
  }
  await chiChoUat([gv.id, qlcs.id]);

  // 1. Loại hợp đồng — điều kiện cần của `chamTheoPhanCong`. Không đặt thì Bảng công GV vẫn chạy luật ô ca.
  if (gv.employeeId) {
    await db.employee.update({ where: { id: gv.employeeId }, data: { contractType: "PARTTIME" } });
  } else {
    console.log("[uat-cc] ⚠️ uat.giaovien không có hồ sơ nhân sự — không đặt được contractType PARTTIME.");
  }

  // 2. Tháng dựng dữ liệu: tháng hiện tại, nhưng không sớm hơn 11/2026 (luật chấm theo phân công chỉ từ 01/11/2026).
  const hienTai = vnParts(new Date());
  let y = hienTai.year;
  let m0 = hienTai.month; // 0-based
  if (y < 2026 || (y === 2026 && m0 < 10)) {
    y = 2026;
    m0 = 10;
  }
  const homNayYmd = vnYmd(new Date());
  const ymd = (d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;
  const quaRoi = (d: number) => ymd(d) < homNayYmd;

  // 3. Lớp riêng — id cố định, KHÔNG đụng lớp UAT khác.
  const khoa = await db.course.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!khoa) {
    console.log("[uat-cc] GV parttime: chưa có khoá học nào — bỏ qua.");
    return null;
  }
  await db.class.upsert({
    where: { id: LOP_PT_ID },
    update: {},
    create: {
      id: LOP_PT_ID,
      classCode: "UAT-CC-PT-CS1",
      name: "UAT chấm công — Lớp giáo viên parttime (CS1)",
      courseId: khoa.id,
      centerId: ctx.centerCs1,
      teacherId: gv.id,
      schedule: "UAT — buổi tối",
      startTime: GIO_VAO_LOP,
      endTime: GIO_RA_LOP,
      startDate: gio(y, m0, 1, "00:00"),
      endDate: gio(y, m0, 28, "00:00"),
      maxStudents: 12,
      minStudents: 6,
      status: "ACTIVE",
      isActive: true,
    },
  });

  const nguoiThaoTac = { id: qlcs.id, name: qlcs.name ?? "Quản lý cơ sở (UAT)" };
  const tatCa = [...BUOI_QUA.map((b) => ({ ngay: b.ngay, kb: quaRoi(b.ngay) ? b.kb : null })), ...BUOI_TUONG_LAI.map((n) => ({ ngay: n, kb: quaRoi(n) ? ("DU" as KichBan) : null }))];

  const luotMoi: Prisma.StaffTimeLogCreateManyInput[] = [];
  const ngayCanTinh = new Set<string>();
  let soBuoi = 0;

  // Lượt quét giờ hành chính do bản seed cũ của script demo sinh cho tài khoản này (khi nó còn bị xếp ca thường) sẽ làm
  // sai bằng chứng của tiết 18:00. Không xoá dòng nào: chuyển sang DISMISSED — trạng thái sẵn có "đã bị thay thế, giữ để
  // xem, không còn tính công" (`LUOT_CON_TINH`). Lượt do chính file này sinh mang `verifyMethod = UAT_CC` nên được giữ.
  const cuaThang = { gte: new Date(Date.UTC(y, m0, 1)), lte: new Date(Date.UTC(y, m0 + 1, 0)) };
  const luotCu = await db.staffTimeLog.findMany({
    where: { userId: gv.id, workDate: cuaThang, reviewStatus: { not: "DISMISSED" }, OR: [{ verifyMethod: null }, { verifyMethod: { not: DAU_LUOT_UAT } }] },
    select: { id: true, workDate: true },
  });
  if (luotCu.length > 0) {
    await db.staffTimeLog.updateMany({
      where: { id: { in: luotCu.map((l) => l.id) } },
      data: { reviewStatus: "DISMISSED", reviewedAt: new Date(), reviewNote: `${TIEN_TO_DON} thay bằng kịch bản chấm theo phân công` },
    });
    for (const l of luotCu) ngayCanTinh.add(vnYmd(l.workDate));
  }

  for (const [i, b] of tatCa.entries()) {
    const id = `uat-cc-buoi-${ymd(b.ngay)}`;
    await db.classSession.upsert({
      where: { id },
      update: {},
      create: { id, classId: LOP_PT_ID, date: gio(y, m0, b.ngay, GIO_VAO_LOP), topic: `Buổi UAT ${i + 1}`, centerId: ctx.centerCs1, status: "SCHEDULED" },
    });
    soBuoi += 1;

    // Phân công qua CỬA DUY NHẤT của app. Phải làm TRƯỚC khi buổi đóng — cổng từ chối buổi đã kết thúc.
    const nguon = { sourceType: "CLASS_SESSION" as const, sourceId: id };
    const daCo = await db.sessionStaffAssignment.findFirst({
      where: { ...nguon, userId: gv.id, role: "MAIN_TEACHER", status: { in: ["ACCEPTED", "ACTIVE", "COMPLETED", "WAITING_ACCEPTANCE"] } },
      select: { id: true },
    });
    // Chỉ phân công khi buổi còn mở. Buổi đã chốt/huỷ ở lượt chạy trước thì cửa tạo từ chối — đúng luật, không phải lỗi.
    const buoiHienTai = await db.classSession.findUnique({ where: { id }, select: { status: true } });
    if (!daCo && buoiHienTai?.status === "SCHEDULED") {
      const r = await db.$transaction((tx) =>
        phanCongVaoBuoi(tx, { nguon, userId: gv.id, role: "MAIN_TEACHER", assignmentType: "REGULAR", nguonGiao: "TAY", actor: nguoiThaoTac, note: `${TIEN_TO_DON} dữ liệu nghiệm thu` }),
      );
      if (!r.ok) {
        console.log(`[uat-cc]   ${ymd(b.ngay)}: không phân công được — ${r.loi}`);
        continue;
      }
    }
    if (!b.kb) continue; // buổi chưa tới: chỉ có phân công

    // Kết cục của buổi — chỉ chuyển trạng thái khi buổi còn SCHEDULED (chạy lại không đảo lại).
    const ngayDate = vnDateOnly(gio(y, m0, b.ngay, "12:00"));
    if (b.kb === "HUY") {
      const upd = await db.classSession.updateMany({ where: { id, status: "SCHEDULED" }, data: { status: "CANCELLED" } });
      if (upd.count > 0) {
        await db.$transaction((tx) => huyPhanCongCuaBuoi(tx, { nguon, actor: nguoiThaoTac, lyDo: `${TIEN_TO_DON} buổi bị huỷ` }));
      }
    } else if (b.kb !== "CHUA_HOAN_TAT") {
      await db.classSession.updateMany({
        where: { id, status: "SCHEDULED" },
        data: { status: "COMPLETED", completedAt: gio(y, m0, b.ngay, "19:40"), ckAttendance: true, ckLessonConfirmed: true },
      });
    }

    // Lượt quét — chỉ cho GV UAT, bỏ qua nếu ngày đó đã có lượt (chạy lại KHÔNG nhân đôi).
    const daCoLuot = await db.staffTimeLog.count({ where: { userId: gv.id, workDate: ngayDate, verifyMethod: DAU_LUOT_UAT, reviewStatus: { not: "DISMISSED" } } });
    if (daCoLuot === 0) {
      for (const l of luotCuaKichBan(b.kb)) {
        luotMoi.push({
          userId: gv.id,
          centerId: ctx.centerCs1,
          orgUnitId: ctx.orgUnitCs1,
          direction: l.dir,
          loggedAt: gio(y, m0, b.ngay, l.hhmm, l.lech),
          workDate: ngayDate,
          source: "KIOSK",
          result: "ACCEPTED",
          reviewStatus: "CONFIRMED",
          verifyMethod: DAU_LUOT_UAT,
        });
      }
    }
    ngayCanTinh.add(ymd(b.ngay));
  }

  if (luotMoi.length > 0) {
    await chiChoUat([...new Set(luotMoi.map((l) => l.userId))]);
    await db.staffTimeLog.createMany({ data: luotMoi });
  }
  // Ngày công là nửa đêm UTC của ngày VN (cột `@db.Date`) — đúng dạng script demo truyền từ `ShiftAssignment.workDate`.
  for (const n of ngayCanTinh) await recomputeAttendanceDay(gv.id, new Date(`${n}T00:00:00.000Z`));
  await getOrCreatePeriod(ctx.centerCs1, `${y}-${pad(m0 + 1)}` as `${number}-${number}`);

  // Tự kiểm: đọc lại bằng chứng đúng như màn "Công việc của tôi" đọc.
  const bc = await docBangChungCuaToi({ userId: gv.id, tu: ymd(1), den: ymd(28), now: new Date() });
  const trangThai: Record<string, number> = {};
  for (const r of bc) trangThai[r.trangThai] = (trangThai[r.trangThai] ?? 0) + 1;
  return { trangThai, soBuoi, soLuot: luotMoi.length };
}

// ─── Nhóm 3 · Đơn từ ─────────────────────────────────────────────────────────────────────────────────────────────

type Khai = {
  ma: string;
  email: string;
  kind: "LEAVE" | "TIMESHEET_FIX" | "OUTSIDE_ATTENDANCE" | "OT" | "REMOTE";
  /** "tuong-lai" | "qua-khu": chọn một ngày làm việc có ô ca theo lưới của người nộp. */
  huong: "tuong-lai" | "qua-khu";
  chonThu: number;
  ketCuc: "CHO" | "DUYET" | "TU_CHOI";
  lyDo: string;
  nguoiDuyet?: "qlcs" | "admin";
  chonCoSo?: "CS1" | "CS2";
  /** Mặc định NGHI_PHEP (trừ quỹ phép năm). KHONG_LUONG không trừ quỹ — dùng cho đơn cần DUYỆT được trên DB bật sổ phép mà quỹ còn 0. */
  loaiNghi?: "NGHI_PHEP" | "KHONG_LUONG";
};

const DON: Khai[] = [
  { ma: "sale1-nghi-kl-duyet", email: "uat.sale1@satarobo.vn", kind: "LEAVE", loaiNghi: "KHONG_LUONG", huong: "tuong-lai", chonThu: 1, ketCuc: "DUYET", lyDo: "Nghỉ không lương — việc gia đình", nguoiDuyet: "qlcs" },
  { ma: "sale1-nghi-cho", email: "uat.sale1@satarobo.vn", kind: "LEAVE", huong: "tuong-lai", chonThu: 3, ketCuc: "CHO", lyDo: "Nghỉ phép năm — đi khám sức khoẻ" },
  { ma: "sale1-tuxa-cho", email: "uat.sale1@satarobo.vn", kind: "REMOTE", huong: "tuong-lai", chonThu: 5, ketCuc: "CHO", lyDo: "Làm từ xa — chờ thợ sửa nhà" },
  { ma: "sale2-chinhcong-duyet", email: "uat.sale2@satarobo.vn", kind: "TIMESHEET_FIX", huong: "qua-khu", chonThu: 1, ketCuc: "DUYET", lyDo: "Quên quét giờ vào — đã có mặt từ 08:00", nguoiDuyet: "admin" },
  { ma: "sale2-nghi-tuchoi", email: "uat.sale2@satarobo.vn", kind: "LEAVE", huong: "tuong-lai", chonThu: 1, ketCuc: "TU_CHOI", lyDo: "Nghỉ phép năm — đi du lịch", nguoiDuyet: "admin" },
  { ma: "giaovu-ngoai-cho", email: "uat.giaovu@satarobo.vn", kind: "OUTSIDE_ATTENDANCE", huong: "tuong-lai", chonThu: 2, ketCuc: "CHO", lyDo: "Chấm công ngoài điểm — dự hội thảo giáo dục" },
  { ma: "giaovu-ot-toi-duyet", email: "uat.giaovu@satarobo.vn", kind: "OT", huong: "tuong-lai", chonThu: 7, ketCuc: "DUYET", lyDo: "Tăng ca — chuẩn bị học liệu khai giảng", nguoiDuyet: "qlcs" },
  { ma: "nhansu-chinhcong-cho", email: "uat.nhansu@satarobo.vn", kind: "TIMESHEET_FIX", huong: "qua-khu", chonThu: 2, ketCuc: "CHO", lyDo: "Quên quét giờ ra — rời văn phòng 17:30", chonCoSo: "CS1" },
];

async function seedDonTu(ctx: { coSo: Record<string, string> }): Promise<{ nop: number; duyet: number; tuChoi: number; bo: string[] }> {
  const [qlcs, admin, loaiNghiDb] = await Promise.all([
    db.user.findUnique({ where: { email: QLCS_EMAIL }, select: { id: true, name: true } }),
    db.user.findUnique({ where: { email: ADMIN_EMAIL }, select: { id: true, name: true } }),
    db.leaveType.findMany({ where: { code: { in: ["NGHI_PHEP", "KHONG_LUONG"] } }, select: { id: true, code: true } }),
  ]);
  const kq = { nop: 0, duyet: 0, tuChoi: 0, bo: [] as string[] };
  if (!qlcs || !admin) {
    kq.bo.push("thiếu uat.giamdoc / uat.admin");
    return kq;
  }
  const homNay = vnDateOnly(new Date());

  for (const k of DON) {
    const nguoi = await db.user.findUnique({ where: { email: k.email }, select: { id: true } });
    if (!nguoi) {
      kq.bo.push(`${k.ma}: không có tài khoản ${k.email}`);
      continue;
    }
    await chiChoUat([nguoi.id]);
    const lyDo = `${TIEN_TO_DON} ${k.ma} — ${k.lyDo}`;
    const daCo = await db.workRequest.findFirst({ where: { requesterId: nguoi.id, reason: { startsWith: `${TIEN_TO_DON} ${k.ma} ` } }, select: { id: true } });
    if (daCo) continue;

    // Chọn ngày: ô ca ACTIVE là ngày làm việc thật của người nộp (không phải ô nghỉ).
    const o = await db.shiftAssignment.findMany({
      where: {
        userId: nguoi.id,
        status: "ACTIVE",
        isLeave: false,
        attendanceMode: "REQUIRED",
        workDate: k.huong === "tuong-lai" ? { gt: new Date(homNay.getTime() + 2 * 86_400_000) } : { lt: homNay },
      },
      orderBy: { workDate: k.huong === "tuong-lai" ? "asc" : "desc" },
      take: k.chonThu + 1,
      select: { workDate: true },
    });
    const ngay = o[k.chonThu]?.workDate ?? o[o.length - 1]?.workDate;
    if (!ngay) {
      kq.bo.push(`${k.ma}: ${k.email} chưa có ô ca ${k.huong === "tuong-lai" ? "sắp tới" : "đã qua"} — chạy lưới ca trước`);
      continue;
    }

    const r = await submitAttendanceRequest({
      requesterId: nguoi.id,
      kind: k.kind,
      fromDate: ngay,
      toDate: ngay,
      // OT: 21:30–23:00 nằm NGOÀI mọi mã ca (ca muộn nhất kết thúc 21:00) — khung trong giờ ca bị từ chối "đã là công thường".
      startTime: k.kind === "OT" ? "21:30" : k.kind === "OUTSIDE_ATTENDANCE" ? "08:00" : null,
      endTime: k.kind === "OT" ? "23:00" : k.kind === "OUTSIDE_ATTENDANCE" ? "17:00" : null,
      hours: k.kind === "OT" ? 1.5 : null,
      className: null,
      classId: null,
      targetUserId: null,
      requesterNewTemplateId: null,
      targetNewTemplateId: null,
      leaveTypeId: k.kind === "LEAVE" ? (loaiNghiDb.find((l) => l.code === (k.loaiNghi ?? "NGHI_PHEP"))?.id ?? null) : null,
      requestedInAt: k.kind === "TIMESHEET_FIX" ? "08:00" : null,
      requestedOutAt: k.kind === "TIMESHEET_FIX" ? "17:00" : null,
      requestedIn2At: null,
      requestedOut2At: null,
      leaveDurationType: k.kind === "LEAVE" ? "FULL_DAY" : null,
      chosenCenterId: k.chonCoSo ? (ctx.coSo[k.chonCoSo] ?? null) : null,
      detail: k.kind === "OUTSIDE_ATTENDANCE" ? "Trung tâm hội nghị — Đà Nẵng" : null,
      reason: lyDo,
    });
    if (!r.ok) {
      kq.bo.push(`${k.ma}: ${r.error}`);
      continue;
    }
    kq.nop += 1;
    if (k.ketCuc === "CHO") continue;

    const duyet = k.nguoiDuyet === "admin" ? admin : qlcs;
    const d = await decideRequest({
      requestId: r.id,
      decision: k.ketCuc === "DUYET" ? "APPROVED" : "REJECTED",
      note: k.ketCuc === "DUYET" ? "Đồng ý (dữ liệu nghiệm thu UAT)" : "Trùng đợt cao điểm tuyển sinh (dữ liệu nghiệm thu UAT)",
      actor: { id: duyet.id, name: duyet.name ?? "Người duyệt UAT" },
      canWriteCenter: () => true,
    });
    if (!d.ok) {
      kq.bo.push(`${k.ma}: nộp được nhưng duyệt lỗi — ${d.error}`);
      continue;
    }
    if (k.ketCuc === "DUYET") kq.duyet += 1;
    else kq.tuChoi += 1;
  }
  return kq;
}

// ─── Điểm vào ────────────────────────────────────────────────────────────────────────────────────────────────────

export async function seedChamCongUat(): Promise<void> {
  console.log("\n[uat-cc] ── Dữ liệu chấm công cho tài khoản uat.* ──");
  const map = await loadCenterMap();
  const cs1 = map.byCode["CS1"];
  if (!cs1) {
    console.log("[uat-cc] Không có cơ sở CS1 — bỏ qua phần GV parttime.");
  } else {
    const gv = await seedGvParttime({ centerCs1: cs1.centerId, orgUnitCs1: cs1.orgUnitId ?? null });
    if (gv) console.log(`[uat-cc] GV parttime: ${gv.soBuoi} buổi · +${gv.soLuot} lượt quét · bằng chứng đọc lại: ${JSON.stringify(gv.trangThai)}`);
  }
  const coSo: Record<string, string> = {};
  for (const [code, c] of Object.entries(map.byCode)) coSo[code] = c.centerId;
  const d = await seedDonTu({ coSo });
  console.log(`[uat-cc] Đơn từ: +${d.nop} nộp · ${d.duyet} duyệt · ${d.tuChoi} từ chối${d.bo.length ? ` · BỎ QUA ${d.bo.length}:` : ""}`);
  for (const b of d.bo) console.log(`[uat-cc]   - ${b}`);
}
