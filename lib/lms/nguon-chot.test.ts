/**
 * `nguonChot` — mỗi đường đóng buổi phải khai ĐÚNG nguồn của chính nó.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VÌ SAO CÓ FILE NÀY — sự cố phép đo 09/09/2026
 *
 * Trước hôm nay KHÔNG có cách nào biết một buổi đóng vì máy hay vì người bấm. Cả hai
 * đường cùng gọi `completeSession`, cùng `actorId` (đường tự đóng truyền id của chính
 * giáo viên vừa lưu điểm danh), cùng `action: "COMPLETE_SESSION"`, cùng `assignMode`.
 *
 * Tôi đã dựng một phép đo chia hai đường theo `completedById = null` và in ra trên prod
 * "tự động 1 / người bấm 39". Con số đó VÔ NGHĨA — cột ấy có giá trị ở cả hai nhánh. Suýt
 * đọc thành "cổng tự đóng không nổ kể từ bản vá".
 *
 * `nguonChot` là dấu sửa điều đó. Nhưng một dấu chỉ đáng tin khi MỖI call site khai đúng
 * — khai sai thì không nổ lỗi, không đỏ test nào, chỉ làm mọi phép đo về sau nói dối.
 * File này là cổng canh điều đó.
 *
 * ⚠️ Đây là test GREP MÃ NGUỒN — loại mong manh nhất (luật 11). Nên: bỏ CHÚ THÍCH trước
 * mọi phép so (chú thích ở cả hai file đều nhắc cả hai giá trị); neo chuỗi hẹp; khẳng
 * định SỐ LẦN khớp; và đã cấy thử từng chỗ.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const GOC = process.cwd();

/** Bỏ `//` và block comment trước khi soi — xem cảnh báo ở đầu file. */
function boChuThich(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(String.fromCharCode(10))
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join(String.fromCharCode(10));
}

function doc(p: string): string {
  return boChuThich(readFileSync(join(GOC, p), "utf8"));
}

function dem(src: string, chuoi: string): number {
  return src.split(chuoi).length - 1;
}

const TU_DONG = 'nguonChot: "TU_' + 'DONG"';
const TAY = 'nguonChot: "TAY"';
const BACKFILL = 'nguonChot: "BACK' + 'FILL"';

/**
 * HỢP ĐỒNG: bốn đường đóng buổi trong mã sản phẩm, mỗi đường một giá trị.
 * Thêm đường thứ năm mà quên khai ở đây thì ca "không sót đường nào" ở dưới đỏ.
 */
const DUONG: { ten: string; file: string; nguon: "TU_DONG" | "TAY" }[] = [
  {
    ten: "tự đóng trong lượt LƯU ĐIỂM DANH — không ai bấm nút",
    file: "app/(teacher)/teacher/lop/_actions.ts",
    nguon: "TU_DONG",
  },
  {
    ten: 'nút "Chốt buổi"',
    file: "lib/lms/chot-buoi.ts",
    nguon: "TAY",
  },
  {
    ten: "màn quản trị buổi học",
    file: "app/(admin)/admin/classes/[id]/session/_actions.ts",
    nguon: "TAY",
  },
  {
    ten: "màn Lịch của giáo viên",
    file: "app/(teacher)/teacher/lich/_actions.ts",
    nguon: "TAY",
  },
];

