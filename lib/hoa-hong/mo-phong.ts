// lib/hoa-hong/mo-phong.ts — THỬ TÍNH chính sách (Simulation): phần THUẦN.
//
// Nguồn: docs/source-commission/04 §14, 05 PR10 (`[NHH-POL-10]`), 06 §5.2 bước "Thử tính". CHỈ ĐỌC — không ghi sổ, không ghi gì.
//
// Thử tính gọi ĐÚNG `tinhDongChoKhoan` mà engine thật gọi (L11): hàm này chỉ (1) dựng HAI tập quy tắc để so — "hiện tại" và "đề xuất" —
// (2) chạy lõi hai lần trên cùng một đầu vào của khoản thu, (3) gom kết quả. Không có công thức tiền nào ở đây; muốn đổi cách tính
// tiền thì đổi ở `tinh-chinh-sach.ts` / `tien.ts`, cả engine thật lẫn thử tính cùng đổi.
//
// ── Ba quyết định (đã chốt khi làm PR10, chủ dự án chưa phản bác) ───────────────────────────────────────────────
//  1. "Hiện tại" = bộ quy tắc ĐANG CÓ HIỆU LỰC HÔM NAY (`now`); "Đề xuất" = bộ đó, với MỌI quy tắc của chính sách đang soạn bị THAY bằng
//     quy tắc của bản đề xuất (04 §14: "version DRAFT thay version cùng policy") — chính sách khác giữ nguyên, nên "cụ thể thắng chung"
//     vẫn do `chonQuyTac` quyết. Cả hai bộ được DỜI hiệu lực về đầu thời gian: câu hỏi là "nếu áp bộ hôm nay / bộ đề xuất lên khoản thu
//     của khoảng đã chọn thì trả bao nhiêu", không phải "lịch sử đã trả bao nhiêu" (cái đó là sổ). Nhờ vậy bản đề xuất hiệu lực từ
//     tháng sau vẫn có số để so với 3 tháng đã qua.
//  2. Khoản không tính được ⇒ ĐẾM RIÊNG kèm lý do ("chưa thể tính"). Không có số 0 giả, không dòng 0đ.
//  3. Vượt trần ⇒ cờ + liệt kê khoản/vai/tỉ lệ; KHÔNG tự cắt (D1). Engine thật cũng ghi 0 dòng cho khoản đó, nên ở kịch bản ấy khoản đó
//     đóng góp 0 và được báo rõ — người đọc không bị đánh lừa rằng "đề xuất giảm tiền".
//
// ⚠️ Mọi hàm nhận `now` BẮT BUỘC (luật 19) — file này không đọc đồng hồ.
import type { QuyTac } from "./chon-quy-tac";
import type { HoaHongContext } from "./kieu";
import { ngayHopLe, dauNgayVN, ngayVN } from "./ngay-lam-viec";
import { tinhDongChoKhoan, type DauVaoKhoan, type KetQuaTinhKhoan } from "./tinh-dong-cho-khoan";

// ── Kịch bản chính sách ────────────────────────────────────────────────────────────────────

/** Mốc hiệu lực "từ đầu thời gian" — dời hiệu lực của mọi quy tắc về đây để chúng áp cho cả khoảng thử tính. */
const DAU_THOI_GIAN = new Date(0);

export type KichBanChinhSach = {
  hienTai: readonly QuyTac[];
  deXuat: readonly QuyTac[];
  /** Hợp của hai bộ — để nạp NGƯỜI HƯỞNG một lần cho cả hai (vai chỉ có ở một bộ vẫn có người). */
  hop: readonly QuyTac[];
};

/**
 * Quy tắc có hiệu lực tại `at`: biên mở `effectiveFrom ≤ at < effectiveTo`. Theo ĐÚNG luật của `chonQuyTac`: DRAFT / CANCELLED không bao giờ tham gia;
 * ACTIVE / SUPERSEDED / EXPIRED tham gia theo NGÀY hiệu lực (bản đã được thay nhưng hẹn đóng vào tương lai vẫn đang chạy hôm nay).
 */
export function dangHieuLucTai(q: QuyTac, at: Date): boolean {
  if (q.trangThai === "DRAFT" || q.trangThai === "CANCELLED") return false;
  if (q.effectiveFrom.getTime() > at.getTime()) return false;
  return q.effectiveTo === null || q.effectiveTo.getTime() > at.getTime();
}

