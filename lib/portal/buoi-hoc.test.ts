// Cổng phụ huynh/học viên — "buổi nào, buổi thứ mấy, buổi hiện tại".
//
// Mỗi ca dưới đây khoá một khiếm khuyết CÓ THẬT đã đo được trong mã cũ (xem khối chú
// thích đầu lib/portal/buoi-hoc.ts), không phải ca giả định.
//
// `@/lib/db` bị mock: phần TÍNH TOÁN của file là hàm thuần, không cần Postgres —
// cùng cách làm với lib/portal/feedback.test.ts.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { classSession: { findMany: vi.fn() } } }));

import {
  chonMocBuoi,
  demBuoi,
  dungDanhSachBuoi,
  type BuoiRow,
} from "@/lib/portal/buoi-hoc";

const L = "cls-1";

/** Buổi tối thứ Bảy 19:00 giờ VN của ngày `ymd` — viết bằng mốc UTC cho khỏi lệ thuộc TZ máy. */
function buoiToi(ymd: string): Date {
  return new Date(`${ymd}T12:00:00.000Z`); // 12:00Z = 19:00 VN
}

function hang(
  id: string,
  ymd: string,
  extra: Partial<BuoiRow> = {},
): BuoiRow {
  return { id, classId: L, date: buoiToi(ymd), status: "SCHEDULED", ...extra };
}

describe("dungDanhSachBuoi — số buổi là HẠNG THEO NGÀY, không phải Lesson.order", () => {
  it("[huỷ buổi + buổi bù] hai buổi cùng lessonId vẫn ra HAI số buổi khác nhau", () => {
    // Đúng thứ `cancelSession` (lib/classes/adjust.ts) tạo ra: buổi gốc CANCELLED,
    // buổi bù mang y nguyên lessonId + Lesson.order.
    const bai5 = { order: 5, title: "Họa Sĩ Robot", moduleCode: "HP2" };
    const rows: BuoiRow[] = [
      hang("s4", "2026-09-01", { lesson: { order: 4, title: "Xe dò vạch" } }),
      hang("s5", "2026-09-08", { status: "CANCELLED", lesson: bai5 }),
      hang("s5bu", "2026-09-29", { lesson: bai5 }),
      hang("s6", "2026-09-15", { lesson: { order: 6, title: "Tay gắp" } }),
    ];
    const ds = dungDanhSachBuoi(rows, new Date("2026-09-20T00:00:00.000Z"));
    const so = Object.fromEntries(ds.map((b) => [b.id, b.soBuoi]));

    // Mã cũ in "Buổi 5" cho CẢ HAI (đọc Lesson.order). Giáo viên thấy 2 và 4.
    expect(so.s5).toBe(2);
    expect(so.s5bu).toBe(4);
    expect(so.s4).toBe(1);
    expect(so.s6).toBe(3);
  });

  it("[khử trùng] buổi bù KHÔNG bị nuốt — cả hai đều có mặt trong danh sách", () => {
    const bai = { order: 5, title: "Họa Sĩ Robot" };
    const ds = dungDanhSachBuoi(
      [
        hang("goc", "2026-09-08", { status: "CANCELLED", lesson: bai }),
        hang("bu", "2026-09-29", { lesson: bai }),
      ],
      new Date("2026-10-01T00:00:00.000Z"),
    );
    // Mã cũ (student-sessions/student-assignments) khử trùng theo lesson.id và giữ bản
    // ghi ĐẦU theo ngày ⇒ chỉ còn buổi ĐÃ HUỶ, buổi bù có thật biến mất.
    expect(ds.map((b) => b.id)).toEqual(["goc", "bu"]);
  });

  it("[chưa ghim giáo trình] buổi không có lesson vẫn nằm trong danh sách", () => {
    const ds = dungDanhSachBuoi(
      [hang("a", "2026-09-01"), hang("b", "2026-09-08", { topic: "Ôn tập giữa khoá" })],
      new Date("2026-09-10T00:00:00.000Z"),
    );
    // Mã cũ dùng `where: { lessonId: { not: null } }` ⇒ trang "Buổi học" trống trơn.
    expect(ds).toHaveLength(2);
    expect(ds[0]!.soBuoi).toBe(1);
    expect(ds[0]!.nhanDayDu).toBe("Buổi 1");
    expect(ds[1]!.nhanDayDu).toBe("Buổi 2 - Ôn tập giữa khoá");
  });

  it("hai lớp đánh số ĐỘC LẬP nhau", () => {
    const ds = dungDanhSachBuoi(
      [
        { id: "x1", classId: "A", date: buoiToi("2026-09-01"), status: "SCHEDULED" },
        { id: "y1", classId: "B", date: buoiToi("2026-09-02"), status: "SCHEDULED" },
        { id: "x2", classId: "A", date: buoiToi("2026-09-08"), status: "SCHEDULED" },
      ],
      new Date("2026-09-10T00:00:00.000Z"),
    );
    expect(Object.fromEntries(ds.map((b) => [b.id, b.soBuoi]))).toEqual({
      x1: 1,
      x2: 2,
      y1: 1,
    });
  });

  it("xếp theo ngày tăng dần dù đầu vào lộn xộn", () => {
    const ds = dungDanhSachBuoi(
      [hang("c", "2026-09-15"), hang("a", "2026-09-01"), hang("b", "2026-09-08")],
      new Date("2026-09-20T00:00:00.000Z"),
    );
    expect(ds.map((b) => b.id)).toEqual(["a", "b", "c"]);
  });
});

