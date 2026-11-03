/**
 * [HDUI-H*] — tệp chữ hướng dẫn của khu Hoá đơn (`huong-dan.ts`).
 *
 * Bốn thứ cần giữ:
 *   1. Mọi khoá cần có đều tồn tại, chữ ngắn, sạch (không thẻ, không "TODO").
 *   2. K11 / TD-10: chữ PHÁP LÝ–THUẾ trung tính — không viện dẫn văn bản, điều khoản, tỉ lệ — và gắn cờ "cần kế toán
 *      duyệt". Dev tự viết sai chữ pháp lý là lỗi đắt; lưới này chặn kiểu viện dẫn cụ thể lọt vào.
 *   3. Số giờ hiệu lực của QR là THAM SỐ BẮT BUỘC (luật 7), không hardcode "4 giờ" (OD-11 chưa chốt TTL).
 *   4. Khoá không mồ côi / không dùng khoá không tồn tại — quét CÂY mã nguồn bằng hàm thuần (khuôn
 *      affordance-coverage). Từ lát S7 trang Cấu hình đã gọi `huongDan(...)` cho 13 khoá (khoá
 *      được nối thì GỠ khỏi CHO_NOI_TRANG); vế "chưa dùng phải khai CHO_NOI_TRANG" vẫn canh các khoá còn lại.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CAC_KHOA_HUONG_DAN,
  TOI_DA_KY_TU_HUONG_DAN,
  huongDan,
  thongTinHuongDan,
  type KhoaHuongDan,
} from "./huong-dan";
import { TOI_THIEU_LY_DO_HOA_DON } from "./trang-thai-hoa-don";

const KHOA_BAT_BUOC = [
  "coc",
  "ky-hieu",
  "hsm",
  "qr-thong-tin-hoa-don",
  "phap-nhan",
  "nha-cung-cap",
  "phuong-thuc-ky",
  "nghia-vu-hoa-don",
  "lech-so",
  "can-dieu-chinh",
  "thue",
] as const satisfies readonly KhoaHuongDan[];

/** Khoá thuộc nhóm pháp lý–thuế: bắt buộc cờ "cần kế toán duyệt". */
const KHOA_PHAP_LY = [
  "coc",
  "ky-hieu",
  "thue",
  "nghia-vu-hoa-don",
  "can-dieu-chinh",
  "phap-nhan",
  "ngay-phat-hanh",
  "xuat-theo-so-da-thu",
  "chinh-sach-hoa-don",
  "soan-cs-thue",
] as const;

/** Đọc chữ của một khoá; khoá có tham số thì truyền 24 giờ cho đủ. */
function chuCua(khoa: KhoaHuongDan): string {
  return khoa === "qr-thong-tin-hoa-don" ? huongDan(khoa, 24) : huongDan(khoa);
}

// ─── H1 · có đủ khoá, chữ sạch, ngắn ────────────────────────────────────────────────────────────────────────────

describe("[HDUI-H1] đủ khoá cần dùng, mỗi khoá có chữ sạch và ngắn", () => {
  it("mọi khoá bắt buộc đều tồn tại", () => {
    for (const k of KHOA_BAT_BUOC) expect(CAC_KHOA_HUONG_DAN, k).toContain(k);
  });

  it("danh sách khoá không trùng", () => {
    expect(new Set(CAC_KHOA_HUONG_DAN).size).toBe(CAC_KHOA_HUONG_DAN.length);
  });

  it.each([...CAC_KHOA_HUONG_DAN])("%s: không rỗng, ≤ trần ký tự (NFC), không thẻ/TODO, không khoảng trắng thừa", (khoa) => {
    const chu = chuCua(khoa);
    expect(chu.trim().length).toBeGreaterThanOrEqual(30);
    // Đếm sau NFC: chữ có dấu gõ kiểu tổ hợp không được tính thành 2 ký tự.
    expect(chu.normalize("NFC").length).toBeLessThanOrEqual(TOI_DA_KY_TU_HUONG_DAN);
    expect(chu).not.toMatch(/[<>]|TODO|FIXME|lorem/i);
    expect(chu).toBe(chu.trim());
    expect(chu).not.toMatch(/ {2,}|\n/);
  });

  it("trần ký tự là con số cụ thể, không bị nới đến vô nghĩa", () => {
    expect(TOI_DA_KY_TU_HUONG_DAN).toBeLessThanOrEqual(240);
    expect(TOI_DA_KY_TU_HUONG_DAN).toBeGreaterThanOrEqual(120);
  });
});

