// @vitest-environment node
/** [ONL-BC-*] Báo cáo tổng hợp Online (Postgres thật): số liệu đúng · KHÔNG PII · không tiền · cùng luật tiến độ với màn học viên. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { docBaoCaoKhoa, docBaoCaoTongQuan } from "../../lib/elearning-online/bao-cao";
import { caiDatKhoiDauChoBanNhap } from "../../lib/elearning-online/cai-dat-hoc-tap";
import { doiTrangThaiBan, taoKhoa } from "../../lib/elearning-online/khoa-hoc";
import { themBai, themChuong } from "../../lib/elearning-online/noi-dung";
import { luuCaiDat, phatHanh, xemTruocPhatHanh } from "../../lib/elearning-online/phien-ban";
import { capQuyenHoc, thuHoiQuyenHoc } from "../../lib/elearning-online/quyen-hoc-db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { donBangOnl } from "./_onl-don";

const P = "CI_ONLB_";
const NOW = new Date(Date.UTC(2026, 10, 19, 5, 0, 0));
let key = 0;
const khoaKey = (t: string) => `${P}${t}-${++key}-${Math.random().toString(36).slice(2, 8)}`;
async function don() {
  await donBangOnl(db);
  await db.student.deleteMany({ where: { name: { startsWith: P } } });
}

describe.skipIf(!RUN_DB_TESTS)("[ONL-BC] báo cáo Online (Postgres thật)", () => {
  beforeAll(don, 120_000);
  afterAll(don, 120_000);

  it("[ONL-BC-01] 🔴 số liệu đúng: trạng thái quyền (suy từ hạn), nguồn, % trung bình trên quyền HIỆU LỰC, hoàn thành, chứng nhận, quyền mới theo tháng giờ VN, điểm đề", async () => {
    const t = await taoKhoa(db, { code: `CI-ONLB-${Date.now().toString(36).toUpperCase()}`, name: `${P}Khoá`, listPrice: 1, salePrice: 1, validityMonths: 12, renewalEnabled: false }, null);
    if (!t.ok) throw new Error(t.thongBao);
    const c = await themChuong(db, { versionId: t.draftVersionId, title: "C" });
    if (!c.ok) throw new Error("c");
    const bai = [] as string[];
    for (const ten of ["B1", "B2"]) {
      const r = await themBai(db, { versionId: t.draftVersionId, chapterId: c.chapterId, kind: "READ", title: ten, contentJson: { body: "x" } });
      if (!r.ok) throw new Error("b");
      bai.push(r.stableId);
    }
    await luuCaiDat(db, { versionId: t.draftVersionId, caiDat: { ...caiDatKhoiDauChoBanNhap(), moBaiTiepTheo: "MO_HET" } });
    const xt = await xemTruocPhatHanh(db, t.courseId, null);
    if (!xt.ok) throw new Error("xt");
    await phatHanh(db, { courseId: t.courseId, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, NOW);
    await doiTrangThaiBan(db, { courseId: t.courseId, saleStatus: "ON_SALE" });
    const hv = async (ten: string) => (await db.student.create({ data: { name: `${P}${ten}`, parentName: "Phụ huynh bí mật", parentPhone: "0905123456" }, select: { id: true } })).id;
    const cap = async (id: string, loai: "MUA" | "CAP_MIEN_PHI", luc = NOW) => {
      const r = await capQuyenHoc(db, { studentId: id, courseId: t.courseId, loai, now: luc, idempotencyKey: khoaKey("c") });
      if (!r.ok) throw new Error(r.thongBao);
      return r.entitlementId;
    };
    const xong = (e: string, b: string) => db.onlLessonProgress.create({ data: { entitlementId: e, lessonStableId: b, status: "COMPLETED", percent: 100, completedAt: NOW, completedVersionNumber: 1 } });

    const a = await hv("a");
    const ea = await cap(a, "MUA");
    await xong(ea, bai[0]!);
    await xong(ea, bai[1]!); // hoàn thành 100%
    const b = await hv("b");
    const eb = await cap(b, "CAP_MIEN_PHI");
    await xong(eb, bai[0]!); // 50%
    await db.onlEntitlement.update({ where: { id: eb }, data: { expiresAt: new Date(NOW.getTime() + 10 * 86_400_000) } }); // sắp hết hạn
    const cc = await hv("c");
    const ec = await cap(cc, "MUA");
    await db.onlEntitlement.update({ where: { id: ec }, data: { expiresAt: new Date(NOW.getTime() - 86_400_000) } }); // hết hạn
    const d = await hv("d");
    await cap(d, "MUA");
    await thuHoiQuyenHoc(db, { studentId: d, courseId: t.courseId, reason: "Hoàn tiền theo yêu cầu", idempotencyKey: khoaKey("th"), now: NOW });
    // chứng nhận cho a + một giấy đã thu hồi cho c
    await db.onlCertificate.create({ data: { studentId: a, courseId: t.courseId, entitlementId: ea, code: "AAAAAAAAAA", studentName: `${P}a`, courseName: "K", courseCode: "K", versionNumber: 1, issuedAt: NOW } });
    await db.onlCertificate.create({ data: { studentId: cc, courseId: t.courseId, entitlementId: ec, code: "BBBBBBBBBB", status: "REVOKED", revokedAt: NOW, revokedReason: "Cấp nhầm học viên", studentName: `${P}c`, courseName: "K", courseCode: "K", versionNumber: 1, issuedAt: NOW } });
    // một đề + hai lượt đã chấm (một đạt 100, một không đạt 40)
    const as = await db.onlAssessment.create({ data: { courseId: t.courseId, kind: "QUIZ", title: "Kiểm tra 1", passPercent: 70, status: "ACTIVE" }, select: { id: true } });
    for (const [num, diem, dat] of [[1, 100, true], [2, 40, false]] as const) {
      await db.onlAttempt.create({ data: { assessmentId: as.id, entitlementId: ea, studentId: a, lessonStableId: bai[0]!, number: num, status: "GRADED", startedAt: NOW, snapshotJson: {}, scorePercent: diem, passed: dat, gradedAt: NOW } });
    }

    const r = await docBaoCaoKhoa(db, t.courseId, NOW);
    expect(r).toMatchObject({
      tongQuyen: 4,
      theoTrangThai: { CON_HAN: 1, SAP_HET_HAN: 1, HET_HAN: 1, THU_HOI: 1 },
      theoNguon: { muaKhoa: 3, capMienPhi: 1 },
      daHoanThanh: 1, // chỉ a
      tienDoTrungBinh: 75, // (100 + 50) / 2 trên quyền hiệu lực
      chungNhan: { hieuLuc: 1, daThuHoi: 1 },
    });
    expect(r!.quyenMoiTheoThang).toEqual([{ thang: "2026-11", so: 4 }]);
    expect(r!.deThi).toEqual([{ tieuDe: "Kiểm tra 1", loai: "QUIZ", soLuot: 2, tiLeDat: 50, diemTrungBinh: 70 }]);

    // 🔴 KHÔNG PII, KHÔNG id học viên, KHÔNG tiền
    const json = JSON.stringify(r);
    for (const cam of [`${P}a`, "Phụ huynh bí mật", "0905123456", a, b, cc, ea, eb, ec, "AAAAAAAAAA", "price", "Price", "doanhThu"]) expect(json.includes(cam), cam).toBe(false);

    // tổng quan: dòng của khoá + không PII
    const tq = await docBaoCaoTongQuan(db, NOW);
    const dong = tq.find((x) => x.courseId === t.courseId);
    expect(dong).toMatchObject({ quyenHieuLuc: 2, tongQuyen: 4, chungNhan: 1, daPhatHanh: true, saleStatus: "ON_SALE" });
    expect(JSON.stringify(tq)).not.toContain("0905123456");
    expect(await docBaoCaoKhoa(db, "khong-co", NOW)).toBeNull();
  });

  it("[ONL-BC-02] khoá chưa phát hành / chưa có quyền: tiến độ trung bình = null, số 0 — không chia cho 0, không ném lỗi", async () => {
    const t = await taoKhoa(db, { code: `CI-ONLB-RONG-${Date.now().toString(36).toUpperCase()}`, name: `${P}Rỗng`, listPrice: 1, salePrice: 1, validityMonths: 1, renewalEnabled: false }, null);
    if (!t.ok) throw new Error("t");
    expect(await docBaoCaoKhoa(db, t.courseId, NOW)).toMatchObject({ tongQuyen: 0, daHoanThanh: 0, tienDoTrungBinh: null, deThi: [], quyenMoiTheoThang: [], chungNhan: { hieuLuc: 0, daThuHoi: 0 } });
  });
});
