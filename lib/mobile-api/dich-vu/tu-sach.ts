import { z } from "zod";

import { writeAudit } from "@/lib/audit/audit-log";
import { db } from "@/lib/db";
import { isTuSachEnabled } from "@/lib/flags";
import { phuHuynhDuocTai } from "@/lib/portal/tu-sach";
import { rateLimit } from "@/lib/rate-limit";
import { CHU_DE_EBOOK, EBOOKS, khoaSach, type Ebook } from "@/lib/tu-sach/ebook";
import { SGK } from "@/lib/tu-sach/sgk";
import { soEbookHopLe, tenTepTai, TTL_LINK_TAI_GIAY, xinLinkTai, type KetQuaXinLink, type KhoTep } from "@/lib/tu-sach/tai";

import { khoLocal, khoLocalDangBat } from "../kho-tep-rieng";
import { LoiApiMobile, type NguoiGoi } from "../xac-thuc/dich-vu";

/**
 * «Tủ sách cho ba mẹ» (màn P-Tu-sach) — lớp MỎNG bọc đúng domain web (`lib/tu-sach/*`, `lib/portal/tu-sach.ts`); KHÔNG có danh mục / bảng / luật thứ hai.
 *
 *   · DANH MỤC: 20 ebook (`EBOOKS`) + 237 sách giáo khoa (`SGK`) là DỮ LIỆU TĨNH trong mã của web — «đã xuất bản» = có trong hai mảng đó (web không có cờ nháp/duyệt theo cuốn). Không có gì khác bị lộ.
 *     SGK chỉ là liên kết «đọc trực tuyến» của NXB Giáo dục (web không lưu/phát lại tệp) ⇒ không có nút tải cho SGK.
 *   · TỆP: PDF nằm ở bucket R2 RIÊNG `R2_TU_SACH_BUCKET_NAME` (không công khai; xem `bucket-pdf.ts`). Chỉ cấp URL KÝ GET ngắn hạn (`TTL_LINK_TAI_GIAY` = 300 giây ≤ 15 phút) qua ĐÚNG hàm `xinLinkTai` của web:
 *     chưa đủ điều kiện ⇒ không chạm kho; tệp chưa nhập ⇒ không ký. KHÔNG có đường lùi sang bucket công khai / `getPublicUrl` (kho chưa cấu hình ⇒ «đang cập nhật»).
 *   · ĐIỀU KIỆN TẢI = đúng luật cổng phụ huynh web (`/api/portal/tu-sach/tai`): hồ sơ (Lead cùng SĐT) ĐÃ có phường/xã — `phuHuynhDuocTai(userId)`. `userId` từ PHIÊN, không từ URL/thân.
 *   · Chế độ học sinh: `kiemCheDoHocSinh` từ chối mặc định mọi đường `/parent/library/**` (không nằm trong danh sách được xem) — cổng chung `cong.ts` ép trước khi vào đây; ở đây kiểm thêm `hocSinhId` (phòng thủ chiều sâu).
 *   · Cờ `TU_SACH_ENABLED` TẮT (mặc định) ⇒ 404 như web.
 *   · Web KHÔNG ghi sổ lượt tải; app ghi AuditLog `PH_TAI_EBOOK` TRƯỚC khi ký (không chép URL/khoá tệp). Ghi lỗi ⇒ không ký (503).
 *   · KHÔNG làm: ảnh trang đọc thử (web trả 302 sang bucket CÔNG KHAI — trái luật «tệp không bao giờ công khai» của app), lưu phường/xã (FM-Tu-sach, Owner chưa chốt OD-06).
 */

const khongThay = () => new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");

/** Trần số lượt xin liên kết tải theo phụ huynh — cùng số với web (`/api/portal/tu-sach/tai`: 60 lượt / 10 phút). */
export const GIOI_HAN_LIEN_KET_TU_SACH = { max: 60, windowMs: 10 * 60_000 } as const;

/** Bìa ebook là ảnh tĩnh CÔNG KHAI của web (`public/tu-sach/bia/<so>.jpg`, tài liệu quảng bá) — chỉ trả đường dẫn tương đối, app tự nối gốc. Không phải tệp sách. */
const duongDanBia = (so: number) => `/tu-sach/bia/${so}.jpg`;

// ───────────────────────── kho tệp (tiêm được) ─────────────────────────
// Thứ tự chọn: (1) bản giả của bộ test → (2) kho LOCAL (chỉ khi `MOBILE_UPLOAD_LOCAL_DIR` đặt VÀ không phải production, cùng cơ chế `layKhoTepRieng`) → (3) R2 bucket RIÊNG của Tủ sách (`khoTepR2`).
// Không còn nhánh nào khác: thiếu cấu hình ⇒ `khoTepR2.daCauHinh()` = false ⇒ «đang cập nhật».
let khoGhiDe: KhoTep | null = null;
/** Cho bộ test: thay kho bằng bản giả. `null` = bỏ ghi đè. */
export function datKhoTuSach(k: KhoTep | null): void {
  khoGhiDe = k;
}

