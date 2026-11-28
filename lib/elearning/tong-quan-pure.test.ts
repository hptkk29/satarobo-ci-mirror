// @vitest-environment node
/**
 * [TQP-*] Phần THUẦN của Tổng quan theo thiết kế `Main.html`: bài tiếp theo, thời gian còn lại, dòng ngày, dòng hạn.
 * Đồng hồ đóng băng (luật 19): mọi ngày là ngày TUYỆT ĐỐI + `now` truyền vào.
 */
import { describe, expect, it } from "vitest";
import {
  chonBaiTiepTheoTongQuan,
  chuConLai,
  chuDongHo,
  dongHanCuaBan,
  dongNgayTongQuan,
  uocConLaiGiay,
  type BaiRut,
} from "./dashboard-pure";

// Thứ Ba 17/11/2026, 10:00 giờ Việt Nam.
const NOW = new Date("2026-11-17T03:00:00.000Z");
const ngay = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const bai = (id: string, o: Partial<BaiRut> = {}): BaiRut => ({ id, title: id, kind: "VIDEO", required: true, thoiLuongGiay: 600, ...o });

describe("[TQP-01] chonBaiTiepTheo", () => {
  const ds = [bai("a"), bai("b", { required: false }), bai("c"), bai("d")];
  it("ưu tiên bài chạm gần nhất mà chưa xong (còn trong phiên bản)", () => {
    expect(chonBaiTiepTheoTongQuan(ds, new Set(["a"]), "d")?.bai.id).toBe("d");
  });
  it("bài chạm gần nhất ĐÃ xong hoặc không còn trong phiên bản ⇒ bài bắt buộc đầu tiên chưa xong", () => {
    expect(chonBaiTiepTheoTongQuan(ds, new Set(["a"]), "a")?.bai.id).toBe("c");
    expect(chonBaiTiepTheoTongQuan(ds, new Set(["a"]), "khong-co")?.bai.id).toBe("c");
    expect(chonBaiTiepTheoTongQuan(ds, new Set(), null)?.bai.id).toBe("a");
  });
  it("vị trí đếm trong các bài BẮT BUỘC (bài không bắt buộc không chiếm số)", () => {
    expect(chonBaiTiepTheoTongQuan(ds, new Set(["a"]), null)).toMatchObject({ bai: { id: "c" }, viTri: 2 });
    expect(chonBaiTiepTheoTongQuan(ds, new Set(["a"]), "b")).toMatchObject({ bai: { id: "b" }, viTri: null });
  });
  it("hết bài bắt buộc thì rơi về bài không bắt buộc chưa xong; hết sạch ⇒ null", () => {
    expect(chonBaiTiepTheoTongQuan(ds, new Set(["a", "c", "d"]), null)?.bai.id).toBe("b");
    expect(chonBaiTiepTheoTongQuan(ds, new Set(["a", "b", "c", "d"]), null)).toBeNull();
    expect(chonBaiTiepTheoTongQuan([], new Set(), null)).toBeNull();
  });
});

describe("[TQP-01b] cùng quy tắc với Đề cương: bỏ qua buổi trực tiếp khi còn bài tự làm được", () => {
  const dsLive = [bai("live", { kind: "LIVE_SESSION" }), bai("v"), bai("r", { kind: "READ" })];
  it("🔴 buổi trực tiếp đứng đầu KHÔNG được chọn; vị trí vẫn đếm trên toàn bộ bài bắt buộc", () => {
    expect(chonBaiTiepTheoTongQuan(dsLive, new Set(), null)).toMatchObject({ bai: { id: "v" }, viTri: 2 });
  });
  it("bài chạm gần nhất là buổi trực tiếp ⇒ vẫn không chọn nó", () => {
    expect(chonBaiTiepTheoTongQuan(dsLive, new Set(), "live")?.bai.id).toBe("v");
  });
  it("chỉ còn buổi trực tiếp ⇒ null (không đỗ người học ở màn không có việc)", () => {
    expect(chonBaiTiepTheoTongQuan(dsLive, new Set(["v", "r"]), null)).toBeNull();
  });
});

