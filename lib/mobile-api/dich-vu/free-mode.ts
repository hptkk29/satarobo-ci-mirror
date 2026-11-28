import { writeAudit } from "@/lib/audit/audit-log";
import { db } from "@/lib/db";
import { docCaiDatHocTap } from "@/lib/elearning-online/cai-dat-hoc-tap";
import { banDuocLucNay } from "@/lib/elearning-online/danh-muc-cong-khai";
import { ghiTienDoHocThu, moBaiMienPhi, tuNhanKhoaMienPhi, type MaLoiHocThu } from "@/lib/elearning-online/hoc-thu-tien-do";
import { kiemKhoaVideo } from "@/lib/elearning-online/khoa-video";
import { TI_LE_LAM_MOI } from "@/lib/elearning-online/video-phat";
import { phatKhoaVideo } from "@/lib/elearning-online/video-phat-http";
import { capVeHocThuDangNhap, kiemTraTruyCapBaiMienPhi, kiemVeHocThuDangNhap } from "@/lib/elearning-online/ve-hoc-thu";
import { rateLimit } from "@/lib/rate-limit";
import { getSetting } from "@/lib/settings/service";
import { isOnlineVideoBucketConfigured } from "@/lib/storage/online-video-storage";

import { httpFreeMode, ID_BAI, khoaTuNhan, SLUG_KHOA, THONG_BAO_FREE_MODE, type TienDoHocThuBody } from "../free-mode-hop-dong";
import type { MaHocVienDaKiem } from "../so-huu";
import { LoiApiMobile, type NguoiGoi } from "../xac-thuc/dich-vu";
import { batNeuTatOnline, yeuCauHocSinhTuGhi } from "./online-hoc";

/**
 * FREE MODE — lớp HTTP MỎNG của Mobile trên hàm lõi E (OD06=A, F1–F4; xem `docs/mobile-integration/FREE-MODE-HTTP-V845.md`). KHÔNG có engine thứ hai:
 * quyền xem bài = `kiemTraTruyCapBaiMienPhi` (chỉ VIDEO/READ `freePreview` của khoá ĐANG BÁN); mở bài/giới hạn F3/tiến độ F1 = `moBaiMienPhi`/`ghiTienDoHocThu`; tự nhận F2 =
 * `tuNhanKhoaMienPhi`; chuyển tiến độ F4 nằm TRONG `capQuyenHoc` của E (không có lời gọi nào ở đây). Việc của A: danh tính từ PHIÊN, ranh giới phụ huynh/học viên, cổng chính sách Admin, ánh xạ HTTP, audit.
 *
 * QUY TẮC PHÂN BIỆT PHỤ HUYNH / HỌC VIÊN (Owner V8.46, giữ nguyên cho Free Mode):
 *   · GHI (mở bài có đếm giới hạn, ghi tiến độ) = CHỈ phiên Student Mode của CHÍNH em (`yeuCauHocSinhTuGhi`). Phụ huynh chỉ ĐỌC.
 *   · `moBaiMienPhi` là phép GHI (tạo dòng tiến độ, tiêu `gioiHanSoBai`, khởi động `hanNgay`) ⇒ chỉ đi sau `yeuCauHocSinhTuGhi`, KHÔNG BAO GIỜ sau GET của phụ huynh.
 *   · `kiemTraTruyCapBaiMienPhi` và `capVeHocThuDangNhap` KHÔNG kiểm giới hạn F3 ⇒ đường học viên (mở bài, cấp vé) luôn đi qua `moBaiMienPhi` trước; đường PHỤ HUYNH / tài khoản chưa có con
 *     xem bài và xin vé KHÔNG bị giới hạn F3 (quyết định tường minh của A — câu hỏi Owner Q-F3, xem tài liệu): giới hạn của E đếm theo tiến độ học viên mà phụ huynh xem thử không tạo tiến độ nào.
 *   · Tài khoản chưa có học viên: đọc bài + xin vé (theo tài khoản), KHÔNG ghi tiến độ được (bảng tiến độ của E gắn `studentId` bắt buộc; không dựng học viên giả).
 */

const khongThay = () => new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");

/** Dịch mã Free Mode (lõi E hoặc lớp Mobile) thành lỗi HTTP theo bảng của A. Mã lạ ⇒ 500 (không đoán). */
export function loiFreeMode(ma: string, maChiTiet?: string, chiTiet?: unknown): LoiApiMobile {
  const status = httpFreeMode(ma);
  const e = status === 500 ? new LoiApiMobile("SERVER", 500, "Lỗi tích hợp Free Mode (mã chưa được ánh xạ).") : new LoiApiMobile(ma as never, status, THONG_BAO_FREE_MODE[ma] ?? "Không thực hiện được yêu cầu này.", undefined, maChiTiet);
  return chiTiet === undefined ? e : Object.assign(e, { chiTiet });
}