const doiHieuLuc = (q: QuyTac): QuyTac => ({ ...q, effectiveFrom: DAU_THOI_GIAN, effectiveTo: null, trangThai: "ACTIVE" });

export function dungKichBan(i: {
  /** Mọi quy tắc đã nạp (`HoaHongContext.quyTac`) — nhiều version, nhiều trạng thái. */
  quyTacDaNap: readonly QuyTac[];
  /** Quy tắc của bản đề xuất (đã ánh xạ). */
  quyTacDeXuat: readonly QuyTac[];
  /** Chính sách bị bản đề xuất THAY. */
  policyIdDeXuat: string;
  now: Date;
}): KichBanChinhSach {
  const hienTai = i.quyTacDaNap.filter((q) => dangHieuLucTai(q, i.now)).map(doiHieuLuc);
  const deXuat = [...hienTai.filter((q) => q.policyId !== i.policyIdDeXuat), ...i.quyTacDeXuat.map(doiHieuLuc)];
  return { hienTai, deXuat, hop: [...hienTai, ...i.quyTacDeXuat.map(doiHieuLuc)] };
}

/** Hai bộ cấu hình tính: chỉ khác `quyTac`. Mọi thứ khác (trần, VAT, thứ tự phạm vi, danh mục) CHUNG. */
export function haiBoCauHinh(hh: HoaHongContext, kb: KichBanChinhSach): { hienTai: HoaHongContext; deXuat: HoaHongContext } {
  return { hienTai: { ...hh, quyTac: kb.hienTai }, deXuat: { ...hh, quyTac: kb.deXuat } };
}

/** Chạy lõi tính HAI lần trên cùng một khoản. */
export function tinhHaiKichBan(
  dauVao: (coSo: number) => DauVaoKhoan,
  coSo: number,
  cauHinh: { hienTai: HoaHongContext; deXuat: HoaHongContext },
): { hienTai: KetQuaTinhKhoan; deXuat: KetQuaTinhKhoan } {
  const goc = dauVao(coSo);
  return {
    hienTai: tinhDongChoKhoan({ ...goc, hoaHong: cauHinh.hienTai }),
    deXuat: tinhDongChoKhoan({ ...goc, hoaHong: cauHinh.deXuat }),
  };
}

// ── Khoảng thời gian ───────────────────────────────────────────────────────────────────────

/** Tối đa 186 ngày (6 tháng) — thử tính quét từng khoản, khoảng dài hơn chỉ làm chậm mà không thêm hiểu biết. */
export const SO_NGAY_TOI_DA = 186;

const NGAY_MS = 86_400_000;

/** "YYYY-MM-DD" ngày VN cộng `n` ngày lịch. */
function congNgay(ngay: string, n: number): string {
  const [y, m, d] = ngay.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * 3 THÁNG TRỌN VẸN gần nhất trước tháng hiện tại (giờ VN): `now` = 08/10/2026 ⇒ 01/07 → 30/09/2026. Tháng đang chạy không vào vì còn dở
 * — so một quý đủ với một tháng thiếu là so không công bằng.
 */
export function khoangMacDinh(now: Date): { tuNgay: string; denNgay: string } {
  const [y, m] = ngayVN(now).split("-").map(Number) as [number, number];
  const dau = new Date(Date.UTC(y, m - 1 - 3, 1)).toISOString().slice(0, 10);
  const cuoi = congNgay(new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10), -1);
  return { tuNgay: dau, denNgay: cuoi };
}

/** Lỗi của khoảng (`null` = hợp lệ). Cả hai đầu là ngày VN dạng "YYYY-MM-DD", gồm cả hai đầu. */
export function kiemKhoang(tuNgay: string, denNgay: string): string | null {
  if (!ngayHopLe(tuNgay)) return "Ngày bắt đầu không hợp lệ (cần dạng ngày/tháng/năm).";
  if (!ngayHopLe(denNgay)) return "Ngày kết thúc không hợp lệ (cần dạng ngày/tháng/năm).";
  if (denNgay < tuNgay) return "Ngày kết thúc phải từ ngày bắt đầu trở đi.";
  const soNgay = Math.round((Date.parse(`${denNgay}T00:00:00Z`) - Date.parse(`${tuNgay}T00:00:00Z`)) / NGAY_MS) + 1;
  if (soNgay > SO_NGAY_TOI_DA) return `Khoảng thử tính tối đa ${SO_NGAY_TOI_DA} ngày (6 tháng) — bạn chọn ${soNgay} ngày.`;
  return null;
}

