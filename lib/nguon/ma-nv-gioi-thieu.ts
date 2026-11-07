/**
 * lib/nguon/ma-nv-gioi-thieu.ts — cột "Mã NV giới thiệu" của Excel nhập lead. THUẦN (không DB, không đồng hồ).
 *
 * Việc của nó: từ MỘT ô mã nhân viên + nhãn nguồn của dòng, quyết định có nên đưa `employeeId` cho resolver quy nguồn
 * (`nhanSuGioiThieuEmployeeId` → luật `NV_GIOI_THIEU`) hay không — và nếu không thì NÓI LÝ DO.
 *
 * ── Vì sao có cổng, mà không đưa thẳng id vào ───────────────────────────────────────────────────────────────
 * `NV_GIOI_THIEU` đứng TRƯỚC `KHAI_TAY` trong `THU_TU_LUAT_MAC_DINH`: đưa id vào là NHÓM NGUỒN của dòng thành nhóm nhân sự giới thiệu,
 * bất kể ô "Nguồn" ghi gì. Dòng ghi "Ads" kèm một mã NV sẽ đổi từ quảng cáo sang nhân sự — im lặng, và nguồn gốc (first-claim, D3)
 * không sửa lại được ngoài `doiNguon` có lý do. Người nhập file cầm cột "Nguồn" là lời khai có chủ đích; cột mã không được ghi đè nó.
 * Nên: mã chỉ có tác dụng khi nhãn nguồn TRỐNG hoặc ánh xạ tới một nhóm có `referrerRequirement = EMPLOYEE`. Quyết định theo THUỘC TÍNH
 * của nhóm, không theo mã nhóm (nguồn nhân sự do admin cấu hình làm đích mặc định cũng được tính).
 *
 * ── KHÔNG BAO GIỜ GHI SAI NGƯỜI ────────────────────────────────────────────────────────────────────────────
 * Mã không có / mơ hồ (hai nhân viên cùng mã sau chuẩn hoá) / nhân sự đã nghỉ / nhãn mâu thuẫn ⇒ `BO_QUA` kèm lý do: đường gọi KHÔNG
 * đưa id (người nhập thấy cảnh báo, lead vẫn được tạo — cùng nếp cột "Sale phụ trách"). Không bao giờ khớp theo TÊN: ô chứa tên người
 * không có trong bảng mã ⇒ không giải được ⇒ `BO_QUA`.
 *
 * ── Ngày giải mã ───────────────────────────────────────────────────────────────────────────────────────────
 * `ngayGiaiMa` là NGÀY TRÊN PHIẾU (file đăng ký có cột "Ngày") hoặc hôm nay (file sự kiện không có cột ngày). Mã bị đổi/hoán vị
 * (04/09/2026) nên "mã X là ai" phụ thuộc ngày: xem `giaiMaNhanVienTheoNgay`. `bayGio` (lúc nhập) là thứ riêng — nó là mốc mà lõi quy nguồn
 * xét nhãn cũ (`MOC_KHAO_SAT_0610`), và cổng nhãn ở đây phải xét CÙNG mốc với lõi, không phải ngày cũ của dòng.
 */
import type { SourceReferrerRequirement } from "@prisma/client";
import { anhXaNhanCu, chuanHoaNhanNguon } from "./anh-xa-nhan-cu";
import { VAI_SANG_NGUON_MAC_DINH } from "./danh-muc-goc";
import { chuanHoaMaNhanVien, giaiMaNhanVienTheoNgay, type DoiMa } from "./ma-nhan-vien";
import { chuoiGocDeLuu, maNvLuuDuoc, PHAN_CACH_KHAC_MA, UNG_VIEN_TOI_DA } from "./ma-nv-an-toan";
import type { LoaiMaNvSai, MaNvSai } from "./tin-hieu";

/** Trạng thái làm việc được claim MỚI làm người giới thiệu — cùng luật D13 của `thu-thap-tin-hieu` (bước 3). */
const TRANG_THAI_DUOC_CLAIM: readonly string[] = ["ACTIVE", "ON_LEAVE"];

