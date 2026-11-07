// @vitest-environment node
/**
 * ĐỔI NGUỒN BÀI VIDEO — luật thuần. Hành vi trên Postgres thật: `tests/elearning/video-doi-nguon-db.test.ts`.
 *
 * Mỗi ca ÂM ("không đổi phiên bản") có ca DƯƠNG đối chứng ("đổi phiên bản") — bản "luôn đổi" hay "không bao giờ đổi"
 * đều làm một nửa số ca xanh.
 */
import { describe, it, expect } from "vitest";
import {
  kiemLyDoDoiNguon,
  lyDoChuaNguon,
  LUOT_DAT_LAI,
  LUOT_DONG_BANG,
  LY_DO_TOI_DA,
  LY_DO_TOI_THIEU,
  nguonDaDoi,
  nhanDangNguon,
  quyetDinhDoiNguon,
  soNguoiDaHoc,
  TAC_DONG_RONG,
  thongBaoTacDong,
  type TacDongDoiNguon,
} from "@/lib/elearning/video-doi-nguon-rule";

const TEP = { youtubeId: null, videoKey: "elearning/master/l1/a.mp4", durationSec: 600 };
const YT = { youtubeId: "aBcDeFg_H-1", videoKey: null, durationSec: 600 };
const CHUA = { youtubeId: null, videoKey: null, durationSec: null };

describe("[DNR-01] nhận dạng nguồn", () => {
  it("YouTube thắng khi dữ liệu cũ lỡ mang cả hai (trang học cũng ưu tiên YouTube)", () => {
    expect(nhanDangNguon({ youtubeId: "x", videoKey: "k" })).toBe("youtube:x");
  });
  it("chỉ tệp ⇒ tep:…; không có gì ⇒ null", () => {
    expect(nhanDangNguon({ youtubeId: null, videoKey: "k" })).toBe("tep:k");
    expect(nhanDangNguon({ youtubeId: null, videoKey: null })).toBeNull();
  });
});

describe("[DNR-02] nguonDaDoi — điều kiện DUY NHẤT để tăng phiên bản", () => {
  it("DƯƠNG: đổi khoá tệp ⇒ đổi", () => {
    expect(nguonDaDoi(TEP, { ...TEP, videoKey: "elearning/master/l1/b.mp4" })).toBe(true);
  });
  it("DƯƠNG: đổi mã YouTube ⇒ đổi", () => {
    expect(nguonDaDoi(YT, { ...YT, youtubeId: "zzzzzzzzzzz" })).toBe(true);
  });
  it("DƯƠNG: tệp → YouTube và ngược lại ⇒ đổi", () => {
    expect(nguonDaDoi(TEP, YT)).toBe(true);
    expect(nguonDaDoi(YT, TEP)).toBe(true);
  });
  it("DƯƠNG: cùng nguồn nhưng THỜI LƯỢNG khác ⇒ đổi (mẫu số của mọi phần trăm)", () => {
    expect(nguonDaDoi(TEP, { ...TEP, durationSec: 601 })).toBe(true);
    expect(nguonDaDoi(YT, { ...YT, durationSec: 599 })).toBe(true);
  });
  it("ÂM: lưu lại ĐÚNG nguồn và thời lượng cũ (chỉ sửa tiêu đề / phụ đề) ⇒ KHÔNG đổi", () => {
    expect(nguonDaDoi(TEP, { ...TEP })).toBe(false);
    expect(nguonDaDoi(YT, { ...YT })).toBe(false);
  });
  it("ÂM: bài CHƯA có nguồn nào, gắn lần đầu ⇒ KHÔNG đổi (chưa có nội dung cũ để thay, chưa thể có tiến độ)", () => {
    expect(nguonDaDoi(CHUA, TEP)).toBe(false);
    expect(nguonDaDoi(CHUA, YT)).toBe(false);
  });
  it("thời lượng `null` ở cả hai vế coi là bằng nhau (dữ liệu cũ thiếu thời lượng không tự gây đổi)", () => {
    expect(nguonDaDoi({ ...TEP, durationSec: null }, { ...TEP, durationSec: null })).toBe(false);
  });
});

