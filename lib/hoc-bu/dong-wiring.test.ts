// [DGW-*] — LƯỚI GHIM MÃ NGUỒN cho T05: mọi đường tạo / đổi trạng thái dòng cần bù đi qua `lib/hoc-bu/dong-service.ts`.
//
// Hành vi đã có test thật trên Postgres (`tests/hoc-bu/dong-hoc-bu.test.ts`) và bảng cạnh có test thuần (`dong-trang-thai.test.ts`).
// Thứ chúng KHÔNG canh là việc đường ghi cũ MỌC LẠI: một người thêm `makeupNeed.update({ data: { status: "CANCELLED" } })` ở chỗ thứ 11,
// đúng như 10 chỗ cũ — không điều kiện trạng thái cũ, không qua bảng cạnh, không mang nguồn — mọi test hành vi vẫn xanh vì không ai gọi
// chỗ đó. Cách làm theo CLAUDE.md "Mẫu test: LƯỚI GHIM MÃ NGUỒN": bóc chú thích, neo chuỗi HẸP vào LỜI GỌI, đếm số lần khớp.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { laCanhHopLe } from "@/lib/hoc-bu/dong-trang-thai";

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const boChuThich = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((d) => !d.trim().startsWith("//"))
    .join("\n");
const ma = (p: string) => boChuThich(doc(p));
const dem = (s: string, x: string) => s.split(x).length - 1;
function than(src: string, ten: string): string {
  const m = new RegExp(`(?:^|\\n)(?:export )?async function ${ten}\\(`).exec(src);
  expect(m, `không thấy hàm ${ten}`).not.toBeNull();
  const dau = m!.index;
  const ke = src.slice(dau + 10).search(/\n(?:export )?(?:async )?(?:function|const|type|interface) /);
  return src.slice(dau, ke === -1 ? undefined : dau + 10 + ke);
}
/** Phần ruột (giữa cặp ngoặc tròn khớp nhau) của MỌI lời gọi `ten(...)` trong `src`. */
function cacLoiGoi(src: string, ten: string): string[] {
  const ra: string[] = [];
  let i = src.indexOf(ten);
  while (i !== -1) {
    let j = i + ten.length;
    let sau = 1;
    while (j < src.length && sau > 0) {
      if (src[j] === "(") sau++;
      else if (src[j] === ")") sau--;
      j++;
    }
    ra.push(src.slice(i + ten.length, j - 1));
    i = src.indexOf(ten, j);
  }
  return ra;
}

const SERVICE = "lib/hoc-bu/dong-service.ts";
const CASE = "lib/hoc-bu/case-db.ts";
const DIEMDANH = "lib/hoc-bu/dong-diem-danh.ts";
const GV = "app/(teacher)/teacher/lop/_actions.ts";
const AD = "app/(admin)/admin/attendance/_actions.ts";
const PR = "app/(admin)/admin/parent-requests/actions.ts";
const CLS = "app/(admin)/admin/classes/_actions.ts";
const CHUYEN = "app/(admin)/admin/orders/[id]/chuyen-doi/_actions.ts";

