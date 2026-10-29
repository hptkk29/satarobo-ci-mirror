// lib/entitlements/buoc-leo-tien.test.ts — LƯỚI BƯỚC LEO của "tiền về ⇒ cấp quyền học". KHÔNG DB. [QHC-W11..W16]
//
// Lời hứa cần canh: MỌI chỗ làm tiền của đơn đổi đều hoặc (a) hích `xetCapQuyenHocChoDon` (qua vỏ `hich.ts`), hoặc (b) phát
// sự kiện mà `su-kien.ts` nghe, hoặc (c) có LÝ DO ghi bằng chữ vì sao không cần. Không có lưới này thì một đường tiền mới thêm
// sau (hoặc một action gắn tiền mới) KHÔNG cấp quyền học và KHÔNG lỗi nào báo — đúng lớp lỗi câm đã làm cổng "tiền vào ⇒ lead
// Đã đăng ký" thiếu ở đường webhook cả chục ngày (I-1).
//
// Hai tầng:
//   · [QHC-W11] TẦNG TỆP — mọi tệp mã trong lib/ + app/ có phép ghi `Payment` / `PaymentAllocation` (create·createMany·upsert·update·
//     updateMany, kể cả SQL thô) phải được KHAI trong `GHI_TIEN` kèm cách xử lý và lý do. Tệp ghi tiền MỚI mà quên ⇒ ĐỎ.
//   · [QHC-W12] TẦNG ĐƯỜNG GỌI — mọi nơi gọi các hàm ghi tiền XUẤT RA của `ghi-tien-don.ts` (nơi giữ khoá đơn nên KHÔNG tự hích
//     được) phải có hích ở tầng action, với số lời hích ≥ số lời gọi.
//
// Luật 11: neo LỜI GỌI (`ten(`), đếm SỐ LẦN, chạy trên mã ĐÃ BỎ CHÚ THÍCH; KHÔNG neo chỗ đặt `await`. Chưa cấy thử thì coi như vô dụng
// — mô tả PR ghi các phép cấy đã làm.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const dem = (s: string, re: RegExp) => s.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))?.length ?? 0;
const docMa = (tep: string): string => boChuThich(readFileSync(resolve(process.cwd(), tep), "utf8"));

function gitGrepTep(ere: string): string[] {
  let ra: string;
  try {
    ra = execFileSync("git", ["grep", "--untracked", "-l", "-E", ere, "--", "lib", "app"], { encoding: "utf8" });
  } catch {
    ra = ""; // git grep thoát 1 khi không có kết quả
  }
  return ra
    .split("\n")
    .filter(Boolean)
    .map((t) => t.replace(/\\/g, "/"))
    .filter((t) => !/\.test\.tsx?$/.test(t))
    .sort();
}