/** Kho LOCAL (thử nghiệm cục bộ): khoá `tu-sach/ebook/<so>/sach.pdf` nằm trong thư mục `MOBILE_UPLOAD_LOCAL_DIR`; URL ký HMAC (hết hạn, khoá) phục vụ ở `/api/dev-kho/**`. */
export const khoLocalTuSach: KhoTep = {
  daCauHinh: () => true,
  tonTai: async (khoa) => (await khoLocal.dau(khoa)) !== null,
  async kyLinkTai(khoa, _tenTep, ttlGiay) {
    const url = await khoLocal.kyGet(khoa, ttlGiay);
    if (!url) throw new Error("kho local không ký được");
    return url;
  },
};

async function chonKho(): Promise<KhoTep> {
  if (khoGhiDe) return khoGhiDe;
  if (khoLocalDangBat()) return khoLocalTuSach;
  return (await import("@/lib/tu-sach/kho-r2")).khoTepR2;
}

function batNeuTat(): void {
  if (!isTuSachEnabled()) throw khongThay();
}

// ───────────────────────── DTO ─────────────────────────
export type EbookDto = {
  so: number;
  tieuDe: string;
  phuDe: string;
  moTa: string;
  /** Nguyên văn «đối tượng» của web (chuỗi tự do, vd "Phụ huynh có con lớp 5-9") — dữ liệu KHÔNG có độ tuổi/lớp có cấu trúc nên app không lọc theo tuổi. */
  doiTuong: string;
  chuDe: string;
  soTrang: number;
  /** Đường dẫn tương đối của ảnh bìa tĩnh (công khai, quảng bá). */
  anhBia: string;
};

export type TuSachDto = {
  /** Đã đủ điều kiện tải (hồ sơ có phường/xã). false ⇒ app KHÔNG vẽ nút tải sống (xin liên kết sẽ bị 403). */
  taiDuoc: boolean;
  /** Kho PDF đã cấu hình. false ⇒ «đang cập nhật» (không có tệp nào tải được). Không nói tệp nào đã có — web cũng không HEAD cả danh mục. */
  khoSanSang: boolean;
  /** Sáu chủ đề của dữ liệu (thiết kế mẫu liệt kê 4 nhãn — xem tài liệu). */
  chuDe: string[];
  ebooks: EbookDto[];
  /** Lớp (1–12) các con có khai lớp — để mở nhanh đúng lớp ở ngăn sách giáo khoa. Chỉ tên + lớp, không id học viên. */
  conCoKhaiLop: Array<{ ten: string; lop: number }>;
  soSachGiaoKhoa: number;
};

export type SachGiaoKhoaDto = {
  id: string;
  lop: number;
  ten: string;
  mon: string;
  tap: string;
  phu: string;
  tuChon: boolean;
  /** Liên kết «đọc trực tuyến» của NXB Giáo dục — mở bằng trình duyệt; Sata Robo không lưu/phát lại tệp. */
  url: string;
};

export type LienKetTaiEbookDto = { url: string; hetHanSauGiay: number; tenTep: string };

const dtoEbook = (e: Ebook): EbookDto => ({ so: e.so, tieuDe: e.tieuDe, phuDe: e.phuDe, moTa: e.moTa, doiTuong: e.doiTuong, chuDe: e.chuDe, soTrang: e.soTrang, anhBia: duongDanBia(e.so) });

export const sachGiaoKhoaQuery = z.object({
  grade: z.coerce.number().int("Lớp không hợp lệ.").min(1, "Lớp không hợp lệ.").max(12, "Lớp không hợp lệ.").optional(),
});
export type SachGiaoKhoaQuery = z.infer<typeof sachGiaoKhoaQuery>;

export const lienKetTaiEbookSchema = z.object({}).strict();

// ───────────────────────── dịch vụ ─────────────────────────
/** `GET /parent/library` — danh mục ebook + trạng thái điều kiện tải của phụ huynh. */
export async function layTuSach(nguoi: NguoiGoi): Promise<TuSachDto> {
  batNeuTat();
  if (nguoi.hocSinhId) throw new LoiApiMobile("FORBIDDEN", 403, "Đang ở chế độ học sinh.");
  const [taiDuoc, cons, kho] = await Promise.all([
    phuHuynhDuocTai(nguoi.userId),
    db.student.findMany({ where: { parentUserId: nguoi.userId, deletedAt: null }, select: { name: true, currentGrade: true }, orderBy: { createdAt: "asc" }, take: 8 }),
    chonKho(),
  ]);
  return {
    taiDuoc,
    khoSanSang: kho.daCauHinh(),
    chuDe: [...CHU_DE_EBOOK],
    ebooks: EBOOKS.map(dtoEbook),
    conCoKhaiLop: cons.flatMap((c) => (c.currentGrade !== null && c.currentGrade >= 1 && c.currentGrade <= 12 ? [{ ten: c.name, lop: c.currentGrade }] : [])),
    soSachGiaoKhoa: SGK.length,
  };
}

