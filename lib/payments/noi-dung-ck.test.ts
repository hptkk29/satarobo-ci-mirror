// Ca [NDC-*] — nội dung CK mang khoá đối khớp.
//
// Ca quan trọng nhất là [NDC-05]: nó chạy CHÍNH bộ tách token của `payos-ingest`
// trên chuỗi mà file này sinh ra. Không có ca đó thì mọi ca còn lại chỉ chứng minh
// hàm nối chuỗi chạy đúng, chứ không chứng minh TIỀN RƠI ĐÚNG PHIẾU.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, it, expect } from "vitest";
import {
  coKhoaDoiKhop,
  noiDungCkCoKhoa,
} from "@/lib/payments/noi-dung-ck";
import { collectMatchKeyCandidates } from "@/lib/payments/payos-ingest";
import {
  VIETQR_ADDINFO_MAX,
  MAX_TRANSFER_CONTENT,
} from "@/lib/payments/vietqr";
import { paymentMatchKey } from "@/lib/payments/payment-request";

const KHOA = paymentMatchKey("ORD-260913-000001", 1); // ORD260913000001D1
const NGUOI_DOC_25 = "NguyenV_84987654321_Sata4";
const NGUOI_DOC_80 = "NguyenVanAn_84987654321_Sata4";

describe("[NDC-01] ngân sách 25 ký tự của mã QR", () => {
  it("khoá 17 ký tự vừa khít trần 25 và còn chỗ cho tên", () => {
    expect(KHOA).toBe("ORD260913000001D1");
    expect(KHOA.length).toBe(17);
    const s = noiDungCkCoKhoa(KHOA, NGUOI_DOC_25, VIETQR_ADDINFO_MAX);
    expect(s.length).toBeLessThanOrEqual(VIETQR_ADDINFO_MAX);
    expect(s).toBe("ORD260913000001D1 NguyenV");
    expect(s.length).toBe(25); // khít
  });

  it("KHOÁ đứng trước và sống sót, phần người đọc mới là phần bị cắt", () => {
    // Một chuỗi mất tên con vẫn rót đúng phiếu; mất khoá thì rơi về đoán.
    const s = noiDungCkCoKhoa(KHOA, "TenRatDaiKhongTheNaoVuaDuoc", 25);
    expect(s.startsWith(KHOA)).toBe(true);
    expect(s.length).toBe(25);
  });

  it("bản 80 giữ NGUYÊN phần người đọc chốt 20/08, chỉ thêm khoá", () => {
    const s = noiDungCkCoKhoa(KHOA, NGUOI_DOC_80, MAX_TRANSFER_CONTENT);
    expect(s).toBe(`${KHOA} ${NGUOI_DOC_80}`);
    expect(s.length).toBeLessThanOrEqual(MAX_TRANSFER_CONTENT);
    // Gõ tay là đường dễ sai nhất ⇒ giữ CẢ HAI khoá: khoá phiếu và SĐT.
    expect(s).toContain("84987654321");
  });
});

describe("[NDC-02] không có khoá ⇒ giữ nguyên hành vi cũ", () => {
  it("matchKey null (đơn cũ chưa có phiếu) trả nguyên phần người đọc", () => {
    expect(noiDungCkCoKhoa(null, NGUOI_DOC_25, 25)).toBe(NGUOI_DOC_25);
    expect(noiDungCkCoKhoa(undefined, NGUOI_DOC_25, 25)).toBe(NGUOI_DOC_25);
    expect(noiDungCkCoKhoa("", NGUOI_DOC_25, 25)).toBe(NGUOI_DOC_25);
  });

  it("vẫn tôn trọng trần khi không có khoá", () => {
    expect(noiDungCkCoKhoa(null, "x".repeat(40), 25)).toHaveLength(25);
  });
});

