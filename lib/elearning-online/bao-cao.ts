import type { PrismaClient } from "@prisma/client";
import { docCaiDatHocTap } from "./cai-dat-hoc-tap";
import { trangThaiHieuLuc, type TrangThaiHieuLuc } from "./quyen-hoc";
import { tinhTienDoKhoa, type BaiTrongBan, type TienDoBai } from "./tien-do";

/**
 * E-LEARNING ONLINE — BÁO CÁO TỔNG HỢP theo khoá (quyền `onl:report:view`: Đào tạo, Kế toán, Marketing — CHỈ ĐỌC, KHÔNG PII).
 *
 * Bất biến:
 * 1. KHÔNG có tên học viên/phụ huynh/SĐT/mã học viên/id học viên trong kết quả — chỉ con số tổng hợp (người xem báo cáo không nhất thiết được thấy PII).
 * 2. Trạng thái quyền suy từ `expiresAt` so với `now` (cùng hàm `trangThaiHieuLuc`), KHÔNG đọc cột hết hạn (không có).
 * 3. Tiến độ tính trên BẢN ĐANG CHẠY bằng cùng luật `tinhTienDoKhoa` như màn học viên — một nguồn.
 * 4. Không có doanh thu: tiền thuộc Workstream A (đơn hàng); báo cáo này đếm QUYỀN HỌC, không đếm tiền.
 */

type Db = PrismaClient;

export type BaoCaoKhoa = {
  tongQuyen: number;
  theoTrangThai: Record<TrangThaiHieuLuc, number>;
  theoNguon: { muaKhoa: number; capMienPhi: number };
  /** Số quyền ĐANG CÓ HIỆU LỰC (còn hạn + sắp hết hạn) đã hoàn thành khoá. */
  daHoanThanh: number;
  /** % hoàn thành trung bình của các quyền đang có hiệu lực (làm tròn xuống); `null` nếu khoá chưa phát hành / không có quyền. */
  tienDoTrungBinh: number | null;
  chungNhan: { hieuLuc: number; daThuHoi: number };
  /** Số quyền mới theo tháng (giờ VN) — 12 tháng gần nhất có phát sinh. */
  quyenMoiTheoThang: { thang: string; so: number }[];
  deThi: { tieuDe: string; loai: string; soLuot: number; tiLeDat: number | null; diemTrungBinh: number | null }[];
};

