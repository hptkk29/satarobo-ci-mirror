/**
 * KẾ HOẠCH DỮ LIỆU UAT BÀI VIDEO — thuần (không DB), dùng chung cho script seed và test.
 *
 * Tách khỏi `uat-seed-plan.ts` (UAT e-learning chung, tiền tố `uat.el.` / `UATEL-`) vì UAT video cần HAI thứ mà bộ cũ không có:
 *  1. **Mã khoá bắt đầu bằng `UAT_VIDEO_`** — đó chính là bộ lọc của vai DB chỉ-đọc `uat_video_ro` (các view `uat_video.*` lọc
 *     `starts_with(code, 'UAT_VIDEO_')`). Khoá không mang tiền tố này thì người UAT không đối chiếu được bằng DB, còn khoá thật mà
 *     lỡ mang tiền tố này thì bị lộ qua view ⇒ tiền tố là HỢP ĐỒNG giữa seed và SQL, không phải quy ước đặt tên.
 *  2. Người ở ĐÚNG các vị trí mà ma trận quyền cần: cùng cơ sở có/không quyền xuất bản, khác cơ sở, và một dãy người học ở các
 *     trạng thái ghi danh khác nhau (đang học / hoàn thành / thu hồi / quá hạn).
 *
 * Bài video của khoá được tạo RỖNG (chưa có nguồn): người UAT gắn MP4 / YouTube bằng chính giao diện soạn bài — đó là một phần của
 * ca thử (gắn nguồn lần đầu không tăng phiên bản; đổi nguồn tăng phiên bản). Seed không đụng R2.
 */

export const TIEN_TO_VIDEO = "uat.video.";
/** Mã khoá bắt buộc bắt đầu bằng chuỗi này — xem ghi chú đầu tệp (bộ lọc của view `uat_video.*`). */
export const TIEN_TO_MA_KHOA_VIDEO = "UAT_VIDEO_";
/** Mã nhân viên của tài khoản UAT video (khác `UATEL-` để dọn riêng). */
export const TIEN_TO_MA_NV_VIDEO = "UATVIDEO";
export const MIEN_EMAIL_VIDEO = "uat.satarobo.invalid";

export type MaCoSoVideo = "CS1" | "CS2" | "HO";

export type TaiKhoanVideo = {
  /** Phần sau tiền tố: `daotaocs1` ⇒ `uat.video.daotaocs1@uat.satarobo.invalid`. Chữ thường/số. */
  ten: string;
  hoTen: string;
  /** `RoleDef.code` gắn qua UserOrgRole; `null` = nhân viên thường (người học). */
  vai: "TRAINING" | "HO_HR" | null;
  /** Giá trị cột `User.role` (enum cũ). */
  vaiCu: "TRAINING" | "HR" | "TEACHER";
  coSo: MaCoSoVideo;
  dungCho: string;
};

export const TAI_KHOAN_VIDEO: readonly TaiKhoanVideo[] = [
  { ten: "daotaocs1", hoTen: "UAT Video Đào tạo CS1", vai: "TRAINING", vaiCu: "TRAINING", coSo: "CS1", dungCho: "soạn + XUẤT BẢN, đổi nguồn bài của khoá CS1 (có đủ quyền)" },
  { ten: "daotaocs2", hoTen: "UAT Video Đào tạo CS2", vai: "TRAINING", vaiCu: "TRAINING", coSo: "CS2", dungCho: "đối chứng KHÁC cơ sở: có quyền soạn/xuất bản nhưng đứng ở CS2 ⇒ không được đổi nguồn bài của khoá CS1" },
  { ten: "nhansu", hoTen: "UAT Video Nhân sự", vai: "HO_HR", vaiCu: "HR", coSo: "HO", dungCho: "có quyền SOẠN nhưng KHÔNG có quyền xuất bản ⇒ không đổi được nguồn bài của khoá đã xuất bản" },
  { ten: "hva", hoTen: "UAT Video Học viên A", vai: null, vaiCu: "TEACHER", coSo: "CS1", dungCho: "ĐANG HỌC dở bài video khi nguồn bị đổi ⇒ bản chụp + bắt đầu lại" },
  { ten: "hvb", hoTen: "UAT Video Học viên B", vai: null, vaiCu: "TEACHER", coSo: "CS1", dungCho: "HOÀN THÀNH bài video trước khi đổi nguồn ⇒ đóng băng, giữ chứng nhận" },
  { ten: "hvc", hoTen: "UAT Video Học viên C", vai: null, vaiCu: "TEACHER", coSo: "CS1", dungCho: "bị THU HỒI ghi danh sau khi đã xem ⇒ không đổi khi đổi nguồn; vé media phải bị từ chối" },
  { ten: "hvd", hoTen: "UAT Video Học viên D", vai: null, vaiCu: "TEACHER", coSo: "CS1", dungCho: "ghi danh QUÁ HẠN ⇒ bị đặt lại mà KHÔNG chuyển trạng thái ghi danh" },
  { ten: "hve", hoTen: "UAT Video Học viên E", vai: null, vaiCu: "TEACHER", coSo: "CS1", dungCho: "người học thường: ca gửi nhịp dồn / hai tab / tua; sau khi bị đặt lại vẫn bị xét nhịp dày" },
  { ten: "hvcs2", hoTen: "UAT Video Học viên CS2", vai: null, vaiCu: "TEACHER", coSo: "CS2", dungCho: "người học của khoá CS2 (K4) — cách ly cơ sở" },
] as const;

