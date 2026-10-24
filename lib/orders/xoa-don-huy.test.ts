// [XDH-*] — "đơn đã huỷ này có xoá được không". Luật thuần + dây nối.
//
// Chủ dự án chốt 02/10/2026: *"các đơn bị huỷ thì thêm nút xoá để xoá chứ"*, phương án
// **xoá CỨNG, chỉ khi đơn SẠCH**.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { lyDoKhongXoaDuoc, type DauVetDon } from "./xoa-don-huy";

/** Đơn đã huỷ, sạch trơn. Ca nào cần một vết thì tự đè đúng ô đó. */
const SACH: DauVetDon = {
  status: "CANCELLED",
  soKhoanThu: 0,
  soPhanBo: 0,
  soMaQrConSong: 0,
  soPhieuGopConSong: 0,
  soHoaDon: 0,
  soXuatKho: 0,
  soSoDuTinDung: 0,
  soDongHocBu: 0,
};

describe("[XDH] xoá đơn đã huỷ", () => {
  it("[XDH-01] đơn ĐÃ HUỶ và sạch trơn → xoá được", () => {
    expect(lyDoKhongXoaDuoc(SACH)).toBeNull();
  });

  it("[XDH-02] đơn CHƯA huỷ → chặn, và câu lỗi nói đúng chuyện trạng thái", () => {
    // Thứ tự nhánh có nghĩa: với đơn đang sống, một câu về tiền là lạc đề.
    for (const st of ["DRAFT", "PENDING_PAYMENT", "CONFIRMED", "COMPLETED", "REFUNDED"]) {
      const r = lyDoKhongXoaDuoc({ ...SACH, status: st });
      expect(r, `trạng thái ${st} phải bị chặn`).not.toBeNull();
      expect(r).toContain("ĐÃ HUỶ");
    }
  });

  it("[XDH-03] TỪNG ô dấu vết đều chặn được một mình", () => {
    // Không có ca này thì một ô bị bỏ sót trong chuỗi `if` vẫn xanh — và ô bị bỏ sót
    // chính là ô cho phép xoá mất dấu vết tiền.
    const o: Array<[keyof DauVetDon, string]> = [
      ["soKhoanThu", "khoản thu"],
      ["soPhanBo", "đã rót"],
      ["soMaQrConSong", "mã QR còn sống"],
      ["soPhieuGopConSong", "phiếu gộp còn sống"],
      ["soHoaDon", "hoá đơn"],
      ["soXuatKho", "xuất kho"],
      ["soSoDuTinDung", "số dư"],
      ["soDongHocBu", "dòng học bù"],
    ];
    for (const [k, chu] of o) {
      const r = lyDoKhongXoaDuoc({ ...SACH, [k]: 1 });
      expect(r, `${k} = 1 phải chặn`).not.toBeNull();
      expect(r, `câu lỗi phải nói rõ vướng gì (${k})`).toContain(chu);
    }
  });

  it("[XDH-04] NHIỀU vết cùng lúc → liệt kê ĐỦ, không dừng ở vết đầu tiên", () => {
    // Người vận hành cần quyết MỘT lần. Trả lý do đầu tiên gặp là bắt họ bấm lại ba lần
    // mới biết hết — cùng tinh thần câu lỗi của cổng tạo đợt (`kiemTaoDot`).
    const r = lyDoKhongXoaDuoc({ ...SACH, soKhoanThu: 2, soHoaDon: 1, soXuatKho: 3 });
    expect(r).toContain("2 khoản thu");
    expect(r).toContain("1 hoá đơn");
    expect(r).toContain("3 lượt xuất kho");
  });

  it("[XDH-06] chỉ MÃ CÒN SỐNG mới chặn — mã chết là bản nháp đã đóng", () => {
    // Sự cố 02/10: bản đầu đếm MỌI `PaymentBill` và MỌI `QrSession`, nên đơn tạo sai →
    // huỷ → vẫn không xoá được, kèm câu "còn 1 phiếu gộp". Chủ dự án phản hồi đúng.
    //
    // Đo ra bản đầu SAI: `quyetPhieuMo` chỉ trả `VOID` khi `daNhan === 0`, nên **phiếu
    // VOID không thể mang tiền, theo cấu trúc**; enum tự khai mã VOID "không được đối
    // khớp nữa". Huỷ đơn cũng đã tự hạ `QrSession` ACTIVE xuống `EXPIRED`.
    //
    // Ca này khoá cả hai đầu: đơn chỉ còn mã chết thì XOÁ ĐƯỢC (hai ô đếm = 0 vì nơi gọi
    // đã lọc), và còn mã sống thì CHẶN.
    expect(lyDoKhongXoaDuoc({ ...SACH, soMaQrConSong: 0, soPhieuGopConSong: 0 })).toBeNull();
    expect(lyDoKhongXoaDuoc({ ...SACH, soPhieuGopConSong: 1 })).toContain("phiếu gộp còn sống");
    expect(lyDoKhongXoaDuoc({ ...SACH, soMaQrConSong: 1 })).toContain("mã QR còn sống");
  });

  it("[XDH-07] VẾ TIỀN KHÔNG ĐƯỢC NỚI THEO — khoá độc lập thứ hai", () => {
    // Nới vế "mã" chỉ an toàn vì vế TIỀN vẫn đếm TẤT CẢ: nếu từng có một đồng về thì
    // `soKhoanThu`/`soPhanBo` chặn, bất kể mã ở trạng thái gì. Mất ca này thì một lượt
    // "dọn dẹp" sau có thể nới luôn hai ô đó và không gì báo động.
    expect(lyDoKhongXoaDuoc({ ...SACH, soKhoanThu: 1 })).not.toBeNull();
    expect(lyDoKhongXoaDuoc({ ...SACH, soPhanBo: 1 })).not.toBeNull();
    // Mã chết + tiền đã về ⇒ VẪN chặn (ca thật: phiếu `CLOSED` vì đã nhận một phần).
    expect(
      lyDoKhongXoaDuoc({ ...SACH, soPhieuGopConSong: 0, soMaQrConSong: 0, soPhanBo: 1 }),
    ).not.toBeNull();
  });

  it("[XDH-05] số ÂM / không hợp lệ KHÔNG được coi là sạch", () => {
    // Đếm ra số âm nghĩa là nơi gọi hỏng; fail-closed.
    expect(lyDoKhongXoaDuoc({ ...SACH, soKhoanThu: 0.5 })).not.toBeNull();
  });
});

