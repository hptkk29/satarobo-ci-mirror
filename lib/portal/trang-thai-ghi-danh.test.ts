// Cổng chặn: KHÔNG được chép tay danh sách "ghi danh đang học" thêm một lần nữa.
//
// ─────────────────────────────────────────────────────────────────────────────
// Vì sao có bộ test này (06/09/2026)
//
// `lib/portal/` từng có BẢY bản chép tay của cùng một danh sách trạng thái ghi danh, và
// chúng lệch nhau: sáu bản quên `PAUSED`, ba bản có. Không có lỗi, không có test đỏ —
// chỉ có 7 học viên đang tạm nghỉ mà phụ huynh mở cổng ra thấy trống trơn: bộ chuyển-con
// hiện tên các em (danh sách CÓ `PAUSED`), còn lịch học/buổi học/ảnh/thông báo thì không.
//
// Vá bảy chỗ là chưa đủ — cái thứ tám sẽ mọc lại y như vậy và cũng câm như vậy. Bộ này
// quét nguồn và bắt mọi mảng status viết tay mới trong `lib/portal/**`.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  GHI_DANH_CO_LICH_SU,
  GHI_DANH_DANG_HOC,
} from "@/lib/portal/trang-thai-ghi-danh";

const THU_MUC = path.join("lib", "portal");

/**
 * Chỗ CỐ Ý giữ danh sách riêng. Thêm dòng ở đây là một quyết định có lý do, không phải
 * thủ tục cho qua cổng.
 */
const NGOAI_LE: ReadonlyArray<[tep: string, lyDo: string]> = [
  [
    "report-card-v2.ts",
    "`CURRENT_STATUSES` ở đó KHÔNG phải bộ lọc hiển thị mà là thứ tự ƯU TIÊN chọn một " +
      "ghi danh để dựng học bạ tạm tính; bộ lọc thật là `REPORTABLE_STATUSES` (rộng hơn, " +
      "có cả PAUSED và COMPLETED). Gộp hai thứ vào một hằng là đổi hành vi chọn lớp.",
  ],
];

/** Mảng toàn hằng chuỗi VIẾT HOA — ứng viên; lọc tiếp bằng `laDanhSachGhiDanh`. */
const RE_MANG_HANG = /\[[\s\S]{0,200}?\]/g;

/**
 * Có phải danh sách trạng thái GHI DANH không.
 *
 * Không chỉ nhìn thấy một tên trạng thái là bắt: `CANCELLED`/`REFUNDED` cũng là trạng
 * thái THANH TOÁN (`billing-student.ts`), `ACTIVE`/`COMPLETED` cũng là trạng thái LỚP.
 * Dấu nhận biết chắc chắn của ghi danh là `STUDYING` hoặc `PAUSED`; thêm một đường bắt
 * cho cặp `CONFIRMED` + `ACTIVE` đi cùng nhau.
 */
function laDanhSachGhiDanh(doan: string): boolean {
  const ten = new Set([...doan.matchAll(/"([A-Z_]{3,})"/g)].map((m) => m[1]!));
  if (ten.size === 0) return false;
  if (ten.has("STUDYING") || ten.has("PAUSED")) return true;
  return ten.has("CONFIRMED") && ten.has("ACTIVE");
}

function tepNguon(): string[] {
  return fs
    .readdirSync(THU_MUC, { withFileTypes: true })
    .filter(
      (m) =>
        m.isFile() &&
        /\.ts$/.test(m.name) &&
        !/\.test\.ts$/.test(m.name) &&
        // Chính file ĐỊNH NGHĨA thì đương nhiên được viết ra danh sách.
        m.name !== "trang-thai-ghi-danh.ts",
    )
    .map((m) => m.name);
}

/** Bỏ chú thích để danh sách nêu trong ghi chú không bị tính là mã thật. */
const boChuThich = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * Tệp NGOÀI `lib/portal/` cũng đọc ghi danh cho cổng phụ huynh — phải canh cùng luật.
 * `lib/lms/calendar-data.ts` từng lọt đúng vì nó không nằm trong thư mục portal: truy vấn
 * ở đó không có `status` lẫn `deletedAt` nên lịch tháng vẫn chấm buổi của lớp con đã rút.
 */