/** code nhóm → kiểu người giới thiệu nhóm đó cần (thuộc tính của dòng master `LeadSourceGroup`). */
export type NhomYeuCau = ReadonlyMap<string, SourceReferrerRequirement>;

export type BangTraMaNv = {
  /** Mã đã chuẩn hoá → `Employee.id`, CHỈ mã có đúng MỘT chủ. */
  maHienTai: ReadonlyMap<string, string>;
  /** Mã đã chuẩn hoá có ≥ 2 nhân viên (vd `NV.SR.002` và `SR.NV.002`) — mơ hồ, không giải. */
  maTrung: ReadonlySet<string>;
  trangThai: ReadonlyMap<string, string>;
  lichSu: readonly DoiMa[];
};

/** Dựng bảng tra từ nhân viên + lịch sử đổi mã (AuditLog). Đếm va chạm — bản cũ ghi đè `Map` im lặng. */
export function dungBangTraMaNv(
  nhanVien: readonly { id: string; employeeCode: string; status: string }[],
  lichSu: readonly DoiMa[],
): BangTraMaNv {
  const chu = new Map<string, string[]>();
  const trangThai = new Map<string, string>();
  for (const e of nhanVien) {
    const ma = chuanHoaMaNhanVien(e.employeeCode);
    chu.set(ma, [...(chu.get(ma) ?? []), e.id]);
    trangThai.set(e.id, e.status);
  }
  const maHienTai = new Map<string, string>();
  const maTrung = new Set<string>();
  for (const [ma, ids] of chu) {
    if (ids.length === 1) maHienTai.set(ma, ids[0]!);
    else maTrung.add(ma);
  }
  return {
    maHienTai,
    maTrung,
    trangThai,
    lichSu: lichSu.map((d) => ({ ...d, maCu: d.maCu === null ? null : chuanHoaMaNhanVien(d.maCu), maMoi: chuanHoaMaNhanVien(d.maMoi) })),
  };
}

export type KetQuaMaNv =
  /** Ô mã trống ⇒ hành vi cũ, không có gì để làm. */
  | { kieu: "KHONG_CO" }
  | { kieu: "DUNG"; employeeId: string }
  /**
   * Có mã nhưng KHÔNG dùng được ⇒ KHÔNG đưa id; `lyDo` là câu hiển thị cho NGƯỜI NHẬP FILE (chữ họ vừa gõ, chỉ nằm trong phản hồi của lượt nhập — không lưu).
   * `ma` = bản đã chuẩn hoá (HOA); `raw` = chữ người nhập GÕ (đã trim, ≤ 40 ký tự — `chuoiGocDeLuu`). Cả hai có thể là SĐT/tên: đi tiếp qua `maNvSaiTuKetQua` (`ma` chỉ giữ chuỗi có dạng mã; `raw` lưu để người có quyền PII thấy) — ĐỪNG ghi thẳng ở nơi khác.
   * `phanLoai` + `ma` là phần MÁY ĐỌC (11/10/2026): mã sai không còn chỉ là một dòng cảnh báo bay mất sau lượt nhập — nó đi tiếp vào `TinHieuQuyNguon.maNvSai`
   * để lead mang dấu «mã NV giới thiệu sai» vào hàng chờ nguồn. (Tên trường là `phanLoai`, KHÔNG phải `kieu`: `kieu` đã là khoá phân biệt của chính kiểu này.)
   */
  | { kieu: "BO_QUA"; lyDo: string; phanLoai: LoaiMaNvSai; ma: string; raw: string };

const trong = (s: string | null | undefined): boolean => s == null || s.trim() === "";

/** Dựng `MaNvSai` từ MỘT mã đã chuẩn hoá + chữ gốc. `ma` chỉ giữ khi có dạng mã; `doDai` = độ dài chuỗi đã gõ (kể cả khi bị che); `raw` = chữ gốc đã trim/cắt. */
function dungMaNvSai(ma: string, loai: LoaiMaNvSai, raw: string): MaNvSai {
  return { ma: maNvLuuDuoc(ma), loai, doDai: ma.length, raw: chuoiGocDeLuu(raw) };
}

