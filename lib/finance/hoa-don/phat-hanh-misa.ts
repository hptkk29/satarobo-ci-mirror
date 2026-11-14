import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { khoaDonTrongTx } from "@/lib/finance/ghi-tien-don";
import { LoiXacNhanKhoan } from "@/lib/finance/payment";
import type { ActionScopeActor } from "@/lib/lms/report-card-core";
import type { CongHoaDon, KetQuaPhatHanh, KetQuaTraCuu, LoaiTep, PhieuPhatHanh } from "@/lib/misa/meinvoice/cong";
import { kiemPhieu } from "@/lib/misa/meinvoice/anh-xa";
import { hoanTatChotTrongTx, kiemCongChotTrongTx, LoiChotHoaDon, type KetQuaChot } from "./chot-hoa-don";
import { COT_NGUOI_MUA } from "./ghi-hoa-don";
import { nguoiMuaChoDon, thieuChoHoaDon, type NguoiMuaHoaDon } from "./nguoi-mua";
import { nguoiMuaChoLoDem, type ThamSoTieuDung } from "./xuat-lo-dem/nguoi-mua-tieu-dung";
import { bamNguoiMua } from "./bam-nguoi-mua";
import { khoanDaKhoaHoaDon, thongDiepKhoaHoaDon } from "./khoa-khoan";
import { giuChoHanMucTrongTx } from "./ky-chinh-sach/ky-chinh-sach-db";
import { chonHoaDonDuocThay } from "./thay-the";
import { laPhapNhanPhatHanhQuaApi, nhaCungCapApiCuaPhapNhan, nhaCungCapHieuLuc, phapNhanVoiNhaCungCap, type NhaCungCapApi, type PhapNhan } from "./phap-nhan";
import { docNhaCungCapDaChon, khoaNhaCungCapDungChung } from "./ket-noi/ket-noi-db";
import { cauHinhHoaDonChoMoiTruong } from "./phap-nhan-theo-moi-truong";
import { phapNhanPhatHanhChoCoSo } from "./cau-hinh-co-so";
import { docCauHinhDangBatTrongTx } from "./cau-hinh-co-so-db";
import { dungPhieuPhatHanh, LoiDungPhieu, phieuTuJson } from "./phieu-phat-hanh";
import { khoaTepHoaDon, luuTepHoaDon, xoaTepHoaDon } from "./kho-tep";
import { bamPhieuLuotGoi, CAU_KHONG_GHI_DUOC_NHAT_KY, goiCoNhatKy, LoiNhatKyLuotGoi, phanLoaiKetQua } from "./nhat-ky-luot-goi";
import { baoNgoaiLeTucThoi } from "./ngoai-le-tuc-thoi-db";
import { loaiQuaHan } from "./ngoai-le-tuc-thoi";
import { soTienRong } from "./nguon-khoan";
import type { DongHoaDon } from "./tinh-hoa-don";

// lib/finance/hoa-don/phat-hanh-misa.ts — MÁY TRẠNG THÁI "Phát hành qua MISA" (bước 1 bán tự động,
// chủ dự án duyệt 30/09/2026; docs/ke-toan-hoa-don/PLAN.md mục "Bước 1 — Phát hành qua MISA").
//
//   (cho/lệch) ──batDauPhatHanh──▶ DANG_PHAT_HANH ──guiPhatHanh──▶ MISA
//                                     │  DA_PHAT_HANH ⇒ ghi số NGAY → tải PDF+XML vào kho → DA_XAC_NHAN
//                                     │                 (hệ quả sau-xác-nhận DÙNG CHUNG với `chotHoaDon`)
//                                     │  TU_CHOI      ⇒ LOI_PHAT_HANH ──phatHanhLai──▶ DANG_PHAT_HANH (refId MỚI)
//                                     │                               ──boPhatHanhLamTay──▶ (xoá, nhả khoản)
//                                     └  KHONG_RO     ⇒ giữ nguyên; `kiemTraLai` / cron `traCuu(refId)`:
//                                                       DA_PHAT_HANH ⇒ đi tiếp · CHUA_CO ⇒ gửi lại CÙNG refId
//
// ⚠️ BA KẾT QUẢ, KHÔNG PHẢI HAI (hợp đồng `lib/misa/meinvoice/cong.ts`): lỗi mạng / timeout / ném bất kỳ
// ⇒ KHONG_RO, KHÔNG BAO GIỜ coi là "chưa phát hành". refId sinh MỘT LẦN lúc tạo bản ghi; mọi lượt gửi lại
// đọc refId + phiếu ĐÃ LƯU (`misaRefId`, `misaPhieu`). refId MỚI chỉ ở `phatHanhLai` — sau TU_CHOI, khi
// MISA đã nói chắc chưa có hoá đơn nào.
// ⚠️ Gọi MISA NGOÀI transaction (một lượt HTTP chậm không được giữ khoá đơn). Mọi phép ghi trạng thái là
// `updateMany` CÓ ĐIỀU KIỆN theo trạng thái — hai lượt (người bấm "Kiểm tra lại" + cron) chạy chồng thì một
// lượt đổi 0 dòng và dừng.
// ⚠️ Cổng là THAM SỐ — người gọi lấy bằng `layCongHoaDon()` (`cong-phat-hanh.ts`), không tự dựng.
// ⚠️ Thông điệp lưu lên `misaLoiThongDiep` là thứ KẾ TOÁN đọc trên màn. Lỗi KỸ THUẬT (mạng, kho tệp, DB, bug)
// ⇒ câu NGHIỆP VỤ nói việc gì chưa xong + hệ thống sẽ làm gì; chi tiết ("connect ECONNREFUSED 127.0.0.1:9",
// stack) CHỈ vào log server (`loiKyThuat`). Thông điệp TU_CHOI / KHONG_RO do cổng MISA TRẢ VỀ (lỗi dữ liệu có
// nghĩa với kế toán, đã viết bằng lời) giữ nguyên.

export type MaLoiPhatHanh =
  | "DA_CO_HOA_DON"
  | "PHAP_NHAN_KHONG_MISA"
  | "THAY_THE"
  | "NGUOI_MUA_THIEU"
  | "CAU_HINH_CO_SO"
  | "PHIEU_KHONG_HOP_LE"
  | "DA_DOI"
  | "VUOT_HAN_MUC"
  | "TAM_DUNG_KY"
  | "NHA_CUNG_CAP_DA_DOI";

const CAU_LOI: Record<MaLoiPhatHanh, string> = {
  DA_CO_HOA_DON: "Lần thu này vừa được người khác phát hành, tải hoá đơn hoặc đánh dấu — tải lại màn",
  PHAP_NHAN_KHONG_MISA:
    "Pháp nhân phát hành của cơ sở này không dùng MISA meInvoice — làm hoá đơn ở phần mềm của pháp nhân rồi tải lên",
  THAY_THE: "Lần thu có hoá đơn cũ đã huỷ — hoá đơn thay thế làm tại MISA rồi tải lên",
  NGUOI_MUA_THIEU: "Thông tin người mua trên đơn còn thiếu",
  CAU_HINH_CO_SO: "Chưa phát hành được — cấu hình hoá đơn của cơ sở chưa dùng được",
  PHIEU_KHONG_HOP_LE: "Chưa gửi MISA — sửa trên đơn rồi phát hành",
  DA_DOI: "Hoá đơn vừa đổi trạng thái — tải lại màn",
  VUOT_HAN_MUC: "Chưa tự phát hành — lần thu ở lại «Chờ xuất» cho kế toán kiểm",
  TAM_DUNG_KY: "Chưa tự phát hành — pháp nhân đang tạm dừng ký",
  NHA_CUNG_CAP_DA_DOI: "Nhà cung cấp hoá đơn của pháp nhân vừa được đổi — tải lại màn rồi thử lại",
};

export class LoiPhatHanh extends Error {
  constructor(
    readonly ma: MaLoiPhatHanh,
    chiTiet?: string,
  ) {
    super(chiTiet ? `${CAU_LOI[ma]}: ${chiTiet}` : CAU_LOI[ma]);
    this.name = "LoiPhatHanh";
  }
}

/** Câu cho người dùng nếu `e` là lỗi nghiệp vụ đã biết (phát hành / cổng chốt / dựng phiếu); `null` ⇒ lỗi lạ. */
export function thongDiepLoiPhatHanh(e: unknown): string | null {
  return e instanceof LoiPhatHanh || e instanceof LoiChotHoaDon || e instanceof LoiDungPhieu || e instanceof LoiXacNhanKhoan
    ? e.message
    : null;
}

type NguoiBam = { id: string; name: string };

