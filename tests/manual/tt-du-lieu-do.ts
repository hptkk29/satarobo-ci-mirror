// tests/manual/tt-du-lieu-do.ts — NẠP DỮ LIỆU ĐO GIAO DIỆN tuân thủ buổi dạy (hồ sơ buổi: điểm danh + nhận xét học viên). CHỈ chạy trên
// DB đo RIÊNG ở máy (`satarobo_p3b_ui`, đã nạp `ctx-du-lieu-do.ts`) — tự chặn mọi URL khác.
//   DATABASE_URL=…/satarobo_p3b_ui RBAC_V2_ENABLED=true pnpm exec tsx --env-file=.env.local tests/manual/tt-du-lieu-do.ts
//
// Dựng theo GIỜ THẬT (màn đọc đồng hồ máy chủ):
//   · Buổi ĐÃ DẠY hôm qua 19:00–20:30 (GV uat.giaovien đứng chính): 9 học viên, điểm danh 8/9 (7 có mặt + 1 vắng), nhận xét 5/7 ⇒
//     Control Tower / Đã qua / báo cáo: "Điểm danh 8/9", "Nhận xét 5/7 — quá hạn" (nếu đã qua 10:00 hôm nay) hoặc "còn trong hạn".
//   · Buổi ĐANG DIỄN RA hôm nay (bắt đầu 20 phút trước, 90 phút): 9 học viên, GV đã chấm vào, CHƯA điểm danh ai ⇒ thẻ Chấm công nhắc
//     "Cần điểm danh học viên" + lối tắt "Điểm danh lớp".
import "../../scripts/_cho-phep-server-only"; // ← phải TRƯỚC mọi module có `import "server-only"`
import { db } from "@/lib/db";
import { dongBoNgay } from "@/lib/parttime/dong-bo";
import { quyetDinhNhanLop } from "@/lib/parttime/phan-cong-db";
import { laDbCucBo } from "@/lib/security/url-db-cuc-bo";
import { vnYmd } from "@/lib/time/vn";

const URL = process.env.DATABASE_URL ?? "";
if (!laDbCucBo(URL) || !URL.includes("satarobo_p3b_ui")) throw new Error("Chỉ chạy trên DB đo local satarobo_p3b_ui");

const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);
const hhmm = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" });
const ngayDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

