// @vitest-environment node
/**
 * EL-06 — lịch nhắc 7 mốc.
 *
 * Case đắt nhất của cả tệp là "mốc đã trôi qua". Giao một khoá hạn 1 ngày thì ba
 * mốc T-5/T-2/T-1 ngày đã nằm trong quá khứ NGAY LÚC lập lịch; để chúng ở
 * `PENDING` nghĩa là nhịp cron kế tiếp người học nhận BA email cùng lúc, cho ba
 * mốc chẳng còn ý nghĩa. Đây là lỗi không ai báo — người học chỉ thấy phiền.
 */
import { describe, it, expect } from "vitest";
import { lapLichNhac, lapLaiSauGiaHan, lyDoHuy, type Moc } from "@/lib/elearning/reminder-schedule";

const t = (s: string) => new Date(s);
const lay = (ds: { milestone: Moc }[]) => ds.map((d) => d.milestone);
const theoMoc = (
  ds: { milestone: Moc; status: string; scheduledAt: Date; reason?: string }[],
  m: Moc,
) =>
  ds.find((d) => d.milestone === m);

describe("đủ bảy mốc, đúng khoảng cách", () => {
  it("hạn dài ngày ⇒ đủ 7 mốc", () => {
    const ds = lapLichNhac({
      assignedAt: t("2026-08-01T08:00:00.000Z"),
      dueAt: t("2026-09-01T10:00:00.000Z"),
      now: t("2026-08-01T08:00:00.000Z"),
    });
    expect(lay(ds)).toEqual([
      "T0",
      "T_MINUS_5D",
      "T_MINUS_2D",
      "T_MINUS_1D",
      "T_MINUS_2H",
      "T_PLUS_0",
      "T_PLUS_3D",
    ]);
  });

  it("các mốc trước hạn tính LÙI từ hạn", () => {
    const ds = lapLichNhac({
      assignedAt: t("2026-08-01T08:00:00.000Z"),
      dueAt: t("2026-09-01T10:00:00.000Z"),
      now: t("2026-08-01T08:00:00.000Z"),
    });
    expect(theoMoc(ds, "T_MINUS_5D")?.scheduledAt.toISOString()).toBe(
      "2026-08-27T10:00:00.000Z",
    );
    expect(theoMoc(ds, "T_MINUS_2H")?.scheduledAt.toISOString()).toBe(
      "2026-09-01T08:00:00.000Z",
    );
  });

  it("T+0 nhắc SAU hạn, không đúng lúc hạn", () => {
    // Đúng lúc hạn thì người đang nộp ở phút chót nhận email "đã quá hạn" trong
    // khi họ vẫn còn hạn.
    const ds = lapLichNhac({
      assignedAt: t("2026-08-01T08:00:00.000Z"),
      dueAt: t("2026-09-01T10:00:00.000Z"),
      now: t("2026-08-01T08:00:00.000Z"),
    });
    const at = theoMoc(ds, "T_PLUS_0")!.scheduledAt.getTime();
    expect(at).toBeGreaterThan(t("2026-09-01T10:00:00.000Z").getTime());
  });
});

describe("mốc ĐÃ TRÔI QUA sinh ra ở trạng thái SKIPPED", () => {
  it("hạn 1 ngày ⇒ ba mốc dài ngày là SKIPPED, không phải PENDING", () => {
    const ds = lapLichNhac({
      assignedAt: t("2026-08-19T08:00:00.000Z"),
      dueAt: t("2026-08-20T17:00:00.000Z"),
      now: t("2026-08-19T08:00:00.000Z"),
    });
    for (const m of ["T_MINUS_5D", "T_MINUS_2D"] as const) {
      expect(theoMoc(ds, m)?.status, m).toBe("SKIPPED");
    }
    expect(theoMoc(ds, "T_MINUS_2H")?.status).toBe("PENDING");
    expect(theoMoc(ds, "T_PLUS_0")?.status).toBe("PENDING");
  });

  it("mốc SKIPPED có ghi lý do, không im lặng", () => {
    // Không ghi lý do thì về sau đọc bảng chỉ thấy "SKIPPED" mà không biết vì
    // hạn ngắn hay vì người học đã xong.
    const ds = lapLichNhac({
      assignedAt: t("2026-08-19T08:00:00.000Z"),
      dueAt: t("2026-08-20T17:00:00.000Z"),
      now: t("2026-08-19T08:00:00.000Z"),
    });
    expect(theoMoc(ds, "T_MINUS_5D")?.reason).toContain("trôi qua");
  });

  it("T0 vẫn PENDING dù `assignedAt` đã qua", () => {
    // "Bạn vừa được giao khoá X" vẫn đúng dù gửi muộn vài phút — khác hẳn "còn 5
    // ngày" gửi khi chỉ còn 1 ngày.
    const ds = lapLichNhac({
      assignedAt: t("2026-08-01T08:00:00.000Z"),
      dueAt: null,
      now: t("2026-08-19T08:00:00.000Z"),
    });
    expect(theoMoc(ds, "T0")?.status).toBe("PENDING");
  });
});

describe("bài KHÔNG có hạn", () => {
  it("chỉ sinh mốc T0, không bịa ra sáu mốc còn lại", () => {
    // Sinh sáu mốc dựa trên một cái hạn không tồn tại là bịa ra sáu ngày giờ rồi
    // nhắc theo chúng.
    const ds = lapLichNhac({
      assignedAt: t("2026-08-01T08:00:00.000Z"),
      dueAt: null,
      now: t("2026-08-01T08:00:00.000Z"),
    });
    expect(lay(ds)).toEqual(["T0"]);
  });
});

describe("gia hạn ⇒ lập lại các mốc chưa gửi", () => {
  it("mốc ĐÃ GỬI không bị dựng lại", () => {
    // Dựng lại quá khứ nghĩa là người học nhận lần hai đúng cái tin họ đã đọc.
    const ds = lapLaiSauGiaHan({
      assignedAt: t("2026-08-01T08:00:00.000Z"),
      dueAtMoi: t("2026-10-01T10:00:00.000Z"),
      now: t("2026-09-01T00:00:00.000Z"),
      daGui: new Set<Moc>(["T0", "T_MINUS_5D"]),
    });
    expect(lay(ds)).not.toContain("T0");
    expect(lay(ds)).not.toContain("T_MINUS_5D");
    expect(lay(ds)).toContain("T_MINUS_2H");
  });

  it("hạn mới xa hơn ⇒ mốc trước hạn quay lại PENDING", () => {
    const ds = lapLaiSauGiaHan({
      assignedAt: t("2026-08-01T08:00:00.000Z"),
      dueAtMoi: t("2026-12-01T10:00:00.000Z"),
      now: t("2026-09-01T00:00:00.000Z"),
      daGui: new Set<Moc>(),
    });
    expect(theoMoc(ds, "T_MINUS_2D")?.status).toBe("PENDING");
  });
});

describe("lý do huỷ nói đúng chuyện đã xảy ra", () => {
  it("mỗi trạng thái một câu riêng", () => {
    expect(lyDoHuy("COMPLETED")).toBe("đã hoàn thành");
    expect(lyDoHuy("REVOKED")).toBe("đã thu hồi");
    expect(lyDoHuy("PAUSED")).toBe("tạm dừng đồng hồ");
  });

  it("bốn trạng thái đều có câu, không rơi vào `undefined`", () => {
    for (const s of ["COMPLETED", "COMPLETED_LATE", "REVOKED", "PAUSED"] as const) {
      expect(lyDoHuy(s), s).toBeTruthy();
    }
  });
});