async function giuTanSuat(khoa: string, max: number, windowMs = 60_000): Promise<void> {
  const rl = await rateLimit({ key: khoa, max, windowMs });
  if (!rl.success) throw new LoiApiMobile("RATE_LIMITED", 429, "Bạn thao tác quá nhanh. Vui lòng thử lại sau ít giây.", Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)));
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const slugHopLe = (s: string) => SLUG_KHOA.test(s);
const baiHopLe = (s: string) => ID_BAI.test(s);

/** Chỉ phiên PHỤ HUYNH thường (không ở chế độ học sinh). Cổng chế độ học sinh đã chặn mặc định; đây là lớp thứ hai cho các việc không phải của học viên. */
function yeuCauPhuHuynh(nguoi: NguoiGoi): void {
  if (nguoi.hocSinhId !== null) throw new LoiApiMobile("FORBIDDEN", 403, "Đang ở chế độ học sinh — ba mẹ nhập mã để mở phần này.");
}

// ───────────────────────── tra khoá / bài ─────────────────────────

type KhoaHocThu = {
  id: string; slug: string; code: string; name: string; shortDescription: string | null; coverImageKey: string | null; level: string | null;
  gradeFrom: number | null; gradeTo: number | null; listPrice: number; salePrice: number; publishedVersionId: string;
};
const CHON_KHOA = { id: true, slug: true, code: true, name: true, shortDescription: true, coverImageKey: true, level: true, gradeFrom: true, gradeTo: true, listPrice: true, salePrice: true, saleStatus: true, saleOpensAt: true, publishedVersionId: true } as const;

/** Khoá ĐANG BÁN lúc này (cùng vị từ `banDuocLucNay` với đường học thử của E: khoá hẹn giờ chưa tới giờ KHÔNG hiện). Không có/không bán ⇒ cùng một 404. */
async function timKhoa(slug: string, now: Date): Promise<KhoaHocThu> {
  if (!slugHopLe(slug)) throw khongThay();
  const k = await db.onlCourse.findFirst({ where: { slug, deletedAt: null, publishedVersionId: { not: null }, saleStatus: { in: ["ON_SALE", "SCHEDULED"] } }, select: CHON_KHOA });
  if (!k?.publishedVersionId || !banDuocLucNay(k.saleStatus, k.saleOpensAt, now)) throw khongThay();
  return k as KhoaHocThu;
}

const LOC_BAI_MIEN_PHI = { kind: { in: ["VIDEO", "READ"] as ("VIDEO" | "READ")[] }, freePreview: true, hidden: false, chapter: { hidden: false } } as const;

async function chinhSachCuaBan(versionId: string) {
  const ban = await db.onlCourseVersion.findUnique({ where: { id: versionId }, select: { settingsJson: true, number: true } });
  if (!ban) throw loiFreeMode("CAI_DAT_KHONG_HOP_LE");
  const cd = docCaiDatHocTap(ban.settingsJson);
  if (!cd.ok) throw loiFreeMode("CAI_DAT_KHONG_HOP_LE");
  return { dangKyMienPhi: cd.caiDat.hocThu?.dangKyMienPhi === true, gioiHanSoBai: cd.caiDat.hocThu?.gioiHanSoBai ?? null, hanNgay: cd.caiDat.hocThu?.hanNgay ?? null, soBan: ban.number };
}

const tuNhanDangBat = async (): Promise<boolean> => (await getSetting("freemode.selfClaim.enabled")) === true;

// ───────────────────────── điều kiện TỰ NHẬN (F2) — MỘT chỗ cho hiển thị lẫn ghi ─────────────────────────

export type XetTuNhan = { duoc: true } | { duoc: false; ma: string; maChiTiet?: string };

/**
 * F2: học viên này có TỰ NHẬN được khoá này lúc này không. Thứ tự: (1) chính sách Admin BẬT · (2) khoá công bố đăng ký miễn phí (cài đặt BẢN ĐANG CHẠY) · (3) chưa từng có quyền (kể cả hết hạn/thu hồi) ·
 * (4) khối lớp nằm trong khoảng của khoá (nếu khoá có khai) · (5) chưa vượt số khoá miễn phí tối đa (cấu hình, 0 = không giới hạn). Màn hình (cờ `duocTuNhan`) và đường ghi cùng gọi hàm này.
 */