describe("dungDanhSachBuoi — nhãn buổi", () => {
  it("tên bài mang sẵn tiền tố học phần → tách đúng chỗ, không in lặp", () => {
    const ds = dungDanhSachBuoi(
      [hang("s", "2026-09-01", { lesson: { order: 9, title: "HP2 - Họa Sĩ Robot" } })],
      new Date("2026-09-02T00:00:00.000Z"),
    );
    expect(ds[0]!.tieuDe).toBe("Họa Sĩ Robot");
    // 08/09 — ĐỔI KỲ VỌNG cùng bản vá "lệch tên bài": số in ra là số LỘ TRÌNH
    // (`lesson.order = 9`), KHÔNG còn là hạng theo ngày (buổi duy nhất ⇒ hạng 1).
    // Đúng đây là điều cần: buổi này dạy BÀI 9, in "Buổi 1" là nói sai với phụ huynh.
    expect(ds[0]!.nhanDayDu).toBe("Buổi 9 - HP2 - Họa Sĩ Robot");
    // Nhưng SỐ THỨ TỰ trong danh sách vẫn theo ngày — hai con số tách bạch.
    expect(ds[0]!.soBuoi).toBe(1);
  });

  it('ô trống "Buổi N" của ClassSessionPlan không thắng tên bài thật', () => {
    const ds = dungDanhSachBuoi(
      [
        hang("s", "2026-09-01", {
          plan: { customTitle: "Buổi 7" },
          lesson: { order: 7, title: "Bàn Tay Ma Thuật" },
        }),
      ],
      new Date("2026-09-02T00:00:00.000Z"),
    );
    expect(ds[0]!.tieuDe).toBe("Bàn Tay Ma Thuật");
  });
});

describe("dungDanhSachBuoi — mốc thời gian tính theo LỊCH VN", () => {
  it('buổi 18:00 VN ngày 06/09, xem lúc 01:00 VN ngày 07/09 ⇒ KHÔNG phải "hôm nay"', () => {
    // Cùng ngày 06 theo UTC, khác ngày theo VN. `getDate()`/`toDateString()` của mã cũ
    // chạy trên Vercel (UTC) sẽ trả lời SAI ở đúng ca này.
    const ds = dungDanhSachBuoi(
      [{ id: "s", classId: L, date: new Date("2026-09-06T11:00:00.000Z"), status: "SCHEDULED" }],
      new Date("2026-09-06T18:00:00.000Z"),
    );
    expect(ds[0]!.homNay).toBe(false);
    expect(ds[0]!.daDienRa).toBe(true);
  });

  it("buổi tối cùng ngày VN ⇒ homNay = true dù giờ UTC đã khác", () => {
    const ds = dungDanhSachBuoi(
      [{ id: "s", classId: L, date: new Date("2026-09-06T12:00:00.000Z"), status: "SCHEDULED" }],
      new Date("2026-09-06T02:00:00.000Z"), // 09:00 VN cùng ngày
    );
    expect(ds[0]!.homNay).toBe(true);
    expect(ds[0]!.daDienRa).toBe(false); // chưa tới giờ học
  });

  it("buổi ĐÃ HUỶ không bao giờ tính là đã diễn ra", () => {
    const ds = dungDanhSachBuoi(
      [hang("s", "2026-09-01", { status: "CANCELLED" })],
      new Date("2026-09-10T00:00:00.000Z"),
    );
    expect(ds[0]!.daHuy).toBe(true);
    expect(ds[0]!.daDienRa).toBe(false);
  });
});

