// Ca [NHIEM-*] — khoá đơn có dữ liệu hỏng. Thuần.
//
// Thứ đang canh KHÔNG chỉ là sổ sách: tiêu chí CON_NHÀ_KHÁC chặn một đường LỘ THÔNG TIN
// (mã QR / tin ZNS mang tên một đứa trẻ gửi cho gia đình không liên quan). Nên hai ca dễ
// sai nhất là: khoá sót (đơn hỏng vẫn phát QR) và khoá thừa (phạt nhầm phụ huynh đang
// muốn trả tiền).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  chanGuiRaNgoai,
  donNhiemDuLieu,
  donNhiemTheoDon,
  DON_SACH,
  MA_NHIEM,
  type ConTrenDon,
} from "./don-nhiem";

const em = (id: string, name: string, sdt: string | null): ConTrenDon => ({
  id,
  name,
  parentPhone: sdt,
});

/** Đúng hình dạng đơn ORD-260915-000007 trên satarobo_local. */
const DON_007 = {
  sdtDon: "84941000002",
  sdtLead: null,
  conCapDon: null,
  conTrenDong: [
    em("uat-hv-CS1-44", "Dương Duy Đạt", "84930000044"),
    em("uat-hv-CS2-25", "Bùi Thanh Thảo", "84930000150"),
  ],
  soKhoanChuaGan: 2,
  tienChuaGan: 5_234_000,
};

describe("[NHIEM-01] ca thật ORD-260915-000007 — hai con của hai nhà khác", () => {
  it("bắt được, và GỌI ĐÚNG TÊN cả hai em", () => {
    const r = donNhiemDuLieu(DON_007);
    expect(r.nhiem).toBe(true);
    expect(r.conNhaKhac).toEqual(["Dương Duy Đạt", "Bùi Thanh Thảo"]);
  });

  it("nêu ĐỦ hai lý do, NẶNG TRƯỚC", () => {
    expect(donNhiemDuLieu(DON_007).lyDo).toEqual([
      MA_NHIEM.CON_NHA_KHAC,
      MA_NHIEM.TIEN_CHUA_GAN,
    ]);
  });

  it("CHẶN gửi ra ngoài — đơn này đang có 3 QR ACTIVE", () => {
    expect(chanGuiRaNgoai(donNhiemDuLieu(DON_007))).toBe(true);
  });
});

describe("[NHIEM-02] KHOÁ THỪA cũng là lỗi — tiền chưa gắn KHÔNG chặn QR", () => {
  const chiThieuGan = {
    sdtDon: "84941000002",
    sdtLead: null,
    conCapDon: null,
    conTrenDong: [em("a", "Bé Sun", "84941000002")],
    soKhoanChuaGan: 3,
    tienChuaGan: 8_640_000,
  };

  it("vẫn tính là NHIỄM (sai sổ nội bộ)", () => {
    const r = donNhiemDuLieu(chiThieuGan);
    expect(r.nhiem).toBe(true);
    expect(r.lyDo).toEqual([MA_NHIEM.TIEN_CHUA_GAN]);
  });

  it("nhưng KHÔNG chặn QR/ZNS — phạt phụ huynh vì kế toán chưa đối soát là phạt nhầm người", () => {
    expect(chanGuiRaNgoai(donNhiemDuLieu(chiThieuGan))).toBe(false);
  });

  it("hai câu hỏi TÁCH RỜI: `nhiem` và `chanGuiRaNgoai` không được là một", () => {
    const r = donNhiemDuLieu(chiThieuGan);
    expect(r.nhiem).not.toBe(chanGuiRaNgoai(r));
  });
});

describe("[NHIEM-03] đơn SẠCH thì không dựng cờ", () => {
  it("con đúng nhà + không khoản treo ⇒ sạch", () => {
    const r = donNhiemDuLieu({
      sdtDon: "0941000002",
      sdtLead: null,
      conCapDon: em("a", "Bé Sun", "84941000002"), // khớp dù khác dạng SĐT
      conTrenDong: [em("b", "Bé mới 4", "0941000002")],
      soKhoanChuaGan: 0,
      tienChuaGan: 0,
    });
    expect(r).toEqual(DON_SACH);
    expect(chanGuiRaNgoai(r)).toBe(false);
  });

  it("đơn walk-in chưa có SĐT ⇒ KHÔNG khoá (cổng khác lo)", () => {
    const r = donNhiemDuLieu({
      sdtDon: "",
      sdtLead: null,
      conCapDon: null,
      conTrenDong: [em("x", "Em nào đó", "84930000044")],
      soKhoanChuaGan: 0,
      tienChuaGan: 0,
    });
    expect(r.nhiem).toBe(false);
  });

  it("SĐT của LEAD cũng được chấp nhận", () => {
    const r = donNhiemDuLieu({
      sdtDon: "0905000000",
      sdtLead: "84941000002",
      conCapDon: null,
      conTrenDong: [em("a", "Bé Sun", "84941000002")],
      soKhoanChuaGan: 0,
      tienChuaGan: 0,
    });
    expect(r.nhiem).toBe(false);
  });
});