describe("[DNR-03] lượt đang học / đã kết thúc — hai tập rời nhau, phủ đủ enum", () => {
  it("không trùng nhau và hợp lại là ĐÚNG sáu trạng thái của `TrnEnrollmentStatus`", () => {
    const hop = [...LUOT_DAT_LAI, ...LUOT_DONG_BANG];
    expect(new Set(hop).size).toBe(hop.length);
    expect([...hop].sort()).toEqual(["COMPLETED", "COMPLETED_LATE", "IN_PROGRESS", "NOT_STARTED", "OVERDUE", "REVOKED"]);
  });
  it("hoàn thành (kể cả muộn) và thu hồi là ĐÓNG BĂNG; quá hạn vẫn là đang học", () => {
    for (const t of ["COMPLETED", "COMPLETED_LATE", "REVOKED"]) expect(LUOT_DONG_BANG as readonly string[]).toContain(t);
    expect(LUOT_DAT_LAI as readonly string[]).toContain("OVERDUE");
  });
});

describe("[DNR-04] quyetDinhDoiNguon", () => {
  const coNguoi: TacDongDoiNguon = { ...TAC_DONG_RONG, ghiDanhDangHoc: 3, ghiDanhDongBang: 2, daXongDangHoc: 1, daXongDongBang: 1, soCauHoiChen: 2 };
  const co = (o: Partial<Parameters<typeof quyetDinhDoiNguon>[0]> = {}) =>
    quyetDinhDoiNguon({ doi: true, tacDong: TAC_DONG_RONG, khoaDaXuatBan: false, coQuyenXuatBan: false, daXacNhan: false, ...o });

  it("không đổi nội dung thật ⇒ CHO, bất kể quyền/khoá/người học", () => {
    expect(co({ doi: false, khoaDaXuatBan: true, tacDong: coNguoi })).toEqual({ loai: "CHO_PHEP" });
  });
  it("khoá NHÁP, chưa ai học ⇒ người soạn thường được đổi", () => {
    expect(co()).toEqual({ loai: "CHO_PHEP" });
  });
  it("khoá ĐÃ XUẤT BẢN, thiếu quyền xuất bản ⇒ TỪ CHỐI CAN_QUYEN_XUAT_BAN (kể cả khi chưa ai học)", () => {
    const r = co({ khoaDaXuatBan: true });
    expect(r).toMatchObject({ loai: "TU_CHOI", ma: "CAN_QUYEN_XUAT_BAN" });
  });
  it("khoá NHÁP nhưng ĐÃ có người học, thiếu quyền xuất bản ⇒ TỪ CHỐI CAN_QUYEN_XUAT_BAN", () => {
    expect(co({ tacDong: coNguoi })).toMatchObject({ loai: "TU_CHOI", ma: "CAN_QUYEN_XUAT_BAN" });
  });
  it("🔴 khoá ĐÃ XUẤT BẢN, CÓ quyền xuất bản, chưa người học, CHƯA xác nhận ⇒ vẫn TỪ CHỐI CAN_XAC_NHAN_TAC_DONG (owner 28/10: khoá đã xuất bản LUÔN cần quyền publish + xác nhận)", () => {
    const r = co({ khoaDaXuatBan: true, coQuyenXuatBan: true });
    expect(r).toMatchObject({ loai: "TU_CHOI", ma: "CAN_XAC_NHAN_TAC_DONG" });
    if (r.loai === "TU_CHOI") {
      expect(r.thongBao).toContain("đã xuất bản");
      expect(r.thongBao).toContain("chưa có ai xem");
    }
  });
  it("khoá đã xuất bản, có quyền, chưa người học, ĐÃ xác nhận ⇒ CHO", () => {
    expect(co({ khoaDaXuatBan: true, coQuyenXuatBan: true, daXacNhan: true })).toEqual({ loai: "CHO_PHEP" });
  });
  it("khoá NHÁP, có quyền, chưa người học ⇒ CHO không cần xác nhận (không có gì để hỏi)", () => {
    expect(co({ coQuyenXuatBan: true })).toEqual({ loai: "CHO_PHEP" });
  });
  it("có người học, có quyền xuất bản, CHƯA xác nhận ⇒ TỪ CHỐI CAN_XAC_NHAN_TAC_DONG, câu nói thẳng số liệu", () => {
    const r = co({ tacDong: coNguoi, coQuyenXuatBan: true });
    expect(r).toMatchObject({ loai: "TU_CHOI", ma: "CAN_XAC_NHAN_TAC_DONG" });
    if (r.loai === "TU_CHOI") {
      expect(r.thongBao).toContain("5 lượt học");
      expect(r.thongBao).toContain("3 lượt đang học");
      expect(r.thongBao).toContain("2 lượt đã kết thúc");
      expect(r.thongBao).toContain("2 câu hỏi chèn");
    }
  });
  it("ĐỐI CHỨNG: cùng ca nhưng ĐÃ xác nhận ⇒ CHO", () => {
    expect(co({ tacDong: coNguoi, coQuyenXuatBan: true, daXacNhan: true })).toEqual({ loai: "CHO_PHEP" });
  });
  it("🔴 xác nhận KHÔNG thay được quyền: có xác nhận mà thiếu quyền xuất bản vẫn bị từ chối", () => {
    expect(co({ tacDong: coNguoi, daXacNhan: true })).toMatchObject({ ma: "CAN_QUYEN_XUAT_BAN" });
  });
  it("chỉ lượt NOT_STARTED (hàng chưa xem gì) không tính là 'đã có người học'", () => {
    expect(soNguoiDaHoc(TAC_DONG_RONG)).toBe(0);
    expect(co({ tacDong: { ...TAC_DONG_RONG, soCauHoiChen: 5 }, daXacNhan: false })).toEqual({ loai: "CHO_PHEP" });
  });
  it("thứ tự cổng: thiếu quyền được báo TRƯỚC thiếu xác nhận (xác nhận không thay được quyền)", () => {
    expect(co({ khoaDaXuatBan: true, coQuyenXuatBan: false, daXacNhan: false })).toMatchObject({ ma: "CAN_QUYEN_XUAT_BAN" });
  });
});

