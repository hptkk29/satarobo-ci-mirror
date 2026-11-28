// lib/finance/hoa-don/engine/phan-loai-nghia-vu.ts — PHÂN LOẠI nghĩa vụ hoá đơn từ dữ liệu SẴN CÓ. THUẦN: không
// Prisma, không DB, không env, không đồng hồ. Engine SHADOW (lát S3) — chưa nối luồng nào, không ghi tiền.
//
// Nguồn: docs/ke-toan-hoa-don/hub/audit/02-tien-don-hang-coc-hoan.md §9.1. Mỗi KHOẢN THU THẬT (`Payment`) sinh tối
// đa MỘT nghĩa vụ; nghĩa vụ chỉ là BẢN CHIẾU của sổ tiền, không phải sổ tiền thứ ba (TD-02).
//
// ─────────────────────────────────────────────────────────────────────────────
// BA LUẬT KHÔNG THƯƠNG LƯỢNG
//
//   1. SỐ TIỀN = `soTienRong` (nguon-khoan.ts) trên MỌI dòng của đơn. Không bao giờ từ `PaymentRequest` (phiếu
//      thu chỉ là kế hoạch phải thu — tiền mặt không sinh phân bổ nên đợt PARTIAL vĩnh viễn dù đã đủ, `[LT-05]`).
//      Lưới `[ENG-LUOI-01]` cấm cả tên cột tiền của phiếu trong mã của thư mục này.
//   2. KHÔNG ĐOÁN LOẠI. Loại khoản lấy từ `OrderItem.type` của dòng đơn mà `Payment.orderItemId` trỏ tới; không
//      trỏ tới dòng nào mà đơn có nhiều loại dòng ⇒ `CHO_QUYET` (`LOAI_KHOAN_MO_HO`). Khoản dư (`TIEN_THUA`),
//      lần thu thiếu/nghi trùng, đợt huỷ, đơn huỷ cũng `CHO_QUYET` — người quyết, máy không tự xuất.
//   3. `THU_TRUOC` CHỈ đến từ tín hiệu người gọi truyền vào (`thuTruocPaymentIds`) — hôm nay không có cột nào nói
//      "đây là cọc" (audit 02 §3.1). Bản chất pháp lý của nó là OD-03 (chưa trả lời): `chinhSachThuTruoc` quyết
//      khoản thu trước coi như học phí (`NHU_HOC_PHI` — đúng hành vi hiện tại) hay chờ người quyết.
//
// Khoá nguồn: `PAYMENT:<paymentId>` (một khoản thu) · `BILLING:<orderItemId>` (nghĩa vụ theo dòng đơn, chỉ ở chế độ
// `THEO_KHOAN_THU_VA_DONG_DON` và luôn `CHO_QUYET` — chính sách "lập theo hoàn tất / dừng học" chưa chốt, OD-05).

import { createHash } from "node:crypto";
import { donCoKhoanNganHang, phanLoaiKhoan, type LyDoLoai } from "../du-dieu-kien";
import type { DonVaoHangCho } from "../dong-hang-cho";
import { dotVaoTuPhieu, gomLanThu, type GiaoDichVao, type LanThu } from "../lan-thu";
import { LY_DO_DA_XUAT_NGOAI } from "../ly-do-khong-xuat";
import { nguonGiaoDich, soTienRong } from "../nguon-khoan";

export type LoaiNghiaVu =
  | "THU_TIEN"
  | "THU_HOC_CU"
  | "THU_LE_PHI_THI"
  | "THU_PHI_HOC_BU"
  | "THU_TRUOC"
  | "DIEU_CHINH_GIAM"
  /** Chỉ đi kèm trạng thái `CHO_QUYET` (hoặc khoản đã khoá vào hoá đơn): không xác định được loại khoản thì không bịa. */
  | "CHUA_PHAN_LOAI";

export type TrangThaiNghiaVu = "CHO_XUAT" | "DANG_XU_LY" | "DA_XUAT" | "KHONG_XUAT" | "CHO_QUYET";

export type LyDoChoQuyet =
  | "NGHI_TRUNG"
  | "LAN_THU_THIEU"
  | "DOT_DA_HUY"
  | "DON_DA_HUY"
  | "TIEN_THUA"
  | "LOAI_KHOAN_MO_HO"
  | "THU_TRUOC_CHO_QUYET"
  | "DIEU_CHINH_CHUA_CHOT"
  | "LAP_THEO_DONG_CHUA_CHOT";