/**
 * `MaNvSai` của một kết quả giải mã: chỉ `BO_QUA` mới là mã sai. `KHONG_CO`/`DUNG` ⇒ null. THUẦN.
 * Ô «Mã NV» là CHỮ TỰ DO (có thể là SĐT phụ huynh / tên): `ma` (hiện cho mọi người) chỉ giữ chuỗi có DẠNG MÃ, `raw` lưu chữ gốc cho người có quyền PII — xem `ma-nv-an-toan.ts` (MỘT cổng chung cho cả hai hàm dựng).
 */
export function maNvSaiTuKetQua(kq: KetQuaMaNv): MaNvSai | null {
  return kq.kieu === "BO_QUA" ? dungMaNvSai(kq.ma, kq.phanLoai, kq.raw) : null;
}

/**
 * `MaNvSai` của nhóm SĐT mà các dòng ghi mã KHÁC NHAU (`gopMaCungSdt.khacNhau`) — hàm giải mã không bao giờ thấy ca này (đường gọi gộp trước khi hỏi),
 * nên đường gọi phải dựng nó. Đầu vào là các ô GỐC của nhóm (`cacMaGocKhacNhau`).
 *  · `ma` (hiện cho MỌI người) = các mã khác nhau nối bằng « | », đã sắp (không phụ thuộc thứ tự dòng); MỖI mã được kiểm dạng TRƯỚC khi nối (chuỗi đã nối có khoảng trắng nên kiểm sau
 *    khi nối sẽ che mọi giá trị), mã không có dạng bị bỏ khỏi chuỗi — không còn mã nào có dạng ⇒ `null`. `doDai` = tổng độ dài các mã đã gõ.
 *  · `raw` (chỉ người có quyền PII thấy) = các ứng viên XUNG ĐỘT theo chữ người gõ, cùng thứ tự, tối đa `UNG_VIEN_TOI_DA` (dư ⇒ «… +N»).
 */
export function maNvSaiKhacMa(cacMaGoc: readonly (string | null)[]): MaNvSai {
  const nhom = nhomTheoMaChuan(cacMaGoc);
  const gioLai = nhom.map((n) => maNvLuuDuoc(n.chuan)).filter((m): m is string => m !== null);
  const hienRaw = nhom.slice(0, UNG_VIEN_TOI_DA).map((n) => n.goc);
  const du = nhom.length - hienRaw.length;
  return {
    ma: gioLai.length > 0 ? gioLai.join(PHAN_CACH_KHAC_MA) : null,
    loai: "KHAC_MA",
    doDai: nhom.reduce((t, n) => t + n.chuan.length, 0),
    raw: (du > 0 ? [...hienRaw, `… +${du}`] : hienRaw).join(PHAN_CACH_KHAC_MA),
  };
}

/**
 * Gom các ô gốc theo MÃ CHUẨN HOÁ: ô trống bỏ; cùng mã khác hoa/thường là MỘT ứng viên (giữ bản nhỏ nhất theo thứ tự chữ để KHÔNG phụ thuộc thứ tự dòng); mỗi ô qua `chuoiGocDeLuu` (trim, ≤ 40).
 * Sắp theo mã chuẩn hoá. MỘT chỗ gom cho cả `cacMaGocKhacNhau` lẫn `maNvSaiKhacMa`.
 */
function nhomTheoMaChuan(cacMaGoc: readonly (string | null)[]): { chuan: string; goc: string }[] {
  const theoChuan = new Map<string, string>();
  for (const g of cacMaGoc) {
    if (g == null) continue;
    const goc = chuoiGocDeLuu(g);
    if (goc === "") continue;
    const chuan = chuanHoaMaNhanVien(goc);
    const cu = theoChuan.get(chuan);
    if (cu === undefined || goc < cu) theoChuan.set(chuan, goc);
  }
  return [...theoChuan.keys()].sort().map((chuan) => ({ chuan, goc: theoChuan.get(chuan)! }));
}

