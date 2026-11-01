// Ca [PHM-W*] — LƯỚI GHIM DÂY NỐI của "Phát hành qua MISA" (bước 1, 30/09/2026).
//
// Hai luật mà test hành vi không chứng minh được (action + máy trạng thái đều bị giả ở tầng trên):
//   (1) MỌI đường tới cổng MISA đi qua `layCongHoaDon()` — không ai tự dựng cổng (`congHoaDonTuEnv`), và chỉ
//       máy trạng thái gọi `phatHanh` / `traCuu` / `taiTep`. Một lời gọi cổng thứ hai là một chỗ sinh refId /
//       gửi lại mà không qua luật "KHONG_RO ⇒ tra trước" — đúng lớp lỗi tạo hoá đơn trùng.
//   (2) Nút vẽ theo CÙNG điều kiện action gác: component đọc `dong.phatHanhMisa` / `misa.*`, action đọc đúng các
//       trường đó trên dòng LOADER dựng lại, loader dựng chúng từ công tắc + cổng. Gỡ một vế ⇒ nút nói một đằng,
//       action làm một nẻo (luật 12), và không test hành vi nào đỏ.
// Đọc mã ĐÃ BỎ chú thích (chú thích giải thích bản vá chứa đúng chuỗi đang tìm — luật 11). Đếm SỐ LẦN khớp.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const TRAN_QUET_MS = 30_000;
const boChuThich = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|[^:"'`])\/\/.*$/, "$1"))
    .join("\n");
const doc = (f: string) => boChuThich(readFileSync(resolve(process.cwd(), f), "utf8"));
const dem = (src: string, re: RegExp) => src.match(new RegExp(re.source, "g"))?.length ?? 0;

const ACTIONS = "app/(admin)/admin/payments/hoa-don/_actions.ts";
const MAY = "lib/finance/hoa-don/phat-hanh-misa.ts";
const CONG = "lib/finance/hoa-don/cong-phat-hanh.ts";
const HANG_CHO = "lib/finance/hoa-don/hang-cho.ts";
const CRON = "app/api/cron/hoa-don-misa-doi-soat/route.ts";
const UI = "app/(admin)/admin/payments/hoa-don/_components/phat-hanh-misa.tsx";

function maNguon(): { duong: string; src: string }[] {
  const ra = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "lib", "app", "components"], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return ra
    .split(/\r?\n/)
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("lib/misa/"))
    .map((duong) => {
      try {
        return { duong, src: doc(duong) };
      } catch {
        return { duong, src: "" };
      }
    });
}

/** Thân một hàm `export async function <ten>(` — tới hàm export kế tiếp. */
function than(src: string, ten: string): string {
  const i = src.indexOf(`export async function ${ten}(`);
  if (i < 0) return "";
  const j = src.indexOf("export async function ", i + 10);
  return src.slice(i, j < 0 ? undefined : j);
}

