// @vitest-environment node
/**
 * CHE LIÊN HỆ TRƯỚC KHI RA KHỎI SERVER.
 *
 * Đợt trước vừa bịt 7 chỗ rò SĐT ở site Sale. Hộp thư là bề mặt rò MỚI và khó hơn:
 * số điện thoại không nằm ở một cột để che, nó nằm LẪN trong câu khách gõ
 * ("sdt em 0905123456 nhé"). Che cột mà quên nội dung tin là bịt cửa trước mở cửa sau.
 *
 * Luật của bộ này: che ở TẦNG DỮ LIỆU, không ở JSX. Che ở JSX thì số thật vẫn đi
 * xuống payload RSC và ai mở tab Network cũng đọc được.
 */
import { describe, it, expect } from "vitest";
import { chieuTinNhan, chieuHoiThoai, tinhChoTraLoi } from "@/lib/inbox/view";

const LUC = new Date("2026-08-27T03:00:00.000Z");

const tinGoc = {
  id: "m1",
  direction: "IN" as const,
  body: "Chào shop, sdt em 0905123456, mail em la mekhach@gmail.com",
  sentAt: LUC,
  sentByUserId: null,
  sentOutsideSystem: false,
  deliveryStatus: null,
  errorCode: null,
};

describe("nội dung tin nhắn", () => {
  it("KHÔNG có quyền xem liên hệ ⇒ đục SĐT + email, GIỮ phần còn lại đọc được", () => {
    // Ẩn hẳn cả đoạn thì người trực không làm việc được; giữ nguyên thì che chỉ là
    // hình thức. `redactContactsInText` là bản đã cân giữa hai thứ đó.
    const v = chieuTinNhan(tinGoc, false);
    expect(v.body).not.toContain("0905123456");
    expect(v.body).not.toContain("mekhach@gmail.com");
    expect(v.body).toContain("Chào shop");
  });

  it("CÓ quyền ⇒ giữ nguyên", () => {
    expect(chieuTinNhan(tinGoc, true).body).toBe(tinGoc.body);
  });

  it("tin rỗng / null không làm vỡ", () => {
    expect(chieuTinNhan({ ...tinGoc, body: null }, false).body).toBeNull();
    expect(chieuTinNhan({ ...tinGoc, body: "" }, false).body).toBe("");
  });

  it("thời điểm ra khỏi server dưới dạng CHUỖI ISO", () => {
    // Ranh giới server→client không mang được `Date`. Quên `.toISOString()` là lỗi
    // runtime chỉ hiện khi có dữ liệu thật.
    const v = chieuTinNhan(tinGoc, true);
    expect(typeof v.sentAt).toBe("string");
    expect(v.sentAt).toBe(LUC.toISOString());
  });
});

describe("đầu hội thoại", () => {
  const convGoc = {
    id: "c1",
    channel: "ZALO_OA" as const,
    status: "OPEN" as const,
    assigneeId: null,
    unreadCount: 2,
    lastMessageAt: LUC,
    lastInboundAt: LUC,
    lastOutboundAt: null,
    awaitingReply: true,
    orgUnitId: null,
    identity: {
      id: "i1",
      displayName: "Nguyễn Thị Lan",
      leadId: "lead-1",
      linkSource: null,
    },
    lead: { id: "lead-1", parentName: "Nguyễn Thị Lan", phone: "0905123456" },
  };

  it("KHÔNG có quyền ⇒ SĐT của lead KHÔNG xuất hiện ở bất kỳ đâu trong kết quả", () => {
    // Kiểm trên CHUỖI JSON của cả object, không kiểm từng field: đó đúng là kiểu
    // lỗi đã xảy ra (che field hiển thị nhưng để nguyên field thô bên cạnh).
    const v = chieuHoiThoai(convGoc, false);
    expect(JSON.stringify(v)).not.toContain("0905123456");
  });

  it("KHÔNG có quyền ⇒ tên hiển thị do nhà cung cấp trả về cũng bị mờ hoá", () => {
    // Tên Zalo/Facebook thường là tên thật. Che tên trong `Lead` mà để nguyên tên
    // trên thẻ hội thoại là che một nửa.
    const v = chieuHoiThoai(convGoc, false);
    expect(v.tenHienThi).not.toBe("Nguyễn Thị Lan");
    expect(v.tenHienThi).toContain("Nguyễn");
  });

  it("CÓ quyền ⇒ thấy đủ", () => {
    const v = chieuHoiThoai(convGoc, true);
    expect(v.tenHienThi).toBe("Nguyễn Thị Lan");
    expect(v.sdtKhach).toBe("0905123456");
  });

  it("hội thoại MỒ CÔI ⇒ không có lead, không nổ, có cờ để giao diện hiện hàng đợi", () => {
    const moCoi = { ...convGoc, identity: { ...convGoc.identity, leadId: null }, lead: null };
    const v = chieuHoiThoai(moCoi, true);
    expect(v.moCoi).toBe(true);
    expect(v.leadId).toBeNull();
    expect(v.sdtKhach).toBeNull();
  });

  it("cờ `chưa trả lời` lấy TỪ CỘT, không tự suy lại ở tầng chiếu", () => {
    // Hai nguồn cho một câu hỏi là hai con số sẽ lệch nhau. Cột là kết quả đã lưu
    // của `tinhChoTraLoi`; tầng chiếu chỉ đọc lại.
    expect(chieuHoiThoai(convGoc, true).chuaTraLoi).toBe(true);
    expect(chieuHoiThoai({ ...convGoc, awaitingReply: false }, true).chuaTraLoi).toBe(false);
  });

  it("không có tên nào ⇒ nhãn thay thế, KHÔNG lộ định danh kênh", () => {
    // Trước đây màn Messenger in `PSID ${psid.slice(0,8)}` — định danh kỹ thuật của
    // khách, không giúp gì cho người trực và là một mẩu dữ liệu không cần lộ.
    const khuyet = {
      ...convGoc,
      identity: { ...convGoc.identity, displayName: null, leadId: null },
      lead: null,
    };
    expect(chieuHoiThoai(khuyet, true).tenHienThi).toBe("Khách chưa rõ tên");
  });
});

describe("tinhChoTraLoi — nguồn sự thật của cột `awaitingReply`", () => {
  const t1 = new Date("2026-08-27T01:00:00.000Z");
  const t2 = new Date("2026-08-27T02:00:00.000Z");

  it("chưa ai nhắn tới ⇒ không phải đang chờ", () => {
    expect(tinhChoTraLoi({ lastInboundAt: null, lastOutboundAt: null })).toBe(false);
  });

  it("khách nhắn, chưa tin nào ĐI ĐƯỢC ⇒ đang chờ", () => {
    expect(tinhChoTraLoi({ lastInboundAt: t1, lastOutboundAt: null })).toBe(true);
  });

  it("đã trả lời SAU tin của khách ⇒ hết chờ", () => {
    expect(tinhChoTraLoi({ lastInboundAt: t1, lastOutboundAt: t2 })).toBe(false);
  });

  it("khách nhắn TIẾP sau lần trả lời cuối ⇒ chờ lại", () => {
    expect(tinhChoTraLoi({ lastInboundAt: t2, lastOutboundAt: t1 })).toBe(true);
  });
});
