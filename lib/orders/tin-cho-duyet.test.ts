// Ca [TCD2-*] — nội dung tin báo "đơn chờ duyệt". Thuần, không DB.
//
// 🔴 Chủ dự án 25/09/2026: *"khi có đơn cần được duyệt thì phải gửi thông báo về ngay cho
// quản lý để duyệt gấp cho KH được thanh toán"*.
//
// Bộ này khoá hai thứ mà không cổng nào khác khoá được:
//   · KHOÁ CHỐNG TRÙNG phải giống hệt nhau giữa lúc gửi và lúc thu hồi;
//   · TIN KHÔNG ĐƯỢC CHỞ SỐ ĐIỆN THOẠI ra ngoài.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { soanTinChoDuyet, khoaTinChoDuyet, type LyDoChoDuyet } from "./tin-cho-duyet";

const CO_BAN = {
  orderId: "ord-1",
  code: "ORD-260925-000001",
  tenKhach: "Nguyễn Thị Lan",
  tongTien: 8_860_003,
};

/** Không cờ nào bật — nền để bật đúng cờ cần thử. */
const KHONG: LyDoChoDuyet = { giamGia: false, traGop: false, soBuoi: false };

describe("[TCD2-01] khoá chống trùng — MỘT đơn MỘT khoá", () => {
  it("chỉ phụ thuộc `orderId`, không phụ thuộc lý do", () => {
    // ⚠️ Ca đắt nhất của bộ. Khoá phải giống nhau giữa lúc GỬI và lúc THU HỒI; nhét lý do
    // vào khoá là đơn chờ duyệt nhiều phần sẽ sinh nhiều tin, mà lượt thu hồi chỉ biết
    // một khoá ⇒ duyệt xong vẫn còn tin nằm trong chuông, bấm vào một đơn đã xong.
    const a = soanTinChoDuyet({ ...CO_BAN, lyDo: { ...KHONG, giamGia: true } });
    const b = soanTinChoDuyet({
      ...CO_BAN,
      lyDo: { giamGia: true, traGop: true, soBuoi: true },
    });
    expect(a.dedupeKey).toBe(b.dedupeKey);
    expect(a.dedupeKey).toBe(khoaTinChoDuyet("ord-1"));
  });

  it("hai đơn khác nhau ⇒ hai khoá khác nhau", () => {
    expect(khoaTinChoDuyet("ord-1")).not.toBe(khoaTinChoDuyet("ord-2"));
  });

  it("mang đúng tiền tố đã khai trong catalog", () => {
    // Tiền tố quyết nhóm + độ khẩn (`lib/notifications/catalog.ts`). Lệch một ký tự là
    // tin rơi về nhóm `system`, priority 2 — tức hết khẩn, và không ai biết.
    expect(khoaTinChoDuyet("ord-1").startsWith("don.cho_duyet:")).toBe(true);
  });
});

describe("[TCD2-02] tiêu đề nói VIỆC PHẢI LÀM, và nói ĐÚNG phần đang chờ", () => {
  it.each([
    [{ ...KHONG, giamGia: true }, "vượt mức ưu đãi"],
    [{ ...KHONG, traGop: true }, "vượt mức số đợt"],
    // ⚠️ Ca "chỉ số buổi" là ca ĐẮT NHẤT. Bản if/else cũ (hai cờ) báo đơn này là "vượt
    // mức số đợt" — sai hẳn phần, và không ca nào đỏ. Đó là lý do câu chữ nay dựng từ
    // DANH SÁCH chứ không phải ba nhánh viết tay.
    [{ ...KHONG, soBuoi: true }, "số buổi không khớp mốc học phần"],
    [{ ...KHONG, giamGia: true, traGop: true }, "vượt mức ưu đãi và vượt mức số đợt"],
    [{ ...KHONG, traGop: true, soBuoi: true }, "vượt mức số đợt và số buổi không khớp"],
    [
      { giamGia: true, traGop: true, soBuoi: true },
      "vượt mức ưu đãi, vượt mức số đợt và số buổi không khớp",
    ],
  ] as const)("%o ⇒ %s", (lyDo, cum) => {
    const t = soanTinChoDuyet({ ...CO_BAN, lyDo });
    expect(t.title).toContain(cum);
    // Mở đầu bằng ĐỘNG TỪ: chuông có 30 loại tin, tin nào không nói rõ phải làm gì bị lướt.
    expect(t.title.startsWith("Duyệt đơn ")).toBe(true);
    expect(t.title).toContain(CO_BAN.code);
  });

  it("phần SỐ BUỔI không được nói là “vượt mức”", () => {
    // Bán 20 buổi không vượt gì cả — nó chỉ không rơi đúng mốc. Câu báo sai bản chất là
    // câu báo người duyệt đọc xong đi tìm nhầm chỗ trên thẻ.
    const t = soanTinChoDuyet({ ...CO_BAN, lyDo: { ...KHONG, soBuoi: true } });
    expect(t.title).not.toContain("vượt");
  });

  it("không lý do nào ⇒ câu trung tính, KHÔNG ném", () => {
    // Một ngoại lệ ở đường thông báo mà làm hỏng lượt tạo đơn thì cái giá lớn hơn nhiều
    // so với một câu chữ chung chung.
    expect(() => soanTinChoDuyet({ ...CO_BAN, lyDo: KHONG })).not.toThrow();
    expect(soanTinChoDuyet({ ...CO_BAN, lyDo: KHONG }).title).toContain("cần duyệt");
  });
});

