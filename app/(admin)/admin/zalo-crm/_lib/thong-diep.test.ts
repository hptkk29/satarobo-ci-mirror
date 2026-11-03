// S1 · lắng nghe `postMessage` từ khung ZaloCRM — bộ luật THUẦN.
//
// Vì sao tách khỏi component: nút "Tạo lead Sata" nằm trong `ChatView.vue` của FORK (F5),
// tức không tồn tại ở máy này và sẽ không tồn tại cho tới GĐ1. Test khung thật là không
// làm được; test hàm thuần bằng object giả thì làm được ngay và bắt đúng thứ nguy hiểm:
// một tab bất kỳ (quảng cáo, tiện ích mở rộng) cũng gọi `postMessage` vào trang admin
// được, nên kiểm `origin` là hàng rào duy nhất.
import { describe, it, expect } from "vitest";
import { chuanHoaNguonGoc, xuLyThongDiep, type ThongDiepZaloCrm } from "./thong-diep";


/**
 * Đường dẫn của một tin, KHI tin ấy mang đường dẫn.
 *
 * Từ 24/09 `ThongDiepZaloCrm` có thêm nhánh `xin-ve-moi` — tin KHÔNG mang đường dẫn
 * (khung chỉ xin Sata ký vé mới). Nên `duongDanCua(kq)` không còn hợp kiểu, và đó là điều
 * ĐÚNG: nó buộc mỗi ca phải nói rõ mình đang chờ loại tin nào.
 *
 * Ném (chứ không `expect` rồi trả bừa) để ca gọi nhầm loại tin đỏ ngay tại dòng gọi,
 * thay vì đỏ ở một khẳng định xa phía dưới.
 */
function duongDanCua(kq: ThongDiepZaloCrm | null): string {
  if (!kq) throw new Error("tin bị từ chối (null) — ca này mong một tin hợp lệ");
  if (kq.loai === "xin-ve-moi") throw new Error("tin `xin-ve-moi` không mang đường dẫn");
  return kq.duongDan;
}
const GOC = "https://zalo.satarobo.vn";
const su = (data: unknown, origin: unknown = GOC) => ({ origin, data });

