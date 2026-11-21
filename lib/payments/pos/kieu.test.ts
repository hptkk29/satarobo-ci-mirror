// [POS-K01] Che số thẻ ở SERVER — `dongPosSchema` là cửa mà `nhapLoPosAction` parse. THUẦN.
//
// Mã TRƯỚC bản vá: `soTheMasked: z.string().nullable()` — việc che chỉ chạy trong `docFilePos`
// ở TRÌNH DUYỆT, nên một lượt POST dựng tay / client cũ đưa thẳng số thẻ đầy đủ vào DB.
import { describe, it, expect } from "vitest";
import { cheSoThe, dongPosNhapSchema, dongPosSchema, type DongPos } from "./kieu";
import { docFilePos } from "./doc-file-pos";
import { DONG_CS1, DONG_CS2, THU_MUC_CS1, dungZipThat } from "@/tests/fixtures/pos/smartpos-that";

const dong: DongPos = {
  maGiaoDich: "FT2609290001",
  loaiGiaoDich: "Thanh toán",
  hinhThuc: "Thẻ",
  trangThai: "Thành công",
  soTien: 1_500_000,
  thoiGian: "2026-09-29T17:31:35+07:00",
  dienGiai: "",
  maChuanChi: null,
  maGiaoDichThe: null,
  maGiaoDichGoc: null,
  trangThaiHoanHuy: null,
  maDonHang: null,
  maQuay: null,
  maThietBi: null,
  soTheMasked: null,
  loaiThe: null,
  maHachToan: null,
  phiGiaoDich: null,
};

describe("[POS-K] che số thẻ", () => {
  it("[POS-K01] schema của SERVER tự che số thẻ đầy đủ (mọi dạng phân cách)", () => {
    for (const [vao, ra] of [
      ["4111111111111111", "411111******1111"],
      ["4111 1111 1111 1111", "411111******1111"],
      ["4111.1111.1111.1111", "411111******1111"],
      ["4111-1111-1111-1111", "411111******1111"],
      ["VISA 4111111111111111", "VISA 411111******1111"],
    ] as const) {
      const kq = dongPosSchema.safeParse({ ...dong, soTheMasked: vao });
      expect(kq.success).toBe(true);
      if (kq.success) expect(kq.data.soTheMasked, vao).toBe(ra);
    }
  });

  it("[POS-K02] số đã che / ngắn / null giữ nguyên", () => {
    expect(cheSoThe("411111******1111")).toBe("411111******1111");
    expect(cheSoThe("970436******1234")).toBe("970436******1234");
    expect(cheSoThe("123456789012")).toBe("123456789012"); // 12 chữ số — không phải số thẻ
    const kq = dongPosSchema.safeParse({ ...dong, soTheMasked: null });
    expect(kq.success && kq.data.soTheMasked).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GĐ3 POS (docs/pos-gd3-thiet-ke.md §1, V3 + V4) — hợp đồng LỐI VÀO của hai action nhập file.
//
// Mã TRƯỚC bản vá: action parse dòng bằng `dongPosSchema`, nơi `thoiGian: z.string()`. Chuỗi KHÔNG
// múi giờ (`2026-09-29T10:00:00`) được `new Date` đọc theo giờ MÁY CHỦ ⇒ trên VPS chạy UTC, giờ thu
// lệch 7 tiếng (quẹt 0h–7h bị ghi sang ngày trước). Chuỗi cột không có trần độ dài.
// ─────────────────────────────────────────────────────────────────────────────

describe("[POS3] dongPosNhapSchema — lối vào server của file POS", () => {
  it("[POS3-01] thoiGian PHẢI có múi giờ tường minh và là thời điểm có thật", () => {
    for (const tot of ["2026-09-29T17:31:35+07:00", "2026-09-29T10:31:35Z", "2026-09-29T10:31:35.123Z", "2026-09-29T17:31+07:00"]) {
      expect(dongPosNhapSchema.safeParse({ ...dong, thoiGian: tot }).success, tot).toBe(true);
    }
    for (const xau of [
      "2026-09-29T10:00:00", // không múi ⇒ giờ máy chủ
      "2026-09-29 10:00:00+07:00", // không phải ISO 8601 (thiếu T)
      "2026-02-30T10:00:00+07:00", // `new Date` CUỘN sang 02/03 — phải từ chối
      "2026-09-29T24:00:00+07:00", // `new Date` nhận 24:00 — phải từ chối
      "2026-09-29T10:00:00+25:00", // múi vô lý
      "rác",
      "",
    ]) {
      expect(dongPosNhapSchema.safeParse({ ...dong, thoiGian: xau }).success, xau).toBe(false);
    }
    // Đối chứng: hợp đồng dùng CHUNG với provider (`dongPosSchema`) KHÔNG đổi — `dongTuBanGhi` dựng
    // `thoiGian: ""`, `xu-ly-ket-qua.ts` parse kết quả provider bằng nó; siết nó là ném giữa pha tiền.
    expect(dongPosSchema.safeParse({ ...dong, thoiGian: "2026-09-29T10:00:00" }).success).toBe(true);
    expect(dongPosSchema.safeParse({ ...dong, thoiGian: "" }).success).toBe(true);
  });

  it("[POS3-02] trần độ dài chuỗi (V4) — chặn payload nhồi chuỗi dài, không chạm dữ liệu thật", async () => {
    const dai = (n: number) => "x".repeat(n);
    expect(dongPosNhapSchema.safeParse({ ...dong, loaiGiaoDich: dai(200) }).success).toBe(true);
    expect(dongPosNhapSchema.safeParse({ ...dong, loaiGiaoDich: dai(201) }).success).toBe(false);
    for (const k of ["hinhThuc", "trangThai", "trangThaiHoanHuy", "maDonHang", "maQuay", "maThietBi", "loaiThe", "maHachToan"] as const) {
      expect(dongPosNhapSchema.safeParse({ ...dong, [k]: dai(200) }).success, `${k} = 200`).toBe(true);
      expect(dongPosNhapSchema.safeParse({ ...dong, [k]: dai(201) }).success, `${k} = 201`).toBe(false);
    }
    for (const k of ["maChuanChi", "maGiaoDichThe", "maGiaoDichGoc", "soTheMasked"] as const) {
      expect(dongPosNhapSchema.safeParse({ ...dong, [k]: "1".repeat(64) }).success, `${k} = 64`).toBe(true);
      expect(dongPosNhapSchema.safeParse({ ...dong, [k]: "1".repeat(65) }).success, `${k} = 65`).toBe(false);
    }
    expect(dongPosNhapSchema.safeParse({ ...dong, dienGiai: dai(4000) }).success).toBe(true);
    expect(dongPosNhapSchema.safeParse({ ...dong, dienGiai: dai(4001) }).success).toBe(false);
    // Lưới cuối chống PII vẫn chạy trên schema mới.
    const che = dongPosNhapSchema.safeParse({ ...dong, soTheMasked: "4111111111111111" });
    expect(che.success && che.data.soTheMasked).toBe("411111******1111");
    // Mọi dòng của HAI file thật (đã che) đều qua — trần không chạm dữ liệu thật.
    const kq = await docFilePos(await dungZipThat(THU_MUC_CS1, [DONG_CS1, DONG_CS2]), "29092026_USER_TXN.zip");
    expect(kq.ok).toBe(true);
    if (!kq.ok) return;
    expect(kq.dong).toHaveLength(11);
    for (const d of kq.dong) expect(dongPosNhapSchema.safeParse(d).success, d.maGiaoDich).toBe(true);
  });
});
