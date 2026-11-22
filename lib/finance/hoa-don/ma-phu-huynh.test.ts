// [MPH-*] Mã PHỤ HUYNH làm «Mã khách hàng» trên hoá đơn: `CS1-PH-AB3K9P` (chủ dự án 08/11/2026). Phần THUẦN + phần cấp mã với bản giả của DB.
// Hành vi trên Postgres thật (đua nhau, cùng phụ huynh ⇒ cùng mã, quyền sửa) ở `tests/finance/ghi-nguoi-mua-db.test.ts` [HDN-DB-15..23].
import { describe, expect, it, vi } from "vitest";
import { MA_KHACH_HANG } from "./form-nguoi-mua";
import { DANG_MA_PHU_HUYNH, capMaChoLeadMoi, dinhDangMaPhuHuynh, khoaSdtPhuHuynh, layHoacCapMaPhuHuynh, thanMaPhuHuynh } from "./ma-phu-huynh";

describe("[MPH-01] dạng mã", () => {
  it("CS1-PH-AB3K9P: mã cơ sở · PH · 6 ký tự không nhập nhằng; và qua được cổng định dạng «Mã khách hàng» của hoá đơn", () => {
    expect(dinhDangMaPhuHuynh("CS1", "AB3K9P")).toBe("CS1-PH-AB3K9P");
    expect(dinhDangMaPhuHuynh("cs2", "AB3K9P")).toBe("CS2-PH-AB3K9P");
    expect(DANG_MA_PHU_HUYNH.test("CS1-PH-AB3K9P")).toBe(true);
    expect(MA_KHACH_HANG.test("CS1-PH-AB3K9P")).toBe(true);
    for (const sai of ["CS1-26-AB3K9P", "CS1-PH-AB3K9", "CS1-PH-AB3K9PX", "CS1-PH-AB3K90", "CS1-PH-ab3k9p", "PH-AB3K9P"]) {
      expect(DANG_MA_PHU_HUYNH.test(sai), sai).toBe(false);
    }
  });
  it("thân ngẫu nhiên luôn đúng bộ ký tự (quét nhiều lần)", () => {
    for (let i = 0; i < 300; i++) expect(DANG_MA_PHU_HUYNH.test(dinhDangMaPhuHuynh("CS1", thanMaPhuHuynh()))).toBe(true);
  });
});

describe("[MPH-02] khoá nhận ra phụ huynh = SĐT dạng nội địa", () => {
  it("84…/+84…/0… cho CÙNG một khoá; ứng viên đầu không dùng được thì lấy ứng viên sau; không có ⇒ null", () => {
    expect(khoaSdtPhuHuynh("0905 123 477")).toBe("0905123477");
    expect(khoaSdtPhuHuynh("84905123477")).toBe("0905123477");
    expect(khoaSdtPhuHuynh("+84905123477")).toBe("0905123477");
    expect(khoaSdtPhuHuynh("", null, "0905123477")).toBe("0905123477");
    expect(khoaSdtPhuHuynh("khong-co", undefined, "")).toBeNull();
  });
});

type Dong = { centerId: string; orgUnitId: string | null; soDienThoai: string; ma: string };
function dbGia(opts: { maCoSo?: string | null; xungDotMa?: string[] } = {}) {
  const dong: Dong[] = [];
  const xung = [...(opts.xungDotMa ?? [])];
  return {
    dong,
    center: { findUnique: async () => ({ code: opts.maCoSo === undefined ? "CS1" : opts.maCoSo }) },
    maPhuHuynh: {
      findUnique: async (a: { where: { centerId_soDienThoai: { centerId: string; soDienThoai: string } } }) => {
        const k = a.where.centerId_soDienThoai;
        const r = dong.find((d) => d.centerId === k.centerId && d.soDienThoai === k.soDienThoai);
        return r ? { ma: r.ma } : null;
      },
      createMany: async (a: { data: Dong[] }) => {
        let count = 0;
        for (const d of a.data) {
          const trungMa = dong.some((x) => x.ma === d.ma) || xung.includes(d.ma); // mã đã thuộc phụ huynh KHÁC
          const trungKhoa = dong.some((x) => x.centerId === d.centerId && x.soDienThoai === d.soDienThoai);
          if (trungMa || trungKhoa) continue; // skipDuplicates = ON CONFLICT DO NOTHING
          dong.push(d);
          count++;
        }
        return { count };
      },
    },
  };
}