export async function xetTuNhan(studentId: string, khoa: Pick<KhoaHocThu, "id" | "gradeFrom" | "gradeTo">, dangKyMienPhi: boolean): Promise<XetTuNhan> {
  if (!(await tuNhanDangBat())) return { duoc: false, ma: "CHINH_SACH_TAT" };
  if (!dangKyMienPhi) return { duoc: false, ma: "KHONG_DANG_KY_MIEN_PHI" };
  const [quyen, hs, toiDa] = await Promise.all([
    db.onlEntitlement.findUnique({ where: { studentId_courseId: { studentId, courseId: khoa.id } }, select: { status: true, expiresAt: true } }),
    db.student.findUnique({ where: { id: studentId }, select: { currentGrade: true } }),
    getSetting("freemode.selfClaim.maxFreeCoursesPerStudent"),
  ]);
  if (quyen) return { duoc: false, ma: quyen.status === "ACTIVE" && (quyen.expiresAt === null || quyen.expiresAt.getTime() > Date.now()) ? "DA_CO_QUYEN_HOC" : "DA_TUNG_CO_QUYEN" };
  if (khoa.gradeFrom !== null || khoa.gradeTo !== null) {
    const lop = hs?.currentGrade ?? null;
    if (lop === null) return { duoc: false, ma: "KHONG_DU_DIEU_KIEN", maChiTiet: "THIEU_KHOI_LOP" };
    if ((khoa.gradeFrom !== null && lop < khoa.gradeFrom) || (khoa.gradeTo !== null && lop > khoa.gradeTo)) return { duoc: false, ma: "KHONG_DU_DIEU_KIEN", maChiTiet: "KHOI_LOP_KHONG_PHU_HOP" };
  }
  if (toiDa > 0) {
    const da = await db.onlEntitlement.count({ where: { studentId, source: "FREE_GRANT", courseId: { not: khoa.id } } });
    if (da >= toiDa) return { duoc: false, ma: "KHONG_DU_DIEU_KIEN", maChiTiet: "VUOT_SO_KHOA_MIEN_PHI" };
  }
  return { duoc: true };
}

const dtoTuNhan = (x: XetTuNhan) => (x.duoc ? { duoc: true as const, lyDo: null, maChiTiet: null } : { duoc: false as const, lyDo: x.ma, maChiTiet: x.maChiTiet ?? null });

// ───────────────────────── (A1) trạng thái Free của tài khoản ─────────────────────────