describe("[TQP-02] uocConLaiGiay / chuConLai — chỉ nói điều đo được", () => {
  it("mọi bài bắt buộc còn lại là video có độ dài ⇒ tổng; bài đã xong và bài không bắt buộc không tính", () => {
    const ds = [bai("a", { thoiLuongGiay: 300 }), bai("b", { thoiLuongGiay: 900, required: false }), bai("c", { thoiLuongGiay: 4200 })];
    expect(uocConLaiGiay(ds, new Set(["a"]))).toBe(4200);
    expect(uocConLaiGiay(ds, new Set())).toBe(4500);
  });
  it("🔴 một bài còn lại không đo được (đọc / video thiếu độ dài) ⇒ null, KHÔNG cộng phần đo được", () => {
    expect(uocConLaiGiay([bai("a"), bai("b", { kind: "READ", thoiLuongGiay: null })], new Set())).toBeNull();
    expect(uocConLaiGiay([bai("a"), bai("b", { thoiLuongGiay: null })], new Set())).toBeNull();
    expect(uocConLaiGiay([bai("a", { thoiLuongGiay: 0 })], new Set())).toBeNull();
  });
  it("không còn bài bắt buộc nào ⇒ null", () => {
    expect(uocConLaiGiay([bai("a")], new Set(["a"]))).toBeNull();
  });
  it("chữ: giờ + phút, làm tròn phút, tối thiểu 1 phút", () => {
    expect(chuConLai(4200)).toBe("còn khoảng 1 giờ 10 phút");
    expect(chuConLai(3600)).toBe("còn khoảng 1 giờ");
    expect(chuConLai(25 * 60)).toBe("còn khoảng 25 phút");
    expect(chuConLai(10)).toBe("còn khoảng 1 phút");
  });
  it("đồng hồ video: m:ss, có giờ thì h:mm:ss", () => {
    expect(chuDongHo(760)).toBe("12:40");
    expect(chuDongHo(65)).toBe("1:05");
    expect(chuDongHo(3725)).toBe("1:02:05");
  });
});

describe("[TQP-03] dongNgayTongQuan", () => {
  it("ngày + điều cần ưu tiên có thật", () => {
    expect(dongNgayTongQuan(NOW, { tong: 4, quaHan: 1, sapHan: 1 })).toBe("Thứ Ba 17/11/2026 · 1 khoá quá hạn, 1 khoá đến hạn tuần này");
    expect(dongNgayTongQuan(NOW, { tong: 4, quaHan: 0, sapHan: 2 })).toBe("Thứ Ba 17/11/2026 · 2 khoá đến hạn tuần này");
  });
  it("không có gì gấp / chưa được giao khoá nào thì nói đúng như vậy (không khoe số 0)", () => {
    expect(dongNgayTongQuan(NOW, { tong: 4, quaHan: 0, sapHan: 0 })).toBe("Thứ Ba 17/11/2026 · không có khoá nào quá hạn hay sắp đến hạn");
    expect(dongNgayTongQuan(NOW, { tong: 0, quaHan: 0, sapHan: 0 })).toBe("Thứ Ba 17/11/2026 · chưa có khoá nào được giao");
  });
});

describe("[TQP-04] dongHanCuaBan", () => {
  const td = { xong: 1, tong: 4 };
  it("quá hạn / sắp đến hạn có số ngày; dòng phụ 'n/m bài · hạn dd/mm'", () => {
    expect(dongHanCuaBan({ status: "OVERDUE", dueAt: ngay(-5) }, NOW, td)).toEqual({ phu: "1/4 bài · hạn 12/11", nhan: "Quá hạn 5 ngày", sac: "danger" });
    expect(dongHanCuaBan({ status: "IN_PROGRESS", dueAt: ngay(3) }, NOW, { xong: 2, tong: 8 })).toEqual({ phu: "2/8 bài · hạn 20/11", nhan: "Còn 3 ngày", sac: "warning" });
  });
  it("hạn xa: chưa bắt đầu ⇒ 'Chưa bắt đầu', đang học ⇒ 'Đang học'", () => {
    expect(dongHanCuaBan({ status: "NOT_STARTED", dueAt: ngay(18) }, NOW, { xong: 0, tong: 6 })).toEqual({ phu: "0/6 bài · hạn 05/12", nhan: "Chưa bắt đầu", sac: "muted" });
    expect(dongHanCuaBan({ status: "IN_PROGRESS", dueAt: ngay(18) }, NOW, td).nhan).toBe("Đang học");
  });
  it("không có số bài ⇒ không bịa '0/0'; không có hạn ⇒ 'chưa đặt hạn'", () => {
    expect(dongHanCuaBan({ status: "NOT_STARTED", dueAt: null }, NOW, undefined)).toEqual({ phu: "chưa đặt hạn", nhan: "Chưa bắt đầu", sac: "muted" });
  });
  it("trạng thái OVERDUE mà không có hạn vẫn là 'Quá hạn' (không số ngày)", () => {
    expect(dongHanCuaBan({ status: "OVERDUE", dueAt: null }, NOW, undefined).nhan).toBe("Quá hạn");
  });
});