/**
 * Hoá đơn này do AI/cái gì khởi động — quyết định có qua CỔNG HẠN MỨC KÝ TỰ ĐỘNG không (BGĐ 04/11/2026). BẮT BUỘC (luật 7): `tsc` liệt kê mọi chỗ gọi.
 *   · `BAM_TAY`     — kế toán bấm «Phát hành»: người bấm đã là bước kiểm tra, KHÔNG bị hạn mức (vẫn qua mọi cổng khác: tạm dừng ở cổng gửi, MST, nội dung, khoá khoản…).
 *   · `TU_DONG_HSM` — lô 23h / tự xuất sau n giờ, pháp nhân KÝ HSM: qua `giuChoHanMucTrongTx` NGAY TRONG giao dịch tạo hoá đơn (khoá chính sách → đếm → tạo, nguyên tử).
 *   · `TU_DONG_USB` — cùng hai đường tự động nhưng pháp nhân ký USB: chỉ LẬP bản (kế toán ký sau trên máy có token), không có HSM nào để giới hạn.
 */
export type KieuPhatHanh = "BAM_TAY" | "TU_DONG_HSM" | "TU_DONG_USB";

/** Kết quả một bước của máy — thứ action trả cho màn và cron đếm. */
export type SauBuoc =
  | { trangThai: "DA_XAC_NHAN"; ketQua: KetQuaChot | null }
  | { trangThai: "DANG_PHAT_HANH"; thongDiep: string }
  | { trangThai: "LOI_PHAT_HANH"; ma: string; thongDiep: string }
  | { trangThai: "KHONG_CON" };

const PHUT = 60_000;

/** Ngày lịch VN (nửa đêm UTC) của một mốc giờ — cột `ngayPhatHanh` là `@db.Date`. */
export function ngayLichVn(d: Date): Date {
  return new Date(`${new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10)}T00:00:00Z`);
}

/**
 * Lỗi KỸ THUẬT của một bước: chi tiết vào log server (tên + thông điệp lỗi, KHÔNG in cả đối tượng — có thể mang
 * header/cấu hình), trả câu nghiệp vụ cho màn. Không bao giờ đưa `e.message` thẳng lên `misaLoiThongDiep`.
 */
function loiKyThuat(viec: string, hoaDonId: string, e: unknown, cauNghiepVu: string): string {
  const chiTiet = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  console.error(`[hoa-don-misa] ${viec} · hoaDonId=${hoaDonId} · ${chiTiet.slice(0, 500)}`);
  return cauNghiepVu;
}

/** Luật MISA trên CHÍNH phiếu sắp lưu (`kiemPhieu` — cùng hàm nút + cổng gọi). Ném TRƯỚC phép ghi đầu tiên. */
function chanPhieuKhongHopLe(phieu: PhieuPhatHanh): void {
  const loi = kiemPhieu(phieu);
  if (loi) throw new LoiPhatHanh("PHIEU_KHONG_HOP_LE", loi);
}

/**
 * Dữ liệu phiếu dựng NGOÀI transaction (trang phiếu chờ + phương thức) — phần người mua đọc lại dưới khoá.
 *
 * ⚠️ KHÔNG có `phapNhan`: pháp nhân + ký hiệu phát hành do MÁY tự đọc từ CẤU HÌNH HOÁ ĐƠN của cơ sở ngay trong
 * transaction (`phapNhanPhatHanhTrongTx`), không nhận từ người gọi. `napTrangPhieuCho` trả thêm `phapNhan` (pháp nhân
 * của PHIẾU THU, theo `macDinhTheoCoSo`) — nó chỉ là thứ in trên phiếu thu, KHÔNG phải bên bán của hoá đơn pháp lý.
 */
export type NguonPhieu = {
  trang: readonly { dong: readonly DongHoaDon[] }[];
  phuongThuc: readonly { ma: string; nhan: string }[];
};

type TxCongChot = Parameters<typeof kiemCongChotTrongTx>[0];

/**
 * Pháp nhân + ký hiệu PHÁT HÀNH của cơ sở vào NGÀY SẼ IN TRÊN HOÁ ĐƠN (`ngayLichVn(now)`), đọc từ cấu hình hoá đơn
 * cơ sở TRONG transaction. Thiếu / chồng ngày / pháp nhân tắt ⇒ NÉM (cổng đứng TRƯỚC phép ghi đầu tiên; return không
 * rollback). Cùng hàm thuần `phapNhanPhatHanhChoCoSo` với nút trên màn — hai nơi không thể nói hai điều khác nhau.
 */
async function phapNhanPhatHanhTrongTx(tx: Parameters<typeof docCauHinhDangBatTrongTx>[0], centerId: string, now: Date) {
  const cauHinh = await docCauHinhDangBatTrongTx(tx, centerId);
  const r = phapNhanPhatHanhChoCoSo({
    cauHinh,
    centerId,
    ngay: ngayLichVn(now).toISOString().slice(0, 10),
    danhSachPhapNhan: cauHinhHoaDonChoMoiTruong().phapNhan,
  });
  if (!r.ok) throw new LoiPhatHanh("CAU_HINH_CO_SO", r.error);
  return r;
}

/**
 * [05/11/2026] Khoá DÙNG CHUNG theo pháp nhân (đổi nhà cung cấp lấy ĐỘC QUYỀN ⇒ hai việc không chồng nhau) rồi ĐỌC LẠI nhà cung cấp trong CÙNG transaction: khác nhà cung cấp của cổng
 * người gọi đã lấy ⇒ NÉM, không ghi gì. Trả pháp nhân mang `phanMem` đúng nhà cung cấp hiệu lực — mọi vị từ + bản chụp phía sau (`banChup`) đọc đúng.
 * MỘT hàm cho cả `batDauPhatHanh` lẫn `phatHanhLai`: để hai đường tự viết là có ngày một đường quên (bản đầu của đợt này đã quên đường «phát hành lại»).
 */
async function pnVoiNhaCungCapHienTai(
  tx: Parameters<typeof docNhaCungCapDaChon>[2] & Parameters<typeof khoaNhaCungCapDungChung>[0],
  pn: Awaited<ReturnType<typeof phapNhanPhatHanhTrongTx>>,
  nhaCungCapCuaCong: NhaCungCapApi,
) {
  await khoaNhaCungCapDungChung(tx, pn.phapNhan.ma);
  const hienTai = nhaCungCapHieuLuc(pn.phapNhan, await docNhaCungCapDaChon(pn.phapNhan.ma, undefined, tx));
  // Chưa có nhà cung cấp nào (không dòng kết nối, `phanMem` không khai) ⇒ giữ mã lỗi cũ — rõ nghĩa hơn «đã đổi».
  if (hienTai === null) throw new LoiPhatHanh("PHAP_NHAN_KHONG_MISA");
  if (hienTai !== nhaCungCapCuaCong) throw new LoiPhatHanh("NHA_CUNG_CAP_DA_DOI");
  return { ...pn, phapNhan: phapNhanVoiNhaCungCap(pn.phapNhan, hienTai) };
}

/**
 * Cổng RIÊNG của phát hành qua API, chạy SAU các cổng dùng chung với `chotHoaDon` (người gọi đã gọi
 * `kiemCongChotTrongTx`): người mua đủ để dựng tờ · pháp nhân dùng MISA · không phải hoá đơn THAY THẾ.
 */
async function kiemCongRiengMisa(
  tx: TxCongChot,
  input: {
    orderId: string;
    khoanIds: readonly string[];
    don: Parameters<typeof nguoiMuaChoDon>[0];
    phapNhan: PhapNhan;
    /** Lô đêm 23h đã chọn khối người mua (`nguoiMuaChoLoDem`) — thay cho `nguoiMuaChoDon`; MỌI cổng bên dưới vẫn chạy trên khối này. */
    nguoiMua?: NguoiMuaHoaDon;
  },
) {
  const nm = input.nguoiMua ?? nguoiMuaChoDon(input.don);
  const thieu = thieuChoHoaDon(nm).chan;
  if (thieu.length > 0) throw new LoiPhatHanh("NGUOI_MUA_THIEU", thieu.join(", "));
  // [02/11/2026] MISA HOẶC VIN-HOADON — pháp nhân không khai một trong hai `phanMem` ấy thì vẫn từ chối (mã lỗi giữ tên cũ).
  if (!laPhapNhanPhatHanhQuaApi(input.phapNhan)) throw new LoiPhatHanh("PHAP_NHAN_KHONG_MISA");
  // Bước 1 KHÔNG phát hành hoá đơn THAY THẾ qua API (hợp đồng chưa có "thay thế cho số X") — cùng luật nối
  // `chonHoaDonDuocThay` mà luồng tải lên dùng, đọc TỪ DB trong transaction.
  const daHuy = await tx.hoaDonDienTu.findMany({
    where: { orderId: input.orderId, trangThai: "THAY_THE", khoan: { some: { paymentId: { in: [...input.khoanIds] } } } },
    select: { id: true, huyLuc: true, khoan: { select: { paymentId: true } } },
  });
  const thay = chonHoaDonDuocThay(
    daHuy.map((h) => ({ id: h.id, huyLuc: h.huyLuc, paymentIds: h.khoan.map((k) => k.paymentId) })),
    input.khoanIds,
  );
  if (thay) throw new LoiPhatHanh("THAY_THE");
  return nm;
}