// ── DÂY NỐI — lưới ghim mã nguồn ────────────────────────────────────────────────────
//
// Luật thuần ở trên xanh bao nhiêu cũng không chứng minh được rằng ĐƯỜNG THẬT có gọi nó,
// có gác quyền, và có ghi nhật ký TRƯỚC khi xoá. Ba điều đó là nơi bug nằm.
function boChuThich(s: string): string {
  // Thứ tự: chú thích DÒNG trước, rồi khối (xem lý do ở các lưới khác — một dấu mở khối
  // nằm trong chú thích `//` sẽ nuốt mã thật).
  return s.replace(/^[ \t]*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}
const ACTION = boChuThich(
  readFileSync(resolve(process.cwd(), "app/(admin)/admin/orders/_actions.ts"), "utf8"),
);
const DB = boChuThich(readFileSync(resolve(process.cwd(), "lib/orders/xoa-don-db.ts"), "utf8"));

describe("[XDH-W] dây nối của đường xoá thật", () => {
  it("[XDH-W1] action GỌI luật thuần — không viết lại điều kiện tại chỗ", () => {
    const i = ACTION.indexOf("export async function xoaDonDaHuyAction");
    expect(i, "mất action xoá đơn").toBeGreaterThan(-1);
    const than = ACTION.slice(i);
    expect(than).toContain("lyDoKhongXoaDuoc(");
  });

  it("[XDH-W2] cổng QUYỀN và cổng LÝ DO đứng TRƯỚC mọi phép đọc/ghi", () => {
    const i = ACTION.indexOf("export async function xoaDonDaHuyAction");
    const than = ACTION.slice(i, i + 2200);
    const viTriQuyen = than.indexOf("SUPER_ADMIN");
    const viTriLyDo = than.indexOf("lyDo.length < 10");
    const viTriDoc = than.indexOf("sdb.order.findUnique");
    expect(viTriQuyen).toBeGreaterThan(-1);
    expect(viTriLyDo).toBeGreaterThan(-1);
    expect(viTriDoc, "không còn phép đọc đơn — đọc lại lưới này").toBeGreaterThan(-1);
    expect(viTriQuyen, "cổng quyền phải đứng trước phép đọc đơn").toBeLessThan(viTriDoc);
    expect(viTriLyDo, "cổng lý do phải đứng trước phép đọc đơn").toBeLessThan(viTriDoc);
  });

  it("[XDH-W3] ghi nhật ký TRƯỚC khi xoá — sau khi xoá không còn gì để chụp", () => {
    const i = ACTION.indexOf("export async function xoaDonDaHuyAction");
    const than = ACTION.slice(i);
    const viTriAudit = than.indexOf("writeAudit(");
    const viTriXoa = than.indexOf("xoaDonVaCon(");
    expect(viTriAudit).toBeGreaterThan(-1);
    expect(viTriXoa).toBeGreaterThan(-1);
    expect(viTriAudit, "writeAudit phải đứng TRƯỚC xoaDonVaCon").toBeLessThan(viTriXoa);
  });

  it("[XDH-W4] action tự gác PHẠM VI — `scopedDb` không che write", () => {
    const than = ACTION.slice(ACTION.indexOf("export async function xoaDonDaHuyAction"));
    expect(than, "thiếu passesScope ⇒ xoá được đơn của cơ sở khác").toContain(
      'passesScope("Order"',
    );
  });

  it("[XDH-W7] tầng DB CHỈ đếm mã CÒN SỐNG — lọc đúng ở câu tra", () => {
    // Luật thuần không biết gì về trạng thái; phép lọc nằm trong `where`, mà `where` sai
    // vẫn trả một con số hợp lệ nên test thuần KHÔNG nói được gì. Ghim ở tầng câu tra.
    expect(DB, "QrSession phải lọc ACTIVE — mã EXPIRED là mã chết").toMatch(
      /qrSession\.count\([^)]*status:\s*"ACTIVE"/,
    );
    expect(DB, "PaymentBill phải loại VOID — phiếu VOID không đối khớp được nữa").toMatch(
      /paymentBill\.count\([^)]*status:\s*\{\s*not:\s*"VOID"\s*\}/,
    );
    // Và vế TIỀN tuyệt đối KHÔNG được lọc theo trạng thái.
    expect(DB, "soKhoanThu bị lọc trạng thái ⇒ bỏ sót tiền đã về").not.toMatch(
      /payment\.count\([^)]*status/,
    );
  });

  it("[XDH-W5] phép ĐẾM để chặn KHÔNG đi qua scopedDb", () => {
    // Đếm qua `scopedDb` thì đúng dấu vết cần thấy có thể bị lọc mất ⇒ cổng đọc 0 thành
    // "đơn sạch" ⇒ mở toang đúng lúc phải đóng. Cùng bài học với `method-lookup.ts`.
    expect(DB).toContain('from "@/lib/db"');
    expect(DB, "phép đếm bị scope ⇒ cổng có thể mở nhầm").not.toContain("scopedDb");
  });

  it("[XDH-W6] hàm xoá KHÔNG tự dọn các bảng GIỮ TIỀN", () => {
    // Chúng đã được chứng minh rỗng ở cổng. Nếu còn dòng nào thì phải để Postgres ném
    // (`onDelete: Restrict`) chứ không lặng lẽ xoá hộ — đó là lưới an toàn cuối cùng.
    const than = DB.slice(DB.indexOf("export async function xoaDonVaCon"));
    for (const bang of ["payment.deleteMany", "paymentAllocation", "paymentBill", "hoaDonDienTu", "productMovement", "creditBalance"]) {
      expect(than, `xoaDonVaCon không được tự xoá ${bang}`).not.toContain(bang);
    }
    // Và PHẢI xoá các bảng mô tả, nếu không Postgres chặn vì `Restrict`.
    for (const bang of ["orderItem", "orderStatusHistory", "paymentRequest", "orderInstallment"]) {
      expect(than, `thiếu bước xoá ${bang} ⇒ Postgres sẽ ném`).toContain(`${bang}.deleteMany`);
    }
  });
});
