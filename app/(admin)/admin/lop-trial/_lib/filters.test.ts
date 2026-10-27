// GĐ2 — [LT-U-02] / [LT-U-03] / [LT-S-09 phần thuần].
//
// Bộ này khoá đúng ba thứ dễ vỡ nhất của màn mới:
//  1. Chế độ lọc mặc định phải ẩn đúng những gì màn cũ ẩn — bớt một điều kiện là
//     người dùng thấy lead lẽ ra đã đóng, thừa một điều kiện là "sao mất lead".
//  2. Bấm chip lọc rồi gõ tìm phải cộng dồn chứ không ghi đè nhau.
//  3. Ngày buổi học ghi vào cột `@db.Date` phải là UTC-midnight BẤT KỂ múi giờ tiến
//     trình. Đây là bug "chạy máy tôi thì được" đã có tiền lệ trong repo.
import { describe, it, expect } from "vitest";
import {
  buildClassListWhere,
  buildBookingListWhere,
  docLocLop,
  ngayVnSangUtc,
} from "./filters";
import { trangThaiLop } from "@/lib/trial/trang-thai-lop";

describe("[LT-U-02] where danh sách lớp trải nghiệm (23/09: lọc theo trạng thái HIỂN THỊ)", () => {
  const HOM_NAY = new Date(Date.UTC(2026, 8, 23));

  it("mặc định 'Đang mở' → chưa xong/huỷ VÀ (lớp cũ HOẶC ngày lớp chưa qua)", () => {
    expect(buildClassListWhere(undefined, undefined, HOM_NAY)).toEqual({
      AND: [
        { status: { notIn: ["COMPLETED", "CANCELLED"] } },
        { OR: [{ theoKhung: false }, { startDate: null }, { startDate: { gte: HOM_NAY } }] },
      ],
    });
  });

  it("'da-dong' → COMPLETED hoặc lớp theo khung ngày đã qua, trừ đã huỷ", () => {
    expect(buildClassListWhere("da-dong", undefined, HOM_NAY)).toEqual({
      AND: [
        { status: { not: "CANCELLED" } },
        { OR: [{ status: "COMPLETED" }, { theoKhung: true, startDate: { lt: HOM_NAY } }] },
      ],
    });
  });

  it("'all' → không lọc trạng thái", () => {
    expect(buildClassListWhere("all", undefined, HOM_NAY)).toEqual({});
  });

  it("link cũ (?status=CANCELLED / COMPLETED / OPEN) vẫn hiểu được", () => {
    expect(docLocLop("CANCELLED")).toBe("da-huy");
    expect(docLocLop("COMPLETED")).toBe("da-dong");
    expect(docLocLop("OPEN")).toBe("dang-mo");
  });

  it("trạng thái rác → rơi về 'Đang mở', không ném lỗi", () => {
    // URL do người dùng gõ tay được, không tin được.
    expect(docLocLop("KHONG_CO_THAT")).toBe("dang-mo");
  });

  it("ô tìm CỘNG DỒN với bộ lọc (AND), không ghi đè", () => {
    expect(buildClassListWhere("da-huy", " robo ", HOM_NAY)).toEqual({
      AND: [
        { status: "CANCELLED" },
        {
          OR: [
            { name: { contains: "robo", mode: "insensitive" } },
            { code: { contains: "robo", mode: "insensitive" } },
          ],
        },
      ],
    });
  });

  it("ô tìm toàn khoảng trắng coi như bỏ trống", () => {
    expect(buildClassListWhere("all", "   ", HOM_NAY)).toEqual({});
  });
});