export type NguonNghiaVu = { loai: "PAYMENT"; paymentId: string } | { loai: "BILLING"; orderItemId: string };

export type NghiaVu = {
  khoa: string;
  nguon: NguonNghiaVu;
  loai: LoaiNghiaVu;
  orderId: string;
  maDon: string;
  centerId: string;
  orderItemId: string | null;
  /** VND, luôn DƯƠNG. Với `DIEU_CHINH_GIAM` là độ lớn của khoản giảm. */
  soTien: number;
  trangThai: TrangThaiNghiaVu;
  lyDoChoQuyet: LyDoChoQuyet | null;
  hoaDonId: string | null;
  /** `DIEU_CHINH_GIAM`: khoản GỐC (đã nằm trong hoá đơn đã xác nhận) mà dòng âm này trỏ về. */
  khoanGocId: string | null;
  /** Dấu vân tay NGUỒN (khoá · loại · đơn · cơ sở · dòng đơn · số ròng · khoản gốc) — đổi nguồn là đổi dấu; KHÔNG gồm trạng thái. */
  sourceHash: string;
};

export type KhongSinh = { paymentId: string; lyDo: LyDoLoai | "THIEU_CO_SO" };

export type DongDonNghiaVu = {
  id: string;
  /** `OrderItem.type`. */
  type: string;
  /** `OrderItem.status`: ACTIVE · STOPPED. */
  trangThai: string;
  /** `OrderItem.usedValue` — quyết toán khi con dừng học. */
  usedValue: number | null;
};

export type DonVaoNghiaVu = Pick<DonVaoHangCho, "id" | "code" | "type" | "status" | "centerId" | "deletedAt" | "paymentRequests" | "payments"> & {
  hoaDonDienTu: {
    id: string;
    trangThai: string;
    xacNhanLuc: Date | null;
    /** Lý do bản KHONG_XUAT — "Đã xuất ngoài hệ thống" nghĩa là khách CÓ tờ hoá đơn ở MISA (cùng `canDieuChinh`). */
    lyDo: string | null;
    /** Mốc của bản KHONG_XUAT (lúc đánh dấu = lúc tạo bản ghi). */
    createdAt: Date;
    khoan: { paymentId: string; soTien: number }[];
  }[];
};

export type DauVaoPhanLoai = {
  don: DonVaoNghiaVu;
  /** Dòng đơn của ĐƠN NÀY. Rỗng ⇒ rơi về `don.type` (chỉ loại đơn thuần nhất mới suy được). */
  dongDon: readonly DongDonNghiaVu[];
  giaoDich: readonly GiaoDichVao[];
  giaoDichChuaKhop: readonly { amount: number }[];
  /** Tín hiệu "thu trước" do NGƯỜI GỌI giải (vd. từ nhật ký `THU_TRUOC_TAO` + phân bổ đợt 1). BẮT BUỘC (luật 7). */
  thuTruocPaymentIds: ReadonlySet<string>;
  chinhSachThuTruoc: "NHU_HOC_PHI" | "CHO_QUYET";
  /** BẮT BUỘC (luật 7): quên là nghĩa vụ theo dòng đơn lặng lẽ không bao giờ sinh. */
  cheDo: "THEO_KHOAN_THU" | "THEO_KHOAN_THU_VA_DONG_DON";
};

export type KetQuaPhanLoai = {
  nghiaVu: NghiaVu[];
  /** Khoản KHÔNG sinh nghĩa vụ + vì sao (chuyển nội bộ · nhập lịch sử · từ chối · âm · đã đảo hết · thiếu cơ sở …). */
  khongSinh: KhongSinh[];
  /** Số khoản thiếu cơ sở (cùng cách đếm `dungDongHangCho.thieuCoSo`). */
  thieuCoSo: number;
};

// ── KHOÁ NGUỒN ────────────────────────────────────────────────────────────

export const khoaPayment = (paymentId: string): string => `PAYMENT:${paymentId}`;
export const khoaBilling = (orderItemId: string): string => `BILLING:${orderItemId}`;

export function docKhoaNguon(khoa: string): NguonNghiaVu | null {
  const m = /^(PAYMENT|BILLING):(.+)$/.exec(khoa);
  if (!m) return null;
  return m[1] === "PAYMENT" ? { loai: "PAYMENT", paymentId: m[2]! } : { loai: "BILLING", orderItemId: m[2]! };
}

