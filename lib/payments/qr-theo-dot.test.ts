import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { trangThaiQrDot, loiDotKhacDangGiu } from "./qr-theo-dot";

const D1 = { paymentRequestId: "pr-1", nhan: "Đợt 1/3" };
const D2 = { paymentRequestId: "pr-2", nhan: "Đợt 2/3" };

describe("[QTD] dòng đợt — nút QR làm gì", () => {
  it("[QTD-01] cờ TẮT ⇒ đường QrSession đời cũ, KHÔNG đụng gì", () => {
    // Đơn cũ ở cơ sở chưa bật cờ vẫn phải xuất được QR y như hôm nay.
    expect(trangThaiQrDot({ bat: false, dongPhieuMo: null, paymentRequestId: "pr-1" })).toEqual({
      kieu: "CU",
    });
    // Kể cả khi (vì lý do gì đó) đơn có phiếu mở: cờ tắt thì luồng cũ thắng, không nửa vời.
    expect(trangThaiQrDot({ bat: false, dongPhieuMo: [D1], paymentRequestId: "pr-1" })).toEqual({
      kieu: "CU",
    });
  });

  it("[QTD-02] cờ BẬT, chưa có phiếu mở ⇒ bấm là phát phiếu 1 dòng", () => {
    expect(trangThaiQrDot({ bat: true, dongPhieuMo: null, paymentRequestId: "pr-1" })).toEqual({
      kieu: "MOI_CHUA_PHAT",
    });
  });

  it("[QTD-02b] phiếu mở RỖNG DÒNG cũng là chưa phát — không được coi là 'đợt khác giữ'", () => {
    // Phiếu không dòng nào là dữ liệu hỏng, nhưng nó KHÔNG được biến thành một câu từ chối
    // trỏ vào hư vô ("đang mở cho " + chuỗi rỗng).
    expect(trangThaiQrDot({ bat: true, dongPhieuMo: [], paymentRequestId: "pr-1" })).toEqual({
      kieu: "MOI_CHUA_PHAT",
    });
  });

  it("[QTD-03] phiếu mở CHỨA đợt này ⇒ hiện mã của phiếu ấy", () => {
    expect(trangThaiQrDot({ bat: true, dongPhieuMo: [D1], paymentRequestId: "pr-1" })).toEqual({
      kieu: "MOI_CUA_DOT_NAY",
    });
    // Phiếu nhiều dòng, đợt này là một trong số đó.
    expect(trangThaiQrDot({ bat: true, dongPhieuMo: [D1, D2], paymentRequestId: "pr-2" })).toEqual({
      kieu: "MOI_CUA_DOT_NAY",
    });
  });

  it("[QTD-04] phiếu mở của đợt KHÁC ⇒ nói ra ai đang giữ, không vẽ nút hứa suông", () => {
    // Luật 12: một cái nút chắc chắn ăn lỗi unique của DB là một lời hứa suông.
    expect(trangThaiQrDot({ bat: true, dongPhieuMo: [D1], paymentRequestId: "pr-9" })).toEqual({
      kieu: "MOI_CUA_DOT_KHAC",
      nhanDotDangGiu: "Đợt 1/3",
    });
  });

  it("[QTD-05] phiếu NHIỀU dòng ⇒ kể ĐỦ, không chỉ dòng đầu", () => {
    // Nói "đang mở cho Đợt 1" trong khi phiếu ôm cả Đợt 1 lẫn Đợt 2 sẽ khiến sale đi huỷ
    // nhầm thứ, rồi ngạc nhiên vì đợt kia cũng biến mất theo.
    const r = trangThaiQrDot({ bat: true, dongPhieuMo: [D1, D2], paymentRequestId: "pr-9" });
    expect(r).toEqual({ kieu: "MOI_CUA_DOT_KHAC", nhanDotDangGiu: "Đợt 1/3, Đợt 2/3" });
  });

  it("[QTD-06] câu từ chối nói bằng ngôn ngữ NGUYÊN NHÂN + lối đi tiếp", () => {
    const s = loiDotKhacDangGiu("Đợt 1/3");
    expect(s).toContain("Đợt 1/3");
    expect(s).toContain("đóng hoặc huỷ");
    // Không được là một câu lỗi kỹ thuật — sale đọc "unique constraint" thì chỉ biết gọi dev.
    expect(s).not.toMatch(/unique|constraint|PaymentBill|OPEN/i);
  });
});

