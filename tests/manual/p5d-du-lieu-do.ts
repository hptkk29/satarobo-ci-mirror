// tests/manual/p5d-du-lieu-do.ts — NẠP DỮ LIỆU ĐO GIAO DIỆN P5d (màn Công parttime tháng + Công tháng của tôi).
// CHỈ chạy trên DB đo local `satarobo_p3b_ui`, SAU `p3b-du-lieu-do.ts` + `p4b-du-lieu-do.ts` (tuần 05–11/10, chính sách đã dời
// về 01/10 trong DB đo này). Xác nhận mọi dòng xác nhận được (có lý do), giao + xác nhận một ca trực, dựng khoản trừ đề xuất.
//   DATABASE_URL=…/satarobo_p3b_ui pnpm exec tsx tests/manual/p5d-du-lieu-do.ts
import "../../scripts/_cho-phep-server-only"; // ← phải TRƯỚC mọi module có `import "server-only"`
import { db } from "@/lib/db";
import { dongBoDeXuat } from "@/lib/parttime/dieu-chinh-db";
import { docTrucCoSo, giaoTruc, quyetDinhTruc, xacNhanTruc } from "@/lib/parttime/truc-van-hanh-db";
import { docDoiSoatThucHien, xacNhanThucHien } from "@/lib/parttime/workunit-db";
import { laDbCucBo } from "@/lib/security/url-db-cuc-bo";

const URL = process.env.DATABASE_URL ?? "";
if (!laDbCucBo(URL) || !URL.includes("satarobo_p3b_ui")) throw new Error("Chỉ chạy trên DB đo local satarobo_p3b_ui");
const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);

async function main() {
  const cs1 = (await db.orgUnit.findFirstOrThrow({ where: { code: "CS1" }, select: { centerId: true } })).centerId!;
  const ql = await db.user.findFirstOrThrow({ where: { email: "uat.giamdoc@satarobo.vn" }, select: { id: true, name: true } });
  const gv = await db.user.findFirstOrThrow({ where: { email: "uat.giaovien@satarobo.vn" }, select: { id: true } });
  const actor = { id: ql.id, name: ql.name ?? "QLCS" };
  const now = vn("2026-10-14", "12:00");

  // Ca trực tối cho GV uat vào ngày GV có đúng một buổi trong tuần đo (dữ liệu p4b) — ⇒ 0,5 ca.
  const pcGv = await db.sessionStaffAssignment.findMany({ where: { userId: gv.id, centerId: cs1, ngay: { gte: new Date("2026-10-06T00:00:00Z"), lte: new Date("2026-10-11T00:00:00Z") } }, select: { ngay: true } });
  const ngayTruc = pcGv[0]?.ngay.toISOString().slice(0, 10) ?? "2026-10-07";
  if (!(await db.operationsDutyAssignment.findFirst({ where: { userId: gv.id, workDate: new Date(`${ngayTruc}T00:00:00Z`), shiftCode: "T" } }))) {
    const g = await db.$transaction((tx) => giaoTruc(tx, { userId: gv.id, centerId: cs1, ngay: ngayTruc, shiftCode: "T", note: "Dữ liệu đo P5d", actor }));
    if (!g.ok) throw new Error(g.loi);
    await db.$transaction((tx) => quyetDinhTruc(tx, { dutyId: g.id, nguoiBam: { id: gv.id, name: "GV" }, quyetDinh: "ACCEPTED", phienBanDaXem: 1, lyDo: null, now: vn(ngayTruc, "07:00") }));
  }
  // Một ca trực CHƯA nhận, ngày mai — để màn GV có thẻ "Ca trực chờ bạn xác nhận".
  const mai = "2026-10-15";
  if (!(await db.operationsDutyAssignment.findFirst({ where: { userId: gv.id, workDate: new Date(`${mai}T00:00:00Z`), shiftCode: "C" } }))) {
    const g = await db.$transaction((tx) => giaoTruc(tx, { userId: gv.id, centerId: cs1, ngay: mai, shiftCode: "C", note: "Dữ liệu đo P5d", actor }));
    if (!g.ok) throw new Error(g.loi);
  }

  // Xác nhận thực hiện mọi dòng xác nhận được (QLCS là người khác người dạy ⇒ bỏ dòng của chính QLCS).
  const ds = await docDoiSoatThucHien({ centerId: cs1, tu: "2026-10-01", den: "2026-10-31", now });
  let xn = 0;
  for (const r of ds.dong) {
    if ((r.ungVien.lop !== "TU_DONG" && r.ungVien.lop !== "XEM_TAY") || r.donVi || r.bc.userId === ql.id) continue;
    const k = await xacNhanThucHien({ assignmentId: r.bc.assignmentId, phienBanDaXem: r.bc.assignmentVersion, dauVanDaXem: r.bc.dauVan, quyetDinh: "CONFIRMED", lyDo: "Dữ liệu đo P5d — QLCS đã kiểm", hangLoat: false, actor, now });
    if (k.ok) xn++;
  }
  for (const t of await docTrucCoSo({ centerId: cs1, tu: "2026-10-01", den: "2026-10-31", now })) {
    if (t.danhGia.lop === "TU_DONG" && !t.donVi) await xacNhanTruc({ dutyId: t.dutyId, phienBanDaXem: t.phienBan, dauVanDaXem: t.dauVan, quyetDinh: "CONFIRMED", lyDo: null, hangLoat: false, actor, now });
  }
  // Một buổi đứng chính đã xác nhận: có học viên có mặt mà chưa nhận xét ⇒ quá 10:00 hôm sau ⇒ đề xuất -30.000đ.
  const mainLop = await db.workUnit.findFirst({ where: { centerId: cs1, workUnitType: "MAIN_TEACHING", status: "CONFIRMED", sourceType: "CLASS_SESSION" }, select: { sourceId: true } });
  const hv = (await db.student.findFirst({ where: { name: "P5D học viên đo" }, select: { id: true } })) ?? (await db.student.create({ data: { name: "P5D học viên đo", centerId: cs1 }, select: { id: true } }));
  if (mainLop?.sourceId && hv && !(await db.attendance.findFirst({ where: { sessionId: mainLop.sourceId, studentId: hv.id } }))) {
    await db.attendance.create({ data: { sessionId: mainLop.sourceId, studentId: hv.id, status: "PRESENT" } });
  }
  const dx = await dongBoDeXuat({ centerId: cs1, tu: "2026-10-01", den: "2026-10-31", now, actor });
  console.log(`xác nhận ${xn} dòng · ca trực ${ngayTruc} · đề xuất mới ${dx.tao}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