// ─── H2 · số giờ hiệu lực của QR là tham số ─────────────────────────────────────────────────────────────────────

/** Bỏ chú thích — câu giải thích bản vá hay chứa đúng chuỗi đang cấm (luật 11). */
function boChuThich(x: string): string {
  return x
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

describe("[HDUI-H2] QR thông tin hoá đơn: 'có hiệu lực N giờ' lấy từ tham số", () => {
  it("N khác nhau ⇒ chữ khác nhau và mang đúng N", () => {
    const a = huongDan("qr-thong-tin-hoa-don", 2);
    const b = huongDan("qr-thong-tin-hoa-don", 48);
    expect(a).not.toBe(b);
    expect(a).toContain("2 giờ");
    expect(b).toContain("48 giờ");
    expect(a).not.toContain("48 giờ");
  });

  it("tham số không hợp lệ ⇒ ném, KHÔNG in 'NaN giờ' hay '0 giờ'", () => {
    for (const x of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => huongDan("qr-thong-tin-hoa-don", x), String(x)).toThrow();
    }
  });

  it("tệp nguồn không hardcode bất kỳ '<số> giờ' nào (ngoài chú thích)", () => {
    const src = boChuThich(fs.readFileSync(path.join(process.cwd(), "lib/finance/hoa-don/huong-dan.ts"), "utf8"));
    expect(src.match(/\d+\s*giờ/g) ?? []).toEqual([]);
  });

  it("kiểu: thiếu tham số, hoặc truyền tham số cho khoá không cần, đều là LỖI BIÊN DỊCH", () => {
    // @ts-expect-error — khoá QR bắt buộc có số giờ (luật 7: tham số nguy hiểm không có mặc định)
    expect(() => huongDan("qr-thong-tin-hoa-don")).toThrow();
    // @ts-expect-error — khoá thường không nhận tham số
    expect(huongDan("coc", 5)).toBe(huongDan("coc"));
  });
});

// ─── H3 · K11 / TD-10: chữ pháp lý–thuế trung tính, cờ cần kế toán duyệt ────────────────────────────────────────

/** Viện dẫn cụ thể: văn bản, điều/khoản, tỉ lệ, "theo quy định…". Không được có trong chữ hướng dẫn (TD-10). */
export const VIEN_DAN_CU_THE =
  /Nghị định|Thông tư|Luật|Bộ luật|Điều\s*\d|khoản\s*\d|\bNĐ\b|\bTT\b|\d+\s*\/\s*\d{2,4}|\d+(?:[.,]\d+)?\s*%|theo\s+(?:quy\s*định|pháp\s*luật)|bắt\s*buộc\s+theo/i;

