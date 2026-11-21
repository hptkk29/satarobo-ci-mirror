/**
 * lib/cham-cong/nhan-mot-nguon.test.ts — LUẬT 12b: site GV không dựng lại nhãn/số của admin.
 *
 * Ba lần trong hai tuần, một màn chấm công gõ thẳng nhãn vào JSX thay vì lấy từ hàm dùng
 * chung: "Đã làm" cho mọi dòng quá khứ · "theo nơi làm" cho cả ngày nghỉ · "quét nơi khác"
 * thay cho tên cơ sở. Mỗi lần đều là MỘT chuỗi trong một ô bảng — không ném lỗi, không làm
 * test nào đỏ, và người dùng tin bản mình đang nhìn.
 *
 * Cổng này chặn ĐÚNG hình dạng đó: trong các màn chấm công, hai chuỗi ấy chỉ được xuất hiện
 * ở `nhan-ca.ts` — nơi duy nhất định nghĩa chúng. Ở chỗ khác nghĩa là ai đó vừa dựng bản
 * tính thứ hai.
 *
 * ⚠️ GREP MÃ NGUỒN — loại mong manh nhất (luật 11). Ba biện pháp theo luật đó:
 *   · neo chuỗi HẸP NHẤT (đúng hai literal, không regex rộng);
 *   · BỎ CHÚ THÍCH trước khi soi — chú thích giải thích bản vá luôn chứa đúng chuỗi đang cấm
 *     (`bang-cong-gv.ts` và chính file này là ví dụ sống);
 *   · bộ quét là hàm THUẦN nhận chuỗi, nên vế CHO QUA / vế BẮT ĐƯỢC kiểm được bằng đầu vào
 *     giả, không phải tin nó chạy đúng trên cây thật.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 GIỚI HẠN CỦA FILE NÀY — ĐỌC TRƯỚC KHI TIN NÓ (chốt 10/09/2026)
 *
 * Đây là **lớp PHỤ**, không phải lớp duy nhất, và nó KHÔNG đo hành vi.
 *
 * Lớp CHÍNH là `bang-cong-gv.test.ts` — test hành vi trên hàm thuần dựng dòng. Nó bắt được
 * mọi lỗi trong phép nối "ngày công × ca xếp". Thứ nó KHÔNG với tới là **một chuỗi gõ thẳng
 * trong JSX của trang RSC**: `{"Đã làm"}` trong một ô `<td>` không đi qua hàm nào cả, và
 * không có test hành vi nào chạm được nó nếu không dựng trình duyệt.
 *
 * Vì thế file này tồn tại — nhưng theo luật 11 nó là loại yếu nhất, nên:
 *
 * ⚠️ **VIỆC CÒN NỢ:** khi có ca browser cho `/teacher/bang-cong` (chỗ của nó là
 * `tests/e2e/a0`, xem sổ ở luật 12 — cổng grep của affordance cũng kết luận y vậy), hãy bổ
 * sung **vế HÀNH VI**: dựng một ngày KHÔNG có lượt chấm, mở trang, khẳng định ô Trạng thái
 * không mang chữ "Đã làm". Lúc đó file này lùi về vai trò cảnh báo sớm, không còn là thứ
 * duy nhất canh JSX.
 *
 * Đừng đọc "hai bộ xanh" thành "không thể sai".
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Nhãn chỉ được sinh ra ở `nhan-ca.ts`. */
const NHAN_DOC_QUYEN = ["Đã làm", "theo nơi làm"] as const;

/** Chỉ soi màn CHẤM CÔNG — "Đã làm" là nhãn hợp lệ ở portal (bài tập, khảo sát). */
const VUNG = [
  "app/(admin)/admin/cham-cong",
  "app/(teacher)/teacher/bang-cong",
  "app/(teacher)/teacher/lich",
  "components/cham-cong",
  "components/admin/cham-cong",
  "lib/cham-cong",
];

/** Nơi ĐỊNH NGHĨA nhãn — và bộ test của chính nó. */
const DUOC_PHEP = new Set([
  "lib/cham-cong/nhan-ca.ts",
  "lib/cham-cong/nhan-ca.test.ts",
  "lib/cham-cong/bang-cong-gv.test.ts",
  "lib/cham-cong/nhan-mot-nguon.test.ts",
]);

