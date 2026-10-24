// Đọc file "Danh sách giao dịch V2" SmartPOS (.zip / .xlsx) → DongPos[].
// Fixture dựng theo đặc tả cột: tests/fixtures/pos/giao-dich-9-dong.ts (THAY bằng file thật đã che).
import { describe, it, expect } from "vitest";
import { docFilePos, type KetQuaDocFile } from "./doc-file-pos";
import { COT_BAT_BUOC, dongPosSchema, type DongPos } from "./kieu";
import {
  DONG_BAN,
  HEADER,
  MA_1,
  SO_COT,
  TEN_CHU_THE,
  dongTho,
  taoXlsx,
  taoZip,
} from "@/tests/fixtures/pos/giao-dich-9-dong";

function dongOk(kq: KetQuaDocFile): DongPos[] {
  if (!kq.ok) throw new Error(`mong ok, nhận lỗi: ${kq.loi} [${kq.cotThieu.join(", ")}]`);
  return kq.dong;
}

function loiCua(kq: KetQuaDocFile): { loi: string; cotThieu: string[] } {
  if (kq.ok) throw new Error(`mong lỗi, nhận ${kq.dong.length} dòng`);
  return { loi: kq.loi, cotThieu: kq.cotThieu };
}

const theoMa = (ds: DongPos[], ma: string) => {
  const d = ds.find((x) => x.maGiaoDich === ma);
  if (!d) throw new Error(`không thấy ${ma}`);
  return d;
};

describe("docFilePos — fixture 9 dòng", () => {
  it("[POS-00] fixture đúng hình dạng đặc tả (65 cột, đủ cột bắt buộc, 9 dòng)", () => {
    expect(HEADER).toHaveLength(SO_COT);
    for (const c of COT_BAT_BUOC) expect(HEADER).toContain(c);
    expect(HEADER).toContain("Tên chủ thẻ");
    expect(DONG_BAN).toHaveLength(9);
  });

  it("[POS-01] đọc đúng 9 dòng, ô trống ⇒ null, số tiền/phí là Int", async () => {
    const kq = await docFilePos(taoXlsx(), "giao-dich.xlsx");
    const ds = dongOk(kq);
    expect(ds).toHaveLength(9);
    if (kq.ok) expect(kq.soFileXlsx).toBe(1);
    for (const d of ds) expect(dongPosSchema.safeParse(d).success).toBe(true);

    const d1 = theoMa(ds, "FT2609290001");
    expect(d1).toMatchObject({
      loaiGiaoDich: "Thanh toán",
      hinhThuc: "Thẻ",
      trangThai: "Thành công",
      soTien: 1_500_000,
      dienGiai: `Kiet 0328545229 ${MA_1}`,
      maChuanChi: "123456",
      maGiaoDichThe: "RRN000000001",
      maGiaoDichGoc: null,
      trangThaiHoanHuy: null,
      maDonHang: null,
      maQuay: "Q01",
      maThietBi: "TCBPOS0001",
      soTheMasked: "970436******1234",
      loaiThe: "VISA",
      maHachToan: "HT2609290001",
      phiGiaoDich: 16500,
    });
    expect(theoMa(ds, "FT2609290002").phiGiaoDich).toBeNull();

    const huy = theoMa(ds, "FT2609290004");
    expect(huy.loaiGiaoDich).toBe("Hủy");
    expect(huy.soTien).toBe(-3_000_000);
    expect(huy.maGiaoDichGoc).toBe("FT2609290003");
    expect(huy.maGiaoDichThe).toBe(theoMa(ds, "FT2609290003").maGiaoDichThe);
    expect(theoMa(ds, "FT2609290003").trangThaiHoanHuy).toBe("Hủy toàn phần");
    expect(ds.filter((d) => d.trangThai === "Thất bại")).toHaveLength(5);
    expect(theoMa(ds, "FT2609290F03").dienGiai).toBe("Sai PIN");
  });

  it("[POS-02] 'Tên chủ thẻ' và mọi cột ngoài hợp đồng KHÔNG lọt vào DongPos", async () => {
    const ds = dongOk(await docFilePos(taoXlsx(), "giao-dich.xlsx"));
    const khoaHopDong = Object.keys(dongPosSchema.shape).sort();
    for (const d of ds) expect(Object.keys(d).sort()).toEqual(khoaHopDong);
    const json = JSON.stringify(ds);
    expect(json).not.toContain(TEN_CHU_THE);
    expect(json).not.toContain("rác");
  });

  it("[POS-03] thời gian '2026/09/29 17:31:35' ⇒ ISO +07:00, không phụ thuộc TZ máy", async () => {
    const ds = dongOk(await docFilePos(taoXlsx(), "giao-dich.xlsx"));
    expect(theoMa(ds, "FT2609290001").thoiGian).toBe("2026-09-29T17:31:35+07:00");
    expect(theoMa(ds, "FT2609290002").thoiGian).toBe("2026-09-29T08:05:09+07:00");
    expect(new Date(theoMa(ds, "FT2609290001").thoiGian).toISOString()).toBe(
      "2026-09-29T10:31:35.000Z",
    );
  });

  it("[POS-03b] ô thời gian là SỐ NGÀY Excel ⇒ cùng kết quả như chuỗi", async () => {
    const serial =
      (Date.UTC(2026, 8, 29, 17, 31, 35) - Date.UTC(1899, 11, 30)) / 86_400_000;
    const row = dongTho({ ...DONG_BAN[0]!, "Thời gian giao dịch": serial });
    const ds = dongOk(await docFilePos(taoXlsx([row]), "a.xlsx"));
    expect(ds[0]!.thoiGian).toBe("2026-09-29T17:31:35+07:00");
  });

  it("[POS-03c] thời gian không đọc được ⇒ lỗi nêu dòng, không đoán", async () => {
    const row = dongTho({ ...DONG_BAN[0]!, "Thời gian giao dịch": "hôm qua" });
    const { loi } = loiCua(await docFilePos(taoXlsx([row]), "a.xlsx"));
    expect(loi).toMatch(/dòng 2/i);
    expect(loi).toMatch(/Thời gian giao dịch/);
  });

  it("[POS-04] thiếu cột header ⇒ ok:false liệt kê ĐỦ cột thiếu", async () => {
    const bo = new Set(["Mã thiết bị", "Phí giao dịch", "Số thẻ"]);
    const header = HEADER.filter((h) => !bo.has(h));
    const rows = DONG_BAN.map((o) => header.map((h) => o[h] ?? ""));
    const { loi, cotThieu } = loiCua(await docFilePos(taoXlsx(rows, header), "thieu.xlsx"));
    expect([...cotThieu].sort()).toEqual([...bo].sort());
    expect(loi).toContain("thieu.xlsx");
  });

  it("[POS-04b] header có khoảng trắng thừa vẫn nhận (trim)", async () => {
    const header = HEADER.map((h) => (h === "Mã giao dịch" ? "  Mã giao dịch " : h));
    const ds = dongOk(await docFilePos(taoXlsx(DONG_BAN.map(dongTho), header), "a.xlsx"));
    expect(ds).toHaveLength(9);
  });
});