async function main() {
  const now = new Date();
  const homNay = vnYmd(now);
  const homQua = new Date(ngayDate(homNay).getTime() - 86_400_000).toISOString().slice(0, 10);
  // Bắt đầu 20 phút trước (làm tròn 5'); sát nửa đêm thì kẹp về 00:05 hôm nay (buổi không vắt qua hai ngày).
  const som = vn(homNay, "00:05");
  const batDau = new Date(Math.max(Math.floor((now.getTime() - 20 * 60_000) / 300_000) * 300_000, som.getTime()));
  if (batDau.getTime() >= now.getTime()) throw new Error("Chưa tới 00:05 giờ VN — chạy lại sau ít phút");
  const ketThuc = new Date(batDau.getTime() + 90 * 60_000);

  const ou = await db.orgUnit.findFirstOrThrow({ where: { code: "CS1" }, select: { centerId: true } });
  const cs1 = ou.centerId!;
  const gv = await db.user.findFirstOrThrow({ where: { email: "uat.giaovien@satarobo.vn" }, select: { id: true, name: true } });
  const ql = await db.user.findFirstOrThrow({ where: { email: "uat.giamdoc@satarobo.vn" }, select: { id: true, name: true } });
  const actor = { id: ql.id, name: ql.name ?? "QLCS" };
  const khoa = await db.course.upsert({ where: { slug: "tt-do-sata-3" }, update: {}, create: { name: "Sata 3 — Robot (đo hồ sơ buổi)", slug: "tt-do-sata-3" }, select: { id: true } });
  const hv: string[] = [];
  for (let i = 1; i <= 9; i++) {
    const ten = `Học viên đo ${i}`;
    hv.push(((await db.student.findFirst({ where: { name: ten, centerId: cs1 }, select: { id: true } })) ?? (await db.student.create({ data: { name: ten, centerId: cs1 }, select: { id: true } }))).id);
  }

  // Bộ đồng bộ đọc đồng hồ THẬT và không dựng phân công cho buổi đã qua giờ bắt đầu ⇒ buổi chưa có phân công được dựng ở NGÀY MAI (đồng bộ
  // + nhận), rồi dời CẢ buổi lẫn ảnh chụp phân công về đúng ngày (cùng giờ — ảnh chụp không lệch lịch buổi). Chỉ DB đo.
  const ngayMai = new Date(ngayDate(homNay).getTime() + 86_400_000).toISOString().slice(0, 10);
  const buoi = async (ma: string, ten: string, ngay: string, tu: string, den: string) => {
    const lop = await db.class.upsert({
      where: { classCode: ma },
      update: {},
      create: { classCode: ma, name: ten, courseId: khoa.id, centerId: cs1, teacherId: gv.id, startTime: tu, endTime: den },
      select: { id: true },
    });
    for (const h of hv) {
      if (!(await db.enrollment.findFirst({ where: { classId: lop.id, studentId: h }, select: { id: true } }))) {
        await db.enrollment.create({ data: { classId: lop.id, studentId: h, courseId: khoa.id, centerId: cs1, status: "ACTIVE" } });
      }
    }
    const s =
      (await db.classSession.findFirst({ where: { classId: lop.id, date: vn(ngay, tu) }, select: { id: true } })) ??
      (await db.classSession.create({ data: { classId: lop.id, centerId: cs1, status: "SCHEDULED", date: vn(ngay, tu) }, select: { id: true } }));
    if (!(await db.sessionStaffAssignment.findFirst({ where: { sourceId: s.id }, select: { id: true } }))) {
      await db.classSession.update({ where: { id: s.id }, data: { date: vn(ngayMai, tu), status: "SCHEDULED", actualTeacherId: null } });
      const r = await dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: s.id }], "TAO_BUOI", actor);
      if (r.loi.length) throw new Error(`đồng bộ lỗi: ${JSON.stringify(r.loi)}`);
      for (const pc of await db.sessionStaffAssignment.findMany({ where: { sourceId: s.id, status: "WAITING_ACCEPTANCE", userId: gv.id } })) {
        await db.$transaction((tx) => quyetDinhNhanLop(tx, { assignmentId: pc.id, nguoiBam: { id: gv.id, name: gv.name ?? "GV" }, quyetDinh: "ACCEPTED", phienBanDaXem: pc.assignmentVersion }));
      }
      await db.classSession.update({ where: { id: s.id }, data: { date: vn(ngay, tu) } });
      await db.sessionStaffAssignment.updateMany({ where: { sourceId: s.id }, data: { ngay: ngayDate(ngay) } });
    }
    if (!(await db.sessionStaffAssignment.findFirst({ where: { sourceId: s.id, userId: gv.id }, select: { id: true } }))) {
      throw new Error("Không dựng được phân công — kiểm RBAC_V2_ENABLED=true và công tắc STAFFING của DB đo");
    }
    return s.id;
  };
  const quet = async (ngay: string, direction: "CHECK_IN" | "CHECK_OUT", luc: Date) => {
    if (!(await db.staffTimeLog.findFirst({ where: { userId: gv.id, direction, loggedAt: luc }, select: { id: true } }))) {
      await db.staffTimeLog.create({ data: { userId: gv.id, centerId: cs1, direction, loggedAt: luc, workDate: ngayDate(ngay), result: "ACCEPTED" } });
    }
  };

  // 1) Buổi đã dạy hôm qua — 8/9 điểm danh, 5/7 nhận xét.
  const s1 = await buoi("TT-DO-L1", "SATA3-TT-1900", homQua, "19:00", "20:30");
  await db.classSession.update({ where: { id: s1 }, data: { status: "COMPLETED", actualTeacherId: gv.id } });
  await quet(homQua, "CHECK_IN", vn(homQua, "18:48"));
  await quet(homQua, "CHECK_OUT", vn(homQua, "20:35"));
  for (const [i, st] of hv.slice(0, 8).map((h, i) => [i, i === 7 ? "ABSENT" : "PRESENT"] as const)) {
    await db.attendance.upsert({ where: { sessionId_studentId: { sessionId: s1, studentId: hv[i] } }, update: {}, create: { sessionId: s1, studentId: hv[i], status: st, centerId: cs1 } });
  }
  for (const h of hv.slice(0, 5)) {
    await db.studentSessionFeedback.upsert({
      where: { classSessionId_studentId: { classSessionId: s1, studentId: h } },
      update: {},
      create: { classSessionId: s1, studentId: h, createdById: gv.id, comment: "Đo giao diện", createdAt: vn(homQua, "21:10") },
    });
  }

  // 2) Buổi đang diễn ra hôm nay — đã chấm vào, chưa điểm danh ai.
  await buoi("TT-DO-L2", "SATA3-TT-DANG-DAY", homNay, hhmm(batDau), hhmm(ketThuc));
  const vao = new Date(Math.max(batDau.getTime() - 12 * 60_000, vn(homNay, "00:01").getTime()));
  await quet(homNay, "CHECK_IN", vao);
  console.log(`đã nạp: buổi hôm qua ${homQua} 19:00 · buổi đang dạy ${homNay} ${hhmm(batDau)}–${hhmm(ketThuc)}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
