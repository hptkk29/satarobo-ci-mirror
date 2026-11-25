// lib/finance/hoa-don/yeu-cau-nguoi-mua-cong-khai.ts — ĐIỀU PHỐI đường CÔNG KHAI của "thu thập thông tin người mua" (Invoice Hub đợt 2, S11, phía phụ huynh): trang `/thong-tin-hoa-don/<mã>`
// và Server Action gửi biểu mẫu. KHÔNG có actor — phụ huynh quét QR bằng điện thoại, không đăng nhập.
//
// Tệp này CHỈ chứa thứ tự các cổng + dịch kết quả sang lời tiếng Việt; mọi phép chạm DB / cờ / rate-limit đi qua `PhuThuoc` (tiêm vào) nên test không cần Next, không cần Postgres.
// Bản nối với hệ thật ở `yeu-cau-nguoi-mua-cong-khai-db.ts`. Luật dữ liệu ở `yeu-cau-nguoi-mua.ts`, kiểm biểu mẫu ở `yeu-cau-nguoi-mua-bieu-mau.ts`, dịch vụ ghi ở `yeu-cau-nguoi-mua-db.ts`.
//
// THỨ TỰ CỔNG (đổi thứ tự là đổi nghĩa — mỗi cổng ghim bằng test):
//   1. bot xem trước link / mã sai hình dạng      → "không còn hiệu lực", KHÔNG chạm gì (bot mở link Zalo/Messenger không được ăn mất lượt mở của khách thật).
//   2. rate-limit theo IP rồi theo id yêu cầu      → "thao tác quá nhanh". TRƯỚC mọi truy cập DB (Upstash là fail-open nên khoá cứng thật nằm ở DB, đây chỉ là lớp ngoài).
//   3. đọc cơ sở của yêu cầu                       → không có ⇒ "không còn hiệu lực". Đọc KHÔNG có tác dụng phụ (khác `moBangToken` vốn tăng `soLanMo`).
//   4. cờ `laHubNguoiMuaBatChoCoSo(cơ sở)`          → TẮT ⇒ "không còn hiệu lực", KHÔNG gọi dịch vụ, KHÔNG ghi gì (kể cả bộ đếm mở / sai).
//   5. dịch vụ (`moBangToken` / `guiThongTinPhuHuynh`).
// ⚠️ CÙNG MỘT câu «Liên kết không còn hiệu lực» cho: mã sai, id lạ, token sai, hết hạn, đã đóng, vượt số lần mở, cờ TẮT, bot. Phân biệt chúng cho người lạ là cho họ một cái máy dò.
//    Ngoại lệ DUY NHẤT: «tạm khoá» — chỉ đến được khi token ĐÚNG (token sai khi đang khoá vẫn ra «không hợp lệ» ở dịch vụ), nên người nhận nó đang cầm liên kết thật.
// ⛔ Không log token, không log giá trị ô. `ghiLoi` nhận TÊN loại lỗi (không phải thông điệp: thông điệp lỗi của DB có thể chứa giá trị).
import type { KetQuaGhiO, KetQuaMo } from "./yeu-cau-nguoi-mua-db";
import { O_KHONG_DIEN_SAN, type DauVaoO, type GioiHanChongDoan, type OKhoa } from "./yeu-cau-nguoi-mua";
import { kiemBieuMau, type LoiBieuMau } from "./yeu-cau-nguoi-mua-bieu-mau";
import { docBanDauTho } from "./yeu-cau-nguoi-mua-ghi-don";
import { dienSanHocVienThem, docHocVienThemTho, kiemHocVienThem, type HocVienThem } from "./hoc-vien-them";
import { tachMaLienKet } from "./yeu-cau-nguoi-mua-token";