/** Cột bản chụp người mua + pháp nhân + phiếu — dùng chung cho tạo mới và phát hành lại. */
function banChup(input: {
  nm: ReturnType<typeof nguoiMuaChoDon>;
  phapNhan: PhapNhan;
  phieu: PhieuPhatHanh;
  cheDo: CongHoaDon["cheDo"];
  tienTha: number;
}) {
  const { nm, phapNhan, phieu } = input;
  const moPhong = input.cheDo === "GIA_LAP";
  return {
    // `MISA_API` = «phát hành qua API của nhà cung cấp»; NHÀ CUNG CẤP nào nằm ở `nhaCungCapMa` (ADR-014: không đẻ enum VIN_API).
    nguonPhatHanh: moPhong ? ("MISA_GIA_LAP" as const) : ("MISA_API" as const),
    nhaCungCapMa: nhaCungCapApiCuaPhapNhan(phapNhan),
    misaRefId: phieu.refId,
    misaPhieu: JSON.parse(JSON.stringify(phieu)) as Prisma.InputJsonValue,
    kyHieu: phieu.kyHieu,
    phapNhanMa: phapNhan.ma,
    phapNhanTen: phapNhan.ten,
    phapNhanMst: phieu.mstNguoiBan,
    nguoiMuaTen: nm.hoTen || null,
    nguoiMuaDonVi: nm.tenDonVi,
    nguoiMuaMst: nm.maSoThue,
    nguoiMuaDiaChi: nm.diaChi,
    nguoiMuaMa: nm.maKhachHang,
    emailNhan: nm.email,
    nguoiMuaHashLucIn: bamNguoiMua(nm),
    // Bản MÔ PHỎNG không bao giờ email khách — ép ở đây VÀ ép lại lúc hoàn tất.
    guiEmailKhach: !moPhong,
    tienThaLamTron: input.tienTha,
  };
}

/**
 * (a) Bắt đầu: MỘT transaction, khoá đơn → khoản chưa bị hoá đơn nào giữ → MỌI cổng của `chotHoaDon`
 * (`kiemCongChotTrongTx`) → cổng riêng API → tạo bản DANG_PHAT_HANH + khoá khoản + bản chụp + refId.
 * Hai lượt bấm song song ⇒ xếp hàng ở khoá đơn; lượt sau thấy khoản đã khoá ⇒ DA_CO_HOA_DON (khoá thật
 * vẫn là chỉ mục từng phần `HoaDonKhoan_paymentId_hieuLuc_key` — P2002 dịch cùng câu).
 */