export type KhoaVideo = {
  /** Mã ngắn chữ HOA/số: `K1` ⇒ `UAT_VIDEO_K1`. */
  ma: string;
  tieuDe: string;
  xuatBan: boolean;
  coSo: MaCoSoVideo;
  /** `ten` tài khoản được giao khoá (cùng cơ sở). */
  giaoCho: readonly string[];
  /** Tiêu đề các bài VIDEO (tạo RỖNG, chưa có nguồn). */
  baiVideo: readonly string[];
  mucDich: string;
};

export const KHOA_VIDEO: readonly KhoaVideo[] = [
  {
    ma: "K1",
    tieuDe: "UAT VIDEO K1 — đã xuất bản, có người học",
    xuatBan: true,
    coSo: "CS1",
    giaoCho: ["hva", "hvb", "hvc", "hvd", "hve"],
    baiVideo: ["Bài video 1", "Bài video 2"],
    mucDich: "đổi nguồn khi CÓ người học: xem trước tác động, token xác nhận, bản chụp, đặt lại, đóng băng",
  },
  {
    ma: "K2",
    tieuDe: "UAT VIDEO K2 — bản nháp",
    xuatBan: false,
    coSo: "CS1",
    giaoCho: [],
    baiVideo: ["Bài video nháp"],
    mucDich: "khoá CHƯA xuất bản: đổi nguồn không cần quyền xuất bản (đối chứng dương cho D7)",
  },
  {
    ma: "K3",
    tieuDe: "UAT VIDEO K3 — đã xuất bản, chưa có người học",
    xuatBan: true,
    coSo: "CS1",
    giaoCho: [],
    baiVideo: ["Bài video không người học"],
    mucDich: "D7: khoá ĐÃ XUẤT BẢN luôn cần quyền xuất bản + xác nhận, kể cả khi chưa có người học",
  },
  {
    ma: "K4",
    tieuDe: "UAT VIDEO K4 — khoá của CS2",
    xuatBan: true,
    coSo: "CS2",
    giaoCho: ["hvcs2"],
    baiVideo: ["Bài video CS2"],
    mucDich: "cách ly cơ sở: người đứng ở CS1 không được đổi nguồn bài của khoá CS2",
  },
];

/**
 * Tên DB được phép ghi/dọn — CÙNG luật với `tenDbDuocPhep` của UAT e-learning (chặn theo TÊN, không theo host: tunnel tới DB test
 * VPS mang địa chỉ 127.0.0.1 như DB máy; PROD tên đúng `satarobo` nên không khớp).
 */
export function tenDbDuocPhepVideo(ten: string): boolean {
  return /^(satarobo_test|satarobo_lamviec|ci_test|satarobo_vitest)([_a-z0-9]*)$/.test(ten);
}

export const emailVideoCua = (ten: string) => `${TIEN_TO_VIDEO}${ten}@${MIEN_EMAIL_VIDEO}`;
export const maNhanVienVideoCua = (ten: string) => `${TIEN_TO_MA_NV_VIDEO}-${ten.toUpperCase()}`;
export const maKhoaVideoCua = (ma: string) => `${TIEN_TO_MA_KHOA_VIDEO}${ma}`;
export const slugKhoaVideoCua = (ma: string) => `${TIEN_TO_VIDEO}khoa-${ma.toLowerCase()}`;
export const tieuDeLuotGiaoVideoCua = (ma: string) => `${TIEN_TO_VIDEO}giao-khoa-${ma.toLowerCase()}`;
export const tieuDeBaiVideoCua = (tieuDe: string) => `${TIEN_TO_VIDEO}${tieuDe}`;