describe("[MPH-03] layHoacCapMaPhuHuynh", () => {
  it("lần đầu cấp mã dạng CS1-PH-…; lần sau CÙNG (cơ sở, SĐT) trả đúng mã đó; SĐT khác / cơ sở khác ⇒ mã khác", async () => {
    const c = dbGia();
    const a = await layHoacCapMaPhuHuynh(c, { centerId: "cs1", soDienThoai: "0905123477" });
    expect(a).toMatch(DANG_MA_PHU_HUYNH);
    expect(await layHoacCapMaPhuHuynh(c, { centerId: "cs1", soDienThoai: "0905123477" })).toBe(a);
    const b = await layHoacCapMaPhuHuynh(c, { centerId: "cs1", soDienThoai: "0905123478" });
    const d = await layHoacCapMaPhuHuynh(c, { centerId: "cs2", soDienThoai: "0905123477" });
    expect(new Set([a, b, d]).size).toBe(3);
    expect(c.dong).toHaveLength(3);
  });
  it("không có cơ sở hoặc không có SĐT ⇒ null và KHÔNG ghi gì", async () => {
    const c = dbGia();
    expect(await layHoacCapMaPhuHuynh(c, { centerId: null, soDienThoai: "0905123477" })).toBeNull();
    expect(await layHoacCapMaPhuHuynh(c, { centerId: "cs1", soDienThoai: null })).toBeNull();
    expect(c.dong).toHaveLength(0);
  });
  it("cơ sở thiếu Center.code ⇒ NÉM LỖI, không rơi về mã lệch dạng", async () => {
    await expect(layHoacCapMaPhuHuynh(dbGia({ maCoSo: null }), { centerId: "cs1", soDienThoai: "0905123477" })).rejects.toThrow(/chưa có mã/);
  });
  it("mã vừa sinh TRÙNG mã của phụ huynh khác ⇒ thử thân khác, không trả mã của người khác", async () => {
    const cuoi = "AAAAAA";
    const c = dbGia({ xungDotMa: [`CS1-PH-${cuoi}`] });
    // 31 ký tự: rand()=0 ⇒ 'A'; lần thử đầu ra AAAAAA (xung đột), lần sau rand cao ⇒ thân khác.
    let n = 0;
    const rand = () => (n++ < 6 ? 0 : 0.5);
    const ma = await layHoacCapMaPhuHuynh(c, { centerId: "cs1", soDienThoai: "0905123477" }, { rand });
    expect(ma).toMatch(DANG_MA_PHU_HUYNH);
    expect(ma).not.toBe(`CS1-PH-${cuoi}`);
  });
  it("hết lượt thử mà vẫn trùng ⇒ NÉM LỖI (không treo, không trả bậy)", async () => {
    const c = dbGia({ xungDotMa: ["CS1-PH-AAAAAA"] });
    await expect(layHoacCapMaPhuHuynh(c, { centerId: "cs1", soDienThoai: "0905123477" }, { rand: () => 0, toiDaLanThu: 3 })).rejects.toThrow(/nhiều lần thử/);
  });
});

describe("[MPH-04] capMaChoLeadMoi — lead vào là có mã; KHÔNG BAO GIỜ làm hỏng việc nhận lead", () => {
  it("đủ cơ sở + SĐT ⇒ cấp mã; SĐT dạng 84… và 0… ra cùng mã", async () => {
    const c = dbGia();
    const a = await capMaChoLeadMoi(c, { centerId: "cs1", phone: "84905123477" });
    expect(a).toMatch(DANG_MA_PHU_HUYNH);
    expect(await capMaChoLeadMoi(c, { centerId: "cs1", phone: "0905123477" })).toBe(a);
  });
  it("thiếu cơ sở / thiếu SĐT / cơ sở chưa có mã ⇒ null, không ghi gì, không ném", async () => {
    const c = dbGia({ maCoSo: null });
    expect(await capMaChoLeadMoi(c, { centerId: null, phone: "0905123477" })).toBeNull();
    expect(await capMaChoLeadMoi(c, { centerId: "cs1", phone: "" })).toBeNull();
    expect(await capMaChoLeadMoi(c, { centerId: "cs1", phone: "0905123477" })).toBeNull();
    expect(c.dong).toHaveLength(0);
  });
  it("DB giả ném lỗi ⇒ vẫn trả null, không ném — lead không được mất vì chuyện mã", async () => {
    const hong = {
      center: {
        findUnique: async () => {
          throw new Error("db sập");
        },
      },
      maPhuHuynh: {},
    } as never;
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(capMaChoLeadMoi(hong, { centerId: "cs1", phone: "0905123477" })).resolves.toBeNull();
    log.mockRestore();
  });
});
