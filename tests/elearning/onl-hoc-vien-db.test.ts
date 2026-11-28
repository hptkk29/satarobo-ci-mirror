// @vitest-environment node
/**
 * [ONL-HV-*] E-learning ONLINE — quản lý học viên TRONG MỘT KHOÁ (Postgres thật): nhóm theo phụ huynh · thứ tự · PII · lọc · tìm để cấp · lịch sử.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { dinhDangSdtVn, docHocVienTrongKhoa, khoaNhomPhuHuynh, lichSuQuyenHoc, timHocVienDeCap } from "../../lib/elearning-online/hoc-vien-khoa";
import { doiTrangThaiBan, taoKhoa } from "../../lib/elearning-online/khoa-hoc";
import { themBai, themChuong } from "../../lib/elearning-online/noi-dung";
import { phatHanh, xemTruocPhatHanh } from "../../lib/elearning-online/phien-ban";
import { capQuyenHoc, thuHoiQuyenHoc } from "../../lib/elearning-online/quyen-hoc-db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { donBangOnl } from "./_onl-don";

const P = "CI_ONLV_";
const T0 = new Date(Date.UTC(2026, 10, 1, 5, 0, 0));
const ngay = (d: number) => new Date(T0.getTime() + d * 86_400_000);
let n = 0;
let key = 0;
const khoaKey = (t: string) => `${P}${t}-${++key}-${Math.random().toString(36).slice(2, 8)}`;

async function don() {
  await donBangOnl(db);
  await db.student.deleteMany({ where: { name: { startsWith: P } } });
  await db.user.deleteMany({ where: { email: { startsWith: "ci-onlv-" } } });
}

async function khoaDaPhatHanh() {
  const t = await taoKhoa(db, { code: `CI-ONLV-${Date.now().toString(36).toUpperCase()}-${++n}`, name: `${P}Khoá`, listPrice: 1, salePrice: 1, validityMonths: 12, renewalEnabled: false }, null);
  if (!t.ok) throw new Error(t.thongBao);
  const c = await themChuong(db, { versionId: t.draftVersionId, title: "C" });
  if (!c.ok) throw new Error("c");
  for (const ten of ["B1", "B2"]) await themBai(db, { versionId: t.draftVersionId, chapterId: c.chapterId, kind: "READ", title: ten, contentJson: { body: "x" } });
  const xt = await xemTruocPhatHanh(db, t.courseId, null);
  if (!xt.ok) throw new Error("xt");
  const ph = await phatHanh(db, { courseId: t.courseId, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, T0);
  if (!ph.ok) throw new Error(ph.thongBao);
  await doiTrangThaiBan(db, { courseId: t.courseId, saleStatus: "ON_SALE" });
  return t.courseId;
}

async function hv(ten: string, o: { parentUserId?: string; parentName?: string; parentPhone?: string; studentCode?: string; leadId?: string } = {}) {
  return db.student.create({ data: { name: `${P}${ten}`, ...o }, select: { id: true } });
}
const cap = async (studentId: string, courseId: string, ngayCap: number, loai: "MUA" | "CAP_MIEN_PHI" = "MUA") => {
  const r = await capQuyenHoc(db, { studentId, courseId, loai, now: ngay(ngayCap), idempotencyKey: khoaKey("c"), actorUserId: loai === "CAP_MIEN_PHI" ? "adm" : null, reason: loai === "CAP_MIEN_PHI" ? "Học bổng đối tác" : undefined });
  if (!r.ok) throw new Error(r.thongBao);
  return r.entitlementId;
};
const NOW = ngay(40);

describe.skipIf(!RUN_DB_TESTS)("[ONL-HV] học viên trong khoá (Postgres thật)", () => {
  beforeAll(don, 120_000);
  afterAll(don, 120_000);

  it("[ONL-HV-01] 🔴 nhóm theo PHỤ HUYNH bằng khoá ổn định: cùng tài khoản gộp; cùng SĐT khác định dạng gộp; CÙNG TÊN khác người KHÔNG gộp", () => {
    expect(khoaNhomPhuHuynh({ id: "s1", parentUserId: "u1", parentPhone: "0905", leadId: "l1" })).toBe("u:u1");
    const a = khoaNhomPhuHuynh({ id: "s1", parentUserId: null, parentPhone: "0905123456", leadId: null });
    const b = khoaNhomPhuHuynh({ id: "s2", parentUserId: null, parentPhone: "+84 905 123 456", leadId: null });
    const c = khoaNhomPhuHuynh({ id: "s3", parentUserId: null, parentPhone: "905123456", leadId: null });
    expect(new Set([a, b, c]).size).toBe(1);
    expect(khoaNhomPhuHuynh({ id: "s4", parentUserId: null, parentPhone: "0911222333", leadId: null })).not.toBe(a);
    expect(khoaNhomPhuHuynh({ id: "s5", parentUserId: null, parentPhone: "rác", leadId: "L9" })).toBe("l:L9");
    expect(khoaNhomPhuHuynh({ id: "s6", parentUserId: null, parentPhone: null, leadId: null })).toBe("s:s6");
  });

  it("[ONL-HV-01b] SĐT hiển thị dạng 0xxx xxx xxx từ mọi định dạng lưu; rác giữ nguyên; rỗng ⇒ null", () => {
    for (const r of ["0905412118", "+84 905 412 118", "84905412118", "905412118", "(090) 541-2118"]) expect(dinhDangSdtVn(r), r).toBe("0905 412 118");
    expect(dinhDangSdtVn("  rác  ")).toBe("rác");
    expect(dinhDangSdtVn("")).toBeNull();
    expect(dinhDangSdtVn(null)).toBeNull();
  });

  it("[ONL-HV-02] 🔴 bảng nhóm: nhóm có con vào khoá GẦN NHẤT lên đầu; trong nhóm con vào mới nhất đứng trước; cùng tên phụ huynh khác SĐT là hai nhóm; không gắn phụ huynh ⇒ nhóm riêng", async () => {
    const courseId = await khoaDaPhatHanh();
    const u = await db.user.create({ data: { name: `${P}pa`, email: `ci-onlv-a-${Date.now()}@example.test`, role: "PARENT" }, select: { id: true } });
    const a1 = await hv("a1", { parentUserId: u.id, parentName: "Nguyễn Thu Hà", parentPhone: "0905412118" });
    const a2 = await hv("a2", { parentUserId: u.id, parentName: "Nguyễn Thu Hà", parentPhone: "0905412118" });
    const b1 = await hv("b1", { parentName: "Trần Quốc Việt", parentPhone: "0935220671" });
    const b2 = await hv("b2", { parentName: "Trần Q. Việt", parentPhone: "+84 935 220 671" }); // cùng SĐT khác định dạng ⇒ cùng nhóm với b1
    const c1 = await hv("c1", { parentName: "Nguyễn Thu Hà", parentPhone: "0914663005" }); // TRÙNG TÊN với nhóm A, khác người
    const d1 = await hv("d1"); // không có thông tin phụ huynh
    await cap(a1.id, courseId, 1);
    await cap(b1.id, courseId, 2);
    await cap(c1.id, courseId, 3);
    await cap(a2.id, courseId, 4); // nhóm A có con vào MUỘN NHẤT dù a1 vào sớm nhất
    await cap(b2.id, courseId, 2.5);
    await cap(d1.id, courseId, 0.5);
    const r = await docHocVienTrongKhoa(db, { courseId }, { now: NOW, xemPii: true });
    expect(r.tongNhom).toBe(4);
    expect(r.tongHocVien).toBe(6);
    expect(r.nhom.map((g) => g.hocVien.map((h) => h.tenHocVien.replace(P, "")))).toEqual([["a2", "a1"], ["c1"], ["b2", "b1"], ["d1"]]);
    expect(r.nhom[0]!.tenPhuHuynh).toBe("Nguyễn Thu Hà");
    expect(r.nhom[1]!.tenPhuHuynh).toBe("Nguyễn Thu Hà"); // hai nhóm, cùng tên, khác SĐT
    expect(r.nhom[0]!.khoaNhom).not.toBe(r.nhom[1]!.khoaNhom);
  });

  it("[ONL-HV-03] 🔴 SĐT phụ huynh chỉ đủ số khi có `onl:student:pii`; thiếu ⇒ chỉ 3 số cuối, số đầy đủ KHÔNG nằm trong dữ liệu trả về", async () => {
    const courseId = await khoaDaPhatHanh();
    const x = await hv("pii", { parentName: "Lê Mỹ Duyên", parentPhone: "0914663005" });
    await cap(x.id, courseId, 1);
    const co = await docHocVienTrongKhoa(db, { courseId }, { now: NOW, xemPii: true });
    expect(co.nhom[0]!.sdt).toBe("0914 663 005"); // dạng người Việt đọc
    const khong = await docHocVienTrongKhoa(db, { courseId }, { now: NOW, xemPii: false });
    expect(khong.nhom[0]).toMatchObject({ sdt: null, sdtChe: "••• 005" });
    expect(JSON.stringify(khong)).not.toContain("914663005");
    expect(JSON.stringify(khong)).not.toContain("0914663005");
  });

  it("[ONL-HV-04] 🔴 lọc: mặc định ẨN quyền đã thu hồi (chỉ hiện khi lọc 'Đã thu hồi'); hết hạn/sắp hết hạn/còn hạn lọc đúng; lọc theo nguồn", async () => {
    const courseId = await khoaDaPhatHanh();
    const conHan = await hv("conhan", { parentPhone: "0900000001" });
    const sapHet = await hv("saphet", { parentPhone: "0900000002" });
    const hetHan = await hv("hethan", { parentPhone: "0900000003" });
    const thuHoi = await hv("thuhoi", { parentPhone: "0900000004" });
    const mienPhi = await hv("mienphi", { parentPhone: "0900000005" });
    await cap(conHan.id, courseId, 30); // hạn 12 tháng từ ngày 30 ⇒ còn xa
    await cap(sapHet.id, courseId, 0); // 01/11/2026 + 12 tháng
    await db.onlEntitlement.updateMany({ where: { studentId: sapHet.id }, data: { expiresAt: ngay(40 + 12) } }); // còn 12 ngày
    await cap(hetHan.id, courseId, 0);
    await db.onlEntitlement.updateMany({ where: { studentId: hetHan.id }, data: { expiresAt: ngay(39) } });
    await cap(thuHoi.id, courseId, 1);
    expect((await thuHoiQuyenHoc(db, { studentId: thuHoi.id, courseId, reason: "Hoàn tiền đơn lỗi", idempotencyKey: khoaKey("th"), now: ngay(2) })).ok).toBe(true);
    await cap(mienPhi.id, courseId, 5, "CAP_MIEN_PHI");
    const ten = async (loc: object) => (await docHocVienTrongKhoa(db, { courseId, ...loc }, { now: NOW, xemPii: true })).nhom.flatMap((g) => g.hocVien.map((h) => h.tenHocVien.replace(P, ""))).sort();
    expect(await ten({})).toEqual(["conhan", "hethan", "mienphi", "saphet"]); // KHÔNG có thuhoi
    expect(await ten({ trangThai: "THU_HOI" })).toEqual(["thuhoi"]); // đối chứng dương: lọc đúng thì thấy
    expect(await ten({ trangThai: "HET_HAN" })).toEqual(["hethan"]);
    expect(await ten({ trangThai: "SAP_HET_HAN" })).toEqual(["saphet"]);
    expect(await ten({ trangThai: "CON_HAN" })).toEqual(["conhan", "mienphi"]);
    expect(await ten({ nguon: "FREE_GRANT" })).toEqual(["mienphi"]);
  });

  it("[ONL-HV-05] tìm: theo tên phụ huynh, tên/mã học viên, SĐT mọi định dạng; tìm không ra ⇒ rỗng; tiến độ x/y đếm đúng bài bắt buộc", async () => {
    const courseId = await khoaDaPhatHanh();
    const x = await hv("tim", { parentName: "Phạm Hoàng Long", parentPhone: "+84 983 045 772", studentCode: "CS2-26-ZZTMA2" });
    const e = await cap(x.id, courseId, 1);
    const baiDau = await db.onlLesson.findFirstOrThrow({ where: { chapter: { version: { courseId } }, title: "B1" }, select: { stableId: true } });
    await db.onlLessonProgress.create({ data: { entitlementId: e, lessonStableId: baiDau.stableId, status: "COMPLETED", percent: 100, completedAt: ngay(2), completedVersionNumber: 1 } });
    const tim = async (q: string) => (await docHocVienTrongKhoa(db, { courseId, q }, { now: NOW, xemPii: true })).tongHocVien;
    for (const q of ["Hoàng Long", "hoang long".replace("hoang", "Hoàng"), "0983045772", "983 045 772", "+84983045772", "ZZTMA2", `${P}tim`]) expect(await tim(q), q).toBe(1);
    expect(await tim("khongco")).toBe(0);
    const r = await docHocVienTrongKhoa(db, { courseId, q: "ZZTMA2" }, { now: NOW, xemPii: true });
    expect(r.nhom[0]!.hocVien[0]).toMatchObject({ daXong: 1, tong: 2, phanTram: 50, hoanThanh: false });
  });

  it("[ONL-HV-06] 🔴 tìm học viên để CẤP: chỉ học viên ĐÃ CÓ; cần ≥2 ký tự; đánh dấu đã có quyền; SĐT chỉ 3 số cuối; xoá mềm không lọt", async () => {
    const courseId = await khoaDaPhatHanh();
    const a = await hv("capA", { parentName: "Ba A", parentPhone: "0987654321" });
    await hv("capB", { parentName: "Ba B", parentPhone: "0987000000" });
    const daXoa = await hv("capC");
    await db.student.update({ where: { id: daXoa.id }, data: { deletedAt: ngay(1) } });
    await cap(a.id, courseId, 1);
    expect(await timHocVienDeCap(db, { courseId, q: "c" })).toEqual([]); // quá ngắn: không liệt kê cả cơ sở dữ liệu
    const r = await timHocVienDeCap(db, { courseId, q: `${P}cap` });
    expect(r.map((x) => [x.tenHocVien.replace(P, ""), x.daCoQuyen]).sort()).toEqual([["capA", true], ["capB", false]]);
    expect(JSON.stringify(r)).not.toContain("0987654321");
    expect(r.find((x) => x.tenHocVien.endsWith("capA"))?.sdtChe).toBe("••• 321");
  });

  it("[ONL-HV-07] lịch sử quyền: mới nhất trước, có người thực hiện + lý do + hạn; khoá/học viên không có quyền ⇒ null", async () => {
    const courseId = await khoaDaPhatHanh();
    const adm = await db.user.create({ data: { name: `${P}Quản trị`, email: `ci-onlv-adm-${Date.now()}@example.test`, role: "SUPER_ADMIN" }, select: { id: true } });
    const x = await hv("ls");
    await capQuyenHoc(db, { studentId: x.id, courseId, loai: "CAP_MIEN_PHI", now: ngay(1), idempotencyKey: khoaKey("1"), reason: "Tặng theo hợp đồng", actorUserId: adm.id });
    await thuHoiQuyenHoc(db, { studentId: x.id, courseId, reason: "Hết hợp đồng thử", idempotencyKey: khoaKey("2"), now: ngay(2), actorUserId: adm.id });
    const ls = await lichSuQuyenHoc(db, { courseId, studentId: x.id });
    expect(ls?.map((l) => l.kind)).toEqual(["REVOKED", "GRANTED"]);
    expect(ls?.[0]).toMatchObject({ lyDo: "Hết hợp đồng thử", nguoiThucHien: `${P}Quản trị` });
    expect(ls?.[1]).toMatchObject({ nguon: "Cấp miễn phí", thangThem: 12 });
    const y = await hv("khongquyen");
    expect(await lichSuQuyenHoc(db, { courseId, studentId: y.id })).toBeNull();
  });
});
