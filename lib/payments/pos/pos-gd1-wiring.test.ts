// Ca [POS1-W1..W5] · [POS1-EV-07..08] · [POS1-D5-03] · [POS1-IMP-W] — LƯỚI GHIM MÃ NGUỒN cho GĐ1
// thu thẻ POS. THUẦN.
//
// Luật dạng "lời gọi này KHÔNG được có / chỉ được có ở đây" — test hành vi không chứng minh được vì
// chúng chỉ đỏ khi ai đó viết ĐƯỜNG GHI TIỀN THỨ HAI (thiết kế §3.1: tiền thẻ có MỘT đường —
// `BankTransaction{CARD_POS}` → `thuTheoPhieuGop`, qua thân dòng chung của `nhapLoPos`).
//
// Bóc chú thích TRƯỚC khi đếm (chú thích giải thích bản vá chứa đúng chuỗi đang cấm — luật 11), và
// khẳng định SỐ LẦN khớp. Mã TRƯỚC bản vá được ghi tại từng ca.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const TRAN_QUET_MS = 30_000;

function bocChuThich(v: string): string {
  return v
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|[^:"'`])\/\/[^\n]*$/, "$1"))
    .join("\n");
}

const doc = (tep: string) => bocChuThich(readFileSync(resolve(process.cwd(), tep), "utf8"));
const dem = (ma: string, re: RegExp) => [...ma.matchAll(new RegExp(re.source, "g"))].length;

/** Mã chạy THẬT (không test) dưới các thư mục — gồm cả tệp CHƯA track (lưới phải thấy tệp mới). */
function maChayThat(thuMuc: string[]): string[] {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...thuMuc], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split(/\r?\n/)
    .filter((d) => /\.tsx?$/.test(d))
    .filter((d) => !/\.(test|spec)\.tsx?$/.test(d))
    .filter((d) => existsSync(resolve(process.cwd(), d)));
}

/** Thân một hàm `function ten(` tới `}` đóng cùng cấp. */
function than(ma: string, ten: string): string {
  const i = ma.search(new RegExp(`function ${ten}\\s*[(<]`));
  if (i < 0) return "";
  const mo = ma.indexOf("{", ma.indexOf(")", i));
  let sau = 0;
  for (let k = mo; k < ma.length; k += 1) {
    if (ma[k] === "{") sau += 1;
    else if (ma[k] === "}") {
      sau -= 1;
      if (sau === 0) return ma.slice(i, k + 1);
    }
  }
  return "";
}

const TEP_LOI_POS = [
  "lib/payments/pos/xu-ly-ket-qua.ts",
  "lib/payments/pos/phieu-pos.ts",
  "lib/payments/pos/dong-bo-sau-nhap.ts",
  "lib/payments/pos/provider/kieu.ts",
  "lib/payments/pos/provider/fake.ts",
  "lib/payments/pos/provider/tcb-file.ts",
  "lib/payments/pos/provider/tcb-api.ts",
  "lib/payments/pos/provider/chon.ts",
  // GĐ4 — provider đọc qua POS Agent + phần đọc dữ liệu tách ra từ tcb-file.ts (cùng luật: KHÔNG tự ghi tiền).
  "lib/payments/pos/provider/tcb-agent.ts",
  "lib/payments/pos/provider/doc-du-lieu.ts",
];

