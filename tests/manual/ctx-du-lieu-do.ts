// tests/manual/ctx-du-lieu-do.ts — NẠP DỮ LIỆU ĐO GIAO DIỆN màn "Chấm công" có ngữ cảnh Parttime (một nút). CHỈ chạy trên DB đo
// RIÊNG ở máy (`satarobo_p3b_ui`) — tự chặn mọi URL khác. Ghi ra tệp (KHÔNG in) hai đường dẫn có vé QR tĩnh để đo.
//   DATABASE_URL=…/satarobo_p3b_ui OUT_FILE=… pnpm exec tsx --env-file=.env.local tests/manual/ctx-du-lieu-do.ts
//
// ⚠️ Màn chấm công đọc giờ THẬT của máy chủ. Hôm đo có thể còn trước 15/10/2026 (ngày LEGACY ⇒ không ngữ cảnh), nên script DỜI
// ngày hiệu lực của SR.QD.238 về HÔM NAY — CHỈ trong DB đo này, không bao giờ ở DB nào khác (chặn bằng tên DB ở trên).
import "../../scripts/_cho-phep-server-only"; // ← phải TRƯỚC mọi module có `import "server-only"`
import { writeFileSync } from "node:fs";
import { db } from "@/lib/db";
import { dongBoNgay } from "@/lib/parttime/dong-bo";
import { quyetDinhNhanLop } from "@/lib/parttime/phan-cong-db";
import { giaoTruc, quyetDinhTruc } from "@/lib/parttime/truc-van-hanh-db";
import { makeStaticKioskToken } from "@/lib/cham-cong/kiosk-token";
import { getSigningSecret } from "@/lib/security/signing-key";
import { laDbCucBo } from "@/lib/security/url-db-cuc-bo";
import { vnYmd } from "@/lib/time/vn";

const URL = process.env.DATABASE_URL ?? "";
if (!laDbCucBo(URL) || !URL.includes("satarobo_p3b_ui")) throw new Error("Chỉ chạy trên DB đo local satarobo_p3b_ui");
const OUT = process.env.OUT_FILE ?? "";
if (!OUT) throw new Error("thiếu OUT_FILE");

const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);