describe("[TCD2-03] thân tin nói HẬU QUẢ, và KHÔNG chở PII", () => {
  const tin = soanTinChoDuyet({ ...CO_BAN, lyDo: { ...KHONG, giamGia: true } });

  it("có tên khách + số tiền", () => {
    expect(tin.body).toContain("Nguyễn Thị Lan");
    expect(tin.body).toContain("8.860.003");
  });

  it("nói vì sao PHẢI LÀM NGAY", () => {
    // Người duyệt không nợ ai một cú bấm; họ nợ một khách đang đứng chờ. Câu này là thứ
    // biến một dòng trong chuông thành một lượt bấm.
    expect(tin.body).toContain("không xuất được mã QR");
  });

  it("KHÔNG có chuỗi nào trông như số điện thoại", () => {
    // ⚠️ Tin thông báo đi vào bảng, vào bản đẩy, và vào màn hình khoá điện thoại — ba nơi
    // không ai kiểm soát được ai đang nhìn. Cổng `lib/notifications/pii.ts` là lưới cuối;
    // chỗ soạn chữ mới là chỗ quyết định.
    const chu = `${tin.title} ${tin.body}`;
    expect(chu).not.toMatch(/(?:^|\D)0\d{8,10}(?:\D|$)/);
  });
});

describe("[TCD2-04] đường dẫn trỏ thẳng ĐÚNG ĐƠN VỪA BÁO", () => {
  it("mang orderId, KHÔNG phải hàng chờ chung", () => {
    // ⚠️ Ca này từng ghim `/orders?duyet=1` (hàng chờ) và đã ĐỎ ĐÚNG khi đổi hướng
    // 25/09/2026 — chủ dự án: *"bấm vào xem đơn hàng cần duyệt ĐÓ và duyệt luôn"*.
    // Trỏ vào danh sách là bắt người duyệt tự dò tìm, tức bỏ phí chính cú bấm vừa xin
    // được từ họ.
    const href = soanTinChoDuyet({ ...CO_BAN, lyDo: { ...KHONG, giamGia: true } }).href;
    expect(href).toBe("/orders/ord-1/duyet");
    expect(href).toContain(CO_BAN.orderId);
  });

  it("hai đơn khác nhau ⇒ hai đường dẫn khác nhau", () => {
    // Đối chứng: nếu ai đó lỡ quay về một đường CỐ ĐỊNH thì ca trên vẫn có thể đạt bằng
    // một chuỗi hằng trùng hợp; ca này thì không.
    const a = soanTinChoDuyet({ ...CO_BAN, lyDo: { ...KHONG, giamGia: true } }).href;
    const b = soanTinChoDuyet({
      ...CO_BAN,
      orderId: "ord-2",
      lyDo: { ...KHONG, giamGia: true },
    }).href;
    expect(a).not.toBe(b);
  });
});

