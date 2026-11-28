// Trần chi phí — CỔNG THẬT nằm ở câu lệnh SQL. Test viết TRƯỚC hiện thực (luật cứng #5).
//
// Yêu cầu của chủ dự án: "phải chịu được chạy song song — hai lời gọi cùng lúc lúc sát
// trần không được cùng lọt". Điều đó KHÔNG thể đạt bằng đọc-rồi-so trong TypeScript:
// hai tiến trình serverless cùng đọc `đã tiêu = 1.999.600`, cả hai cùng thấy còn chỗ,
// cả hai cùng gửi. Đây không phải nguy cơ lý thuyết — `lib/otp/service.ts:138` đang làm
// đúng kiểu đó (`count()` rồi `if`), và bộ này cố ý KHÔNG chép lại nó.
//
// Cách duy nhất đúng ở tầng này: MỘT câu `UPDATE ... WHERE đã_tiêu + chi_phí <= trần`.
// Postgres khoá dòng và ĐÁNH GIÁ LẠI mệnh đề WHERE trên giá trị đã commit sau khi
// giành được khoá, nên lượt thứ hai tự trượt. Số dòng bị tác động = câu trả lời.
//
// Ba thứ bộ test này canh, vì mất thứ nào cũng là tiêu tiền âm thầm:
//   1. Câu đặt chỗ là MỘT câu UPDATE, không có SELECT dò trước.
//   2. Bất đẳng thức trong SQL khớp bản thuần ở `chinh-sach.ts` (`<=`, không phải `<`).
//   3. Mọi giá trị đi vào SQL qua THAM SỐ, không nối chuỗi.
import { describe, it, expect } from "vitest";
import {
  sqlTaoDongKy,
  sqlDatCho,
  sqlHoanLai,
  sqlDanhDauCanhBao,
  sqlDanhDauBiChan,
  BANG_SO_CHI,
} from "@/lib/ngan-sach-goi-ra/cau-lenh";

const KY = "2026-08";
const TRUC = "ZALO";

/** Gộp khoảng trắng để so chuỗi không phụ thuộc cách xuống dòng. */
const gon = (s: string) => s.replace(/\s+/g, " ").trim();

describe("cổng ngân sách · câu đặt chỗ là MỘT câu UPDATE có điều kiện", () => {
  const cau = sqlDatCho({ kyThang: KY, truc: TRUC, chiPhiVnd: 400, tranVnd: 2_000_000 });
  const text = gon(cau.sql);

  it("là UPDATE, không phải SELECT rồi mới UPDATE", () => {
    expect(text.startsWith("UPDATE")).toBe(true);
    expect(text.toUpperCase()).not.toContain("SELECT");
  });

  it("chỉ MỘT câu lệnh — không có dấu chấm phẩy nối câu", () => {
    expect(text.replace(/;$/, "")).not.toContain(";");
  });

  it("mệnh đề chặn dùng ĐÚNG bất đẳng thức của bản thuần: đã tiêu + chi phí <= trần", () => {
    expect(text).toContain(`"spentVnd" + ? <= ?`);
    // `<` thay cho `<=` sẽ làm lượt tiêu vừa khít trần bị chặn oan — lệch với
    // `quyetDinhNganSach` và với ca test biên của nó.
    expect(text).not.toMatch(/"spentVnd" \+ \? < \?[^=]/);
  });

  it("khoá đúng một dòng: kỳ + trục đều nằm trong WHERE", () => {
    expect(text).toContain(`"period" = ?`);
    expect(text).toContain(`"axis" = ?`);
  });

  it("trả lại số đã tiêu sau khi cộng — nơi gọi không phải đọc lại (tránh đọc trúng dòng đã đổi)", () => {
    expect(text).toContain(`RETURNING`);
    expect(text).toContain(`"spentVnd"`);
  });

  it("cộng cả số lượt để đối soát với hoá đơn nhà cung cấp", () => {
    expect(text).toContain(`"chargeCount" = "chargeCount" + 1`);
  });

  it("KHÔNG nối chuỗi — mọi giá trị đi qua tham số", () => {
    expect(cau.values).toEqual([400, KY, TRUC, 400, 2_000_000]);
    expect(text).not.toContain("2000000");
    expect(text).not.toContain(KY);
  });
});

describe("cổng ngân sách · các câu phụ trợ", () => {
  it("tạo dòng kỳ×trục là idempotent — hai lời gọi cùng lúc không vỡ vì trùng khoá", () => {
    const text = gon(sqlTaoDongKy({ kyThang: KY, truc: TRUC }).sql);
    expect(text.startsWith("INSERT")).toBe(true);
    expect(text.toUpperCase()).toContain("ON CONFLICT DO NOTHING");
  });

  it("hoàn lại (nhà cung cấp KHÔNG tính phí tin gửi hỏng) không kéo số xuống âm", () => {
    const text = gon(sqlHoanLai({ kyThang: KY, truc: TRUC, chiPhiVnd: 400 }).sql);
    expect(text.startsWith("UPDATE")).toBe(true);
    expect(text).toContain("GREATEST(0,");
  });

  it("đánh dấu cảnh báo chỉ ăn MỘT lần mỗi kỳ (warnedAt IS NULL) và chỉ khi đã qua mốc", () => {
    const text = gon(sqlDanhDauCanhBao({ kyThang: KY, truc: TRUC, mocVnd: 1_600_000 }).sql);
    expect(text).toContain(`"warnedAt" IS NULL`);
    expect(text).toContain(`"spentVnd" >= ?`);
    expect(text).toContain("RETURNING");
  });

  it("đếm lượt bị chặn để biết trần đang cắt mất bao nhiêu việc", () => {
    const text = gon(sqlDanhDauBiChan({ kyThang: KY, truc: TRUC }).sql);
    expect(text).toContain(`"blockedCount" = "blockedCount" + 1`);
    expect(text).toContain(`"blockedAt" = COALESCE("blockedAt", now())`);
  });

  it("tên bảng là hằng số trong module, không phải chuỗi do nơi gọi truyền vào", () => {
    expect(BANG_SO_CHI).toBe("OutboundSpendCounter");
  });
});