const thangVn = (d: Date) => {
  const v = new Date(d.getTime() + 7 * 3600_000);
  return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}`;
};

export async function docBaoCaoKhoa(db: Db, courseId: string, now: Date): Promise<BaoCaoKhoa | null> {
  const khoa = await db.onlCourse.findFirst({ where: { id: courseId, deletedAt: null }, select: { id: true, publishedVersionId: true } });
  if (!khoa) return null;
  const quyen = await db.onlEntitlement.findMany({ where: { courseId }, select: { id: true, status: true, expiresAt: true, source: true } });
  const theoTrangThai: Record<TrangThaiHieuLuc, number> = { CON_HAN: 0, SAP_HET_HAN: 0, HET_HAN: 0, THU_HOI: 0 };
  const hieuLuc = new Set<string>();
  for (const q of quyen) {
    const t = trangThaiHieuLuc({ trangThai: q.status, hetHan: q.expiresAt }, now);
    theoTrangThai[t] += 1;
    if (t === "CON_HAN" || t === "SAP_HET_HAN") hieuLuc.add(q.id);
  }

  let daHoanThanh = 0;
  let tienDoTrungBinh: number | null = null;
  if (khoa.publishedVersionId && hieuLuc.size) {
    const ban = await db.onlCourseVersion.findUnique({
      where: { id: khoa.publishedVersionId },
      select: {
        settingsJson: true,
        chapters: { select: { id: true, stableId: true, orderIndex: true, hidden: true } },
        lessons: { select: { stableId: true, chapterId: true, kind: true, required: true, hidden: true, orderIndex: true } },
      },
    });
    const cd = ban ? docCaiDatHocTap(ban.settingsJson) : null;
    if (ban && cd?.ok) {
      const ch = new Map(ban.chapters.map((c) => [c.id, c]));
      const cay: BaiTrongBan[] = [...ban.lessons]
        .sort((a, b) => (ch.get(a.chapterId)?.orderIndex ?? 0) - (ch.get(b.chapterId)?.orderIndex ?? 0) || a.orderIndex - b.orderIndex)
        .map((b, i) => ({ stableId: b.stableId, chapterStableId: ch.get(b.chapterId)?.stableId ?? "", kind: b.kind, required: b.required, hidden: b.hidden || !!ch.get(b.chapterId)?.hidden, thuTu: i, thuTuChuong: ch.get(b.chapterId)?.orderIndex ?? 0 }));
      const dong = await db.onlLessonProgress.findMany({ where: { entitlementId: { in: [...hieuLuc] } }, select: { entitlementId: true, lessonStableId: true, status: true } });
      const td = new Map<string, TienDoBai>();
      for (const d of dong) (td.get(d.entitlementId) ?? td.set(d.entitlementId, {}).get(d.entitlementId)!)[d.lessonStableId] = d.status;
      let tong = 0;
      for (const id of hieuLuc) {
        const r = tinhTienDoKhoa(cay, td.get(id) ?? {}, cd.caiDat);
        tong += r.phanTram;
        if (r.hoanThanh) daHoanThanh += 1;
      }
      tienDoTrungBinh = Math.floor(tong / hieuLuc.size);
    }
  }

  const [cnHieuLuc, cnThuHoi, su, de] = await Promise.all([
    db.onlCertificate.count({ where: { courseId, status: "ISSUED" } }),
    db.onlCertificate.count({ where: { courseId, status: "REVOKED" } }),
    db.onlEntitlementEvent.findMany({ where: { entitlement: { courseId }, kind: "GRANTED" }, select: { createdAt: true } }),
    db.onlAttempt.groupBy({ by: ["assessmentId"], where: { assessment: { courseId }, status: "GRADED" }, _count: { _all: true }, _avg: { scorePercent: true } }),
  ]);
  const dat = await db.onlAttempt.groupBy({ by: ["assessmentId"], where: { assessment: { courseId }, status: "GRADED", passed: true }, _count: { _all: true } });
  const datMap = new Map(dat.map((d) => [d.assessmentId, d._count._all]));
  const ds = await db.onlAssessment.findMany({ where: { courseId }, select: { id: true, title: true, kind: true } });
  const dsMap = new Map(ds.map((d) => [d.id, d]));
  const theoThang = new Map<string, number>();
  for (const e of su) theoThang.set(thangVn(e.createdAt), (theoThang.get(thangVn(e.createdAt)) ?? 0) + 1);

  return {
    tongQuyen: quyen.length,
    theoTrangThai,
    theoNguon: { muaKhoa: quyen.filter((q) => q.source === "PURCHASE").length, capMienPhi: quyen.filter((q) => q.source === "FREE_GRANT").length },
    daHoanThanh,
    tienDoTrungBinh,
    chungNhan: { hieuLuc: cnHieuLuc, daThuHoi: cnThuHoi },
    quyenMoiTheoThang: [...theoThang.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12).map(([thang, so]) => ({ thang, so })),
    deThi: de.map((g) => ({ tieuDe: dsMap.get(g.assessmentId)?.title ?? "(đề đã xoá)", loai: dsMap.get(g.assessmentId)?.kind ?? "", soLuot: g._count._all, tiLeDat: g._count._all ? Math.floor(((datMap.get(g.assessmentId) ?? 0) * 100) / g._count._all) : null, diemTrungBinh: g._avg.scorePercent === null ? null : Math.floor(g._avg.scorePercent) })),
  };
}

export type DongTongQuan = { courseId: string; code: string; name: string; saleStatus: string; daPhatHanh: boolean; quyenHieuLuc: number; tongQuyen: number; chungNhan: number };

/** Tổng quan MỌI khoá: số quyền đang hiệu lực / tổng, chứng nhận. Không PII, không tiền. */
export async function docBaoCaoTongQuan(db: Db, now: Date): Promise<DongTongQuan[]> {
  const khoa = await db.onlCourse.findMany({ where: { deletedAt: null }, orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }], select: { id: true, code: true, name: true, saleStatus: true, publishedVersionId: true } });
  const quyen = await db.onlEntitlement.findMany({ select: { courseId: true, status: true, expiresAt: true } });
  const cn = await db.onlCertificate.groupBy({ by: ["courseId"], where: { status: "ISSUED" }, _count: { _all: true } });
  const cnMap = new Map(cn.map((c) => [c.courseId, c._count._all]));
  return khoa.map((k) => {
    const q = quyen.filter((x) => x.courseId === k.id);
    const hl = q.filter((x) => {
      const t = trangThaiHieuLuc({ trangThai: x.status, hetHan: x.expiresAt }, now);
      return t === "CON_HAN" || t === "SAP_HET_HAN";
    }).length;
    return { courseId: k.id, code: k.code, name: k.name, saleStatus: k.saleStatus, daPhatHanh: !!k.publishedVersionId, quyenHieuLuc: hl, tongQuyen: q.length, chungNhan: cnMap.get(k.id) ?? 0 };
  });
}
