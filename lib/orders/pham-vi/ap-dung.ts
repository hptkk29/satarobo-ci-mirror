// lib/orders/pham-vi/ap-dung.ts — CỬA MỞ SỚM duy nhất của đường tạo đơn thủ công vào mô hình thu theo phạm vi học.
//
// `createOrderManualAction` gọi `apDungMoHinhPhamVi` ĐÚNG MỘT LẦN (BANG-DIEU-PHOI §3: tệp nóng, 51 commit/30 ngày;
// mọi logic ở đây, chỗ gọi chỉ vài dòng). Thứ tự cố định:
//
//   1. không gắn cơ sở, hoặc cơ sở chưa ánh xạ OrgUnit      ⇒ LEGACY, KHÔNG đọc cờ (cờ khoá theo `orgUnitId`; "bật cho
//                                                              cơ sở của đơn" không có nghĩa khi không có cơ sở);
//   2. cờ `laThuHocPhiTheoPhamViBat(orgUnitId)` TẮT           ⇒ LEGACY, KHÔNG đọc thêm gì (không `docCheDoMocNgay`,
//                                                              không `getSetting` nào khác). Đây là "cờ TẮT ⇒ đường cũ
//                                                              y nguyên" — chỉ thêm đúng MỘT lần đọc cờ;
//   3. cờ BẬT ⇒ đọc mốc ngày + thứ tự con mặc định rồi giao cho `keHoachDon` (thuần).
//
// Nó KHÔNG tra `Course` lần hai: chỗ gọi đã có `giaKhoa` (`id, price, totalSessions`) cho cổng soát giá.
// Q1 (chủ dự án chốt 11/10/2026): giá 48 buổi = `Course.price` hiện hành. Đã đo: không có bảng giá cấu hình nào rõ hơn
// trong repo (`PricingPolicyVersion`/`CoursePrice` không tồn tại; `CoursePackage.priceOriginal/EarlyBird/Member` là giá
// HIỂN THỊ của trang công khai, `lib/courses/pricing.ts`, không phải bảng giá đơn) ⇒ `nguonGia48 = "Course.price"`,
// chụp vào snapshot cùng giá trị.
import "server-only";
import type { OrderCreateManualInput } from "@/lib/validators/order";
import { docCheDoMocNgay, docThuTuConMacDinh, laThuHocPhiTheoPhamViBat } from "@/lib/entitlements/feature";
import { cuaSoHieuLucPL02 } from "@/lib/pricing/hieu-luc-chinh-sach";
import { CHINH_SACH_KHONG_GIAM } from "@/lib/pricing/tinh-gia-theo-moc";
import { docHinhThucLop } from "@/lib/orders/hinh-thuc-lop";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { keHoachDon, xemTruocKeHoachDon, type DongVao, type KetQuaDon } from "./ke-hoach-don";

/** Nhãn nguồn giá 48 chụp vào snapshot (Q1). */
export const NGUON_GIA_48_COURSE_PRICE = "Course.price" as const;

export interface KhoaDeTinh {
  readonly id: string;
  readonly price: number | null;
  readonly totalSessions: number | null;
}

export interface ApDungVao {
  readonly centerId: string | null;
  /** `OrgUnit.id` của cơ sở đơn — người gọi đã suy (đã cần cho ngưỡng duyệt). */
  readonly orgUnitId: string | null;
  readonly items: OrderCreateManualInput["items"];
  /** Các dòng `Course` đã tra cho cổng soát giá. */
  readonly khoa: readonly KhoaDeTinh[];
  readonly coKeHoachDot: boolean;
  /** Ngày tạo đơn — người gọi truyền (hàm này không đọc đồng hồ). */
  readonly taoDon: Date;
}

const LEGACY: KetQuaDon = { kieu: "LEGACY" };

/** Đầu vào XEM TRƯỚC giá: như `ApDungVao` nhưng KHÔNG có `coKeHoachDot` (form phạm vi không gửi kế hoạch đợt). */
export type XemTruocVao = Omit<ApDungVao, "coKeHoachDot">;

