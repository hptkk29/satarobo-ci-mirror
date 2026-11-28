// Ca [POS2-NK-01] · [POS2-NK-05] — BỘ LỌC màn tra cứu Nhật ký kiểm thẻ POS (THUẦN) + ai vào được màn.
//
// Thiết kế: docs/pos-gd2-thiet-ke.md §7 (U17). Bộ lọc chỉ là BỘ LỌC — cách ly cơ sở vẫn do `scopedDb`
// (`[POS2-NK-03]`, Postgres thật). Đồng hồ ĐÓNG BĂNG (luật 19).
import { describe, it, expect } from "vitest";
import { PosCheckLogKind, PosCheckTrigger } from "@prisma/client";
import { sinhMa } from "@/lib/payments/ma-phieu";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ROLE_SEED } from "../../../prisma/seed-roles";
import {
  docLocNhatKy,
  NHAN_KET_QUA,
  NHAN_NGUON,
  TRAN_DONG_NHAT_KY,
  TRAN_KHOANG_NGAY,
  whereNhatKy,
} from "./nhat-ky-loc";

/** 06/10/2026 17:00 giờ VN. */
const NOW = new Date("2026-10-06T10:00:00Z");
const CO_SO = ["cs1", "cs2"];
const MA = sinhMa(1_234);

describe("[POS2-NK-01] docLocNhatKy — tham số URL ⇒ bộ lọc an toàn", () => {
  it("mặc định: hôm nay giờ VN cả hai đầu; mọi bộ lọc khác trống; không cảnh báo", () => {
    expect(docLocNhatKy({}, NOW, CO_SO)).toEqual({ tu: "2026-10-06", den: "2026-10-06", coSo: null, nguon: null, ketQua: null, ma: null, canhBao: [] });
    // 23:30 VN = 16:30Z vẫn là ngày 06; 00:05 VN ngày 07 = 17:05Z ngày 06.
    expect(docLocNhatKy({}, new Date("2026-10-06T17:05:00Z"), CO_SO).tu).toBe("2026-10-07");
  });

  it("ngày hỏng ⇒ hôm nay VN; den < tu ⇒ đổi chỗ", () => {
    expect(docLocNhatKy({ tu: "2026-02-30", den: "x" }, NOW, CO_SO)).toMatchObject({ tu: "2026-10-06", den: "2026-10-06" });
    expect(docLocNhatKy({ tu: "2026-10-06", den: "2026-10-01" }, NOW, CO_SO)).toMatchObject({ tu: "2026-10-01", den: "2026-10-06" });
  });

  it(`khoảng > ${TRAN_KHOANG_NGAY} ngày ⇒ cắt còn ${TRAN_KHOANG_NGAY} ngày từ "tu" + cảnh báo nói rõ`, () => {
    const l = docLocNhatKy({ tu: "2026-09-01", den: "2026-10-06" }, NOW, CO_SO);
    expect(l).toMatchObject({ tu: "2026-09-01", den: "2026-10-01" });
    expect(l.canhBao).toHaveLength(1);
    expect(l.canhBao[0]).toMatch(/31 ngày/);
    // Đúng 31 ngày ⇒ không cắt.
    expect(docLocNhatKy({ tu: "2026-09-06", den: "2026-10-06" }, NOW, CO_SO).canhBao).toEqual([]);
  });

  it("nguồn / kết quả lạ ⇒ bỏ qua; hợp lệ ⇒ giữ", () => {
    expect(docLocNhatKy({ nguon: "HACKER", ketQua: "DROP" }, NOW, CO_SO)).toMatchObject({ nguon: null, ketQua: null });
    expect(docLocNhatKy({ nguon: "QUET_SACH", ketQua: "CACHE" }, NOW, CO_SO)).toMatchObject({ nguon: "QUET_SACH", ketQua: "CACHE" });
  });

  it("mã phiếu qua tachMaPos: chữ thường được; sai checksum / nhiều mã ⇒ cảnh báo, không lọc", () => {
    expect(docLocNhatKy({ ma: MA.toLowerCase() }, NOW, CO_SO)).toMatchObject({ ma: MA, canhBao: [] });
    const hong = MA.slice(0, 4) + (MA[4] === "A" ? "C" : "A");
    const l = docLocNhatKy({ ma: hong }, NOW, CO_SO);
    expect(l.ma).toBeNull();
    expect(l.canhBao).toEqual(["Mã phiếu không hợp lệ (5 ký tự, có kiểm tra)."]);
  });

  it("cơ sở NGOÀI danh sách chọn được ⇒ bỏ qua (cách ly vẫn do scopedDb)", () => {
    expect(docLocNhatKy({ coSo: "cs9" }, NOW, CO_SO).coSo).toBeNull();
    expect(docLocNhatKy({ coSo: "cs2" }, NOW, CO_SO).coSo).toBe("cs2");
    // Tham số lặp (mảng) ⇒ lấy phần tử đầu, không ném.
    expect(docLocNhatKy({ coSo: ["cs1", "cs2"] }, NOW, CO_SO).coSo).toBe("cs1");
  });
});