describe("[PHM-W1] mọi đường tới cổng MISA đi qua layCongHoaDon", () => {
  const tep = maNguon();
  it("quét được đủ tệp (chống cổng rỗng)", () => {
    expect(tep.length).toBeGreaterThan(500);
  });

  it("KHÔNG ai ngoài cong-phat-hanh.ts nhắc congHoaDonTuEnv (ngoài lib/misa/**)", { timeout: TRAN_QUET_MS }, () => {
    const vi = tep.filter((t) => t.duong !== CONG && /\bcongHoaDonTuEnv\b/.test(t.src)).map((t) => t.duong);
    expect(vi).toEqual([]);
  });

  it("CHỈ máy trạng thái gọi phatHanh / traCuu / taiTep của cổng", { timeout: TRAN_QUET_MS }, () => {
    const vi = tep
      .filter((t) => t.duong !== MAY && /\bcong\??\.(phatHanh|traCuu|taiTep)\(/.test(t.src))
      .map((t) => t.duong);
    expect(vi).toEqual([]);
    const may = doc(MAY);
    expect(dem(may, /\bcong\.phatHanh\(/)).toBe(1);
    expect(dem(may, /\bcong\.traCuu\(/)).toBe(1);
    expect(dem(may, /\bcong\.taiTep\(/)).toBe(1);
  });

  it("layCongHoaDon() được gọi ở ĐÚNG ba chỗ: action (congMisa), loader (nút), cron", { timeout: TRAN_QUET_MS }, () => {
    const noi = tep.filter((t) => t.duong !== CONG && /\blayCongHoaDon\(/.test(t.src)).map((t) => [t.duong, dem(t.src, /\blayCongHoaDon\(/)]);
    expect(Object.fromEntries(noi)).toEqual({ [ACTIONS]: 1, [HANG_CHO]: 1, [CRON]: 1 });
  });

  it("máy trạng thái KHÔNG tự lấy cổng — cổng là tham số", () => {
    expect(dem(doc(MAY), /\blayCongHoaDon\b/)).toBe(0);
  });
});

describe("[PHM-W2] nút vẽ theo CÙNG điều kiện action gác", () => {
  const a = doc(ACTIONS);
  it("bốn action đều qua congKeToanDon; ba action gọi MISA qua congMisa (Bỏ, làm tay thì không — có chủ đích)", () => {
    for (const ten of ["phatHanhQuaMisaAction", "kiemTraLaiPhatHanhAction", "phatHanhLaiAction", "boPhatHanhLamTayAction"]) {
      expect(dem(than(a, ten), /\bcongKeToanDon\(/), ten).toBe(1);
    }
    for (const ten of ["phatHanhQuaMisaAction", "kiemTraLaiPhatHanhAction", "phatHanhLaiAction"]) {
      expect(dem(than(a, ten), /\bcongMisa\(\)/), ten).toBe(1);
    }
    expect(dem(than(a, "boPhatHanhLamTayAction"), /\bcongMisa\(\)/)).toBe(0);
    // congMisa hỏi CẢ công tắc lẫn cổng.
    const i = a.indexOf("async function congMisa(");
    const cm = a.slice(i, a.indexOf("\n}\n", i));
    expect(dem(cm, /\blaMisaPhatHanhBat\(\)/)).toBe(1);
    expect(dem(cm, /\blayCongHoaDon\(\)/)).toBe(1);
  });

  it("action đọc ĐÚNG trường nút trên dòng loader dựng lại", () => {
    const ph = than(a, "phatHanhQuaMisaAction");
    expect(ph).toMatch(/const nut = row\.phatHanhMisa;/);
    expect(ph).toMatch(/if \(!nut\.hien\)/);
    expect(ph).toMatch(/if \(!nut\.bat\)/);
    expect(than(a, "kiemTraLaiPhatHanhAction")).toMatch(/if \(!row\.misa\.kiemTraLai\.bat\)/);
    expect(than(a, "phatHanhLaiAction")).toMatch(/if \(!row\.misa\.phatHanhLai\.bat\)/);
    expect(than(a, "boPhatHanhLamTayAction")).toMatch(/if \(!row\.misa\.boLamTay\.bat\)/);
  });

  it("component vẽ theo ĐÚNG các trường đó", () => {
    const ui = doc(UI);
    expect(ui).toMatch(/const nut = dong\.phatHanhMisa;/);
    expect(ui).toMatch(/if \(!nut\.hien\)/);
    expect(ui).toMatch(/disabled=\{!nut\.bat\}/);
    expect(ui).toMatch(/misa\.kiemTraLai\.bat \?/);
    expect(ui).toMatch(/!misa\.phatHanhLai\.bat/);
    expect(ui).toMatch(/misa\.boLamTay\.bat \?/);
  });

  it("loader dựng `misa` của dòng từ CẢ công tắc + cổng, và truyền xuống dungDongHangCho", () => {
    const l = doc(HANG_CHO);
    const i = l.indexOf("export async function cauHinhMisaDong(");
    const f = l.slice(i, l.indexOf("\n}\n", i));
    expect(dem(f, /\blaMisaPhatHanhBat\(\)/)).toBe(1);
    expect(dem(f, /\blayCongHoaDon\(\)/)).toBe(1);
    // Lời GỌI (không tính dòng khai báo hàm) — đúng một, trong lô `Promise.all` của loader.
    expect(dem(l, /(?<!function )\bcauHinhMisaDong\(\)/)).toBe(1);
    expect(l).toMatch(/gop: opts\.gop \?\? \[\],\s*misa,/);
  });
});

// Smoke 30/09: nút sáng với email sai luật MISA (đuôi 1 chữ), chỉ MISA từ chối lúc gửi. Luật "phiếu hợp lệ theo
// MISA" hỏi ở MỘT chỗ (`lib/misa/meinvoice/anh-xa.ts`) — nút (`kiemNguoiMua` qua `nguoiMuaPhatHanh`) và máy trạng
// thái (`kiemPhieu`, TRƯỚC phép ghi đầu tiên) cùng gọi. Test hành vi của action giả máy trạng thái ⇒ ghim dây nối.
describe("[PHM-W3] luật MISA hỏi ở MỘT chỗ, nút + máy trạng thái cùng gọi", () => {
  const NUT = "lib/finance/hoa-don/nut-phat-hanh-misa.ts";
  it("không ai ngoài lib/misa viết regex email/MST thứ hai theo luật MISA", { timeout: TRAN_QUET_MS }, () => {
    const vi = maNguon()
      .filter((t) => /\[A-Za-z\]\{2,6\}|\d\{10\}\(-\d\{3\}\)\?/.test(t.src))
      .map((t) => t.duong);
    expect(vi).toEqual([]);
  });
  it("nút gọi kiemNguoiMua trên ĐÚNG người mua sẽ gửi (nguoiMuaPhatHanh) — ở CẢ nút phát hành lẫn 'Phát hành lại'", () => {
    const n = doc(NUT);
    expect(dem(n, /\bkiemNguoiMua\(nguoiMuaPhatHanh\(/)).toBe(1);
    // Một phép kiểm dùng cho hai nút: kết quả vào biến rồi mới đọc ở từng nút.
    expect(dem(n, /\bloiNguoiMuaMisa\(/)).toBe(3);
  });
  it("máy trạng thái gọi kiemPhieu (qua chanPhieuKhongHopLe) TRƯỚC phép ghi đầu tiên — batDauPhatHanh (create) và phatHanhLai (updateMany)", () => {
    const m = doc(MAY);
    // Một phép kiểm (`kiemPhieu` trong `chanPhieuKhongHopLe`), gọi ở đúng hai đường tạo / chụp lại phiếu.
    expect(dem(m, /\bkiemPhieu\(/)).toBe(1);
    const i = m.indexOf("function chanPhieuKhongHopLe(");
    expect(i).toBeGreaterThan(0);
    expect(m.slice(i, m.indexOf("\n}\n", i))).toMatch(
      /const loi = kiemPhieu\(phieu\);\s*if \(loi\) throw new LoiPhatHanh\("PHIEU_KHONG_HOP_LE", loi\);/,
    );
    expect(dem(m, /\bchanPhieuKhongHopLe\(/)).toBe(3);
    const bd = than(m, "batDauPhatHanh");
    expect(bd.indexOf("chanPhieuKhongHopLe(phieu)")).toBeGreaterThan(0);
    expect(bd.indexOf("chanPhieuKhongHopLe(phieu)")).toBeLessThan(bd.indexOf("hoaDonDienTu.create("));
    const lai = than(m, "phatHanhLai");
    expect(lai.indexOf("chanPhieuKhongHopLe(phieu)")).toBeGreaterThan(0);
    expect(lai.indexOf("chanPhieuKhongHopLe(phieu)")).toBeLessThan(lai.indexOf("hoaDonDienTu.updateMany("));
  });
});