describe("[NHIEM-04] con CẤP ĐƠN cũng bị soi, và không đếm hai lần", () => {
  it("`Order.studentId` sai ⇒ nhiễm (đây là cột PROD đang có)", () => {
    const r = donNhiemDuLieu({
      sdtDon: "84941000002",
      sdtLead: null,
      conCapDon: em("x1", "Em nhà khác", "84930000044"),
      conTrenDong: [],
      soKhoanChuaGan: 0,
      tienChuaGan: 0,
    });
    expect(r.conNhaKhac).toEqual(["Em nhà khác"]);
  });

  it("cùng một em ở CẢ cấp đơn LẪN dòng ⇒ chỉ gọi tên MỘT lần", () => {
    const x = em("x1", "Em nhà khác", "84930000044");
    const r = donNhiemDuLieu({
      sdtDon: "84941000002",
      sdtLead: null,
      conCapDon: x,
      conTrenDong: [x],
      soKhoanChuaGan: 0,
      tienChuaGan: 0,
    });
    expect(r.conNhaKhac).toEqual(["Em nhà khác"]);
  });
});

describe("[NHIEM-05] số trả ra luôn in được", () => {
  it("số âm / NaN không lọt ra banner", () => {
    for (const [n, t] of [[-5, -1], [Number.NaN, Number.NaN], [1.7, 1234.6]] as const) {
      const r = donNhiemDuLieu({
        sdtDon: "84941000002",
        sdtLead: null,
        conCapDon: null,
        conTrenDong: [],
        soKhoanChuaGan: n,
        tienChuaGan: t,
      });
      expect(r.soKhoanChuaGan).toBeGreaterThanOrEqual(0);
      expect(r.tienChuaGan).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(r.soKhoanChuaGan)).toBe(true);
      expect(Number.isFinite(r.tienChuaGan)).toBe(true);
    }
  });

  it("0,5 khoản không tồn tại — cắt về số nguyên", () => {
    const r = donNhiemDuLieu({
      sdtDon: "84941000002",
      sdtLead: null,
      conCapDon: null,
      conTrenDong: [],
      soKhoanChuaGan: 1.9,
      tienChuaGan: 100,
    });
    expect(r.soKhoanChuaGan).toBe(1);
    expect(r.nhiem).toBe(true);
  });
});

// ═══ [NHIEM-06] LOADER — một lượt cho cả tập, không N+1 ══════════════════════
describe("[NHIEM-06] donNhiemTheoDon", () => {
  function dbGia(don: unknown[], khoan: unknown[]) {
    const goi: string[] = [];
    return {
      goi,
      db: {
        order: {
          findMany: async () => {
            goi.push("order");
            return don;
          },
        },
        payment: {
          findMany: async (a: unknown) => {
            goi.push("payment");
            const w = (a as { where: { enrollmentId: null; deletedAt: null } }).where;
            // Câu tra PHẢI kẹp cả hai điều kiện — thiếu `enrollmentId: null` là đếm mọi
            // khoản, thiếu `deletedAt: null` là đếm cả khoản đã xoá sổ.
            if (w.enrollmentId !== null || w.deletedAt !== null) throw new Error("where sai");
            return khoan;
          },
        },
      } as Parameters<typeof donNhiemTheoDon>[0],
    };
  }

  it("tập rỗng ⇒ KHÔNG đi DB", async () => {
    const { goi, db } = dbGia([], []);
    expect((await donNhiemTheoDon(db, [])).size).toBe(0);
    expect(goi.length).toBe(0);
  });

  it("một trang nhiều đơn ⇒ ĐÚNG hai lượt tra", async () => {
    const { goi, db } = dbGia(
      [
        {
          id: "o1",
          customerPhone: "84941000002",
          student: null,
          lead: null,
          items: [{ student: em("x", "Em nhà khác", "84930000044") }],
        },
        {
          id: "o2",
          customerPhone: "84941000002",
          student: null,
          lead: null,
          items: [{ student: em("a", "Bé Sun", "84941000002") }],
        },
      ],
      [{ orderId: "o2", amount: 5_000_000 }],
    );
    const m = await donNhiemTheoDon(db, ["o1", "o2", "o1"]);
    expect(goi.sort()).toEqual(["order", "payment"]);
    expect(m.get("o1")?.lyDo).toEqual([MA_NHIEM.CON_NHA_KHAC]);
    expect(m.get("o2")?.lyDo).toEqual([MA_NHIEM.TIEN_CHUA_GAN]);
    expect(m.get("o2")?.tienChuaGan).toBe(5_000_000);
  });

  it("dòng KHÔNG khai học viên bị bỏ qua, không hoá 'con nhà khác'", async () => {
    // `OrderItem.studentId` null là giá trị HỢP LỆ (khách vãng lai) — coi nó là vi phạm
    // sẽ khoá nhầm gần như mọi đơn cũ.
    const { db } = dbGia(
      [{ id: "o1", customerPhone: "84941000002", student: null, lead: null, items: [{ student: null }] }],
      [],
    );
    expect((await donNhiemTheoDon(db, ["o1"])).get("o1")?.nhiem).toBe(false);
  });
});

