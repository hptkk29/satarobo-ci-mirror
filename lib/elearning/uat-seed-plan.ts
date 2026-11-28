/**
 * KẾ HOẠCH DỮ LIỆU UAT E-LEARNING TRÊN TEST — THUẦN (không DB, không giờ hệ thống, không mạng).
 *
 * Người chạy thật là `scripts/uat/seed-elearning-uat.ts`; tệp này chỉ khai BÁO "tạo cái gì, mang khoá gì" để:
 *  · script dry-run in được đúng danh sách bản ghi sẽ tạo/đã có;
 *  · lưới `uat-seed-plan.test.ts` kiểm bất biến (tiền tố, trùng khoá, ≥ 2 người cùng vai, mọi khoá có người học…);
 *  · cleanup biết CHỈ xoá thứ mang dấu của đợt này.
 *
 * ⚠️ Mọi thứ do đợt này tạo mang tiền tố `uat.el.` (email, mã nhân viên, mã khoá, slug, mã khung chấm, tiêu đề) để đối soát
 * và dọn nhanh mà không đụng dữ liệu thật. Không mật khẩu nào ở đây — mật khẩu đến từ env lúc chạy.
 */

export const TIEN_TO = "uat.el.";
/** Tiền tố dùng cho cột chữ HOA (mã nhân viên, mã khoá…) — cùng dấu, khác kiểu chữ. */
export const TIEN_TO_MA = "UATEL";
export const MIEN_EMAIL = "uat.satarobo.invalid";

export type MaCoSo = "CS1" | "CS2" | "HO";

export type TaiKhoanUat = {
  /** Phần sau tiền tố: `daotao1` ⇒ `uat.el.daotao1@uat.satarobo.invalid`. */
  ten: string;
  hoTen: string;
  /** `RoleDef.code` gắn qua UserOrgRole; `null` = chỉ nhân viên thường (không vai quản trị E-learning). */
  vai: string | null;
  /** Giá trị cột `User.role` (enum cũ). */
  vaiCu: "TRAINING" | "CENTER_MANAGER" | "HR" | "TEACHER";
  coSo: MaCoSo;
  /** `false` = KHÔNG tạo hồ sơ nhân sự (ca cổng EL-01). */
  coHoSo: boolean;
  /** `false` = hồ sơ nghỉ việc (ca cổng EL-01). */
  conLamViec: boolean;
  /** `ten` của quản lý trực tiếp, nếu có. */
  quanLy?: string;
  dungCho: string;
};

export const TAI_KHOAN: readonly TaiKhoanUat[] = [
  { ten: "daotao1", hoTen: "UAT Đào tạo 1", vai: "TRAINING", vaiCu: "TRAINING", coSo: "CS1", coHoSo: true, conLamViec: true, dungCho: "soạn khoá, giao, theo dõi, cấp/thu hồi" },
  { ten: "daotao2", hoTen: "UAT Đào tạo 2", vai: "TRAINING", vaiCu: "TRAINING", coSo: "CS1", coHoSo: true, conLamViec: true, dungCho: "người chấm thứ hai — đối chứng dương cho 'không tự chấm'" },
  { ten: "hr1", hoTen: "UAT Nhân sự 1", vai: "HO_HR", vaiCu: "HR", coSo: "HO", coHoSo: true, conLamViec: true, dungCho: "Nhân sự: thu hồi chứng nhận, đồng phê duyệt EL-21 (khi có)" },
  { ten: "ql1", hoTen: "UAT Quản lý CS1", vai: "CENTER_MANAGER", vaiCu: "CENTER_MANAGER", coSo: "CS1", coHoSo: true, conLamViec: true, dungCho: "quản lý CS1: giao bài, xem tiến độ đội" },
  { ten: "ql2", hoTen: "UAT Quản lý CS2", vai: "CENTER_MANAGER", vaiCu: "CENTER_MANAGER", coSo: "CS2", coHoSo: true, conLamViec: true, dungCho: "đối chứng cách ly cơ sở (không thấy CS1)" },
  { ten: "hv1", hoTen: "UAT Học viên 1", vai: null, vaiCu: "TEACHER", coSo: "CS1", coHoSo: true, conLamViec: true, quanLy: "ql1", dungCho: "người học chính, là người của ql1" },
  { ten: "hv2", hoTen: "UAT Học viên 2", vai: null, vaiCu: "TEACHER", coSo: "CS1", coHoSo: true, conLamViec: true, quanLy: "ql1", dungCho: "người học phụ (A không thấy bài B)" },
  { ten: "hv3", hoTen: "UAT Học viên 3", vai: null, vaiCu: "TEACHER", coSo: "CS2", coHoSo: true, conLamViec: true, quanLy: "ql2", dungCho: "người học CS2 (cách ly)" },
  { ten: "khonghoso", hoTen: "UAT Không hồ sơ", vai: null, vaiCu: "TEACHER", coSo: "CS1", coHoSo: false, conLamViec: true, dungCho: "ca cổng hồ sơ nhân sự (EL-01): bị chặn" },
  { ten: "danghi", hoTen: "UAT Đã nghỉ", vai: null, vaiCu: "TEACHER", coSo: "CS1", coHoSo: true, conLamViec: false, dungCho: "ca cổng hồ sơ nhân sự: bị chặn" },
  { ten: "kiemtoan", hoTen: "UAT Kiểm toán", vai: "AUDITOR", vaiCu: "TEACHER", coSo: "HO", coHoSo: true, conLamViec: true, dungCho: "xem báo cáo, không soạn/giao/chấm" },
];