/** Khoảng thời điểm `[tu, den)` — biên MỞ ở đầu sau (khoản đúng nửa đêm giao ngày không tính hai lần). */
export function khoangThoiDiem(tuNgay: string, denNgay: string): { tu: Date; den: Date } {
  return { tu: dauNgayVN(tuNgay), den: dauNgayVN(congNgay(denNgay, 1)) };
}

// ── Gom kết quả ────────────────────────────────────────────────────────────────────────────

export type KichBan = "hienTai" | "deXuat";

/** MỘT khoản thu tính được ở cả hai kịch bản. */
export type KhoanMoPhong = {
  paymentId: string;
  /** Ngày thu giờ VN, "YYYY-MM-DD". */
  ngayThu: string;
  centerId: string;
  loai: "NEW" | "RENEWAL";
  /** Mã nhóm nguồn ("UNKNOWN" khi nguồn không rõ). */
  nhomNguon: string;
  /** `netBase` của phần học phí (thực thu sau VAT). */
  coSo: number;
  hienTai: KetQuaTinhKhoan;
  deXuat: KetQuaTinhKhoan;
};

/** MỘT khoản KHÔNG tính được (thiếu dữ liệu để quyết — hàng chờ của engine thật). */
export type KhoanChuaTinh = { paymentId: string; ma: string; soTien: number };

export type TenHienThi = {
  /** `roleCode → tên` theo thứ tự master (thứ tự hàng của bảng phân rã theo vai). */
  vai: ReadonlyMap<string, string>;
  /** `groupCode → tên`. */
  nhom: ReadonlyMap<string, string>;
  /** `centerId → tên đơn vị`. */
  donVi: ReadonlyMap<string, string>;
};

export type SoTien3 = { hienTai: number; deXuat: number; chenh: number };

export type DongPhanRa = { khoa: string; nhan: string; soKhoan: number; coSo: number } & SoTien3;

export type CanhBaoTran = {
  kichBan: KichBan;
  paymentId: string;
  ngayThu: string;
  donVi: string;
  loai: "NEW" | "RENEWAL";
  coSo: number;
  /** Σ tỉ lệ tương đương của các quy tắc thắng (0,095 = 9,5%). */
  tiLe: number;
  tran: number;
  vai: { roleCode: string; vai: string; kieuTinh: string; giaTri: number | string }[];
};

export type LyDoGom = { ma: string; nhan: string; soKhoan: number; soTien: number };

export type TongHopMoPhong = {
  soKhoanTinhDuoc: number;
  /** Σ cơ sở tính (thực thu sau VAT) của các khoản tính được — CHUNG hai kịch bản. */
  coSo: number;
  hoaHong: SoTien3;
  /** Tỉ lệ hiệu dụng = hoa hồng ÷ cơ sở; `null` khi cơ sở = 0. */
  tiLeHieuDung: { hienTai: number | null; deXuat: number | null };
  phanRa: { vai: DongPhanRa[]; nguon: DongPhanRa[]; donVi: DongPhanRa[]; loai: DongPhanRa[] };
  tran: {
    gioiHan: number;
    hienTai: { soKhoan: number; danhSach: CanhBaoTran[] };
    deXuat: { soKhoan: number; danhSach: CanhBaoTran[] };
    /** `true` khi `danhSach` bị cắt (có nhiều khoản vượt hơn số đã liệt kê). */
    biCat: boolean;
  };
  /** Khoản chồng lấn quy tắc (cùng hạng) ở mỗi kịch bản — lỗi cấu hình, engine thật cũng 0 dòng. */
  chongLan: { hienTai: number; deXuat: number };
  /** Khoản thu KHÔNG tính được, gom theo lý do. */
  chuaTinh: { soKhoan: number; theoLyDo: LyDoGom[] };
  /** Dòng hoa hồng không có người hưởng (thiếu dữ liệu) — chưa thể tính, không vào tổng. */
  thieuNguoi: { hienTai: LyDoGom[]; deXuat: LyDoGom[] };
  /** Số người có tổng hoa hồng KHÁC nhau giữa hai kịch bản (chỉ đếm — không tiền từng người). */
  soNguoiAnhHuong: number;
};

