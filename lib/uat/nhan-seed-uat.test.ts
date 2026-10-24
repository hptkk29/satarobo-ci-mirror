// [UAT-NHAN-*] — NHÃN `Lead.source` mà bộ seed UAT gieo phải nằm trong bảng 28 nhãn (không INVALID). THUẦN (đọc tệp + gọi hàm ánh xạ, không DB).
//
// Vì sao: checklist UAT (docs/source-commission/09 bước 16–17) dựng DB bằng `UAT_SEED=1 pnpm db:seed:uat`. Bản cũ gieo 8 nhãn ngoài bảng ("Facebook Ads", "Messenger Page HO",
// "Zalo OA", "Sự kiện trường học", "Vãng lai", "Google", "Tờ rơi", "Quà tặng") ⇒ 229/320 lead INVALID ⇒ `INVALID > 0` chặn cả lệnh backfill (`di-tru-nguon-cu-ghi --apply`) lẫn mốc cutover.
// Đo 11/10/2026 (vòng 5, tái hiện ở vòng 6): báo cáo `di-tru-nguon-cu` trên DB vừa seed in «INVALID | 229».
//
// LUẬT được ghim (không ghim cách viết): MỌI nhãn mà hai mảng seed có thể phát ra đi qua `anhXaNhanCu` thật và KHÔNG ra INVALID. Thêm nhãn lạ vào mảng ⇒ ca [UAT-NHAN-01] đỏ.
// Dây nối: hai tệp seed phải DÙNG hai mảng này (không tự khai mảng riêng) — nếu không, sửa `nhan-nguon.ts` mà tệp seed vẫn gieo nhãn cũ thì lưới 01 xanh trên mã không chạy.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { NHAN_NGUON_CRM, NHAN_NGUON_NOI_LEAD } from "../../prisma/seed-uat/nhan-nguon";
import { anhXaNhanCu } from "../nguon/anh-xa-nhan-cu";

/** Phát hiện đầu vào TRUNG TÍNH: không affiliate, không người nhập — chỉ để hỏi «nhãn này có trong bảng không». */
function anhXa(nhan: string) {
  return anhXaNhanCu(
    { nhan, createdAt: new Date("2026-10-11T03:00:00.000Z"), affiliate: null, nguoiNhap: null, maNvTrongNote: null },
    [],
    "EMPLOYEE_REFERRAL",
  );
}

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
/** Bỏ chú thích TRƯỚC khi soi (luật 11): chú thích giải thích bản vá chứa đúng chuỗi mà bộ so khớp đang tìm. */
const boChuThich = (s: string) => s.split(/\r?\n/).map((d) => d.replace(/(^|\s)\/\/.*$/, "$1")).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
const dem = (s: string, re: RegExp) => [...s.matchAll(re)].length;

describe("[UAT-NHAN] nhãn nguồn của seed UAT nằm trong bảng 28 nhãn", () => {
  const tatCa = [...new Set([...NHAN_NGUON_CRM, ...NHAN_NGUON_NOI_LEAD])];

  it("[UAT-NHAN-01] không nhãn nào ra INVALID (đối chứng ÂM: nhãn cũ của bản trước đều ra INVALID — lưới thật sự phân biệt được)", () => {
    for (const nhan of tatCa) {
      const kq = anhXa(nhan);
      expect(kq.loai, `nhãn «${nhan}»`).not.toBe("INVALID");
    }
    // Đối chứng: chính 8 nhãn đã gây 229 dòng INVALID phải bị hàm ánh xạ gọi là INVALID, nếu không thì phép thử ở trên không chứng minh gì.
    for (const nhan of ["Facebook Ads", "Messenger Page HO", "Zalo OA", "Sự kiện trường học", "Vãng lai", "Google", "Tờ rơi", "Quà tặng"]) {
      expect(anhXa(nhan).loai, `nhãn cũ «${nhan}»`).toBe("INVALID");
    }
  });

  it("[UAT-NHAN-02] độ dài hai mảng giữ nguyên (10 và 6): `pick(rng, …)` chọn theo chỉ số ⇒ đổi số phần tử là đổi toàn bộ dữ liệu gieo phía sau", () => {
    expect(NHAN_NGUON_CRM).toHaveLength(10);
    expect(NHAN_NGUON_NOI_LEAD).toHaveLength(6);
  });

  it("[UAT-NHAN-03] dây nối: hai tệp seed dùng ĐÚNG hai mảng này và không tự khai mảng nhãn riêng", () => {
    const crm = boChuThich(doc("prisma/seed-uat/02-crm.ts"));
    const noi = boChuThich(doc("prisma/seed-uat/08-noi-lead.ts"));
    expect(dem(crm, /const NGUON = NHAN_NGUON_CRM;/g), "02-crm.ts").toBe(1);
    expect(dem(noi, /const NGUON = NHAN_NGUON_NOI_LEAD;/g), "08-noi-lead.ts").toBe(1);
    expect(dem(crm, /const NGUON = \[/g), "02-crm.ts không được tự khai mảng").toBe(0);
    expect(dem(noi, /const NGUON = \[/g), "08-noi-lead.ts không được tự khai mảng").toBe(0);
    // và mảng thật sự được dùng để chọn nhãn của lead
    expect(dem(crm, /source: pick\(rng, NGUON\)/g), "02-crm.ts chọn nhãn từ NGUON").toBe(1);
    expect(dem(noi, /source: pick\(rng, NGUON\)/g), "08-noi-lead.ts chọn nhãn từ NGUON").toBe(1);
  });
});
