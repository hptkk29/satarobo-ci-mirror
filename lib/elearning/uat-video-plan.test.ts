import { describe, expect, it } from "vitest";
import {
  KHOA_VIDEO,
  MIEN_EMAIL_VIDEO,
  TAI_KHOAN_VIDEO,
  TIEN_TO_MA_KHOA_VIDEO,
  emailVideoCua,
  kiemKeHoachVideo,
  maKhoaVideoCua,
  maNhanVienVideoCua,
  tenDbDuocPhepVideo,
  type KhoaVideo,
  type TaiKhoanVideo,
} from "@/lib/elearning/uat-video-plan";

const bo = (t: readonly TaiKhoanVideo[] = TAI_KHOAN_VIDEO, k: readonly KhoaVideo[] = KHOA_VIDEO) => kiemKeHoachVideo(t, k);
const coLoi = (loi: string[], mau: RegExp) => loi.some((l) => mau.test(l));

describe("[UVP] kế hoạch dữ liệu UAT bài video", () => {
  it("[UVP-01] kế hoạch mặc định hợp lệ", () => {
    expect(bo()).toEqual([]);
  });

  it("[UVP-02] HỢP ĐỒNG với view chỉ-đọc: MỌI mã khoá đầy đủ bắt đầu đúng 'UAT_VIDEO_' (bộ lọc starts_with của uat_video.*)", () => {
    expect(TIEN_TO_MA_KHOA_VIDEO).toBe("UAT_VIDEO_");
    for (const k of KHOA_VIDEO) expect(maKhoaVideoCua(k.ma).startsWith("UAT_VIDEO_")).toBe(true);
    expect(KHOA_VIDEO.map((k) => maKhoaVideoCua(k.ma))).toEqual(["UAT_VIDEO_K1", "UAT_VIDEO_K2", "UAT_VIDEO_K3", "UAT_VIDEO_K4"]);
  });

  it("[UVP-03] mọi email thuộc miền .invalid (không thông báo nào tới người thật) và mã nhân viên có tiền tố riêng", () => {
    for (const t of TAI_KHOAN_VIDEO) {
      expect(emailVideoCua(t.ten).endsWith(`@${MIEN_EMAIL_VIDEO}`)).toBe(true);
      expect(emailVideoCua(t.ten).startsWith("uat.video.")).toBe(true);
      expect(maNhanVienVideoCua(t.ten).startsWith("UATVIDEO-")).toBe(true);
    }
    expect(MIEN_EMAIL_VIDEO.endsWith(".invalid")).toBe(true);
  });

  it("[UVP-04] ma trận quyền có ĐỦ ba vị trí: TRAINING CS1 · TRAINING CS2 · HO_HR (soạn, không xuất bản)", () => {
    expect(TAI_KHOAN_VIDEO.some((t) => t.vai === "TRAINING" && t.coSo === "CS1")).toBe(true);
    expect(TAI_KHOAN_VIDEO.some((t) => t.vai === "TRAINING" && t.coSo === "CS2")).toBe(true);
    expect(TAI_KHOAN_VIDEO.some((t) => t.vai === "HO_HR" && t.coSo === "HO")).toBe(true);
  });

  it("[UVP-05] 🔴 cấy lỗi: các vi phạm bất biến đều bị bắt đúng câu", () => {
    // đổi tiền tố mã khoá ⇒ không thể (hằng), nên cấy bằng mã chữ thường: mã khoá phải là HOA/số
    expect(coLoi(bo(TAI_KHOAN_VIDEO, [{ ...KHOA_VIDEO[0]!, ma: "k1" }, ...KHOA_VIDEO.slice(1)]), /chữ HOA\/số/)).toBe(true);
    // bỏ người TRAINING ở CS2
    expect(coLoi(bo(TAI_KHOAN_VIDEO.filter((t) => t.ten !== "daotaocs2")), /TRAINING ở CS2/)).toBe(true);
    // bỏ người TRAINING ở CS1
    expect(coLoi(bo(TAI_KHOAN_VIDEO.filter((t) => t.ten !== "daotaocs1")), /TRAINING ở CS1/)).toBe(true);
    // bỏ người soạn-không-xuất-bản
    expect(coLoi(bo(TAI_KHOAN_VIDEO.filter((t) => t.ten !== "nhansu")), /không có quyền xuất bản/)).toBe(true);
    // giao khoá CS1 cho người CS2
    expect(coLoi(bo(TAI_KHOAN_VIDEO, [{ ...KHOA_VIDEO[0]!, giaoCho: ["hva", "hvcs2"] }, ...KHOA_VIDEO.slice(1)]), /lệch cơ sở/)).toBe(true);
    // giao khoá cho người có vai quản trị
    expect(coLoi(bo(TAI_KHOAN_VIDEO, [{ ...KHOA_VIDEO[0]!, giaoCho: ["hva", "daotaocs1"] }, ...KHOA_VIDEO.slice(1)]), /có vai quản trị/)).toBe(true);
    // giao khoá nháp
    expect(coLoi(bo(TAI_KHOAN_VIDEO, [KHOA_VIDEO[0]!, { ...KHOA_VIDEO[1]!, giaoCho: ["hva"] }, ...KHOA_VIDEO.slice(2)]), /khoá nháp .* không được giao/)).toBe(true);
    // thiếu khoá đã xuất bản chưa có người học (ca D7)
    expect(coLoi(bo(TAI_KHOAN_VIDEO, KHOA_VIDEO.filter((k) => k.ma !== "K3")), /chưa có người học \(ca D7\)/)).toBe(true);
    // thiếu khoá nháp
    expect(coLoi(bo(TAI_KHOAN_VIDEO, KHOA_VIDEO.filter((k) => k.ma !== "K2")), /thiếu khoá nháp/)).toBe(true);
    // trùng tài khoản / trùng mã khoá
    expect(coLoi(bo([...TAI_KHOAN_VIDEO, TAI_KHOAN_VIDEO[0]!]), /trùng tài khoản/)).toBe(true);
    expect(coLoi(bo(TAI_KHOAN_VIDEO, [...KHOA_VIDEO, KHOA_VIDEO[0]!]), /trùng mã khoá/)).toBe(true);
    // khoá không có bài video
    expect(coLoi(bo(TAI_KHOAN_VIDEO, [{ ...KHOA_VIDEO[0]!, baiVideo: [] }, ...KHOA_VIDEO.slice(1)]), /không có bài video/)).toBe(true);
    // ít hơn 5 người học CS1
    expect(coLoi(bo(TAI_KHOAN_VIDEO.filter((t) => t.ten !== "hve"), KHOA_VIDEO.map((k) => ({ ...k, giaoCho: k.giaoCho.filter((g) => g !== "hve") }))), /≥ 5 người học CS1/)).toBe(true);
  });

  it("[UVP-06] chặn theo TÊN database: PROD (`satarobo`) và DB lạ bị từ chối; DB test/làm việc/ci được phép", () => {
    for (const ok of ["satarobo_test", "satarobo_lamviec", "ci_test", "satarobo_vitest", "ci_test_uatvideo"]) expect(tenDbDuocPhepVideo(ok)).toBe(true);
    for (const no of ["satarobo", "postgres", "satarobo_prod", "prod", "satarobo-test", "doisoat_x", ""]) expect(tenDbDuocPhepVideo(no)).toBe(false);
  });

  it("[UVP-07] mỗi khoá có mục đích ghi rõ và tiêu đề mang dấu UAT (dễ nhận khi dọn)", () => {
    for (const k of KHOA_VIDEO) {
      expect(k.mucDich.length).toBeGreaterThan(10);
      expect(k.tieuDe.startsWith("UAT VIDEO")).toBe(true);
    }
  });
});