/** `GET /parent/free-mode` — suy MỖI LẦN từ dữ liệu có sẵn (không có «loại tài khoản Free»). Chỉ phụ huynh; client không gửi được cờ nào. */
export async function trangThaiFreeMode(nguoi: NguoiGoi, now = new Date()) {
  batNeuTatOnline();
  yeuCauPhuHuynh(nguoi);
  const hocVien = await db.student.findMany({ where: { parentUserId: nguoi.userId, deletedAt: null }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
  const ids = hocVien.map((h) => h.id);
  const [quyen, tienDo, tuNhanBat] = await Promise.all([
    ids.length ? db.onlEntitlement.findMany({ where: { studentId: { in: ids } }, select: { studentId: true, courseId: true, status: true, expiresAt: true, source: true, course: { select: { slug: true, name: true } } } }) : Promise.resolve([]),
    ids.length ? db.onlFreeLessonProgress.findMany({ where: { studentId: { in: ids } }, select: { studentId: true, courseId: true, status: true, transferredEntitlementId: true, course: { select: { slug: true, name: true, salePrice: true, saleStatus: true, saleOpensAt: true, publishedVersionId: true, deletedAt: true } } } }) : Promise.resolve([]),
    tuNhanDangBat(),
  ]);
  const conHan = (q: { status: string; expiresAt: Date | null }) => q.status === "ACTIVE" && (q.expiresAt === null || q.expiresAt.getTime() > now.getTime());
  const goiY: Array<{ ma: "CO_THE_MUA_KHOA"; studentId: string; slug: string; tenKhoa: string; giaBan: number; soBaiDaHocThu: number }> = [];
  const hv = hocVien.map((h) => {
    const q = quyen.filter((x) => x.studentId === h.id && conHan(x));
    const t = tienDo.filter((x) => x.studentId === h.id);
    // Gợi ý nâng cấp = DỮ LIỆU, không câu chữ khuyến mãi (Q10 chưa trả lời): khoá đã học thử, còn bán, có giá, học viên chưa có quyền còn hiệu lực.
    for (const khoaId of new Set(t.filter((x) => x.transferredEntitlementId === null).map((x) => x.courseId))) {
      const c = t.find((x) => x.courseId === khoaId)!.course;
      if (c.deletedAt || !c.publishedVersionId || c.salePrice <= 0 || !banDuocLucNay(c.saleStatus, c.saleOpensAt, now)) continue;
      if (quyen.some((x) => x.studentId === h.id && x.courseId === khoaId && conHan(x))) continue;
      goiY.push({ ma: "CO_THE_MUA_KHOA", studentId: h.id, slug: c.slug, tenKhoa: c.name, giaBan: c.salePrice, soBaiDaHocThu: t.filter((x) => x.courseId === khoaId && x.transferredEntitlementId === null).length });
    }
    return {
      id: h.id,
      tenHienThi: h.name,
      quyenOnline: { traPhi: q.filter((x) => x.source === "PURCHASE").length, mienPhiTuNhan: q.filter((x) => x.source === "FREE_GRANT").length },
      khoaMienPhiDangCo: q.filter((x) => x.source === "FREE_GRANT").map((x) => ({ courseId: x.courseId, slug: x.course.slug, tenKhoa: x.course.name, hetHanLuc: iso(x.expiresAt) })),
      tienDoHocThu: { soBaiDaMo: t.filter((x) => x.transferredEntitlementId === null).length, soBaiXong: t.filter((x) => x.transferredEntitlementId === null && x.status === "COMPLETED").length },
    };
  });
  return {
    taiKhoan: { soHocVien: hocVien.length, phuHuynhThuan: true as const },
    /** GỢI Ý của máy chủ (không phải quyết định): 0 học viên ⇒ FREE (đúng web `LoiChaoChuaCoCon`). Định nghĩa «không có học viên» còn mở — Q3. */
    goiYCheDo: hocVien.length === 0 ? ("FREE" as const) : ("FULL" as const),
    tinhNang: {
      hocThuOnline: { bat: true, loaiBai: ["VIDEO", "READ"] as const },
      ghiTienDoHocThu: hocVien.length === 0 ? { bat: false, lyDo: "CHUA_CO_HOC_VIEN" as const } : { bat: true, ai: "HOC_VIEN_CHE_DO_HOC_SINH" as const },
      tuNhanMienPhi: tuNhanBat ? { bat: true, lyDo: hocVien.length === 0 ? ("CHUA_CO_HOC_VIEN" as const) : null } : { bat: false, lyDo: "CHINH_SACH_TAT" as const },
      datLichHocThuTaiCoSo: { bat: false, lyDo: "CHO_QUYET_DINH" as const },
    },
    hocVien: hv,
    goiYNangCap: goiY,
    capNhatLuc: now.toISOString(),
  };
}

// ───────────────────────── (A2/S0) danh sách khoá có bài học thử ─────────────────────────

/** `GET /online/preview/courses` (và `/students/:id/online/preview/courses` khi có `hs`). Chỉ khoá ĐANG BÁN có ≥ 1 bài VIDEO/READ `freePreview` hiển thị được. Không tên/nội dung bài trả phí. */
export async function danhSachHocThu(hs: MaHocVienDaKiem | null, loc: { trang?: number; coTrang?: number }, now = new Date()) {
  batNeuTatOnline();
  const coTrang = loc.coTrang ?? 12;
  const trang = loc.trang ?? 1;
  const khoa = await db.onlCourse.findMany({
    where: { deletedAt: null, publishedVersionId: { not: null }, saleStatus: { in: ["ON_SALE", "SCHEDULED"] } },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }],
    select: CHON_KHOA,
  });
  const dangBan = khoa.filter((k) => k.publishedVersionId && banDuocLucNay(k.saleStatus, k.saleOpensAt, now));
  const vIds = dangBan.map((k) => k.publishedVersionId!);
  const [thongKe, bans, tuNhanBat] = await Promise.all([
    vIds.length ? db.onlLesson.groupBy({ by: ["versionId"], where: { versionId: { in: vIds }, ...LOC_BAI_MIEN_PHI }, _count: { _all: true }, _sum: { durationSec: true } }) : Promise.resolve([]),
    vIds.length ? db.onlCourseVersion.findMany({ where: { id: { in: vIds } }, select: { id: true, settingsJson: true } }) : Promise.resolve([]),
    tuNhanDangBat(),
  ]);
  const tk = new Map(thongKe.map((t) => [t.versionId, t]));
  const cs = new Map(bans.map((b) => [b.id, docCaiDatHocTap(b.settingsJson)]));
  const co = dangBan.filter((k) => (tk.get(k.publishedVersionId!)?._count._all ?? 0) > 0);
  const trangDong = co.slice((trang - 1) * coTrang, trang * coTrang);
  const tienDo = hs ? await db.onlFreeLessonProgress.findMany({ where: { studentId: hs, courseId: { in: trangDong.map((k) => k.id) } }, select: { courseId: true, status: true } }) : [];
  const quyen = hs ? await db.onlEntitlement.findMany({ where: { studentId: hs, courseId: { in: trangDong.map((k) => k.id) } }, select: { courseId: true, status: true, expiresAt: true } }) : [];
  const muc = await Promise.all(
    trangDong.map(async (k) => {
      const c = cs.get(k.publishedVersionId!);
      const dangKy = c?.ok === true && c.caiDat.hocThu?.dangKyMienPhi === true;
      const t = tk.get(k.publishedVersionId!)!;
      const rieng = hs
        ? {
            tienDo: { soBaiDaMo: tienDo.filter((x) => x.courseId === k.id).length, soBaiXong: tienDo.filter((x) => x.courseId === k.id && x.status === "COMPLETED").length },
            daCoQuyenHoc: quyen.some((x) => x.courseId === k.id && x.status === "ACTIVE" && (x.expiresAt === null || x.expiresAt.getTime() > now.getTime())),
            tuNhan: dtoTuNhan(await xetTuNhan(hs, k, dangKy)),
          }
        : {};
      return {
        slug: k.slug,
        ma: k.code,
        ten: k.name,
        moTaNgan: k.shortDescription,
        anhBiaKhoa: k.coverImageKey,
        capDo: k.level,
        lop: { tu: k.gradeFrom, den: k.gradeTo },
        giaNiemYet: k.listPrice,
        giaBan: k.salePrice,
        soBaiHocThu: t._count._all,
        tongThoiLuongHocThuGiay: t._sum.durationSec ?? 0,
        choTuNhan: tuNhanBat && dangKy,
        ...rieng,
      };
    }),
  );
  return { muc, tong: co.length, trang, coTrang, capNhatLuc: now.toISOString(), dungChoHocVien: hs ?? null };
}