// ── BẢNG ÁNH XẠ ───────────────────────────────────────────────────────────

type LoaiKhoanThuan = "THU_TIEN" | "THU_HOC_CU" | "THU_LE_PHI_THI" | "THU_PHI_HOC_BU";

const LOAI_THEO_DONG_DON = new Map<string, LoaiKhoanThuan>([
  ["COURSE_ENROLLMENT", "THU_TIEN"],
  ["COURSE_PACKAGE", "THU_TIEN"],
  ["PRODUCT", "THU_HOC_CU"],
  ["EXAM_REGISTRATION", "THU_LE_PHI_THI"],
  ["MAKEUP_FEE", "THU_PHI_HOC_BU"],
]);

/** Loại đơn → loại khoản, CHỈ khi dòng đơn không cho biết. COMBO cố ý vắng: một gói gộp chưa tách loại thì không bịa. */
const LOAI_THEO_LOAI_DON = new Map<string, LoaiKhoanThuan>([
  ["COURSE", "THU_TIEN"],
  ["PACKAGE", "THU_TIEN"],
  ["PRODUCT", "THU_HOC_CU"],
  ["EXAM", "THU_LE_PHI_THI"],
]);

/** Trạng thái hoá đơn còn hiệu lực → trạng thái nghĩa vụ. Trạng thái lạ KHÔNG có trong bảng ⇒ `CHO_QUYET`, không đoán. */
const TRANG_THAI_THEO_HOA_DON = new Map<string, TrangThaiNghiaVu>([
  ["NHAP", "DANG_XU_LY"],
  ["DANG_PHAT_HANH", "DANG_XU_LY"],
  ["LOI_PHAT_HANH", "DANG_XU_LY"],
  ["DA_XAC_NHAN", "DA_XUAT"],
  ["KHONG_XUAT", "KHONG_XUAT"],
]);

/**
 * Mốc (ms) mà dòng tiền tạo SAU nó thì hoá đơn thành "lệch": `null` = hoá đơn này không phải tờ khách đang giữ nên không có
 * gì để điều chỉnh. CÙNG hai nhánh với `canDieuChinh` (can-dieu-chinh.ts): bản ĐÃ XÁC NHẬN lấy `xacNhanLuc` (thiếu mốc thì
 * −∞ — thà báo thừa); bản KHONG_XUAT mang lý do "Đã xuất ngoài hệ thống" lấy lúc tạo bản ghi. Lý do khác ("Khách không lấy
 * hoá đơn") KHÔNG có tờ nào để điều chỉnh.
 */
function mocDieuChinh(hd: DonVaoNghiaVu["hoaDonDienTu"][number]): number | null {
  if (hd.trangThai === "DA_XAC_NHAN") return hd.xacNhanLuc?.getTime() ?? Number.NEGATIVE_INFINITY;
  if (hd.trangThai === "KHONG_XUAT" && hd.lyDo === LY_DO_DA_XUAT_NGOAI) return hd.createdAt.getTime();
  return null;
}

/** Loại khoản của MỘT khoản: `null` = mơ hồ. */
function loaiCuaKhoan(orderItemId: string | null, dongDon: readonly DongDonNghiaVu[], loaiDon: string): LoaiKhoanThuan | null {
  if (orderItemId != null) {
    // Trỏ tới dòng đơn không có trong danh sách = dữ liệu lệch ⇒ mơ hồ, KHÔNG rơi về suy theo cả đơn.
    const d = dongDon.find((x) => x.id === orderItemId);
    return d ? (LOAI_THEO_DONG_DON.get(d.type) ?? null) : null;
  }
  if (dongDon.length === 0) return LOAI_THEO_LOAI_DON.get(loaiDon) ?? null;
  const tap = new Set(dongDon.map((d) => LOAI_THEO_DONG_DON.get(d.type) ?? null));
  if (tap.size !== 1) return null;
  const [duy] = [...tap];
  return duy ?? null;
}

const dauVanTay = (n: Omit<NghiaVu, "sourceHash">): string =>
  createHash("sha256")
    .update(JSON.stringify([n.khoa, n.loai, n.orderId, n.centerId, n.orderItemId, n.soTien, n.khoanGocId]))
    .digest("hex")
    .slice(0, 32);