export async function batDauPhatHanh(input: {
  nguoiBam: NguoiBam;
  actor: ActionScopeActor;
  orderId: string;
  centerId: string;
  lanThuKey: string;
  /** Khoản + số RÒNG từ DÒNG loader dựng lại — không từ client. */
  khoan: readonly { id: string; soTien: number }[];
  nguon: NguonPhieu;
  cheDo: CongHoaDon["cheDo"];
  now: Date;
  /**
   * [05/11/2026] Nhà cung cấp của CỔNG người gọi vừa lấy (trường `nhaCungCap` trong kết quả của `layCongHsmChoPhapNhan`). BẮT BUỘC (luật 7): hàm này ghi nó lên hoá đơn VÀ đối chiếu lại với dòng kết nối dưới khoá —
   * lệch (pháp nhân vừa đổi nhà cung cấp giữa lúc lấy cổng và lúc bắt đầu) ⇒ NÉM, không tạo hoá đơn. Không tự suy từ `phanMem`: suy là lỗi «ghi MISA mà gửi qua VIN».
   */
  nhaCungCap: NhaCungCapApi;
  /**
   * Lô đêm 23h (BGĐ 03/11/2026): có giá trị ⇒ khối người mua do `nguoiMuaChoLoDem` quyết TRÊN ĐƠN ĐỌC DƯỚI KHOÁ (đã khai đủ thì dùng nguyên, chưa
   * khai thì «người tiêu dùng» = tên học viên + địa chỉ). Không truyền ⇒ như cũ (`nguoiMuaChoDon`). Tuỳ chọn có chủ đích: mặc định là đường bấm tay.
   */
  loDem?: ThamSoTieuDung;
  kieu: KieuPhatHanh;
  /**
   * [08/11/2026] «Gửi NHÁP lên VIN»: chạy MỌI cổng + dựng ĐÚNG phiếu như phát hành thật, rồi NÉM `PhieuNhapDaDung` TRƯỚC phép ghi đầu tiên ⇒ transaction rollback, KHÔNG tạo hoá đơn, KHÔNG khoá khoản, KHÔNG giữ chỗ
   * hạn mức. Chỉ `dungPhieuNhap` đặt cờ này; đường phát hành thật không truyền ⇒ như cũ.
   */
  chiDungPhieu?: boolean;
  /**
   * [09/11/2026] «Xuất liền» của Sale: ghi dấu vào nhật ký bắt đầu để lúc hoá đơn XONG (kể cả xong muộn qua cron đối soát) thông báo «đã xuất» (`baoSaleHoaDonDaXuat`, gui-email.ts) gửi thêm cho CHÍNH Sale đã bấm.
   * Không truyền ⇒ như cũ (không báo).
   */
  xuatLien?: boolean;
}): Promise<{ hoaDonId: string; refId: string; canhBaoTanSuat: string | null }> {
  const khoanIds = input.khoan.map((k) => k.id);
  try {
    return await db.$transaction(async (tx) => {
      await khoaDonTrongTx(tx, input.orderId);
      const khoa = await khoanDaKhoaHoaDon(tx, khoanIds);
      if (khoa.length > 0) throw new LoiPhatHanh("DA_CO_HOA_DON", thongDiepKhoaHoaDon(khoa));

      const cong = await kiemCongChotTrongTx(tx, {
        actor: input.actor,
        orderId: input.orderId,
        centerId: input.centerId,
        khoan: input.khoan.map((k) => ({ paymentId: k.id, soTien: k.soTien })),
        // Nút API chỉ mở cho lần thu ĐỦ, không nghi trùng — hai lối ra có lý do là việc của luồng tải lên.
        khongTrungLyDo: null,
        xuatTheoSoDaThu: false,
        xuatTheoSoDaThuLyDo: null,
      });
      // Pháp nhân + ký hiệu từ CẤU HÌNH cơ sở (không từ `nguon`) — thiếu thì chặn ở đây, trước mọi phép ghi.
      // Từ đây `pnPhatHanh.phapNhan` mang `phanMem` đúng nhà cung cấp hiệu lực (đã khoá + đọc lại dưới khoá) — mọi vị từ + bản chụp bên dưới đọc đúng.
      const pnPhatHanh = await pnVoiNhaCungCapHienTai(tx, await phapNhanPhatHanhTrongTx(tx, input.centerId, input.now), input.nhaCungCap);
      let nguonNguoiMuaLoDem: string | null = null;
      let nguoiMuaLoDem: NguoiMuaHoaDon | undefined;
      if (input.loDem) {
        const q = nguoiMuaChoLoDem(cong.don, input.loDem);
        if (!q.ok) throw new LoiPhatHanh("NGUOI_MUA_THIEU", q.lyDo);
        nguoiMuaLoDem = q.nguoiMua;
        nguonNguoiMuaLoDem = q.nguon;
      }
      const nm = await kiemCongRiengMisa(tx, {
        orderId: input.orderId,
        khoanIds,
        don: cong.don,
        phapNhan: pnPhatHanh.phapNhan,
        ...(nguoiMuaLoDem ? { nguoiMua: nguoiMuaLoDem } : {}),
      });

      const tongTien = input.khoan.reduce((s, k) => s + k.soTien, 0);
      const refId = randomUUID();
      const phieu = dungPhieuPhatHanh({
        refId,
        phapNhan: pnPhatHanh.phapNhan,
        kyHieu: pnPhatHanh.kyHieu,
        ngayHoaDon: ngayLichVn(input.now),
        nguoiMua: nm,
        trang: input.nguon.trang,
        phuongThuc: input.nguon.phuongThuc,
        tongTien,
      });
      // Tờ MISA sẽ từ chối (email / MST sai luật MISA…) ⇒ từ chối NGAY: không tạo bản DANG_PHAT_HANH, không đốt
      // một lượt gửi. Ném trong transaction ⇒ rollback (khoá đơn ở trên không ghi gì).
      chanPhieuKhongHopLe(phieu);
      // Bản NHÁP dừng ở đây: mọi cổng đã qua, phiếu đã dựng, CHƯA ghi gì (ném ⇒ rollback; không giữ chỗ hạn mức, không tạo hoá đơn).
      if (input.chiDungPhieu) throw new PhieuNhapDaDung(phieu, pnPhatHanh.phapNhan.ma);

      // CỔNG HẠN MỨC NGUYÊN TỬ: khoá dòng chính sách của ĐÚNG pháp nhân sắp đóng dấu lên hoá đơn → đọc lại tạm dừng + hạn mức → đếm → (tạo hoá đơn ngay dưới = giữ chỗ).
      // Từ chối = NÉM (rollback; `return` không rollback). Đứng sau mọi cổng nghiệp vụ, ngay TRƯỚC phép ghi đầu tiên của bản hoá đơn.
      let canhBaoTanSuat: string | null = null;
      if (input.kieu === "TU_DONG_HSM") {
        const giu = await giuChoHanMucTrongTx(tx, { phapNhanMa: pnPhatHanh.phapNhan.ma, soTien: tongTien, now: input.now });
        if (!giu.ok) throw new LoiPhatHanh(giu.ma === "TAM_DUNG" ? "TAM_DUNG_KY" : "VUOT_HAN_MUC", giu.lyDo);
        canhBaoTanSuat = giu.canhBao;
      }

      const hd = await tx.hoaDonDienTu.create({
        data: {
          ...banChup({ nm, phapNhan: pnPhatHanh.phapNhan, phieu, cheDo: input.cheDo, tienTha: cong.lanThu.tienTha }),
          orderId: input.orderId,
          centerId: input.centerId,
          trangThai: "DANG_PHAT_HANH",
          tongTien,
          taoBoiId: input.nguoiBam.id,
          khoan: { create: input.khoan.map((k) => ({ paymentId: k.id, soTien: k.soTien })) },
        },
        select: { id: true },
      });
      await writeAudit({
        tx,
        actor: input.nguoiBam,
        module: "finance",
        entityType: "HoaDonDienTu",
        entityId: hd.id,
        action: "BAT_DAU_PHAT_HANH_MISA",
        newValues: {
          orderId: input.orderId,
          lanThuKey: input.lanThuKey,
          khoanIds,
          tongTien,
          misaRefId: refId,
          kyHieu: phieu.kyHieu,
          phapNhanMa: pnPhatHanh.phapNhan.ma,
          cheDo: input.cheDo,
          ...(nguonNguoiMuaLoDem ? { loDem: true, nguonNguoiMua: nguonNguoiMuaLoDem } : {}),
          ...(input.xuatLien ? { xuatLien: true } : {}),
        },
        orgUnitId: input.centerId,
      });
      return { hoaDonId: hd.id, refId, canhBaoTanSuat };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new LoiPhatHanh("DA_CO_HOA_DON");
    throw e;
  }
}

/** Tín hiệu nội bộ của `chiDungPhieu`: mang phiếu đã dựng ra khỏi transaction (bị rollback). Không phải lỗi. */
export class PhieuNhapDaDung extends Error {
  constructor(
    readonly phieu: PhieuPhatHanh,
    readonly phapNhanMa: string,
  ) {
    super("PHIEU_NHAP_DA_DUNG");
    this.name = "PhieuNhapDaDung";
  }
}

/**
 * Dựng phiếu NHÁP cho một lần thu bằng CHÍNH các cổng + cách dựng của `batDauPhatHanh` (kieu BAM_TAY: không hạn mức tự động), KHÔNG ghi gì. Cổng từ chối ⇒ ném `LoiPhatHanh`/`LoiChotHoaDon` như phát hành thật.
 * Trả phiếu mang `refId` của bản thật ĐÃ BỊ HUỶ — người gọi PHẢI đổi `refId` trước khi gửi đi đâu (xem `gui-nhap-vin.ts`).
 */
export async function dungPhieuNhap(input: Omit<Parameters<typeof batDauPhatHanh>[0], "kieu" | "chiDungPhieu" | "loDem">): Promise<{ phieu: PhieuPhatHanh; phapNhanMa: string }> {
  try {
    await batDauPhatHanh({ ...input, kieu: "BAM_TAY", chiDungPhieu: true });
  } catch (e) {
    if (e instanceof PhieuNhapDaDung) return { phieu: e.phieu, phapNhanMa: e.phapNhanMa };
    throw e;
  }
  // Không thể tới đây: `chiDungPhieu` luôn ném. Nếu tới được là cờ bị bỏ — fail-closed, KHÔNG được coi là đã dựng.
  throw new Error("dungPhieuNhap: cờ chiDungPhieu không có tác dụng — dừng");
}

/** Gọi cổng — MỌI thứ ném ra (mạng, JSON hỏng, bug phía cổng) đọc thành KHONG_RO, không bao giờ "chưa phát hành". */
async function goiAnToan<T extends KetQuaPhatHanh | KetQuaTraCuu>(
  hoaDonId: string,
  viec: string,
  f: () => Promise<T>,
): Promise<T | { loai: "KHONG_RO"; thongDiep: string }> {
  try {
    return await f();
  } catch (e) {
    // Nhật ký lượt gọi không ghi được ⇒ nhà cung cấp CHƯA bị chạm tới (fail-closed, nhat-ky-luot-goi.ts). Vẫn là KHONG_RO để hoá đơn giữ nguyên chờ lượt sau, nhưng nói đúng chuyện.
    if (e instanceof LoiNhatKyLuotGoi) {
      console.error(`[hoa-don-misa] ${viec} · hoaDonId=${hoaDonId} · ${e.message}`);
      return { loai: "KHONG_RO", thongDiep: CAU_KHONG_GHI_DUOC_NHAT_KY };
    }
    return {
      loai: "KHONG_RO",
      thongDiep: loiKyThuat(viec, hoaDonId, e, "Chưa nhận được trả lời rõ từ MISA — hệ thống sẽ tự tra cứu lại, không phát hành lần hai"),
    };
  }
}

async function ghiThongDiep(hoaDonId: string, thongDiep: string): Promise<void> {
  await db.hoaDonDienTu.updateMany({ where: { id: hoaDonId, trangThai: "DANG_PHAT_HANH" }, data: { misaLoiThongDiep: thongDiep.slice(0, 500) } });
}

/**
 * (b) Gửi phiếu ĐÃ LƯU với refId ĐÃ LƯU. Giành lượt có điều kiện (DANG_PHAT_HANH, chưa có số) + tăng đếm
 * lượt gửi + mốc gửi, rồi gọi MISA NGOÀI transaction, rồi áp kết quả.
 */
export async function guiPhatHanh(input: {
  hoaDonId: string;
  cong: CongHoaDon;
  now: Date;
  /** BẮT BUỘC (luật 7): người bấm; `null` = job hệ thống (lô 23h, tự xuất, cron). Đi vào nhật ký lượt gọi. */
  nguoiGoiId: string | null;
}): Promise<SauBuoc> {
  const { hoaDonId, cong, now, nguoiGoiId } = input;
  const gianh = await db.hoaDonDienTu.updateMany({
    where: { id: hoaDonId, trangThai: "DANG_PHAT_HANH", soHoaDon: null, misaRefId: { not: null } },
    data: { misaSoLanGui: { increment: 1 }, misaGuiLuc: now },
  });
  if (gianh.count !== 1) return docSauBuoc(hoaDonId);
  const hd = await db.hoaDonDienTu.findUnique({ where: { id: hoaDonId }, select: { misaRefId: true, misaPhieu: true } });
  if (!hd?.misaRefId) return docSauBuoc(hoaDonId);
  let phieu: PhieuPhatHanh;
  try {
    phieu = phieuTuJson(hd.misaPhieu);
  } catch (e) {
    await ghiThongDiep(hoaDonId, e instanceof Error ? e.message : "Phiếu đã lưu hỏng");
    return docSauBuoc(hoaDonId);
  }
  // refId của lượt gửi LUÔN là refId đã lưu trên bản ghi — phiếu JSON không được tự mang refId khác.
  const refId = hd.misaRefId;
  const kq = await goiAnToan(hoaDonId, "gửi phát hành", () =>
    goiCoNhatKy({
      hoaDonId,
      loaiLuot: "PHAT_HANH",
      nguoiGoiId,
      now,
      moiTruong: cong.moiTruong,
      khoaChongTrung: refId,
      requestHash: bamPhieuLuotGoi(hd.misaPhieu),
      goi: () => cong.phatHanh({ ...phieu, refId }),
      phanLoai: phanLoaiKetQua,
    }),
  );
  return apDungKetQua(hoaDonId, refId, kq, cong, now, nguoiGoiId);
}

async function apDungKetQua(
  hoaDonId: string,
  refId: string,
  kq: KetQuaPhatHanh | KetQuaTraCuu,
  cong: CongHoaDon,
  now: Date,
  nguoiGoiId: string | null,
): Promise<SauBuoc> {
  if (kq.loai === "DA_PHAT_HANH") {
    if (kq.refId !== refId) {
      await ghiThongDiep(hoaDonId, `MISA trả số cho refId khác (${kq.refId}) — chờ đối soát`);
      return docSauBuoc(hoaDonId);
    }
    // Có số là ghi NGAY (trước khi tải tệp): tờ đã phát hành thật, không được để lượt tải tệp hỏng làm mất số.
    await db.hoaDonDienTu.updateMany({
      where: { id: hoaDonId, trangThai: "DANG_PHAT_HANH", soHoaDon: null },
      data: {
        kyHieu: kq.kyHieu,
        soHoaDon: kq.soHoaDon,
        ngayPhatHanh: ngayLichVn(kq.ngayPhatHanh),
        maTraCuu: kq.maTraCuu,
        misaLoiMa: null,
        misaLoiThongDiep: null,
      },
    });
    return taiVaHoanTat(hoaDonId, cong, now, nguoiGoiId);
  }
  if (kq.loai === "TU_CHOI") {
    const vuaChuyenSangLoi = await db.$transaction(async (tx) => {
      const upd = await tx.hoaDonDienTu.updateMany({
        where: { id: hoaDonId, trangThai: "DANG_PHAT_HANH", soHoaDon: null },
        data: { trangThai: "LOI_PHAT_HANH", misaLoiMa: kq.ma.slice(0, 100), misaLoiThongDiep: kq.thongDiep.slice(0, 500) },
      });
      // Ghi có điều kiện đổi 0 dòng ⇒ commit vô hại (người khác đã đi tiếp) — không ghi nhật ký.
      if (upd.count !== 1) return false;
      const hd = await tx.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId }, select: { centerId: true, taoBoiId: true } });
      await writeAudit({
        tx,
        actor: { id: hd.taoBoiId, name: "MISA meInvoice" },
        module: "finance",
        entityType: "HoaDonDienTu",
        entityId: hoaDonId,
        action: "MISA_TU_CHOI_PHAT_HANH",
        oldValues: { trangThai: "DANG_PHAT_HANH" },
        newValues: { trangThai: "LOI_PHAT_HANH", misaRefId: refId, ma: kq.ma, thongDiep: kq.thongDiep },
        orgUnitId: hd.centerId,
      });
      return true;
    });
    // Báo kế toán đúng cơ sở NGAY (hợp đồng đợt 2 §6) — SAU khi giao dịch đã commit, không bao giờ ném, tắt khi cờ Hub TẮT. Chỉ khi LƯỢT NÀY là lượt chuyển sang lỗi.
    if (vuaChuyenSangLoi) await baoNgoaiLeTucThoi({ hoaDonId, loai: "TU_CHOI_NHA_CUNG_CAP", khoa: refId, now });
    return docSauBuoc(hoaDonId);
  }
  if (kq.loai === "KHONG_RO") {
    await ghiThongDiep(hoaDonId, kq.thongDiep || "MISA chưa trả lời rõ");
    return docSauBuoc(hoaDonId);
  }
  // CHUA_CO chỉ đến từ tra cứu — người gọi (`kiemTraMotBan`) quyết gửi lại hay chờ.
  return docSauBuoc(hoaDonId);
}

