// @vitest-environment node
/** [ONL-PH-*] Phát hành phiên bản Online: so sánh bản + tác động theo chính sách tiến độ (hàm thuần). */
import { describe, expect, it } from "vitest";
import { ChinhSachThieuError, soSanhPhienBan, tinhTacDong, type BaiSoSanh, type ChinhSachTienDo, type HocVienDangHoc } from "./phat-hanh";

const b = (stableId: string, thuTu: number, o: Partial<BaiSoSanh> = {}): BaiSoSanh => ({
  stableId,
  chapterStableId: stableId.split(".")[0]!,
  title: `Bài ${stableId}`,
  kind: "VIDEO",
  required: true,
  hidden: false,
  noiDungHash: `h-${stableId}`,
  thuTu,
  ...o,
});
// Bản 3: 1.1 1.2 2.1 2.3 3.2 3.3 (như QoPhatHanh1: sửa 2.1, thêm 2.5, ẩn 2.3, đổi 3.2↔3.3)
const BAN3 = [b("1.1", 1), b("1.2", 2), b("2.1", 3), b("2.3", 4), b("3.2", 5), b("3.3", 6)];
const BAN4 = [b("1.1", 1), b("1.2", 2), b("2.1", 3, { noiDungHash: "h-2.1-moi" }), b("2.3", 4, { hidden: true }), b("2.5", 5), b("3.3", 6), b("3.2", 7)];
const hv = (id: string, ...xong: string[]): HocVienDangHoc => ({ entitlementId: id, daXong: new Set(xong), daCoChungNhan: false });

describe("[ONL-PH-01] so sánh hai bản", () => {
  it("🔴 thêm · sửa · ẩn · đổi thứ tự được nhận ĐÚNG và không lẫn nhau", () => {
    const r = soSanhPhienBan(BAN3, BAN4);
    expect(r.them).toEqual(["2.5"]);
    expect(r.sua).toEqual(["2.1"]);
    expect(r.an).toEqual(["2.3"]);
    expect(r.doiThuTu.sort()).toEqual(["3.2", "3.3"]);
    expect(r.hienLai).toEqual([]);
    expect(r.bien).toEqual([]);
  });

  it("giống hệt ⇒ không có thay đổi; bài biến mất hẳn ⇒ vào `bien`; ẩn rồi hiện lại ⇒ `hienLai`", () => {
    expect(soSanhPhienBan(BAN3, BAN3)).toEqual({ them: [], sua: [], an: [], hienLai: [], doiThuTu: [], bien: [] });
    expect(soSanhPhienBan(BAN3, BAN3.filter((x) => x.stableId !== "1.2")).bien).toEqual(["1.2"]);
    const anRoi = BAN3.map((x) => (x.stableId === "1.2" ? { ...x, hidden: true } : x));
    expect(soSanhPhienBan(anRoi, BAN3).hienLai).toEqual(["1.2"]);
  });

  it("🔴 chèn một bài MỚI ở giữa KHÔNG làm các bài cũ bị tính là 'đổi thứ tự' (xếp hạng tương đối giữ nguyên)", () => {
    const moi = [b("1.1", 1), b("1.9", 2), b("1.2", 3), b("2.1", 4), b("2.3", 5), b("3.2", 6), b("3.3", 7)];
    const r = soSanhPhienBan(BAN3, moi);
    expect(r.them).toEqual(["1.9"]);
    expect(r.doiThuTu).toEqual([]);
  });
});

describe("[ONL-PH-02] chính sách tiến độ là BẮT BUỘC, không mặc định", () => {
  it("🔴 thiếu / lạ ⇒ ném ChinhSachThieuError (không âm thầm giữ tiến độ)", () => {
    for (const cs of [null, undefined, { loai: "MAC_DINH" } as unknown as ChinhSachTienDo]) {
      expect(() => tinhTacDong({ cu: BAN3, moi: BAN4, hocVien: [hv("a")], chinhSach: cs }), String(cs)).toThrow(ChinhSachThieuError);
    }
  });
});

