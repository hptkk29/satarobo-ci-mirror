// tests/manual/p3b-du-lieu-do.ts — NẠP DỮ LIỆU ĐO GIAO DIỆN P3b (Control Tower + Công việc của tôi). CHỈ chạy trên DB đo
// RIÊNG ở máy (`satarobo_p3b_ui`) — tự chặn mọi URL khác. Bật công tắc phân công CHỈ trong DB đó.
//   DATABASE_URL=…/satarobo_p3b_ui pnpm exec tsx tests/manual/p3b-du-lieu-do.ts
import "../../scripts/_cho-phep-server-only"; // ← phải TRƯỚC mọi module có `import "server-only"`
import { db } from "@/lib/db";
import { dongBoNgay } from "@/lib/parttime/dong-bo";
import { quyetDinhNhanLop } from "@/lib/parttime/phan-cong-db";
import { laDbCucBo } from "@/lib/security/url-db-cuc-bo";

const URL = process.env.DATABASE_URL ?? "";
if (!laDbCucBo(URL) || !URL.includes("satarobo_p3b_ui")) throw new Error("Chỉ chạy trên DB đo local satarobo_p3b_ui");

const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);

async function main() {
  // Bốn công tắc Parttime BẬT toàn hệ thống (chỉ DB local).
  for (const key of ["shift.parttimeStaffingEnabled", "shift.parttimeAttendanceContextEnabled", "shift.parttimeWorkUnitShadowEnabled", "shift.parttimeCompensationEnabled"]) {
    await db.systemSetting.upsert({ where: { key }, update: { valueJson: true }, create: { key, valueJson: true, updatedByName: "Đo giao diện P3b (local)" } });
  }
  const ou = await db.orgUnit.findFirstOrThrow({ where: { code: "CS1" }, select: { centerId: true } });
  const cs1 = ou.centerId!;
  const gv = await db.user.findFirstOrThrow({ where: { email: "uat.giaovien@satarobo.vn" }, select: { id: true } });
  const ql = await db.user.findFirstOrThrow({ where: { email: "uat.giamdoc@satarobo.vn" }, select: { id: true, name: true } });
  const actor = { id: ql.id, name: ql.name ?? "QLCS" };
  const ten = ["Nguyễn Thị Thanh Hương", "Trần Hoàng Bảo Ngọc", "Lê Phước Minh Khang", "Phạm Ngọc Diễm Quỳnh", "Võ Trần Thiên Long"];
  const gvs = [gv.id];
  for (const [i, t] of ten.entries()) {
    const u = await db.user.upsert({
      where: { email: `p3b.gv${i}@satarobo.test` },
      update: {},
      create: { email: `p3b.gv${i}@satarobo.test`, name: t, role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs1 },
      select: { id: true },
    });
    gvs.push(u.id);
  }
  const khoa = await db.course.upsert({ where: { slug: "p3b-sata-4" }, update: {}, create: { name: "Sata 4 — Lập trình Robot nâng cao (EV3)", slug: "p3b-sata-4" }, select: { id: true } });
  const phong = await Promise.all(
    ["P302 — Phòng Robot lớn", "P201", "P105 — Lab thi đấu"].map((n, i) =>
      db.room.upsert({ where: { id: `p3b-room-${i}` }, update: {}, create: { id: `p3b-room-${i}`, name: n, code: `P3B-${i}`, centerId: cs1 }, select: { id: true } }),
    ),
  );
  const tenLop = [
    "Sata 4 — Thứ 2/4 · 17h30 · Hoàng Diệu (lớp tăng cường thi đấu RoboSim)",
    "Sata 3 — Thứ 3/5 · 18h00",
    "Sata 5 — Cuối tuần · 08h00 · Lớp chuyên đề cảm biến",
    "Sata 4 — Thứ 7 · 14h00",
    "Sata 6 — Chủ nhật · 09h45 · Lớp luyện thi Quốc gia",
    "Sata 3 — Thứ 6 · 17h30",
  ];
  const ngay = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];
  const nguon: { sourceType: "CLASS_SESSION"; sourceId: string }[] = [];
  for (const [i, n] of tenLop.entries()) {
    const lop = await db.class.upsert({
      where: { classCode: `P3B-L${i}` },
      update: {},
      create: {
        classCode: `P3B-L${i}`,
        name: n,
        courseId: khoa.id,
        centerId: cs1,
        teacherId: gvs[i % gvs.length],
        assistantId: i % 2 === 0 ? gvs[(i + 2) % gvs.length] : null,
        roomId: phong[i % phong.length].id,
        startTime: i % 2 ? "18:00" : "17:30",
        endTime: i % 2 ? "19:30" : "19:00",
      },
      select: { id: true },
    });
    if (i === 3) {
      await db.classStaffingRequirement.upsert({
        where: { classId: lop.id },
        update: {},
        create: { classId: lop.id, centerId: cs1, taRequired: true, reason: "Lớp đông, cần thêm trợ giảng", decidedById: ql.id },
      });
    }
    for (const d of [ngay[i % 7], ngay[(i + 3) % 7]]) {
      const ngayGio = vn(d, i % 2 ? "18:00" : "17:30");
      const s =
        (await db.classSession.findFirst({ where: { classId: lop.id, date: ngayGio }, select: { id: true } })) ??
        (await db.classSession.create({ data: { classId: lop.id, centerId: cs1, status: "SCHEDULED", date: ngayGio }, select: { id: true } }));
      nguon.push({ sourceType: "CLASS_SESSION", sourceId: s.id });
    }
  }
  const r = await dongBoNgay(nguon, "TAO_BUOI", actor);
  console.log(`đồng bộ: ${r.soNguon} buổi · ${r.soBuoc} bước · lỗi ${r.loi.length}`);
  // Một phần đã nhận, một lượt từ chối — để màn có đủ trạng thái.
  const pcs = await db.sessionStaffAssignment.findMany({ where: { centerId: cs1, status: "WAITING_ACCEPTANCE" }, orderBy: { ngay: "asc" } });
  for (const [i, pc] of pcs.entries()) {
    if (i % 3 === 2) continue;
    const quyet = i === 4 ? "DECLINED" : "ACCEPTED";
    await db.$transaction((tx) =>
      quyetDinhNhanLop(tx, { assignmentId: pc.id, nguoiBam: { id: pc.userId, name: "x" }, quyetDinh: quyet, phienBanDaXem: pc.assignmentVersion, lyDo: quyet === "DECLINED" ? "Trùng lịch thi cuối kỳ ở trường" : null }),
    );
  }
  console.log(`phân công: ${pcs.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