describe("[DNR-06] kiemLyDoDoiNguon — lý do đi vào sổ bất biến nên có khoảng cứng", () => {
  it("thiếu / rỗng / toàn khoảng trắng / dưới 5 ký tự ⇒ từ chối", () => {
    for (const x of [null, undefined, "", "     ", " ab ", "abcd"]) {
      expect(kiemLyDoDoiNguon(x), String(x)).toMatchObject({ ok: false });
    }
  });
  it("đúng 5 và đúng 500 ký tự ⇒ qua (biên TRONG)", () => {
    expect(kiemLyDoDoiNguon("abcde")).toEqual({ ok: true, lyDo: "abcde" });
    expect(kiemLyDoDoiNguon("x".repeat(500))).toMatchObject({ ok: true });
  });
  it("501 ký tự ⇒ từ chối (biên NGOÀI)", () => {
    expect(kiemLyDoDoiNguon("x".repeat(501))).toMatchObject({ ok: false });
  });
  it("đếm SAU khi cắt khoảng trắng hai đầu và trả bản đã cắt", () => {
    expect(kiemLyDoDoiNguon("   abcde   ")).toEqual({ ok: true, lyDo: "abcde" });
    expect(kiemLyDoDoiNguon(" " + "x".repeat(500) + " ")).toMatchObject({ ok: true });
    expect(kiemLyDoDoiNguon("  ab  ")).toMatchObject({ ok: false });
  });
  it("hằng khoảng khớp câu thông báo", () => {
    const r = kiemLyDoDoiNguon("");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.thongBao).toContain(`${LY_DO_TOI_THIEU} đến ${LY_DO_TOI_DA}`);
  });
});