/** Cổng nhãn: mã chỉ có tác dụng khi nhãn TRỐNG hoặc ánh xạ tới nhóm kiểu EMPLOYEE. */
function nhanChoPhepMa(input: {
  nhanKhai: string | null;
  bayGio: Date;
  nhomYeuCau: NhomYeuCau;
  nhomNhanSu: string;
}): { ok: true } | { ok: false; lyDo: string } {
  if (chuanHoaNhanNguon(input.nhanKhai) === null) return { ok: true };
  const nhan = (input.nhanKhai ?? "").trim();
  const kq = anhXaNhanCu(
    { nhan: input.nhanKhai, createdAt: input.bayGio, affiliate: null, nguoiNhap: null, maNvTrongNote: null },
    VAI_SANG_NGUON_MAC_DINH,
    input.nhomNhanSu,
  );
  if (kq.loai === "INVALID") {
    return { ok: false, lyDo: `nguồn "${nhan}" không có trong danh sách nguồn nên không biết có phải nguồn nhân sự giới thiệu không` };
  }
  if (input.nhomYeuCau.get(kq.nhom) === "EMPLOYEE") return { ok: true };
  return { ok: false, lyDo: `nguồn "${nhan}" không phải nguồn nhân sự giới thiệu` };
}

/**
 * Quyết định cho MỘT lead (đã gộp các dòng cùng SĐT — xem `gopMaCungSdt`).
 * `maTho` = ô mã nhập tay (chưa chuẩn hoá). `nhanKhai` = nhãn nguồn NGƯỜI GÕ (null = để trống).
 */
export function quyetDinhMaNvGioiThieu(input: {
  maTho: string | null;
  nhanKhai: string | null;
  /** Ngày dùng để hỏi "mã này là ai" — ngày trên phiếu nếu có, không thì hôm nay. */
  ngayGiaiMa: Date;
  /** Lúc nhập — mốc lõi quy nguồn xét nhãn. */
  bayGio: Date;
  bang: BangTraMaNv;
  nhomYeuCau: NhomYeuCau;
  /** Nhóm đích "nhân sự giới thiệu" mặc định (setting `nguon.nhomNhanSuMacDinh`). */
  nhomNhanSu: string;
}): KetQuaMaNv {
  if (trong(input.maTho)) return { kieu: "KHONG_CO" };
  const ma = chuanHoaMaNhanVien(input.maTho!);
  const raw = chuoiGocDeLuu(input.maTho!);

  const nhan = nhanChoPhepMa(input);
  if (!nhan.ok) {
    return { kieu: "BO_QUA", lyDo: `${nhan.lyDo} — mã "${ma}" không được áp dụng, nguồn của dòng giữ nguyên`, phanLoai: "NHAN_MAU_THUAN", ma, raw };
  }

  if (input.bang.maTrung.has(ma)) {
    return { kieu: "BO_QUA", lyDo: `mã "${ma}" khớp nhiều nhân viên (mơ hồ) — không ghi người giới thiệu`, phanLoai: "MO_HO", ma, raw };
  }
  const id = giaiMaNhanVienTheoNgay(ma, input.ngayGiaiMa, input.bang.lichSu, input.bang.maHienTai);
  if (id === null) {
    return { kieu: "BO_QUA", lyDo: `mã "${ma}" không có trong hệ thống tại ngày dùng mã — không ghi người giới thiệu`, phanLoai: "KHONG_TON_TAI", ma, raw };
  }
  const tt = input.bang.trangThai.get(id);
  if (tt === undefined || !TRANG_THAI_DUOC_CLAIM.includes(tt)) {
    return { kieu: "BO_QUA", lyDo: `nhân sự mã "${ma}" không còn làm việc — không ghi người giới thiệu mới`, phanLoai: "DA_NGHI", ma, raw };
  }
  return { kieu: "DUNG", employeeId: id };
}