/** Tối đa số khoản vượt trần liệt kê MỖI kịch bản (phần còn lại chỉ đếm). */
export const TOI_DA_LIET_KE_TRAN = 25;

const NHAN_CHUA_TINH: Record<string, string> = {
  CHUA_GAN_CON: "Khoản thu chưa gắn cho bé nào",
  CHO_HOC_VIEN: "Chờ hồ sơ học viên",
  MANUAL_REVIEW_REQUIRED: "Cần người xem tay (thiếu dữ liệu để phân loại)",
  PENDING_REGULATION: "Loại giao dịch chưa có quy định (chờ văn bản)",
  NO_ORG_UNIT: "Cơ sở chưa có đơn vị trong cây tổ chức",
  INTERNAL_TRANSFER: "Chuyển tiền nội bộ giữa hai bé",
  NEGATIVE_WITHOUT_ORIGIN: "Bút toán âm không có khoản gốc",
  LOI_DU_LIEU: "Dữ liệu khoản thu lỗi, không đọc được",
};

const NHAN_THIEU_NGUOI: Record<string, string> = {
  KHONG_CO_LEAD: "Đơn không có lead — không biết ai chốt đơn",
  LEAD_THIEU_NGUOI: "Lead chưa có người phụ trách",
  CHUA_KHAI_NGUOI_PHU_TRACH: "Cơ sở chưa khai người phụ trách vai này",
  KHONG_QUY_VE_CO_SO: "Không quy được khoản thu về cơ sở nào",
  THIEU_SALE_PHU_HUYNH: "Phụ huynh giới thiệu nhưng chưa xác định được Sale phụ trách phụ huynh",
  NGUON_CHUA_CO_NGUOI_PHU_TRACH: "Nguồn chưa khai người phụ trách",
  NGUOI_HUONG_NGHI: "Người hưởng đã nghỉ việc",
  RESOLVER_CHUA_HO_TRO: "Cách tìm người hưởng của vai này chưa được hỗ trợ",
  RESOLVER_KHONG_BIET: "Không xác định được người hưởng của vai",
};

export const nhanChuaTinh = (ma: string): string => NHAN_CHUA_TINH[ma] ?? ma;
export const nhanThieuNguoi = (ma: string): string => NHAN_THIEU_NGUOI[ma] ?? ma;

type Gom = { soKhoan: number; coSo: number; hienTai: number; deXuat: number };
const gomMoi = (): Gom => ({ soKhoan: 0, coSo: 0, hienTai: 0, deXuat: 0 });

function tongTienOk(k: KetQuaTinhKhoan): number {
  return k.loai === "OK" ? k.dong.reduce((s, d) => s + d.amount, 0) : 0;
}

function dongTheoVai(k: KetQuaTinhKhoan): Map<string, number> {
  const m = new Map<string, number>();
  if (k.loai === "OK") for (const d of k.dong) m.set(d.roleCode, (m.get(d.roleCode) ?? 0) + d.amount);
  return m;
}

function sapXepDong(dong: DongPhanRa[]): DongPhanRa[] {
  return dong.sort((a, b) => Math.max(b.hienTai, b.deXuat) - Math.max(a.hienTai, a.deXuat) || (a.nhan < b.nhan ? -1 : a.nhan > b.nhan ? 1 : 0));
}

function ketDong(gom: ReadonlyMap<string, Gom>, nhanCua: (khoa: string) => string): DongPhanRa[] {
  return [...gom].map(([khoa, g]) => ({ khoa, nhan: nhanCua(khoa), soKhoan: g.soKhoan, coSo: g.coSo, hienTai: g.hienTai, deXuat: g.deXuat, chenh: g.deXuat - g.hienTai }));
}

