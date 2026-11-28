import { describe, expect, it } from "vitest";
import { DO_DAI_KHOA_GOC_TOI_THIEU, giaiMaBiMat, laChuoiBiMatHopLe, LoiHopBiMat, maHoaBiMat, maKhoaGoc } from "./hop-bi-mat";

// Ca [HBM-*] — HỘP BÍ MẬT (AES-256-GCM) cho mật khẩu nhà cung cấp hoá đơn do kế toán tự nhập (Invoice Hub, phương án (b) 03/11/2026).
// THUẦN: không DB, không env, không đồng hồ. Mọi ca "KHÔNG được" kèm đối chứng dương (luật 11 CLAUDE.md).

const KHOA_A = "khoa-goc-A-0123456789-abcdefghijklmnop"; // ≥ 32 ký tự — chuỗi TEST, vô hại
const KHOA_B = "khoa-goc-B-9876543210-ponmlkjihgfedcba";
const MAT_KHAU = "  Mật khẩu VIN #1/2026 ✓  "; // khoảng trắng đầu/cuối là MỘT PHẦN mật khẩu (cùng luật cau-hinh VIN: không trim)
const MUC_DICH = "hoa-don.ket-noi";
const NGU_CANH = "ketnoi:cl001";

const ma = (khoa = KHOA_A, nguCanh = NGU_CANH, banRo = MAT_KHAU) => maHoaBiMat(banRo, { khoaGoc: khoa, mucDich: MUC_DICH, nguCanh });
const giai = (chuoi: string, khoa: readonly string[] = [KHOA_A], nguCanh = NGU_CANH, mucDich = MUC_DICH) =>
  giaiMaBiMat(chuoi, { cacKhoaGoc: khoa, mucDich, nguCanh });
const maLoi = (f: () => unknown): string | null => {
  try {
    f();
    return null;
  } catch (e) {
    return e instanceof LoiHopBiMat ? e.ma : `KHAC:${String(e)}`;
  }
};

describe("hộp bí mật AES-256-GCM", () => {
  it("[HBM-01] mã hoá rồi giải mã trả đúng bản gốc (unicode, KHÔNG cắt khoảng trắng)", () => {
    expect(giai(ma())).toBe(MAT_KHAU);
    expect(giai(ma(KHOA_A, NGU_CANH, "x"))).toBe("x");
  });

  it("[HBM-02] chuỗi lưu có 5 phần, KHÔNG chứa bản rõ; hai lần mã hoá cùng bản rõ ra hai chuỗi khác nhau (IV ngẫu nhiên)", () => {
    const a = ma();
    const b = ma();
    expect(a.split(".")).toHaveLength(5);
    expect(a.startsWith("v1.")).toBe(true);
    expect(a).not.toContain("VIN");
    expect(a).not.toContain(Buffer.from(MAT_KHAU, "utf8").toString("base64url"));
    expect(a).not.toBe(b);
    expect(giai(b)).toBe(MAT_KHAU); // đối chứng dương: chuỗi thứ hai vẫn giải được
    expect(laChuoiBiMatHopLe(a)).toBe(true);
  });

  it("[HBM-03] ràng buộc ngữ cảnh: chuỗi của dòng A KHÔNG giải được khi khai là dòng B, cũng không khi đổi mục đích", () => {
    const a = ma(KHOA_A, "ketnoi:A");
    expect(giai(a, [KHOA_A], "ketnoi:A")).toBe(MAT_KHAU); // đối chứng dương
    expect(maLoi(() => giai(a, [KHOA_A], "ketnoi:B"))).toBe("GIAI_MA_THAT_BAI");
    expect(maLoi(() => giai(a, [KHOA_A], "ketnoi:A", "muc-dich-khac"))).toBe("GIAI_MA_THAT_BAI");
  });

  it("[HBM-04] sửa bất kỳ phần nào (iv · ciphertext · tag) đều bị từ chối, KHÔNG trả bản rõ sai", () => {
    const parts = ma().split(".");
    expect(giai(parts.join("."))).toBe(MAT_KHAU); // đối chứng dương
    for (const i of [2, 3, 4]) {
      const hong = [...parts];
      const c = hong[i]!;
      hong[i] = (c[0] === "A" ? "B" : "A") + c.slice(1);
      expect(maLoi(() => giai(hong.join(".")))).toBe("GIAI_MA_THAT_BAI");
    }
  });

  it("[HBM-05] sai khoá gốc ⇒ KHONG_CO_KHOA (không thử giải bằng khoá lạ); đúng khoá ⇒ giải được", () => {
    const a = ma(KHOA_A);
    expect(giai(a, [KHOA_A])).toBe(MAT_KHAU);
    expect(maLoi(() => giai(a, [KHOA_B]))).toBe("KHONG_CO_KHOA");
    expect(maLoi(() => giai(a, []))).toBe("KHONG_CO_KHOA");
  });

  it("[HBM-06] xoay khoá: chuỗi cũ vẫn giải được khi còn khoá cũ trong danh sách; mã hoá mới mang mã khoá mới", () => {
    const cu = ma(KHOA_A);
    expect(giai(cu, [KHOA_B, KHOA_A])).toBe(MAT_KHAU);
    const moi = ma(KHOA_B);
    expect(moi.split(".")[1]).toBe(maKhoaGoc(KHOA_B));
    expect(moi.split(".")[1]).not.toBe(cu.split(".")[1]);
    expect(giai(moi, [KHOA_B, KHOA_A])).toBe(MAT_KHAU);
  });

  it("[HBM-07] khoá gốc ngắn (< 32) bị từ chối khi mã hoá; bản rõ rỗng bị từ chối", () => {
    expect(DO_DAI_KHOA_GOC_TOI_THIEU).toBe(32);
    expect(maLoi(() => ma("ngan"))).toBe("KHOA_THIEU");
    expect(maLoi(() => maHoaBiMat("", { khoaGoc: KHOA_A, mucDich: MUC_DICH, nguCanh: NGU_CANH }))).toBe("BAN_RO_RONG");
    expect(ma(KHOA_A)).toBeTruthy(); // đối chứng dương
  });

  it("[HBM-08] chuỗi sai khuôn ⇒ DINH_DANG, không bao giờ ném lỗi lạ", () => {
    for (const s of ["", "abc", "v2.a.b.c.d", "v1.a.b.c", "v1..b.c.d", ".....", "v1.a.b.c.d.e"]) {
      expect(maLoi(() => giai(s))).toBe("DINH_DANG");
      expect(laChuoiBiMatHopLe(s)).toBe(false);
    }
  });

  it("[HBM-09] thông điệp lỗi KHÔNG chứa bản rõ, khoá gốc, hay chuỗi mã hoá", () => {
    const a = ma();
    const loi: unknown[] = [];
    for (const f of [() => giai(a, [KHOA_B]), () => giai(a, [KHOA_A], "ketnoi:khac"), () => ma("ngan")]) {
      try {
        f();
      } catch (e) {
        loi.push(e);
      }
    }
    expect(loi).toHaveLength(3);
    for (const e of loi) {
      const text = `${(e as Error).message} ${(e as Error).stack ?? ""}`;
      expect(text).not.toContain(MAT_KHAU.trim());
      expect(text).not.toContain(KHOA_A);
      expect(text).not.toContain(KHOA_B);
      expect(text).not.toContain(a);
    }
  });
});