describe("docFilePos — zip", () => {
  const phan1 = DONG_BAN.slice(0, 5).map(dongTho);
  const phan2 = DONG_BAN.slice(5).map(dongTho);

  it("[POS-05] zip DDMMYYYY_TXN_x/…_000.xlsx + _001.xlsx ⇒ đọc đủ dòng cả hai, đúng thứ tự tên", async () => {
    const zip = await taoZip({
      // Cố ý thêm _001 TRƯỚC để chắc tầng đọc sắp theo tên.
      "29092026_TXN_1/DanhSachGiaoDich_001.xlsx": taoXlsx(phan2),
      "29092026_TXN_1/DanhSachGiaoDich_000.xlsx": taoXlsx(phan1),
      "__MACOSX/29092026_TXN_1/._DanhSachGiaoDich_000.xlsx": "rác mac",
      "29092026_TXN_1/~$DanhSachGiaoDich_000.xlsx": "file khoá của Excel",
      "29092026_TXN_1/doc-toi.txt": "không phải xlsx",
    });
    const kq = await docFilePos(zip, "29092026_TXN_1.zip");
    const ds = dongOk(kq);
    if (kq.ok) expect(kq.soFileXlsx).toBe(2);
    expect(ds.map((d) => d.maGiaoDich)).toEqual(
      DONG_BAN.map((o) => o["Mã giao dịch"] as string),
    );
  });

  it("[POS-06] upload thẳng .xlsx (đuôi viết HOA cũng nhận)", async () => {
    const kq = await docFilePos(taoXlsx(), "GIAO-DICH.XLSX");
    expect(dongOk(kq)).toHaveLength(9);
  });

  it("[POS-07] zip rỗng / zip không có .xlsx ⇒ lỗi rõ", async () => {
    const rong = loiCua(await docFilePos(await taoZip({}), "rong.zip"));
    expect(rong.loi).toMatch(/không có file \.xlsx/i);
    const txt = loiCua(await docFilePos(await taoZip({ "a.txt": "x", "__MACOSX/b.xlsx": "y" }), "b.zip"));
    expect(txt.loi).toMatch(/không có file \.xlsx/i);
  });

  it("[POS-07b] file không phải zip/xlsx hoặc zip hỏng ⇒ lỗi, không ném", async () => {
    expect(loiCua(await docFilePos(new Uint8Array([1, 2, 3]), "a.csv")).loi).toMatch(/\.zip|\.xlsx/);
    expect(loiCua(await docFilePos(new Uint8Array([1, 2, 3]), "a.zip")).loi).toMatch(/zip/i);
  });

  it("[POS-09] trùng Mã giao dịch giữa các file ⇒ giữ dòng xuất hiện SAU", async () => {
    const sau = dongTho({ ...DONG_BAN[0]!, "Mã hạch toán": "HT-MOI", "Phí giao dịch": 99 });
    const zip = await taoZip({
      "x/a_000.xlsx": taoXlsx([dongTho(DONG_BAN[0]!), dongTho(DONG_BAN[1]!)]),
      "x/a_001.xlsx": taoXlsx([sau]),
    });
    const ds = dongOk(await docFilePos(zip, "x.zip"));
    expect(ds).toHaveLength(2);
    const d = theoMa(ds, "FT2609290001");
    expect(d.maHachToan).toBe("HT-MOI");
    expect(d.phiGiaoDich).toBe(99);
  });
});