async function main() {
  const homNay = vnYmd(new Date());
  const z = new Date(`${homNay}T00:00:00Z`);
  await db.systemSetting.upsert({ where: { key: "shift.phanCongNhanLopBat" }, update: { valueJson: true }, create: { key: "shift.phanCongNhanLopBat", valueJson: true, updatedByName: "Đo giao diện ngữ cảnh (local)" } });
  await db.compensationPolicyVersion.update({ where: { code: "LEGACY" }, data: { effectiveTo: new Date(z.getTime() - 86_400_000) } }); // effectiveTo tính CẢ ngày ⇒ hôm qua
  await db.compensationPolicyVersion.update({ where: { code: "SR.QD.238" }, data: { effectiveFrom: z } });

  const ou = await db.orgUnit.findFirstOrThrow({ where: { code: "CS1" }, select: { centerId: true } });
  const cs1 = ou.centerId!;
  const gv = await db.user.findFirstOrThrow({ where: { email: "uat.giaovien@satarobo.vn" }, select: { id: true, name: true } });
  const ql = await db.user.findFirstOrThrow({ where: { email: "uat.giamdoc@satarobo.vn" }, select: { id: true, name: true } });
  const actor = { id: ql.id, name: ql.name ?? "QLCS" };
  const wl = await db.workLocation.upsert({
    where: { code: "CTX-DO-CS1" },
    update: { isActive: true, geofenceEnabled: false },
    create: { code: "CTX-DO-CS1", name: "Quầy lễ tân — 211 Nguyễn Hữu Thọ", centerId: cs1, geofenceEnabled: false },
    select: { id: true, qrKeyVersion: true },
  });

  // GV: hai tiết hôm nay (đứng chính 18:00–19:30 + trợ giảng 19:45–21:15) ⇒ thẻ "GIÁO VIÊN ĐỨNG CHÍNH" + "Sau đó".
  const khoa = await db.course.upsert({ where: { slug: "ctx-do-sata-4" }, update: {}, create: { name: "Sata 4 — Lập trình Robot nâng cao (EV3)", slug: "ctx-do-sata-4" }, select: { id: true } });
  const nguon: { sourceType: "CLASS_SESSION"; sourceId: string }[] = [];
  for (const x of [
    { ma: "CTX-L1", ten: "SATA4-HD-T4-1800", tu: "18:00", den: "19:30", teacherId: gv.id, assistantId: null as string | null },
    { ma: "CTX-L2", ten: "SATA3-HD-T4-1945", tu: "19:45", den: "21:15", teacherId: ql.id, assistantId: gv.id },
  ]) {
    const lop = await db.class.upsert({
      where: { classCode: x.ma },
      update: {},
      create: { classCode: x.ma, name: x.ten, courseId: khoa.id, centerId: cs1, teacherId: x.teacherId, assistantId: x.assistantId, startTime: x.tu, endTime: x.den },
      select: { id: true },
    });
    const ngayGio = vn(homNay, x.tu);
    const s =
      (await db.classSession.findFirst({ where: { classId: lop.id, date: ngayGio }, select: { id: true } })) ??
      (await db.classSession.create({ data: { classId: lop.id, centerId: cs1, status: "SCHEDULED", date: ngayGio }, select: { id: true } }));
    nguon.push({ sourceType: "CLASS_SESSION", sourceId: s.id });
  }
  const r = await dongBoNgay(nguon, "TAO_BUOI", actor);
  console.log(`đồng bộ: ${r.soNguon} buổi · lỗi ${r.loi.length}`);
  for (const pc of await db.sessionStaffAssignment.findMany({ where: { userId: gv.id, ngay: z, status: "WAITING_ACCEPTANCE" } })) {
    await db.$transaction((tx) => quyetDinhNhanLop(tx, { assignmentId: pc.id, nguoiBam: { id: gv.id, name: gv.name ?? "GV" }, quyetDinh: "ACCEPTED", phienBanDaXem: pc.assignmentVersion }));
  }

  // QLCS (màn admin): CHỈ một ca trực T hôm nay, đã nhận ⇒ ngữ cảnh "Ca trực".
  const daCo = await db.operationsDutyAssignment.findFirst({ where: { userId: ql.id, workDate: z, status: { not: "CANCELLED" } }, select: { id: true } });
  if (!daCo) {
    const g = await db.$transaction((tx) => giaoTruc(tx, { userId: ql.id, centerId: cs1, ngay: homNay, shiftCode: "T", note: "Đo giao diện", actor }));
    if (!g.ok) throw new Error(g.loi);
    const d = await db.operationsDutyAssignment.findUniqueOrThrow({ where: { id: g.id } });
    const q = await db.$transaction((tx) => quyetDinhTruc(tx, { dutyId: d.id, nguoiBam: { id: ql.id, name: ql.name ?? "QL" }, quyetDinh: "ACCEPTED", phienBanDaXem: d.assignmentVersion, lyDo: null, now: new Date() }));
    if (!q.ok) throw new Error(q.loi);
  }

  // GV_TRUC=1 ⇒ GV có thêm ca trực T hôm nay (đã nhận) ⇒ ngữ cảnh MIXED.
  if (process.env.GV_TRUC === "1" && !(await db.operationsDutyAssignment.findFirst({ where: { userId: gv.id, workDate: z, status: { not: "CANCELLED" } }, select: { id: true } }))) {
    const g = await db.$transaction((tx) => giaoTruc(tx, { userId: gv.id, centerId: cs1, ngay: homNay, shiftCode: "T", note: "Đo giao diện MIXED", actor }));
    if (!g.ok) throw new Error(g.loi);
    const d = await db.operationsDutyAssignment.findUniqueOrThrow({ where: { id: g.id } });
    const q = await db.$transaction((tx) => quyetDinhTruc(tx, { dutyId: d.id, nguoiBam: { id: gv.id, name: gv.name ?? "GV" }, quyetDinh: "ACCEPTED", phienBanDaXem: d.assignmentVersion, lyDo: null, now: new Date() }));
    if (!q.ok) throw new Error(q.loi);
  }

  const t = makeStaticKioskToken(wl.id, wl.qrKeyVersion, getSigningSecret());
  const q = `w=${encodeURIComponent(wl.id)}&t=${encodeURIComponent(t)}`;
  writeFileSync(OUT, JSON.stringify({ gv: `/teacher/cham-cong/checkin?${q}`, ql: `/admin/cham-cong/checkin?${q}`, q }));
  console.log(`đã ghi đường dẫn đo vào tệp (${homNay})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
