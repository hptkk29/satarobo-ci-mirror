// Ca [NKT-*] — CHUÔNG NHẮC KẾ TOÁN hằng ngày: lần thu chờ xuất hoá đơn, đếm theo cơ sở. THUẦN.
//
// PLAN Q-mở 7 để mặc định "có" (dùng lại cron `payment-reconcile`). Người chạy: `nhac-ke-toan-db.ts`.
// Luật "dòng nào là chờ xuất" KHÔNG viết lại ở đây — dòng đến từ `napHangChoHoaDon` (cùng loader của
// màn), hàm này chỉ đếm dòng đã nằm ở ngăn "Chờ xuất" và chia người nhận.
import { describe, it, expect } from "vitest";
import { classifyNotification } from "@/lib/notifications/catalog";
import { kiemPii } from "@/lib/notifications/pii";
import {
  demChoTheoCoSo,
  dungThongBaoNhac,
  HREF_NHAC,
  NGAN_NHAC,
  TIEN_TO_NHAC,
  type DemCoSo,
  type NguoiNhanNhac,
} from "./nhac-ke-toan";
import type { NganHangCho } from "./dong-hang-cho";

const dong = (orderId: string, ngan: NganHangCho, ten: string) => ({ orderId, ngan, coSo: { ma: null, ten } });
const NGAY = "2026-09-28";

describe("[NKT-01] chỉ đếm dòng ở ngăn 'Chờ xuất'", () => {
  it("ngăn đếm là đúng `cho` — nhãn 'Chờ xuất' của màn", () => {
    expect(NGAN_NHAC).toEqual(["cho"]);
  });

  it("dòng lệch / đã tải tệp / đã xuất / không xuất / đơn huỷ / cần điều chỉnh KHÔNG vào số", () => {
    const coSo = new Map([["o1", "cs1"]]);
    const ds = (["cho", "lech", "nhap", "da-xuat", "khong-xuat", "don-huy", "can-dieu-chinh", "cho"] as const).map((n) =>
      dong("o1", n, "Cơ sở 1"),
    );
    expect(demChoTheoCoSo(ds, coSo)).toEqual([{ centerId: "cs1", ten: "Cơ sở 1", soLanThu: 2 }]);
  });
});

describe("[NKT-02] đếm theo cơ sở CỦA ĐƠN", () => {
  it("hai đơn hai cơ sở ⇒ hai nhóm; đơn không tra được cơ sở ⇒ bỏ (không đoán)", () => {
    const coSo = new Map([
      ["o1", "cs1"],
      ["o2", "cs2"],
      ["o3", "cs1"],
    ]);
    const kq = demChoTheoCoSo(
      [dong("o1", "cho", "Cơ sở 1"), dong("o2", "cho", "Cơ sở 2"), dong("o3", "cho", "Cơ sở 1"), dong("o9", "cho", "?")],
      coSo,
    );
    expect(kq).toEqual([
      { centerId: "cs1", ten: "Cơ sở 1", soLanThu: 2 },
      { centerId: "cs2", ten: "Cơ sở 2", soLanThu: 1 },
    ]);
  });
});

const DEM: DemCoSo[] = [
  { centerId: "cs1", ten: "Cơ sở 1", soLanThu: 3 },
  { centerId: "cs2", ten: "Cơ sở 2", soLanThu: 2 },
];
const KT_CS1: NguoiNhanNhac = { userId: "kt1", phamVi: ["cs1"] };
const KT_CS2: NguoiNhanNhac = { userId: "kt2", phamVi: ["cs2"] };
const KT_HO: NguoiNhanNhac = { userId: "ktho", phamVi: "ALL" };