// ───────────────────────── (A3/S1) mục lục học thử của một khoá ─────────────────────────

/** `GET /online/preview/courses/:slug` (+ `/students/:id/…` khi có `hs`). CHỈ bài đủ điều kiện học thử; bài khác chỉ là MỘT CON SỐ (`soBaiKhac`) — không tên, không loại. */
export async function mucLucHocThu(hs: MaHocVienDaKiem | null, slug: string, now = new Date()) {
  batNeuTatOnline();
  const k = await timKhoa(slug, now);
  const [cs, bai, tong] = await Promise.all([
    chinhSachCuaBan(k.publishedVersionId),
    db.onlLesson.findMany({ where: { versionId: k.publishedVersionId, ...LOC_BAI_MIEN_PHI }, orderBy: [{ chapter: { orderIndex: "asc" } }, { orderIndex: "asc" }], select: { stableId: true, title: true, kind: true, durationSec: true, chapter: { select: { title: true } } } }),
    db.onlLesson.count({ where: { versionId: k.publishedVersionId, hidden: false, chapter: { hidden: false } } }),
  ]);
  const tuNhanBat = await tuNhanDangBat();
  let rieng: Record<string, unknown> = {};
  let theoBai = new Map<string, { trangThai: string; phanTram: number }>();
  if (hs) {
    const [dong, q] = await Promise.all([
      db.onlFreeLessonProgress.findMany({ where: { studentId: hs, courseId: k.id }, select: { lessonStableId: true, status: true, percent: true, firstAccessAt: true } }),
      db.onlEntitlement.findUnique({ where: { studentId_courseId: { studentId: hs, courseId: k.id } }, select: { status: true, expiresAt: true } }),
    ]);
    theoBai = new Map(dong.map((d) => [d.lessonStableId, { trangThai: d.status, phanTram: d.percent }]));
    const dau = dong.length ? Math.min(...dong.map((d) => d.firstAccessAt.getTime())) : null;
    rieng = {
      hocVien: {
        id: hs,
        daCoQuyenHoc: !!q && q.status === "ACTIVE" && (q.expiresAt === null || q.expiresAt.getTime() > now.getTime()),
        soBaiDaMo: dong.length,
        hetHanHocThuLuc: dau !== null && cs.hanNgay !== null ? new Date(dau + cs.hanNgay * 86_400_000).toISOString() : null,
        tuNhan: dtoTuNhan(await xetTuNhan(hs, k, cs.dangKyMienPhi)),
      },
    };
  }
  return {
    khoa: { slug: k.slug, ma: k.code, ten: k.name, moTaNgan: k.shortDescription, anhBiaKhoa: k.coverImageKey, capDo: k.level, lop: { tu: k.gradeFrom, den: k.gradeTo }, giaNiemYet: k.listPrice, giaBan: k.salePrice, soBan: cs.soBan },
    chinhSach: { gioiHanSoBai: cs.gioiHanSoBai, hanNgay: cs.hanNgay, choTuNhan: tuNhanBat && cs.dangKyMienPhi },
    bai: bai.map((b) => ({ lessonId: b.stableId, tieuDe: b.title, loai: b.kind, chuong: b.chapter.title, thoiLuongGiay: b.durationSec, ...(hs ? { tienDo: theoBai.get(b.stableId) ?? null } : {}) })),
    soBaiKhac: Math.max(0, tong - bai.length),
    ...rieng,
    capNhatLuc: now.toISOString(),
  };
}