/** Phép ghi tiền: `.payment.<ghi>(`, `paymentAllocation.<ghi>(`, hoặc SQL thô `INSERT INTO|UPDATE "Payment"`. */
const GHI_TIEN_JS = /\.payment\.(create|createMany|upsert|update|updateMany)\s*\(|paymentAllocation\.(create|createMany|upsert)\s*\(|(INSERT INTO|UPDATE)\s+"Payment"/;
const GHI_TIEN_ERE =
  '\\.payment\\.(create|createMany|upsert|update|updateMany)[[:space:]]*\\(|paymentAllocation\\.(create|createMany|upsert)[[:space:]]*\\(|(INSERT INTO|UPDATE)[[:space:]]+"Payment"';

const LOI_HICH = /\bhichCapQuyenHoc(ChoDon|ChoLead)\s*\(/;

type CachXuLy =
  /** Chính tệp này gọi vỏ hích sau commit. */
  | { readonly cach: "DA_NOI" }
  /** Tệp phát các sự kiện (literal) mà `su-kien.ts` nghe. */
  | { readonly cach: "SU_KIEN"; readonly suKien: readonly string[] }
  /** Hàm ghi tiền giữ khoá đơn nên KHÔNG tự hích; mọi nơi gọi phải hích (xem [QHC-W12]). */
  | { readonly cach: "TANG_ACTION" }
  /** Không cần hích — lý do bằng chữ. */
  | { readonly cach: "KHONG_CAN"; readonly lyDo: string };

/**
 * Tệp ghi tiền → cách quyền học biết về nó. Thêm tệp ghi tiền MỚI = thêm một dòng ở đây (và chọn cách), nếu không [QHC-W11] đỏ.
 * Đây là danh sách các đường tiền đo được 11/10/2026.
 */
const GHI_TIEN: Readonly<Record<string, CachXuLy>> = {
  "lib/payments/payos-ingest.ts": { cach: "DA_NOI" },
  "lib/finance/phieu-gop.ts": { cach: "SU_KIEN", suKien: ["phieu-gop.da-chia"] },
  "lib/payments/phieu-theo-con-don-moi.ts": {
    cach: "KHONG_CAN",
    lyDo: "Chỉ là phép GHI `Payment` theo con do `allocateToOrder` (payos-ingest.ts) gọi — tệp đó đã hích quyền học sau commit (DA_NOI). Đừng gọi hàm ghi này từ nơi khác.",
  },
  // confirmPayment → confirmed (tiền VÀO); rejectPayment → rejected, refundPayment → refunded (CHIỀU NGƯỢC). recordPayment luôn PENDING (đóng góp 0).
  "lib/finance/payment.ts": { cach: "SU_KIEN", suKien: ["payment.confirmed", "payment.rejected", "payment.refunded"] },
  "lib/finance/chi-hoan-tien.ts": { cach: "SU_KIEN", suKien: ["payment.refunded"] },
  "lib/finance/ghi-tien-don.ts": { cach: "TANG_ACTION" },
  "app/(admin)/admin/payments/_actions.ts": {
    cach: "KHONG_CAN",
    lyDo: "Chỉ GẮN ghi danh vào khoản đã có (cột enrollmentId): không đổi số tiền, trạng thái hay dòng đơn mà tiền thuộc về — số 'đủ tiền' của dòng không đổi.",
  },
  "lib/nguon/gan-payment-ghi-danh-db.ts": {
    cach: "KHONG_CAN",
    lyDo: "Vá dữ liệu Wave 1 chạy TAY có chữ ký owner (phạm vi cứng, dry-run mặc định): chỉ GẮN ghi danh vào khoản đã có (cột enrollmentId, updateMany có điều kiện) — không đổi số tiền, trạng thái hay dòng đơn mà tiền thuộc về, nên số 'đủ tiền' của dòng không đổi.",
  },
  "lib/nguon/wave-c-gan-payment-ghi-danh-db.ts": {
    cach: "KHONG_CAN",
    lyDo: "Wave C-C (vá dữ liệu chạy TAY có chữ ký owner, dry-run mặc định): cùng bản chất Wave 1 — chỉ GẮN ghi danh vào khoản đã có (cột enrollmentId, updateMany có điều kiện), không đổi số tiền, trạng thái hay dòng đơn mà tiền thuộc về, nên số 'đủ tiền' của dòng không đổi.",
  },
  "lib/nguon/xu-ly-don-backfill-sai-db.ts": {
    cach: "KHONG_CAN",
    lyDo: "PHASE X (vá dữ liệu chạy TAY có chữ ký owner, dry-run mặc định, phạm vi là hằng): dọn MỘT đơn backfill lịch sử nhập SAI — chỉ xoá mềm khoản PENDING do backfill-import ghi, gỡ liên kết ghi danh và huỷ đơn. Chỉ làm GIẢM: không tạo khoản, không đổi số tiền, không thể làm một dòng thành đủ tiền; đường lịch sử cùng bản chất lib/crm/backfill-order.ts nên không có quyền học để cấp.",
  },
  "lib/nguon/chuyen-khoan-ghi-danh-db.ts": {
    cach: "KHONG_CAN",
    lyDo: "P7-B (vá dữ liệu chạy TAY có chữ ký owner, owner duyệt riêng, dry-run mặc định): chỉ ĐỔI ghi danh mà khoản đã xác nhận đang gắn (cột enrollmentId, updateMany có điều kiện) từ ghi danh đã đóng sang ghi danh đang học — không đổi số tiền, trạng thái hay dòng đơn mà tiền thuộc về, nên số 'đủ tiền' của dòng không đổi.",
  },
  "lib/nguon/chuyen-khoan-hoan-tac-db.ts": {
    cach: "KHONG_CAN",
    lyDo: "P7-B v2 HOÀN TÁC (vá dữ liệu chạy TAY có chữ ký owner RIÊNG, dry-run mặc định): chỉ ĐƯA khoản về ghi danh cũ mà lượt chuyển P7-B (chuyen-khoan-ghi-danh-db.ts) đã đổi (cột enrollmentId, updateMany có điều kiện) và trả giá về như trước lượt chuyển — không đổi số tiền, trạng thái hay dòng đơn mà tiền thuộc về, nên số 'đủ tiền' của dòng không đổi.",
  },
  "lib/crm/backfill-order.ts": {
    cach: "KHONG_CAN",
    lyDo: "Đường LỊCH SỬ (nhập đơn cũ, G-56): đơn không mang dấu SCOPE nên không bao giờ có quyền học; đừng nối để khỏi cấp quyền cho dữ liệu cũ.",
  },
  "lib/finance/ghi-giao-dich-cu.ts": {
    cach: "KHONG_CAN",
    lyDo: "Đường LỊCH SỬ (nhập giao dịch cũ): đơn không mang dấu SCOPE; cấp quyền học cho dữ liệu cũ là việc của lượt nhập có chủ đích, không phải của cú hích tiền về.",
  },
  "lib/finance/backfill-orderitem.ts": {
    cach: "KHONG_CAN",
    lyDo: "Vá lịch sử bằng tay (gán orderItemId cho khoản cũ, dry-run mặc định, người vận hành chạy): chạy trước khi có đơn SCOPE; nếu sau này đụng đơn SCOPE thì lần hích kế tiếp của chính đơn đó tự bù.",
  },
  "lib/uat/nap-du-lieu-hoa-hong.ts": {
    cach: "KHONG_CAN",
    lyDo: "Bộ nạp dữ liệu UAT (chỉ DB UAT, qua cổng cong-db-uat): khoản thu đi qua recordPayment/confirmPayment (đã phát payment.confirmed); hai phép ghi trực tiếp chỉ gắn orderItemId vào khoản vừa tạo và chỉnh ngày/ghi chú dòng hoàn — không tạo khoản mới, không đổi số tiền.",
  },
  "lib/uat/nguon-final-db.ts": {
    cach: "KHONG_CAN",
    lyDo: "Bộ nạp dữ liệu UAT SOURCE FINAL (chỉ DB UAT, qua cổng cong-db-uat): khoản thu đi qua recordPayment/confirmPayment/rejectPayment (đã phát sự kiện của chúng); phép ghi trực tiếp duy nhất chỉ gắn orderItemId vào khoản vừa tạo — không tạo khoản mới, không đổi số tiền. Đơn không mang dấu SCOPE nên không có quyền học để cấp.",
  },
  "lib/orders/installments.ts": {
    cach: "KHONG_CAN",
    lyDo: "Chỉ xoá mềm khoản PENDING do kế hoạch đợt cũ tự sinh (luồng LEGACY, đơn SCOPE từ chối kế hoạch đợt): chỉ làm giảm, không thể làm một dòng đủ tiền.",
  },
};

const TEP_GHI_TIEN = gitGrepTep(GHI_TIEN_ERE).filter((t) => GHI_TIEN_JS.test(docMa(t)));

describe("[QHC-W11] mọi tệp ghi tiền được khai cách quyền học biết về nó", () => {
  it("[QHC-W11a] không tệp ghi tiền nào bị bỏ sót (tệp mới ghi Payment/PaymentAllocation mà chưa khai ⇒ đỏ)", () => {
    expect(TEP_GHI_TIEN.filter((t) => !(t in GHI_TIEN))).toEqual([]);
  });

  it("[QHC-W11b] đối chứng: bộ lọc THẤY các tệp ghi tiền đã biết (không rỗng vì regex hỏng) và bắt đúng ba dạng ghi", () => {
    expect(TEP_GHI_TIEN).toEqual(expect.arrayContaining(["lib/payments/payos-ingest.ts", "lib/finance/payment.ts", "lib/finance/ghi-tien-don.ts"]));
    for (const mau of [
      "await tx.payment.create({ data })",
      "await tx.payment.updateMany({ where })",
      "await db.paymentAllocation.createMany({ data })",
      'await tx.$executeRaw`UPDATE "Payment" SET amount = 1`',
    ]) {
      expect(GHI_TIEN_JS.test(mau), mau).toBe(true);
    }
    for (const khong of ["const p = await tx.payment.findMany({})", "tx.paymentRequest.create({})", "// tx.payment.create(", "paymentAllocation.findMany("]) {
      expect(GHI_TIEN_JS.test(boChuThich(khong)), khong).toBe(false);
    }
  });

  it("[QHC-W11c] không có mục khai THỪA: mỗi tệp đã khai vẫn còn phép ghi tiền (tệp đổi hướng thì dòng khai phải đi theo)", () => {
    expect(Object.keys(GHI_TIEN).filter((t) => !TEP_GHI_TIEN.includes(t))).toEqual([]);
  });

  it("[QHC-W11d] DA_NOI ⇒ chính tệp có lời hích (đếm ≥ 1); SU_KIEN ⇒ tệp phát sự kiện LITERAL và su-kien.ts nghe đúng tên đó; KHONG_CAN ⇒ lý do bằng chữ", () => {
    const sk = docMa("lib/entitlements/su-kien.ts");
    for (const [tep, c] of Object.entries(GHI_TIEN)) {
      const ma = docMa(tep);
      if (c.cach === "DA_NOI") expect(dem(ma, LOI_HICH), tep).toBeGreaterThanOrEqual(1);
      if (c.cach === "SU_KIEN") {
        for (const ten of c.suKien) {
          expect(ma, `${tep} phải phát "${ten}"`).toContain(`"${ten}"`);
          expect(dem(sk, new RegExp(`\\bon\\("${ten.replace(/\./g, "\\.")}"`)), `su-kien.ts phải nghe "${ten}"`).toBe(1);
        }
      }
      if (c.cach === "KHONG_CAN") expect(c.lyDo.trim().length, tep).toBeGreaterThanOrEqual(40);
    }
  });
});

describe("[QHC-W12] mọi nơi gọi hàm ghi tiền giữ khoá đơn phải hích sau commit ở tầng action", () => {
  /** Hàm XUẤT RA của `ghi-tien-don.ts` làm đổi tiền theo dòng (tạo/huỷ đợt không đổi tiền nên không có mặt). */
  const HAM_GHI_TIEN = [
    "ganTienTheoCon",
    "ganTienTheoConVaDongPhieu", // #663: bản gắn tay có đóng phiếu — màn gọi nó thay cho hàm trần
    "goGanTheoCon",
    "ganKhoanDaThuChoCon",
    "boGanKhoanKhoiCon",
    "tachKhoanChoCon",
    "chuyenTienGiuaCon",
    "dungHocMotCon", // dừng học chuyển phần dư sang bé khác (chiều ngược)
    "allocateToOrder",
  ] as const;
  /** Tệp ĐỊNH NGHĨA hàm (không phải nơi gọi). */
  const DINH_NGHIA = new Set(["lib/finance/ghi-tien-don.ts", "lib/payments/payos-ingest.ts", "lib/finance/dung-hoc-con.ts", "lib/finance/gan-tay-va-dong-phieu.ts"]);

  it("[QHC-W12a] mỗi tệp gọi một hàm ghi tiền có số lời hích ≥ số lời gọi hàm ghi tiền (neo lời GỌI, đếm số lần)", () => {
    const hong: string[] = [];
    let soNoiGoi = 0;
    for (const ham of HAM_GHI_TIEN) {
      for (const tep of gitGrepTep(`\\b${ham}[[:space:]]*\\(`)) {
        if (DINH_NGHIA.has(tep)) continue;
        const ma = docMa(tep);
        const soGoi = HAM_GHI_TIEN.reduce((s, h) => s + dem(ma, new RegExp(`(?<!function\\s)\\b${h}\\s*\\(`)), 0);
        if (soGoi === 0) continue;
        soNoiGoi++;
        const soHich = dem(ma, LOI_HICH);
        // allocateToOrder đã tự hích bên trong (DA_NOI) nên nơi gọi nó không cần hích thêm.
        const chiAllocate = HAM_GHI_TIEN.filter((h) => h !== "allocateToOrder").every((h) => dem(ma, new RegExp(`\\b${h}\\s*\\(`)) === 0);
        if (!chiAllocate && soHich < soGoi) hong.push(`${tep}: ${soGoi} lời gọi hàm ghi tiền nhưng chỉ ${soHich} lời hích`);
      }
    }
    expect(soNoiGoi, "bộ lọc phải thấy các nơi gọi đã biết (không rỗng vì regex hỏng)").toBeGreaterThanOrEqual(3);
    expect(hong).toEqual([]);
    // Trần 5 s mặc định không đủ khi cả bộ chạy song song: ca chạy một `git grep` cho MỖI hàm ghi tiền (đã 9 hàm từ #663) trên cả cây. Đo: 1,5 s một mình, quá 5 s dưới tải (gate #663).
  }, 60_000);

  it("[QHC-W12b] các nơi gọi đã biết CÓ mặt và mang đủ lời hích (ghim số lần — gỡ một lời hích là đỏ)", () => {
    const mong: Record<string, number> = {
      "app/(admin)/admin/bien-dong-so-du/_gan-theo-con.ts": 2, // gắn + gỡ gắn
      "app/(admin)/admin/orders/_actions.ts": 5, // gắn một khoản · bỏ gắn · tách · chuyển giữa các bé · dừng học
      "app/(admin)/admin/payments/_actions.ts": 2, // xác nhận · điều chỉnh
    };
    for (const [tep, n] of Object.entries(mong)) expect(dem(docMa(tep), /\bhichCapQuyenHocChoDon\s*\(/), tep).toBe(n);
  });
});

describe("[QHC-W13] dây nối sau commit: webhook đời cũ, Chuyển đổi, convert lead", () => {
  it("[QHC-W13a] allocateToOrder: đúng MỘT lời hích, SAU nhánh DUPLICATE (không hích giao dịch trùng) và NGOÀI `if (result.settled)`", () => {
    const ma = docMa("lib/payments/payos-ingest.ts");
    expect(dem(ma, /\bhichCapQuyenHocChoDon\s*\(/)).toBe(1);
    const iDup = ma.indexOf('result.kind === "DUPLICATE"');
    const iHich = ma.indexOf("hichCapQuyenHocChoDon(");
    expect(iDup).toBeGreaterThan(-1);
    expect(iHich).toBeGreaterThan(iDup);
    // Giữa nhánh DUPLICATE và lời hích không có `settled`: lời hích không nằm trong `if (result.settled)`.
    expect(ma.slice(iDup, iHich)).not.toMatch(/\bsettled\b/);
    // Và KHÔNG nằm trong callback `$transaction` (lời hích đứng sau `catch` của khối giao dịch).
    expect(ma.indexOf("} catch (err)", ma.indexOf("result = await db.$transaction("))).toBeLessThan(iHich);
  });

  it("[QHC-W13b] Chuyển đổi: chuyenDoiDonAction hích ĐÚNG MỘT lần theo đơn, SAU khối giao dịch; convertLeadV2 hích ĐÚNG MỘT lần theo lead, SAU commit", () => {
    const cd = docMa("app/(admin)/admin/orders/[id]/chuyen-doi/_actions.ts");
    expect(dem(cd, /\bhichCapQuyenHocChoDon\s*\(/)).toBe(1);
    // 27/10/2026: action nay có HAI khối try/catch (chuyển đổi, đổi buổi bắt đầu) — lời hích phải đứng sau khối ĐẦU, của chuyển đổi.
    expect(cd.indexOf("hichCapQuyenHocChoDon(")).toBeGreaterThan(cd.indexOf("} catch (e)"));
    const cv = docMa("lib/crm/convert-lead-v2.ts");
    expect(dem(cv, /\bhichCapQuyenHocChoLead\s*\(/)).toBe(1);
    expect(cv.indexOf("hichCapQuyenHocChoLead(")).toBeGreaterThan(cv.indexOf('publishEvent("consent.granted"'));
  });

  it("[QHC-W13c] recordPayment KHÔNG nối (luôn tạo PENDING nên đóng góp 0): payment.ts không hích quyền học, chỉ import hàm QUYẾT cổng xác-nhận-trước-ghi-danh", () => {
    const ma = docMa("lib/finance/payment.ts");
    expect(ma).not.toMatch(/hichCapQuyenHoc|xetCapQuyenHocChoDon/);
    expect(ma.match(/@\/lib\/entitlements\/[a-z-]+/g) ?? []).toEqual(["@/lib/entitlements/xac-nhan-truoc"]);
    const i = ma.indexOf("export async function recordPayment(");
    const than = ma.slice(i, ma.indexOf("export async function confirmPayment("));
    expect(i).toBeGreaterThan(-1);
    expect(than).toMatch(/accountantStatus:\s*"PENDING"/);
    expect(than).not.toMatch(/accountantStatus:\s*"CONFIRMED"/);
  });

  it("[QHC-W13d] vỏ hích KHÔNG BAO GIỜ NÉM: ba try/catch (cấp quyền · xếp lớp · hích theo lead), không `throw`, và MỖI lời gọi xuống tầng DB nằm trong try của chính nó", () => {
    // 12/10/2026 (PR xếp lớp): từ 2 lên 3 — xetXepLopChoDon có try RIÊNG để lỗi cấp quyền không chặn xếp lớp của quyền học đã có và ngược lại.
    // LÝ LẼ của lưới (vỏ không ném, không lời gọi nào đứng ngoài try) giữ nguyên; chỉ con số đổi theo số lời gọi.
    const ma = docMa("lib/entitlements/hich.ts");
    expect(dem(ma, /\btry\s*\{/)).toBe(3);
    expect(dem(ma, /\bcatch\s*\(/)).toBe(3);
    expect(ma).not.toMatch(/\bthrow\b/);
    // PR hàng đợi (12/10/2026): hai lời gọi xuống tầng DB nay đi qua HAI hàm bọc CÓ KẾT QUẢ ở cuối tệp (cron và nút "Thử cấp lại" cần kết quả); vỏ vẫn gọi
    // chúng TRONG try của chính nó. Lý lẽ của lưới (vỏ không ném, không lời gọi nào đứng ngoài try) giữ nguyên — chỉ tên lời gọi đổi.
    // Hai hàm bọc chỉ có MỘT dòng `return …` mỗi hàm, đã được `[QHC-W7]` / `[XL-W10]` đếm.
    for (const goi of ["xetCapQuyenHocCoKetQua(orderId", "xetXepLopCoKetQua(orderId", "db.order.findMany("]) {
      const i = ma.indexOf(goi);
      expect({ goi, thay: i > -1 }).toEqual({ goi, thay: true });
      const truoc = ma.slice(0, i);
      // lời gọi phải nằm SAU một try { chưa đóng bằng catch trước nó
      expect({ goi, trongTry: dem(truoc, /\btry\s*\{/) > dem(truoc, /\bcatch\s*\(/) }).toEqual({ goi, trongTry: true });
    }
  });
});

describe("[QHC-W14] dòng CHỜ chỉ được ghi dưới khoá đơn, bằng `tx`, có centerId + orgUnitId tường minh", () => {
  const CAP = docMa("lib/entitlements/cap-tu-don.ts");
  const TRONG_TX = CAP.slice(CAP.indexOf("db.$transaction("));

  it("[QHC-W14a] mọi phép ghi/đọc `studyEntitlementXuLy` đứng SAU khoá đơn và đều dùng `tx` (không `db.`/scopedDb)", () => {
    const iKhoa = TRONG_TX.indexOf("khoaDonTrongTx(tx,");
    expect(iKhoa).toBeGreaterThan(-1);
    const lanDau = TRONG_TX.indexOf("studyEntitlementXuLy.");
    expect(lanDau).toBeGreaterThan(iKhoa);
    // Ngoài giao dịch (trước `db.$transaction(`) không đụng bảng này.
    expect(CAP.slice(0, CAP.indexOf("db.$transaction(")).replace(/tx\.studyEntitlementXuLy/g, "")).not.toMatch(/studyEntitlementXuLy\./);
    expect(dem(TRONG_TX, /\bdb\.studyEntitlementXuLy/)).toBe(0);
    // 1 đọc + 1 tạo + 3 cập nhật (mở lại · đổi lý do · đóng). Thêm một phép ghi thứ sáu là phải xét lại khoá + centerId ở đây.
    expect(dem(TRONG_TX, /\btx\.studyEntitlementXuLy\.findMany\(/)).toBe(1);
    expect(dem(TRONG_TX, /\btx\.studyEntitlementXuLy\.create\(/)).toBe(1);
    expect(dem(TRONG_TX, /\btx\.studyEntitlementXuLy\.update\(/)).toBe(3);
  });

  it("[QHC-W14b] dòng chờ MỚI mang centerId và orgUnitId (đã tính trước tx) — scopedDb không che write, quên là dòng vô hình với người cấp cơ sở", () => {
    const i = TRONG_TX.indexOf("studyEntitlementXuLy.create(");
    const khoi = TRONG_TX.slice(i, i + 600);
    expect(khoi).toMatch(/\bcenterId,/);
    expect(khoi).toMatch(/\borgUnitId,/);
  });

  it("[QHC-W14c] khách mới KHÔNG BAO GIỜ được cấp khi chưa biết học viên: lời cấp nằm SAU nhánh `hv.kieu !== \"CO\"`", () => {
    expect(CAP.indexOf('hv.kieu !== "CO"')).toBeGreaterThan(-1);
    expect(CAP.indexOf('hv.kieu !== "CO"')).toBeLessThan(CAP.indexOf("capQuyenHocTrongTx("));
    expect(dem(CAP, /\bcapQuyenHocTrongTx\(/)).toBe(1);
  });
});
