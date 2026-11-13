// lib/pricing/ke-hoach-dong-don.ts — PLANNER MỘT DÒNG ĐƠN: LEGACY | SCOPE | REJECT. THUẦN.
//
// 🔴 ĐÃ NỐI [11/10/2026] vào đường tạo đơn thủ công qua `lib/orders/pham-vi/ke-hoach-don.ts` (docs/thu-hoc-phi-pham-vi/NOI-TAO-DON.md),
// DƯỚI CỜ `billing.scopePurchaseEnabled` (TẮT mặc định, [CHN-01] canh các tệp được nối). Đây là bảng quyết định
// mà form và máy chủ phải dùng CHUNG: "dòng này đi đường cũ (kế hoạch nhiều đợt), đi mô hình phạm vi mới, hay bị
// từ chối". Máy chủ gọi nó, KHÔNG tin quyết định do client gửi.
//
// ── BẢNG QUYẾT ĐỊNH — thứ tự CỐ ĐỊNH, kết quả đầu tiên khớp thắng ──────────────────────────────────────
//   1. cờ TẮT                                     ⇒ LEGACY  `CO_TAT`
//   2. dòng không phải ghi danh khoá học          ⇒ LEGACY  `DONG_KHONG_PHAI_KHOA_HOC`   (sản phẩm, kit, phí học bù…)
//   3. khoá KHÔNG có đúng 48 buổi                 ⇒ LEGACY  `KHOA_NGOAI_PHAM_VI`
//      ── từ đây dòng là khoá 48 buổi, bật cờ ⇒ chỉ còn SCOPE hoặc REJECT, KHÔNG có đường tắt về LEGACY ──
//   4. số lượng ≠ 1                               ⇒ REJECT  `SO_LUONG_KHAC_1`
//   5. Coach 1-1 / 1-2 / 1-4                      ⇒ REJECT  `COACH_TREN_KHOA_48`
//   6. số buổi mua KHÔNG khai                     ⇒ REJECT  `SO_BUOI_CHUA_CHON`   (KHÔNG suy về 48)
//   7. số buổi ∉ {12, 24, 36, 48}                 ⇒ REJECT  `SO_BUOI_LE`
//   8. chính sách có số buổi cả gói ≠ hằng 48     ⇒ REJECT  `CHINH_SACH_LECH_SO_BUOI`
//   9. không tra được giá 48 (`null`)             ⇒ REJECT  `GIA_48_CHUA_CO`
//  10. giá 48 không phải số nguyên đồng dương     ⇒ REJECT  `GIA_48_KHONG_HOP_LE`
//  11. mốc ngày tiền về mà tiền chưa về           ⇒ REJECT  `CHUA_CO_NGAY_AP_GIA`
//  12. ngày áp giá ngoài cửa sổ hiệu lực          ⇒ REJECT  `NGOAI_CUA_SO_CHINH_SACH`
//  13. thứ tự con/sản phẩm hỏng · giá không chia hết thành đồng ⇒ REJECT `THU_TU_KHONG_HOP_LE` · `GIA_KHONG_NGUYEN_DONG`
//  14. còn lại                                    ⇒ SCOPE   (kèm báo giá + snapshot)
//
// ── MỌI ĐIỂM CHƯA CHỐT LÀ THAM SỐ BẮT BUỘC, KHÔNG PHẢI HẰNG ────────────────────────────────────────────
//   · giá 48 buổi (Q1)  → `gia48` + `nguonGia48`: NGUỒN GIÁ DO NGƯỜI GỌI TRUYỀN. File này KHÔNG đọc `Course.price`:
//                         trên prod nó có thể là giá early-bird, lấy làm gốc là giảm giá HAI lần.
//   · chính sách (Q11)  → `chinhSach`; cửa sổ hiệu lực → `hieuLuc` (nửa mở [tu, den)); mốc ngày → `cheDoMocNgay`.
//   · số buổi lẻ (MT-11), Coach trên khoá 48 buổi (Q10) → đợt đầu CỐ ĐỊNH là từ chối; mở ra khi BLĐ trả lời.
//
// ── "48" CÓ BA NGUỒN, ĐÂY LÀ NƠI BUỘC CHÚNG KHỚP ──────────────────────────────────────────────────────
// `TONG_SO_BUOI_KHOA_AP_LUAT` (luật duyệt mốc học phần) · `ChinhSachGia.soBuoiCaGoi` · `Course.totalSessions`. Phạm vi
// dòng lấy từ `xetSoBuoiDong().apLuat` (vị từ DUY NHẤT của luật 25/09); chính sách lệch hằng ⇒ từ chối (quy tắc 8).
//
// ⚠️ `xetSoBuoiDong` suy `soBuoiMua = null` về "mua đủ khoá" để luật DUYỆT không nổ trên đơn convert. Planner KHÔNG
// được thừa hưởng điều đó: số buổi quyết định cả GIÁ lẫn QUYỀN HỌC, nên không khai thì phải chọn rõ (quy tắc 6).
//
// ⛔ Không `Math.round/floor/ceil/trunc` ở bất kỳ đâu trong `lib/pricing/` (`[TGM-PIN-03]`).
import { SO_BUOI_HOP_LE, TONG_SO_BUOI_KHOA_AP_LUAT } from "@/lib/orders/so-buoi-hoc-phan";
// Hai vị từ phân loại (bước 2–3) nằm ở MỘT chỗ, dùng chung với form tạo đơn — xem đầu `phan-loai.ts`.
import { khoaTrongPhamVi, laDongGhiDanhKhoa } from "@/lib/orders/pham-vi/phan-loai";
import { LoiBaoGia, taoBaoGiaDong, type BaoGiaDong } from "./bao-gia-dong";
import {
  LoiGiaTheoMoc,
  chonNgayApGia,
  type CheDoMocNgay,
  type ChinhSachGia,
  type MaLoiGia,
} from "./tinh-gia-theo-moc";