const GHI_DONG = /\bmakeupNeed\.(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)\s*\(/g;

/**
 * KIỂM KÊ mọi lời gọi ghi `MakeupNeed` trong `app/` + `lib/` (không tính test, seed, script). Từ 17 chỗ (6 ngoài test) xuống:
 * app/ — KHÔNG CÒN CHỖ NÀO. Thêm một lời gọi mới ⇒ test này ĐỎ để người viết phải TỰ HỎI: nó tạo hoặc đổi TRẠNG THÁI dòng? ⇒ phải đi qua
 * `dong-service.ts`. Chỉ ghi cột phụ (con trỏ phí, miễn phí) mới được đứng ngoài, và phải khai ở đây kèm lý do.
 */
const KIEM_KE: Record<string, { so: number; vi: string }> = {
  "lib/hoc-bu/dong-service.ts": { so: 4, vi: "service: createMany (idempotent) + cập nhật note + liên kết điểm danh gốc + chuyenTrangThaiDong" },
  "lib/hoc-bu/case-db.ts": { so: 3, vi: "CHỈ cột phụ: con trỏ phí `feeOrderItemId` (taoPhiBu), miễn phí `freeApproved*` (mienPhiBu) và gỡ miễn phí (goMienPhiBu, T06) — không đổi trạng thái" },
  "lib/lms/makeup-service.ts": { so: 1, vi: "ĐƯỜNG CHẾT (0 caller ở production, chỉ test R3) — `transition` luồng R3 cũ; gỡ ở T16" },
  "lib/makeup/service.ts": { so: 3, vi: "ĐƯỜNG CHẾT (0 caller ở production, chỉ test R3/R7) — scheduleMakeup/completeMakeup/cancelMakeup luồng cũ; gỡ ở T16" },
};

// Quét cả cây mã nguồn (git ls-files + đọc ~1000 tệp): 5 giây mặc định không đủ khi runner CI 2 vCPU đang bận.
describe("[DGW] T05 — mọi đường ghi dòng cần bù đi qua `dong-service.ts`", { timeout: 30_000 }, () => {
  it("[DGW-01] kiểm kê: số lời gọi ghi `MakeupNeed` trong app/ + lib/ ĐÚNG bảng; KHÔNG chỗ nào ở app/; không SQL thô", () => {
    const tep = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "app/**/*.ts", "app/**/*.tsx", "lib/**/*.ts", "lib/**/*.tsx"], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
      .split("\n")
      .filter((f) => f && !/\.(test|spec)\.tsx?$/.test(f));
    expect(tep.length, "quét ra quá ít tệp — sai cwd? lưới đang không chạm tới gì").toBeGreaterThan(500);
    const thuc: Record<string, number> = {};
    for (const f of tep) {
      const n = (boChuThich(readFileSync(resolve(process.cwd(), f), "utf8")).match(GHI_DONG) ?? []).length;
      if (n > 0) thuc[f] = n;
    }
    expect(thuc, "bảng kiểm kê lệch — đọc chú thích trên KIEM_KE trước khi sửa bảng").toEqual(Object.fromEntries(Object.entries(KIEM_KE).map(([f, v]) => [f, v.so])));
    expect(Object.keys(thuc).filter((f) => f.startsWith("app/"))).toEqual([]);
    const tho = tep.filter((f) => /(UPDATE|INSERT INTO|DELETE FROM)\s+"MakeupNeed"/i.test(boChuThich(readFileSync(resolve(process.cwd(), f), "utf8"))));
    expect(tho).toEqual([]);
    // Đối chứng: lưới THẤY chính service (nếu regex hỏng thì dòng này đỏ, không xanh vì "không tìm thấy gì").
    expect(GHI_DONG.test(ma(SERVICE))).toBe(true);
  });

  it("[DGW-02] `case-db.ts`: ba lời gọi còn lại nằm ĐÚNG ở taoPhiBu / mienPhiBu / goMienPhiBu và chỉ ghi cột phụ (không `status`)", () => {
    const src = ma(CASE);
    for (const ten of ["taoPhiBu", "mienPhiBu", "goMienPhiBu"]) {
      const b = than(src, ten);
      expect(dem(b, "makeupNeed.updateMany("), ten).toBe(1);
      const goi = b.slice(b.indexOf("makeupNeed.updateMany("));
      const data = goi.slice(goi.indexOf("data:"), goi.indexOf("});"));
      expect(data, `${ten}: không được đổi status ở đây`).not.toContain("status");
    }
    // T07: nút "Gỡ", đường xét lại khi đơn phí đổi và "Huỷ case" dùng CHUNG `nhaMucTrongTx` / `doiKetQuaMuc` (case-diem-danh-db.ts) — phép
    // đổi trạng thái nằm ở đó (đọc từ bảng `chuyenMuc`). `ghiBeVaoCase` vẫn tự chuyển PENDING→SCHEDULED.
    expect(than(src, "goKhoiCase"), "goKhoiCase").toContain("nhaMucTrongTx(");
    expect(than(src, "goBeKhoiCaseTrongTx"), "goBeKhoiCaseTrongTx").toContain("nhaMucTrongTx(");
    expect(than(src, "huyCase"), "huyCase").toContain("doiKetQuaMuc(");
    for (const ten of ["ghiBeVaoCase", "goBeKhoiCaseTrongTx", "huyCase"]) {
      expect(than(src, ten), ten).not.toMatch(GHI_DONG);
    }
    expect(than(src, "ghiBeVaoCase")).toContain("chuyenTrangThaiDong(");
    const cd = ma("lib/hoc-bu/case-diem-danh-db.ts");
    for (const ten of ["doiKetQuaMuc", "nhaMucTrongTx", "diemDanhBe", "suaDiemDanhBe", "diemDanhBu"]) {
      expect(than(cd, ten), ten).not.toMatch(GHI_DONG);
    }
    expect(than(cd, "doiKetQuaMuc")).toContain("chuyenTrangThaiDong(");
  });

  it("[DGW-03] ba đường lưu điểm danh: MỘT `dongBoDongSauDiemDanh(` TRONG `giaoDichDiemDanh(`; không còn `createMakeupNeed` / `cancelPendingMakeupNeed` nào ở app/", () => {
    for (const [f, ten] of [
      [GV, "saveClassAttendanceAction"],
      [AD, "markAttendance"],
      [PR, "resolveAbsence"],
    ] as const) {
      const b = than(ma(f), ten);
      expect(dem(b, "dongBoDongSauDiemDanh("), f).toBe(1);
      expect(dem(b, "giaoDichDiemDanh("), f).toBe(1);
      expect(b.indexOf("giaoDichDiemDanh("), f).toBeLessThan(b.indexOf("dongBoDongSauDiemDanh("));
      // Dòng sinh ra TRONG giao dịch ghi điểm danh: cùng commit hoặc cùng rollback (bản cũ tạo SAU, lỗi bị nuốt ⇒ TV-08).
      expect(b.indexOf("tx.attendance.upsert("), f).toBeLessThan(b.indexOf("dongBoDongSauDiemDanh("));
      expect(b, f).not.toMatch(/createMakeupNeed\(|cancelPendingMakeupNeed\(/);
    }
    const tep = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "app/**/*.ts", "app/**/*.tsx"], { cwd: process.cwd(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .split("\n")
      .filter((f) => f && !/\.(test|spec)\.tsx?$/.test(f));
    const con = tep.filter((f) => /createMakeupNeed\(|cancelPendingMakeupNeed\(/.test(ma(f)));
    expect(con).toEqual([]);
  });

  it("[DGW-04] service: tạo bằng `createMany` + `skipDuplicates` (KHÔNG create/upsert — lỗi trùng khoá làm giao dịch hỏng); mang NGUỒN và khoá của LỚP", () => {
    const t = than(ma(SERVICE), "taoDongHocBu");
    expect(t).toContain("skipDuplicates: true");
    expect(t).not.toMatch(/makeupNeed\.(create|upsert)\(/);
    expect(t).toContain("sourceType: p.nguon");
    expect(t).toContain("courseId: sess.class.courseId");
    expect(t).toContain("originalAttendanceId: p.originalAttendanceId ?? null");
    // Dòng ĐÃ có thì nguồn gốc KHÔNG bị đè: phép cập nhật chỉ đụng `note` và liên kết điểm danh còn trống.
    expect(t).toContain("originalAttendanceId: null");
    expect(dem(t, "sourceType")).toBe(1); // chỉ ở dữ liệu TẠO — không có nhánh cập nhật nào ghi lại nguồn
  });

  it("[DGW-05] `chuyenTrangThaiDong`: kiểm cạnh TRƯỚC khi ghi; ghi CÓ ĐIỀU KIỆN `status: p.tu`; lệch số dòng thì ném trừ khi `chiNeuCo`", () => {
    const t = than(ma(SERVICE), "chuyenTrangThaiDong");
    expect(t.indexOf("laCanhHopLe(")).toBeGreaterThan(-1);
    expect(t.indexOf("laCanhHopLe(")).toBeLessThan(t.indexOf("updateMany("));
    expect(t).toContain("status: p.tu");
    expect(t).toContain("status: p.sang");
    expect(t).toContain("if (!p.chiNeuCo && r.count !== p.ids.length) throw new LoiDong(\"DONG_DA_DOI\"");
    expect(dem(t, "updateMany(")).toBe(1);
  });

  it("[DGW-06] MỌI lời gọi `chuyenTrangThaiDong(` ở mã thật khai (tu, sang, lyDo) và bộ ba đó NẰM TRONG bảng cạnh", () => {
    const tep = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "app/**/*.ts", "app/**/*.tsx", "lib/**/*.ts", "lib/**/*.tsx"], { cwd: process.cwd(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .split("\n")
      .filter((f) => f && !/\.(test|spec)\.tsx?$/.test(f) && f !== SERVICE);
    let so = 0;
    for (const f of tep) {
      for (const g of cacLoiGoi(ma(f), "chuyenTrangThaiDong(")) {
        so++;
        const tu = /tu:\s*"(\w+)"/.exec(g)?.[1];
        const sang = /sang:\s*"(\w+)"/.exec(g)?.[1];
        const lyDo = /lyDo:\s*"(\w+)"/.exec(g)?.[1];
        if (f === "lib/hoc-bu/case-diem-danh-db.ts" && g.includes("c.dong.")) {
          // T07: lời gọi của `doiKetQuaMuc` lấy bộ ba từ BẢNG `chuyenMuc` (`c.dong`). Mọi bộ ba trong bảng được kiểm ở
          // `case-nhieu-bai-thuan.test.ts` [CNB-04] (từng cạnh phải nằm trong CANH_DONG) — nên ở đây chỉ ghim rằng nó lấy từ bảng chứ không tự bịa.
          expect(g, f).toContain("tu: c.dong.tu, sang: c.dong.sang, lyDo: c.dong.lyDo");
          continue;
        }
        expect([f, tu, sang, lyDo].every(Boolean), `${f}: lời gọi thiếu tu/sang/lyDo`).toBe(true);
        expect(laCanhHopLe(tu as never, sang as never, lyDo as never), `${f}: ${tu}→${sang} "${lyDo}" không nằm trong bảng cạnh`).toBe(true);
      }
    }
    // 7 lời gọi ngoài service: case-db (xếp 1) + case-diem-danh-db (theo bảng chuyenMuc 1 · hồi sinh mục khi sửa điểm danh 1) + hoc-bu actions
    // (huỷ 1 · khôi phục 1) + duyệt bảo lưu lùi ngày (`lib/bao-luu/dich-vu.ts`, 1) + nhập ca bảo lưu LEGACY lùi ngày (`lib/bao-luu/legacy-nhap-db.ts`, 1 — BR-08; trước đó là `updateMany` thẳng, lọt khỏi cửa chung). Thêm lời gọi ⇒ cập nhật số này CÓ CHỦ ĐÍCH.
    expect(so, "số lời gọi lệch — thêm/bớt một đường chuyển trạng thái phải là quyết định có chủ đích").toBe(7);
    // Lời gọi bên trong chính service (hồi sinh) cũng phải hợp lệ.
    for (const g of cacLoiGoi(ma(SERVICE), "chuyenTrangThaiDong(")) {
      const tu = /tu:\s*"(\w+)"/.exec(g)?.[1];
      if (!tu) continue; // định nghĩa hàm / lời gọi dùng biến
      expect(laCanhHopLe(tu as never, /sang:\s*"(\w+)"/.exec(g)![1] as never, /lyDo:\s*"(\w+)"/.exec(g)![1] as never)).toBe(true);
    }
  });

  it("[DGW-07] huỷ lớp KHÔNG ghi dòng cần bù (quyết định 10) mà chỉ ĐÁNH GIÁ; hộp thoại huỷ nói đúng việc giữ nguyên", () => {
    const t = than(ma(CLS), "cancelClassAction");
    expect(t).not.toMatch(/makeupNeed\./);
    expect(t).not.toMatch(/makeupCase/);
    expect(dem(t, "danhGiaHocBuKhiHuyLop(")).toBe(1);
    expect(t).toContain("hocBuConMo");
    const ui = doc("app/(admin)/admin/classes/[id]/_components/class-cancel.tsx");
    expect(ui).toContain("giữ nguyên");
    expect(ui).not.toContain("nhu cầu học bù đang mở bị huỷ");
    // `huy-lop.ts` chỉ ĐỌC.
    expect(ma("lib/hoc-bu/huy-lop.ts")).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
  });

  it("[DGW-08] chuyển đổi đơn: nguồn ORDER_CONVERSION, KHÔNG điểm danh gốc, idempotent (không còn `create` trần); script vá khai SYSTEM_MIGRATION", () => {
    const b = ma(CHUYEN);
    expect(b).toMatch(/nguon:\s*"ORDER_CONVERSION"/);
    expect(b).not.toMatch(/makeupNeed\.create\(/);
    expect(b).not.toContain("originalAttendanceId");
    expect(ma("scripts/bu-vang-tu-ngay.ts")).toContain('sourceType: "SYSTEM_MIGRATION"');
  });

  it("[DGW-09] `dong-diem-danh.ts`: luật thu hồi CHỈ khi quay lại có mặt (PRESENT/LATE); hồi sinh CHỈ khi trước đó chưa NEEDS_MAKEUP", () => {
    const t = ma(DIEMDANH);
    expect(t).toContain('const CO_MAT = new Set(["PRESENT", "LATE"]);');
    expect(t).toContain('hoiSinh: r.makeupStatusTruoc !== "NEEDS_MAKEUP"');
    expect(t).toContain('nguon: "ABSENCE"');
    expect(t).toContain("originalAttendanceId: r.attendanceId");
    expect(dem(t, "thuHoiDongKhiCoMat(")).toBe(1);
  });
});