// ── LƯỚI GHIM DÂY NỐI ────────────────────────────────────────────────────────
//
// ⚠️ LUẬT 11 — đây đúng hình dạng lỗi CÂM mà repo đã trả giá ở mục sidebar "Zalo CRM":
// một prop cờ đi qua BA tầng (`page.tsx` → `order-detail-client` → `payment-requests-section`),
// và quên một mắt xích thì KHÔNG lỗi biên dịch nếu prop là tuỳ chọn, KHÔNG ca hành vi nào đỏ,
// còn triệu chứng là "tính năng không bao giờ hiện" — trông y hệt lỗi phân quyền.
//
// Ba prop dưới đây đều khai BẮT BUỘC (không `?`, không mặc định) nên `tsc` đã bắt được phần
// lớn. Lưới này canh nốt phần `tsc` KHÔNG thấy: truyền ĐÚNG NGUỒN. Truyền `canManage` vào
// `duocPhatPhieu` biên dịch trót lọt và sai âm thầm — hai quyền khác nhau.
describe("[QTD-W] dây nối ba tầng — prop cờ phải tới được nơi dùng", () => {
  const doc = (p: string) =>
    readFileSync(resolve(process.cwd(), p), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((d) => !d.trimStart().startsWith("//"))
      .join("\n");

  const PAGE = "app/(admin)/admin/orders/[id]/page.tsx";
  const CLIENT = "app/(admin)/admin/orders/_components/order-detail-client.tsx";
  const BANG = "app/(admin)/admin/orders/_components/payment-requests-section.tsx";

  it("[QTD-W1] page truyền đủ ba prop xuống OrderDetailClient", () => {
    const s = doc(PAGE);
    expect(s).toContain("batThuTheoCon={batThuTheoCon}");
    expect(s).toContain("phieuGop={phieuGop}");
    // NGUỒN phải là `canRecordPayments` (payments:record) — KHÔNG phải `canManage`.
    expect(s).toContain("duocPhatPhieu={canRecordPayments}");
    expect(s).not.toContain("duocPhatPhieu={canManage}");
  });

  it("[QTD-W2] OrderDetailClient chuyển tiếp đủ ba prop xuống bảng phiếu thu", () => {
    const s = doc(CLIENT);
    expect(s).toContain("batThuTheoCon={batThuTheoCon}");
    expect(s).toContain("phieuGop={phieuGop}");
    expect(s).toContain("duocPhatPhieu={duocPhatPhieu}");
  });

  it("[QTD-W4] CẢ phiếu gộp nằm ở ĐÚNG MỘT khối — mã, ảnh, và nút thu hồi", () => {
    // Chủ dự án 24/09, hai lượt:
    //   "đưa qr về đúng session phiếu thu & qr theo đợt chứ"
    //   "chỗ thu hồi phiếu cũng bỏ xuống dưới phần QR luôn chứ"
    //
    // ⚠️ Không chỉ là chuyện bố cục. Bản giữa chừng để mã + nút huỷ ở khối "Công nợ theo
    // con" còn ảnh ở khối dưới — người dùng phải nhìn HAI CHỖ cho MỘT tờ phiếu, và hai chỗ
    // cùng nói về một thứ là đúng lớp lỗi đã vá sáng cùng ngày (chữ dựng lại một nơi, ảnh
    // chụp một nơi, rồi lệch mà không ai biết).
    //
    // Nay: "Phiếu thu & QR theo đợt" giữ TRỌN tờ phiếu; "Công nợ theo con" quay về đúng
    // việc của nó.
    const con = doc("app/(admin)/admin/orders/_components/cong-no-theo-con.tsx");
    const bang = doc(BANG);

    // Khối công nợ theo con: KHÔNG ảnh, KHÔNG nút thu hồi, KHÔNG gọi action thu hồi.
    expect(con, "không được vẽ ảnh QR").not.toContain("<QrZoom");
    expect(con, "không nhúng thẳng `qrUrl` vào thẻ ảnh").not.toContain("phieu.qrUrl}");
    expect(con, "không còn cửa thu hồi phiếu").not.toContain("huyPhieuGopAction(");
    expect(con, "…kể cả cửa ĐÓNG phiếu").not.toContain("dongPhieuGopAction(");

    // Khối phiếu thu theo đợt: có ĐỦ ba thứ.
    expect(bang, "PHẢI vẽ ảnh").toContain("<QrZoom");
    expect(bang).toContain("src={phieu.qrUrl}");
    expect(bang, "PHẢI có cửa huỷ").toContain("huyPhieuGopAction(");
    expect(bang, "PHẢI có cửa đóng").toContain("dongPhieuGopAction(");
    // Lý do BẮT BUỘC — huỷ/đóng tờ phiếu đã đưa khách phải giải trình được khi đối soát.
    expect(bang).toContain("Ghi lý do");
  });

  it("[QTD-W3] bảng phiếu thu khai ba prop là BẮT BUỘC và thật sự dùng", () => {
    const s = doc(BANG);
    // Khai bắt buộc: `tsc` liệt kê chỗ gọi thay vì để mặc định câm.
    expect(s).toMatch(/\bbatThuTheoCon: boolean;/);
    expect(s).toMatch(/\bduocPhatPhieu: boolean;/);
    expect(s).toMatch(/\bphieuGop: PhieuGopView \| null;/);
    // Và dùng thật, không phải nhận rồi bỏ đó.
    expect(s).toContain("bat: batThuTheoCon");
    expect(s).toContain("taoPhieuGopAction({ orderId, paymentRequestIds: [r.id] })");
  });
});