/** Khớp `OrderItemType` của schema — kiểu chữ để file này không import Prisma. */
export type LoaiDongDon = "COURSE_ENROLLMENT" | "COURSE_PACKAGE" | "EXAM_REGISTRATION" | "PRODUCT" | "MAKEUP_FEE";

export interface DongDonVao {
  readonly loai: LoaiDongDon;
  readonly soLuong: number;
  /** `true` = lớp nhóm (`coachFormat = GROUP`). Coach 1-1 / 1-2 / 1-4 ⇒ `false`. */
  readonly laLopNhom: boolean;
  /** `Course.totalSessions` tra từ DB. `null` = không khai hoặc không phải khoá học. */
  readonly tongSoBuoiKhoa: number | null;
  /** Số buổi người bán chọn (ý định — client gửi). `null` = không khai. */
  readonly soBuoiMua: number | null;
  /** 1 = con thứ nhất trong đơn. */
  readonly thuTuCon: number;
  /** 1 = sản phẩm gói trọn thứ nhất của gia đình. */
  readonly thuTuSanPham48: number;
}

export interface BoiCanhKeHoach {
  /** Kết quả của `laThuHocPhiTheoPhamViBat(orgUnitId)` — người gọi đọc cờ, planner không đọc DB. */
  readonly phamViBat: boolean;
  /** Giá niêm yết gói 48 buổi (đồng) do người gọi tra từ NGUỒN ĐÃ CHỐT. `null` = không tra được. */
  readonly gia48: number | null;
  /** Nhãn nơi lấy `gia48`, chụp vào snapshot để về sau biết số này từ đâu ra. */
  readonly nguonGia48: string;
  readonly chinhSach: ChinhSachGia;
  /** Cửa sổ hiệu lực của chính sách, NỬA MỞ `[tu, den)`: ngày `den` đã ngoài cửa sổ. Người gọi đổi mốc ngày VN ra Date. */
  readonly hieuLuc: { readonly tu: Date; readonly den: Date };
  readonly cheDoMocNgay: CheDoMocNgay;
  readonly ngay: { readonly taoDon: Date; readonly tienVe?: Date | null };
}

export type LyDoLegacy = "CO_TAT" | "DONG_KHONG_PHAI_KHOA_HOC" | "KHOA_NGOAI_PHAM_VI";

export type MaTuChoi =
  | "SO_LUONG_KHAC_1"
  | "COACH_TREN_KHOA_48"
  | "SO_BUOI_CHUA_CHON"
  | "SO_BUOI_LE"
  | "CHINH_SACH_LECH_SO_BUOI"
  | "GIA_48_CHUA_CO"
  | "GIA_48_KHONG_HOP_LE"
  | "CHUA_CO_NGAY_AP_GIA"
  | "NGOAI_CUA_SO_CHINH_SACH"
  | "THU_TU_KHONG_HOP_LE"
  | "GIA_KHONG_NGUYEN_DONG"
  | "TINH_GIA_THAT_BAI";

