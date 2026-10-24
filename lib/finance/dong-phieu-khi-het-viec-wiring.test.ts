// Ca [DPW-*] — LƯỚI GHIM dây nối của #663: mọi đường làm một đợt ĐỦ TIỀN, và đường HUỶ ĐƠN, phải đi qua MỘT hàm đóng phiếu gộp + kết thúc phiếu thẻ.
//
// Hành vi (gắn tay · mã đời cũ · huỷ đơn · giao dịch về sau · idempotent) do `tests/finance/dong-phieu-khi-het-viec.test.ts` đo trên Postgres thật. Tệp này canh thứ test hành
// vi KHÔNG canh được: MỘT ĐƯỜNG GHI TIỀN MỚI xuất hiện mà không ai nối nó vào hàm đóng phiếu — lỗi câm, không ca nào đỏ (đúng cách #663 sống được vài tuần).
// Luật 11: bóc chú thích trước khi soi · neo LỜI GỌI · khẳng định cả SỐ LẦN khớp. Luật 8: đã cấy thử — xem khối "BƯỚC CẤY" cuối tệp.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const GOC = process.cwd();
const HAM = "dongPhieuGopKhiHetViecTrongTx";

function boChuThich(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
const docMa = (tep: string) => boChuThich(readFileSync(resolve(GOC, tep), "utf8"));
const dem = (s: string, re: RegExp) => s.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))?.length ?? 0;

/** Tệp mã nguồn (bỏ test) trong lib + app có nhắc một trong các mẫu `moi` — quét MỘT lần. */
function tepChua(moi: RegExp): string[] {
  const ra: string[] = [];
  const di = (dir: string) => {
    for (const ten of readdirSync(dir)) {
      if (ten === "node_modules" || ten.startsWith(".")) continue;
      const p = join(dir, ten);
      if (statSync(p).isDirectory()) di(p);
      else if (/\.(ts|tsx)$/.test(ten) && !/\.(test|spec)\./.test(ten)) {
        if (moi.test(boChuThich(readFileSync(p, "utf8")))) ra.push(p.slice(GOC.length + 1).replace(/\\/g, "/"));
      }
    }
  };
  di(resolve(GOC, "lib"));
  di(resolve(GOC, "app"));
  return ra.sort();
}

/** Cách mỗi tệp GHI PHÂN BỔ (đường làm đợt đủ tiền) xử lý phiếu gộp. Thêm tệp ghi phân bổ MỚI = thêm một dòng ở đây, nếu không [DPW-00] đỏ. */
const DUONG_GHI_PHAN_BO: Readonly<Record<string, "GOI_HAM" | "HOOK_SAU_GHI" | "TU_DAT_PAID">> = {
  "lib/finance/ghi-tien-don.ts": "HOOK_SAU_GHI", // gắn tay (`ganTienTheoCon`) — không import được hàm đóng (vòng), nhận nó qua `tuyChon.sauKhiGhi`; chỗ ghép: `gan-tay-va-dong-phieu.ts`
  "lib/payments/payos-ingest.ts": "GOI_HAM", // mã đời cũ / "Rót vào đơn" (`allocateToOrder`)
  "lib/finance/phieu-gop.ts": "TU_DAT_PAID", // tự khớp theo mã phiếu: tự đặt phiếu `PAID` + phát sự kiện, KHÔNG qua hàm đóng
};