const TEP_NGOAI = [path.join("lib", "lms", "calendar-data.ts")];

/**
 * Truy vấn CỐ Ý không lọc `status`.
 *
 * Tiền là ngoại lệ có lý: công nợ phải phủ MỌI ghi danh chưa xoá sổ, kể cả ghi danh đã
 * rút giữa chừng mà còn nợ học phí. `Enrollment.deletedAt` mới là sổ sách ở đây, không
 * phải `status`.
 */
const KHONG_CAN_STATUS: ReadonlyArray<[tep: string, lyDo: string]> = [
  [
    "billing-student.ts",
    "Trang Học phí phải liệt kê mọi ghi danh chưa xoá sổ — kể cả ghi danh đã rút mà còn " +
      "nợ. Lọc theo status là giấu mất khoản nợ khỏi chính người phải trả nó.",
  ],
  [
    "dashboard.ts",
    "Ô công nợ trên trang chủ dùng CÙNG tập ghi danh với trang Học phí; lọc lệch nhau " +
      "thì hai màn cạnh nhau in hai con số nợ khác nhau.",
  ],
];

/** `db.enrollment.findMany({...})` — trả nguyên phần đối số để soi bộ lọc. */
function truyVanGhiDanh(src: string): string[] {
  const ra: string[] = [];
  const re = /enrollment\.(?:findMany|findFirst|findUnique|count|groupBy)\(/g;
  for (const m of src.matchAll(re)) {
    const dau = m.index + m[0].length - 1;
    let sau = 0;
    let i = dau;
    for (; i < src.length; i++) {
      if (src[i] === "(") sau++;
      else if (src[i] === ")") {
        sau--;
        if (sau === 0) break;
      }
    }
    ra.push(src.slice(dau, i + 1));
  }
  return ra;
}

describe("Trạng thái ghi danh của cổng phụ huynh", () => {
  it("hằng hợp nhất có đủ 4 trạng thái đang phục vụ, KHÔNG lẫn trạng thái đã nghỉ", () => {
    expect([...GHI_DANH_DANG_HOC].sort()).toEqual(
      ["ACTIVE", "CONFIRMED", "PAUSED", "STUDYING"].sort(),
    );
    // Nghỉ hẳn / chưa chốt thì không phải "đang học".
    for (const x of ["WITHDREW", "CANCELLED", "PENDING"]) {
      expect(GHI_DANH_DANG_HOC as readonly string[]).not.toContain(x);
    }
    expect(GHI_DANH_CO_LICH_SU as readonly string[]).toContain("COMPLETED");
  });

  it("PAUSED nằm trong danh sách — con tạm nghỉ vẫn phải thấy lớp của mình", () => {
    // Ca hồi quy trực tiếp: 06/09 đo được 7 học viên chỉ có ghi danh PAUSED.
    expect(GHI_DANH_DANG_HOC as readonly string[]).toContain("PAUSED");
  });

  it("không tệp nào trong lib/portal chép tay danh sách status", () => {
    const mienTru = new Set(NGOAI_LE.map(([t]) => t));
    const viPham: string[] = [];
    for (const ten of tepNguon()) {
      if (mienTru.has(ten)) continue;
      const src = boChuThich(fs.readFileSync(path.join(THU_MUC, ten), "utf8"));
      for (const m of src.matchAll(RE_MANG_HANG)) {
        if (!laDanhSachGhiDanh(m[0])) continue;
        viPham.push(`${ten}: ${m[0].replace(/\s+/g, " ").slice(0, 70)}`);
      }
    }
    expect(
      viPham,
      "Danh sách trạng thái ghi danh viết tay:\n  " +
        viPham.join("\n  ") +
        "\n→ Dùng GHI_DANH_DANG_HOC (hoặc GHI_DANH_CO_LICH_SU) trong " +
        "lib/portal/trang-thai-ghi-danh.ts. Bảy bản chép tay lệch nhau đã làm 7 học viên " +
        "tạm nghỉ nhìn thấy một cổng trống trơn. Nếu chỗ này THẬT SỰ cần danh sách riêng, " +
        "khai vào NGOAI_LE kèm lý do.",
    ).toEqual([]);
  });

  it("danh sách ngoại lệ không để lại rác", () => {
    for (const [ten, lyDo] of NGOAI_LE) {
      expect(fs.existsSync(path.join(THU_MUC, ten)), `${ten} không còn tồn tại`).toBe(true);
      const src = boChuThich(fs.readFileSync(path.join(THU_MUC, ten), "utf8"));
      const con = [...src.matchAll(RE_MANG_HANG)].some((m) => laDanhSachGhiDanh(m[0]));
      expect(
        con,
        `${ten} đã khai ngoại lệ nhưng không còn danh sách viết tay — bỏ khỏi NGOAI_LE`,
      ).toBe(true);
      expect(lyDo.length, `${ten} phải có lý do thật`).toBeGreaterThan(40);
    }
  });

  it("mọi truy vấn ghi danh đều lọc deletedAt, và lọc status trừ khi khai ngoại lệ", () => {
    // Cổng ở trên chỉ bắt mảng status VIẾT TAY. Truy vấn KHÔNG có bộ lọc nào thì lọt qua
    // trong im lặng — đúng cách `lib/lms/calendar-data.ts` và `lib/portal/student-home.ts`
    // từng lọt: lịch tháng chấm buổi của lớp con đã rút, và cổng học sinh in tên giáo
    // viên của lớp cũ.
    const miemStatus = new Set(KHONG_CAN_STATUS.map(([t]) => t));
    const thieu: string[] = [];
    let soTruyVan = 0;
    const tep = [...tepNguon().map((t) => path.join(THU_MUC, t)), ...TEP_NGOAI];
    for (const duongDan of tep) {
      if (!fs.existsSync(duongDan)) continue;
      const ten = path.basename(duongDan);
      const src = boChuThich(fs.readFileSync(duongDan, "utf8"));
      for (const q of truyVanGhiDanh(src)) {
        soTruyVan++;
        // Tra theo KHOÁ CHÍNH thì lọc không còn nghĩa: đang lấy đúng một dòng đã biết id
        // (vd ghi danh ghi trong học bạ đã phát hành).
        if (/where:\s*\{\s*id:/.test(q)) continue;
        const co: string[] = [];
        if (!q.includes("deletedAt")) co.push("deletedAt");
        if (!q.includes("status") && !miemStatus.has(ten)) co.push("status");
        if (co.length > 0) {
          co.forEach(() => undefined);
          thieu.push(`${ten}: thiếu ${co.join(" + ")}`);
        }
      }
    }
    // Chốt chặn chống XANH GIẢ: quét hỏng thì `thieu` rỗng và ca này xanh vô nghĩa.
    expect(
      soTruyVan,
      "không quét được truy vấn ghi danh nào — regex hỏng?",
    ).toBeGreaterThan(5);
    expect(
      thieu,
      "Truy vấn ghi danh thiếu bộ lọc: " +
        thieu.join(" · ") +
        " → Ghi danh đã RÚT / đã XOÁ MỀM vẫn bị coi là lớp của con: lịch chấm buổi lớp" +
        " cũ, hero in tên giáo viên lớp cũ. Thêm" +
        " `status: { in: [...GHI_DANH_DANG_HOC] }, deletedAt: null`," +
        " hoặc khai vào KHONG_CAN_STATUS kèm lý do.",
    ).toEqual([]);
  });

  it("danh sách miễn status không để lại rác", () => {
    for (const [ten, lyDo] of KHONG_CAN_STATUS) {
      expect(fs.existsSync(path.join(THU_MUC, ten)), `${ten} không còn tồn tại`).toBe(true);
      expect(lyDo.length, `${ten} phải có lý do thật`).toBeGreaterThan(40);
    }
  });
});
