import { describe, it, expect } from "vitest";
import { quyenSuaCase, quyenGoHocVien, quyenXoaCase, quyenDoiGioCase, quyenChuyenCase, quyenDiemDanhCase } from "./quyen-case";

const SALE_1 = "user-sale-1";
const SALE_2 = "user-sale-2";

/** Lead do Sale 2 phụ trách, không chia sẻ. */
const leadCuaSale2 = { assignedToId: SALE_2, createdById: SALE_2, isSharedWithTeam: false };

describe("[QC-01] sửa case — đo bằng NGƯỜI TẠO CASE", () => {
  it("người tạo sửa được case của mình", () => {
    expect(quyenSuaCase({ nguoiTaoId: SALE_1, userId: SALE_1, laQuanLy: false }).duoc).toBe(true);
  });

  it("Sale khác KHÔNG sửa được, và câu lỗi nói rõ vẫn XEM được", () => {
    const r = quyenSuaCase({ nguoiTaoId: SALE_2, userId: SALE_1, laQuanLy: false });
    expect(r.duoc).toBe(false);
    if (r.duoc) throw new Error("phải từ chối");
    expect(r.lyDo).toContain("người khác tạo");
    // Câu lỗi phải nói người dùng CÒN LÀM ĐƯỢC GÌ, không chỉ nói "không được".
    expect(r.lyDo).toContain("xem được");
  });

  it("Quản lý cơ sở sửa được case của bất kỳ ai", () => {
    expect(quyenSuaCase({ nguoiTaoId: SALE_2, userId: SALE_1, laQuanLy: true }).duoc).toBe(true);
  });
});

describe("[QC-02] case CŨ (createdById = null) chỉ Quản lý đụng được", () => {
  // Cột `createdById` cố ý KHÔNG backfill. Cho mọi Sale sửa case cũ là mở toang; khoá
  // hết mọi người là lớp cũ không sửa nổi. Đường giữa: đẩy lên Quản lý, và NÓI RA lý do.
  it("Sale KHÔNG sửa được case cũ, câu lỗi nêu đúng nguyên nhân", () => {
    const r = quyenSuaCase({ nguoiTaoId: null, userId: SALE_1, laQuanLy: false });
    expect(r.duoc).toBe(false);
    if (r.duoc) throw new Error("phải từ chối");
    expect(r.lyDo).toContain("trước 23/09/2026");
  });

  it("Quản lý VẪN sửa được case cũ — nếu không thì lớp cũ kẹt vĩnh viễn", () => {
    expect(quyenSuaCase({ nguoiTaoId: null, userId: SALE_1, laQuanLy: true }).duoc).toBe(true);
  });
});