describe("[HDUI-H3] chữ pháp lý–thuế: trung tính + cờ cần kế toán duyệt", () => {
  it.each([...KHOA_PHAP_LY])("%s: loại pháp lý–thuế, canKeToanDuyet=true, chữ dẫn về kế toán", (khoa) => {
    const tt = thongTinHuongDan(khoa);
    expect(tt.loai).toBe("phap-ly-thue");
    expect(tt.canKeToanDuyet).toBe(true);
    expect(chuCua(khoa)).toMatch(/kế toán/i);
  });

  it("MỌI khoá loại pháp lý–thuế (kể cả khoá thêm sau này) đều có cờ duyệt", () => {
    for (const k of CAC_KHOA_HUONG_DAN) {
      const tt = thongTinHuongDan(k);
      if (tt.loai === "phap-ly-thue") expect(tt.canKeToanDuyet, k).toBe(true);
    }
  });

  it("không khoá nào viện dẫn văn bản / điều khoản / tỉ lệ (kiểm cả bản QR với nhiều N)", () => {
    for (const k of CAC_KHOA_HUONG_DAN) expect(chuCua(k), k).not.toMatch(VIEN_DAN_CU_THE);
    expect(huongDan("qr-thong-tin-hoa-don", 48)).not.toMatch(VIEN_DAN_CU_THE);
  });

  it("bộ so khớp THẬT SỰ cắn: bắt các kiểu viện dẫn mẫu, bỏ qua chữ trung tính", () => {
    for (const xau of [
      "Theo Nghị định 254/2026 thì phải xuất",
      "Thông tư 91 quy định",
      "Điều 5 Luật thuế",
      "Thuế suất 8% đến hết năm",
      "Áp dụng 10 %",
      "Việc này bắt buộc theo luật",
      "Làm theo quy định hiện hành",
    ]) {
      expect(xau, xau).toMatch(VIEN_DAN_CU_THE);
    }
    expect(VIEN_DAN_CU_THE.test("Hỏi kế toán trước khi xuất hoá đơn cho khoản này.")).toBe(false);
  });
});

// ─── H5 · lỗ canh: cờ duyệt từng khoá, ngưỡng lý do, chữ theo khoá ────────────────────────────────────────────────

/**
 * Bảng cờ ĐÓNG ĐINH từng khoá. H3 chỉ quét khoá loại pháp-lý-thuế; khoá `van-hanh` NHƯNG chạm dữ liệu cá nhân (QR — OD-11)
 * cũng phải chờ kế toán duyệt, và không quy tắc "theo loại" nào suy ra được điều đó. Đổi một cờ = đổi bảng này, có chủ ý.
 */
const CO_DUYET_DU_KIEN: Record<KhoaHuongDan, { loai: "van-hanh" | "phap-ly-thue"; canKeToanDuyet: boolean }> = {
  coc: { loai: "phap-ly-thue", canKeToanDuyet: true },
  "ky-hieu": { loai: "phap-ly-thue", canKeToanDuyet: true },
  "ngoai-le-ky-hieu": { loai: "van-hanh", canKeToanDuyet: false },
  "ngay-phat-hanh": { loai: "phap-ly-thue", canKeToanDuyet: true },
  "xuat-theo-so-da-thu": { loai: "phap-ly-thue", canKeToanDuyet: true },
  hsm: { loai: "van-hanh", canKeToanDuyet: false },
  "qr-thong-tin-hoa-don": { loai: "van-hanh", canKeToanDuyet: true },
  "phap-nhan": { loai: "phap-ly-thue", canKeToanDuyet: true },
  "nha-cung-cap": { loai: "van-hanh", canKeToanDuyet: false },
  "phuong-thuc-ky": { loai: "van-hanh", canKeToanDuyet: false },
  "nghia-vu-hoa-don": { loai: "phap-ly-thue", canKeToanDuyet: true },
  "lech-so": { loai: "van-hanh", canKeToanDuyet: false },
  "can-dieu-chinh": { loai: "phap-ly-thue", canKeToanDuyet: true },
  thue: { loai: "phap-ly-thue", canKeToanDuyet: true },
  "chinh-sach-hoa-don": { loai: "phap-ly-thue", canKeToanDuyet: true },
  "mo-phong-chinh-sach": { loai: "van-hanh", canKeToanDuyet: false },
  "duyet-hai-nguoi": { loai: "van-hanh", canKeToanDuyet: false },
  "che-do-toi-da": { loai: "van-hanh", canKeToanDuyet: false },
  "che-do-hub": { loai: "van-hanh", canKeToanDuyet: false },
  "cau-hinh-chi-doc": { loai: "van-hanh", canKeToanDuyet: false },
  "moi-truong-nha-cung-cap": { loai: "van-hanh", canKeToanDuyet: false },
  "soan-cs-tong-quan": { loai: "van-hanh", canKeToanDuyet: false },
  "soan-cs-hieu-luc": { loai: "van-hanh", canKeToanDuyet: false },
  "soan-cs-thoi-diem": { loai: "van-hanh", canKeToanDuyet: false },
  "soan-cs-che-do": { loai: "van-hanh", canKeToanDuyet: false },
  "soan-cs-thue": { loai: "phap-ly-thue", canKeToanDuyet: true },
  "soan-cs-ap-dung": { loai: "van-hanh", canKeToanDuyet: false },
};

