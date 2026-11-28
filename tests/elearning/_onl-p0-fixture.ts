// @vitest-environment node
/** Fixture P0 Mobile: khoá Online có MỘT bài QUIZ (4 câu tự động, tuỳ chọn thêm tự luận/sản phẩm), giới hạn lượt + thời gian, học viên có quyền học. Postgres thật. */
import { db } from "../../lib/db";
import { caiDatKhoiDauChoBanNhap } from "../../lib/elearning-online/cai-dat-hoc-tap";
import { luuCauHoi, luuDeThi } from "../../lib/elearning-online/danh-gia-db";
import { doiTrangThaiBan, taoKhoa } from "../../lib/elearning-online/khoa-hoc";
import { themBai, themChuong } from "../../lib/elearning-online/noi-dung";
import { luuCaiDat, phatHanh, xemTruocPhatHanh } from "../../lib/elearning-online/phien-ban";
import { capQuyenHoc } from "../../lib/elearning-online/quyen-hoc-db";
import { donBangOnl } from "./_onl-don";

export const P0 = "CI_ONLP0_";
export const T0 = new Date(Date.UTC(2026, 10, 21, 5, 0, 0));
export const sau = (giay: number, goc: Date = T0) => new Date(goc.getTime() + giay * 1000);
let n = 0;

export async function donP0() {
  await donBangOnl(db);
  await db.student.deleteMany({ where: { name: { startsWith: P0 } } });
  await db.user.deleteMany({ where: { email: { startsWith: "ci-onlp0-" } } });
}

export type KhoaP0 = Awaited<ReturnType<typeof dungKhoaP0>>;

export async function dungKhoaP0(o: { maxAttempts?: number | null; timeLimitMin?: number | null; tuLuan?: boolean; sanPham?: boolean; passPercent?: number } = {}) {
  const maxAttempts = o.maxAttempts === undefined ? 3 : o.maxAttempts;
  const timeLimitMin = o.timeLimitMin === undefined ? 2 : o.timeLimitMin;
  const t = await taoKhoa(db, { code: `CI-ONLP0-${Date.now().toString(36).toUpperCase()}-${++n}`, name: `${P0}Khoá ${n}`, listPrice: 1, salePrice: 1, validityMonths: 12, renewalEnabled: false }, null);
  if (!t.ok) throw new Error(t.thongBao);
  const cau = async (input: object) => {
    const r = await luuCauHoi(db, { courseId: t.courseId, ...input, explanation: "GIAI-THICH-BI-MAT" } as never, "u");
    if (!r.ok) throw new Error(r.thongBao);
    return r.id;
  };
  const q = {
    chonMot: await cau({ type: "SINGLE_CHOICE", stem: "1+1=?", options: [{ id: "a", text: "2" }, { id: "b", text: "3" }], correct: "a" }),
    dungSai: await cau({ type: "TRUE_FALSE", stem: "Robot có động cơ?", correct: true }),
    ngan: await cau({ type: "SHORT_TEXT", stem: "Thủ đô VN?", accepted: ["Hà Nội"] }),
    nhapSo: await cau({ type: "NUMERIC", stem: "2+3=?", cauHinh: { answer: 5, tolerance: 0 } }),
    ...(o.tuLuan ? { tuLuan: await cau({ type: "ESSAY", stem: "Mô tả robot", points: 4 }) } : {}),
    ...(o.sanPham ? { sanPham: await cau({ type: "PRODUCT", stem: "Quay video", points: 4, cauHinh: { accept: ["VIDEO"], maxMb: 50, maxVideoSec: 60 } }) } : {}),
  } as Record<string, string>;
  const de = await luuDeThi(db, { courseId: t.courseId, kind: "QUIZ", title: "Kiểm tra P0", passPercent: o.passPercent ?? 50, status: "ACTIVE", maxAttempts, timeLimitMin, cau: Object.values(q).map((questionId) => ({ questionId })) }, "u");
  if (!de.ok) throw new Error(de.thongBao);
  const ch = await themChuong(db, { versionId: t.draftVersionId, title: "C1" });
  if (!ch.ok) throw new Error("chuong");
  const b = await themBai(db, { versionId: t.draftVersionId, chapterId: ch.chapterId, kind: "QUIZ", title: "Q", contentJson: { assessmentId: de.id } });
  if (!b.ok) throw new Error(b.thongBao);
  const l = await luuCaiDat(db, { versionId: t.draftVersionId, caiDat: { ...caiDatKhoiDauChoBanNhap(), moBaiTiepTheo: "MO_HET" as const, xemKetQua: "CA_DAP_AN_SAU_HET_LUOT" as const } });
  if (!l.ok) throw new Error(l.thongBao);
  const xt = await xemTruocPhatHanh(db, t.courseId, null);
  if (!xt.ok) throw new Error(xt.thongBao);
  const ph = await phatHanh(db, { courseId: t.courseId, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, T0);
  if (!ph.ok) throw new Error(ph.thongBao);
  await doiTrangThaiBan(db, { courseId: t.courseId, saleStatus: "ON_SALE" });
  const k = { courseId: t.courseId, lessonStableId: b.stableId, assessmentId: de.id, q };
  const hv = await themHocVienP0(k, "chinh");
  return { ...k, ...hv, themHocVien: (ten: string) => themHocVienP0(k, ten) };
}

export async function themHocVienP0(k: { courseId: string; lessonStableId: string }, ten: string) {
  const ph = await db.user.create({ data: { name: `${P0}ph-${ten}`, email: `ci-onlp0-${ten}-${Date.now()}-${++n}@example.test`, role: "PARENT" }, select: { id: true } });
  const hv = await db.student.create({ data: { name: `${P0}hv-${ten}-${n}`, parentUserId: ph.id }, select: { id: true } });
  const c = await capQuyenHoc(db, { studentId: hv.id, courseId: k.courseId, loai: "MUA", now: T0, idempotencyKey: `ci-onlp0-mua-${ten}-${Date.now()}-${n}` });
  if (!c.ok) throw new Error(c.thongBao);
  const args = (now: Date) => ({ parentUserId: ph.id, studentId: hv.id, courseId: k.courseId, lessonStableId: k.lessonStableId, now });
  return { parentUserId: ph.id, studentId: hv.id, entitlementId: c.entitlementId, args };
}

let rq = 0;
export const khoaYeuCau = (t = "r") => `ci-onlp0-${t}-${Date.now()}-${++rq}`;
