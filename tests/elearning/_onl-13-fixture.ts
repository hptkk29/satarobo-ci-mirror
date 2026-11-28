// @vitest-environment node
/** Fixture dùng chung cho bộ test Online 13 dạng + sản phẩm (Postgres thật). */
import { db } from "../../lib/db";
import { luuCauHoi, luuDeThi } from "../../lib/elearning-online/danh-gia-db";
import { caiDatKhoiDauChoBanNhap } from "../../lib/elearning-online/cai-dat-hoc-tap";
import { doiTrangThaiBan, taoKhoa } from "../../lib/elearning-online/khoa-hoc";
import { themBai, themChuong } from "../../lib/elearning-online/noi-dung";
import { luuCaiDat, phatHanh, xemTruocPhatHanh } from "../../lib/elearning-online/phien-ban";
import { capQuyenHoc } from "../../lib/elearning-online/quyen-hoc-db";
import { luuKhungCham } from "../../lib/elearning-online/san-pham-db";
import { donBangOnl } from "./_onl-don";

export const P = "CI_ONL13_";
export const NOW = new Date(Date.UTC(2026, 10, 21, 5, 0, 0));
let n = 0;

export async function don() {
  await donBangOnl(db);
  await db.student.deleteMany({ where: { name: { startsWith: P } } });
  await db.user.deleteMany({ where: { email: { startsWith: "ci-onl13-" } } });
}

export const SA_BAN = { cols: 4, rows: 3, start: { c: 0, r: 0, dir: "E" }, goal: { c: 3, r: 0 }, walls: [{ c: 1, r: 2 }], blocks: ["fwd", "right", "left", "repeat", "stop"], maxBlocks: 6 };
export const CAU = {
  FILL_BLANK: { type: "FILL_BLANK", stem: "Robot đi [[3|ba]] bước rồi [[dừng]].", cauHinh: { distractors: ["lùi"] } },
  MATCHING: { type: "MATCHING", stem: "Nối bộ phận", cauHinh: { pairs: [{ left: "Động cơ", right: "Làm bánh xe quay" }, { left: "Pin", right: "Cấp điện" }], distractors: ["Phát nhạc"] } },
  ORDERING: { type: "ORDERING", stem: "Xếp bước", cauHinh: { items: ["Đo khoảng cách", "Rẽ phải", "Đi qua cửa"] } },
  CLASSIFY: { type: "CLASSIFY", stem: "Phân loại", cauHinh: { groups: [{ name: "Siêu âm", cards: ["Tường"] }, { name: "Màu", cards: ["Vạch đen"] }] } },
  IMAGE_HOTSPOT: { type: "IMAGE_HOTSPOT", stem: "Chạm cảm biến", cauHinh: { image: { imageUrl: "https://example.com/robot.png", width: 800, height: 600 }, regions: [{ shape: "rect", x: 100, y: 100, w: 50, h: 40 }], tolerance: 0 } },
  NUMERIC: { type: "NUMERIC", stem: "20 cm/s trong 3 s?", cauHinh: { answer: 60, tolerance: 1, unit: "cm", hint: "nhân" } },
  PRODUCT: { type: "PRODUCT", stem: "Quay video robot", points: 4, cauHinh: { accept: ["VIDEO", "IMAGE"], maxMb: 100, maxVideoSec: 60 } },
  BLOCK_SEQUENCE: { type: "BLOCK_SEQUENCE", stem: "Đưa xe tới đích", cauHinh: SA_BAN },
} as const;