/**
 * Bản đã CÓ SỐ: tải PDF + XML còn thiếu từ MISA → ghi vào kho hoá đơn (cùng quy ước khoá + sha256 + cỡ như
 * luồng tải lên) → hoàn tất. Tải/ghi hỏng ⇒ GIỮ DANG_PHAT_HANH (đã có số), lượt đối soát sau tải lại.
 */
async function taiVaHoanTat(hoaDonId: string, cong: CongHoaDon, now: Date, nguoiGoiId: string | null): Promise<SauBuoc> {
  const hd = await db.hoaDonDienTu.findFirst({
    where: { id: hoaDonId, trangThai: "DANG_PHAT_HANH", soHoaDon: { not: null } },
    select: {
      orderId: true,
      maTraCuu: true,
      phapNhanMst: true,
      tepPdfKey: true,
      tepXmlKey: true,
      kyHieu: true,
      soHoaDon: true,
      order: { select: { center: { select: { code: true } } } },
    },
  });
  if (!hd) return docSauBuoc(hoaDonId);
  const centerCode = hd.order.center?.code?.trim();
  if (!hd.maTraCuu || !hd.phapNhanMst || !centerCode) {
    await ghiThongDiep(hoaDonId, "Đã có số nhưng thiếu mã tra cứu / MST / mã cơ sở — không tải được tệp");
    return docSauBuoc(hoaDonId);
  }
  const so = `${hd.kyHieu ?? ""}-${hd.soHoaDon ?? ""}`;
  for (const loai of ["pdf", "xml"] as const satisfies readonly LoaiTep[]) {
    if ((loai === "pdf" ? hd.tepPdfKey : hd.tepXmlKey) != null) continue;
    let than: Uint8Array;
    try {
      const maTraCuu = hd.maTraCuu;
      const mstNguoiBan = hd.phapNhanMst;
      // TAI_TEP: «thành công» = tải được tệp (hoá đơn đã phát hành từ trước); ghi `DA_PHAT_HANH` theo bộ giá trị của bảng, `loaiLuot` nói rõ đây là lượt tải.
      than = await goiCoNhatKy({
        hoaDonId,
        loaiLuot: "TAI_TEP",
        nguoiGoiId,
        now,
        moiTruong: cong.moiTruong,
        khoaChongTrung: maTraCuu,
        requestHash: null,
        goi: () => cong.taiTep(maTraCuu, loai, mstNguoiBan),
        phanLoai: () => ({ ketQua: "DA_PHAT_HANH", maNhaCungCap: null, thongDiep: loai }),
      });
    } catch (e) {
      const cau = `Đã có số hoá đơn ${so} nhưng chưa tải được tệp ${loai.toUpperCase()} từ MISA — hệ thống sẽ tự thử lại`;
      await ghiThongDiep(hoaDonId, loiKyThuat(`tải tệp ${loai} từ MISA`, hoaDonId, e, cau));
      return docSauBuoc(hoaDonId);
    }
    const khoa = khoaTepHoaDon({ centerCode, orderId: hd.orderId, loai, nam: now.getUTCFullYear(), uuid: randomUUID() });
    let luu: Awaited<ReturnType<typeof luuTepHoaDon>>;
    try {
      luu = await luuTepHoaDon({ khoa, loai, than });
    } catch (e) {
      const cau = `Đã có số hoá đơn ${so} nhưng chưa lưu được tệp ${loai.toUpperCase()} vào kho — hệ thống sẽ tự thử lại`;
      await ghiThongDiep(hoaDonId, loiKyThuat(`ghi tệp ${loai} vào kho`, hoaDonId, e, cau));
      return docSauBuoc(hoaDonId);
    }
    if (!luu.ok) {
      await ghiThongDiep(hoaDonId, `Đã có số hoá đơn ${so} nhưng ${luu.thongDiep} — hệ thống sẽ tự thử lại`);
      return docSauBuoc(hoaDonId);
    }
    const tenTep = `HoaDon-${so}.${loai}`;
    const upd = await db.hoaDonDienTu.updateMany({
      where: { id: hoaDonId, trangThai: "DANG_PHAT_HANH", ...(loai === "pdf" ? { tepPdfKey: null } : { tepXmlKey: null }) },
      data:
        loai === "pdf"
          ? { tepPdfKey: khoa, tepPdfTen: tenTep, tepPdfCo: luu.co, tepPdfSha256: luu.sha256 }
          : { tepXmlKey: khoa, tepXmlTen: tenTep, tepXmlCo: luu.co },
    });
    // Lượt khác đã ghi tệp trước ⇒ tệp vừa đặt là mồ côi: dọn ngay (cron mồ côi cũng sẽ dọn nếu lỗi).
    if (upd.count !== 1) await xoaTepHoaDon(khoa).catch(() => undefined);
  }
  return hoanTatPhatHanh(hoaDonId, now);
}

/**
 * DANG_PHAT_HANH (đủ số + tệp) → DA_XAC_NHAN, với ĐÚNG các hệ quả sau-xác-nhận của `chotHoaDon`
 * (`hoanTatChotTrongTx`: email khách qua `HoaDonGuiEmail` + sự kiện, xác nhận khoản còn chờ + RCP, nhật ký).
 * KHÔNG chạy lại các cổng: hoá đơn đã phát hành thật ở MISA — việc ở đây là GHI NHẬN nó, không phải quyết
 * có cho phát hành không (cổng đã chạy dưới khoá lúc bắt đầu; khoản bị khoá suốt từ đó — `khoa-khoan.ts`).
 */