/** Cụm chữ ĐẶC TRƯNG của từng khoá (không phải toàn văn — kế toán/BA sửa chữ được, chỉ không được đảo ý giữa các khoá). */
const CUM_DAC_TRUNG: Record<KhoaHuongDan, string> = {
  coc: "tiền cọc",
  "ky-hieu": "Nhóm chữ và số",
  "ngoai-le-ky-hieu": "khác cấu hình của cơ sở",
  "ngay-phat-hanh": "sau hôm nay",
  "xuat-theo-so-da-thu": "chưa tính phần còn nợ",
  hsm: "thiết bị ký số đặt ở phía",
  "qr-thong-tin-hoa-don": "Mã QR",
  "phap-nhan": "mã số thuế",
  "nha-cung-cap": "phần mềm hoá đơn điện tử",
  "phuong-thuc-ky": "USB token",
  "nghia-vu-hoa-don": "Khoản chưa rõ",
  "lech-so": "không khớp",
  "can-dieu-chinh": "không còn đúng",
  thue: "Thuế GTGT",
  "chinh-sach-hoa-don": "bộ quy tắc lập hoá đơn",
  "mo-phong-chinh-sach": "khoản mẫu",
  "duyet-hai-nguoi": "Người soạn cũng duyệt được",
  "che-do-toi-da": "Mức tự động cao nhất",
  "che-do-hub": "Mức Hub đang bật",
  "cau-hinh-chi-doc": "chỉ hiển thị",
  "moi-truong-nha-cung-cap": "Môi trường thử nghiệm",
  "soan-cs-tong-quan": "5 bước dưới đây",
  "soan-cs-hieu-luc": "Ngày áp dụng",
  "soan-cs-thoi-diem": "đang làm theo cách nào",
  "soan-cs-che-do": "Chạy thử (không phát hành)",
  "soan-cs-thue": "mở một hoá đơn công ty ĐÃ xuất",
  "soan-cs-ap-dung": "Gửi duyệt và áp dụng ngay",
};

describe("[HDUI-H5a] cờ 'cần kế toán duyệt' của TỪNG khoá đúng như đã chốt (kể cả khoá van-hanh chạm dữ liệu cá nhân)", () => {
  it("bảng cờ khớp, đủ mọi khoá (khoá mới thêm mà quên khai ở đây ⇒ đỏ)", () => {
    expect(Object.keys(CO_DUYET_DU_KIEN).sort()).toEqual([...CAC_KHOA_HUONG_DAN].sort());
    for (const k of CAC_KHOA_HUONG_DAN) expect(thongTinHuongDan(k), k).toEqual(CO_DUYET_DU_KIEN[k]);
  });

  it("QR thông tin hoá đơn: loại van-hanh NHƯNG canKeToanDuyet=true (chạm dữ liệu cá nhân phụ huynh)", () => {
    const tt = thongTinHuongDan("qr-thong-tin-hoa-don");
    expect(tt.loai).toBe("van-hanh");
    expect(tt.canKeToanDuyet).toBe(true);
  });
});

describe("[HDUI-H5b] chữ 'ngoai-le-ky-hieu' nói đúng ngưỡng lý do mà nghiệp vụ thật đòi", () => {
  it("con số 'ít nhất N ký tự' = TOI_THIEU_LY_DO_HOA_DON (không nói 5 trong khi form đòi 10)", () => {
    expect(huongDan("ngoai-le-ky-hieu")).toContain(`ít nhất ${TOI_THIEU_LY_DO_HOA_DON} ký tự`);
  });

  it("chữ không nêu con số 'ít nhất' nào khác ngưỡng thật", () => {
    const cacSo = [...huongDan("ngoai-le-ky-hieu").matchAll(/ít nhất\s+(\d+)/g)].map((m) => Number(m[1]));
    expect(cacSo).toEqual([TOI_THIEU_LY_DO_HOA_DON]);
  });
});

