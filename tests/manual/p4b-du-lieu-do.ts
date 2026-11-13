// tests/manual/p4b-du-lieu-do.ts — NẠP DỮ LIỆU ĐO GIAO DIỆN P4b (bằng chứng chấm công trên Control Tower + "Công việc của tôi").
// CHỈ chạy trên DB đo local `satarobo_p3b_ui` (đã nạp `p3b-du-lieu-do.ts`). Để có buổi ĐÃ QUA thuộc SR.QD.238 khi hôm nay còn
// trước 15/10, script DỜI mốc chính sách về 01/10 TRONG DB ĐO NÀY — không bao giờ chạm DB khác.
//   DATABASE_URL=…/satarobo_p3b_ui pnpm exec tsx tests/manual/p4b-du-lieu-do.ts
import "../../scripts/_cho-phep-server-only"; // ← phải TRƯỚC mọi module có `import "server-only"`
import { db } from "@/lib/db";
import { dongBoNgay } from "@/lib/parttime/dong-bo";
import { quyetDinhNhanLop } from "@/lib/parttime/phan-cong-db";
import { laDbCucBo } from "@/lib/security/url-db-cuc-bo";

const URL = process.env.DATABASE_URL ?? "";
if (!laDbCucBo(URL) || !URL.includes("satarobo_p3b_ui")) throw new Error("Chỉ chạy trên DB đo local satarobo_p3b_ui");
const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);

async function main() {
  await db.compensationPolicyVersion.update({ where: { code: "LEGACY" }, data: { effectiveTo: new Date("2026-09-30T00:00:00Z") } });
  await db.compensationPolicyVersion.update({ where: { code: "SR.QD.238" }, data: { effectiveFrom: new Date("2026-10-01T00:00:00Z") } });
  const ou = await db.orgUnit.findFirstOrThrow({ where: { code: "CS1" }, select: { centerId: true } });
  const cs1 = ou.centerId!;
  const gv = await db.user.findFirstOrThrow({ where: { email: "uat.giaovien@satarobo.vn" }, select: { id: true } });
  const ql = await db.user.findFirstOrThrow({ where: { email: "uat.giamdoc@satarobo.vn" }, select: { id: true, name: true } });
  const khac = await db.user.findFirstOrThrow({ where: { email: "p3b.gv1@satarobo.test" }, select: { id: true } });
  const actor = { id: ql.id, name: ql.name ?? "QLCS" };
  const lop = await db.class.findMany({ where: { classCode: { startsWith: "P3B-L" } }, orderBy: { classCode: "asc" }, select: { id: true, teacherId: true, startTime: true } });

  // Tuần 05–11/10/2026: mỗi lớp một buổi, rải các ngày.
  const ngay = ["2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"];
  const buoi: { id: string; ngay: string; gio: string; teacherId: string | null }[] = [];
  for (const [i, l] of lop.entries()) {
    const gio = l.startTime ?? "17:30";
    const ngayGio = vn(ngay[i % ngay.length], gio);
    const s =
      (await db.classSession.findFirst({ where: { classId: l.id, date: ngayGio }, select: { id: true } })) ??
      (await db.classSession.create({ data: { classId: l.id, centerId: cs1, status: "SCHEDULED", date: ngayGio }, select: { id: true } }));
    buoi.push({ id: s.id, ngay: ngay[i % ngay.length], gio, teacherId: l.teacherId });
  }
  await dongBoNgay(buoi.map((b) => ({ sourceType: "CLASS_SESSION" as const, sourceId: b.id })), "TAO_BUOI", actor);
  for (const pc of await db.sessionStaffAssignment.findMany({ where: { sourceId: { in: buoi.map((b) => b.id) }, status: "WAITING_ACCEPTANCE" } })) {
    await db.$transaction((tx) => quyetDinhNhanLop(tx, { assignmentId: pc.id, nguoiBam: { id: pc.userId, name: "x" }, quyetDinh: "ACCEPTED", phienBanDaXem: pc.assignmentVersion }));
  }
  // Chốt buổi: buổi 2 thì người khác đứng lớp (để có "Sai người đứng lớp").
  for (const [i, b] of buoi.entries()) {
    await db.classSession.update({ where: { id: b.id }, data: { status: "COMPLETED", actualTeacherId: i === 1 ? khac.id : b.teacherId } });
  }
  // Lượt quẹt: mỗi người phụ trách buổi một kịch bản.
  const pcs = await db.sessionStaffAssignment.findMany({ where: { sourceId: { in: buoi.map((b) => b.id) }, status: { in: ["ACCEPTED", "ACTIVE"] } }, orderBy: { createdAt: "asc" } });
  await db.staffTimeLog.deleteMany({ where: { userId: { in: [...new Set(pcs.map((p) => p.userId))] }, workDate: { gte: new Date("2026-10-06T00:00:00Z"), lte: new Date("2026-10-11T00:00:00Z") } } });
  const quet = (userId: string, ymd: string, direction: "CHECK_IN" | "CHECK_OUT", hhmm: string, result: "ACCEPTED" | "REJECTED" = "ACCEPTED") =>
    db.staffTimeLog.create({ data: { userId, centerId: cs1, direction, loggedAt: vn(ymd, hhmm), workDate: new Date(`${ymd}T00:00:00Z`), result, rejectReason: result === "REJECTED" ? "OUTSIDE_GEOFENCE" : null, flags: [] } });
  const tru = (hhmm: string, phut: number) => {
    const [h, m] = hhmm.split(":").map(Number);
    const t = h * 60 + m - phut;
    return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  };
  for (const [i, pc] of pcs.entries()) {
    const d = pc.ngay.toISOString().slice(0, 10);
    const kichBan = i % 6;
    if (kichBan === 0) { await quet(pc.userId, d, "CHECK_IN", tru(pc.gioBatDau, 15)); await quet(pc.userId, d, "CHECK_OUT", tru(pc.gioKetThuc, -5)); } // đủ
    if (kichBan === 1) { await quet(pc.userId, d, "CHECK_IN", tru(pc.gioBatDau, 4)); await quet(pc.userId, d, "CHECK_OUT", tru(pc.gioKetThuc, -5)); } // muộn 6'
    if (kichBan === 2) { await quet(pc.userId, d, "CHECK_IN", tru(pc.gioBatDau, 15)); await quet(pc.userId, d, "CHECK_OUT", tru(pc.gioKetThuc, 30)); } // ra sớm 30'
    if (kichBan === 3) { await quet(pc.userId, d, "CHECK_IN", tru(pc.gioBatDau, 12)); } // thiếu ra
    if (kichBan === 4) { await quet(pc.userId, d, "CHECK_IN", tru(pc.gioBatDau, 15), "REJECTED"); } // bị từ chối ⇒ chưa chấm
    if (kichBan === 5) { await quet(pc.userId, d, "CHECK_IN", "08:00"); await quet(pc.userId, d, "CHECK_OUT", "11:00"); } // có mặt buổi sáng — ngoài phân công
  }
  console.log(`buổi ${buoi.length} · phân công đã nhận ${pcs.length} · GV uat có ${pcs.filter((p) => p.userId === gv.id).length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
