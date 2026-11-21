// Ca [HMC-W*] — LƯỚI GHIM DÂY NỐI: đường PHÁT HÀNH qua MISA và NÚT trên màn cùng hỏi MỘT hàm
// `phapNhanPhatHanhChoCoSo` (S1 Invoice Hub, 01/11/2026).
//
// Vì sao cần lưới đọc mã: máy phát hành chạm DB, nút là hàm thuần, và hai bên được giả lập ở mọi test hành vi khác
// (`_actions.misa.test.ts` giả cả `batDauPhatHanh`). Gỡ lời gọi resolver khỏi MỘT trong hai chỗ thì không ca hành vi nào
// ngoài bộ Postgres đỏ — và bộ Postgres không chạy trong job `Unit tests` của CI. Hậu quả nếu lọt: nút nói một đằng,
// hoá đơn pháp lý đứng tên một nẻo (luật 12) — đúng lỗi audit 03 §3.3.
//
// Quy ước (CLAUDE.md "Mẫu test: LƯỚI GHIM MÃ NGUỒN"): đọc mã ĐÃ BỎ chú thích (chú thích giải thích bản vá chứa đúng chuỗi
// đang tìm), neo vào LỜI GỌI có `(` chứ không neo vào dòng import, đếm SỐ LẦN khớp, không dùng cờ `/s`.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const boChuThich = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|[^:"'`])\/\/.*$/, "$1"))
    .join("\n");
const doc = (f: string) => boChuThich(readFileSync(resolve(process.cwd(), f), "utf8"));
const dem = (src: string, re: RegExp) => src.match(new RegExp(re.source, "g"))?.length ?? 0;

const MAY = "lib/finance/hoa-don/phat-hanh-misa.ts";
const PHIEU = "lib/finance/hoa-don/phieu-phat-hanh.ts";
const HANG_CHO = "lib/finance/hoa-don/dong-hang-cho.ts";

/** Thân một hàm `export async function <ten>(` — tới hàm export kế tiếp. */
function than(src: string, ten: string): string {
  const i = src.indexOf(`export async function ${ten}(`);
  if (i < 0) return "";
  const j = src.indexOf("export async function ", i + 10);
  return src.slice(i, j < 0 ? undefined : j);
}

/** Thân hàm KHÔNG export `async function <ten>(` — tới hàm cấp module kế tiếp. */
function thanNoiBo(src: string, ten: string): string {
  const i = src.indexOf(`\nasync function ${ten}(`);
  if (i < 0) return "";
  const j = src.slice(i + 10).search(/\n(?:export )?(?:async )?function |\nexport (?:type|class|const) /);
  return src.slice(i, j < 0 ? undefined : i + 10 + j);
}