export async function dungKhoa(dung: { khung?: boolean } = {}) {
  const t = await taoKhoa(db, { code: `CI-ONL13-${Date.now().toString(36).toUpperCase()}-${++n}`, name: `${P}Khoá ${n}`, listPrice: 1, salePrice: 1, validityMonths: 12, renewalEnabled: false }, null);
  if (!t.ok) throw new Error(t.thongBao);
  const id: Record<string, string> = {};
  let rubricId: string | null = null;
  if (dung.khung) {
    const kc = await luuKhungCham(db, { courseId: t.courseId, code: "SA-BAN-02", title: "Robot đi hết sa bàn", criteria: [{ id: "dich", name: "Tới đích", max: 6 }, { id: "gon", name: "Chương trình gọn", max: 4 }] }, "u");
    if (!kc.ok) throw new Error(kc.thongBao);
    rubricId = kc.id;
  }
  for (const [k, v] of Object.entries(CAU)) {
    const cfgThem = k === "PRODUCT" && rubricId ? { cauHinh: { ...(v as { cauHinh: object }).cauHinh, rubricId } } : {};
    const r = await luuCauHoi(db, { courseId: t.courseId, ...(v as object), ...cfgThem, explanation: "GIAI-THICH-" + k } as never, "u");
    if (!r.ok) throw new Error(k + ": " + r.thongBao);
    id[k] = r.id;
  }
  const de = await luuDeThi(db, { courseId: t.courseId, kind: "QUIZ", title: "Đề 13 dạng", passPercent: 70, status: "ACTIVE", cau: Object.values(id).map((questionId) => ({ questionId })) }, "u");
  if (!de.ok) throw new Error(de.thongBao);
  const ch = await themChuong(db, { versionId: t.draftVersionId, title: "C1" });
  if (!ch.ok) throw new Error("c");
  const b = await themBai(db, { versionId: t.draftVersionId, chapterId: ch.chapterId, kind: "QUIZ", title: "Q", contentJson: { assessmentId: de.id } });
  if (!b.ok) throw new Error(b.thongBao);
  const l = await luuCaiDat(db, { versionId: t.draftVersionId, caiDat: { ...caiDatKhoiDauChoBanNhap(), moBaiTiepTheo: "MO_HET" as const, xemKetQua: "CA_DAP_AN_SAU_HET_LUOT" as const } });
  if (!l.ok) throw new Error(l.thongBao);
  const xt = await xemTruocPhatHanh(db, t.courseId, null);
  if (!xt.ok) throw new Error(xt.thongBao);
  const ph = await phatHanh(db, { courseId: t.courseId, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, NOW);
  if (!ph.ok) throw new Error(ph.thongBao);
  await doiTrangThaiBan(db, { courseId: t.courseId, saleStatus: "ON_SALE" });
  const phuHuynh = await db.user.create({ data: { name: `${P}ph`, email: `ci-onl13-${Date.now()}-${++n}@example.test`, role: "PARENT" }, select: { id: true } });
  const hv = await db.student.create({ data: { name: `${P}hv-${++n}`, parentUserId: phuHuynh.id }, select: { id: true } });
  const q = await capQuyenHoc(db, { studentId: hv.id, courseId: t.courseId, loai: "MUA", now: NOW, idempotencyKey: `ci-onl13-${n}` });
  if (!q.ok) throw new Error(q.thongBao);
  return { courseId: t.courseId, rubricId, lessonStableId: b.stableId, id, args: { parentUserId: phuHuynh.id, studentId: hv.id, courseId: t.courseId, lessonStableId: b.stableId, now: NOW } };
}

/** Thêm một học viên (phụ huynh riêng) vào khoá đã dựng, có quyền học. */
export async function themHocVien(k: { courseId: string; lessonStableId: string }, ten: string) {
  const ph = await db.user.create({ data: { name: P + "ph-" + ten, email: "ci-onl13-" + ten + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6) + "@example.test", role: "PARENT" }, select: { id: true } });
  const hv = await db.student.create({ data: { name: P + "hv-" + ten + "-" + Math.random().toString(36).slice(2, 6), parentUserId: ph.id }, select: { id: true } });
  const q = await capQuyenHoc(db, { studentId: hv.id, courseId: k.courseId, loai: "MUA", now: NOW, idempotencyKey: "ci-onl13-" + ten + "-" + Math.random().toString(36).slice(2, 8) });
  if (!q.ok) throw new Error(q.thongBao);
  return { parentUserId: ph.id, studentId: hv.id, courseId: k.courseId, lessonStableId: k.lessonStableId, now: NOW };
}

/** Tệp hợp lệ của học viên (khoá dưới tiền tố của chính họ). */
export const tepHopLe = (courseId: string, studentId: string, ten = "sa-ban-2.mp4") => ({ key: "online/sp/" + courseId + "/" + studentId + "/" + ten, name: ten, mime: "video/mp4", sizeBytes: 5_000_000, durationSec: 48 });
