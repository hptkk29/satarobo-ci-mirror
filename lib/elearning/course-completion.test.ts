// @vitest-environment node
/**
 * EL-06 — cuộn tiến độ bài lên cấp khoá.
 *
 * Không có hàm này thì `TrnEnrollment.status` không bao giờ rời `IN_PROGRESS`, và
 * mọi thứ đứng trên nó đều rỗng: thông báo hoàn thành không gửi, báo cáo tuân thủ
 * luôn 0%, lịch nhắc không bao giờ được huỷ. Đó là một lỗi KHÔNG có triệu chứng —
 * màn hình vẫn chạy, chỉ là không ai từng "xong".
 */
import { describe, it, expect } from "vitest";
import { cuonTienDoKhoa } from "@/lib/elearning/course-completion";

const NOW = new Date("2026-08-23T00:00:00.000Z");
const ngay = (s: string) => new Date(`${s}T00:00:00.000Z`);

const cuon = (o: Partial<Parameters<typeof cuonTienDoKhoa>[0]> = {}) =>
  cuonTienDoKhoa({
    soBaiBatBuoc: 4,
    soBaiDaXong: 4,
    statusHienTai: "IN_PROGRESS",
    dueAtOriginal: ngay("2026-09-01"),
    now: NOW,
    ...o,
  });

describe("đúng hạn vs trễ đo trên `dueAtOriginal`", () => {
  it("xong trước hạn gốc ⇒ COMPLETED", () => {
    expect(cuon().status).toBe("COMPLETED");
    expect(cuon().isLate).toBe(false);
  });

  it("xong sau hạn gốc ⇒ COMPLETED_LATE", () => {
    const r = cuon({ dueAtOriginal: ngay("2026-08-01") });
    expect(r.status).toBe("COMPLETED_LATE");
    expect(r.isLate).toBe(true);
  });

  it("khoá không hạn ⇒ luôn COMPLETED, không bao giờ trễ", () => {
    const r = cuon({ dueAtOriginal: null });
    expect(r.status).toBe("COMPLETED");
    expect(r.isLate).toBe(false);
  });
});

describe("chưa xong hết bài", () => {
  it("còn bài chưa xong ⇒ vẫn IN_PROGRESS, phần trăm đúng", () => {
    const r = cuon({ soBaiDaXong: 1 });
    expect(r.status).toBe("IN_PROGRESS");
    expect(r.progressPercent).toBe(25);
  });

  it("phần trăm làm tròn, không vượt 100", () => {
    expect(cuon({ soBaiBatBuoc: 3, soBaiDaXong: 1 }).progressPercent).toBe(33);
    expect(cuon({ soBaiBatBuoc: 3, soBaiDaXong: 5 }).progressPercent).toBe(100);
  });

  it("người ĐÃ hoàn thành mà số bài bắt buộc TĂNG lên thì không bị hạ cấp", () => {
    // Đào tạo thêm bài vào khoá đã phát ra là chuyện thường. Hạ người đã xong
    // xuống IN_PROGRESS là thu lại một kết luận đã công bố — và với khoá bắt
    // buộc, là xoá bằng chứng đã được đào tạo.
    const r = cuon({ soBaiBatBuoc: 6, soBaiDaXong: 4, statusHienTai: "COMPLETED" });
    expect(r.status).toBe("COMPLETED");
  });
});

describe("khoá chưa có bài bắt buộc nào", () => {
  it("KHÔNG tự động hoàn thành, và không chia cho 0", () => {
    // Coi là 100% thì mọi người "hoàn thành" một khoá rỗng, và bảng tuân thủ báo
    // 100% cho một khoá chưa ai soạn xong.
    const r = cuon({ soBaiBatBuoc: 0, soBaiDaXong: 0 });
    expect(r.status).toBe("IN_PROGRESS");
    expect(r.progressPercent).toBe(0);
    expect(Number.isNaN(r.progressPercent)).toBe(false);
  });
});

describe("`vuaHoanThanh` — cờ phát sự kiện", () => {
  it("lần đầu xong ⇒ true", () => {
    expect(cuon().vuaHoanThanh).toBe(true);
  });

  it("mở lại bài cuối khi đã xong ⇒ false", () => {
    // Không có cờ này thì mỗi lần người học mở lại bài cuối là một lời chúc mừng
    // mới trong hộp thư của họ.
    for (const st of ["COMPLETED", "COMPLETED_LATE"] as const) {
      expect(cuon({ statusHienTai: st }).vuaHoanThanh, st).toBe(false);
    }
  });

  it("chưa xong ⇒ false", () => {
    expect(cuon({ soBaiDaXong: 2 }).vuaHoanThanh).toBe(false);
  });

  it("đã COMPLETED_LATE thì KHÔNG bị nâng lên COMPLETED", () => {
    // Trạng thái này không xảy ra được nếu `dueAtOriginal` thật sự bất biến —
    // "đã trễ" là sự thật chỉ đúng thêm theo thời gian. Case dựng đúng cái thế
    // bất khả đó để canh: nếu cột hạn gốc có ngày bị sửa, nâng cấp âm thầm là
    // XOÁ một lần nộp trễ đã ghi nhận.
    //
    // ⚠️ Bản đầu của case này có TÊN nói một đằng và khẳng định một nẻo: tên bảo
    // "không bị đổi", còn `expect` lại chờ đúng cái giá trị bị đổi. Nó xanh, và
    // xanh trong khi ghi lại một hành vi sai.
    const r = cuon({ statusHienTai: "COMPLETED_LATE", dueAtOriginal: ngay("2026-12-01") });
    expect(r.status).toBe("COMPLETED_LATE");
    expect(r.vuaHoanThanh).toBe(false);
  });
});
