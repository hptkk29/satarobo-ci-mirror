/**
 * [TS-BK-*] Bucket PDF Tủ sách phải là bucket RIÊNG: thiếu ⇒ ném, trùng bất kỳ bucket nào khác (nhất là bucket công khai) ⇒ ném.
 * Đây là hàng rào chống «PDF nằm trong bucket công khai nên ai biết đường dẫn cũng tải được».
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { bucketTuSachHopLe, getTuSachBucket, TuSachKhoConfigError } from "./bucket-pdf";

const GOC = {
  R2_BUCKET_NAME: "satarobo-assets",
  R2_CHAT_BUCKET_NAME: "satarobo-chat",
  R2_INVOICE_BUCKET_NAME: "satarobo-hoa-don",
  R2_BAOLUU_BUCKET_NAME: "satarobo-bao-luu",
  R2_ELEARNING_BUCKET_NAME: "satarobo-elearning",
};

describe("[TS-BK-01] bucket PDF Tủ sách", () => {
  it("đặt bucket riêng ⇒ trả đúng tên (cắt khoảng trắng)", () => {
    expect(getTuSachBucket({ ...GOC, R2_TU_SACH_BUCKET_NAME: "  satarobo-tu-sach " })).toBe("satarobo-tu-sach");
    expect(bucketTuSachHopLe({ ...GOC, R2_TU_SACH_BUCKET_NAME: "satarobo-tu-sach" })).toBe(true);
  });
  it("thiếu / rỗng ⇒ NÉM, KHÔNG lùi về R2_BUCKET_NAME", () => {
    for (const v of [undefined, "", "   "]) {
      const env = { ...GOC, R2_TU_SACH_BUCKET_NAME: v };
      expect(() => getTuSachBucket(env)).toThrow(TuSachKhoConfigError);
      expect(bucketTuSachHopLe(env)).toBe(false);
    }
  });
  it.each(Object.keys(GOC))("trùng %s ⇒ NÉM (bucket phải riêng, không công khai)", (ten) => {
    const env = { ...GOC, R2_TU_SACH_BUCKET_NAME: GOC[ten as keyof typeof GOC] };
    expect(() => getTuSachBucket(env)).toThrow(/trùng/);
    expect(bucketTuSachHopLe(env)).toBe(false);
  });
});

describe("[TS-BK-W1] dây nối: kho PDF thật chỉ dùng bucket riêng", () => {
  const nguon = readFileSync(resolve(process.cwd(), "lib/tu-sach/kho-r2.ts"), "utf8")
    .split("\n")
    .filter((d) => !/^\s*(\/\/|\*|\/\*)/.test(d))
    .join("\n");
  it("không còn gọi getR2Bucket() (bucket công khai) trong kho PDF", () => {
    expect(nguon.match(/getR2Bucket\(/g) ?? []).toHaveLength(0);
  });
  it("cả HEAD lẫn ký link đều lấy bucket từ getTuSachBucket()", () => {
    expect(nguon.match(/Bucket:\s*getTuSachBucket\(\)/g) ?? []).toHaveLength(2);
  });
});