describe("[DNR-05] thongBaoTacDong", () => {
  it("🔴 chưa ai học: câu nói thẳng 'chưa có ai xem', và khoá đã xuất bản thì nói đó là nội dung đang phát cho mọi người được giao", () => {
    const nhap = thongBaoTacDong(TAC_DONG_RONG);
    expect(nhap).toContain("chưa có ai xem");
    expect(nhap).not.toContain("đang phát");
    const xb = thongBaoTacDong(TAC_DONG_RONG, true);
    expect(xb).toContain("đã xuất bản");
    expect(xb).toContain("đang phát");
    expect(xb).not.toContain("lượt học");
  });
  it("lượt đã kết thúc được nói rõ là GIỮ NGUYÊN kết quả và chứng nhận", () => {
    const s = thongBaoTacDong({ ...TAC_DONG_RONG, ghiDanhDangHoc: 1, ghiDanhDongBang: 4 });
    expect(s).toMatch(/giữ nguyên kết quả và chứng nhận/);
  });
  it("không có lượt đã kết thúc / câu hỏi chèn thì không nhắc tới chúng", () => {
    const s = thongBaoTacDong({ ...TAC_DONG_RONG, ghiDanhDangHoc: 2 });
    expect(s).not.toMatch(/đã kết thúc/);
    expect(s).not.toMatch(/câu hỏi chèn/);
  });
});

describe("[DNR-07] lý do KHÔNG chứa link/đường dẫn video (mã nguồn là bí mật; lý do vào sổ audit + bản chụp BẤT BIẾN)", () => {
  const BI_CAM = [
    "đổi sang https://youtu.be/AbCdEfGhIjK vì bản cũ lỗi",
    "thay video, link http://example.com/v.mp4",
    "xem youtube.com/watch?v=AbCdEfGhIjK rồi đổi",
    "dùng youtu.be/AbCdEfGhIjK thay thế",
    "khoá tệp elearning/master/les1/moi.mp4 mới",
    "tệp elearning/caption/les1/vi.vtt",
    "file baigiang-v2.MP4 đã sửa tiếng",
  ];
  it("🔴 mỗi dạng NHẬN RA được bị từ chối, nói rõ vì sao", () => {
    for (const x of BI_CAM) {
      const r = kiemLyDoDoiNguon(x);
      expect(r, x).toMatchObject({ ok: false });
      if (!r.ok) expect(r.thongBao).toContain("không được chứa link");
      expect(lyDoChuaNguon(x), x).toBe(true);
    }
  });
  it("đối chứng dương: lý do bằng lời, kể cả có chữ 'video', 'tệp', 'youtube' đứng riêng ⇒ qua", () => {
    for (const x of [
      "Bản cũ sai tiếng, thay bằng bản đã lồng lại",
      "Đổi video theo yêu cầu của phòng Đào tạo",
      "Cập nhật nội dung theo chương trình 2027",
      "tải lên tệp mới vì tệp cũ lỗi âm thanh",
      "thay video youtube bằng bản nội bộ",
    ]) {
      expect(kiemLyDoDoiNguon(x), x).toMatchObject({ ok: true });
    }
  });
  it("kiểm độ dài đứng TRƯỚC kiểm nội dung (lý do ngắn chứa link vẫn báo thiếu độ dài trước)", () => {
    const r = kiemLyDoDoiNguon(".mp4"); // 4 ký tự: ngắn hơn mức tối thiểu VÀ chứa đuôi tệp
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.thongBao).toContain("từ 5 đến 500");
  });
});