export type CauHoiUat = {
  loai: "SINGLE" | "ESSAY";
  noiDung: string;
  diem: number;
  /** Với SINGLE: lựa chọn (đúng 1 đáp án đúng). */
  luaChon?: { text: string; dung: boolean }[];
};

export type MucRubricUat = { label: string; points: number };
export type TieuChiUat = { label: string; muc: MucRubricUat[] };

export type BaiUat =
  | { loai: "READ"; tieuDe: string; batBuoc: boolean }
  | { loai: "LIVE_SESSION"; tieuDe: string; batBuoc: boolean }
  | { loai: "QUIZ"; tieuDe: string; batBuoc: boolean; passScore: number; cauHoi: CauHoiUat[] }
  | { loai: "TASK"; tieuDe: string; batBuoc: boolean; rubric: { ma: string; tieuDe: string; passPoints: number; tieuChi: TieuChiUat[] } };

export type KhoaUat = {
  /** Mã ngắn, chữ HOA không dấu: `A` ⇒ `UATEL-A`. */
  ma: string;
  tieuDe: string;
  xuatBan: boolean;
  /** Số tháng hiệu lực chứng nhận; `null` = vô thời hạn. */
  hieuLucThang: number | null;
  /** Cơ sở của khoá/lượt giao. */
  coSo: MaCoSo;
  /** `ten` tài khoản học viên được giao khoá này. */
  giaoCho: string[];
  bai: BaiUat[];
  mucDich: string;
};

