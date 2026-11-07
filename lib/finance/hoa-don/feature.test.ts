// Ca [HDF-*] — CÔNG TẮC MÀN HOÁ ĐƠN ĐIỆN TỬ: nằm trong DB, mặc định TẮT, đọc ở đúng MỘT hàm.
//
// Chép khuôn `[FEAT-*]` (`lib/finance/feature.test.ts`) của công tắc thu học phí linh hoạt, vì
// cùng một bài học: cờ env `PAYMENT_LEDGER_V2` có trong mã, không có trên prod, 0 đường gọi —
// một cờ chết trông y như cờ sống. Kế hoạch: docs/ke-toan-hoa-don/PLAN.md §11 ("Cờ").
//
// Khác `billing.flexV1Enabled` ở một chỗ, có chủ đích: `centerOverridable: false`. Đo prod
// 25/09: chỉ MỘT người giữ quyền xác nhận (Kế toán Hội sở), không có kế toán cơ sở nào — không có
// ca "pilot một cơ sở" để phục vụ, còn công tắc theo cơ sở thì kéo theo việc mục sidebar phải biết
// cơ sở nào bật (một lời hứa suông nữa để canh). Cần thì mở sau.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { KHOA_HOA_DON, KHOA_HUB_CHINH_SACH, KHOA_HUB_QUET, KHOA_HUB_THI_DIEM, KHOA_MISA_PHAT_HANH } from "./feature";
import { SETTINGS } from "@/lib/settings/registry";
import { NHAN_VAN_HANH } from "@/lib/settings/nhan-van-hanh";
import { TTL_MAC_DINH_PHUT } from "./yeu-cau-nguoi-mua";

const TRAN_QUET_MS = 30_000;

describe("[HDF-01] khai báo công tắc", () => {
  it("khoá là `billing.hoaDonEnabled`", () => {
    expect(KHOA_HOA_DON).toBe("billing.hoaDonEnabled");
  });

  it("mặc định TẮT, KHÔNG cho cơ sở lệch, nhóm tài chính", () => {
    // Một mặc định `true` lọt vào đây là bật màn cho toàn prod ngay lần deploy kế tiếp.
    const d = SETTINGS[KHOA_HOA_DON];
    expect(d.default).toBe(false);
    expect(d.centerOverridable).toBe(false);
    expect(d.group).toBe("finance");
    expect(d.schema.safeParse(true).success).toBe(true);
    expect(d.schema.safeParse("true").success, "phải là boolean thật, không phải chuỗi").toBe(false);
  });

  it("có nhãn cho người vận hành ở tab Tiền, đánh dấu CẨN THẬN", () => {
    const n = NHAN_VAN_HANH[KHOA_HOA_DON];
    expect(n.tab).toBe("tien");
    expect(n.canThan).toBe(true);
    expect(n.ten.length).toBeGreaterThan(0);
  });
});

function bocChuThich(v: string): string {
  return v
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((d) => d.replace(/\/\/[^\n]*$/, ""))
    .join("\n");
}