describe("[QC-03] gỡ học viên — đo bằng CHỦ LEAD, KHÔNG phải người gắn", () => {
  it("chủ lead gỡ được", () => {
    expect(quyenGoHocVien({ lead: leadCuaSale2, userId: SALE_2, laQuanLy: false }).duoc).toBe(true);
  });

  it("Sale khác KHÔNG gỡ được, câu lỗi nêu TÊN người phụ trách", () => {
    const r = quyenGoHocVien({
      lead: leadCuaSale2,
      userId: SALE_1,
      laQuanLy: false,
      tenSale: "Trần Thị B",
    });
    expect(r.duoc).toBe(false);
    if (r.duoc) throw new Error("phải từ chối");
    expect(r.lyDo).toContain("Trần Thị B");
    // Phải nói rõ vế CÒN ĐƯỢC LÀM: chủ dự án chốt Sale 1 vẫn gắn được bé vào case.
    expect(r.lyDo).toContain("gắn thêm");
  });

  it("không có tên Sale thì câu lỗi vẫn đọc được, không ra chuỗi rỗng lửng lơ", () => {
    const r = quyenGoHocVien({ lead: leadCuaSale2, userId: SALE_1, laQuanLy: false });
    expect(r.duoc).toBe(false);
    if (r.duoc) throw new Error("phải từ chối");
    expect(r.lyDo).toContain("Sale khác");
    expect(r.lyDo).not.toContain("của .");
  });

  it("[QC-03d] QUẢN LÝ gắn hộ thì chủ lead VẪN gỡ được — đây là chốt của chủ dự án", () => {
    // "ngoài ra qlcs/đào tạo hoặc admin gắn thì sale chủ lead vẫn gỡ bth".
    // Hàm cố ý KHÔNG nhận `addedById`: đo bằng người gắn thì đúng ca này sẽ khoá nhầm
    // Sale chủ lead. Không có tham số đó nghĩa là không thể viết sai.
    expect(quyenGoHocVien({ lead: leadCuaSale2, userId: SALE_2, laQuanLy: false }).duoc).toBe(true);
  });

  it("[QC-03e] lead do TÔI NHẬP nhưng chia cho Sale khác ⇒ tôi VẪN gỡ được", () => {
    // ⚠️ Ca này sinh ra từ một lượt XANH GIẢ. Bộ cũ chỉ có lead mà `assignedToId` và
    // `createdById` là CÙNG một người, nên cấy lỗi "đo bằng `assignedToId` thay vì gọi
    // `laLeadCuaToi`" vẫn xanh cả 34 ca — hai nhánh trùng kết quả trên mọi fixture.
    //
    // Hình dạng THẬT làm lộ ra: Sale A nhập phiếu rồi lead được chia cho Sale B. Theo
    // `laLeadCuaToi`, A vẫn là chủ. Đây cũng chính là lý do hàm gọi helper dùng chung
    // thay vì so một cột — `laLeadCuaToi` có BA vế, và hai vế kia không thể đoán ra.
    const leadToiNhap = {
      assignedToId: SALE_2,
      createdById: SALE_1,
      isSharedWithTeam: false,
    };
    expect(quyenGoHocVien({ lead: leadToiNhap, userId: SALE_1, laQuanLy: false }).duoc).toBe(
      true,
    );
    // Và người thứ ba thì vẫn không được — nới một vế không được nới cả cửa.
    expect(quyenGoHocVien({ lead: leadToiNhap, userId: "user-sale-3", laQuanLy: false }).duoc)
      .toBe(false);
  });

  it("lead đã xoá ⇒ fail-closed, chỉ Quản lý gỡ", () => {
    const r = quyenGoHocVien({ lead: null, userId: SALE_1, laQuanLy: false });
    expect(r.duoc).toBe(false);
    if (r.duoc) throw new Error("phải từ chối");
    expect(r.lyDo).toContain("lead đã xoá");
    expect(quyenGoHocVien({ lead: null, userId: SALE_1, laQuanLy: true }).duoc).toBe(true);
  });
});

describe("[QC-04] xoá case — cổng THỨ HAI cho học viên của người khác", () => {
  it("case rỗng của mình thì xoá được", () => {
    expect(
      quyenXoaCase({ nguoiTaoId: SALE_1, userId: SALE_1, laQuanLy: false, soHocVienNguoiKhac: 0 })
        .duoc,
    ).toBe(true);
  });

  it("[QC-04b] case CỦA MÌNH nhưng chứa bé của Sale khác ⇒ TỪ CHỐI", () => {
    // Đây là lỗ mà `quyenSuaCase` một mình KHÔNG bịt: chủ case xoá case là gỡ hàng loạt
    // trá hình, và bé của Sale khác rơi khỏi lịch hẹn mà người phụ trách không biết.
    const r = quyenXoaCase({
      nguoiTaoId: SALE_1,
      userId: SALE_1,
      laQuanLy: false,
      soHocVienNguoiKhac: 2,
    });
    expect(r.duoc).toBe(false);
    if (r.duoc) throw new Error("phải từ chối");
    expect(r.lyDo).toContain("2 học viên");
    expect(r.lyDo).toContain("gỡ bé ra trước");
  });

  it("Quản lý xoá được kể cả khi có bé của người khác", () => {
    expect(
      quyenXoaCase({ nguoiTaoId: SALE_2, userId: SALE_1, laQuanLy: true, soHocVienNguoiKhac: 5 })
        .duoc,
    ).toBe(true);
  });

  it("case của người khác thì trả về ĐÚNG lý do của quyenSuaCase, không đẻ câu thứ hai", () => {
    const r = quyenXoaCase({
      nguoiTaoId: SALE_2,
      userId: SALE_1,
      laQuanLy: false,
      soHocVienNguoiKhac: 0,
    });
    const s = quyenSuaCase({ nguoiTaoId: SALE_2, userId: SALE_1, laQuanLy: false });
    expect(r).toEqual(s);
  });
});