export const KHOA: readonly KhoaUat[] = [
  {
    ma: "A",
    tieuDe: "UAT: vòng học đầy đủ",
    xuatBan: true,
    hieuLucThang: 12,
    coSo: "CS1",
    giaoCho: ["hv1", "hv2"],
    mucDich: "đi hết vòng: đọc → buổi trực tiếp → kiểm tra → bài tập → hoàn thành → chứng nhận",
    bai: [
      { loai: "READ", tieuDe: "Bài đọc mở đầu", batBuoc: true },
      { loai: "LIVE_SESSION", tieuDe: "Buổi thực hành (điểm danh)", batBuoc: true },
      {
        loai: "QUIZ",
        tieuDe: "Kiểm tra cuối chương",
        batBuoc: true,
        passScore: 3,
        cauHoi: [
          { loai: "SINGLE", noiDung: "UAT — An toàn: điều nào đúng khi phát hiện mùi khét?", diem: 1, luaChon: [{ text: "Ngắt nguồn điện và báo quản lý", dung: true }, { text: "Tiếp tục làm việc", dung: false }, { text: "Mở cửa sổ rồi bỏ đi", dung: false }] },
          { loai: "SINGLE", noiDung: "UAT — Bình chữa cháy loại nào dùng cho thiết bị điện?", diem: 1, luaChon: [{ text: "Bình CO2", dung: true }, { text: "Bình nước", dung: false }, { text: "Bình bọt", dung: false }] },
          { loai: "SINGLE", noiDung: "UAT — Lối thoát hiểm phải luôn?", diem: 1, luaChon: [{ text: "Thông thoáng", dung: true }, { text: "Khoá cửa ban đêm", dung: false }, { text: "Để thiết bị tạm", dung: false }] },
          { loai: "ESSAY", noiDung: "UAT — Mô tả các bước em sẽ làm khi có sự cố cháy nhỏ tại phòng máy.", diem: 2 },
        ],
      },
      {
        loai: "TASK",
        tieuDe: "Bài tập thực hành có khung chấm",
        batBuoc: true,
        rubric: {
          ma: "UATEL-RUBRIC-1",
          tieuDe: "UAT: khung chấm bài thực hành",
          passPoints: 60,
          tieuChi: [
            { label: "Đúng quy trình", muc: [{ label: "Chưa đạt", points: 0 }, { label: "Đạt", points: 30 }, { label: "Tốt", points: 50 }] },
            { label: "Trình bày", muc: [{ label: "Chưa đạt", points: 0 }, { label: "Đạt", points: 25 }, { label: "Tốt", points: 50 }] },
          ],
        },
      },
    ],
  },
  { ma: "B", tieuDe: "UAT: khoá hết hạn", xuatBan: true, hieuLucThang: 1, coSo: "CS1", giaoCho: ["hv1"], mucDich: "hết hiệu lực / nhắc T-30, T-7 / tái chứng nhận", bai: [{ loai: "READ", tieuDe: "Bài đọc khoá hết hạn", batBuoc: true }] },
  { ma: "C", tieuDe: "UAT: bản nháp", xuatBan: false, hieuLucThang: null, coSo: "CS1", giaoCho: [], mucDich: "người học KHÔNG thấy nội dung chưa xuất bản (đối chứng dương: khoá A)", bai: [{ loai: "READ", tieuDe: "Bài đọc bản nháp", batBuoc: true }] },
  { ma: "D", tieuDe: "UAT: chỉ CS2", xuatBan: true, hieuLucThang: null, coSo: "CS2", giaoCho: ["hv3"], mucDich: "cách ly cơ sở", bai: [{ loai: "READ", tieuDe: "Bài đọc CS2", batBuoc: true }] },
];

/**
 * Tên DB được phép ghi/dọn. Chặn theo TÊN, không theo host: tunnel tới DB test VPS mang địa chỉ 127.0.0.1 như DB máy, còn PROD
 * tên đúng `satarobo` — tiền tố `satarobo_test` KHÔNG khớp `satarobo` (kiểm có neo đầu chuỗi + đòi ký tự sau tiền tố hoặc hết chuỗi).
 */
export function tenDbDuocPhep(ten: string): boolean {
  return /^(satarobo_test|satarobo_lamviec|ci_test|satarobo_vitest)([_a-z0-9]*)$/.test(ten);
}

export const emailCua = (ten: string) => `${TIEN_TO}${ten}@${MIEN_EMAIL}`;
export const maNhanVienCua = (ten: string) => `${TIEN_TO_MA}-${ten.toUpperCase()}`;
export const maKhoaCua = (ma: string) => `${TIEN_TO_MA}-${ma}`;
export const slugKhoaCua = (ma: string) => `${TIEN_TO}khoa-${ma.toLowerCase()}`;
export const tieuDeLuotGiaoCua = (ma: string) => `${TIEN_TO}giao-khoa-${ma.toLowerCase()}`;

/** Tổng điểm đề = tổng điểm các câu. */
export const tongDiemDe = (cauHoi: CauHoiUat[]) => cauHoi.reduce((s, c) => s + c.diem, 0);

/** Tổng điểm tối đa của khung = tổng điểm mức CAO NHẤT mỗi tiêu chí. */
export const tongDiemKhung = (tc: TieuChiUat[]) => tc.reduce((s, t) => s + Math.max(...t.muc.map((m) => m.points)), 0);