/** `GET /parent/library/textbooks?grade=` — sách giáo khoa NXBGD (liên kết ngoài). Không có `grade` ⇒ toàn bộ 237 cuốn theo thứ tự của web. */
export async function laySachGiaoKhoa(nguoi: NguoiGoi, q: SachGiaoKhoaQuery): Promise<{ sach: SachGiaoKhoaDto[] }> {
  batNeuTat();
  if (nguoi.hocSinhId) throw new LoiApiMobile("FORBIDDEN", 403, "Đang ở chế độ học sinh.");
  const ds = q.grade === undefined ? SGK : SGK.filter((s) => s.lop === q.grade);
  return { sach: ds.map((s) => ({ id: s.id, lop: s.lop, ten: s.ten, mon: s.mon, tap: s.tap, phu: s.phu, tuChon: s.tuChon, url: s.url })) };
}

/** Đổi kết quả `xinLinkTai` của web sang lỗi di động (mã sẵn có). 401 «chưa để lại thông tin» của web ⇒ 403 (401 làm app đi làm mới token). */
function dichLoi(kq: Extract<KetQuaXinLink, { ok: false }>): LoiApiMobile {
  switch (kq.loi) {
    case "SO_KHONG_HOP_LE":
      return new LoiApiMobile("VALIDATION", 400, "Mã cuốn sách không hợp lệ.");
    case "CHUA_DE_LAI_THONG_TIN":
      return new LoiApiMobile("FORBIDDEN", 403, "Hồ sơ gia đình chưa có phường/xã nên chưa tải được sách. Ba mẹ bổ sung phường/xã trong hồ sơ rồi quay lại nhé.");
    case "KHONG_CO_SACH":
      return khongThay();
    case "CHUA_CO_TEP":
      return new LoiApiMobile("NOT_FOUND", 404, "Cuốn này đang được cập nhật tệp tải về — ba mẹ quay lại sau ít hôm nhé.");
    case "LOI_KHO":
      return new LoiApiMobile("SERVER", 503, "Chưa tải được lúc này. Vui lòng thử lại sau.", 5);
  }
}

/**
 * `POST /parent/library/ebooks/:so/download-link` — cấp URL KÝ ngắn hạn (300 giây) tới PDF ở bucket RIÊNG. Thứ tự (rẻ → đắt, từ chối trước khi chạm kho):
 * cờ → chế độ học sinh → dạng mã → có trong danh mục → rate-limit → điều kiện tải (hồ sơ có phường/xã) → [xinLinkTai của web: kho cấu hình → tệp tồn tại → AUDIT → ký].
 */
export async function lienKetTaiEbook(nguoi: NguoiGoi, soTho: string): Promise<LienKetTaiEbookDto> {
  batNeuTat();
  if (nguoi.hocSinhId) throw new LoiApiMobile("FORBIDDEN", 403, "Đang ở chế độ học sinh.");
  // Mã chỉ là 1–3 chữ số (đi vào khoá R2) — chữ khác ⇒ 400 trước khi làm gì; số không có trong danh mục ⇒ 404 (cùng luật `xinLinkTai`).
  if (!/^[0-9]{1,3}$/.test(soTho)) throw new LoiApiMobile("VALIDATION", 400, "Mã cuốn sách không hợp lệ.");
  const so = soEbookHopLe(soTho);
  if (so === null) throw khongThay();
  const ebook = EBOOKS.find((e) => e.so === so);
  if (!ebook) throw khongThay();

  const rl = await rateLimit({ key: `mobile-tu-sach-tai:${nguoi.userId}`, max: GIOI_HAN_LIEN_KET_TU_SACH.max, windowMs: GIOI_HAN_LIEN_KET_TU_SACH.windowMs });
  if (!rl.success) throw new LoiApiMobile("RATE_LIMITED", 429, "Ba mẹ bấm hơi nhanh rồi — chờ ít phút rồi thử lại nhé.", Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)));

  const duocTai = await phuHuynhDuocTai(nguoi.userId);
  const kho = await chonKho();
  // Bọc kho: ghi dấu TRƯỚC khi ký (ném ⇒ `xinLinkTai` bắt ⇒ LOI_KHO ⇒ 503, không ký). Dấu không chứa URL / khoá tệp.
  const khoCoDau: KhoTep = {
    ...kho,
    kyLinkTai: async (khoa, tenTep, ttl) => {
      await writeAudit({
        actor: { id: nguoi.userId, name: nguoi.name || nguoi.email || nguoi.userId },
        module: "tu-sach",
        entityType: "TuSachEbook",
        entityId: String(ebook.so),
        action: "PH_TAI_EBOOK",
        newValues: { so: ebook.so, nguoiTai: "PHU_HUYNH", kenh: "APP" },
      });
      return kho.kyLinkTai(khoa, tenTep, ttl);
    },
  };
  const kq = await xinLinkTai({ soTho: String(ebook.so), daMoKhoa: duocTai, kho: khoCoDau });
  if (!kq.ok) throw dichLoi(kq);
  return { url: kq.url, hetHanSauGiay: TTL_LINK_TAI_GIAY, tenTep: tenTepTai(ebook) };
}

/** Khoá PDF của một ebook — xuất để test khẳng định khoá chỉ dựng từ số nguyên của danh mục (không nhận chuỗi từ client). */
export const khoaPdfEbook = (so: number): string => khoaSach.pdf(so);