describe("[TTL-LOC] bộ lọc và nhãn trạng thái nói CÙNG một luật", () => {
  // Với mỗi hình dạng lớp: nhãn `trangThaiLop` in ra phải khớp ĐÚNG MỘT chip trả nó về.
  // Lệch là lớp mang nhãn "Đã đóng" mà nằm trong chip "Đang mở" (hoặc biến mất khỏi cả hai).
  const HOM_NAY = new Date(Date.UTC(2026, 8, 23));
  const CA: Array<{ status: string; theoKhung: boolean; ngay: string | null }> = [
    { status: "OPEN", theoKhung: true, ngay: "2026-09-27" },
    { status: "OPEN", theoKhung: true, ngay: "2026-09-23" },
    { status: "OPEN", theoKhung: true, ngay: "2026-09-22" },
    { status: "RUNNING", theoKhung: true, ngay: "2026-09-01" },
    { status: "CANCELLED", theoKhung: true, ngay: "2026-09-01" },
    { status: "OPEN", theoKhung: false, ngay: "2026-08-11" },
    { status: "COMPLETED", theoKhung: false, ngay: null },
  ];
  type Ban = { status: string; theoKhung: boolean; startDate: Date | null };
  // Đánh giá `where` trên một bản ghi — đủ cho đúng các toán tử bộ lọc đang dùng.
  function khop(w: unknown, r: Ban): boolean {
    const o = w as Record<string, unknown>;
    if (Array.isArray(o.AND)) return o.AND.every((x) => khop(x, r));
    if (Array.isArray(o.OR)) return o.OR.some((x) => khop(x, r));
    return Object.entries(o).every(([k, v]) => {
      const gt = (r as unknown as Record<string, unknown>)[k];
      if (v !== null && typeof v === "object" && !(v instanceof Date)) {
        const op = v as Record<string, unknown>;
        if ("notIn" in op) return !(op.notIn as unknown[]).includes(gt);
        if ("not" in op) return gt !== op.not;
        if ("gte" in op) return gt instanceof Date && gt.getTime() >= (op.gte as Date).getTime();
        if ("lt" in op) return gt instanceof Date && gt.getTime() < (op.lt as Date).getTime();
        throw new Error(`toán tử lạ: ${Object.keys(op).join(",")}`);
      }
      return gt === v;
    });
  }
  for (const c of CA) {
    it(`${c.status} · theoKhung=${c.theoKhung} · ${c.ngay ?? "không ngày"}`, () => {
      const nhan = trangThaiLop({ status: c.status, theoKhung: c.theoKhung, ngayLop: c.ngay, homNay: "2026-09-23" });
      const r: Ban = {
        status: c.status,
        theoKhung: c.theoKhung,
        startDate: c.ngay ? new Date(`${c.ngay}T00:00:00.000Z`) : null,
      };
      const chip = { DANG_MO: "dang-mo", DA_DONG: "da-dong", DA_HUY: "da-huy" }[nhan];
      for (const loc of ["dang-mo", "da-dong", "da-huy"]) {
        expect(khop(buildClassListWhere(loc, undefined, HOM_NAY), r), `chip ${loc}`).toBe(loc === chip);
      }
    });
  }
});