// ───────────────────────── bài học thử: đọc (phụ huynh) / mở (học viên) ─────────────────────────

type BaiMienPhi = Extract<Awaited<ReturnType<typeof kiemTraTruyCapBaiMienPhi>>, { ok: true }>["bai"];
function dtoBai(b: BaiMienPhi) {
  const nd = (b.noiDung ?? {}) as { body?: unknown };
  return { lessonId: b.stableId, tieuDe: b.title, loai: b.kind, ...(b.kind === "READ" ? { noiDung: { body: typeof nd.body === "string" ? nd.body : "" } } : { coVideo: true as const }) };
}
const dtoTienDo = (t: { lessonStableId: string; status: string; percent: number; completedAt: Date | null; firstAccessAt: Date }) => ({ lessonId: t.lessonStableId, trangThai: t.status, phanTram: t.percent, hoanThanhLuc: iso(t.completedAt), moLanDauLuc: iso(t.firstAccessAt) });

/** `GET /online/preview/courses/:slug/lessons/:lessonId` — PHỤ HUYNH ĐỌC bài học thử (READ: thân bài; VIDEO: chỉ metadata). KHÔNG ghi gì, KHÔNG tiêu giới hạn F3 (xem đầu tệp). */
export async function docBaiHocThuChoPhuHuynh(nguoi: NguoiGoi, slug: string, lessonId: string, now = new Date()) {
  batNeuTatOnline();
  yeuCauPhuHuynh(nguoi);
  if (!baiHopLe(lessonId)) throw khongThay();
  const k = await timKhoa(slug, now);
  const r = await kiemTraTruyCapBaiMienPhi(db as never, { taiKhoanId: nguoi.userId, courseId: k.id, lessonStableId: lessonId, now });
  if (!r.ok) throw loiFreeMode(r.ma);
  return { bai: dtoBai(r.bai), capNhatLuc: now.toISOString() };
}

/** `POST /students/:id/online/preview/courses/:slug/lessons/:lessonId/open` — HỌC VIÊN (Student Mode, chính em) mở bài: kiểm bài + giới hạn F3 + ghi dấu lần đầu. Idempotent khi đã mở. */
export async function moBaiHocThu(hs: MaHocVienDaKiem, nguoi: NguoiGoi, slug: string, lessonId: string, now = new Date()) {
  batNeuTatOnline();
  yeuCauHocSinhTuGhi(hs, nguoi);
  if (!baiHopLe(lessonId)) throw khongThay();
  await giuTanSuat(`free-mo-bai:${nguoi.userId}`, 120);
  const k = await timKhoa(slug, now);
  const r = await moBaiMienPhi(db as never, { studentId: hs, courseId: k.id, lessonStableId: lessonId, now });
  if (!r.ok) throw baoLoiMoBai(r.ma, hs, k.id);
  return { bai: dtoBai(r.bai), tienDo: dtoTienDo(r.tienDo), capNhatLuc: now.toISOString() };
}

function baoLoiMoBai(ma: MaLoiHocThu | string, hs: string, courseId: string): LoiApiMobile {
  // Có quyền học HIỆU LỰC ⇒ học ở khu có phí (không ghi trùng tiến độ): chỉ đường cho app.
  return ma === "DA_CO_QUYEN_HOC" ? loiFreeMode(ma, undefined, { duongHoc: `/api/mobile/v1/students/${hs}/online/courses/${courseId}` }) : loiFreeMode(ma);
}

// ───────────────────────── (A5/S3) vé video học thử GẮN TÀI KHOẢN ─────────────────────────

export const DUONG_PHAT_HOC_THU = "/api/mobile/v1/online/preview/video/play";

/**
 * Cấp vé phát bài VIDEO học thử. Vé GẮN `userId` của phiên (OD06=A): tài khoản khác dùng lại ⇒ `VE_KHONG_DUNG_TAI_KHOAN`.
 * `hs` = học viên khi gọi từ `/students/:id/…`. Phiên Student Mode của CHÍNH em ⇒ mở bài (F3 + ghi dấu) TRƯỚC khi cấp vé; phụ huynh / tài khoản chưa có con ⇒ không đụng tiến độ.
 */