describe("[DPW-00] mọi tệp ghi `PaymentAllocation` được khai cách xử lý phiếu gộp", () => {
  const tep = tepChua(/\.paymentAllocation\.(?:create|createMany|upsert)\s*\(/);

  it("bộ quét THẤY các đường đã biết (không rỗng vì regex hỏng) và không có đường nào ngoài khai báo", () => {
    expect(tep.length).toBeGreaterThanOrEqual(3);
    expect(tep.filter((t) => !(t in DUONG_GHI_PHAN_BO)), "đường ghi phân bổ MỚI chưa được nối vào hàm đóng phiếu").toEqual([]);
    expect(Object.keys(DUONG_GHI_PHAN_BO).filter((t) => !tep.includes(t)), "khai THỪA — tệp đã đổi hướng").toEqual([]);
  });
});

describe("[DPW-01] từng đường: gọi hàm đóng phiếu ĐÚNG MỘT lần, SAU phép ghi phân bổ, lý do DU_TIEN — hoặc tự đặt PAID", () => {
  for (const [tep, cach] of Object.entries(DUONG_GHI_PHAN_BO)) {
    it(`${tep} — ${cach}`, () => {
      const ma = docMa(tep);
      const iGhi = ma.search(/\.paymentAllocation\.(?:create|createMany)\s*\(/);
      expect(iGhi).toBeGreaterThan(-1);
      if (cach === "HOOK_SAU_GHI") {
        expect(dem(ma, new RegExp(`\\b${HAM}\\b`)), "tệp này KHÔNG import hàm đóng (vòng import)").toBe(0);
        expect(dem(ma, /tuyChon\?\.sauKhiGhi\?\.\(tx,/), "đúng MỘT lời gọi hook").toBe(1);
        expect(ma.search(/tuyChon\?\.sauKhiGhi\?\.\(tx,/), "hook chạy SAU phép ghi phân bổ").toBeGreaterThan(iGhi);
        expect(ma.indexOf("tuyChon?.sauKhiGhi?.(tx,"), "…và SAU `MATCHED`").toBeGreaterThan(ma.indexOf('data: { status: "MATCHED", unmatchedNote: null'));
      } else if (cach === "GOI_HAM") {
        expect(dem(ma, new RegExp(`\\b${HAM}\\s*\\(\\s*tx\\b`)), "đúng MỘT lời gọi").toBe(1);
        const iGoi = ma.search(new RegExp(`\\b${HAM}\\s*\\(\\s*tx\\b`));
        expect(iGoi, "SAU phép ghi phân bổ").toBeGreaterThan(iGhi);
        const khoi = ma.slice(iGoi, ma.indexOf("});", iGoi));
        expect(khoi).toMatch(/lyDo:\s*"DU_TIEN"/);
      } else {
        expect(dem(ma, new RegExp(`\\b${HAM}\\b`)), "đường tự khớp KHÔNG gọi hàm đóng (tự đặt PAID)").toBe(0);
        expect(ma).toMatch(/paymentBill\.updateMany\(\{\s*where:\s*\{\s*id:\s*phieu\.id,\s*status:\s*"OPEN"\s*\},\s*data:\s*\{\s*status:\s*"PAID"\s*\}/);
        expect(dem(ma, /publishEvent\(\s*"phieu-gop\.da-chia"/)).toBe(1);
      }
    });
  }

  it("đường mã đời cũ KHÔNG truyền `giaoDich` (nó tự làm việc sau chốt ở bước 8 bằng `sauKhiDonThuDu`)", () => {
    const cu = docMa("lib/payments/payos-ingest.ts");
    const khoiCu = cu.slice(cu.search(new RegExp(`\\b${HAM}\\s*\\(\\s*tx\\b`)), cu.search(new RegExp(`\\b${HAM}\\s*\\(\\s*tx\\b`)) + 300);
    expect(khoiCu).not.toMatch(/giaoDich:/);
  });
});

describe("[DPW-02] HUỶ ĐƠN: `voidTienKhiHuyDonTrongTx` đóng nốt phiếu gộp + kết thúc phiếu thẻ SAU đường soát", () => {
  it("lời gọi DON_HUY đứng SAU `soatPhieuGopMoTrongTx(` và kết quả được trả ra cho toast", () => {
    const ma = docMa("lib/orders/huy-don-tien.ts");
    expect(dem(ma, new RegExp(`\\b${HAM}\\s*\\(\\s*tx\\b`))).toBe(1);
    expect(ma.search(new RegExp(`\\b${HAM}\\s*\\(\\s*tx\\b`))).toBeGreaterThan(ma.search(/\bsoatPhieuGopMoTrongTx\s*\(\s*tx\b/));
    expect(ma).toMatch(/lyDo:\s*"DON_HUY"/);
    expect(ma).toMatch(/return \[\.\.\.daSoat,\s*\.\.\.daDong\.phieu/);
  });

  it("MỌI nơi gọi `voidTienKhiHuyDonTrongTx(` truyền ACTOR (hàm bắt buộc ba tham số — thiếu là lỗi biên dịch; lưới này canh việc ai đó nới thành tuỳ chọn)", () => {
    // `tx,` (có dấu phẩy) — phần ĐỊNH NGHĨA hàm viết `tx: Tx` nên không khớp.
    const nguoiGoi = tepChua(/\bvoidTienKhiHuyDonTrongTx\s*\(\s*tx\s*,/);
    expect(nguoiGoi).toEqual(["app/(admin)/admin/orders/_actions.ts", "lib/hoc-bu/case-db.ts"]);
    for (const t of nguoiGoi) expect(docMa(t), t).toMatch(/voidTienKhiHuyDonTrongTx\(tx,\s*[^,()]+,\s*\{[^}]*\bname:/);
    expect(docMa("lib/orders/huy-don-tien.ts")).toMatch(/voidTienKhiHuyDonTrongTx\(tx: Tx, orderId: string, actor: AuditActor\)/);
  });
});

describe("[DPW-03] thân hàm đóng phiếu: dùng luật đóng có sẵn, không tự đặt PAID, cùng khoá sự kiện với đường tự khớp", () => {
  const ma = docMa("lib/finance/dong-phieu-khi-het-viec-db.ts");

  it("DU_TIEN đóng bằng `khepPhieuMo0dTrongTx` — không viết lại luật 'đã nhận ⇒ ĐÓNG, chưa ⇒ HUỶ' cho nhánh đủ tiền", () => {
    expect(dem(ma, /\bkhepPhieuMo0dTrongTx\s*\(\s*tx\b/)).toBe(1);
  });

  it('KHÔNG tự đặt `"PAID"` (soát phiếu gộp giải thích vì sao: PAID là trạng thái gỡ gắn không đảo được, ca [POS-DB-21b])', () => {
    expect(ma).not.toMatch(/"PAID"/);
  });

  it("phát đúng MỘT sự kiện `phieu-gop.da-chia`, dedupeKey CÙNG KHUÔN với đường tự khớp ⇒ một giao dịch không phát hai lần", () => {
    expect(dem(ma, /publishEvent\(\s*"phieu-gop\.da-chia"/)).toBe(1);
    const khuon = /dedupeKey:\s*`phieu-gop\.da-chia:\$\{[^}]*bankTransactionId\}:\$\{[^}]*(?:billId|\.id)\}`/;
    expect(ma).toMatch(khuon);
    expect(docMa("lib/finance/phieu-gop.ts")).toMatch(khuon);
  });

  it("DON_HUY kết thúc phiếu thẻ của MỌI phiếu gộp của đơn (kể cả phiếu đã VOID/CLOSED) TRƯỚC khi lọc theo OPEN để đóng", () => {
    const iThe = ma.search(/nguon:\s*"HUY_DON"/);
    const iLoc = ma.search(/if \(p\.status !== "OPEN"\) continue;/);
    expect(iThe).toBeGreaterThan(-1);
    expect(iLoc).toBeGreaterThan(iThe);
    expect(dem(ma, /\bhuyTheMoCungPhieuGopTrongTx\s*\(\s*tx\b/)).toBe(2);
    expect(dem(ma, /\bnguon:\s*"(?:DU_TIEN|HUY_DON)"/)).toBe(2);
  });
});

describe("[DPW-04] đường GẮN TAY production đi qua `ganTienTheoConVaDongPhieu` — hàm trần `ganTienTheoCon` không có nơi gọi production nào khác", () => {
  it("chỗ ghép: truyền hook gọi `dongPhieuGopKhiHetViecTrongTx` ĐÚNG MỘT lần, lý do DU_TIEN, kèm `giaoDich` (không có nó sự kiện sau chốt không bao giờ phát)", () => {
    const ma = docMa("lib/finance/gan-tay-va-dong-phieu.ts");
    expect(dem(ma, /\bganTienTheoCon\s*\(\s*input\b/), "gọi hàm trần đúng một lần, kèm tuỳ chọn").toBe(1);
    expect(dem(ma, /\bsauKhiGhi:\s*async\b/)).toBe(1);
    expect(dem(ma, new RegExp(`\\b${HAM}\\s*\\(\\s*tx\\b`))).toBe(1);
    expect(ma).toMatch(/lyDo:\s*"DU_TIEN"/);
    expect(ma).toMatch(/giaoDich:\s*x\.giaoDich/);
  });

  it("nơi gọi `ganTienTheoCon(` ở mã production chỉ là: định nghĩa (ghi-tien-don.ts) + chỗ ghép — màn hình KHÔNG gọi hàm trần", () => {
    expect(tepChua(/\bganTienTheoCon\s*\(/)).toEqual(["lib/finance/gan-tay-va-dong-phieu.ts", "lib/finance/ghi-tien-don.ts"]);
  });

  it("màn \"Biến động số dư\" gọi `ganTienTheoConVaDongPhieu(` đúng một lần", () => {
    const ma = docMa("app/(admin)/admin/bien-dong-so-du/_gan-theo-con.ts");
    expect(dem(ma, /\bganTienTheoConVaDongPhieu\s*\(\s*\{/)).toBe(1);
    expect(ma).not.toMatch(/\bganTienTheoCon\s*\(/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BƯỚC CẤY — luật 8. Kết quả thật ghi ở PR.
//  1. [DPW-00] thêm `await tx.paymentAllocation.create({ data })` vào một tệp lib mới → phải ĐỎ.
//  2. [DPW-01] gỡ lời gọi `dongPhieuGopKhiHetViecTrongTx(tx` khỏi ghi-tien-don.ts / payos-ingest.ts → phải ĐỎ (mỗi tệp).
//  3. [DPW-01] đổi `lyDo: "DU_TIEN"` ở một chỗ gọi → phải ĐỎ.
//  4. [DPW-02] gỡ lời gọi DON_HUY khỏi huy-don-tien.ts → phải ĐỎ.
//  5. [DPW-03] đổi khuôn dedupeKey trong thân hàm đóng phiếu → phải ĐỎ.
//  6. [DPW-03] thêm `status: "PAID"` vào thân hàm đóng phiếu → phải ĐỎ.
// ═══════════════════════════════════════════════════════════════════════════