describe("[LT-U-03] where lịch hẹn học thử giữ đúng luật ẩn của màn cũ", () => {
  it("mặc định: ẩn buổi đã chốt/từ chối VÀ ẩn lead đã rời phễu", () => {
    const w = buildBookingListWhere(undefined, {});
    expect(w.status).toEqual({ notIn: ["ENROLLED", "REJECTED"] });
    expect(w.lead).toEqual({
      deletedAt: null,
      status: { notIn: ["DA_DANG_KY", "DA_MAT"] },
    });
  });

  it("'all': chỉ còn ràng buộc lead chưa xoá mềm", () => {
    const w = buildBookingListWhere("all", {});
    expect(w.status).toBeUndefined();
    expect(w.lead).toEqual({ deletedAt: null });
  });

  it("lead xoá mềm LUÔN bị ẩn ở mọi chế độ", () => {
    // Xoá lead là soft-delete nên cascade không chạy, buổi cũ vẫn nằm lại trong bảng.
    for (const s of [undefined, "all", "SCHEDULED", "ATTENDED"]) {
      const w = buildBookingListWhere(s, {});
      expect((w.lead as { deletedAt: null }).deletedAt).toBeNull();
    }
  });

  it("chọn một trạng thái cụ thể thì KHÔNG ẩn lead rời phễu nữa", () => {
    // Cố ý: người dùng chủ động lọc "Đã chốt" thì phải thấy được lead đã ghi danh.
    const w = buildBookingListWhere("ENROLLED", {});
    expect(w.status).toBe("ENROLLED");
    expect(w.lead).toEqual({ deletedAt: null });
  });

  it("giáo viên thuần bị ép chỉ thấy buổi của mình", () => {
    expect(buildBookingListWhere(undefined, { ownTeacherId: "gv-1" }).teacherId).toBe("gv-1");
  });

  it("người kiêm nhiệm không bị ép own-rows", () => {
    expect(buildBookingListWhere(undefined, { ownTeacherId: null }).teacherId).toBeUndefined();
  });

  it("[LOC-PII] thiếu quyền xem SĐT ⇒ nhánh tìm theo SĐT BIẾN MẤT (fail-closed)", () => {
    // 🔴 LỖ HỔNG PHỦ TEST, tìm thấy 18/09/2026 trong lượt rà sau hợp nhất.
    //
    // Cổng S-1 ở đây là `opts.canSearchPhone === true ? [...] : []`. Trước ca này, bộ
    // test CHỈ thử nhánh `true` — nên cấy `true ?` (bỏ hẳn cổng, ai cũng tìm được theo
    // SĐT) KHÔNG làm ca nào đỏ. Cổng có mặt trong mã nhưng KHÔNG có khoá; mất nó trong
    // một lượt hợp nhất sau là mất im lặng, đúng lớp lỗi của 16/09.
    //
    // Rò ở đây là rò GIÁN TIẾP: màn không IN số nào, nhưng gõ đủ số vào ô tìm rồi xem
    // dòng nào hiện ra là đọc được SĐT bằng phép thử nhị phân.
    for (const opts of [
      { q: "0905123456" }, // không khai ⇒ fail-closed
      { q: "0905123456", canSearchPhone: false },
    ]) {
      const w = buildBookingListWhere(undefined, opts);
      const lead = w.lead as { OR?: { phone?: unknown }[] };
      expect(lead.OR, JSON.stringify(opts)).toHaveLength(2);
      expect(
        (lead.OR ?? []).some((v) => "phone" in v),
        `${JSON.stringify(opts)}: KHÔNG được có nhánh \`phone\` khi thiếu quyền xem SĐT`,
      ).toBe(false);
    }
  });

  it("ô tìm phủ 3 nhánh mà KHÔNG làm mất điều kiện lead của chế độ mặc định", () => {
    // `canSearchPhone: true` — chốt S-1 (26/08) gác nhánh SĐT sau quyền xem PII, mặc
    // định fail-closed. Ca này đo "ô tìm phủ đủ ba nhánh", nên phải mở cổng ra mới đo
    // được; ca gác quyền nằm ở `lib/lead/lead-pii-callsites.test.ts`.
    const w = buildBookingListWhere(undefined, { q: "Hương", canSearchPhone: true });
    const lead = w.lead as {
      deletedAt: null;
      status?: unknown;
      OR?: unknown[];
    };
    // Đây là chỗ dễ sai nhất: gán đè `where.lead` là mất luôn bộ lọc rời-phễu.
    expect(lead.deletedAt).toBeNull();
    expect(lead.status).toEqual({ notIn: ["DA_DANG_KY", "DA_MAT"] });
    expect(lead.OR).toHaveLength(3);
  });
});

describe("ngày buổi học ghi vào cột @db.Date", () => {
  it("trả đúng UTC-midnight của ngày VN", () => {
    expect(ngayVnSangUtc("2026-09-05")?.toISOString()).toBe("2026-09-05T00:00:00.000Z");
  });

  it("bất biến với múi giờ của tiến trình", () => {
    // Vercel chạy UTC, máy dev +07. `new Date("2026-09-05")` lệch một ngày giữa hai
    // nơi; hàm này phải cho cùng kết quả ở cả hai.
    const goc = process.env.TZ;
    try {
      for (const tz of ["UTC", "Asia/Ho_Chi_Minh", "America/Los_Angeles"]) {
        process.env.TZ = tz;
        expect(ngayVnSangUtc("2026-09-05")?.toISOString()).toBe("2026-09-05T00:00:00.000Z");
      }
    } finally {
      process.env.TZ = goc;
    }
  });

  it("sai định dạng → null, không ném lỗi", () => {
    expect(ngayVnSangUtc("05/09/2026")).toBeNull();
    expect(ngayVnSangUtc("")).toBeNull();
    expect(ngayVnSangUtc("2026-9-5")).toBeNull();
  });
});