describe("[HMC-W1] máy phát hành lấy pháp nhân + ký hiệu từ CẤU HÌNH cơ sở, ở CẢ HAI cửa vào", () => {
  const may = doc(MAY);
  const bd = than(may, "batDauPhatHanh");
  const lai = than(may, "phatHanhLai");

  it("fixture: tìm được thân hai hàm (nếu rỗng, mọi ca dưới xanh vì không soi gì)", () => {
    expect(bd.length).toBeGreaterThan(500);
    expect(lai.length).toBeGreaterThan(500);
  });

  it("batDauPhatHanh và phatHanhLai mỗi nơi gọi `phapNhanPhatHanhTrongTx(` ĐÚNG MỘT lần", () => {
    expect(dem(bd, /\bphapNhanPhatHanhTrongTx\(/)).toBe(1);
    expect(dem(lai, /\bphapNhanPhatHanhTrongTx\(/)).toBe(1);
  });

  it("helper nội bộ gọi resolver `phapNhanPhatHanhChoCoSo(` ĐÚNG MỘT lần và là nơi DUY NHẤT trong tệp (không chép tại chỗ)", () => {
    const h = thanNoiBo(may, "phapNhanPhatHanhTrongTx");
    expect(h.length).toBeGreaterThan(100);
    expect(dem(h, /\bphapNhanPhatHanhChoCoSo\(/)).toBe(1);
    expect(dem(may, /\bphapNhanPhatHanhChoCoSo\(/)).toBe(1);
    expect(dem(h, /\bdocCauHinhDangBatTrongTx\(/)).toBe(1);
  });

  it("helper KHÔNG truyền pháp nhân mặc định / chế độ MAC_DINH (không có đường rơi về mặc định)", () => {
    const h = thanNoiBo(may, "phapNhanPhatHanhTrongTx");
    expect(dem(h, /\bmacDinh\b/)).toBe(0);
    expect(dem(h, /\bphapNhanChoDon\b/)).toBe(0);
    expect(dem(h, /MAC_DINH/)).toBe(0);
  });

  it("helper đọc ngày theo CHÍNH ngày in trên hoá đơn (`ngayLichVn(now)`), không đồng hồ thứ hai", () => {
    const h = thanNoiBo(may, "phapNhanPhatHanhTrongTx");
    expect(dem(h, /ngay:\s*ngayLichVn\(now\)/)).toBe(1);
    expect(dem(h, /\bnew Date\(|\bDate\.now\(/)).toBe(0);
  });

  it("cổng đứng TRƯỚC phép ghi đầu tiên: resolver gọi trước `tx.hoaDonDienTu.create(` (batDau) và `.updateMany(` (phatHanhLai)", () => {
    const iCreate = bd.indexOf("tx.hoaDonDienTu.create(");
    const iGate = bd.indexOf("phapNhanPhatHanhTrongTx(");
    expect(iCreate).toBeGreaterThan(0);
    expect(iGate).toBeGreaterThan(0);
    expect(iGate).toBeLessThan(iCreate);
    const iUpd = lai.indexOf("tx.hoaDonDienTu.updateMany(");
    const iGate2 = lai.indexOf("phapNhanPhatHanhTrongTx(");
    expect(iUpd).toBeGreaterThan(0);
    expect(iGate2).toBeGreaterThan(0);
    expect(iGate2).toBeLessThan(iUpd);
  });

  it("thiếu cấu hình ⇒ NÉM LoiPhatHanh (return không rollback)", () => {
    const h = thanNoiBo(may, "phapNhanPhatHanhTrongTx");
    expect(dem(h, /throw new LoiPhatHanh\("CAU_HINH_CO_SO"/)).toBe(1);
  });

  it("`input.nguon` KHÔNG còn mang pháp nhân: không ai đọc `input.nguon.phapNhan`, kiểu `NguonPhieu` không có trường `phapNhan`", () => {
    expect(dem(may, /\binput\.nguon\.phapNhan\b/)).toBe(0);
    const kieu = may.slice(may.indexOf("export type NguonPhieu = {"), may.indexOf("};", may.indexOf("export type NguonPhieu = {")));
    expect(kieu.length).toBeGreaterThan(20);
    expect(dem(kieu, /\bphapNhan\b/)).toBe(0);
  });

  it("ký hiệu trên phiếu KHÔNG đến từ hằng pháp nhân: không `phapNhan.kyHieu` ở máy, không `kyHieuTheoNam` ở dựng phiếu", () => {
    expect(dem(may, /\bphapNhan\.kyHieu\b/)).toBe(0);
    expect(dem(may, /\bkyHieuTheoNam\b/)).toBe(0);
    const phieu = doc(PHIEU);
    expect(dem(phieu, /\bphapNhan\.kyHieu\b/)).toBe(0);
    expect(dem(phieu, /\bkyHieuTheoNam\b/)).toBe(0);
  });

  it("mỗi nơi dựng phiếu truyền `kyHieu:` lấy từ kết quả resolver (một lần ở batDau, một lần ở phatHanhLai)", () => {
    expect(dem(bd, /\bkyHieu:\s*pnPhatHanh\.kyHieu\b/)).toBe(1);
    expect(dem(lai, /\bkyHieu:\s*pnPhatHanh\.kyHieu\b/)).toBe(1);
  });
});

describe("[HMC-W2] nút trên dòng hàng chờ hỏi CÙNG resolver, không chế độ mặc định", () => {
  const src = doc(HANG_CHO);
  it("dong-hang-cho gọi `phapNhanPhatHanhChoCoSo(` ĐÚNG MỘT lần và không còn `phapNhanTheoCauHinh(`", () => {
    expect(dem(src, /\bphapNhanPhatHanhChoCoSo\(/)).toBe(1);
    expect(dem(src, /\bphapNhanTheoCauHinh\(/)).toBe(0);
  });
  it("không còn chế độ MAC_DINH ở hàng chờ (chế độ ấy là gốc của nút sáng mà máy từ chối)", () => {
    expect(dem(src, /"MAC_DINH"/)).toBe(0);
    expect(dem(src, /khiThieuCauHinh/)).toBe(0);
  });
  it("kết quả resolver đi vào nút: `thieuCauHinh:` truyền ĐÚNG MỘT lần vào nutPhatHanhMisa", () => {
    const i = src.indexOf("nutPhatHanhMisa({");
    expect(i).toBeGreaterThan(0);
    const khoi = src.slice(i, src.indexOf("});", i));
    expect(dem(khoi, /\bthieuCauHinh:\s*pnPhatHanh\.ok\s*\?\s*null\s*:\s*pnPhatHanh\.error\b/)).toBe(1);
  });
});

describe("[HMC-W3] không có đường dựng phiếu phát hành thứ hai", () => {
  it("`dungPhieuPhatHanh(` chỉ được gọi trong máy phát hành (2 lần: batDau + phatHanhLai) — nơi khác dựng tờ gửi MISA là bỏ qua cổng cấu hình", () => {
    const ra = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "lib", "app"], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const goi = ra
      .split(/\r?\n/)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
      .map((f) => {
        try {
          return { f, n: dem(doc(f), /\bdungPhieuPhatHanh\(/) };
        } catch {
          return { f, n: 0 };
        }
      })
      .filter((x) => x.n > 0);
    // phieu-phat-hanh.ts giữ ĐỊNH NGHĨA (1 lần khớp `dungPhieuPhatHanh(`); máy phát hành 2 lời gọi.
    expect(Object.fromEntries(goi.map((x) => [x.f, x.n]))).toEqual({ [PHIEU]: 1, [MAY]: 2 });
  });
});
