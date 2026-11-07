// lib/bao-luu/tep.test.ts — kho tệp bảo lưu: khoá, loại, vân tay (THUẦN) + hợp đồng bucket riêng. PHIÊN 2.
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  KHOA_TEP_BAO_LUU_RE,
  khoaTepBaoLuu,
  laKhoaTepBaoLuu,
  loaiTuTenTep,
  vanTayBaoLuu,
} from "./tep";

const UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("[BL2-TEP] khoá tệp", () => {
  it("[BL2-TEP-01] khoá sinh ra luôn qua được laKhoaTepBaoLuu và không chứa uuid có gạch", () => {
    const k = khoaTepBaoLuu({ nam: 2026, thang: 10, uuid: UUID, loai: "pdf" });
    expect(k).toBe("bao-luu/2026-10/123e4567e89b12d3a456426614174000.pdf");
    expect(laKhoaTepBaoLuu(k)).toBe(true);
  });

  it("[BL2-TEP-02] khoá của KHO KHÁC không bao giờ hợp lệ — đó là lớp chặn xin URL ký cho object tuỳ ý", () => {
    for (const k of [
      "hoa-don/CS1/2026/don1/u.pdf", // tệp hoá đơn
      "uploads/documents/2026-10/a-ab12cd34.pdf", // bucket công khai
      "chat/ab12cd34.png",
      "bao-luu/../hoa-don/x.pdf",
      "bao-luu/2026-13/ab12cd34.pdf", // tháng 13
      "bao-luu/2026-10/ab12cd34.exe",
      "bao-luu/2026-10/AB12CD34.pdf", // hoa
      "bao-luu/2026-10/ab12.pdf", // quá ngắn
      "/bao-luu/2026-10/ab12cd34.pdf",
      "bao-luu/2026-10/ab12cd34.pdf/../../x",
      "",
    ]) {
      expect(laKhoaTepBaoLuu(k), JSON.stringify(k)).toBe(false);
    }
    for (const k of [null, undefined, 42, {}, []]) expect(laKhoaTepBaoLuu(k)).toBe(false);
  });

  it("[BL2-TEP-03] khoaTepBaoLuu NÉM khi tháng/năm/uuid sai (không sinh khoá sai hình dạng)", () => {
    expect(() => khoaTepBaoLuu({ nam: 2026, thang: 13, uuid: UUID, loai: "pdf" })).toThrow();
    expect(() => khoaTepBaoLuu({ nam: 1999, thang: 1, uuid: UUID, loai: "pdf" })).toThrow();
    expect(() => khoaTepBaoLuu({ nam: 2026, thang: 1, uuid: "zzzz", loai: "pdf" })).toThrow();
  });

  it("[BL2-TEP-04] regex neo hai đầu (không khớp một phần)", () => {
    expect(KHOA_TEP_BAO_LUU_RE.source.startsWith("^")).toBe(true);
    expect(KHOA_TEP_BAO_LUU_RE.source.endsWith("$")).toBe(true);
  });
});

describe("[BL2-TEP] loại tệp + vân tay", () => {
  it("[BL2-TEP-05] đuôi PHẢI khớp mime khai; jpeg ≡ jpg; loại lạ ⇒ null", () => {
    expect(loaiTuTenTep("don.pdf", "application/pdf")).toBe("pdf");
    expect(loaiTuTenTep("anh.JPEG", "image/jpeg")).toBe("jpg");
    expect(loaiTuTenTep("anh.png", "IMAGE/PNG")).toBe("png");
    expect(loaiTuTenTep("don.pdf", "image/png")).toBeNull(); // đuôi pdf nhưng mime png
    expect(loaiTuTenTep("macro.docm", "application/vnd.ms-word")).toBeNull();
    expect(loaiTuTenTep("khong-duoi", "application/pdf")).toBeNull();
    expect(loaiTuTenTep("evil.pdf.exe", "application/pdf")).toBeNull();
  });

  it("[BL2-TEP-06] vân tay theo BYTE: đúng loại qua, sai loại không (tin nội dung, không tin đuôi)", () => {
    const pdf = new TextEncoder().encode("%PDF-1.7\n...");
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
    const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
    expect(vanTayBaoLuu("pdf", pdf)).toBe(true);
    expect(vanTayBaoLuu("png", png)).toBe(true);
    expect(vanTayBaoLuu("jpg", jpg)).toBe(true);
    expect(vanTayBaoLuu("webp", webp)).toBe(true);
    // chéo:
    expect(vanTayBaoLuu("pdf", png)).toBe(false);
    expect(vanTayBaoLuu("png", pdf)).toBe(false);
    expect(vanTayBaoLuu("jpg", webp)).toBe(false);
    // tệp thực thi đội lốt:
    expect(vanTayBaoLuu("pdf", new TextEncoder().encode("MZ\x90\x00"))).toBe(false);
    // RIFF nhưng không phải WEBP (vd WAV):
    const wav = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45]);
    expect(vanTayBaoLuu("webp", wav)).toBe(false);
    expect(vanTayBaoLuu("pdf", new Uint8Array())).toBe(false);
  });
});

describe("[BL2-KHO] bucket RIÊNG — getter NÉM, không lùi về bucket chung", () => {
  const goc = { ...process.env };
  afterEach(() => {
    process.env = { ...goc };
    vi.resetModules();
  });
  const nap = async () => (await import("./kho-tep"));

  it("[BL2-KHO-01] chưa đặt R2_BAOLUU_BUCKET_NAME ⇒ NÉM và khoBaoLuuDaCauHinh() = false", async () => {
    delete process.env.R2_BAOLUU_BUCKET_NAME;
    const k = await nap();
    expect(() => k.getBaoLuuBucket()).toThrow(/chưa đặt/);
    expect(k.khoBaoLuuDaCauHinh()).toBe(false);
  });

  it("[BL2-KHO-02] trùng BẤT KỲ bucket nào khác (công khai · chat · đào tạo · hoá đơn) ⇒ NÉM", async () => {
    const k = await nap();
    for (const env of ["R2_BUCKET_NAME", "R2_CHAT_BUCKET_NAME", "R2_ELEARNING_BUCKET_NAME", "R2_INVOICE_BUCKET_NAME"]) {
      process.env = { ...goc, R2_BAOLUU_BUCKET_NAME: "chung", [env]: "chung" };
      expect(() => k.getBaoLuuBucket(), env).toThrow(new RegExp(`trùng ${env}`));
    }
  });

  it("[BL2-KHO-03] bucket riêng hợp lệ ⇒ trả đúng tên (đối chứng dương)", async () => {
    process.env = { ...goc, R2_BAOLUU_BUCKET_NAME: "satarobo-bao-luu", R2_BUCKET_NAME: "satarobo-uploads" };
    const k = await nap();
    expect(k.getBaoLuuBucket()).toBe("satarobo-bao-luu");
  });

  it("[BL2-KHO-04] kyUrlTaiVeBaoLuu NÉM với khoá sai hình dạng — KHÔNG ký URL cho object tuỳ ý (kể cả khi bucket cấu hình đủ)", async () => {
    process.env = { ...goc, R2_BAOLUU_BUCKET_NAME: "satarobo-bao-luu" };
    const k = await nap();
    await expect(k.kyUrlTaiVeBaoLuu("hoa-don/CS1/2026/don1/u.pdf", 60)).rejects.toThrow(/không hợp lệ/);
    await expect(k.kyUrlTaiLenBaoLuu("../x.pdf", "pdf", 60)).rejects.toThrow(/không hợp lệ/);
  });
});