describe("[ONL-PH-03] tác động theo chính sách", () => {
  const HV = [hv("xong", "1.1", "1.2", "2.1", "2.3", "3.2", "3.3"), hv("giua", "1.1", "1.2", "2.1"), hv("dau", "1.1")];

  it("KEEP_PROGRESS: không ai phải học lại bài cũ; bài mới bắt buộc thêm vào cuối; bài ẩn rời mẫu số", () => {
    const r = tinhTacDong({ cu: BAN3, moi: BAN4, hocVien: HV, chinhSach: { loai: "KEEP_PROGRESS" } });
    expect(r.soPhaiHocLai).toBe(0);
    const xong = r.chiTiet.find((c) => c.entitlementId === "xong")!;
    expect(xong.phaiHocMoi).toEqual(["2.5"]);
    expect(xong.truoc).toEqual({ xong: 6, tong: 6 });
    expect(xong.sau).toEqual({ xong: 5, tong: 6 }); // 2.3 ẩn ⇒ 5 bài đã xong / (5 cũ còn hiện + 2.5)
    expect(r.matChungNhan).toBe(0);
  });

  it("🔴 RELEARN_SELECTED: chỉ ai ĐÃ XONG bài sửa được chọn mới phải học lại; người chưa tới bài đó không bị tính", () => {
    const r = tinhTacDong({ cu: BAN3, moi: BAN4, hocVien: HV, chinhSach: { loai: "RELEARN_SELECTED", baiHocLai: ["2.1"] } });
    expect(r.chiTiet.find((c) => c.entitlementId === "xong")!.phaiHocLai).toEqual(["2.1"]);
    expect(r.chiTiet.find((c) => c.entitlementId === "giua")!.phaiHocLai).toEqual(["2.1"]);
    expect(r.chiTiet.find((c) => c.entitlementId === "dau")!.phaiHocLai).toEqual([]);
    expect(r.soPhaiHocLai).toBe(2);
    expect(r.chiTiet.find((c) => c.entitlementId === "giua")!.sau).toEqual({ xong: 2, tong: 6 }); // 1.1, 1.2 còn; 2.1 phải học lại
  });

  it("🔴 RELEARN_SELECTED với bài KHÔNG bị sửa ở bản mới ⇒ bị bỏ qua (không bắt học lại bài giữ nguyên)", () => {
    const r = tinhTacDong({ cu: BAN3, moi: BAN4, hocVien: HV, chinhSach: { loai: "RELEARN_SELECTED", baiHocLai: ["1.1"] } });
    expect(r.soPhaiHocLai).toBe(0);
  });

  it("RESET_BY_SCOPE: đặt lại theo CHƯƠNG, và (tuỳ chọn) chỉ nhóm học viên được chọn; bài ẩn không bị tính", () => {
    const tatCa = tinhTacDong({ cu: BAN3, moi: BAN4, hocVien: HV, chinhSach: { loai: "RESET_BY_SCOPE", chuongStableIds: ["2"] } });
    expect(tatCa.chiTiet.find((c) => c.entitlementId === "xong")!.phaiHocLai).toEqual(["2.1"]); // 2.3 đã ẩn ⇒ không tính
    expect(tatCa.soPhaiHocLai).toBe(2);
    const nhom = tinhTacDong({ cu: BAN3, moi: BAN4, hocVien: HV, chinhSach: { loai: "RESET_BY_SCOPE", chuongStableIds: ["2"], entitlementIds: ["xong"] } });
    expect(nhom.soPhaiHocLai).toBe(1);
  });

  it("ADD_NEW_ONLY: không đụng bài cũ kể cả bài bị sửa; chỉ bài mới", () => {
    const r = tinhTacDong({ cu: BAN3, moi: BAN4, hocVien: HV, chinhSach: { loai: "ADD_NEW_ONLY" } });
    expect(r.soPhaiHocLai).toBe(0);
    expect(r.soBiAnhHuong).toBe(3); // cả ba đều có bài mới 2.5 chưa xong
  });

  it("🔴 học viên có chứng nhận vẫn được giữ: `matChungNhan` luôn 0 dù bị buộc học lại", () => {
    const r = tinhTacDong({ cu: BAN3, moi: BAN4, hocVien: [{ ...hv("xong", "1.1", "1.2", "2.1", "2.3", "3.2", "3.3"), daCoChungNhan: true }], chinhSach: { loai: "RELEARN_SELECTED", baiHocLai: ["2.1"] } });
    expect(r.soPhaiHocLai).toBe(1);
    expect(r.matChungNhan).toBe(0);
  });

  it("danh sách học viên rỗng ⇒ tác động 0, vẫn kiểm chính sách", () => {
    expect(tinhTacDong({ cu: BAN3, moi: BAN4, hocVien: [], chinhSach: { loai: "KEEP_PROGRESS" } })).toMatchObject({ soHocVien: 0, soBiAnhHuong: 0 });
    expect(() => tinhTacDong({ cu: BAN3, moi: BAN4, hocVien: [], chinhSach: null })).toThrow(ChinhSachThieuError);
  });
});