describe("[POS1-W] một đường tiền thẻ", () => {
  it("[POS1-W1] tầng phiếu POS KHÔNG tự ghi tiền — tiền chỉ qua `khopGiaoDichThe`", () => {
    for (const tep of TEP_LOI_POS) {
      expect(existsSync(resolve(process.cwd(), tep)), `${tep} phải tồn tại`).toBe(true);
      const ma = doc(tep);
      for (const cam of [
        /\bthuTheoPhieuGop\s*\(/,
        /\ballocateToOrder\s*\(/,
        /\bingestPayosWebhook\s*\(/,
        /\bdocMemo\s*\(/,
        /\bganTienTheoCon\s*\(/,
        /\.payment\.create(?:Many)?\s*\(/,
        /\.paymentAllocation\.create(?:Many)?\s*\(/,
        /\.bankTransaction\.(?:create|update|updateMany|upsert)\s*\(/,
      ]) {
        expect(dem(ma, cam), `${tep}: ${cam.source}`).toBe(0);
      }
    }
    // Đối chứng dương: pha tiền đi qua ĐÚNG MỘT lời gọi thân dòng chung.
    expect(dem(doc("lib/payments/pos/xu-ly-ket-qua.ts"), /\bkhopGiaoDichThe\s*\(/)).toBe(1);
  });

  it(
    "[POS1-W2] toàn mã chạy thật: `thuTheoPhieuGop(` chỉ được GỌI ở payos-ingest.ts + nhap-lo-pos.ts",
    { timeout: TRAN_QUET_MS },
    () => {
      const goi: string[] = [];
      for (const tep of maChayThat(["app", "lib"])) {
        const ma = doc(tep);
        // Lời gọi, không phải định nghĩa (`function thuTheoPhieuGop(`) hay `typeof thuTheoPhieuGop`.
        const n = [...ma.matchAll(/(?<!function\s)\bthuTheoPhieuGop\s*\(/g)].length;
        for (let i = 0; i < n; i += 1) goi.push(tep);
      }
      expect(goi.sort()).toEqual(["lib/payments/payos-ingest.ts", "lib/payments/pos/nhap-lo-pos.ts"]);
    },
  );

  it("[POS1-W3] F3: thân dòng nhận giao dịch TƯỜNG MINH; nhapLoPos đọc giao dịch theo KHOÁ một câu cho cả lô", () => {
    const ma = doc("lib/payments/pos/nhap-lo-pos.ts");
    // Mã TRƯỚC bản vá: `const bt = cu?.bankTransaction ?? null;` ngay đầu `xuLyDongThanhToan` — giao
    // dịch CÓ mà dòng POS CHƯA có thì cổng "vừa gỡ gắn" bị bỏ qua.
    expect(dem(ma, /const bt = cu\?\.bankTransaction \?\? null;/), "không suy giao dịch chỉ từ dòng POS").toBe(0);
    const thanDong = than(ma, "xuLyDongThanhToan");
    expect(thanDong, "tìm thấy thân xuLyDongThanhToan").not.toBe("");
    expect(thanDong.slice(0, thanDong.indexOf("{")), "tham số `bt` bắt buộc").toMatch(
      /\bbt:\s*GiaoDichDaCo \| null\b/,
    );
    const thanLo = than(ma, "nhapLoPos");
    expect(dem(thanLo, /\.bankTransaction\.findMany\(\{/), "một câu đọc giao dịch cho cả lô").toBe(1);
    expect(thanLo).toMatch(/provider:\s*PROVIDER_THE_POS,\s*providerTxnId:\s*\{\s*in:\s*maTrongLo\s*\}/);
    // Cổng "vừa gỡ gắn" không còn đòi dòng POS đã có.
    expect(dem(thanDong, /if \(cu && bt\?\.status === "UNMATCHED"/), "cổng gỡ gắn không đòi `cu`").toBe(0);
    expect(dem(thanDong, /bt\?\.status === "UNMATCHED" && \(bt\.unmatchedNote \?\? ""\)\.startsWith\(TIEN_TO_GO_GAN\)/)).toBe(1);
  });

  it(
    "[POS1-W5] không tệp chạy thật nào import FakePosProvider",
    { timeout: TRAN_QUET_MS },
    () => {
      const vi: string[] = [];
      for (const tep of maChayThat(["app", "lib", "components"])) {
        if (tep === "lib/payments/pos/provider/fake.ts") continue;
        if (/from\s+["'][^"']*provider\/fake["']/.test(doc(tep))) vi.push(tep);
      }
      expect(vi).toEqual([]);
    },
  );
});

describe("[POS1-EV] sự kiện sau DA_CHIA", () => {
  it("[POS1-EV-07] phieu-gop.ts phát ĐÚNG MỘT `phieu-gop.da-chia`, nằm SAU phép đặt MATCHED và TRƯỚC return DA_CHIA", () => {
    const ma = doc("lib/finance/phieu-gop.ts");
    expect(dem(ma, /publishEvent\(\s*"phieu-gop\.da-chia"/)).toBe(1);
    const iPhat = ma.search(/publishEvent\(\s*"phieu-gop\.da-chia"/);
    const iMatched = ma.search(/data: \{ status: "MATCHED", centerId: txn\.centerId \?\? don\.centerId, unmatchedNote: null \}/);
    const iReturn = ma.search(/ketQua: "DA_CHIA" as const,/);
    expect(iMatched).toBeGreaterThan(-1);
    expect(iPhat, "phát SAU khi giao dịch đã MATCHED").toBeGreaterThan(iMatched);
    expect(iPhat, "phát TRƯỚC return DA_CHIA (trong cùng transaction)").toBeLessThan(iReturn);
    // dedupeKey mang cả giao dịch lẫn phiếu.
    expect(ma).toMatch(/dedupeKey: `phieu-gop\.da-chia:\$\{input\.bankTransactionId\}:\$\{phieu\.id\}`/);
    // Có tx — outbox: rollback tiền thì không có sự kiện.
    const khoi = ma.slice(iPhat, iPhat + 900);
    expect(khoi).toMatch(/\{\s*tx,/);
    const reg = doc("lib/events/register.ts");
    expect(dem(reg, /\bregisterPhieuGopDaChiaHandlers\(\)/)).toBe(1);
  });

  it("[POS1-EV-08] allocateToOrder và handler DA_CHIA cùng chốt đơn qua MỘT hàm `sauKhiDonThuDu`", () => {
    const ingest = doc("lib/payments/payos-ingest.ts");
    const handler = doc("lib/payments/sau-da-chia.ts");
    expect(dem(ingest, /\bsauKhiDonThuDu\s*\(/)).toBe(1);
    expect(dem(handler, /\bsauKhiDonThuDu\s*\(/)).toBe(1);
    // Thân cũ đã DỜI hẳn sang don-thu-du.ts — không còn bản thứ hai.
    expect(dem(ingest, /async function confirmSettledOrder\(/)).toBe(0);
    expect(dem(ingest, /async function sendOrderReceipt\(/)).toBe(0);
    const chung = doc("lib/payments/don-thu-du.ts");
    expect(dem(chung, /status: "PENDING_PAYMENT",/), "chốt có điều kiện PENDING_PAYMENT").toBe(1);
    // Hai phép chốt, CẢ HAI có điều kiện: PENDING_PAYMENT (đường cũ) · CONFIRMED + confirmedAt NULL
    // (đơn bị recompute đặt CONFIRMED ngầm — F6). Mã cấy `update` trần là gửi biên nhận mỗi lần.
    expect(dem(chung, /\.order\.updateMany\(\{/)).toBe(2);
    expect(dem(chung, /\.order\.update\(\{/), "không phép chốt trần").toBe(0);
    expect(chung).toMatch(/where: \{ id: orderId, status: "CONFIRMED", confirmedAt: null \}/);
    // Vế "chốt ngầm" chỉ chạy khi người gọi XIN — đường cũ truyền false, handler phiếu gộp true.
    expect(dem(ingest, /nhanDonChotNgam: false,/)).toBe(1);
    expect(dem(handler, /nhanDonChotNgam: true,/)).toBe(1);
    expect(chung, "không import sổ marker của đường xác nhận đơn ([GGW-04])").not.toMatch(/from "@\/lib\/finance\/payment"/);
  });
});

describe("[POS1-D5] tách luồng chuyển khoản ↔ thẻ", () => {
  it(
    "[POS1-D5-03] không route webhook nào nói 'CARD_POS'; tầng thẻ chỉ dùng hằng PROVIDER_THE_POS",
    { timeout: TRAN_QUET_MS },
    () => {
      for (const tep of maChayThat(["app/api/public/webhook"])) {
        const ma = doc(tep);
        expect(ma, tep).not.toMatch(/CARD_POS|PROVIDER_THE_POS/);
      }
      for (const tep of ["lib/payments/pos/nhap-lo-pos.ts", "lib/payments/pos/xu-ly-ket-qua.ts"]) {
        expect(dem(doc(tep), /"CARD_POS"/), `${tep} không viết chuỗi trần`).toBe(0);
      }
    },
  );
});

describe("[POS1-IMP-W] đồng bộ phiếu POS sau import", () => {
  it("ketThucNhapPosAction gọi đồng bộ ĐÚNG MỘT lần, TRƯỚC lamMoi()", () => {
    const ma = doc("app/(admin)/admin/bien-dong-so-du/_pos-actions.ts");
    const t = ma.match(/export async function ketThucNhapPosAction[\s\S]*?\n\}\n?/)?.[0] ?? "";
    expect(t).not.toBe("");
    expect(dem(t, /\bdongBoPhieuPosSauNhap\(/)).toBe(1);
    expect(t.search(/\bdongBoPhieuPosSauNhap\(/)).toBeLessThan(t.search(/\blamMoi\(\)/));
    // `[POS-UI-02]` đếm đúng 2 lời hỏi phạm vi — đồng bộ không được thêm lần thứ ba.
    expect(dem(ma, /nhapPosDuocMoiCoSo\(actor\)/)).toBe(2);
  });
});
