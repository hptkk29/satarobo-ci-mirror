// @vitest-environment node
/**
 * EL-08 — vòng đời phiên bản khoá.
 *
 * Phiên bản tồn tại vì một tình huống rất đời: Đào tạo sửa nội dung giữa chừng
 * trong khi có người đang học dở. Không có phiên bản thì tập bài đổi dưới chân
 * họ — hôm qua 8 bài, hôm nay 10, và tiến độ 100% tụt xuống 80% mà không ai giải
 * thích được.
 */
import { describe, it, expect } from "vitest";
import {
  phienBanKeTiep,
  nhanPhienBan,
  laThayDoiMajor,
  chuyenTrangThai,
  tenBanSao,
  THONG_BAO_PHIEN_BAN,
  type TrangThaiPhienBan,
} from "@/lib/elearning/course-version";

describe("số phiên bản", () => {
  it("chưa có bản nào ⇒ bắt đầu v1.0", () => {
    expect(phienBanKeTiep(null, "MINOR")).toEqual({ major: 1, minor: 0 });
  });

  it("MINOR tăng số sau, giữ số trước", () => {
    expect(phienBanKeTiep({ major: 2, minor: 3 }, "MINOR")).toEqual({ major: 2, minor: 4 });
  });

  it("MAJOR tăng số trước và RESET số sau", () => {
    // Không reset thì v2.7 lên v3.7, và người đọc tưởng đã có 7 bản sửa nhỏ của
    // bản 3 trong khi nó vừa ra đời.
    expect(phienBanKeTiep({ major: 2, minor: 7 }, "MAJOR")).toEqual({ major: 3, minor: 0 });
  });

  it("nhãn đọc được", () => {
    expect(nhanPhienBan({ major: 2, minor: 4 })).toBe("v2.4");
  });
});

describe("khi nào là thay đổi MAJOR", () => {
  it("thêm bài bắt buộc ⇒ MAJOR", () => {
    expect(laThayDoiMajor({ batBuocCu: ["a"], batBuocMoi: ["a", "b"] })).toBe(true);
  });

  it("bớt bài bắt buộc ⇒ MAJOR", () => {
    expect(laThayDoiMajor({ batBuocCu: ["a", "b"], batBuocMoi: ["a"] })).toBe(true);
  });

  it("ĐỔI bài bắt buộc mà giữ nguyên SỐ LƯỢNG ⇒ vẫn MAJOR", () => {
    // Đây là chỗ so theo số lượng sẽ sai: A→B giữ nguyên "1 bài bắt buộc" nhưng
    // đổi hẳn điều kiện hoàn thành.
    expect(laThayDoiMajor({ batBuocCu: ["a"], batBuocMoi: ["b"] })).toBe(true);
  });

  it("không đổi tập bài bắt buộc ⇒ không MAJOR", () => {
    expect(laThayDoiMajor({ batBuocCu: ["a", "b"], batBuocMoi: ["b", "a"] })).toBe(false);
  });
});