describe("[HDUI-H5d] chữ 'moi-truong-nha-cung-cap' không hứa một rào mà mã chưa có (luật 12)", () => {
  // Cột `moiTruongNcc` hôm nay CHỈ được đọc + hiển thị: không nơi nào so nó với `MISA_EINVOICE_MODE` / host (đo `grep moiTruongNcc` 01/11).
  // Rào đang chạy là `kiemBaseUrl` (sandbox chỉ nhận host thử, production từ chối host thử). Khi HCT-11 (S6) làm xong phép so cột, SỬA chữ + ca này CÙNG LÚC.
  it("nói rõ cột chỉ để xem / chưa tự đối chiếu, và KHÔNG nói 'từ chối phát hành' do cột lệch", () => {
    const chu = huongDan("moi-truong-nha-cung-cap");
    expect(chu).toMatch(/chỉ để xem/);
    expect(chu).toMatch(/CHƯA tự đối chiếu/);
    expect(chu).not.toMatch(/lệch nhau thì từ chối phát hành/);
    expect(chu).not.toMatch(/hệ thống còn đối chiếu/i);
  });
});

describe("[HDUI-H5c] chữ đi ĐÚNG khoá: không đảo chữ giữa các khoá, không biến đổi chữ", () => {
  const nfc = (s: string) => s.normalize("NFC");

  it.each([...CAC_KHOA_HUONG_DAN])("%s: mang cụm đặc trưng của chính nó, và KHÔNG mang cụm của khoá khác", (khoa) => {
    const chu = nfc(chuCua(khoa));
    expect(chu, khoa).toContain(nfc(CUM_DAC_TRUNG[khoa]));
    for (const khac of CAC_KHOA_HUONG_DAN) {
      if (khac === khoa) continue;
      expect(chu.includes(nfc(CUM_DAC_TRUNG[khac])), `${khoa} không được chứa cụm của ${khac}`).toBe(false);
    }
  });

  it("mỗi khoá một chữ, không hai khoá trùng chữ", () => {
    expect(new Set(CAC_KHOA_HUONG_DAN.map((k) => chuCua(k))).size).toBe(CAC_KHOA_HUONG_DAN.length);
  });

  it("khoá không tham số: gọi nhiều lần ra cùng một chữ, KHÔNG biến đổi hoa/thường", () => {
    for (const k of CAC_KHOA_HUONG_DAN) {
      if (k === "qr-thong-tin-hoa-don") continue;
      const chu = huongDan(k);
      expect(huongDan(k), k).toBe(chu);
      expect(chu, k).not.toBe(chu.toUpperCase());
      expect(chu, k).not.toBe(chu.toLowerCase());
      expect(chu.charAt(0), k).toBe(chu.charAt(0).toUpperCase());
    }
  });
});

// ─── H4 · quét cây: khoá dùng ⊆ khoá tồn tại; khoá chưa dùng phải khai CHO_NOI_TRANG ────────────────────────────

/**
 * THUẦN — các khoá được gọi qua `huongDan("<khoá>"` trong một đoạn nguồn (đã bỏ chú thích), và số lời gọi mà đối số
 * đầu KHÔNG phải chuỗi literal (gọi động làm mù lưới này nên bị đếm riêng và cấm ở cây thật).
 * Neo vào LỜI GỌI: một dòng `import { huongDan }` không được tính là dùng.
 */