describe("[NKT-03] mỗi kế toán chỉ nhận thông báo cơ sở MÌNH; kế toán Hội sở nhận MỘT bản tổng", () => {
  it("kế toán CS1 nhận bản CS1 (3), CS2 nhận bản CS2 (2), Hội sở nhận bản tổng (5)", () => {
    const tb = dungThongBaoNhac({ dem: DEM, nguoiNhan: [KT_CS1, KT_CS2, KT_HO], ngay: NGAY });
    const cua = (u: string) => tb.filter((t) => t.userIds.includes(u));
    expect(cua("kt1").map((t) => t.dedupeKey)).toEqual([`${TIEN_TO_NHAC}cs1:${NGAY}`]);
    expect(cua("kt1")[0]!.body).toContain("3 lần thu");
    expect(cua("kt1")[0]!.body).not.toContain("Cơ sở 2");
    expect(cua("kt2").map((t) => t.dedupeKey)).toEqual([`${TIEN_TO_NHAC}cs2:${NGAY}`]);
    expect(cua("ktho").map((t) => t.dedupeKey)).toEqual([`${TIEN_TO_NHAC}tong:${NGAY}`]);
    expect(cua("ktho")[0]!.body).toContain("5 lần thu");
    expect(cua("ktho")[0]!.body).toContain("Cơ sở 1: 3");
    expect(cua("ktho")[0]!.body).toContain("Cơ sở 2: 2");
  });

  it("kế toán Hội sở KHÔNG nhận thêm bản theo từng cơ sở (tránh ba chuông cho cùng một việc)", () => {
    const tb = dungThongBaoNhac({ dem: DEM, nguoiNhan: [KT_HO], ngay: NGAY });
    expect(tb.map((t) => t.dedupeKey)).toEqual([`${TIEN_TO_NHAC}tong:${NGAY}`]);
  });

  it("kế toán neo ở khối nhiều cơ sở ⇒ một bản cho mỗi cơ sở trong phạm vi", () => {
    const tb = dungThongBaoNhac({ dem: DEM, nguoiNhan: [{ userId: "ktv", phamVi: ["cs1", "cs2"] }], ngay: NGAY });
    expect(tb.map((t) => t.dedupeKey).sort()).toEqual([`${TIEN_TO_NHAC}cs1:${NGAY}`, `${TIEN_TO_NHAC}cs2:${NGAY}`]);
  });

  it("phạm vi RỖNG ⇒ không nhận gì (fail-closed, không rơi về tổng)", () => {
    expect(dungThongBaoNhac({ dem: DEM, nguoiNhan: [{ userId: "x", phamVi: [] }], ngay: NGAY })).toEqual([]);
  });

  it("một người nằm hai lần trong danh sách nhận ⇒ userIds không trùng", () => {
    const tb = dungThongBaoNhac({ dem: DEM, nguoiNhan: [KT_CS1, KT_CS1], ngay: NGAY });
    expect(tb[0]!.userIds).toEqual(["kt1"]);
  });
});

describe("[NKT-04] không có gì chờ ⇒ không chuông", () => {
  it("cơ sở 0 lần thu ⇒ không bản cho cơ sở đó; tổng 0 ⇒ không bản nào", () => {
    const dem: DemCoSo[] = [
      { centerId: "cs1", ten: "Cơ sở 1", soLanThu: 0 },
      { centerId: "cs2", ten: "Cơ sở 2", soLanThu: 2 },
    ];
    const tb = dungThongBaoNhac({ dem, nguoiNhan: [KT_CS1, KT_CS2, KT_HO], ngay: NGAY });
    expect(tb.map((t) => t.dedupeKey).sort()).toEqual([`${TIEN_TO_NHAC}cs2:${NGAY}`, `${TIEN_TO_NHAC}tong:${NGAY}`]);
    expect(dungThongBaoNhac({ dem: [], nguoiNhan: [KT_CS1, KT_HO], ngay: NGAY })).toEqual([]);
  });

  it("cơ sở có việc mà không ai là kế toán của nó ⇒ không bản rỗng người nhận (Hội sở vẫn thấy trong tổng)", () => {
    const tb = dungThongBaoNhac({ dem: DEM, nguoiNhan: [KT_CS1, KT_HO], ngay: NGAY });
    expect(tb.every((t) => t.userIds.length > 0)).toBe(true);
    expect(tb.map((t) => t.dedupeKey)).not.toContain(`${TIEN_TO_NHAC}cs2:${NGAY}`);
  });
});

describe("[NKT-05] khoá chống trùng theo NGÀY, khai trong catalog, trỏ đúng ngăn", () => {
  it("mọi khoá mang ngày + khớp mục catalog (việc cần làm, mức thường, thanh toán)", () => {
    const tb = dungThongBaoNhac({ dem: DEM, nguoiNhan: [KT_CS1, KT_CS2, KT_HO], ngay: NGAY });
    expect(tb.length).toBe(3);
    for (const t of tb) {
      expect(t.dedupeKey.startsWith(TIEN_TO_NHAC)).toBe(true);
      expect(t.dedupeKey.endsWith(`:${NGAY}`)).toBe(true);
      expect(classifyNotification(t.dedupeKey)).toEqual({
        groupKey: "action_required",
        priority: 2,
        entityType: "payment",
        known: true,
      });
      expect(t.href).toBe(HREF_NHAC);
    }
    expect(HREF_NHAC).toBe("/payments/hoa-don?ngan=cho");
  });

  it("nội dung KHÔNG mang số tiền / SĐT — chuông mở giữa chỗ đông người", () => {
    for (const t of dungThongBaoNhac({ dem: DEM, nguoiNhan: [KT_CS1, KT_HO], ngay: NGAY })) {
      const pii = kiemPii(`${t.title}\n${t.body}`);
      expect(pii.coSdt).toBe(false);
      expect(pii.coTien).toBe(false);
    }
  });
});