/** Snapshot của báo giá + hai thứ planner biết mà `taoBaoGiaDong` không biết. Lưu nguyên lên dòng đơn. */
export type PricingSnapshotDong = BaoGiaDong["pricingSnapshot"] & {
  readonly nguonGia48: string;
  readonly hieuLucChinhSach: { readonly tu: string; readonly den: string };
};

export type KeHoachDongDon =
  | { readonly quyetDinh: "LEGACY"; readonly lyDo: LyDoLegacy }
  | {
      readonly quyetDinh: "SCOPE";
      readonly soBuoi: number;
      /** `FULL` (48) hoặc `MILESTONE` (12/24/36). Không bao giờ `CUSTOM` ở đợt đầu. */
      readonly loaiMua: "FULL" | "MILESTONE";
      readonly baoGia: BaoGiaDong;
      readonly pricingSnapshot: PricingSnapshotDong;
    }
  | { readonly quyetDinh: "REJECT"; readonly ma: MaTuChoi; readonly thongBao: string };

const tuChoi = (ma: MaTuChoi, thongBao: string): KeHoachDongDon => ({ quyetDinh: "REJECT", ma, thongBao });

const laSoNguyenDuong = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 1;

/** Mã lỗi giá → mã từ chối. `switch` vét cạn: thêm mã vào `MaLoiGia` mà quên ở đây là lỗi biên dịch. */
function maTuLoiGia(ma: MaLoiGia): MaTuChoi {
  switch (ma) {
    case "PRICE_NOT_INTEGER":
      return "GIA_KHONG_NGUYEN_DONG";
    case "THU_TU_KHONG_HOP_LE":
      return "THU_TU_KHONG_HOP_LE";
    case "GIA_KHONG_HOP_LE":
      return "GIA_48_KHONG_HOP_LE";
    case "SO_BUOI_KHONG_HOP_LE":
    case "SO_BUOI_LE_CHUA_CO_QUY_TAC":
    case "THIEU_PHAN_TRAM_NHAP_TAY":
    case "PHAN_TRAM_KHONG_HOP_LE":
      return "TINH_GIA_THAT_BAI";
  }
}