/**
 * Nhiều dòng cùng SĐT = MỘT lead (gộp con). Mã của cả nhà phải THỐNG NHẤT: một dòng có mã, các dòng khác trống ⇒ lấy mã đó; nhiều
 * dòng ghi mã KHÁC NHAU ⇒ `khacNhau` và KHÔNG lấy dòng nào (lấy "dòng đầu" thì kết quả phụ thuộc thứ tự dòng — đây là tiền).
 */
export function gopMaCungSdt(maTho: readonly (string | null)[]): { ma: string | null; goc: string | null; khacNhau: boolean } {
  const co = maTho.filter((m): m is string => !trong(m)).map((m) => m.trim());
  const chuan = new Set(co.map((m) => chuanHoaMaNhanVien(m)));
  if (chuan.size === 0) return { ma: null, goc: null, khacNhau: false };
  if (chuan.size === 1) {
    // `goc` = ô GỐC (đã trim, KHÔNG cắt) — đường gọi đưa NÓ cho `quyetDinhMaNvGioiThieu`, không phải `ma` đã chuẩn hoá: chuẩn hoá xong là mất chữ người gõ (hoa/thường) mà `raw` cần giữ.
    // Nhiều ô cùng mã khác hoa/thường ⇒ lấy bản nhỏ nhất theo thứ tự chữ để KHÔNG phụ thuộc thứ tự dòng.
    return { ma: [...chuan][0]!, goc: [...co].sort()[0]!, khacNhau: false };
  }
  return { ma: null, goc: null, khacNhau: true };
}

/**
 * Các ô GỐC khác nhau (theo mã chuẩn hoá, đã sắp, mỗi ô đã trim/cắt 40) trong nhóm dòng cùng SĐT — để dựng `maNvSaiKhacMa` khi `gopMaCungSdt.khacNhau`. Không phụ thuộc thứ tự dòng.
 * (Bản cũ `cacMaKhacNhau` trả mã ĐÃ chuẩn hoá nên mất chữ người gõ — đã thay: người có quyền PII cần thấy ĐÚNG ô họ gõ.)
 */
export function cacMaGocKhacNhau(maTho: readonly (string | null)[]): string[] {
  return nhomTheoMaChuan(maTho).map((n) => n.goc);
}

/**
 * File ĐĂNG KÝ có cột "Ngày" (dd/mm/yyyy, do `formatExcelDate` dựng): mã nhân viên trên dòng được GÕ vào ngày đó, nên "mã X là ai" phải
 * hỏi ở NGÀY ĐÓ — mã đã bị hoán vị 04/09/2026. Một phụ huynh có thể nhiều con = nhiều dòng = nhiều ngày: lấy ngày SỚM NHẤT đọc được.
 *
 * Giữa trưa giờ VN (05:00Z) thay vì 00:00: ngày không có giờ, và nửa đêm đặt phiếu vào đầu ngày — trước cả những đợt đổi mã xảy ra trong ngày.
 * Ngày TƯƠNG LAI (gõ nhầm năm) bị bỏ: giải mã ở một ngày chưa tới thì mọi đợt đổi mã đã xảy ra bị "lùi" ngược, ra người cũ.
 * Không đọc được ngày nào ⇒ `bayGio`. THUẦN (không đọc đồng hồ): `bayGio` do đường gọi truyền.
 */
export function ngayGiaiMaTuDongDangKy(ngay: readonly (string | null)[], bayGio: Date): Date {
  let tot: Date | null = null;
  for (const s of ngay) {
    const m = s == null ? null : /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(s);
    if (!m) continue;
    const [dd, mm, yyyy] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const t = new Date(Date.UTC(yyyy, mm - 1, dd, 5, 0, 0));
    // Ngày không tồn tại (31/02, tháng 13) bị Date tự "cuộn" sang ngày khác — đối chiếu lại.
    if (t.getUTCFullYear() !== yyyy || t.getUTCMonth() !== mm - 1 || t.getUTCDate() !== dd) continue;
    if (t.getTime() > bayGio.getTime()) continue;
    if (tot === null || t.getTime() < tot.getTime()) tot = t;
  }
  return tot ?? bayGio;
}