/** Các lỗi bất biến của kế hoạch; rỗng = hợp lệ. */
export function kiemKeHoach(
  taiKhoan: readonly TaiKhoanUat[] = TAI_KHOAN,
  khoa: readonly KhoaUat[] = KHOA,
): string[] {
  const loi: string[] = [];
  const ten = new Set<string>();
  for (const t of taiKhoan) {
    if (ten.has(t.ten)) loi.push(`trùng tài khoản ${t.ten}`);
    ten.add(t.ten);
    if (!/^[a-z0-9]+$/.test(t.ten)) loi.push(`tên tài khoản ${t.ten} phải là chữ thường/số`);
    if (t.quanLy && !taiKhoan.some((x) => x.ten === t.quanLy)) loi.push(`${t.ten}: quản lý ${t.quanLy} không có trong danh sách`);
    if (!t.coHoSo && t.quanLy) loi.push(`${t.ten}: không hồ sơ nhưng có quản lý`);
  }
  // ADR-0001: ca "không tự chấm" cần đối chứng dương ⇒ ≥ 2 người cùng vai TRAINING; cách ly cơ sở ⇒ ≥ 2 quản lý ở 2 cơ sở.
  if (taiKhoan.filter((t) => t.vai === "TRAINING").length < 2) loi.push("cần ≥ 2 người vai TRAINING");
  const qlCoSo = new Set(taiKhoan.filter((t) => t.vai === "CENTER_MANAGER").map((t) => t.coSo));
  if (qlCoSo.size < 2) loi.push("cần quản lý ở ≥ 2 cơ sở khác nhau");
  if (!taiKhoan.some((t) => !t.coHoSo)) loi.push("thiếu ca 'không có hồ sơ nhân sự'");
  if (!taiKhoan.some((t) => t.coHoSo && !t.conLamViec)) loi.push("thiếu ca 'đã nghỉ việc'");

  const ma = new Set<string>();
  for (const k of khoa) {
    if (ma.has(k.ma)) loi.push(`trùng mã khoá ${k.ma}`);
    ma.add(k.ma);
    if (!/^[A-Z0-9]+$/.test(k.ma)) loi.push(`mã khoá ${k.ma} phải là chữ HOA/số`);
    if (k.bai.length === 0) loi.push(`khoá ${k.ma} không có bài`);
    for (const h of k.giaoCho) {
      const t = taiKhoan.find((x) => x.ten === h);
      if (!t) loi.push(`khoá ${k.ma}: người học ${h} không có trong danh sách`);
      else {
        if (!t.coHoSo || !t.conLamViec) loi.push(`khoá ${k.ma}: ${h} không có hồ sơ đang làm — lượt giao sẽ bị bỏ qua`);
        if (t.coSo !== k.coSo) loi.push(`khoá ${k.ma} (${k.coSo}) giao cho ${h} (${t.coSo}) — lệch cơ sở`);
      }
    }
    if (!k.xuatBan && k.giaoCho.length > 0) loi.push(`khoá nháp ${k.ma} không được giao`);
    for (const b of k.bai) {
      if (b.loai === "QUIZ") {
        const tong = tongDiemDe(b.cauHoi);
        if (b.passScore > tong) loi.push(`khoá ${k.ma}: điểm đạt ${b.passScore} > tổng điểm đề ${tong}`);
        for (const c of b.cauHoi) {
          if (c.loai === "SINGLE") {
            const dung = (c.luaChon ?? []).filter((x) => x.dung).length;
            if ((c.luaChon ?? []).length < 2 || dung !== 1) loi.push(`khoá ${k.ma}: câu SINGLE phải có ≥ 2 lựa chọn và đúng 1 đáp án đúng`);
          }
        }
        if (!b.cauHoi.some((c) => c.loai === "ESSAY")) loi.push(`khoá ${k.ma}: đề thiếu câu tự luận (ca chấm tay)`);
      }
      if (b.loai === "TASK") {
        const tong = tongDiemKhung(b.rubric.tieuChi);
        if (tong !== 100) loi.push(`khung ${b.rubric.ma}: tổng điểm tối đa ${tong} ≠ 100`);
        if (b.rubric.passPoints > tong) loi.push(`khung ${b.rubric.ma}: ngưỡng đạt vượt tổng`);
        for (const t of b.rubric.tieuChi) {
          for (let i = 1; i < t.muc.length; i++) if (t.muc[i]!.points <= t.muc[i - 1]!.points) loi.push(`khung ${b.rubric.ma}: mức của '${t.label}' phải tăng dần`);
        }
      }
    }
  }
  if (!khoa.some((k) => k.xuatBan && k.giaoCho.length > 0)) loi.push("không khoá nào được giao");
  if (!khoa.some((k) => !k.xuatBan)) loi.push("thiếu khoá nháp (đối chứng 'không thấy nội dung chưa xuất bản')");
  if (!khoa.some((k) => k.hieuLucThang !== null && k.hieuLucThang <= 1)) loi.push("thiếu khoá hiệu lực ngắn (ca hết hạn/tái chứng nhận)");
  if (!khoa.some((k) => k.coSo === "CS2" && k.giaoCho.length > 0)) loi.push("thiếu khoá riêng CS2 (ca cách ly)");
  return loi;
}