export function keHoachDongDon(dong: DongDonVao, boiCanh: BoiCanhKeHoach): KeHoachDongDon {
  if (!boiCanh.phamViBat) return { quyetDinh: "LEGACY", lyDo: "CO_TAT" };
  if (!laDongGhiDanhKhoa(dong.loai)) return { quyetDinh: "LEGACY", lyDo: "DONG_KHONG_PHAI_KHOA_HOC" };
  // Vị từ phạm vi DUY NHẤT của luật 25/09 (`xetSoBuoiDong().apLuat`, bọc ở `khoaTrongPhamVi`).
  if (!khoaTrongPhamVi(dong)) {
    return { quyetDinh: "LEGACY", lyDo: "KHOA_NGOAI_PHAM_VI" };
  }

  if (dong.soLuong !== 1) {
    return tuChoi("SO_LUONG_KHAC_1", `Dòng khoá ${TONG_SO_BUOI_KHOA_AP_LUAT} buổi mua theo phạm vi học chỉ được số lượng 1 (đang là ${dong.soLuong}). Mỗi con một dòng.`);
  }
  if (!dong.laLopNhom) {
    return tuChoi("COACH_TREN_KHOA_48", `Khoá ${TONG_SO_BUOI_KHOA_AP_LUAT} buổi chưa bán được theo hình thức Coach 1-1, 1-2, 1-4 ở mô hình thu theo phạm vi học. Hãy chọn lớp nhóm.`);
  }
  if (dong.soBuoiMua === null) {
    return tuChoi("SO_BUOI_CHUA_CHON", `Chưa chọn số buổi mua. Hãy chọn một trong các mốc ${SO_BUOI_HOP_LE.join(" / ")} buổi, hệ thống không tự hiểu là mua đủ khoá.`);
  }
  const soBuoi = dong.soBuoiMua;
  if (!SO_BUOI_HOP_LE.includes(soBuoi)) {
    return tuChoi("SO_BUOI_LE", `Số buổi ${soBuoi} không nằm trong các mốc ${SO_BUOI_HOP_LE.join(" / ")} buổi nên chưa định giá được. Hãy chọn một mốc.`);
  }
  if (boiCanh.chinhSach.soBuoiCaGoi !== TONG_SO_BUOI_KHOA_AP_LUAT) {
    return tuChoi(
      "CHINH_SACH_LECH_SO_BUOI",
      `Chính sách giá đang áp tính cho gói ${boiCanh.chinhSach.soBuoiCaGoi} buổi, trong khi khoá này có ${TONG_SO_BUOI_KHOA_AP_LUAT} buổi. Cần sửa chính sách trước khi bán.`,
    );
  }

  const gia48 = boiCanh.gia48;
  if (gia48 === null) {
    return tuChoi("GIA_48_CHUA_CO", "Chưa có giá niêm yết gói 48 buổi cho khoá này nên chưa báo giá được. Liên hệ quản trị để khai giá.");
  }
  if (!laSoNguyenDuong(gia48)) {
    return tuChoi("GIA_48_KHONG_HOP_LE", "Giá niêm yết gói 48 buổi phải là số nguyên đồng dương. Liên hệ quản trị để sửa giá.");
  }

  const ngayApGia = chonNgayApGia(boiCanh.cheDoMocNgay, boiCanh.ngay);
  if (ngayApGia === null) {
    return tuChoi("CHUA_CO_NGAY_AP_GIA", "Giá được chốt theo ngày tiền về nhưng đơn chưa có khoản tiền nào về, nên chưa chốt được giá.");
  }
  const t = ngayApGia.getTime();
  // Nửa mở [tu, den). So sánh viết dạng khẳng định để ngày hỏng (NaN) rơi vào nhánh TỪ CHỐI, không lọt qua.
  if (!(t >= boiCanh.hieuLuc.tu.getTime() && t < boiCanh.hieuLuc.den.getTime())) {
    return tuChoi("NGOAI_CUA_SO_CHINH_SACH", "Ngày áp giá nằm ngoài thời gian hiệu lực của chính sách giá hiện hành, nên không báo giá theo phạm vi học được.");
  }

  let baoGia: BaoGiaDong;
  try {
    baoGia = taoBaoGiaDong({
      gia48,
      soBuoi,
      thuTuCon: dong.thuTuCon,
      thuTuSanPham48: dong.thuTuSanPham48,
      chinhSach: boiCanh.chinhSach,
      quyTacBuoiLe: "TU_CHOI",
      cheDoMocNgay: boiCanh.cheDoMocNgay,
      ngay: boiCanh.ngay,
    });
  } catch (e) {
    // CHỈ nuốt lỗi của luật giá. Lỗi lập trình (TypeError…) phải nổi lên, không được thành "từ chối" êm ru.
    if (e instanceof LoiGiaTheoMoc) return tuChoi(maTuLoiGia(e.ma), mauThongBaoGia(e.ma, soBuoi));
    if (e instanceof LoiBaoGia) return tuChoi("CHUA_CO_NGAY_AP_GIA", "Chưa chốt được ngày áp giá.");
    throw e;
  }

  const loaiMua = baoGia.gia.loai;
  if (loaiMua === "CUSTOM") {
    // Không thể xảy ra vì quy tắc 7 đã loại số buổi lẻ. Giữ nhánh để nếu bảng A/B đổi mà lọt CUSTOM thì từ chối chứ không bán.
    return tuChoi("SO_BUOI_LE", `Số buổi ${soBuoi} không có trong bảng giá nên chưa định giá được.`);
  }

  return {
    quyetDinh: "SCOPE",
    soBuoi,
    loaiMua,
    baoGia,
    pricingSnapshot: {
      ...baoGia.pricingSnapshot,
      nguonGia48: boiCanh.nguonGia48,
      hieuLucChinhSach: { tu: boiCanh.hieuLuc.tu.toISOString(), den: boiCanh.hieuLuc.den.toISOString() },
    },
  };
}

function mauThongBaoGia(ma: MaLoiGia, soBuoi: number): string {
  switch (ma) {
    case "PRICE_NOT_INTEGER":
      return `Giá ${soBuoi} buổi tính ra không tròn đồng. Hệ thống không làm tròn tiền; liên hệ quản trị để kiểm tra giá niêm yết gói 48 buổi.`;
    case "THU_TU_KHONG_HOP_LE":
      return "Thứ tự con hoặc thứ tự sản phẩm trong đơn không hợp lệ. Hãy chọn lại thứ tự các con.";
    case "GIA_KHONG_HOP_LE":
      return "Giá niêm yết gói 48 buổi không hợp lệ. Liên hệ quản trị để sửa giá.";
    default:
      return `Không tính được giá ${soBuoi} buổi theo chính sách hiện hành.`;
  }
}