describe("chonMocBuoi", () => {
  const now = new Date("2026-09-08T02:00:00.000Z"); // 09:00 VN 08/09
  const ds = dungDanhSachBuoi(
    [
      hang("b1", "2026-09-01"),
      hang("b2", "2026-09-04", { status: "CANCELLED" }),
      hang("b3", "2026-09-08"), // hôm nay 19:00 VN, chưa tới giờ
      hang("b4", "2026-09-15"),
    ],
    now,
  );

  it("buổi hôm nay được ưu tiên làm buổi hiện tại", () => {
    const m = chonMocBuoi(ds);
    expect(m.homNay?.id).toBe("b3");
    expect(m.hienTai?.id).toBe("b3");
  });

  it("gần nhất/tiếp theo bỏ qua buổi đã huỷ", () => {
    const m = chonMocBuoi(ds);
    expect(m.ganNhat?.id).toBe("b1"); // KHÔNG phải b2 (đã huỷ)
    expect(m.tiepTheo?.id).toBe("b3");
  });

  it("không có buổi hôm nay ⇒ hiện tại là buổi vừa học xong", () => {
    const m = chonMocBuoi(
      dungDanhSachBuoi(
        [hang("a", "2026-09-01"), hang("b", "2026-09-15")],
        new Date("2026-09-08T02:00:00.000Z"),
      ),
    );
    expect(m.homNay).toBeNull();
    expect(m.hienTai?.id).toBe("a");
    expect(m.tiepTheo?.id).toBe("b");
  });

  it("lớp chưa khai giảng ⇒ hiện tại là buổi sắp tới", () => {
    const m = chonMocBuoi(
      dungDanhSachBuoi([hang("a", "2026-10-01")], new Date("2026-09-08T02:00:00.000Z")),
    );
    expect(m.ganNhat).toBeNull();
    expect(m.hienTai?.id).toBe("a");
  });

  it("lớp chưa có buổi nào ⇒ mọi mốc đều null (không nổ)", () => {
    expect(chonMocBuoi([])).toEqual({
      homNay: null,
      ganNhat: null,
      tiepTheo: null,
      hienTai: null,
    });
  });

  it("buổi hôm nay đã tan vẫn là buổi hôm nay", () => {
    const m = chonMocBuoi(
      dungDanhSachBuoi(
        [hang("a", "2026-09-08"), hang("b", "2026-09-15")],
        new Date("2026-09-08T15:00:00.000Z"), // 22:00 VN, lớp 19:00 đã tan
      ),
    );
    expect(m.homNay?.id).toBe("a");
    expect(m.hienTai?.id).toBe("a");
  });
});

describe("demBuoi — mẫu số khớp lib/attendance/summary.ts", () => {
  it("buổi huỷ không nằm trong tổng lẫn trong đã-diễn-ra", () => {
    const ds = dungDanhSachBuoi(
      [
        hang("a", "2026-09-01"),
        hang("b", "2026-09-04", { status: "CANCELLED" }),
        hang("c", "2026-09-08"),
        hang("d", "2026-09-15"),
      ],
      new Date("2026-09-10T00:00:00.000Z"),
    );
    expect(demBuoi(ds)).toEqual({ tong: 3, daDienRa: 2, conLai: 1 });
  });

  it("danh sách rỗng ⇒ toàn số 0, không chia cho 0", () => {
    expect(demBuoi([])).toEqual({ tong: 0, daDienRa: 0, conLai: 0 });
  });
});