async function hoanTatPhatHanh(hoaDonId: string, now: Date): Promise<SauBuoc> {
  const dau = await db.hoaDonDienTu.findUnique({ where: { id: hoaDonId }, select: { orderId: true } });
  if (!dau) return { trangThai: "KHONG_CON" };
  try {
    const kq = await db.$transaction(async (tx) => {
      await khoaDonTrongTx(tx, dau.orderId);
      const hd = await tx.hoaDonDienTu.findFirst({
        where: { id: hoaDonId, trangThai: "DANG_PHAT_HANH", soHoaDon: { not: null }, tepPdfKey: { not: null }, tepXmlKey: { not: null } },
        select: {
          orderId: true,
          centerId: true,
          updatedAt: true,
          taoBoiId: true,
          kyHieu: true,
          soHoaDon: true,
          maTraCuu: true,
          tongTien: true,
          tienThaLamTron: true,
          guiEmailKhach: true,
          nguonPhatHanh: true,
          misaRefId: true,
          khoan: { where: { hieuLuc: true }, select: { paymentId: true } },
        },
      });
      if (!hd) return null;
      const [don, cacDong, nguoi] = await Promise.all([
        tx.order.findUniqueOrThrow({
          where: { id: hd.orderId },
          select: { status: true, deletedAt: true, centerId: true, type: true, ...COT_NGUOI_MUA },
        }),
        tx.payment.findMany({
          where: { orderId: hd.orderId, deletedAt: null },
          select: { id: true, amount: true, adjustmentOfId: true, deletedAt: true, accountantStatus: true, enrollmentId: true, recordedById: true },
        }),
        tx.user.findUnique({ where: { id: hd.taoBoiId }, select: { name: true } }),
      ]);
      return hoanTatChotTrongTx(tx, {
        // Người BẤM phát hành là người xác nhận (cron chỉ hoàn tất thay họ).
        nguoiChot: { id: hd.taoBoiId, name: nguoi?.name ?? hd.taoBoiId },
        orderId: hd.orderId,
        hoaDonId,
        tu: "DANG_PHAT_HANH",
        updatedAt: hd.updatedAt,
        now,
        don,
        theoIdDong: new Map(cacDong.map((p) => [p.id, p])),
        rong: soTienRong(cacDong),
        paymentIds: hd.khoan.map((k) => k.paymentId),
        // Bản MÔ PHỎNG không bao giờ email khách — ép lại lần nữa, không tin cột.
        guiEmailKhach: hd.nguonPhatHanh === "MISA_GIA_LAP" ? false : hd.guiEmailKhach,
        tienTha: hd.tienThaLamTron,
        centerId: hd.centerId,
        nhatKy: {
          kyHieu: hd.kyHieu,
          soHoaDon: hd.soHoaDon,
          tongTien: hd.tongTien,
          nguonPhatHanh: hd.nguonPhatHanh,
          misaRefId: hd.misaRefId,
          maTraCuu: hd.maTraCuu,
        },
      });
    });
    return kq ? { trangThai: "DA_XAC_NHAN", ketQua: kq } : docSauBuoc(hoaDonId);
  } catch (e) {
    // Hoá đơn ĐÃ phát hành thật — không nuốt, không vứt: ghi lý do lên bản ghi để màn nói ra; thử lại được.
    // Lỗi nghiệp vụ đã biết ⇒ nói nguyên câu; lỗi lạ (DB, bug) ⇒ log + câu nghiệp vụ.
    const tb = thongDiepLoiPhatHanh(e);
    await ghiThongDiep(
      hoaDonId,
      tb
        ? `Đã có số và tệp nhưng chưa ghi nhận xong: ${tb.slice(0, 300)}`
        : loiKyThuat("hoàn tất", hoaDonId, e, "Đã có số và tệp nhưng chưa ghi nhận xong vào sổ — hệ thống sẽ tự thử lại"),
    );
    return docSauBuoc(hoaDonId);
  }
}

async function docSauBuoc(hoaDonId: string): Promise<SauBuoc> {
  const hd = await db.hoaDonDienTu.findUnique({
    where: { id: hoaDonId },
    select: { trangThai: true, misaLoiMa: true, misaLoiThongDiep: true, soHoaDon: true },
  });
  if (!hd) return { trangThai: "KHONG_CON" };
  if (hd.trangThai === "DA_XAC_NHAN") return { trangThai: "DA_XAC_NHAN", ketQua: null };
  if (hd.trangThai === "LOI_PHAT_HANH") return { trangThai: "LOI_PHAT_HANH", ma: hd.misaLoiMa ?? "", thongDiep: hd.misaLoiThongDiep ?? "" };
  if (hd.trangThai === "DANG_PHAT_HANH") {
    return { trangThai: "DANG_PHAT_HANH", thongDiep: hd.misaLoiThongDiep ?? (hd.soHoaDon ? "Đã có số — đang tải tệp" : "Đang chờ MISA xác nhận") };
  }
  return { trangThai: "KHONG_CON" };
}

/**
 * "Kiểm tra lại" (nút trên màn) và một lượt của cron: bản đã có số ⇒ tải tệp / hoàn tất; chưa có số ⇒
 * `traCuu(refId)`: DA_PHAT_HANH ⇒ đi tiếp · CHUA_CO ⇒ gửi lại CÙNG refId khi `choGuiLai` · KHONG_RO ⇒ giữ.
 */
export async function kiemTraMotBan(input: {
  hoaDonId: string;
  cong: CongHoaDon;
  now: Date;
  /** Được phép gửi lại khi MISA nói CHUA_CO. Nút: luôn; cron: chỉ khi lượt gửi trước đã > 10 phút. */
  choGuiLai: (hd: { misaGuiLuc: Date | null }) => boolean;
  /** BẮT BUỘC (luật 7): người bấm «Kiểm tra lại»; `null` = cron. Đi vào nhật ký lượt gọi (cả lượt tra cứu lẫn lượt gửi lại / tải tệp nó kéo theo). */
  nguoiGoiId: string | null;
}): Promise<SauBuoc> {
  const { hoaDonId, cong, now, nguoiGoiId } = input;
  const hd = await db.hoaDonDienTu.findFirst({
    where: { id: hoaDonId, trangThai: "DANG_PHAT_HANH" },
    select: { soHoaDon: true, misaRefId: true, phapNhanMst: true, misaGuiLuc: true },
  });
  if (!hd) return docSauBuoc(hoaDonId);
  if (hd.soHoaDon) return taiVaHoanTat(hoaDonId, cong, now, nguoiGoiId);
  if (!hd.misaRefId || !hd.phapNhanMst) {
    await ghiThongDiep(hoaDonId, "Bản ghi thiếu refId / MST — không tra được MISA");
    return docSauBuoc(hoaDonId);
  }
  const refId = hd.misaRefId;
  const mst = hd.phapNhanMst;
  const kq = await goiAnToan(hoaDonId, "tra cứu", () =>
    goiCoNhatKy({
      hoaDonId,
      loaiLuot: "TRA_CUU",
      nguoiGoiId,
      now,
      moiTruong: cong.moiTruong,
      khoaChongTrung: refId,
      requestHash: null,
      goi: () => cong.traCuu(refId, mst),
      phanLoai: phanLoaiKetQua,
    }),
  );
  if (kq.loai === "CHUA_CO") {
    if (input.choGuiLai(hd)) return guiPhatHanh({ hoaDonId, cong, now, nguoiGoiId });
    await ghiThongDiep(hoaDonId, "MISA chưa có hoá đơn này — sẽ gửi lại cùng mã tham chiếu");
    return docSauBuoc(hoaDonId);
  }
  return apDungKetQua(hoaDonId, refId, kq, cong, now, nguoiGoiId);
}

export const TRAN_DOI_SOAT = 50;

/**
 * (c) Cron đối soát (`/api/cron/hoa-don-misa-doi-soat`, 10 phút): quét DANG_PHAT_HANH đã gửi > 2 phút (hoặc
 * chưa gửi lần nào mà tạo > 2 phút — máy chủ chết giữa bước tạo và bước gửi), trần 50/lượt, cũ nhất trước.
 * CHUA_CO chỉ gửi lại khi lượt trước đã > 10 phút. Không cổng ⇒ bỏ qua (không ném).
 */
