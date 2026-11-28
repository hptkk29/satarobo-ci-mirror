// @vitest-environment node
/**
 * Fixture CHUNG cho spec HTTP bài thi Online (V8.45) và script seed 3223: dựng khoá Online ĐÃ PHÁT HÀNH có MỘT bài QUIZ gắn đề, bằng chính hàm lõi của E (không ghi tay bảng Onl*).
 * Postgres thật. KHÔNG tự dọn DB (người gọi quyết). Giải thích của mọi câu mang chuỗi dấu `GIAI-THICH-BI-MAT` để test dò rò rỉ.
 */
import { db } from "../../lib/db";
import { caiDatKhoiDauChoBanNhap } from "../../lib/elearning-online/cai-dat-hoc-tap";
import { luuCauHoi, luuDeThi } from "../../lib/elearning-online/danh-gia-db";
import { doiTrangThaiBan, taoKhoa } from "../../lib/elearning-online/khoa-hoc";
import { themBai, themChuong } from "../../lib/elearning-online/noi-dung";
import { luuCaiDat, phatHanh, xemTruocPhatHanh } from "../../lib/elearning-online/phien-ban";

export const DAU_GIAI_THICH = "GIAI-THICH-BI-MAT";
export type CauSoan = { khoa: string; input: Record<string, unknown> };
let dem = 0;

/** 4 câu tự động cơ bản: chonMot (a đúng) · dungSai (true) · ngan ("Hà Nội") · nhapSo (5). */
export const CAU_CO_BAN: CauSoan[] = [
  { khoa: "chonMot", input: { type: "SINGLE_CHOICE", stem: "1+1=?", options: [{ id: "a", text: "2" }, { id: "b", text: "3" }], correct: "a" } },
  { khoa: "dungSai", input: { type: "TRUE_FALSE", stem: "Robot có động cơ?", correct: true } },
  { khoa: "ngan", input: { type: "SHORT_TEXT", stem: "Thủ đô VN?", accepted: ["Hà Nội"] } },
  { khoa: "nhapSo", input: { type: "NUMERIC", stem: "2+3=?", cauHinh: { answer: 5, tolerance: 0 } } },
];

export async function dungKhoaThi(o: { ten: string; ma?: string; cau?: CauSoan[]; timeLimitMin?: number | null; passPercent?: number; maxAttempts?: number | null; hanSauPhatHanh?: Date }) {
  const mocPhatHanh = o.hanSauPhatHanh ?? new Date();
  const t = await taoKhoa(db, { code: o.ma ?? `${o.ten}-${Date.now().toString(36).toUpperCase()}-${++dem}`.slice(0, 40), name: `${o.ten} khoá ${dem}`, listPrice: 1, salePrice: 1, validityMonths: 12, renewalEnabled: false }, null);
  if (!t.ok) throw new Error(t.thongBao);
  const q: Record<string, string> = {};
  for (const c of o.cau ?? CAU_CO_BAN) {
    const r = await luuCauHoi(db, { courseId: t.courseId, ...c.input, explanation: `${DAU_GIAI_THICH}-${c.khoa}` } as never, "u");
    if (!r.ok) throw new Error(`${c.khoa}: ${r.thongBao}`);
    q[c.khoa] = r.id;
  }
  const de = await luuDeThi(db, { courseId: t.courseId, kind: "QUIZ", title: "Kiểm tra Online", passPercent: o.passPercent ?? 50, status: "ACTIVE", maxAttempts: o.maxAttempts ?? null, timeLimitMin: o.timeLimitMin === undefined ? 3 : o.timeLimitMin, cau: Object.values(q).map((questionId) => ({ questionId })) }, "u");
  if (!de.ok) throw new Error(de.thongBao);
  const ch = await themChuong(db, { versionId: t.draftVersionId, title: "Chương 1" });
  if (!ch.ok) throw new Error("chuong");
  const b = await themBai(db, { versionId: t.draftVersionId, chapterId: ch.chapterId, kind: "QUIZ", title: "Bài kiểm tra", contentJson: { assessmentId: de.id } });
  if (!b.ok) throw new Error(b.thongBao);
  const l = await luuCaiDat(db, { versionId: t.draftVersionId, caiDat: { ...caiDatKhoiDauChoBanNhap(), moBaiTiepTheo: "MO_HET" as const, xemKetQua: "CA_DAP_AN_SAU_HET_LUOT" as const } });
  if (!l.ok) throw new Error(l.thongBao);
  const xt = await xemTruocPhatHanh(db, t.courseId, null);
  if (!xt.ok) throw new Error(xt.thongBao);
  const ph = await phatHanh(db, { courseId: t.courseId, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, mocPhatHanh);
  if (!ph.ok) throw new Error(ph.thongBao);
  await doiTrangThaiBan(db, { courseId: t.courseId, saleStatus: "ON_SALE" });
  return { courseId: t.courseId, lessonStableId: b.stableId, assessmentId: de.id, q };
}

/** Đáp án HỢP LỆ theo dạng câu, dựng từ ĐỀ ĐÃ GỬI CHO HỌC VIÊN (mã lựa chọn mờ theo lượt — client chỉ gửi lại đúng mã nhận được). */
export function dapAnHopLeTuDe(c: { type: string; options?: { id: string }[]; cauHinh?: Record<string, unknown> }): unknown {
  const h = (c.cauHinh ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  switch (c.type) {
    case "SINGLE_CHOICE": return c.options![0]!.id;
    case "MULTIPLE_CHOICE": return [c.options![0]!.id, c.options![1]!.id];
    case "TRUE_FALSE": return true;
    case "SHORT_TEXT": return "ha noi";
    case "ESSAY": return "Bài làm tự luận của em.";
    case "FILL_BLANK": return Array.from({ length: h.soO }, () => "x");
    case "MATCHING": return { [h.trai[0].id]: h.phai[0].id };
    case "ORDERING": return h.muc.map((m: { id: string }) => m.id);
    case "CLASSIFY": return { [h.the[0].id]: h.nhom[0].id };
    case "IMAGE_HOTSPOT": return { x: 10, y: 10 };
    case "NUMERIC": return 60;
    case "PRODUCT": return "sub_123";
    case "BLOCK_SEQUENCE": return [{ b: "fwd" }];
    default: throw new Error(`dạng chưa có đáp án mẫu: ${c.type}`);
  }
}

/** Đáp án SAI KIỂU cho mọi dạng (kiểu dữ liệu khác hẳn) — mọi dạng phải từ chối. */
export const DAP_AN_SAI_KIEU: unknown = { khong: "hop-le", correct: true };