describe("xuLyThongDiep — chỉ tin đúng một origin", () => {
  it("[ZC-PM-01] sai origin ⇒ null, kể cả khi payload hoàn toàn hợp lệ", () => {
    const hopLe = { type: "sata:create-lead", phone: "84912345678", name: "Chị Lan" };
    expect(xuLyThongDiep(su(hopLe, "https://evil.example"), GOC)).toBeNull();
    // Tiền tố trùng nhưng KHÁC origin — bẫy kinh điển của so sánh bằng startsWith.
    expect(xuLyThongDiep(su(hopLe, "https://zalo.satarobo.vn.evil.com"), GOC)).toBeNull();
    // http ≠ https.
    expect(xuLyThongDiep(su(hopLe, "http://zalo.satarobo.vn"), GOC)).toBeNull();
    // `null` là origin của iframe sandbox / data: URL.
    expect(xuLyThongDiep(su(hopLe, "null"), GOC)).toBeNull();
    // Không dùng helper `su` ở hai ca dưới: tham số mặc định của nó sẽ biến `undefined`
    // thành origin hợp lệ, tức ca test tự làm mình xanh giả (đã dính khi chạy lần đầu).
    expect(xuLyThongDiep({ data: hopLe }, GOC)).toBeNull();
    expect(xuLyThongDiep({ origin: null, data: hopLe }, GOC)).toBeNull();
  });

  it("[ZC-PM-02] origin mong đợi RỖNG (chưa khai ZALOCRM_APP_URL) ⇒ null với mọi tin", () => {
    // Fail-closed. Nếu để "" so bằng "" thì một trang không cấu hình lại tin MỌI tin.
    const hopLe = { type: "sata:create-lead", phone: "84912345678" };
    expect(xuLyThongDiep(su(hopLe, ""), "")).toBeNull();
    expect(xuLyThongDiep(su(hopLe), "")).toBeNull();
  });

  it("[ZC-PM-03] sata:create-lead đủ trường ⇒ đường dẫn nhập khách có phone + name", () => {
    const kq = xuLyThongDiep(su({ type: "sata:create-lead", phone: "84912345678", name: "Chị Lan" }), GOC);
    expect(kq).not.toBeNull();
    expect(kq!.loai).toBe("tao-lead");
    // Trang nhập khách ĐÃ nhận `?phone=&name=` (đợt 1, `lib/lead/intake/prefill.ts`).
    const u = new URL(duongDanCua(kq), "https://admin.satarobo.vn");
    expect(u.pathname).toBe("/nhap-khach-hang");
    expect(u.searchParams.get("phone")).toBe("84912345678");
    expect(u.searchParams.get("name")).toBe("Chị Lan");
  });

  it("[ZC-PM-04] thiếu phone / phone không phải chuỗi ⇒ null", () => {
    for (const xau of [undefined, null, "", "   ", 84912345678, { so: 1 }, "khong-phai-so"]) {
      expect(
        xuLyThongDiep(su({ type: "sata:create-lead", phone: xau, name: "X" }), GOC),
        `phone=${JSON.stringify(xau)} phải bị từ chối`,
      ).toBeNull();
    }
  });

  it("[ZC-PM-05] thiếu name ⇒ vẫn đi tiếp, chỉ không điền sẵn tên", () => {
    // Khách Zalo hay để tên hiển thị là biệt danh; thiếu tên KHÔNG phải lý do chặn Sale
    // tạo phiếu — đó là ô người ta gõ tay ngay sau đó.
    const kq = xuLyThongDiep(su({ type: "sata:create-lead", phone: "0912345678" }), GOC);
    const u = new URL(duongDanCua(kq), "https://admin.satarobo.vn");
    expect(u.searchParams.get("phone")).toBe("0912345678");
    expect(u.searchParams.has("name")).toBe(false);
  });

  it("[ZC-PM-06] sata:open-lead ⇒ /leads/<id>", () => {
    const kq = xuLyThongDiep(su({ type: "sata:open-lead", leadId: "clzzlead0001abcdefghij" }), GOC);
    expect(kq!.loai).toBe("mo-lead");
    expect(duongDanCua(kq)).toBe("/leads/clzzlead0001abcdefghij");
  });

  it("[ZC-PM-07] leadId sai khuôn ⇒ null (chặn nhét đường dẫn)", () => {
    for (const xau of [
      "",
      "../../users",
      "abc?x=1",
      "abc#frag",
      "a".repeat(64),
      "co khoang trang",
      42,
      null,
    ]) {
      expect(
        xuLyThongDiep(su({ type: "sata:open-lead", leadId: xau }), GOC),
        `leadId=${JSON.stringify(xau)} phải bị từ chối`,
      ).toBeNull();
    }
  });

  it("[ZC-PM-08] loại tin lạ / data không phải object ⇒ null, không ném", () => {
    for (const data of [
      { type: "sata:xoa-lead", leadId: "clzzlead0001abcdefghij" },
      { type: "webpackHotUpdate" }, // tin của công cụ dev — gặp thật ở localhost
      { khong: "co type" },
      "chuoi tran",
      42,
      null,
      undefined,
      [],
    ]) {
      expect(xuLyThongDiep(su(data), GOC), `data=${JSON.stringify(data)}`).toBeNull();
    }
  });

  it("[ZC-PM-09] tên khách chứa ký tự đặc biệt vẫn ra URL hợp lệ (không vỡ query)", () => {
    const kq = xuLyThongDiep(
      su({ type: "sata:create-lead", phone: "84912345678", name: "A&B #1 ?x=2" }),
      GOC,
    );
    const u = new URL(duongDanCua(kq), "https://admin.satarobo.vn");
    expect(u.searchParams.get("name")).toBe("A&B #1 ?x=2");
    expect(u.searchParams.get("phone")).toBe("84912345678");
  });

  it("[ZC-PM-10] tên quá dài bị cắt — không dựng URL nghìn ký tự", () => {
    const kq = xuLyThongDiep(
      su({ type: "sata:create-lead", phone: "84912345678", name: "x".repeat(500) }),
      GOC,
    );
    const u = new URL(duongDanCua(kq), "https://admin.satarobo.vn");
    expect(u.searchParams.get("name")!.length).toBeLessThanOrEqual(120);
  });
});