export async function doiSoatPhatHanhTreo(input: {
  cong: CongHoaDon | null;
  /**
   * [02/11/2026] Cổng THEO NHÀ CUNG CẤP của từng bản (`nhaCungCapMa`; NULL = bản cũ = MISA). Có ⇒ bản VIN dùng cổng VIN, bản MISA
   * dùng cổng MISA, bản mà cổng của nó chưa cấu hình ⇒ BỎ QUA (không đẩy sang cổng khác). Không truyền ⇒ chỉ `cong` (hành vi cũ).
   */
  congTheo?: (nhaCungCap: NhaCungCapApi) => CongHoaDon | null;
  /**
   * [04/11/2026] Cổng theo PHÁP NHÂN ĐÃ CHỤP trên bản (hub/13): bản CÓ mã pháp nhân ⇒ ƯU TIÊN hơn `congTheo`; bản cũ chưa có mã ⇒ `congTheo` như trước.
   * Trả `null` (chưa cấu hình, hoặc pháp nhân ký USB) ⇒ BỎ QUA bản đó.
   * Hai pháp nhân cùng VIN có tài khoản khác nhau nên không thể chỉ chọn theo nhà cung cấp.
   */
  congTheoPhapNhan?: (nhaCungCap: NhaCungCapApi, phapNhanMa: string) => Promise<CongHoaDon | null>;
  /**
   * [04/11/2026] Pháp nhân đang TẠM DỪNG KÝ (BGĐ): cron VẪN tra cứu bản đã gửi trước lúc dừng (để biết kết quả thật) nhưng KHÔNG ĐƯỢC gửi lại — «CHUA_CO ⇒ gửi lại cùng refId» là
   * một lời gọi phát hành. Trả `true` ⇒ bản của pháp nhân này chỉ được tra cứu. Không truyền ⇒ như cũ.
   */
  khoaGui?: (phapNhanMa: string) => Promise<boolean>;
  /**
   * [05/11/2026] Bản do HỆ THỐNG tạo mà CHƯA TỪNG GỬI (`misaGuiLuc = null` — crash giữa «lập» và «gửi») sắp bị cron gửi: hỏi chính sách HIỆN HÀNH trước. Trả chuỗi ⇒ KHÔNG gửi (chỉ tra cứu), bản ở
   * lại DANG_PHAT_HANH với câu giải thích, cảnh báo quá hạn lo phần còn lại. Bản ĐÃ gửi rồi (có `misaGuiLuc`) KHÔNG hỏi: không giả định thu hồi được thứ đã gửi. Không truyền ⇒ như cũ.
   */
  chanChuaGui?: (hoaDonId: string) => Promise<string | null>;
  now: Date;
  /** BẮT BUỘC (luật 7): số phút chờ trước khi báo ngoại lệ «quá hạn»; `null` = không báo. Con số đến từ cấu hình, không có mặc định ở đây. */
  slaKhongRoPhut: number | null;
}): Promise<{
  boQua?: string;
  quet: number;
  daXacNhan: number;
  loi: number;
  conCho: number;
  hong: number;
}> {
  const { cong, now } = input;
  if (!cong && !input.congTheo && !input.congTheoPhapNhan) return { boQua: "Chưa cấu hình cổng phát hành hoá đơn", quet: 0, daXacNhan: 0, loi: 0, conCho: 0, hong: 0 };
  const moc = new Date(now.getTime() - 2 * PHUT);
  const ds = await db.hoaDonDienTu.findMany({
    where: {
      trangThai: "DANG_PHAT_HANH",
      OR: [{ misaGuiLuc: { lt: moc } }, { misaGuiLuc: null, createdAt: { lt: moc } }],
    },
    orderBy: [{ misaGuiLuc: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    take: TRAN_DOI_SOAT,
    select: { id: true, misaRefId: true, misaGuiLuc: true, createdAt: true, soHoaDon: true, nhaCungCapMa: true, phapNhanMa: true },
  });
  const dem = { quet: ds.length, daXacNhan: 0, loi: 0, conCho: 0, hong: 0 };
  const guiLaiDuoc = (hd: { misaGuiLuc: Date | null }) => hd.misaGuiLuc == null || hd.misaGuiLuc.getTime() < now.getTime() - 10 * PHUT;
  for (const { id, misaRefId, misaGuiLuc, createdAt, soHoaDon, nhaCungCapMa, phapNhanMa } of ds) {
    try {
      // Bản cũ (NULL) đều phát hành qua MISA. Giá trị lạ ⇒ không cổng nào ⇒ bỏ qua bản đó, KHÔNG đoán.
      const ncc: NhaCungCapApi | null = nhaCungCapMa === null || nhaCungCapMa === "MISA_MEINVOICE" ? "MISA_MEINVOICE" : nhaCungCapMa === "VIN_HOADON" ? "VIN_HOADON" : null;
      const congCuaBan =
        ncc === null
          ? null
          : phapNhanMa && input.congTheoPhapNhan
            ? await input.congTheoPhapNhan(ncc, phapNhanMa)
            : input.congTheo
              ? input.congTheo(ncc)
              : ncc === "MISA_MEINVOICE"
                ? cong
                : null;
      if (!congCuaBan) {
        dem.quet -= 1;
        continue;
      }
      let chiTraCuu = phapNhanMa && input.khoaGui ? await input.khoaGui(phapNhanMa) : false;
      let lyDoGiu: string | null = null;
      if (!chiTraCuu && misaGuiLuc === null && input.chanChuaGui) {
        lyDoGiu = await input.chanChuaGui(id);
        if (lyDoGiu !== null) chiTraCuu = true;
      }
      const r = await kiemTraMotBan({ hoaDonId: id, cong: congCuaBan, now, nguoiGoiId: null, choGuiLai: (hd) => !chiTraCuu && guiLaiDuoc(hd) });
      // Ghi lý do SAU lượt tra cứu (lượt tra cứu tự ghi câu của nó lên cùng cột): kế toán đọc đúng «vì sao chưa gửi», không phải câu tra cứu chung.
      if (lyDoGiu !== null && r.trangThai === "DANG_PHAT_HANH") await ghiThongDiep(id, `Chưa gửi nhà cung cấp: ${lyDoGiu}`);
      if (r.trangThai === "DA_XAC_NHAN") dem.daXacNhan += 1;
      else if (r.trangThai === "LOI_PHAT_HANH") dem.loi += 1;
      else if (r.trangThai === "DANG_PHAT_HANH") {
        dem.conCho += 1;
        // Báo NGAY khi bản kẹt quá ngưỡng (cấu hình) — không chờ scanner. Số hoá đơn đọc lại SAU lượt kiểm (lượt kiểm có thể vừa ghi số) để phân loại đúng.
        const sau = await db.hoaDonDienTu.findFirst({ where: { id }, select: { soHoaDon: true } });
        const loai = loaiQuaHan({ guiLuc: misaGuiLuc, taoLuc: createdAt, soHoaDon: sau?.soHoaDon ?? soHoaDon, now, slaPhut: input.slaKhongRoPhut });
        if (loai !== null) await baoNgoaiLeTucThoi({ hoaDonId: id, loai, khoa: misaRefId ?? id, now });
      }
    } catch (e) {
      // Một bản hỏng không được chặn cả lượt — ghi lên chính bản đó rồi đi tiếp.
      dem.hong += 1;
      const cau = "Lượt kiểm tra tự động gặp lỗi hệ thống — hệ thống sẽ tự thử lại ở lượt sau";
      await ghiThongDiep(id, loiKyThuat("đối soát", id, e, cau)).catch(() => undefined);
    }
  }
  return dem;
}

/**
 * "Phát hành lại" sau LOI_PHAT_HANH (kế toán đã sửa người mua trên đơn): chạy LẠI mọi cổng dưới khoá, chụp
 * LẠI người mua, sinh refId MỚI — được phép DUY NHẤT ở đây vì TU_CHOI chắc chắn chưa có hoá đơn nào — rồi về
 * DANG_PHAT_HANH. Người gọi gửi ngay bằng `guiPhatHanh`.
 */
export async function phatHanhLai(input: {
  nguoiBam: NguoiBam;
  actor: ActionScopeActor;
  orderId: string;
  hoaDonId: string;
  /** Phiên bản bản LỖI người bấm đã thấy — ai vừa bỏ / phát hành lại trước ⇒ DA_DOI. */
  phienBan: Date;
  nguon: NguonPhieu;
  cheDo: CongHoaDon["cheDo"];
  /** [05/11/2026] Nhà cung cấp của cổng người gọi vừa lấy — BẮT BUỘC (luật 7), đối chiếu dưới khoá như `batDauPhatHanh`. */
  nhaCungCap: NhaCungCapApi;
  now: Date;
}): Promise<{ refId: string }> {
  return db.$transaction(async (tx) => {
    await khoaDonTrongTx(tx, input.orderId);
    const hd = await tx.hoaDonDienTu.findFirst({
      where: { id: input.hoaDonId, orderId: input.orderId, trangThai: "LOI_PHAT_HANH", updatedAt: input.phienBan },
      select: { centerId: true, updatedAt: true, misaRefId: true, tongTien: true, khoan: { where: { hieuLuc: true }, select: { paymentId: true, soTien: true } } },
    });
    if (!hd || hd.khoan.length === 0) throw new LoiPhatHanh("DA_DOI");
    const cong = await kiemCongChotTrongTx(tx, {
      actor: input.actor,
      orderId: input.orderId,
      centerId: hd.centerId,
      khoan: hd.khoan,
      khongTrungLyDo: null,
      xuatTheoSoDaThu: false,
      xuatTheoSoDaThuLyDo: null,
    });
    const khoanIds = hd.khoan.map((k) => k.paymentId);
    // Cấu hình cơ sở có thể đã ĐỔI giữa lần phát hành trước và lần này — luôn đọc lại, không dùng lại ký hiệu cũ.
    const pnPhatHanh = await pnVoiNhaCungCapHienTai(tx, await phapNhanPhatHanhTrongTx(tx, hd.centerId, input.now), input.nhaCungCap);
    const nm = await kiemCongRiengMisa(tx, { orderId: input.orderId, khoanIds, don: cong.don, phapNhan: pnPhatHanh.phapNhan });
    const refId = randomUUID();
    const phieu = dungPhieuPhatHanh({
      refId,
      phapNhan: pnPhatHanh.phapNhan,
      kyHieu: pnPhatHanh.kyHieu,
      ngayHoaDon: ngayLichVn(input.now),
      nguoiMua: nm,
      trang: input.nguon.trang,
      phuongThuc: input.nguon.phuongThuc,
      tongTien: hd.tongTien,
    });
    chanPhieuKhongHopLe(phieu);
    const upd = await tx.hoaDonDienTu.updateMany({
      where: { id: input.hoaDonId, trangThai: "LOI_PHAT_HANH", updatedAt: hd.updatedAt },
      data: {
        ...banChup({ nm, phapNhan: pnPhatHanh.phapNhan, phieu, cheDo: input.cheDo, tienTha: cong.lanThu.tienTha }),
        trangThai: "DANG_PHAT_HANH",
        misaLoiMa: null,
        misaLoiThongDiep: null,
        misaSoLanGui: 0,
        misaGuiLuc: null,
      },
    });
    if (upd.count !== 1) throw new LoiPhatHanh("DA_DOI");
    await writeAudit({
      tx,
      actor: input.nguoiBam,
      module: "finance",
      entityType: "HoaDonDienTu",
      entityId: input.hoaDonId,
      action: "PHAT_HANH_LAI_MISA",
      oldValues: { trangThai: "LOI_PHAT_HANH", misaRefId: hd.misaRefId },
      newValues: { trangThai: "DANG_PHAT_HANH", misaRefId: refId },
      orgUnitId: hd.centerId,
    });
    return { refId };
  });
}

/** "Bỏ, làm tay" sau LOI_PHAT_HANH: gỡ bản lỗi (dòng nối xoá theo — Cascade) ⇒ khoản về hàng chờ để tải tay. */
export async function boPhatHanhLamTay(input: {
  nguoiBam: NguoiBam;
  orderId: string;
  hoaDonId: string;
  phienBan: Date;
}): Promise<void> {
  await db.$transaction(async (tx) => {
    await khoaDonTrongTx(tx, input.orderId);
    const hd = await tx.hoaDonDienTu.findFirst({
      where: { id: input.hoaDonId, orderId: input.orderId, trangThai: "LOI_PHAT_HANH", updatedAt: input.phienBan },
      select: { centerId: true, misaRefId: true, misaLoiMa: true, misaLoiThongDiep: true, khoan: { select: { paymentId: true } } },
    });
    if (!hd) throw new LoiPhatHanh("DA_DOI");
    // Nhật ký trước: sau khi xoá, `writeAudit` không còn suy được đơn vị từ thực thể.
    await writeAudit({
      tx,
      actor: input.nguoiBam,
      module: "finance",
      entityType: "HoaDonDienTu",
      entityId: input.hoaDonId,
      action: "BO_PHAT_HANH_MISA",
      oldValues: {
        orderId: input.orderId,
        trangThai: "LOI_PHAT_HANH",
        misaRefId: hd.misaRefId,
        misaLoiMa: hd.misaLoiMa,
        misaLoiThongDiep: hd.misaLoiThongDiep,
        khoanIds: hd.khoan.map((k) => k.paymentId),
      },
      orgUnitId: hd.centerId,
    });
    const del = await tx.hoaDonDienTu.deleteMany({
      where: { id: input.hoaDonId, trangThai: "LOI_PHAT_HANH", updatedAt: input.phienBan },
    });
    if (del.count !== 1) throw new LoiPhatHanh("DA_DOI");
  });
}

// ─── Ký USB token (hub/13, 04/11/2026) ─────────────────────────────────────────────────────────────────────────────────────────────────────
// Đường ký USB KHÔNG gọi `guiPhatHanh` (đó là HSM: một lời gọi gửi + ký). Nó lưu NHÁP → tải XML → kế toán ký ở máy Windows → gửi XML đã ký, rồi áp kết quả
// bằng CHÍNH `apDungKetQua` ở trên (ghi số trước, tải tệp sau, TU_CHOI ⇒ LOI_PHAT_HANH, KHONG_RO ⇒ giữ) — một máy trạng thái, không bản sao.

export type PhieuDaLuuChoKyUsb = {
  refId: string;
  phieu: PhieuPhatHanh;
  phapNhanMa: string | null;
  nhaCungCapMa: string | null;
  centerId: string;
  soHoaDon: string | null;
  trangThai: string;
};

/** Phiếu + refId ĐÃ LƯU của bản đang phát hành. `null` = không có bản / thiếu refId / phiếu hỏng. */
export async function docPhieuDaLuuChoKyUsb(hoaDonId: string): Promise<PhieuDaLuuChoKyUsb | null> {
  const hd = await db.hoaDonDienTu.findUnique({
    where: { id: hoaDonId },
    select: { misaRefId: true, misaPhieu: true, phapNhanMa: true, nhaCungCapMa: true, centerId: true, soHoaDon: true, trangThai: true },
  });
  if (!hd?.misaRefId) return null;
  try {
    return { refId: hd.misaRefId, phieu: { ...phieuTuJson(hd.misaPhieu), refId: hd.misaRefId }, phapNhanMa: hd.phapNhanMa, nhaCungCapMa: hd.nhaCungCapMa, centerId: hd.centerId, soHoaDon: hd.soHoaDon, trangThai: hd.trangThai };
  } catch {
    return null;
  }
}

/**
 * Giành lượt GỬI cho đường ký USB: DANG_PHAT_HANH ∧ chưa có số ⇒ tăng đếm + đặt mốc gửi. `false` = người khác đã đi tiếp (hoặc bản không còn đang phát hành) ⇒
 * KHÔNG được gửi gì sang nhà cung cấp. Cùng điều kiện với đầu `guiPhatHanh`.
 */
export async function giaiLuotGuiChoKyUsb(hoaDonId: string, now: Date): Promise<boolean> {
  const r = await db.hoaDonDienTu.updateMany({
    where: { id: hoaDonId, trangThai: "DANG_PHAT_HANH", soHoaDon: null, misaRefId: { not: null } },
    data: { misaSoLanGui: { increment: 1 }, misaGuiLuc: now },
  });
  return r.count === 1;
}

/** Áp kết quả của lời gọi nhà cung cấp trong đường ký USB — ĐÚNG `apDungKetQua`. */
export async function apDungKetQuaKyUsb(input: {
  hoaDonId: string;
  kq: KetQuaPhatHanh | KetQuaTraCuu;
  cong: CongHoaDon;
  now: Date;
  /** BẮT BUỘC (luật 7): người ký; đi vào nhật ký lượt tải tệp mà việc áp kết quả có thể kéo theo. */
  nguoiGoiId: string | null;
}): Promise<SauBuoc> {
  const hd = await db.hoaDonDienTu.findUnique({ where: { id: input.hoaDonId }, select: { misaRefId: true } });
  if (!hd?.misaRefId) return docSauBuoc(input.hoaDonId);
  return apDungKetQua(input.hoaDonId, hd.misaRefId, input.kq, input.cong, input.now, input.nguoiGoiId);
}

/** "Kiểm tra lại" cho bản ký USB: CHỈ tra cứu, KHÔNG BAO GIỜ gửi lại (USB không có đường gửi một lời gọi). */
export function kiemTraLaiKhongGuiLai(input: { hoaDonId: string; cong: CongHoaDon; now: Date; nguoiGoiId: string | null }): Promise<SauBuoc> {
  return kiemTraMotBan({ ...input, choGuiLai: () => false });
}