// ⚠️ LƯỚI GHIM MÃ NGUỒN — bốn cổng phải CÓ MẶT.
// Cờ khoá suy-ra chỉ có giá trị khi có người HỎI nó. Một cổng bị gỡ thì đơn nhiễm lại
// phát QR / nhắn ra ngoài / đúc thành ghi danh, và KHÔNG test hành vi nào đỏ.
// Luật 11: neo hẹp, KHÔNG cờ `/s`, BỎ CHÚ THÍCH trước khi soi. Đã cấy lại để thấy đỏ.
describe("[NHIEM-07] lưới ghim: bốn cổng đã cắm", () => {
  const boChuThich = (x: string) =>
    x.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*/g, "$1");
  const doc = (p: string) =>
    boChuThich(readFileSync(resolve(process.cwd(), p), "utf8"));

  it("bộ bỏ chú thích thật sự bỏ được (lưới-canh-lưới)", () => {
    expect(boChuThich("a /* K */ b // D\nc")).not.toContain("K");
    expect(boChuThich("a /* K */ b // D\nc")).not.toContain("D");
  });

  it("CỔNG 1+2 — cả HAI đường phát QR đều gọi, không chỉ một", () => {
    const QR = doc("app/(admin)/admin/orders/_qr-core.ts");
    expect(QR.match(/chanNeuDonNhiem\(actor, req\.order\.id\)/g)?.length).toBe(2);
    // Cổng an toàn phải BỎ QUA scope — lọc theo tầm nhìn là coi đơn ngoài tầm là SẠCH.
    expect(QR).toMatch(/scopedDb\(actor, \{ bypass: true \}\)/);
  });

  it("CỔNG 3 — cả HAI cron nhắc nợ đều gọi", () => {
    const DEBT = doc("lib/finance/debt.ts");
    expect(DEBT.match(/donNhiemTheoDon\(db,/g)?.length).toBe(2);
    expect(DEBT.match(/chanGuiRaNgoai\(dn\)/g)?.length).toBe(2);
  });

  it("CỔNG 4 — chốt lead từ chối đơn nhiễm", () => {
    const CV = doc("lib/crm/convert-lead-v2.ts");
    expect(CV).toMatch(/donNhiemTheoDon\(db,/);
    expect(CV).toMatch(/code: "DON_NHIEM_DU_LIEU"/);
  });

  it("BANNER — trang đơn tính cờ và truyền xuống", () => {
    const PAGE = doc("app/(admin)/admin/orders/[id]/page.tsx");
    expect(PAGE).toMatch(/donNhiemTheoDon\(/);
    expect(PAGE).toMatch(/donNhiem=\{donNhiem\}/);
    const CLIENT = doc("app/(admin)/admin/orders/_components/order-detail-client.tsx");
    expect(CLIENT).toMatch(/<BannerDonNhiem d=\{donNhiem\} \/>/);
  });

  it("BANNER không dùng viền trái dày và không hex rời (DESIGN.md)", () => {
    const B = doc("app/(admin)/admin/orders/_components/banner-don-nhiem.tsx");
    expect(B).not.toMatch(/border-l-[248]/);
    expect(B).not.toMatch(/\[#[0-9a-fA-F]{3,8}\]/);
    // Màu đi qua token ngữ nghĩa, không mượn màu thương hiệu.
    expect(B).toMatch(/state-danger-soft/);
    expect(B).toMatch(/state-warning-soft/);
  });
});