export const THONG_DIEP_CONG_KHAI = {
  KHONG_CON_HIEU_LUC: "Liên kết không còn hiệu lực. Vui lòng nhờ nhân viên Sata Robo cấp lại liên kết mới.",
  KHOA: "Liên kết đang tạm khoá. Vui lòng thử lại sau ít phút hoặc nhờ nhân viên Sata Robo cấp mã mới.",
  QUA_NHANH: "Bạn thao tác hơi nhanh. Vui lòng đợi vài phút rồi thử lại.",
  LOI_TAM: "Hệ thống đang bận, chưa gửi được thông tin. Vui lòng thử lại sau ít phút.",
  DU_LIEU: "Vui lòng kiểm tra lại các ô được đánh dấu.",
} as const;

/** Giới hạn tần suất của lớp NGOÀI. Hằng của tầng trang (không phải luật miền): đổi ở đây, test ghim. */
export const TAN_SUAT = {
  moTheoIp: { toiDa: 30, cuaSoMs: 10 * 60_000 },
  guiTheoIp: { toiDa: 15, cuaSoMs: 10 * 60_000 },
  theoYeuCau: { toiDa: 60, cuaSoMs: 10 * 60_000 },
} as const;

export type CauHinhNguoiMua = GioiHanChongDoan & { ttlPhut: number; giuDuLieuNgay: number; choXuLyToiDaNgay: number };

export type PhuThuoc = {
  /** `true` = còn trong hạn mức. */
  choPhep(khoa: string, toiDa: number, cuaSoMs: number): Promise<boolean>;
  /** Cơ sở của yêu cầu, hoặc `null` (id lạ / sai hình dạng). KHÔNG có tác dụng phụ. */
  docCoSo(id: string): Promise<string | null>;
  hubBat(centerId: string): Promise<boolean>;
  docCauHinh(): Promise<CauHinhNguoiMua>;
  mo(i: { id: string; token: string; gioiHan: GioiHanChongDoan; now: Date }): Promise<KetQuaMo>;
  gui(i: {
    id: string;
    token: string;
    gioiHan: GioiHanChongDoan;
    du: DauVaoO;
    banDau: DauVaoO;
    /** Các EM CÒN LẠI phụ huynh vừa gửi (đã chuẩn hoá) + bản điền sẵn họ nhìn thấy lúc mở (không CCCD) — chỉ có nghĩa khi người mua là cá nhân. */
    hocVienThem: HocVienThem[];
    hocVienThemBanDau: HocVienThem[];
    donY: { phienBanDieuKhoan: string } | null;
    now: Date;
  }): Promise<KetQuaGhiO>;
  /** Chỉ nhận TÊN loại lỗi. */
  ghiLoi(tenLoi: string): void;
};

type KieuChan = "KHONG_CON_HIEU_LUC" | "QUA_NHANH";
type Chan = { kieu: KieuChan; thongDiep: string };
const CHAN = (kieu: KieuChan): Chan => ({ kieu, thongDiep: THONG_DIEP_CONG_KHAI[kieu] });

const tenLoi = (e: unknown): string => (e instanceof Error ? e.name : "LoiLa");
const gioiHanCuaCauHinh = (c: CauHinhNguoiMua): GioiHanChongDoan => ({ toiDaSaiToken: c.toiDaSaiToken, toiDaLanMo: c.toiDaLanMo, khoaPhut: c.khoaPhut });

/** Cổng 2–4 dùng chung cho mở và gửi. `null` = qua hết. */
async function quaCong(id: string, loaiTanSuat: "mo" | "gui", ip: string, pt: PhuThuoc): Promise<Chan | null> {
  const g = loaiTanSuat === "mo" ? TAN_SUAT.moTheoIp : TAN_SUAT.guiTheoIp;
  if (!(await pt.choPhep(`hoa-don-nguoi-mua:${loaiTanSuat}:ip:${ip}`, g.toiDa, g.cuaSoMs))) return CHAN("QUA_NHANH");
  if (!(await pt.choPhep(`hoa-don-nguoi-mua:yeu-cau:${id}`, TAN_SUAT.theoYeuCau.toiDa, TAN_SUAT.theoYeuCau.cuaSoMs))) return CHAN("QUA_NHANH");
  const coSo = await pt.docCoSo(id);
  if (coSo === null) return CHAN("KHONG_CON_HIEU_LUC");
  if (!(await pt.hubBat(coSo))) return CHAN("KHONG_CON_HIEU_LUC");
  return null;
}