describe("[TCD2-05] DÂY NỐI — hook phải THẬT SỰ được cắm", () => {
  // ⚠️ Mọi ca ở trên là hàm thuần: chúng xanh y nguyên kể cả khi KHÔNG AI GỌI chúng.
  // Con bug đắt nhất của tính năng này là "viết xong mà quên cắm" — và nó câm tuyệt đối:
  // không lỗi biên dịch, không ca đỏ, chỉ là chuông im. Cùng họ `[DS-01b]` (CLAUDE.md,
  // mẫu "lưới ghim mã nguồn").
  function boChuThich(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  }
  const doc = (p: string) => boChuThich(readFileSync(resolve(process.cwd(), p), "utf8"));

  const TAO_DON = doc("app/(admin)/admin/orders/_actions.ts");
  const DUYET = doc("app/(admin)/admin/orders/duyet/_actions.ts");

  it("đường TẠO ĐƠN gọi `baoDonChoDuyet` đúng MỘT lần", () => {
    expect(TAO_DON.match(/baoDonChoDuyet\(/g) ?? []).toHaveLength(1);
  });

  it("đường DUYỆT và đường TỪ CHỐI đều thu hồi — phải là HAI lời gọi", () => {
    // ⚠️ Con số 2 là cả cái luật. Một lời gọi nghĩa là ai đó chỉ nhớ đường duyệt; đơn bị
    // TỪ CHỐI khi ấy vẫn để lại tin trong chuông của mọi người duyệt.
    expect(DUYET.match(/thuHoiBaoChoDuyet\(/g) ?? []).toHaveLength(2);
  });

  it("cờ chờ duyệt có MỘT nguồn, dùng cho cả cột DB lẫn tin báo", () => {
    // ⚠️ CA NÀY ĐÃ VIẾT LẠI 25/09/2026 vì nó ghim CÁCH VIẾT chứ không ghim LUẬT.
    // Bản cũ đòi đúng văn bản `const lyDoChoDuyet = {` — tức bắt buộc phải là một object
    // literal dựng tại chỗ. Khi ba cờ được gom về `xetDuyetDon(...).phan` (một nguồn duy
    // nhất, đúng hơn hẳn), lưới đỏ trong khi luật nó canh không đổi một chữ. Cùng họ
    // `[NDC-07]`, `[QCS-03]` trong CLAUDE.md: đọc LÝ LẼ của lưới rồi hỏi lý lẽ ấy có bắt
    // buộc cách hiện thực đó không.
    //
    // LUẬT: cờ được GÁN đúng MỘT lần, và cả ba cột DB lẫn tin báo đều đọc từ biến ấy.
    // Tính lại ở nơi thứ hai là mở đúng lớp lỗi "hai nguồn cho một sự thật": cột trong DB
    // nói một đằng, chữ trong chuông nói một nẻo.
    expect(TAO_DON.match(/const lyDoChoDuyet\b/g) ?? []).toHaveLength(1);
    expect(TAO_DON).toMatch(/installmentApprovalStatus: lyDoChoDuyet\.traGop/);
    expect(TAO_DON).toMatch(/discountApprovalStatus: lyDoChoDuyet\.giamGia/);
    expect(TAO_DON).toMatch(/soBuoiApprovalStatus: lyDoChoDuyet\.soBuoi/);
    expect(TAO_DON).toMatch(/lyDo: lyDoChoDuyet/);
  });

  it("KHÔNG tự tính lại điều kiện ngưỡng bên cạnh lời gọi `xetDuyetDon`", () => {
    // Bản trước viết `xetDuyet.canDuyet && soDotHocPhi > tranSoDot` — chép lại phép so
    // của `xetDuyetDon` ngay cạnh lời gọi nó. Hôm nay hai bản còn khớp; ngày nào một bên
    // đổi (thêm cọc vào phép đếm, đổi `>` thành `>=`) thì cột trong DB và danh sách lý do
    // trên màn nói hai điều khác nhau, và không ca nào đỏ.
    expect(TAO_DON).not.toMatch(/canDuyet\s*&&\s*soDotHocPhi/);
    expect(TAO_DON).not.toMatch(/canDuyet\s*&&\s*khaiDong\.some/);
  });

  it("luật MỐC HỌC PHẦN thật sự được nối vào đường tạo đơn", () => {
    // ⚠️ Lưới DÂY NỐI cho luật 25/09. Hàm `xetSoBuoiDong` là hàm thuần — bộ `[SBH-*]`
    // xanh y nguyên kể cả khi không ai gọi nó. Gỡ lời gọi ở đây là luật câm hoàn toàn:
    // không đơn nào vào hàng chờ vì số buổi, và không lỗi nào báo.
    expect(TAO_DON.match(/xetSoBuoiDong\(/g) ?? []).toHaveLength(1);
    expect(TAO_DON).toMatch(/soBuoiTheoDong/);
    // Vế PHẠM VI phải đọc từ DB (`Course.totalSessions`), không đoán từ payload client.
    expect(TAO_DON).toMatch(/totalSessions/);
  });

  it("KHÔNG tự báo cho chính người vừa tạo đơn", () => {
    expect(TAO_DON).toMatch(/boQuaUserId:/);
  });
});
