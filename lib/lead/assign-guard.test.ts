// Đợt G (23/08/2026) — test viết TRƯỚC hiện thực (luật cứng #5).
//
// Ba lỗ ở ĐƯỜNG PHÂN CÔNG LEAD, tìm ra khi rà lại bộ kế hoạch sau khi 6 đợt A→F
// đã merge. Chúng khác nhau về triệu chứng nhưng cùng một họ: mỗi cái là một cách
// đi vòng qua một quyết định ĐÃ KÝ mà không để lại dấu vết.
//
//  1. Cổng Server Action LỎNG HƠN cổng trang ở màn "Cấu hình chia lead".
//     Trang gác `leads:assign-config` (chốt 03/08: tách riêng khỏi `leads:assign`,
//     chỉ SUPER_ADMIN). Action lại chỉ đòi `leads:assign` — mà quyền đó
//     CENTER_MANAGER có. Hệ quả cụ thể, không phải lý thuyết: gọi thẳng action là
//     đổi được chế độ chia của cả cơ sở sang CLOSE_RATE, tức thoát khỏi sổ lượt
//     vừa xây ở Đợt D, lách đúng quyết định Q7 ("chia đều số lượt, tuyệt đối không
//     được sai") mà không sinh một dòng quyết định nào ai đọc được.
//
//  2. Gán tay KHÔNG kiểm người nhận còn làm việc và có cùng cơ sở không.
//     Đây đúng là cơ chế đã đẻ ra sự cố phải gỡ tay 21/08: một lead CS1 nằm trong
//     tay sale CS2 và **người đó không mở nổi nó** (scopedDb cách ly cơ sở), nên
//     lead nằm chết cho tới khi có người đi dò ra. Đợt D đã bịt đường TỰ ĐỘNG
//     (bỏ fallback xuyên cơ sở) nhưng đường GÁN TAY vẫn mở nguyên.
//
//  3. Tra trùng SĐT so khớp ĐÚNG-BẰNG ở hai màn tạo/sửa lead tay.
//     DB chứa song song hai định dạng (`0…` cũ và `84…` canonical). Nhập `84905…`
//     khi đã có `0905…` là đẻ hồ sơ thứ hai — và từ Đợt D, mỗi hồ sơ thừa còn
//     TIÊU MỘT LƯỢT trong sổ, tức làm sai chính cái sổ dùng làm bằng chứng.
//     `lib/lead/dedup.ts` đã so khớp đúng từ lâu; hai màn này bị bỏ quên.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { canManualAssign } from "./assign-guard";

const SALE_CS1 = { id: "u-sale-cs1", isActive: true, deletedAt: null, centerId: "cs1" };