describe("máy trạng thái", () => {
  const di = (
    tu: TrangThaiPhienBan,
    hanhDong: Parameters<typeof chuyenTrangThai>[0]["hanhDong"],
    danBaiHopLe = true,
  ) => chuyenTrangThai({ tu, hanhDong, danBaiHopLe });

  it("luồng thuận: nháp → chờ duyệt → đã duyệt → xuất bản → lưu trữ", () => {
    expect(di("DRAFT", "GUI_DUYET")).toEqual({ ok: true, toi: "PENDING_REVIEW" });
    expect(di("PENDING_REVIEW", "DUYET")).toEqual({ ok: true, toi: "APPROVED" });
    expect(di("APPROVED", "XUAT_BAN")).toEqual({ ok: true, toi: "PUBLISHED" });
    expect(di("PUBLISHED", "LUU_TRU")).toEqual({ ok: true, toi: "ARCHIVED" });
  });

  it("DUYỆT và XUẤT BẢN là HAI bước, không gộp", () => {
    // Duyệt là "nội dung này đúng"; xuất bản là "phát cho người học". Gộp lại thì
    // người duyệt mất khả năng nói "đúng rồi, nhưng chờ tới đầu quý hãy phát".
    expect(di("PENDING_REVIEW", "XUAT_BAN").ok).toBe(false);
    expect(di("APPROVED", "DUYET").ok).toBe(false);
  });

  it("trả lại được từ CHỜ DUYỆT và từ ĐÃ DUYỆT, nhưng không từ ĐÃ PHÁT", () => {
    // Người duyệt đổi ý sau khi đã duyệt mà CHƯA phát thì vẫn còn đường lùi.
    expect(di("PENDING_REVIEW", "TRA_LAI")).toEqual({ ok: true, toi: "DRAFT" });
    expect(di("APPROVED", "TRA_LAI")).toEqual({ ok: true, toi: "DRAFT" });
    expect(di("PUBLISHED", "TRA_LAI").ok).toBe(false);
  });

  it("KHÔNG có đường từ ĐÃ XUẤT BẢN ngược về nháp", () => {
    // Bản đã phát ra là một sự kiện đã xảy ra. Kéo về nháp là đổi dưới chân
    // người đang học — đúng thứ mà phiên bản sinh ra để chống.
    for (const hd of ["GUI_DUYET", "TRA_LAI", "DUYET", "XUAT_BAN"] as const) {
      expect(di("PUBLISHED", hd).ok, hd).toBe(false);
    }
  });

  it("dàn bài chưa hợp lệ ⇒ chặn ngay ở bước GỬI DUYỆT", () => {
    // Bắt người duyệt phát hiện một chương rỗng là đẩy việc của người soạn sang
    // người khác.
    const r = di("DRAFT", "GUI_DUYET", false);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("CAN_DAN_BAI_HOP_LE");
  });

  it("kiểm LẠI dàn bài ở CẢ bước duyệt lẫn bước xuất bản", () => {
    // Giữa các bước có thể có người xoá một bài.
    expect(di("PENDING_REVIEW", "DUYET", false).ok).toBe(false);
    expect(di("APPROVED", "XUAT_BAN", false).ok).toBe(false);
  });

  it("lưu trữ chỉ đi từ ĐÃ XUẤT BẢN", () => {
    expect(di("DRAFT", "LUU_TRU").ok).toBe(false);
    expect(di("ARCHIVED", "LUU_TRU").ok).toBe(false);
  });

  it("bản ĐÃ LƯU TRỮ là ngõ cụt, không thao tác nào đi tiếp", () => {
    for (const hd of ["GUI_DUYET", "TRA_LAI", "DUYET", "XUAT_BAN", "LUU_TRU"] as const) {
      expect(di("ARCHIVED", hd).ok, hd).toBe(false);
    }
  });

  it("mỗi mã lỗi có câu tiếng Việt", () => {
    for (const c of ["SAI_LUONG", "CAN_DAN_BAI_HOP_LE"] as const) {
      expect(THONG_BAO_PHIEN_BAN[c], c).toBeTruthy();
    }
  });
});

describe("nhân bản khoá", () => {
  it("mã và tên đều KHÁC bản gốc", () => {
    // Nhân bản mà giữ nguyên tên là cách chắc chắn nhất để hai tuần sau không ai
    // biết bản nào đang phát cho người học.
    const r = tenBanSao({ code: "AT.2026.001", title: "An toàn", lan: 1 });
    expect(r.code).not.toBe("AT.2026.001");
    expect(r.title).not.toBe("An toàn");
    expect(r.title).toContain("bản sao");
  });

  it("nhân bản lần thứ hai ra mã khác lần đầu", () => {
    const l1 = tenBanSao({ code: "A", title: "T", lan: 1 });
    const l2 = tenBanSao({ code: "A", title: "T", lan: 2 });
    expect(l1.code).not.toBe(l2.code);
    expect(l1.slug).not.toBe(l2.slug);
  });

  it("slug chỉ còn chữ thường, số và gạch nối", () => {
    const r = tenBanSao({ code: "SR.DT.KD.2026.001", title: "X", lan: 1 });
    expect(r.slug).toMatch(/^[a-z0-9-]+$/);
    expect(r.slug.startsWith("-")).toBe(false);
    expect(r.slug.endsWith("-")).toBe(false);
  });
});