/** Bỏ chú thích JSX/khối/dòng trước khi soi. */
export function boChuThich(x: string): string {
  return x
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");
}

/** Những nhãn độc quyền bị gõ thẳng trong `src`. Rỗng = sạch. */
export function nhanGoThang(src: string): string[] {
  const than = boChuThich(src);
  return NHAN_DOC_QUYEN.filter((n) => than.includes(n));
}

function quet(goc: string): string[] {
  const ra: string[] = [];
  const di = (thuMuc: string) => {
    let muc: fs.Dirent[];
    try {
      muc = fs.readdirSync(thuMuc, { withFileTypes: true });
    } catch {
      return;
    }
    for (const m of muc) {
      const p = path.join(thuMuc, m.name);
      if (m.isDirectory()) di(p);
      else if (/\.tsx?$/.test(m.name)) ra.push(p);
    }
  };
  di(path.join(process.cwd(), goc));
  return ra;
}

describe("nhanGoThang — bộ quét (kiểm bằng đầu vào giả, luật 11)", () => {
  it("BẮT ĐƯỢC nhãn gõ thẳng trong JSX", () => {
    expect(nhanGoThang('<span>{r.done ? "Đã làm" : "Sắp tới"}</span>')).toEqual(["Đã làm"]);
    expect(nhanGoThang('{r.shift.timeLabel || "theo nơi làm"}')).toEqual(["theo nơi làm"]);
  });

  // ── vế CHO QUA (luật 16): không được đỏ vì chú thích ───────────────────────
  it("BỎ QUA chuỗi nằm trong chú thích — dòng //, khối /* */ và {/* */}", () => {
    expect(nhanGoThang('// bug cũ: in "Đã làm" cho mọi dòng')).toEqual([]);
    expect(nhanGoThang('/* fallback "theo nơi làm" viết cho LD/D1/D2 */')).toEqual([]);
    expect(nhanGoThang('{/* Trạng thái: không hardcode "Đã làm" */}')).toEqual([]);
  });

  it("BỎ QUA cách viết ĐÚNG — tra bảng nhãn", () => {
    expect(nhanGoThang("{NHAN_TRANG_THAI[r.trangThai]}")).toEqual([]);
    expect(nhanGoThang("{nhanGioCa(r.shift.kind, r.shift.timeLabel)}")).toEqual([]);
  });
});

describe("Màn chấm công: nhãn trạng thái/giờ đến từ MỘT nguồn", () => {
  it("không màn nào gõ thẳng nhãn của nhan-ca.ts", () => {
    const pham: string[] = [];
    for (const goc of VUNG) {
      for (const f of quet(goc)) {
        const rel = path.relative(process.cwd(), f).replace(/\\/g, "/");
        if (DUOC_PHEP.has(rel)) continue;
        for (const n of nhanGoThang(fs.readFileSync(f, "utf8"))) {
          pham.push(`${rel} → "${n}"`);
        }
      }
    }
    expect(
      pham,
      "Nhãn này chỉ được sinh ở lib/cham-cong/nhan-ca.ts — gọi nhanGioCa()/NHAN_TRANG_THAI thay vì gõ chuỗi",
    ).toEqual([]);
  });

  // ── anti-vacuity: bộ quét có thật sự thấy cây nguồn không ──────────────────
  it("bộ quét ĐỌC ĐƯỢC các màn thật (không phải rỗng nên xanh)", () => {
    const soFile = VUNG.reduce((n, g) => n + quet(g).length, 0);
    expect(soFile).toBeGreaterThan(20);
    // Và nó phải thấy được nơi ĐỊNH NGHĨA — nếu không, đường dẫn đã lệch.
    const nhanCa = path.join(process.cwd(), "lib/cham-cong/nhan-ca.ts");
    expect(nhanGoThang(fs.readFileSync(nhanCa, "utf8"))).toEqual([...NHAN_DOC_QUYEN]);
  });
});