describe("[POS2-NK-01b] whereNhatKy — mốc giờ VN, đủ vế lọc", () => {
  it("khoảng ngày: từ 00:00 VN ngày đầu tới TRƯỚC 00:00 VN ngày sau ngày cuối", () => {
    expect(whereNhatKy(docLocNhatKy({ tu: "2026-10-05", den: "2026-10-06" }, NOW, CO_SO))).toEqual({
      createdAt: { gte: new Date("2026-10-05T00:00:00+07:00"), lt: new Date("2026-10-07T00:00:00+07:00") },
    });
  });

  it("cơ sở · nguồn · kết quả · mã phiếu", () => {
    const l = docLocNhatKy({ coSo: "cs1", nguon: "POLLER", ketQua: "PROVIDER_ERROR", ma: MA }, NOW, CO_SO);
    expect(whereNhatKy(l)).toEqual({
      createdAt: { gte: new Date("2026-10-06T00:00:00+07:00"), lt: new Date("2026-10-07T00:00:00+07:00") },
      centerId: "cs1",
      triggeredBy: "POLLER",
      kind: "PROVIDER_ERROR",
      intent: { code5: MA },
    });
  });

  it("nhãn tiếng Việt phủ ĐỦ mọi giá trị enum (thêm giá trị mới mà quên nhãn ⇒ đỏ); trần 500 dòng", () => {
    expect(Object.keys(NHAN_NGUON).sort()).toEqual(Object.values(PosCheckTrigger).sort());
    expect(Object.keys(NHAN_KET_QUA).sort()).toEqual(Object.values(PosCheckLogKind).sort());
    expect(NHAN_KET_QUA.CACHE).toMatch(/không hỏi máy/);
    expect(TRAN_DONG_NHAT_KY).toBe(500);
  });
});

describe("[POS2-NK-05] ai vào được màn nhật ký: `payments:import-pos` — đúng nhóm nhận chuông POS", () => {
  const coQuyen = (code: string, action: string) =>
    (ROLE_SEED.find((r) => r.code === code)?.perms ?? []).some((p) => p.action === action);

  it("v2: HO_ACCOUNTANT CÓ (GLOBAL) — người nhận chuông quét sạch / lỗi kết nối vào được màn chuông trỏ tới", () => {
    expect(ROLE_SEED.find((r) => r.code === "HO_ACCOUNTANT")?.perms.filter((p) => p.action === "payments:import-pos")).toEqual([
      { action: "payments:import-pos", scopeType: "GLOBAL" },
    ]);
  });

  it.each(["CENTER_SALES_CSM", "CENTER_MANAGER", "CENTER_ACCOUNTANT"])(
    "%s KHÔNG vào màn nhật ký — đối chứng: vai này CÓ quyền thu tiền (thấy nút thu thẻ / gắn tiền)",
    (code) => {
      expect(coQuyen(code, "payments:import-pos")).toBe(false);
      expect(coQuyen(code, "payments:pos-check") || coQuyen(code, "payments:record")).toBe(true);
    },
  );

  it("v1 (local/dev): SUPER_ADMIN + ACCOUNTANT", () => {
    const v1 = PERMISSIONS as Record<string, readonly string[]>;
    expect([...(v1["payments:import-pos"] ?? [])].sort()).toEqual(["ACCOUNTANT", "SUPER_ADMIN"]);
  });
});