export function quetKhoaHuongDan(src: string): { khoa: string[]; dong: number } {
  const s = boChuThich(src);
  const khoa: string[] = [];
  let dong = 0;
  for (const m of s.matchAll(/\bhuongDan\s*\(\s*([^),]*)/g)) {
    const doiSo = (m[1] ?? "").trim();
    const lit = /^(["'`])([A-Za-z0-9-]+)\1$/.exec(doiSo);
    if (lit) khoa.push(lit[2]!);
    else dong += 1;
  }
  return { khoa, dong };
}

/**
 * Khoá CHƯA có trang nào gọi — lát S5a dựng nền, trang do lát khác nối. Khi nối một khoá thì GỠ nó khỏi đây
 * (ca "đã dùng mà vẫn khai chờ nối" sẽ đỏ để buộc việc đó). Danh sách chỉ được NGẮN ĐI.
 */
export const CHO_NOI_TRANG: readonly KhoaHuongDan[] = [
  "coc",
  "ngoai-le-ky-hieu",
  "ngay-phat-hanh",
  "xuat-theo-so-da-thu",
  "hsm",
  "nghia-vu-hoa-don",
  "lech-so",
  "can-dieu-chinh",
];

function moiTepNguon(): string[] {
  const ra: string[] = [];
  const bo = path.join("lib", "finance", "hoa-don", "huong-dan.ts");
  const di = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) di(p);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name) && path.relative(process.cwd(), p) !== bo) ra.push(p);
    }
  };
  for (const g of ["app", "components", "lib"]) di(path.join(process.cwd(), g));
  return ra;
}

describe("[HDUI-H4] khoá hướng dẫn: không dùng khoá lạ, không để khoá mồ côi im lặng", () => {
  it("bộ quét thuần: bắt lời gọi, bỏ import/chú thích, đếm gọi động", () => {
    expect(quetKhoaHuongDan('const a = huongDan("coc")').khoa).toEqual(["coc"]);
    expect(quetKhoaHuongDan('huongDan("qr-thong-tin-hoa-don", gio)').khoa).toEqual(["qr-thong-tin-hoa-don"]);
    expect(quetKhoaHuongDan('import { huongDan } from "@/lib/finance/hoa-don/huong-dan";').khoa).toEqual([]);
    expect(quetKhoaHuongDan('// huongDan("coc")\n/* huongDan("thue") */').khoa).toEqual([]);
    expect(quetKhoaHuongDan("huongDan(khoa)")).toEqual({ khoa: [], dong: 1 });
    expect(quetKhoaHuongDan("huongDan(`co${x}`)").dong).toBe(1);
  });

  const tep = moiTepNguon();
  const duyet = tep.map((p) => ({ p, ...quetKhoaHuongDan(fs.readFileSync(p, "utf8")) }));
  const dung = new Set(duyet.flatMap((d) => d.khoa));

  it("quét thật có đọc cây (chống lưới rỗng)", () => {
    expect(tep.length).toBeGreaterThan(500);
  });

  it("không ai gọi động huongDan(biến) — làm mù lưới này", () => {
    expect(duyet.filter((d) => d.dong > 0).map((d) => path.relative(process.cwd(), d.p))).toEqual([]);
  });

  it("khoá đã dùng đều tồn tại trong bảng", () => {
    const la = [...dung].filter((k) => !(CAC_KHOA_HUONG_DAN as readonly string[]).includes(k));
    expect(la).toEqual([]);
  });

  it("khoá CHƯA ai dùng thì phải khai CHO_NOI_TRANG (không mồ côi im lặng)", () => {
    const moiCoi = CAC_KHOA_HUONG_DAN.filter((k) => !dung.has(k) && !CHO_NOI_TRANG.includes(k));
    expect(moiCoi).toEqual([]);
  });

  it("khoá khai CHO_NOI_TRANG mà ĐÃ có người dùng thì gỡ khỏi danh sách (khai báo không lỗi thời)", () => {
    const loiThoi = CHO_NOI_TRANG.filter((k) => dung.has(k));
    expect(loiThoi).toEqual([]);
  });

  it("CHO_NOI_TRANG chỉ chứa khoá có thật", () => {
    const la = CHO_NOI_TRANG.filter((k) => !(CAC_KHOA_HUONG_DAN as readonly string[]).includes(k));
    expect(la).toEqual([]);
  });
});
