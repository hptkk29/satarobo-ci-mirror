// [TQTL-*] «Tổng quan thiết lập» của trang Cấu hình hoá đơn — mỗi bước ở trạng thái nào, nói thật, và khi KHÔNG xem được thì không đoán.
import { describe, expect, it } from "vitest";
import { huongDan } from "./huong-dan";
import { dungTongQuan, type DauVaoTongQuan } from "./tong-quan-thiet-lap";

const OK: DauVaoTongQuan = {
  phapNhan: { ten: "STEM Robotics & AI", kyHieu: "1C26SVS" },
  canhBaoLech: null,
  ketNoi: { muc: "success", nhan: "Đang dùng kết nối đã khai", chiTiet: "ký HSM của nhà cung cấp.", nhaCungCap: "VIN-HOADON" },
  chinhSachKy: { tamDung: false, suCo: false, khaiDuHanMuc: true },
  chinhSachHoaDon: { soBanHieuLuc: 1 },
};
const dung = (o: Partial<DauVaoTongQuan> = {}) => dungTongQuan({ ...OK, ...o });
const trangThai = (t: ReturnType<typeof dungTongQuan>) => t.muc.map((m) => m.trangThai);

describe("[TQTL] tổng quan thiết lập", () => {
  it("[TQTL-01] mọi thứ ổn ⇒ «Sẵn sàng phát hành», 4 bước theo đúng thứ tự, không việc nào cần làm", () => {
    const t = dung();
    expect(t).toMatchObject({ tieuDe: "Sẵn sàng phát hành", sanSang: true, soCanLam: 0 });
    expect(t.muc.map((m) => m.buoc)).toEqual([1, 2, 3, 4]);
    expect(trangThai(t)).toEqual(["xong", "xong", "xong", "xong"]);
    expect(t.muc[0]!.dong).toBe("Phát hành dưới STEM Robotics & AI · ký hiệu 1C26SVS.");
    expect(t.muc[1]!.dong).toBe("VIN-HOADON · ký HSM của nhà cung cấp.");
  });

  it("[TQTL-02] chưa khai pháp nhân ⇒ bước 1 «cần làm», tiêu đề đếm việc, KHÔNG nói sẵn sàng", () => {
    const t = dung({ phapNhan: { loi: "Cơ sở CS1 chưa khai pháp nhân." } });
    expect(t.muc[0]).toMatchObject({ trangThai: "can-lam", neo: "phap-nhan-ky-hieu" });
    expect(t.muc[0]!.dong).toContain("Cơ sở CS1 chưa khai pháp nhân.");
    expect(t).toMatchObject({ sanSang: false, soCanLam: 1, tieuDe: "Còn 1 việc cần làm trước khi phát hành" });
  });

  it("[TQTL-03] kết nối: «dùng được» ⇒ xong · «cấu hình trên máy chủ» ⇒ lưu ý (không phải lỗi) · «chưa dùng được» ⇒ cần làm, mang lý do của hệ thống", () => {
    expect(dung({ ketNoi: { muc: "info", nhan: "Đang dùng cấu hình trên máy chủ", chiTiet: "x", nhaCungCap: "MISA" } }).muc[1]).toMatchObject({ trangThai: "luu-y" });
    const loi = dung({ ketNoi: { muc: "danger", nhan: "Chưa dùng được", chiTiet: "Chưa cấu hình kết nối.", nhaCungCap: "VIN-HOADON" } });
    expect(loi.muc[1]).toMatchObject({ trangThai: "can-lam", dong: "VIN-HOADON · Chưa cấu hình kết nối." });
    expect(loi.soCanLam).toBe(1);
  });

  it("[TQTL-04] KHÔNG xem được ⇒ nói «không xem được», KHÔNG đoán ổn/thiếu: tiêu đề «Phần bạn xem được đã ổn», sanSang = null, không tính vào việc cần làm", () => {
    const t = dung({ ketNoi: null, chinhSachKy: null });
    expect(t.muc[1]).toMatchObject({ trangThai: "khong-xem-duoc", dong: "Chỉ kế toán Hội sở xem được phần này." });
    expect(t.muc[2]!.trangThai).toBe("khong-xem-duoc");
    expect(t).toMatchObject({ sanSang: null, soCanLam: 0, tieuDe: "Phần bạn xem được đã ổn" });
  });

  it("[TQTL-05] đang tạm dừng ký ⇒ «lưu ý» + tiêu đề nói THẲNG «chưa phát hành được» (không «sẵn sàng»), kể cả khi mọi bước khác ổn; sự cố bảo mật được gọi tên", () => {
    const t = dung({ chinhSachKy: { tamDung: true, suCo: false, khaiDuHanMuc: true } });
    expect(t).toMatchObject({ sanSang: false, tieuDe: "Đang tạm dừng ký — chưa phát hành được", soCanLam: 0 });
    expect(t.muc[2]).toMatchObject({ trangThai: "luu-y" });
    expect(dung({ chinhSachKy: { tamDung: true, suCo: true, khaiDuHanMuc: true } }).muc[2]!.dong).toContain("sự cố bảo mật");
  });

  it("[TQTL-06] chưa khai hạn mức ⇒ «tuỳ chọn» (KHÔNG phải việc cần làm) và nói rõ kế toán bấm «Phát hành» không bị ảnh hưởng; người xem không thấy hạn mức ⇒ không đoán", () => {
    const t = dung({ chinhSachKy: { tamDung: false, suCo: false, khaiDuHanMuc: false } });
    expect(t.muc[2]!.trangThai).toBe("tuy-chon");
    expect(t.muc[2]!.dong).toContain("không bị ảnh hưởng");
    expect(t).toMatchObject({ sanSang: true, soCanLam: 0 });
    expect(dung({ chinhSachKy: { tamDung: false, suCo: false, khaiDuHanMuc: null } }).muc[2]).toMatchObject({ trangThai: "xong", dong: "Đang ký bình thường." });
  });

  it("[TQTL-07] cờ Hub tắt ⇒ KHÔNG có dòng bước 4 (không treo một việc mà màn không có); bật mà chưa có chính sách ⇒ tuỳ chọn", () => {
    expect(dung({ chinhSachHoaDon: null }).muc.map((m) => m.khoa)).toEqual(["phap-nhan", "ket-noi", "chinh-sach-ky"]);
    expect(dung({ chinhSachHoaDon: { soBanHieuLuc: 0 } }).muc[3]).toMatchObject({ trangThai: "tuy-chon", neo: "cs-tieu-de" });
  });

  it("[TQTL-08] Cây tổ chức ghi một pháp nhân mà cơ sở phát hành dưới pháp nhân khác ⇒ bước 1 «lưu ý» có câu cảnh báo (đúng lỗi từng làm người dùng tưởng cơ sở vẫn là Sata Robo)", () => {
    const t = dung({ canhBaoLech: "Cây tổ chức đang ghi pháp nhân khác — kiểm tra lại." });
    expect(t.muc[0]).toMatchObject({ trangThai: "luu-y" });
    expect(t.muc[0]!.dong).toContain("Cây tổ chức đang ghi pháp nhân khác");
  });

  it("[TQTL-09] mỗi bước mang đúng khoá hướng dẫn «?» và neo tới khu của nó; khoá hướng dẫn có chữ thật", () => {
    const t = dung();
    expect(t.muc.map((m) => [m.huongDan, m.neo])).toEqual([
      ["buoc-phap-nhan", "phap-nhan-ky-hieu"],
      ["buoc-ket-noi", "ket-noi-ky"],
      ["buoc-chinh-sach-ky", "chinh-sach-ky"],
      ["buoc-chinh-sach-hoa-don", "cs-tieu-de"],
    ]);
    for (const m of t.muc) expect(huongDan(m.huongDan).length).toBeGreaterThan(30);
  });
});