describe("[QC-05] dời giờ case — cổng khách của người khác", () => {
  const suaDuoc = { duoc: true } as const;

  it("case của mình, không có khách người khác ⇒ dời được", () => {
    expect(quyenDoiGioCase({ sua: suaDuoc, soHocVienNguoiKhac: 0 }).duoc).toBe(true);
  });

  it("[QC-05b] case của mình NHƯNG giữ khách Sale khác ⇒ KHÔNG dời giờ được", () => {
    // Cửa chuyển case và cửa huỷ case đã chặn đúng việc này; để cửa sửa mở là để chủ case
    // đổi giờ hẹn của khách người khác qua một lối vòng.
    const r = quyenDoiGioCase({ sua: suaDuoc, soHocVienNguoiKhac: 1 });
    expect(r.duoc).toBe(false);
    if (r.duoc) throw new Error("phải từ chối");
    expect(r.lyDo).toContain("1 học viên của Sale khác");
    // Nói rõ vế CÒN làm được — không để người dùng tưởng cả form bị khoá.
    expect(r.lyDo).toContain("phòng / giáo viên");
  });

  it("không sửa được case ⇒ trả NGUYÊN lý do của quyenSuaCase, không đẻ câu thứ hai", () => {
    const sua = quyenSuaCase({ nguoiTaoId: SALE_2, userId: SALE_1, laQuanLy: false });
    expect(quyenDoiGioCase({ sua, soHocVienNguoiKhac: 3 })).toEqual(sua);
  });
});

describe("[QC-06] chuyển case — cùng luật với gỡ, KHÁC câu chữ", () => {
  it("chủ lead chuyển được, Sale khác thì không", () => {
    expect(quyenChuyenCase({ lead: leadCuaSale2, userId: SALE_2, laQuanLy: false }).duoc).toBe(true);
    expect(quyenChuyenCase({ lead: leadCuaSale2, userId: SALE_1, laQuanLy: false }).duoc).toBe(false);
  });
  it("[QC-06b] câu lý do nói về CHUYỂN, không mượn câu \"gắn thêm được\" của nút gỡ", () => {
    const r = quyenChuyenCase({ lead: leadCuaSale2, userId: SALE_1, laQuanLy: false, tenSale: "Trần Thị B" });
    if (r.duoc) throw new Error("phải từ chối");
    expect(r.lyDo).toContain("Chuyển case");
    expect(r.lyDo).toContain("Trần Thị B");
    expect(r.lyDo).not.toContain("gắn thêm");
  });
});

describe("[QC-07] điểm danh / hoàn tất case — chủ dự án chốt 23/09: Sale KHÔNG làm thay Sale khác", () => {
  it("lớp theo khung: người mở case được, Sale khác KHÔNG", () => {
    expect(quyenDiemDanhCase({ theoKhung: true, nguoiTaoId: SALE_1, userId: SALE_1, laQuanLy: false }).duoc).toBe(true);
    const r = quyenDiemDanhCase({ theoKhung: true, nguoiTaoId: SALE_2, userId: SALE_1, laQuanLy: false });
    expect(r.duoc).toBe(false);
    if (r.duoc) throw new Error("phải từ chối");
    expect(r.lyDo).toContain("Sale khác mở");
  });
  it("Quản lý điểm danh được mọi case", () => {
    expect(quyenDiemDanhCase({ theoKhung: true, nguoiTaoId: SALE_2, userId: SALE_1, laQuanLy: true }).duoc).toBe(true);
  });
  it("[QC-07c] lớp CŨ giữ nguyên: mọi người có quyền điểm danh vẫn điểm danh được", () => {
    // Buổi của lớp cũ đều createdById = NULL. Áp luật "chỉ người tạo" ở đây là khoá
    // điểm danh của MỌI Sale trên toàn bộ lớp đang chạy trên prod.
    expect(quyenDiemDanhCase({ theoKhung: false, nguoiTaoId: null, userId: SALE_1, laQuanLy: false }).duoc).toBe(true);
    expect(quyenDiemDanhCase({ theoKhung: false, nguoiTaoId: SALE_2, userId: SALE_1, laQuanLy: false }).duoc).toBe(true);
  });
  it("case CŨ không rõ người mở ở lớp theo khung ⇒ chỉ Quản lý", () => {
    expect(quyenDiemDanhCase({ theoKhung: true, nguoiTaoId: null, userId: SALE_1, laQuanLy: false }).duoc).toBe(false);
  });
});