// ── MỞ TRANG ─────────────────────────────────────────────────────────────────

/**
 * Các ô điền sẵn (CHỈ giá trị — không nguồn, không giờ ghi). Nguồn: giá trị hiệu lực của ĐƠN → hồ sơ học viên → phiếu lead (`KetQuaMo.yeuCau.dienSan`), để phụ huynh chỉ sửa chỗ sai.
 * ⛔ KHÔNG BAO GIỜ gồm hai ô CCCD (`O_KHONG_DIEN_SAN`): trang này mở bằng liên kết, ai cầm liên kết (bị chuyển tiếp, lộ trong lịch sử trình duyệt) là thấy hết — điền sẵn CCCD là biến liên kết
 * thành bản sao của chính CCCD. [ĐÍNH CHÍNH 03/11/2026] SĐT + ngày sinh học viên NAY được điền sẵn (chủ dự án chốt); lọc ở ĐÂY là cổng cuối, không tin nơi gọi.
 */
export type OTrenForm = Partial<Record<OKhoa, string>>;
export type KetQuaMoTrang =
  | { kieu: "FORM"; o: OTrenForm; /** Các em còn lại đã lưu trên đơn — CHỈ tên + ngày sinh, KHÔNG CCCD. */ hocVienThem: { ten: string; ngaySinh: string | null }[] }
  | { kieu: "KHOA" | "KHONG_CON_HIEU_LUC" | "QUA_NHANH" | "LOI_TAM"; thongDiep: string };

const dienSanChoForm = (b: DauVaoO): OTrenForm => {
  const ra: OTrenForm = {};
  for (const [o, v] of Object.entries(b) as [OKhoa, string | null | undefined][]) if (typeof v === "string" && v !== "" && !O_KHONG_DIEN_SAN.includes(o)) ra[o] = v;
  return ra;
};

export async function xuLyMoTrang(i: { ma: unknown; ip: string; laBot: boolean; now: Date }, pt: PhuThuoc): Promise<KetQuaMoTrang> {
  if (i.laBot) return { kieu: "KHONG_CON_HIEU_LUC", thongDiep: THONG_DIEP_CONG_KHAI.KHONG_CON_HIEU_LUC };
  const m = tachMaLienKet(i.ma);
  if (!m) return { kieu: "KHONG_CON_HIEU_LUC", thongDiep: THONG_DIEP_CONG_KHAI.KHONG_CON_HIEU_LUC };
  try {
    const chan = await quaCong(m.id, "mo", i.ip, pt);
    if (chan) return chan;
    const cauHinh = await pt.docCauHinh();
    const kq = await pt.mo({ id: m.id, token: m.token, gioiHan: gioiHanCuaCauHinh(cauHinh), now: i.now });
    if (kq.ok) return { kieu: "FORM", o: dienSanChoForm(kq.yeuCau.dienSan), hocVienThem: dienSanHocVienThem(kq.yeuCau.dienSanHocVienThem).map((h) => ({ ten: h.ten, ngaySinh: h.ngaySinh })) };
    if (kq.ma === "KHOA") return { kieu: "KHOA", thongDiep: THONG_DIEP_CONG_KHAI.KHOA };
    return { kieu: "KHONG_CON_HIEU_LUC", thongDiep: THONG_DIEP_CONG_KHAI.KHONG_CON_HIEU_LUC };
  } catch (e) {
    pt.ghiLoi(tenLoi(e));
    return { kieu: "LOI_TAM", thongDiep: THONG_DIEP_CONG_KHAI.LOI_TAM };
  }
}

// ── GỬI BIỂU MẪU ─────────────────────────────────────────────────────────────