export async function capVeHocThuMobile(nguoi: NguoiGoi, hs: MaHocVienDaKiem | null, slug: string, lessonId: string, now = new Date()) {
  batNeuTatOnline();
  if (!baiHopLe(lessonId)) throw khongThay();
  await giuTanSuat(`free-ve:${nguoi.userId}`, 60);
  const k = await timKhoa(slug, now);
  if (!isOnlineVideoBucketConfigured()) throw loiFreeMode("KHO_VIDEO_CHUA_CAU_HINH");
  const laHocVienTuMo = hs !== null && nguoi.hocSinhId !== null && nguoi.hocSinhId === (hs as string);
  if (laHocVienTuMo) {
    const m = await moBaiMienPhi(db as never, { studentId: hs!, courseId: k.id, lessonStableId: lessonId, now });
    if (!m.ok) throw baoLoiMoBai(m.ma, hs!, k.id);
    if (m.bai.kind !== "VIDEO") throw loiFreeMode("LOAI_BAI_KHONG_GHI_TRUC_TIEP");
  }
  const v = await capVeHocThuDangNhap(db as never, { taiKhoanId: nguoi.userId, slug: k.slug, lessonStableId: lessonId, now });
  if (!v.ok) throw loiFreeMode(v.ma);
  const bai = await db.onlLesson.findFirst({ where: { versionId: k.publishedVersionId, stableId: lessonId }, select: { contentJson: true } });
  const khoa = kiemKhoaVideo((bai?.contentJson as { mediaRef?: unknown } | null)?.mediaRef);
  if (!khoa.ok) throw loiFreeMode("KHOA_VIDEO_KHONG_HOP_LE");
  const ttl = Math.ceil((v.hetHanLuc.getTime() - now.getTime()) / 1000); // lõi E làm tròn `now` xuống giây rồi cộng TTL ⇒ ceil ra đúng TTL đã cấp
  return {
    loai: "HOC_THU" as const,
    duongPhat: `${DUONG_PHAT_HOC_THU}?ve=${v.ve}`,
    hetHanLuc: v.hetHanLuc.toISOString(),
    /** Xin vé mới trước mốc này (còn ~20% TTL), đổi URL và tua lại vị trí. Lượt phát PHẢI mang `Authorization: Bearer` (vé gắn tài khoản). */
    lamMoiTruocLuc: new Date(v.hetHanLuc.getTime() - Math.round(ttl * 1000 * TI_LE_LAM_MOI)).toISOString(),
    ttlGiay: ttl,
    loaiTep: khoa.contentType,
    hoTroRange: true as const,
    canBearer: true as const,
  };
}

/**
 * `GET|HEAD /online/preview/video/play?ve=…` — PHÁT video học thử, BẮT BUỘC Bearer (route đã xác thực). Vé phải ĐÚNG tài khoản của phiên; điều kiện bài + bản phát hành được hỏi LẠI ở MỖI lượt (kể cả mỗi lượt Range).
 */
export async function phatHocThu(req: Request, nguoi: NguoiGoi, now = new Date(), deps: Parameters<typeof phatKhoaVideo>[2] = {}): Promise<Response> {
  batNeuTatOnline();
  const ve = new URL(req.url).searchParams.get("ve");
  if (!ve || ve.length > 1200) throw new LoiApiMobile("VALIDATION", 400, "Thiếu vé phát.");
  const r = await kiemVeHocThuDangNhap(db as never, ve, nguoi.userId, now);
  if (!r.ok) throw loiFreeMode(r.ma);
  const khoa = kiemKhoaVideo(r.mediaRef);
  if (!khoa.ok) throw loiFreeMode("KHOA_VIDEO_KHONG_HOP_LE");
  return phatKhoaVideo(req, khoa, { ...deps, now });
}

// ───────────────────────── (S4) ghi tiến độ học thử (F1) ─────────────────────────