export function tongHopMoPhong(i: { khoan: readonly KhoanMoPhong[]; chuaTinh: readonly KhoanChuaTinh[]; ten: TenHienThi; tran: number }): TongHopMoPhong {
  const theoVai = new Map<string, Gom>([...i.ten.vai.keys()].map((k) => [k, gomMoi()]));
  const theoNguon = new Map<string, Gom>();
  const theoDonVi = new Map<string, Gom>();
  const theoLoai = new Map<string, Gom>([["NEW", gomMoi()], ["RENEWAL", gomMoi()]]);
  const theoNguoi = new Map<string, { hienTai: number; deXuat: number }>();
  const canhBao: Record<KichBan, CanhBaoTran[]> = { hienTai: [], deXuat: [] };
  const soVuotTran: Record<KichBan, number> = { hienTai: 0, deXuat: 0 };
  const chongLan: Record<KichBan, number> = { hienTai: 0, deXuat: 0 };
  const thieu: Record<KichBan, Map<string, { soDong: number; tien: number }>> = { hienTai: new Map(), deXuat: new Map() };

  const lay = (m: Map<string, Gom>, k: string) => {
    let g = m.get(k);
    if (!g) m.set(k, (g = gomMoi()));
    return g;
  };
  const tenVai = (code: string) => i.ten.vai.get(code) ?? code;
  const thuTuMaster = [...i.ten.vai.keys()];
  const thuTuVai = (code: string) => {
    const x = thuTuMaster.indexOf(code);
    return x < 0 ? thuTuMaster.length : x;
  };

  let coSoTong = 0;
  let hienTai = 0;
  let deXuat = 0;
  for (const k of i.khoan) {
    const h = tongTienOk(k.hienTai);
    const d = tongTienOk(k.deXuat);
    coSoTong += k.coSo;
    hienTai += h;
    deXuat += d;
    for (const [m, khoa] of [[theoNguon, k.nhomNguon], [theoDonVi, k.centerId], [theoLoai, k.loai]] as const) {
      const g = lay(m, khoa);
      g.soKhoan += 1;
      g.coSo += k.coSo;
      g.hienTai += h;
      g.deXuat += d;
    }
    // Vai: số khoản mà vai CÓ TIỀN ở ít nhất một kịch bản, và Σ cơ sở của các khoản đó.
    const vaiHienTai = dongTheoVai(k.hienTai);
    const vaiDeXuat = dongTheoVai(k.deXuat);
    for (const role of new Set([...vaiHienTai.keys(), ...vaiDeXuat.keys()])) {
      const g = lay(theoVai, role);
      g.soKhoan += 1;
      g.coSo += k.coSo;
      g.hienTai += vaiHienTai.get(role) ?? 0;
      g.deXuat += vaiDeXuat.get(role) ?? 0;
    }
    for (const kb of ["hienTai", "deXuat"] as const) {
      const r = k[kb];
      if (r.loai === "OK") {
        for (const dong of r.dong) {
          const khoaNguoi = `${dong.beneficiaryKind}:${dong.beneficiaryId}`;
          const n = theoNguoi.get(khoaNguoi) ?? { hienTai: 0, deXuat: 0 };
          n[kb] += dong.amount;
          theoNguoi.set(khoaNguoi, n);
        }
        for (const t of r.treo) {
          if (!t.coHangCho) continue; // trạng thái bình thường (không có GV trial, ngoài cửa sổ…) — không phải thiếu dữ liệu
          const x = thieu[kb].get(t.lyDo) ?? { soDong: 0, tien: 0 };
          x.soDong += 1;
          x.tien += t.tienVai;
          thieu[kb].set(t.lyDo, x);
        }
      } else if (r.loai === "VUOT_TRAN") {
        soVuotTran[kb] += 1;
        if (canhBao[kb].length < TOI_DA_LIET_KE_TRAN) {
          canhBao[kb].push({
            kichBan: kb,
            paymentId: k.paymentId,
            ngayThu: k.ngayThu,
            donVi: i.ten.donVi.get(k.centerId) ?? k.centerId,
            loai: k.loai,
            coSo: k.coSo,
            tiLe: r.tiLeTuongDuong,
            tran: r.tran,
            vai: r.quyTacThang.map((q) => ({ roleCode: q.roleCode, vai: tenVai(q.roleCode), kieuTinh: q.kieuTinh, giaTri: q.giaTri })),
          });
        }
      } else {
        chongLan[kb] += 1;
      }
    }
  }
  // Khoản mà kịch bản KHÔNG ra tiền vì lỗi cấu hình vẫn nằm trong `soKhoan`/`coSo` của nhóm (nó là thực thu có thật) — đóng góp 0.
  const gomLyDo = (m: ReadonlyMap<string, { soDong: number; tien: number }>, nhan: (ma: string) => string): LyDoGom[] =>
    [...m].map(([ma, x]) => ({ ma, nhan: nhan(ma), soKhoan: x.soDong, soTien: x.tien })).sort((a, b) => b.soTien - a.soTien || (a.ma < b.ma ? -1 : 1));

  const chuaTheoLyDo = new Map<string, { soDong: number; tien: number }>();
  for (const c of i.chuaTinh) {
    const x = chuaTheoLyDo.get(c.ma) ?? { soDong: 0, tien: 0 };
    x.soDong += 1;
    x.tien += c.soTien;
    chuaTheoLyDo.set(c.ma, x);
  }

  const tiLe = (tu: number): number | null => (coSoTong > 0 ? tu / coSoTong : null);
  return {
    soKhoanTinhDuoc: i.khoan.length,
    coSo: coSoTong,
    hoaHong: { hienTai, deXuat, chenh: deXuat - hienTai },
    tiLeHieuDung: { hienTai: tiLe(hienTai), deXuat: tiLe(deXuat) },
    phanRa: {
      vai: ketDong(theoVai, tenVai)
        .filter((r) => r.soKhoan > 0)
        .sort((a, b) => thuTuVai(a.khoa) - thuTuVai(b.khoa) || (a.khoa < b.khoa ? -1 : 1)),
      nguon: sapXepDong(ketDong(theoNguon, (k) => i.ten.nhom.get(k) ?? (k === "UNKNOWN" ? "Không rõ nguồn" : k))),
      donVi: sapXepDong(ketDong(theoDonVi, (k) => i.ten.donVi.get(k) ?? k)),
      loai: ketDong(theoLoai, (k) => (k === "NEW" ? "Học viên mới" : "Tái tục")).filter((r) => r.soKhoan > 0),
    },
    tran: {
      gioiHan: i.tran,
      hienTai: { soKhoan: soVuotTran.hienTai, danhSach: canhBao.hienTai },
      deXuat: { soKhoan: soVuotTran.deXuat, danhSach: canhBao.deXuat },
      biCat: soVuotTran.hienTai > canhBao.hienTai.length || soVuotTran.deXuat > canhBao.deXuat.length,
    },
    chongLan,
    chuaTinh: { soKhoan: i.chuaTinh.length, theoLyDo: gomLyDo(chuaTheoLyDo, nhanChuaTinh) },
    thieuNguoi: { hienTai: gomLyDo(thieu.hienTai, nhanThieuNguoi), deXuat: gomLyDo(thieu.deXuat, nhanThieuNguoi) },
    soNguoiAnhHuong: [...theoNguoi.values()].filter((n) => n.hienTai !== n.deXuat).length,
  };
}