export type KetQuaGuiCongKhai =
  | { ok: true }
  | { ok: false; kieu: "DU_LIEU"; thongDiep: string; loi: LoiBieuMau }
  | { ok: false; kieu: "KHOA" | "KHONG_CON_HIEU_LUC" | "QUA_NHANH" | "LOI_TAM"; thongDiep: string };

const THAT_BAI = (kieu: "KHOA" | "KHONG_CON_HIEU_LUC" | "QUA_NHANH" | "LOI_TAM"): KetQuaGuiCongKhai => ({ ok: false, kieu, thongDiep: THONG_DIEP_CONG_KHAI[kieu] });

/**
 * `raw` = JSON KHÔNG TIN CẬY từ client. `phienBanDieuKhoan` = phiên bản văn bản đồng ý mà trang đang hiển thị (do tầng trang khai) — luôn được ghi kèm vì
 * `kiemBieuMau` đã BẮT BUỘC ô đồng ý: không có đường nào gửi dữ liệu mà không có bản ghi đồng ý.
 */
export async function xuLyGui(i: { ma: unknown; ip: string; raw: unknown; phienBanDieuKhoan: string; now: Date }, pt: PhuThuoc): Promise<KetQuaGuiCongKhai> {
  const m = tachMaLienKet(i.ma);
  if (!m) return THAT_BAI("KHONG_CON_HIEU_LUC");
  try {
    const chan = await quaCong(m.id, "gui", i.ip, pt);
    if (chan) return THAT_BAI(chan.kieu);
    const kiem = kiemBieuMau(i.raw);
    if (!kiem.ok) return { ok: false, kieu: "DU_LIEU", thongDiep: THONG_DIEP_CONG_KHAI.DU_LIEU, loi: kiem.loi };
    const cauHinh = await pt.docCauHinh();
    const gocTho = (i.raw as { banDau?: unknown; banDauHocVienThem?: unknown } | null) ?? {};
    // Bản điền sẵn của các em do CLIENT gửi lại (không tin cậy): kiểm lỏng — sai ⇒ coi như rỗng (mọi em phụ huynh gửi đều tính là «đổi»); CCCD luôn bỏ (không bao giờ điền sẵn).
    const banDauHv = kiemHocVienThem(docHocVienThemTho(gocTho.banDauHocVienThem));
    const kq = await pt.gui({
      id: m.id,
      token: m.token,
      gioiHan: gioiHanCuaCauHinh(cauHinh),
      du: kiem.du,
      banDau: docBanDauTho(gocTho.banDau),
      hocVienThem: kiem.hocVienThem,
      hocVienThemBanDau: banDauHv.ok ? dienSanHocVienThem(banDauHv.ds) : [],
      donY: { phienBanDieuKhoan: i.phienBanDieuKhoan },
      now: i.now,
    });
    if (kq.ok) return { ok: true };
    switch (kq.ma) {
      case "KHOA":
        return THAT_BAI("KHOA");
      case "DU_LIEU_SAI":
        // Lời theo ô của dịch vụ là câu kiểm định dạng thường ngày ("Mã số thuế gồm 10 hoặc 13 chữ số") — không phải mã nội bộ.
        return { ok: false, kieu: "DU_LIEU", thongDiep: THONG_DIEP_CONG_KHAI.DU_LIEU, loi: { theoO: kq.loiTheoO ?? {} } };
      case "KHONG_CO_DU_LIEU":
        return { ok: false, kieu: "DU_LIEU", thongDiep: THONG_DIEP_CONG_KHAI.DU_LIEU, loi: { theoO: {} } };
      default:
        // KHONG_HOP_LE · HET_HAN · DA_DONG · VUOT_SO_LAN_MO · KHONG_CO_QUYEN · còn lại ⇒ MỘT câu chung, không lộ mã.
        return THAT_BAI("KHONG_CON_HIEU_LUC");
    }
  } catch (e) {
    pt.ghiLoi(tenLoi(e));
    return THAT_BAI("LOI_TAM");
  }
}