describe("[NDC-03] biên", () => {
  it("trần 0 hoặc âm ⇒ chuỗi rỗng, không nổ", () => {
    expect(noiDungCkCoKhoa(KHOA, NGUOI_DOC_25, 0)).toBe("");
    expect(noiDungCkCoKhoa(KHOA, NGUOI_DOC_25, -5)).toBe("");
  });

  it("trần nhỏ hơn khoá ⇒ giữ khoá (cụt) chứ không giữ tên", () => {
    expect(noiDungCkCoKhoa(KHOA, NGUOI_DOC_25, 10)).toBe(KHOA.slice(0, 10));
  });

  it("trần vừa đúng khoá ⇒ chỉ khoá, không để lại dấu nối lơ lửng", () => {
    const s = noiDungCkCoKhoa(KHOA, NGUOI_DOC_25, 18);
    expect(s).toBe(KHOA);
    expect(s.endsWith(" ")).toBe(false);
  });

  it("phần người đọc rỗng ⇒ chỉ khoá", () => {
    expect(noiDungCkCoKhoa(KHOA, "", 25)).toBe(KHOA);
    expect(noiDungCkCoKhoa(KHOA, "   ", 25)).toBe(KHOA);
  });

  it("khoá có ký tự lạ thì bị làm sạch — khoá thật không bao giờ có", () => {
    expect(noiDungCkCoKhoa("ORD-2609-13D1", "An", 25)).toBe("ORD260913D1 An");
  });
});

describe("[NDC-04] hai ĐỢT của cùng một đơn phải ra HAI chuỗi khác nhau", () => {
  it("đây chính là thứ định dạng cũ KHÔNG làm được", () => {
    // Chú thích ở `_qr-core.ts` tự ghi nhận: "Đợt 1 và đợt 2 của CÙNG một đơn ra
    // CÙNG một chuỗi… nội dung không còn mang thông tin 'đợt nào'." Tiền vì thế
    // phải nhờ waterfall đoán sang đợt sau.
    const d1 = noiDungCkCoKhoa(paymentMatchKey("ORD-260913-000001", 1), NGUOI_DOC_25, 25);
    const d2 = noiDungCkCoKhoa(paymentMatchKey("ORD-260913-000001", 2), NGUOI_DOC_25, 25);
    expect(d1).not.toBe(d2);
    expect(d1).toContain("D1");
    expect(d2).toContain("D2");
    // Và định dạng cũ (không khoá) thì hai đợt TRÙNG nhau — ghim lại để thấy rõ
    // bản vá đổi đúng điều gì.
    expect(noiDungCkCoKhoa(null, NGUOI_DOC_25, 25)).toBe(
      noiDungCkCoKhoa(null, NGUOI_DOC_25, 25),
    );
  });
});

describe("[NDC-05] bộ tách của payos-ingest phải LẤY RA ĐÚNG khoá", () => {
  // Ca chịu lực. `collectMatchKeyCandidates` là thứ thật sự quyết định tiền có rơi
  // đúng phiếu không — nó tách nội dung CK thành ứng viên rồi tra
  // `paymentRequest.findMany({ matchKey: { in: candidates } })`.
  const tach = (desc: string) =>
    collectMatchKeyCandidates({ description: desc } as Parameters<
      typeof collectMatchKeyCandidates
    >[0]);

  it("chuỗi QR 25 ký tự ⇒ khoá nằm trong danh sách ứng viên", () => {
    const noiDung = noiDungCkCoKhoa(KHOA, NGUOI_DOC_25, 25);
    expect(tach(noiDung)).toContain(KHOA);
  });

  it("chuỗi bản 80 ⇒ cũng lấy ra được khoá", () => {
    expect(tach(noiDungCkCoKhoa(KHOA, NGUOI_DOC_80, 80))).toContain(KHOA);
  });

  it("ngân hàng chèn chữ đầu/cuối ⇒ vẫn lấy ra được", () => {
    // Sao kê thật hay có dạng "CT tu 0912345678 NGUYEN VAN A chuyen tien <nội dung>".
    const noiDung = noiDungCkCoKhoa(KHOA, NGUOI_DOC_25, 25);
    expect(tach(`CT tu 0912345678 NGUYEN VAN A chuyen tien ${noiDung}`)).toContain(
      KHOA,
    );
    expect(tach(`${noiDung} GD 123456`)).toContain(KHOA);
  });

  it("phụ huynh gõ tay bằng dấu GẠCH DƯỚI vẫn lấy ra được", () => {
    // Bộ tách gốc dùng /[^A-Za-z0-9_-]+/ — KHÔNG tách `_`. Đây là lý do
    // `payos-ingest` được nới thêm một vòng tách; thiếu nó thì
    // "ORD260913000001D1_NguyenV" ra một token 25 ký tự, không khớp khoá nào.
    expect(tach(`${KHOA}_NguyenV`)).toContain(KHOA);
    expect(tach(`${KHOA}-NguyenV`)).toContain(KHOA);
  });

  it("ĐỊNH DẠNG CŨ thì KHÔNG lấy ra được khoá — đây là bug đang vá", () => {
    expect(tach(NGUOI_DOC_25)).not.toContain(KHOA);
    expect(tach(NGUOI_DOC_80)).not.toContain(KHOA);
  });
});