describe("[Đợt G] canManualAssign — gán tay phải kiểm người nhận", () => {
  it("sale cùng cơ sở, đang làm việc → cho gán", () => {
    expect(canManualAssign({ sale: SALE_CS1, leadCenterId: "cs1", actorIsHoLevel: false })).toEqual({
      ok: true,
    });
  });

  it("sale KHÁC cơ sở → TỪ CHỐI (đây là lỗi đã xảy ra thật 21/08)", () => {
    const r = canManualAssign({ sale: SALE_CS1, leadCenterId: "cs2", actorIsHoLevel: false });
    expect(r.ok).toBe(false);
    // Thông báo phải nói ĐÚNG cái sai, vì người bấm nút không biết về scopedDb.
    expect(r.ok === false && r.error).toMatch(/cơ sở/i);
  });

  it("sale đã NGHỈ (isActive=false) → TỪ CHỐI", () => {
    const r = canManualAssign({
      sale: { ...SALE_CS1, isActive: false },
      leadCenterId: "cs1",
      actorIsHoLevel: false,
    });
    expect(r.ok).toBe(false);
  });

  it("sale đã xoá mềm → TỪ CHỐI", () => {
    const r = canManualAssign({
      sale: { ...SALE_CS1, deletedAt: new Date("2026-08-01") },
      leadCenterId: "cs1",
      actorIsHoLevel: false,
    });
    expect(r.ok).toBe(false);
  });

  it("người gán ở cấp Hội sở → ĐƯỢC gán xuyên cơ sở (điều phối liên cơ sở là việc thật)", () => {
    // Không siết mù: HO/SUPER_ADMIN vốn nhìn thấy mọi cơ sở, và họ chuyển lead
    // liên cơ sở là nghiệp vụ có thật (màn "Chuyển lead liên CS"). Chặn họ là
    // biến một bản vá bảo mật thành một lỗi chức năng.
    expect(canManualAssign({ sale: SALE_CS1, leadCenterId: "cs2", actorIsHoLevel: true })).toEqual({
      ok: true,
    });
  });

  it("nhưng HO vẫn KHÔNG gán được cho người đã nghỉ", () => {
    const r = canManualAssign({
      sale: { ...SALE_CS1, isActive: false },
      leadCenterId: "cs1",
      actorIsHoLevel: true,
    });
    expect(r.ok).toBe(false);
  });

  it("lead CHƯA có cơ sở → cho gán, không chặn (cơ sở suy sau từ người nhận)", () => {
    expect(
      canManualAssign({ sale: SALE_CS1, leadCenterId: null, actorIsHoLevel: false }),
    ).toEqual({ ok: true });
  });

  it("sale không có cơ sở (dữ liệu hỏng) → TỪ CHỐI, không đoán bừa", () => {
    // Sale thiếu `centerId` vốn đã rơi khỏi mọi vòng chia tự động. Gán tay cho họ
    // là dựng lại đúng cái lead-chết bằng tay.
    const r = canManualAssign({
      sale: { ...SALE_CS1, centerId: null },
      leadCenterId: "cs1",
      actorIsHoLevel: false,
    });
    expect(r.ok).toBe(false);
  });
});

describe("[Đợt G] chốt chặn nguồn — ba lỗ không được mở lại", () => {
  const doc = (f: string) => fs.readFileSync(f, "utf8");
  const boChuThich = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("cổng action 'Cấu hình chia lead' phải ĐÚNG BẰNG cổng trang", () => {
    // Cổng action lỏng hơn cổng trang là lỗ hổng vô hình: màn hình trông như đã
    // khoá, mà endpoint thì không. Đã có tiền lệ ghi trong plan/14 §4.8.
    const src = boChuThich(doc("app/(admin)/admin/leads/actions.ts"));
    const i = src.indexOf("export async function setCenterAssignModeAction");
    expect(i).toBeGreaterThan(-1);
    const than = src.slice(i, i + 1200);
    expect(than, "action phải đòi leads:assign-config như trang").toContain(
      "leads:assign-config",
    );
  });

  it("gán tay phải đi qua canManualAssign, không tự viết điều kiện tại chỗ", () => {
    const src = boChuThich(doc("lib/lead/auto-assign.ts"));
    const i = src.indexOf("export async function manualAssignLead");
    expect(i).toBeGreaterThan(-1);
    expect(src.slice(i, i + 1600)).toContain("canManualAssign");
  });

  it("hai màn tạo/sửa lead tay tra trùng theo BIẾN THỂ SĐT, không so đúng-bằng", () => {
    // `phoneVariants` đã có sẵn (lib/phone.ts) và `lib/lead/dedup.ts` dùng đúng từ
    // lâu. Đừng viết hàm chuẩn hoá SĐT thứ bảy.
    const src = boChuThich(doc("app/(admin)/admin/leads/actions.ts"));
    expect(src, "còn chỗ tra lead theo `phone: d.phone` (so đúng-bằng)").not.toMatch(
      /where:\s*\{\s*phone:\s*d\.phone\s*,/,
    );
    expect(src).toContain("phoneVariants");
  });
});