describe("[HDF-02] LƯỚI: không ai đọc cờ ngoài `lib/finance/hoa-don/feature.ts`", () => {
  // `git ls-files` chứ không `readdirSync` — lý do đầy đủ ở `[FEAT-03]`: cây tệp sống có tệp tạm
  // thoáng qua trong lúc các worker khác chạy, lưới đỏ theo thứ không nằm trong repo.
  function quetMa(): { duong: string; noiDung: string }[] {
    const ra = execFileSync("git", ["ls-files", "--", "lib", "app", "components"], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
      .split(/\r?\n/)
      .filter((d) => /\.tsx?$/.test(d))
      .filter((d) => !/\.(test|spec)\.tsx?$/.test(d))
      .filter((d) => d !== "lib/finance/hoa-don/feature.ts")
      .filter((d) => d !== "lib/settings/registry.ts") // nơi KHAI khoá
      .filter((d) => d !== "lib/settings/nhan-van-hanh.ts") // nhãn cho người vận hành
      .filter((d) => existsSync(resolve(process.cwd(), d)))
      .map((d) => ({ duong: d, noiDung: bocChuThich(readFileSync(resolve(process.cwd(), d), "utf8")) }));
    expect(ra.length, "phép quét không đọc được tệp nào — `git ls-files` hỏng?").toBeGreaterThan(200);
    return ra;
  }

  it("0 tệp nào khác nhắc chuỗi khoá", { timeout: TRAN_QUET_MS }, () => {
    const viPham = quetMa()
      .filter((f) => f.noiDung.includes(KHOA_HOA_DON))
      .map((f) => f.duong);
    expect(viPham, `Đọc cờ ngoài lib/finance/hoa-don/feature.ts: ${viPham.join(", ")}`).toEqual([]);
  });

  it("[PHM-F2] khoá phát hành qua MISA (`hoaDon.misaPhatHanh`) cũng chỉ đọc ở feature.ts", { timeout: TRAN_QUET_MS }, () => {
    const viPham = quetMa()
      .filter((f) => f.noiDung.includes(KHOA_MISA_PHAT_HANH))
      .map((f) => f.duong);
    expect(viPham, `Đọc cờ MISA ngoài lib/finance/hoa-don/feature.ts: ${viPham.join(", ")}`).toEqual([]);
  });
});

describe("[CSF-01] công tắc khu Chính sách hoá đơn có phiên bản (Invoice Hub S7, 01/11/2026)", () => {
  it("khoá `hoaDon.hubChinhSach`, mặc định TẮT (TD-11), KHÔNG cho cơ sở lệch, boolean thật, có nhãn CẨN THẬN ở tab Tiền", () => {
    expect(KHOA_HUB_CHINH_SACH).toBe("hoaDon.hubChinhSach");
    const d = SETTINGS[KHOA_HUB_CHINH_SACH];
    expect(d.default).toBe(false);
    expect(d.centerOverridable).toBe(false);
    expect(d.schema.safeParse("true").success).toBe(false);
    const n = NHAN_VAN_HANH[KHOA_HUB_CHINH_SACH];
    expect(n.tab).toBe("tien");
    expect(n.canThan).toBe(true);
  });

  it("[CSF-02] cũng chỉ đọc ở feature.ts (lưới [HDF-02] mở rộng cho khoá mới)", { timeout: TRAN_QUET_MS }, () => {
    const ra = execFileSync("git", ["ls-files", "--", "lib", "app", "components"], { cwd: process.cwd(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .split(/\r?\n/)
      .filter((d) => /\.tsx?$/.test(d))
      .filter((d) => !/\.(test|spec)\.tsx?$/.test(d))
      .filter((d) => !["lib/finance/hoa-don/feature.ts", "lib/settings/registry.ts", "lib/settings/nhan-van-hanh.ts"].includes(d))
      .filter((d) => existsSync(resolve(process.cwd(), d)));
    const viPham = ra.filter((d) => bocChuThich(readFileSync(resolve(process.cwd(), d), "utf8")).includes(KHOA_HUB_CHINH_SACH));
    expect(ra.length).toBeGreaterThan(200);
    expect(viPham, `Đọc cờ Hub ngoài feature.ts: ${viPham.join(", ")}`).toEqual([]);
  });
});

describe("[QNF-01] công tắc SCANNER bóng nghĩa vụ hoá đơn (Invoice Hub S8, 01/11/2026)", () => {
  it("khoá `hoaDon.hubQuet`, mặc định TẮT (TD-11), KHÔNG cho cơ sở lệch, boolean thật, có nhãn CẨN THẬN ở tab Tiền", () => {
    expect(KHOA_HUB_QUET).toBe("hoaDon.hubQuet");
    const d = SETTINGS[KHOA_HUB_QUET];
    // Mặc định `true` lọt vào đây là cron GHI bảng chiếu mỗi 10 phút ngay lần deploy kế tiếp.
    expect(d.default).toBe(false);
    expect(d.centerOverridable).toBe(false);
    expect(d.group).toBe("finance");
    expect(d.schema.safeParse(true).success).toBe(true);
    expect(d.schema.safeParse("true").success, "phải là boolean thật, không phải chuỗi").toBe(false);
    const n = NHAN_VAN_HANH[KHOA_HUB_QUET];
    expect(n.tab).toBe("tien");
    expect(n.canThan).toBe(true);
    // Người vận hành phải đọc được: nó CHỈ ghi bảng chiếu, KHÔNG phát hành, KHÔNG gọi nhà cung cấp.
    expect(n.giaiThich).toMatch(/không (tự )?phát hành/i);
  });

  it("[QNF-02] KHÁC công tắc chính sách: hai cờ độc lập (bật chính sách không bật scanner và ngược lại)", () => {
    expect(KHOA_HUB_QUET).not.toBe(KHOA_HUB_CHINH_SACH);
    expect(KHOA_HUB_QUET).not.toBe(KHOA_MISA_PHAT_HANH);
  });

  it("[QNF-03] cũng chỉ đọc ở feature.ts (lưới [HDF-02] mở rộng cho khoá mới)", { timeout: TRAN_QUET_MS }, () => {
    const ra = execFileSync("git", ["ls-files", "--", "lib", "app", "components"], { cwd: process.cwd(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .split(/\r?\n/)
      .filter((d) => /\.tsx?$/.test(d))
      .filter((d) => !/\.(test|spec)\.tsx?$/.test(d))
      .filter((d) => !["lib/finance/hoa-don/feature.ts", "lib/settings/registry.ts", "lib/settings/nhan-van-hanh.ts"].includes(d))
      .filter((d) => existsSync(resolve(process.cwd(), d)));
    const viPham = ra.filter((d) => bocChuThich(readFileSync(resolve(process.cwd(), d), "utf8")).includes(KHOA_HUB_QUET));
    expect(ra.length).toBeGreaterThan(200);
    expect(viPham, `Đọc cờ scanner ngoài feature.ts: ${viPham.join(", ")}`).toEqual([]);
  });
});

describe("[PHM-F1] công tắc phát hành qua MISA (bước 1, 30/09)", () => {
  it("khoá `hoaDon.misaPhatHanh`, mặc định TẮT, KHÔNG cho cơ sở lệch, boolean thật, có nhãn CẨN THẬN ở tab Tiền", () => {
    // Mặc định `true` lọt vào đây là bật phát hành hoá đơn THẬT cho toàn prod ngay lần deploy kế tiếp.
    expect(KHOA_MISA_PHAT_HANH).toBe("hoaDon.misaPhatHanh");
    const d = SETTINGS[KHOA_MISA_PHAT_HANH];
    expect(d.default).toBe(false);
    expect(d.centerOverridable).toBe(false);
    expect(d.schema.safeParse("true").success).toBe(false);
    const n = NHAN_VAN_HANH[KHOA_MISA_PHAT_HANH];
    expect(n.tab).toBe("tien");
    expect(n.canThan).toBe(true);
  });
});

describe("[PIL-F1] thí điểm THEO CƠ SỞ (Invoice Hub, 01/11/2026): HO bật từng cơ sở, không bật cả hệ thống cùng lúc", () => {
  it("khoá `hoaDon.hubThiDiem`: mặc định TẮT, CÓ cài riêng theo cơ sở, KHÔNG cho quản lý cơ sở tự sửa, boolean thật, nhãn CẨN THẬN", () => {
    expect(KHOA_HUB_THI_DIEM).toBe("hoaDon.hubThiDiem");
    const d = SETTINGS[KHOA_HUB_THI_DIEM];
    // Mặc định `true` lọt vào đây = mọi cơ sở vào thí điểm ngay lần deploy sau — đúng điều chủ dự án dặn không làm.
    expect(d.default).toBe(false);
    expect(d.centerOverridable).toBe(true);
    // Quản lý cơ sở không được tự đưa cơ sở mình vào thí điểm: đó là quyết định của Hội sở.
    expect(d.qlcsSuaDuoc ?? false).toBe(false);
    expect(d.group).toBe("finance");
    expect(d.schema.safeParse(true).success).toBe(true);
    expect(d.schema.safeParse("true").success, "phải là boolean thật, không phải chuỗi").toBe(false);
    const n = NHAN_VAN_HANH[KHOA_HUB_THI_DIEM];
    expect(n.tab).toBe("tien");
    expect(n.canThan).toBe(true);
    expect(n.giaiThich).toMatch(/từng cơ sở/i);
    expect(n.giaiThich).toMatch(/không phát hành/i);
  });

  it("công tắc TỔNG vẫn toàn hệ (HO bật một lần); chỉ khoá thí điểm mới theo cơ sở — hai khoá khác nhau", () => {
    expect(SETTINGS[KHOA_HUB_QUET].centerOverridable).toBe(false);
    expect(KHOA_HUB_THI_DIEM).not.toBe(KHOA_HUB_QUET);
  });

  it("khoá thí điểm chỉ được đọc ở feature.ts (cùng lưới [QNF-03])", { timeout: TRAN_QUET_MS }, () => {
    const ra = execFileSync("git", ["ls-files", "--", "lib", "app", "components"], { cwd: process.cwd(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .split(/\r?\n/)
      .filter((d) => /\.tsx?$/.test(d))
      .filter((d) => !/\.(test|spec)\.tsx?$/.test(d))
      .filter((d) => !["lib/finance/hoa-don/feature.ts", "lib/settings/registry.ts", "lib/settings/nhan-van-hanh.ts"].includes(d))
      .filter((d) => existsSync(resolve(process.cwd(), d)));
    const viPham = ra.filter((d) => bocChuThich(readFileSync(resolve(process.cwd(), d), "utf8")).includes(KHOA_HUB_THI_DIEM));
    expect(viPham, `Đọc cờ thí điểm ngoài feature.ts: ${viPham.join(", ")}`).toEqual([]);
  });
});

describe("[PIL-F2] công tắc thông tin người mua (QR) và phân phối hoá đơn (S10) + tham số kỹ thuật", () => {
  it("hai công tắc mặc định TẮT, toàn hệ (thí điểm theo cơ sở do `hubThiDiem` lo), boolean thật, có nhãn CẨN THẬN", () => {
    for (const k of ["hoaDon.hubNguoiMua", "hoaDon.hubPhanPhoi"] as const) {
      const d = SETTINGS[k];
      expect(d.default, k).toBe(false);
      expect(d.centerOverridable, k).toBe(false);
      expect(d.schema.safeParse("true").success, k).toBe(false);
      expect(NHAN_VAN_HANH[k].canThan, k).toBe(true);
      expect(NHAN_VAN_HANH[k].giaiThich, k).toMatch(/thí điểm/i);
    }
  });

  it("sáu tham số người mua: mặc định TTL = hằng 240 phút của miền; mọi biên chặn giá trị phi lý (0, âm, quá lớn); đều có đơn vị", () => {
    const bien: Array<[keyof typeof SETTINGS, number, number, number]> = [
      ["hoaDon.nguoiMuaTtlPhut", 240, 15, 1440],
      ["hoaDon.nguoiMuaToiDaSai", 5, 3, 10],
      ["hoaDon.nguoiMuaToiDaMo", 30, 5, 200],
      ["hoaDon.nguoiMuaKhoaPhut", 15, 5, 1440],
      ["hoaDon.nguoiMuaGiuDuLieuNgay", 30, 1, 365],
      ["hoaDon.nguoiMuaChoXuLyNgay", 14, 1, 90],
    ];
    for (const [k, mac, min, max] of bien) {
      const d = SETTINGS[k];
      expect(d.default, String(k)).toBe(mac);
      expect(d.schema.safeParse(min).success, `${String(k)} min`).toBe(true);
      expect(d.schema.safeParse(max).success, `${String(k)} max`).toBe(true);
      expect(d.schema.safeParse(min - 1).success, `${String(k)} dưới min`).toBe(false);
      expect(d.schema.safeParse(max + 1).success, `${String(k)} trên max`).toBe(false);
      expect(d.schema.safeParse(1.5).success, `${String(k)} số lẻ`).toBe(false);
      expect(NHAN_VAN_HANH[k].donVi, String(k)).toBeTruthy();
    }
    expect(SETTINGS["hoaDon.nguoiMuaTtlPhut"].default).toBe(TTL_MAC_DINH_PHUT);
  });

  it("các khoá mới chỉ được đọc ở feature.ts (cùng lưới [QNF-03])", { timeout: TRAN_QUET_MS }, () => {
    const ra = execFileSync("git", ["ls-files", "--", "lib", "app", "components"], { cwd: process.cwd(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .split(/\r?\n/)
      .filter((d) => /\.tsx?$/.test(d))
      .filter((d) => !/\.(test|spec)\.tsx?$/.test(d))
      .filter((d) => !["lib/finance/hoa-don/feature.ts", "lib/settings/registry.ts", "lib/settings/nhan-van-hanh.ts"].includes(d))
      .filter((d) => existsSync(resolve(process.cwd(), d)));
    const khoa = ["hoaDon.hubNguoiMua", "hoaDon.hubPhanPhoi", "hoaDon.nguoiMua"];
    const viPham = ra.filter((d) => {
      const t = bocChuThich(readFileSync(resolve(process.cwd(), d), "utf8"));
      return khoa.some((k) => t.includes(k));
    });
    expect(viPham, `Đọc cờ ngoài feature.ts: ${viPham.join(", ")}`).toEqual([]);
  });
});