/** `POST /students/:id/online/preview/courses/:slug/lessons/:lessonId/progress` — CHỈ học viên (Student Mode, chính em). VIDEO: `percent`; READ: `daDoc`. Đơn điệu (E). Phụ huynh ⇒ 403 `CHE_DO_HOC_SINH`. */
export async function ghiTienDoHocThuMobile(hs: MaHocVienDaKiem, nguoi: NguoiGoi, slug: string, lessonId: string, body: TienDoHocThuBody, now = new Date()) {
  batNeuTatOnline();
  yeuCauHocSinhTuGhi(hs, nguoi);
  if (!baiHopLe(lessonId)) throw khongThay();
  await giuTanSuat(`free-tien-do:${nguoi.userId}`, 240);
  const k = await timKhoa(slug, now);
  const doc = await kiemTraTruyCapBaiMienPhi(db as never, { taiKhoanId: nguoi.userId, courseId: k.id, lessonStableId: lessonId, now });
  if (!doc.ok) throw loiFreeMode(doc.ma);
  // VIDEO tính xong theo ngưỡng của bản đang chạy (không cho client tự đánh dấu xong); READ xong khi `daDoc`.
  if (doc.bai.kind === "VIDEO" && (body.percent === undefined || body.daDoc !== undefined)) throw loiFreeMode("LOAI_BAI_KHONG_GHI_TRUC_TIEP");
  if (doc.bai.kind === "READ" && body.daDoc === undefined) throw loiFreeMode("LOAI_BAI_KHONG_GHI_TRUC_TIEP");
  const r = await ghiTienDoHocThu(db as never, {
    studentId: hs,
    courseId: k.id,
    lessonStableId: lessonId,
    percent: doc.bai.kind === "VIDEO" ? body.percent! : body.daDoc === true ? 100 : (body.percent ?? 0),
    ...(doc.bai.kind === "READ" ? { hoanThanh: body.daDoc === true } : {}),
    now,
  });
  if (!r.ok) throw baoLoiMoBai(r.ma, hs, k.id);
  return { tienDo: dtoTienDo(r.tienDo) };
}

// ───────────────────────── (S6) tự nhận khoá miễn phí (F2) ─────────────────────────

/**
 * `POST /students/:id/online/preview/courses/:slug/free-claim` — PHỤ HUYNH (chủ tài khoản) nhận khoá miễn phí cho con. Thân rỗng: khoá idempotency do MÁY CHỦ suy ra theo (học viên × khoá) nên gọi lại bao nhiêu lần
 * cũng không cộng thêm kỳ hạn. Gọi lại khi quyền ĐÃ hết hạn/bị thu hồi KHÔNG báo thành công (409 `DA_TUNG_CO_QUYEN`).
 */
export async function tuNhanKhoaMienPhiMobile(hs: MaHocVienDaKiem, nguoi: NguoiGoi, slug: string, now = new Date()) {
  batNeuTatOnline();
  yeuCauPhuHuynh(nguoi);
  await giuTanSuat(`free-tu-nhan:${nguoi.userId}`, 20);
  const k = await timKhoa(slug, now);
  const khoa = khoaTuNhan(hs, k.id);
  const lai = await db.onlEntitlementEvent.findUnique({ where: { idempotencyKey: khoa }, select: { entitlementId: true } });
  if (!lai) {
    const cs = await chinhSachCuaBan(k.publishedVersionId);
    const x = await xetTuNhan(hs, k, cs.dangKyMienPhi);
    if (!x.duoc) throw loiFreeMode(x.ma, x.maChiTiet);
  }
  const r = await tuNhanKhoaMienPhi(db as never, { studentId: hs, courseId: k.id, duDieuKien: true, idempotencyKey: khoa, now });
  if (!r.ok) throw loiFreeMode(r.ma);
  const q = await db.onlEntitlement.findUnique({ where: { id: r.ketQua.entitlementId }, select: { status: true, expiresAt: true, source: true } });
  const conHan = !!q && q.status === "ACTIVE" && (q.expiresAt === null || q.expiresAt.getTime() > now.getTime());
  if (r.ketQua.daXuLyTruocDo && !conHan) throw loiFreeMode("DA_TUNG_CO_QUYEN", q?.status === "ACTIVE" ? "HET_HAN" : "DA_THU_HOI");
  if (!r.ketQua.daXuLyTruocDo) {
    await writeAudit({
      actor: { id: nguoi.userId, name: "Phụ huynh (app)" },
      module: "elearning_online",
      entityType: "OnlEntitlement",
      entityId: r.ketQua.entitlementId,
      action: "FREE_MODE_SELF_CLAIM",
      newValues: { studentId: hs, courseId: k.id, source: "FREE_GRANT" },
      changedFields: ["studentId", "courseId", "source"],
    });
  }
  const daGiu = await db.onlFreeLessonProgress.count({ where: { studentId: hs, courseId: k.id, transferredEntitlementId: r.ketQua.entitlementId } });
  return {
    daNhanTruocDo: r.ketQua.daXuLyTruocDo,
    quyen: { courseId: k.id, slug: k.slug, nguon: "FREE_GRANT" as const, trangThai: "CON_HAN" as const, hetHanLuc: iso(q?.expiresAt ?? null) },
    soBaiHocThuDaGiu: daGiu,
    capNhatLuc: now.toISOString(),
  };
}