describe("nguonChot — mỗi đường khai đúng nguồn của mình", () => {
  it.each(DUONG)("$ten ⇒ $nguon", ({ file, nguon }) => {
    const src = doc(file);
    const dung = nguon === "TU_DONG" ? TU_DONG : TAY;
    const sai = nguon === "TU_DONG" ? TAY : TU_DONG;
    expect(dem(src, dung), `${file} phải truyền ${dung} đúng MỘT lần`).toBe(1);
    expect(dem(src, sai), `${file} KHÔNG được truyền ${sai}`).toBe(0);
  });

  it("đường TỰ ĐỘNG chỉ có ĐÚNG MỘT — nếu có hai thì một trong hai là nhãn sai", () => {
    // Anti-vacuity: ca trên kiểm từng file. Ca này kiểm trên TOÀN BỘ mã sản phẩm, để một
    // file mới lỡ khai "TU_DONG" không lọt qua vì nó không có tên trong bảng DUONG.
    const tong = DUONG.reduce((s, x) => s + dem(doc(x.file), TU_DONG), 0);
    expect(tong).toBe(1);
  });

  // ── BACKFILL: giá trị thứ ba, và HAI hệ quả gắn cứng với nó ─────────────────
  it("lệnh backfill dùng BACKFILL, không mượn TU_DONG cũng không mượn TAY", () => {
    // Mượn cái nào cũng đội lên một trong hai cột của phép đếm vừa dựng ra để đo cổng
    // tự đóng — 90 dòng dọn backlog sẽ làm câu trả lời "cổng có nổ không" thành vô nghĩa.
    const src = doc("scripts/backfill-dong-buoi-thoa.ts");
    expect(dem(src, BACKFILL), "phải truyền BACKFILL đúng một lần").toBe(1);
    expect(dem(src, TU_DONG), "KHÔNG được mượn TU_DONG").toBe(0);
    expect(dem(src, TAY), "KHÔNG được mượn TAY").toBe(0);
  });

  it("BACKFILL chặn session.taught ở TẦNG PHÁT, không chặn bằng assignMode", () => {
    // `r7-lifecycle` KHÔNG đọc `assignMode`. Chặn bằng nó là chặn được hai trong ba
    // consumer trong khi người viết tin là đã chặn cả ba — đúng hình dạng luật 14.
    // Ca HÀNH VI tương ứng: tests/e2e/r7/session-lifecycle.spec.ts [BACKFILL-1],
    // đã cấy thử CẢ HAI kiểu chặn sai.
    const src = doc("lib/lms/session-lifecycle.ts");
    const iChan = src.indexOf('opts.nguonChot === "BACK' + 'FILL"');
    const iPhat = src.indexOf("publishEvent(");
    expect(iChan, "phải có nhánh chặn theo nguonChot").toBeGreaterThan(-1);
    expect(iPhat, "phải còn lời gọi publishEvent").toBeGreaterThan(-1);
    expect(iChan, "nhánh chặn phải nằm TRƯỚC publishEvent").toBeLessThan(iPhat);
  });

  it("BACKFILL ghi rosterSource riêng ⇒ cổng lương vẫn TỪ CHỐI", () => {
    // `completeSession` đếm ghi danh ĐANG CÓ lúc gọi. Với buổi dạy tháng trước đó là sĩ
    // số HÔM NAY — số suy đoán. Ghi SNAPSHOT là để roster-guard NHẬN nó vào công thức lương.
    const src = doc("lib/lms/session-lifecycle.ts");
    expect(src).toContain('? "BACKFILL_CLOSE"');
    expect(
      dem(src, 'rosterSource: "SNAPSHOT"'),
      "không được ghi SNAPSHOT vô điều kiện",
    ).toBe(0);
  });

  // ── chữ ký phải BẮT BUỘC ────────────────────────────────────────────────────
  it("`nguonChot` là trường BẮT BUỘC, không `?:`, không giá trị mặc định", () => {
    // Mặc định nào cũng dán nhãn sai cho một trong hai đường, và nhãn sai không nổ lỗi
    // — nó chỉ làm phép đo nói dối (luật 7).
    const src = doc("lib/lms/session-lifecycle.ts");
    expect(src).toContain('nguonChot: "TU_DONG" | "TAY" | "BACKFILL";');
    expect(src, "không được có `nguonChot?:`").not.toMatch(/nguonChot\?\s*:/);
    expect(src, "không được có `opts.nguonChot ??`").not.toMatch(/opts\.nguonChot\s*\?\?/);
  });

  it("ghi vào `newValues` của AuditLog — dấu không được ghi thì bằng không có dấu", () => {
    const src = doc("lib/lms/session-lifecycle.ts");
    expect(dem(src, "nguonChot: opts.nguonChot")).toBe(1);
  });

  it("không sót đường nào: mọi lời gọi `completeSession(` trong mã sản phẩm đều đã khai", () => {
    // Đếm lời gọi so với số dòng `nguonChot` trong CÙNG file — lệch nghĩa là có một lời
    // gọi mới chưa khai (tsc cũng bắt, nhưng ca này nói ra VỊ TRÍ).
    for (const { file } of DUONG) {
      const src = doc(file);
      const goi = dem(src, "completeSession({");
      const khai = dem(src, TU_DONG) + dem(src, TAY);
      expect(khai, `${file}: ${goi} lời gọi nhưng ${khai} chỗ khai nguonChot`).toBe(goi);
    }
  });
});