/** Các lỗi bất biến của kế hoạch; rỗng = hợp lệ. */
export function kiemKeHoachVideo(
  taiKhoan: readonly TaiKhoanVideo[] = TAI_KHOAN_VIDEO,
  khoa: readonly KhoaVideo[] = KHOA_VIDEO,
): string[] {
  const loi: string[] = [];

  const ten = new Set<string>();
  for (const t of taiKhoan) {
    if (ten.has(t.ten)) loi.push(`trùng tài khoản ${t.ten}`);
    ten.add(t.ten);
    if (!/^[a-z0-9]+$/.test(t.ten)) loi.push(`tên tài khoản ${t.ten} phải là chữ thường/số`);
  }

  // Ma trận quyền cần đủ các vị trí: cùng cơ sở có quyền xuất bản · khác cơ sở có quyền xuất bản · có quyền soạn nhưng KHÔNG xuất bản.
  const coSoKhoaCs1 = taiKhoan.some((t) => t.vai === "TRAINING" && t.coSo === "CS1");
  const khacCoSo = taiKhoan.some((t) => t.vai === "TRAINING" && t.coSo === "CS2");
  const khongXuatBan = taiKhoan.some((t) => t.vai === "HO_HR");
  if (!coSoKhoaCs1) loi.push("thiếu người TRAINING ở CS1 (đối chứng dương: đủ quyền, đúng cơ sở)");
  if (!khacCoSo) loi.push("thiếu người TRAINING ở CS2 (đối chứng khác cơ sở)");
  if (!khongXuatBan) loi.push("thiếu người có quyền soạn nhưng không có quyền xuất bản (HO_HR)");
  if (taiKhoan.filter((t) => t.vai === null && t.coSo === "CS1").length < 5) loi.push("cần ≥ 5 người học CS1 (đang học / hoàn thành / thu hồi / quá hạn / thường)");
  if (!taiKhoan.some((t) => t.vai === null && t.coSo === "CS2")) loi.push("thiếu người học CS2");

  const ma = new Set<string>();
  for (const k of khoa) {
    if (ma.has(k.ma)) loi.push(`trùng mã khoá ${k.ma}`);
    ma.add(k.ma);
    if (!/^[A-Z0-9]+$/.test(k.ma)) loi.push(`mã khoá ${k.ma} phải là chữ HOA/số`);
    // HỢP ĐỒNG với view uat_video.*: mã đầy đủ phải bắt đầu đúng tiền tố mà SQL lọc.
    if (!maKhoaVideoCua(k.ma).startsWith("UAT_VIDEO_")) loi.push(`khoá ${k.ma}: mã đầy đủ không bắt đầu bằng UAT_VIDEO_ (view chỉ-đọc sẽ không thấy)`);
    if (k.baiVideo.length === 0) loi.push(`khoá ${k.ma} không có bài video`);
    if (!k.xuatBan && k.giaoCho.length > 0) loi.push(`khoá nháp ${k.ma} không được giao`);
    for (const h of k.giaoCho) {
      const t = taiKhoan.find((x) => x.ten === h);
      if (!t) loi.push(`khoá ${k.ma}: người học ${h} không có trong danh sách`);
      else {
        if (t.vai !== null) loi.push(`khoá ${k.ma}: ${h} có vai quản trị — người học phải là nhân viên thường`);
        if (t.coSo !== k.coSo) loi.push(`khoá ${k.ma} (${k.coSo}) giao cho ${h} (${t.coSo}) — lệch cơ sở`);
      }
    }
  }
  if (!khoa.some((k) => k.xuatBan && k.giaoCho.length > 0 && k.coSo === "CS1")) loi.push("thiếu khoá CS1 đã xuất bản có người học");
  if (!khoa.some((k) => !k.xuatBan)) loi.push("thiếu khoá nháp");
  if (!khoa.some((k) => k.xuatBan && k.giaoCho.length === 0)) loi.push("thiếu khoá đã xuất bản chưa có người học (ca D7)");
  if (!khoa.some((k) => k.coSo === "CS2" && k.xuatBan)) loi.push("thiếu khoá đã xuất bản của CS2");
  return loi;
}