describe("[NDC-06] coKhoaDoiKhop", () => {
  it("nhận ra khoá kể cả khi ngân hàng đổi dấu / viết hoa / chèn chữ", () => {
    const noiDung = noiDungCkCoKhoa(KHOA, NGUOI_DOC_25, 25);
    expect(coKhoaDoiKhop(noiDung, KHOA)).toBe(true);
    expect(coKhoaDoiKhop(`CT tu ... ${noiDung} ...`, KHOA)).toBe(true);
    expect(coKhoaDoiKhop(`ORD-260913-000001-D1 An`, KHOA)).toBe(true);
  });

  it("chuỗi định dạng cũ ⇒ false", () => {
    expect(coKhoaDoiKhop(NGUOI_DOC_25, KHOA)).toBe(false);
  });

  it("khoá của đợt KHÁC ⇒ false", () => {
    const noiDung = noiDungCkCoKhoa(KHOA, NGUOI_DOC_25, 25);
    expect(coKhoaDoiKhop(noiDung, paymentMatchKey("ORD-260913-000001", 2))).toBe(
      false,
    );
  });
});

// ── LƯỚI GHIM MÃ NGUỒN ───────────────────────────────────────────────────────
//
// Thứ cần khoá có đúng dạng mà test thuần KHÔNG chứng minh được: "lời gọi này phải
// truyền THAM SỐ KIA". `noiDungCkCoKhoa` test bao nhiêu cũng xanh, trong khi con bug
// nằm ở chỗ `addInfoFor` quên truyền `req.matchKey` (hoặc truyền `null`) — lúc đó mã
// QR lại in chuỗi cũ và nhánh (a) chết im lặng, không lỗi, không test nào đỏ.
describe("[NDC-07] addInfoFor PHẢI truyền matchKey của chính phiếu đó", () => {
  const src = readFileSync(
    resolve(process.cwd(), "app/(admin)/admin/orders/_qr-core.ts"),
    "utf8",
  );

  /** Cắt đúng thân MỘT hàm — luật 11: đừng quét cả tệp, chú thích giải thích bản vá
   *  chứa đúng những chuỗi bộ so khớp đang tìm. */
  function than(tu: string, den: string): string {
    const a = src.indexOf(tu);
    const b = src.indexOf(den, a + 1);
    expect(a, `không thấy \`${tu}\``).toBeGreaterThanOrEqual(0);
    expect(b, `không thấy mốc kết \`${den}\``).toBeGreaterThan(a);
    return src.slice(a, b);
  }

  it("addInfoFor đưa matchKey CỦA CHÍNH PHIẾU vào chuỗi", () => {
    // Mã TRƯỚC bản vá 14/09: `return transferContentForOrder({...}, VIETQR_ADDINFO_MAX);`
    // — không có khoá nào đi vào chuỗi.
    //
    // ⚠️ 24/09 — lưới này TỪNG ghim văn bản `noiDungCkCoKhoa(req.matchKey`, và nó đỏ khi
    // phép ghép được tách ra thành `noiDungCkChoPhieu`. Lý lẽ của nó ("khoá phải là khoá
    // của chính phiếu, không phải null, không phải của đơn") thì ĐÚNG và giữ nguyên —
    // chỉ cách viết là bị ghim nhầm. Nay ghim LUẬT: khoá `req.matchKey` phải đi vào.
    const t = than("function addInfoFor(", "export function noiDungCkChoPhieu");
    expect(t).toContain("noiDungCkChoPhieu(req.matchKey");
  });

  it("trần ký tự nằm ĐÚNG MỘT CHỖ, và là trần QR chứ không phải 80", () => {
    // Bản vá 20/08: để mặc định 80 thì mã QR bị cắt đuôi IM LẶNG đúng chỗ chứa SĐT.
    const t = than("export function noiDungCkChoPhieu", "const PAYOS_DESCRIPTION_MAX");
    expect(t).toContain("noiDungCkCoKhoa(");
    expect(t).toContain("VIETQR_ADDINFO_MAX");
    // Phép ghép khoá chỉ được có ĐÚNG MỘT chỗ gọi trong tệp — hai chỗ là hai trần, và
    // hai trần thì chỉ cần một người sửa lệch là sale đọc một đằng, QR mã một nẻo.
    //
    // ⚠️ Đếm `noiDungCkCoKhoa(` (CÓ ngoặc) chứ không đếm `VIETQR_ADDINFO_MAX`: hằng đó
    // xuất hiện trong CẢ CHÚ THÍCH giải thích bản vá, nên phép đếm nó vừa đỏ oan vừa sẽ
    // đỏ lại mỗi lần ai đó viết thêm một dòng giải thích (luật 11).
    expect(src.match(/noiDungCkCoKhoa\(/g)?.length ?? 0).toBe(1);
  });

  it("[NDC-07b] ĐƯỜNG RENDER TRANG cũng phải ghép khoá của TỪNG PHIẾU", () => {
    // ⚠️ ĐÂY LÀ LỖ ĐÃ NỔ 24/09. `loadActiveQrSessions` nhận MỘT chuỗi mức ĐƠN rồi truyền
    // thẳng xuống `toView`, tức bỏ hẳn bước ghép khoá mà `addInfoFor` có. Hệ quả: trang
    // tải lần đầu in `Anh_0905123456_Sata4` còn nút "Xuất QR" trả
    // `ORD260924000001D1 Anh_090` — cùng một phiếu, hai chuỗi, đổi tuỳ lúc.
    // Ca hành vi: `[QR-12]` (tests/e2e/r7/qr-session.spec.ts).
    const t = than("export async function loadActiveQrSessions(", "/**");
    expect(t).toContain("noiDungCkChoPhieu(mk,");
  });

  it("[NDC-07c] chuỗi in ra ĐỌC TỪ ẢNH, không nhận từ chỗ gọi", () => {
    // Ảnh QR là ảnh chụp lúc phát hành; chuỗi in ra mà được TÍNH LẠI thì có ngày lệch
    // với ảnh, và màn hình nói dối. Ca hành vi: `[QR-10]`, `[QR-11]`.
    const t = than("async function toView(", "const QR_SESSION_SELECT");
    expect(t).toContain("noiDungTrongAnhQr(row.qrContent)");
    expect(t).toContain("transferContent: trongAnh ??");
    expect(t).toContain("anhDaCu: anhQrDaCu(row.qrContent");
  });

  it("bộ tách của payos-ingest có VÒNG RỘNG cắt cả dấu gạch dưới", () => {
    // Thiếu vòng này thì phụ huynh gõ tay `ORD…D1_NguyenV` ra MỘT token 25 ký tự,
    // không khớp khoá nào. Ca [NDC-05] đã kiểm hành vi; lưới này canh chính dòng mã
    // vì nó dễ bị "dọn dẹp" thành một vòng duy nhất.
    const ing = readFileSync(
      resolve(process.cwd(), "lib/payments/payos-ingest.ts"),
      "utf8",
    );
    const than = ing.slice(
      ing.indexOf("export function collectMatchKeyCandidates"),
      ing.indexOf("export function resolveProviderTxnId"),
    );
    expect(than).toContain("desc.split(/[^A-Za-z0-9]+/)");
    expect(than).toContain("desc.split(/[^A-Za-z0-9_-]+/)");
  });
});