function gan(n: Omit<NghiaVu, "sourceHash">): NghiaVu {
  return { ...n, sourceHash: dauVanTay(n) };
}

// ── PHÂN LOẠI ─────────────────────────────────────────────────────────────

export function phanLoaiNghiaVu(vao: DauVaoPhanLoai): KetQuaPhanLoai {
  const { don } = vao;
  const rong = soTienRong(don.payments);
  const khoaVaoHoaDon = new Map<string, DonVaoNghiaVu["hoaDonDienTu"][number]>();
  for (const hd of don.hoaDonDienTu) for (const k of hd.khoan) if (!khoaVaoHoaDon.has(k.paymentId)) khoaVaoHoaDon.set(k.paymentId, hd);

  const nghiaVu: NghiaVu[] = [];
  const khongSinh: KhongSinh[] = [];
  let thieuCoSo = 0;

  const hangCho: typeof don.payments = [];
  const donHuy: typeof don.payments = [];
  const daKhoa: typeof don.payments = [];
  const dieuChinh: { p: (typeof don.payments)[number]; hd: DonVaoNghiaVu["hoaDonDienTu"][number] }[] = [];

  for (const p of don.payments) {
    if (khoaVaoHoaDon.has(p.id)) {
      daKhoa.push(p);
      continue;
    }
    // Dòng ÂM trỏ về khoản gốc đã nằm trong hoá đơn mà khách ĐANG GIỮ (đã xác nhận, hoặc "đã xuất ngoài hệ thống"), tạo
    // SAU mốc của hoá đơn ⇒ nghĩa vụ điều chỉnh giảm. Xét TRƯỚC `phanLoaiKhoan` (nó loại mọi dòng âm vì "không phải khoản thu").
    if (p.amount < 0 && p.adjustmentOfId != null && p.deletedAt == null) {
      const hd = khoaVaoHoaDon.get(p.adjustmentOfId);
      const moc = hd ? mocDieuChinh(hd) : null;
      if (hd && moc != null && p.createdAt.getTime() > moc) {
        dieuChinh.push({ p, hd });
        continue;
      }
    }
    const pl = phanLoaiKhoan(p, don, rong.get(p.id) ?? 0);
    if (pl.vao === "HANG_CHO") hangCho.push(p);
    else if (pl.vao === "DON_DA_HUY") donHuy.push(p);
    else if (pl.vao === "THIEU_CO_SO") {
      thieuCoSo += 1;
      khongSinh.push({ paymentId: p.id, lyDo: "THIEU_CO_SO" });
    } else khongSinh.push({ paymentId: p.id, lyDo: pl.lyDo });
  }

  // Đơn không cơ sở không tạo được hoá đơn (centerId NOT NULL) ⇒ không nghĩa vụ nào — cùng cách `dungDongHangCho`.
  if (!don.centerId) return { nghiaVu: [], khongSinh, thieuCoSo };
  const centerId = don.centerId;

  const loaiVaTruoc = (p: (typeof don.payments)[number]): LoaiNghiaVu | null => {
    const l = loaiCuaKhoan(p.orderItemId, vao.dongDon, don.type);
    return l === "THU_TIEN" && vao.thuTruocPaymentIds.has(p.id) ? "THU_TRUOC" : l;
  };

  // ── Lần thu của các khoản đang chờ — CÙNG `gomLanThu` mà hàng chờ dùng (một định nghĩa "lần thu", luật 12).
  const phanBo = don.paymentRequests.flatMap((r) => r.allocations);
  const dot = don.paymentRequests.map(dotVaoTuPhieu);
  const coCK = donCoKhoanNganHang(don.payments, don, rong);
  const lanThuCua = new Map<string, LanThu>();
  for (const lt of gomLanThu({
    tachTheoCon: true,
    khoan: hangCho.map((p) => ({ id: p.id, rong: rong.get(p.id) ?? 0, nguon: nguonGiaoDich(p.note), paidDate: p.paidDate, orderItemId: p.orderItemId })),
    giaoDich: vao.giaoDich,
    phanBo,
    dot,
    gop: [],
    giaoDichChuaKhop: vao.giaoDichChuaKhop,
    donCoKhoanNganHang: coCK,
  })) {
    for (const id of lt.khoanIds) lanThuCua.set(id, lt);
  }

  const dung = (
    p: (typeof don.payments)[number],
    loai: LoaiNghiaVu | null,
    trangThai: TrangThaiNghiaVu,
    lyDoChoQuyet: LyDoChoQuyet | null,
    hoaDonId: string | null,
  ) => {
    nghiaVu.push(
      gan({
        khoa: khoaPayment(p.id),
        nguon: { loai: "PAYMENT", paymentId: p.id },
        loai: loai ?? "CHUA_PHAN_LOAI",
        orderId: don.id,
        maDon: don.code,
        centerId,
        orderItemId: p.orderItemId,
        soTien: rong.get(p.id) ?? 0,
        trangThai,
        lyDoChoQuyet,
        hoaDonId,
        khoanGocId: null,
      }),
    );
  };

  // Khoản ĐÃ KHOÁ vào hoá đơn: trạng thái theo hoá đơn; loại khoản vẫn suy như thường.
  for (const p of daKhoa) {
    const hd = khoaVaoHoaDon.get(p.id)!;
    const tt = TRANG_THAI_THEO_HOA_DON.get(hd.trangThai);
    dung(p, loaiVaTruoc(p), tt ?? "CHO_QUYET", null, hd.id);
  }

  // Khoản CHỜ: lý do chờ-quyết theo thứ tự — các lý do của LẦN THU trước (hàng chờ cũng đưa chúng sang ngăn "lệch"),
  // rồi tới các lý do chỉ engine mới siết.
  for (const p of hangCho) {
    const lt = lanThuCua.get(p.id);
    const loai = loaiVaTruoc(p);
    let ly: LyDoChoQuyet | null = null;
    if (lt?.trangThai === "NGHI_TRUNG") ly = "NGHI_TRUNG";
    else if (lt?.trangThai === "THIEU") ly = "LAN_THU_THIEU";
    else if (lt?.trangThai === "DOT_HUY") ly = "DOT_DA_HUY";
    else if (lt != null && lt.phaiThu != null && lt.ngoaiDot > 0) ly = "TIEN_THUA";
    else if (loai === null) ly = "LOAI_KHOAN_MO_HO";
    else if (loai === "THU_TRUOC" && vao.chinhSachThuTruoc === "CHO_QUYET") ly = "THU_TRUOC_CHO_QUYET";
    dung(p, loai, ly ? "CHO_QUYET" : "CHO_XUAT", ly, null);
  }

  // Khoản của đơn đã huỷ / hoàn: ngăn riêng, hoàn hay xuất do NGƯỜI quyết.
  for (const p of donHuy) dung(p, loaiVaTruoc(p), "CHO_QUYET", "DON_DA_HUY", null);

  // Điều chỉnh giảm: luôn chờ người quyết (điều chỉnh / thay thế / huỷ là OD-10 — chưa trả lời).
  for (const { p, hd } of dieuChinh) {
    nghiaVu.push(
      gan({
        khoa: khoaPayment(p.id),
        nguon: { loai: "PAYMENT", paymentId: p.id },
        loai: "DIEU_CHINH_GIAM",
        orderId: don.id,
        maDon: don.code,
        centerId,
        orderItemId: p.orderItemId,
        soTien: -p.amount,
        trangThai: "CHO_QUYET",
        lyDoChoQuyet: "DIEU_CHINH_CHUA_CHOT",
        hoaDonId: hd.id,
        khoanGocId: p.adjustmentOfId,
      }),
    );
  }

  if (vao.cheDo === "THEO_KHOAN_THU_VA_DONG_DON") {
    for (const d of vao.dongDon) {
      if (d.trangThai !== "STOPPED" || d.usedValue == null || d.usedValue <= 0) continue;
      nghiaVu.push(
        gan({
          khoa: khoaBilling(d.id),
          nguon: { loai: "BILLING", orderItemId: d.id },
          loai: LOAI_THEO_DONG_DON.get(d.type) ?? "CHUA_PHAN_LOAI",
          orderId: don.id,
          maDon: don.code,
          centerId,
          orderItemId: d.id,
          soTien: d.usedValue,
          trangThai: "CHO_QUYET",
          lyDoChoQuyet: "LAP_THEO_DONG_CHUA_CHOT",
          hoaDonId: null,
          khoanGocId: null,
        }),
      );
    }
  }

  nghiaVu.sort((a, b) => a.khoa.localeCompare(b.khoa));
  khongSinh.sort((a, b) => a.paymentId.localeCompare(b.paymentId));
  return { nghiaVu, khongSinh, thieuCoSo };
}