/** Đường TẠO ĐƠN THẬT: có đối chiếu đơn giá client gửi. */
export async function apDungMoHinhPhamVi(vao: ApDungVao): Promise<KetQuaDon> {
  return tinhMoHinhPhamVi(vao, true);
}

/**
 * XEM TRƯỚC giá cho form tạo đơn — cùng cổng cờ, cùng đọc mốc ngày/thứ tự con, cùng planner; chỉ không đối chiếu đơn giá
 * khách gõ (xem `xemTruocKeHoachDon`). Chỉ ĐỌC. KHÔNG phải cổng: `createOrderManualAction` vẫn gọi `apDungMoHinhPhamVi`.
 */
export async function xemTruocMoHinhPhamVi(vao: XemTruocVao): Promise<KetQuaDon> {
  return tinhMoHinhPhamVi({ ...vao, coKeHoachDot: false }, false);
}

/**
 * Cờ phạm vi của từng cơ sở (`Center.id` → bật/tắt) cho TRANG TẠO ĐƠN, để form ẩn khối kế hoạch nhiều đợt đúng lúc.
 * Cùng đường với `tinhMoHinhPhamVi` bên dưới: cơ sở chưa ánh xạ OrgUnit ⇒ `false` và KHÔNG đọc cờ. Form không tự đọc cờ
 * và không biết khoá cờ — nó chỉ nhận kết quả này; máy chủ vẫn đọc lại cờ lúc lưu.
 */
export async function docCoSoBatPhamVi(centerIds: readonly string[]): Promise<Record<string, boolean>> {
  const ra = await Promise.all(
    centerIds.map(async (centerId) => {
      const orgUnitId = await orgUnitIdForCenter(centerId);
      return [centerId, orgUnitId ? await laThuHocPhiTheoPhamViBat(orgUnitId) : false] as const;
    }),
  );
  return Object.fromEntries(ra);
}

async function tinhMoHinhPhamVi(vao: ApDungVao, doiChieuGia: boolean): Promise<KetQuaDon> {
  if (!vao.centerId || !vao.orgUnitId) return LEGACY;
  if (!(await laThuHocPhiTheoPhamViBat(vao.orgUnitId))) return LEGACY;

  const [cheDoMocNgay, thuTuMacDinh] = await Promise.all([docCheDoMocNgay(), docThuTuConMacDinh()]);
  const khoaTheoId = new Map(vao.khoa.map((c) => [c.id, c] as const));

  const dong: DongVao[] = vao.items.map((it) => {
    const hinh = docHinhThucLop(it.metadata);
    const khoa = hinh.courseId ? khoaTheoId.get(hinh.courseId) : undefined;
    return {
      loai: it.type,
      tenDong: it.itemName,
      soLuong: it.quantity,
      donGiaKhach: it.unitPrice,
      soKhoanGiam: (it.discounts ?? []).length,
      laLopNhom: hinh.coachFormat === "GROUP",
      tongSoBuoiKhoa: khoa?.totalSessions ?? null,
      soBuoiMua: hinh.soBuoi,
      gia48: khoa?.price ?? null,
      conKhoa: it.studentId?.trim() || it.leadChildId?.trim() || null,
    };
  });

  const lap = doiChieuGia ? keHoachDon : xemTruocKeHoachDon;
  return lap(dong, {
    phamViBat: true,
    nguonGia48: NGUON_GIA_48_COURSE_PRICE,
    // KHÔNG tự cộng giảm theo mốc buổi / gói trọn / anh chị em vào giá [27/10/2026]: dòng SCOPE bán ĐÚNG niêm yết theo số buổi;
    // mức giảm đến từ chương trình khuyến mãi Sale chọn ở khoản giảm của dòng (mỗi khoản là một dòng nhìn thấy được).
    chinhSach: CHINH_SACH_KHONG_GIAM,
    hieuLuc: cuaSoHieuLucPL02(),
    cheDoMocNgay,
    thuTuMacDinh,
    taoDon: vao.taoDon,
    coKeHoachDot: vao.coKeHoachDot,
  });
}