describe("docFilePos — trần + ô lạ", () => {
  it("[POS-08] file > 10MB ⇒ lỗi", async () => {
    const to = new Uint8Array(10 * 1024 * 1024 + 1);
    expect(loiCua(await docFilePos(to, "to.xlsx")).loi).toMatch(/10\s?MB/);
  });

  it("[POS-08b] > 20 file xlsx trong zip ⇒ lỗi", async () => {
    const x = taoXlsx([dongTho(DONG_BAN[0]!)]);
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 21; i++) files[`t/f_${String(i).padStart(3, "0")}.xlsx`] = x;
    expect(loiCua(await docFilePos(await taoZip(files), "nhieu.zip")).loi).toMatch(/20 file/);
  });

  it("[POS-08c] tổng giải nén > 50MB ⇒ lỗi (chặn zip bom)", async () => {
    const bom = "0".repeat(51 * 1024 * 1024);
    const zip = await taoZip({ "a.xlsx": bom });
    expect(zip.byteLength).toBeLessThan(10 * 1024 * 1024);
    expect(loiCua(await docFilePos(zip, "bom.zip")).loi).toMatch(/50\s?MB/);
  });

  it("[POS-08d] > 20000 dòng ⇒ lỗi", async () => {
    // Chỉ các cột bắt buộc — 65 cột × 20.001 dòng thì file đã vượt trần 10MB trước.
    const header = [...COT_BAT_BUOC];
    const mau = DONG_BAN[3]!;
    const rows: (string | number)[][] = [];
    for (let i = 0; i < 20_001; i++) {
      rows.push(header.map((h) => (h === "Mã giao dịch" ? `FT${String(i).padStart(10, "0")}` : (mau[h] ?? ""))));
    }
    const file = taoXlsx(rows, header);
    expect(file.byteLength).toBeLessThan(10 * 1024 * 1024);
    expect(loiCua(await docFilePos(file, "dai.xlsx")).loi).toMatch(/20\.?000 dòng/);
  }, 60_000);

  it("[POS-10] dòng trống hẳn bị bỏ qua; số tiền dạng chuỗi có phân cách ⇒ Int", async () => {
    const trong = HEADER.map(() => "");
    const rows = [
      dongTho({ ...DONG_BAN[0]!, "Số tiền thanh toán": "1,500,000", "Phí giao dịch": "16.500" }),
      trong,
      dongTho({ ...DONG_BAN[8]!, "Số tiền thanh toán": "-3.000.000" }),
    ];
    const ds = dongOk(await docFilePos(taoXlsx(rows), "a.xlsx"));
    expect(ds).toHaveLength(2);
    expect(ds[0]!.soTien).toBe(1_500_000);
    expect(ds[0]!.phiGiaoDich).toBe(16_500);
    expect(ds[1]!.soTien).toBe(-3_000_000);
  });

  it("[POS-10b] số tiền lẻ / không phải số ⇒ lỗi nêu dòng, không làm tròn", async () => {
    for (const v of ["1500.5", "abc", 1500.5]) {
      const row = dongTho({ ...DONG_BAN[0]!, "Số tiền thanh toán": v });
      const { loi } = loiCua(await docFilePos(taoXlsx([row]), "a.xlsx"));
      expect(loi).toMatch(/Số tiền thanh toán/);
    }
  });

  it("[POS-11] mã giao dịch sai dạng ⇒ lỗi nêu dòng", async () => {
    const row = dongTho({ ...DONG_BAN[0]!, "Mã giao dịch": "FT-1" });
    const { loi } = loiCua(await docFilePos(taoXlsx([row]), "a.xlsx"));
    expect(loi).toMatch(/dòng 2/i);
    expect(loi).toMatch(/Mã giao dịch/);
  });

  it("[POS-12] số thẻ ĐẦY ĐỦ lọt vào file ⇒ che còn 6 đầu + 4 cuối", async () => {
    const row = dongTho({ ...DONG_BAN[0]!, "Số thẻ": "4111 1111 1111 1234" });
    const ds = dongOk(await docFilePos(taoXlsx([row]), "a.xlsx"));
    expect(ds[0]!.soTheMasked).toBe("411111******1234");
  });

  it("[POS-12b] mã giao dịch là Ô SỐ ⇒ chuỗi số, không mất chữ số", async () => {
    const row = dongTho({ ...DONG_BAN[0]!, "Mã giao dịch": 123456789012 });
    const ds = dongOk(await docFilePos(taoXlsx([row]), "a.xlsx"));
    expect(ds[0]!.maGiaoDich).toBe("123456789012");
  });

  it("[POS-12c] số thẻ đầy đủ có dấu CHẤM / lẫn chữ ⇒ vẫn che", async () => {
    for (const [vao, ra] of [
      ["4111.1111.1111.1234", "411111******1234"],
      ["VISA 4111111111111234", "VISA 411111******1234"],
    ] as const) {
      const row = dongTho({ ...DONG_BAN[0]!, "Số thẻ": vao });
      const ds = dongOk(await docFilePos(taoXlsx([row]), "a.xlsx"));
      expect(ds[0]!.soTheMasked).toBe(ra);
    }
  });

  it("[POS-13] vùng `!ref` PHỒNG (dòng trống định dạng sẵn) ⇒ không quét từng dòng trống", async () => {
    // Kế toán mở file, định dạng cả cột rồi lưu ⇒ `<dimension>` tới dòng 200.000, chỉ 1 dòng dữ
    // liệu. Sửa THẲNG thẻ dimension trong XML (đúng hình dạng file thật) — dựng bằng `XLSX.write`
    // với `!ref` lớn thì chính bước dựng fixture đã chậm cỡ bản lỗi và ca hết giờ khi chạy cả bộ.
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(taoXlsx([dongTho(DONG_BAN[0]!)]));
    const tenSheet = Object.keys(zip.files).find((k) => /^xl\/worksheets\/sheet1\.xml$/.test(k))!;
    const xml = await zip.file(tenSheet)!.async("string");
    const xmlPhong = xml.replace(/<dimension ref="[^"]*"\s*\/>/, '<dimension ref="A1:BM200000"/>');
    expect(xmlPhong, "fixture phải thật sự mang dimension phồng").toContain('ref="A1:BM200000"');
    zip.file(tenSheet, xmlPhong);
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    const t0 = performance.now();
    const ds = dongOk(await docFilePos(bytes, "a.xlsx"));
    const ms = performance.now() - t0;
    expect(ds).toHaveLength(1);
    // Bản quét theo `!ref` đo ~7 giây trên máy dev; bản đúng dưới 100ms.
    expect(ms, `đọc mất ${Math.round(ms)}ms`).toBeLessThan(2_000);
  });
});