// ── Kết quả trả cho giao diện (JSON thuần — không Date, không Map) ──────────────────────────────

export type KetQuaMoPhong = TongHopMoPhong & {
  khoang: { tuNgay: string; denNgay: string };
  /** Số khoản thu DƯƠNG trong khoảng + phạm vi (trước khi cắt). */
  soKhoanTrongKhoang: number;
  /** Có ⇒ chỉ xét `tran` khoản MỚI nhất; `soKhoanChuaXet` khoản cũ hơn (từ `xetTuNgay` trở về trước) KHÔNG được tính. */
  cat: { tran: number; soKhoanChuaXet: number; xetTuNgay: string } | null;
  /** Bút toán nằm ngoài thử tính — nói ra để người đọc không tưởng đã gồm. */
  ngoai: { soKhoanHoan: number; tienHoan: number; soKhoanKhongPhaiHocPhi: number; soKhoanChuyenNoiBo: number };
  phamVi: { soCoSo: number | null };
};

export type KetQuaThuTinh =
  | {
      ok: true;
      ketQua: KetQuaMoPhong;
      /** `updatedAt` (ISO) của bản nháp đã thử tính — client so với bản đang soạn để biết kết quả còn đúng không. */
      phienBanCapNhatLuc: string;
      chayLuc: string;
    }
  | { ok: false; chung: string; loiKhoang?: string };