describe("chuanHoaNguonGoc — từ ZALOCRM_APP_URL ra origin so sánh được", () => {
  it("[ZC-PM-11] bỏ đường dẫn/cổng thừa, giữ scheme + host (+ cổng nếu có)", () => {
    expect(chuanHoaNguonGoc("https://zalo.satarobo.vn/")).toBe("https://zalo.satarobo.vn");
    expect(chuanHoaNguonGoc("https://zalo.satarobo.vn/sso?x=1")).toBe("https://zalo.satarobo.vn");
    expect(chuanHoaNguonGoc("http://localhost:3001/chat")).toBe("http://localhost:3001");
  });

  it("[ZC-PM-12] rỗng / không phải URL ⇒ null (không bịa origin)", () => {
    expect(chuanHoaNguonGoc("")).toBeNull();
    expect(chuanHoaNguonGoc(null)).toBeNull();
    expect(chuanHoaNguonGoc(undefined)).toBeNull();
    expect(chuanHoaNguonGoc("zalo.satarobo.vn")).toBeNull(); // thiếu scheme
  });
});

describe("[ZC-PM-08] khung xin VÉ MỚI khi phiên bên kia thuộc tổ chức khác", () => {
  // 🔴 Sự cố prod 24/09/2026: vé SSO nằm trong `src` của iframe. Trình duyệt tải lại
  // khung bằng `src` CŨ (bfcache, khôi phục tab, F5 trong khung) ⇒ vé bị phát lại, và
  // bên kia trước đây cứ đi tiếp bằng phiên đang có mà KHÔNG kiểm tổ chức. Ai từng mở
  // cơ sở A rồi đổi sang B thì KẸT Ở A — hộp thư trống, tìm SĐT không ra, nick của
  // chính mình không thấy, và không một dòng lỗi nào.
  //
  // Bên kia nay phát hiện được lệch nhưng KHÔNG ký được vé (chỉ Sata ký), nên nó gửi
  // tin này. Sata dựng lại trang ⇒ vé mới ⇒ khung vào đúng tổ chức, không ai phải
  // đăng xuất tay.

  it("nhận đúng loại `xin-ve-moi`, và KHÔNG mang đường dẫn nào", () => {
    const kq = xuLyThongDiep(su({ type: "sata:xin-ve-moi" }), GOC);
    expect(kq).toEqual({ loai: "xin-ve-moi" });
  });

  it("SAI ORIGIN ⇒ null — tin này ép Sata ký một vé, không ai ngoài fork được xin", () => {
    // Vé SSO là đường vào không cần mật khẩu. Một iframe quảng cáo hay tiện ích mở rộng
    // mà xin được vé là xin được một lượt đăng nhập.
    expect(xuLyThongDiep({ origin: "https://ke-xau.example", data: { type: "sata:xin-ve-moi" } }, GOC)).toBeNull();
    expect(xuLyThongDiep(su({ type: "sata:xin-ve-moi" }), null)).toBeNull();
  });

  it("tin thừa trường vẫn CHỈ ra `xin-ve-moi` — không nhận tham số nào từ khung", () => {
    // Fail-closed: khung KHÔNG được chọn cơ sở hay đổi tham số hộ Sata. Nếu ngày nào đó
    // ai thêm `orgCode` vào tin này thì ca đây đỏ, và đó là điểm của nó.
    const kq = xuLyThongDiep(
      su({ type: "sata:xin-ve-moi", org: "prod-cs2", duongDan: "/leads" }),
      GOC,
    );
    expect(kq).toEqual({ loai: "xin-ve-moi" });
  });
});
