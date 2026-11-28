// @vitest-environment node
/**
 * [ONL-CN-ALL-*] Danh sách chứng nhận ONLINE của mọi khoá (tab "Học viên online" của màn Chứng nhận) — Postgres thật.
 * Miền Online tách bạch: chỉ đọc `OnlCertificate`; KHÔNG đọc `TrnCertificate` (đối chứng: một chứng nhận nội bộ có thật không được lọt vào).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { docChungNhanOnlineTatCa } from "../../lib/elearning-online/chung-nhan";
import { caiDatKhoiDauChoBanNhap } from "../../lib/elearning-online/cai-dat-hoc-tap";
import { doiTrangThaiBan, taoKhoa } from "../../lib/elearning-online/khoa-hoc";
import { themBai, themChuong } from "../../lib/elearning-online/noi-dung";
import { luuCaiDat, phatHanh, xemTruocPhatHanh } from "../../lib/elearning-online/phien-ban";
import { capQuyenHoc } from "../../lib/elearning-online/quyen-hoc-db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { donBangOnl } from "./_onl-don";

const P = "CI_ONLCA_";
const NOW = new Date(Date.UTC(2026, 10, 19, 5, 0, 0));
let key = 0;
const khoaKey = (t: string) => `${P}${t}-${++key}-${Math.random().toString(36).slice(2, 8)}`;
async function don() {
  await donBangOnl(db);
  await db.student.deleteMany({ where: { name: { startsWith: P } } });
}

describe.skipIf(!RUN_DB_TESTS)("[ONL-CN-ALL] chứng nhận online mọi khoá (Postgres thật)", () => {
  beforeAll(don, 120_000);
  afterAll(don, 120_000);

  it("[ONL-CN-ALL-01] 🔴 mới nhất trước, đếm đủ cả đã thu hồi, trần `take` nhưng `tong` là số thật; chỉ bảng Online (không chứng nhận nội bộ)", async () => {
    const t = await taoKhoa(db, { code: `CI-ONLCA-${Date.now().toString(36).toUpperCase()}`, name: `${P}Khoá`, listPrice: 1, salePrice: 1, validityMonths: 12, renewalEnabled: false }, null);
    if (!t.ok) throw new Error(t.thongBao);
    const c = await themChuong(db, { versionId: t.draftVersionId, title: "C" });
    if (!c.ok) throw new Error("c");
    const b = await themBai(db, { versionId: t.draftVersionId, chapterId: c.chapterId, kind: "READ", title: "B1", contentJson: { body: "x" } });
    if (!b.ok) throw new Error("b");
    await luuCaiDat(db, { versionId: t.draftVersionId, caiDat: { ...caiDatKhoiDauChoBanNhap(), moBaiTiepTheo: "MO_HET" } });
    const xt = await xemTruocPhatHanh(db, t.courseId, null);
    if (!xt.ok) throw new Error("xt");
    await phatHanh(db, { courseId: t.courseId, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, NOW);
    await doiTrangThaiBan(db, { courseId: t.courseId, saleStatus: "ON_SALE" });
    const hv = async (ten: string) => (await db.student.create({ data: { name: `${P}${ten}`, parentName: "PH", parentPhone: "0905123456" }, select: { id: true } })).id;
    const ent = async (id: string) => {
      const r = await capQuyenHoc(db, { studentId: id, courseId: t.courseId, loai: "MUA", now: NOW, idempotencyKey: khoaKey("c") });
      if (!r.ok) throw new Error(r.thongBao);
      return r.entitlementId;
    };
    const a = await hv("a");
    const x = await hv("x");
    const z = await hv("z");
    const ea = await ent(a);
    const ex = await ent(x);
    const ez = await ent(z);
    const mk = (studentId: string, entitlementId: string, code: string, issuedAt: Date, extra: Record<string, unknown> = {}) =>
      db.onlCertificate.create({ data: { studentId, courseId: t.courseId, entitlementId, code, studentName: `${P}${code}`, courseName: "K", courseCode: "K", versionNumber: 1, issuedAt, ...extra } as never });
    await mk(a, ea, "CNALLAAAAA", new Date(NOW.getTime() - 3 * 86_400_000));
    await mk(x, ex, "CNALLBBBBB", new Date(NOW.getTime() - 1 * 86_400_000), { status: "REVOKED", revokedAt: NOW, revokedReason: "Cấp nhầm học viên" });
    await mk(z, ez, "CNALLCCCCC", new Date(NOW.getTime() - 2 * 86_400_000));

    const r = await docChungNhanOnlineTatCa(db);
    expect(r.tong).toBe(3);
    expect(r.dong.map((d) => d.code)).toEqual(["CNALLBBBBB", "CNALLCCCCC", "CNALLAAAAA"]); // mới nhất trước
    expect(r.dong.find((d) => d.code === "CNALLBBBBB")).toMatchObject({ status: "REVOKED", revokedReason: "Cấp nhầm học viên" });
    const cat = await docChungNhanOnlineTatCa(db, { take: 2 });
    expect(cat.dong).toHaveLength(2);
    expect(cat.tong).toBe(3); // trần chỉ cắt dòng, KHÔNG cắt số đếm
    expect((await docChungNhanOnlineTatCa(db, { take: 0 })).dong).toHaveLength(1); // chặn dưới: take < 1 ⇒ 1
    expect(JSON.stringify(r)).not.toContain("0905123456"); // không PII phụ huynh
    expect(Object.keys(r.dong[0]!).sort()).toEqual(["code", "courseId", "courseName", "courseCode", "id", "issuedAt", "revokedReason", "status", "studentName"].sort());
  }, 120_000);
});
