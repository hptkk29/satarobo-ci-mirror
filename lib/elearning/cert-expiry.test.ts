// @vitest-environment node
/**
 * EL-16 — vòng đời HẾT HIỆU LỰC: nhắc T-30/T-7 và giao lại vòng tái chứng nhận.
 *
 * Hai kiểu sai ở đây đều im lặng và đều tốn: nhắc bị nhảy qua thì người ta hết hạn
 * mà không biết; giao lại sai thì hoặc không ai được giao lại, hoặc mỗi nhịp cron
 * đẻ thêm một lượt cho tới khi người học mở ra thấy mười hai lượt cùng một khoá.
 */
import { describe, it, expect } from "vitest";
import {
  canGiaoLai,
  mocCanNhac,
  MOC_NHAC_HET_HAN,
  noiDungNhacHetHan,
  soNgayConLai,
} from "@/lib/elearning/cert-expiry";

const D = (s: string) => new Date(s);
const NOW = D("2026-06-01T00:00:00Z");

describe("số ngày còn lại", () => {
  it("làm tròn LÊN", () => {
    // Còn 6,4 ngày thì theo lịch người ta còn 7 — nói "còn 6" là hối thúc sai. Và
    // làm tròn xuống khiến mốc T-7 bị nhảy qua ở những lần chạy rơi vào nửa sau ngày.
    expect(soNgayConLai(D("2026-06-07T10:00:00Z"), NOW)).toBe(7);
  });

  it("đúng mốc = 0", () => {
    expect(soNgayConLai(NOW, NOW)).toBe(0);
  });

  it("đã quá hạn ⇒ âm", () => {
    expect(soNgayConLai(D("2026-05-30T00:00:00Z"), NOW)).toBeLessThan(0);
  });
});

describe("🔴 chọn mốc nhắc — khớp theo `<=`, không `===`", () => {
  it("đúng ngày thứ 30 thì nhắc mốc 30", () => {
    expect(mocCanNhac(30, [])).toBe(30);
  });

  it("cron chạy hụt vài ngày vẫn bắt được, KHÔNG nhảy qua vĩnh viễn", () => {
    // ⚠️ Ca đắt nhất tệp này. `=== 30` chỉ đúng nếu cron chạy đúng ngày đó và không
    // lỗi lần nào. Một lần chạy hụt — máy bận, deploy, hàng đợi tắc — là mốc T-30
    // mất luôn, và không gì báo: sổ chỉ có một dòng "chưa gửi" nằm im.
    expect(mocCanNhac(28, [])).toBe(30);
    expect(mocCanNhac(12, [])).toBe(30);
  });

  it("còn 5 ngày ⇒ nhắc mốc 7, KHÔNG phải mốc 30", () => {
    // Vì khớp theo `<=` nên ở ngày thứ 5 cả 30 lẫn 7 đều khớp. Lời nhắc đúng là
    // "còn 7 ngày"; nói "còn 30" là sai sự thật ngay trên màn hình người nhận.
    expect(mocCanNhac(5, [])).toBe(7);
  });

  it("đã nhắc mốc 30 rồi thì thôi, nhưng vẫn nhắc mốc 7 khi tới", () => {
    expect(mocCanNhac(20, [30])).toBeNull();
    expect(mocCanNhac(6, [30])).toBe(7);
    expect(mocCanNhac(6, [30, 7])).toBeNull();
  });

  it("đã quá hạn ⇒ không nhắc nữa (việc của nhánh chốt hết hạn)", () => {
    expect(mocCanNhac(-1, [])).toBeNull();
  });

  it("đúng HAI mốc, không hơn", () => {
    // §13.4 chốt hai mốc. Thêm mốc là thêm thư vào hộp thư của người ta.
    expect([...MOC_NHAC_HET_HAN]).toEqual([30, 7]);
  });
});

describe("câu chữ lời nhắc", () => {
  it("nói việc PHẢI LÀM, không chỉ báo ngày", () => {
    // Một lời nhắc chỉ có ngày thì người nhận đọc xong vẫn không biết mình cần làm gì.
    const a = noiDungNhacHetHan({
      moc: 30,
      tenKhoa: "An toàn lao động",
      validUntil: D("2026-07-01T00:00:00Z"),
    });
    expect(a.body).toContain("tự giao lại");

    const b = noiDungNhacHetHan({
      moc: 7,
      tenKhoa: "An toàn lao động",
      validUntil: D("2026-06-08T00:00:00Z"),
    });
    expect(b.body).toContain("CHƯA đạt");
  });

  it("có tên khoá trong tiêu đề — hộp thư có nhiều lời nhắc", () => {
    const a = noiDungNhacHetHan({
      moc: 7,
      tenKhoa: "Quy trình tư vấn",
      validUntil: D("2026-06-08T00:00:00Z"),
    });
    expect(a.title).toContain("Quy trình tư vấn");
  });
});

describe("🔴 có giao lại khoá cho vòng mới không", () => {
  const base = {
    validUntil: D("2026-05-01T00:00:00Z"),
    now: NOW,
    daCoLuotVongSau: false,
    chungNhanBiThuHoi: false,
  };

  it("hết hạn + chưa có lượt vòng sau ⇒ giao lại", () => {
    expect(canGiaoLai(base)).toBe(true);
  });

  it("VÔ THỜI HẠN ⇒ KHÔNG giao lại", () => {
    // Không có chu kỳ thì không có gì để tái. Giao lại là bắt người ta học lại một
    // thứ không ai yêu cầu học lại.
    expect(canGiaoLai({ ...base, validUntil: null })).toBe(false);
  });

  it("chưa tới hạn ⇒ chưa giao lại", () => {
    expect(canGiaoLai({ ...base, validUntil: D("2026-07-01T00:00:00Z") })).toBe(false);
  });

  it("đã có lượt vòng sau ⇒ KHÔNG đẻ thêm", () => {
    // Không kiểm thì mỗi nhịp cron sinh thêm một lượt: cron chạy 15 phút/lần, nên
    // sau một ngày người học mở khu ra thấy gần trăm lượt cùng một khoá.
    expect(canGiaoLai({ ...base, daCoLuotVongSau: true })).toBe(false);
  });

  it("chứng nhận bị THU HỒI ⇒ không tự giao lại", () => {
    // Hết hạn là đồng hồ chạy; thu hồi là một QUYẾT ĐỊNH về một con người. Tự giao
    // lại ngay sau khi thu hồi là hệ thống thay người ra quyết định trả lời câu
    // "người này có phải học lại không" — mà câu trả lời còn tuỳ vì sao thu hồi.
    expect(canGiaoLai({ ...base, chungNhanBiThuHoi: true })).toBe(false);
  });
});
