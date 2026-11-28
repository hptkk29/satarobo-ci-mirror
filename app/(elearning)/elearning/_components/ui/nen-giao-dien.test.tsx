// @vitest-environment jsdom
/**
 * [EL-UI-*] Thành phần nền P0 của khu e-learning: danh sách hai hình dạng, chú thích màu, tab theo URL, thanh chọn nhiều,
 * thanh tiến độ "dầm". Khẳng định HÀNH VI trên DOM thật (không ghim văn bản mã nguồn).
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { phanLoaiCotDienThoai } from "@/lib/elearning/cot-dien-thoai";
import { nhomMauCuaTrangThai } from "@/lib/elearning/nhom-mau-trang-thai";
import { DanhSachDuLieu, type CotDuLieu } from "./danh-sach-du-lieu";
import { ChamTrangThai, ChuThichTrangThai } from "./trang-thai-nhom";
import { TabNav } from "./tab-nav";
import { ThanhChonNhieu } from "./thanh-chon-nhieu";
import { useChonNhieu } from "./use-chon-nhieu";
import { TienDoDam, TOI_DA_LO_DAM } from "./tien-do";
import { KHUON_TRANG_THAI, TrangThaiDacBiet, type KieuTrangThai } from "./trang-thai-dac-biet";

afterEach(cleanup);

type Khoa = { id: string; ten: string; han: string; tt: string; nhom: "on" | "tre-loi" | "da-duyet" };
const HANG: Khoa[] = [
  { id: "1", ten: "An toàn thông tin", han: "20/11", tt: "Đang học", nhom: "on" },
  { id: "2", ten: "Quy trình tuyển sinh", han: "01/11", tt: "Quá hạn", nhom: "tre-loi" },
  { id: "3", ten: "Giao tiếp phụ huynh", han: "—", tt: "Đã xong", nhom: "da-duyet" },
];
const COT: CotDuLieu<Khoa>[] = [
  { id: "ten", nhan: "Khoá", hien: (h) => h.ten, dienThoai: "tieu-de" },
  { id: "han", nhan: "Hạn", hien: (h) => h.han, dienThoai: "thong-tin" },
  { id: "tt", nhan: "Trạng thái", hien: (h) => h.tt, dienThoai: "thong-tin" },
  { id: "act", nhan: "Thao tác", hien: (h) => <button type="button">Mở {h.id}</button>, thaoTac: true },
];

function dung() {
  return render(
    <DanhSachDuLieu
      hang={HANG}
      khoa={(h) => h.id}
      cot={COT}
      nhomMau={(h) => h.nhom}
      nhanTrangThai={(h) => h.tt}
      tenDonVi="khoá"
      nhanDanhSach="Khoá của tôi"
      trong={<p>Chưa có khoá nào</p>}
    />,
  );
}

describe("[EL-UI-01] DanhSachDuLieu — MỘT định nghĩa cột, HAI hình dạng", () => {
  it("có cả bảng (có tiêu đề cột) lẫn danh sách gọn trong cùng một cây — CSS quyết định hình nào hiện", () => {
    dung();
    const bang = screen.getByRole("table", { name: "Khoá của tôi" });
    expect(within(bang).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Khoá", "Hạn", "Trạng thái", "Thao tác"]);
    const ds = screen.getByRole("list", { name: "Khoá của tôi" });
    expect(within(ds).getAllByRole("listitem")).toHaveLength(3);
  });

  it("dòng gọn: tiêu đề + đúng các thông tin đã khai + thao tác; KHÔNG đổ cột 'an' ra", () => {
    dung();
    const dong = within(screen.getByRole("list", { name: "Khoá của tôi" })).getAllByRole("listitem")[1];
    expect(dong.textContent).toContain("Quy trình tuyển sinh");
    expect(dong.textContent).toContain("Hạn");
    expect(dong.textContent).toContain("01/11");
    expect(within(dong).getByRole("button", { name: "Mở 2" })).toBeTruthy();
  });

  it("màu KHÔNG đứng một mình: chấm ở dòng gọn luôn kèm nhãn chữ cho trình đọc màn hình", () => {
    dung();
    const dong = within(screen.getByRole("list", { name: "Khoá của tôi" })).getAllByRole("listitem")[1];
    const sr = dong.querySelector(".sr-only");
    expect(sr?.textContent).toBe("Quá hạn");
  });

  it("chú thích màu chỉ liệt kê các nhóm CÓ MẶT (3 nhóm), đúng thứ tự chuẩn", () => {
    dung();
    const thich = screen.getByRole("list", { name: "Chú thích màu trạng thái" });
    expect(within(thich).getAllByRole("listitem").map((l) => l.textContent)).toEqual(["Ổn", "Trễ hoặc lỗi", "Đã duyệt"]);
  });

  it("không có dòng ⇒ hiện `trong`, không dựng bảng rỗng", () => {
    render(
      <DanhSachDuLieu
        hang={[] as Khoa[]}
        khoa={(h) => h.id}
        cot={COT}
        nhomMau={(h) => h.nhom}
        nhanTrangThai={(h) => h.tt}
        tenDonVi="khoá"
        nhanDanhSach="Khoá của tôi"
        trong={<p>Chưa có khoá nào</p>}
      />,
    );
    expect(screen.getByText("Chưa có khoá nào")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("khai báo cột sai (thiếu tiêu đề / quá nhiều thông tin) ⇒ ném lỗi rõ ràng, không cắt âm thầm", () => {
    const khongTieuDe = COT.map((c) => ({ ...c, dienThoai: c.dienThoai === "tieu-de" ? ("an" as const) : c.dienThoai }));
    expect(() => phanLoaiCotDienThoai(khongTieuDe)).toThrow(/ĐÚNG 1 cột tiêu đề/);
    const nam = [
      ...COT,
      ...["a", "b", "c"].map((id) => ({ id, nhan: id, hien: () => id, dienThoai: "thong-tin" as const })),
    ];
    expect(() => phanLoaiCotDienThoai(nam)).toThrow(/2–4 cột thông tin/);
    const mot = COT.filter((c) => c.id !== "tt");
    expect(() => phanLoaiCotDienThoai(mot)).toThrow(/2–4 cột thông tin/);
  });
});

describe("[EL-UI-02] ChamTrangThai / ChuThichTrangThai", () => {
  it("ChamTrangThai luôn có chữ", () => {
    render(<ChamTrangThai nhom={nhomMauCuaTrangThai("TrnEnrollmentStatus", "OVERDUE")} nhan="Quá hạn" />);
    expect(screen.getByText("Quá hạn")).toBeTruthy();
  });
  it("chú thích rỗng khi không có dòng nào", () => {
    const { container } = render(<ChuThichTrangThai cac={[]} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("[EL-UI-03] TabNav — mỗi tab là một liên kết thật", () => {
  const TAB = [
    { id: "can-lam", nhan: "Cần làm", dem: 3 },
    { id: "qua-han", nhan: "Quá hạn" },
  ];
  it("href mang ?tab=, giữ tham số lọc, bỏ page; tab đang mở có aria-current", () => {
    render(<TabNav duongDan="/elearning/khoa-cua-toi" tab={TAB} dangMo="qua-han" giuLai={{ q: "robot", page: "4" }} nhanDanhSach="Khoá của tôi" />);
    const a = screen.getByRole("link", { name: /Cần làm/ });
    expect(a.getAttribute("href")).toBe("/elearning/khoa-cua-toi?tab=can-lam&q=robot");
    expect(a.getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Quá hạn" }).getAttribute("aria-current")).toBe("page");
  });
  it("số đếm hiện cạnh nhãn khi có", () => {
    render(<TabNav duongDan="/x" tab={TAB} dangMo="can-lam" nhanDanhSach="Tab" />);
    expect(screen.getByRole("link", { name: /Cần làm/ }).textContent).toContain("3");
  });
});

describe("[EL-UI-04] ThanhChonNhieu + useChonNhieu", () => {
  const IDS = ["a", "b", "c"];
  function Thu({ tran }: { tran?: number }) {
    const chon = useChonNhieu(IDS, tran);
    return (
      <div>
        <ThanhChonNhieu chon={chon} tenDonVi="người học">
          <button type="button">Gửi nhắc</button>
        </ThanhChonNhieu>
        {IDS.map((id) => (
          <button key={id} type="button" onClick={() => chon.doi(id)}>{`dong-${id}`}</button>
        ))}
        <span data-testid="id-gui">{chon.idGui.join(",")}</span>
      </div>
    );
  }

  it("chưa chọn ⇒ nói 'Chưa chọn', KHÔNG hiện nút thao tác hàng loạt", () => {
    render(<Thu />);
    expect(screen.getByRole("status").textContent).toBe("Chưa chọn người học nào");
    expect(screen.queryByRole("button", { name: "Gửi nhắc" })).toBeNull();
  });

  it("chọn một dòng ⇒ 'Đã chọn 1', hiện thao tác, ô chọn tất cả ở trạng thái 'một phần'", () => {
    render(<Thu />);
    fireEvent.click(screen.getByRole("button", { name: "dong-b" }));
    expect(screen.getByRole("status").textContent).toBe("Đã chọn 1 người học");
    expect(screen.getByRole("button", { name: "Gửi nhắc" })).toBeTruthy();
    expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("mixed");
    expect(screen.getByTestId("id-gui").textContent).toBe("b");
  });

  it("'Chọn tất cả' chọn hết dòng đang hiển thị; bấm lần nữa bỏ hết; 'Bỏ chọn' xoá tập", () => {
    render(<Thu />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByTestId("id-gui").textContent).toBe("a,b,c");
    expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByTestId("id-gui").textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "dong-a" }));
    fireEvent.click(screen.getByRole("button", { name: "Bỏ chọn" }));
    expect(screen.getByTestId("id-gui").textContent).toBe("");
  });

  it("chạm trần ⇒ báo lý do bằng chữ (role=alert), không chọn quá trần", () => {
    render(<Thu tran={2} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByTestId("id-gui").textContent).toBe("a,b");
    expect(screen.getByRole("alert").textContent).toContain("tối đa 2");
  });

  it("hook: dòng rời khỏi danh sách hiển thị KHÔNG đi theo idGui", () => {
    const { result, rerender } = renderHook(({ ids }: { ids: string[] }) => useChonNhieu(ids), { initialProps: { ids: ["a", "b"] } });
    act(() => result.current.doi("a"));
    act(() => result.current.doi("b"));
    expect(result.current.idGui).toEqual(["a", "b"]);
    rerender({ ids: ["b"] });
    expect(result.current.idGui).toEqual(["b"]);
    expect(result.current.soDangChon).toBe(1);
  });
});

describe("[EL-UI-05] TienDoDam", () => {
  it("progressbar theo SỐ BÀI, nhãn đọc được, lỗ đầy/hiện tại/rỗng đúng chỗ", () => {
    const { container } = render(<TienDoDam tong={5} xong={2} dangHoc={2} nhan="Khoá An toàn" />);
    const bar = screen.getByRole("progressbar", { name: "Tiến độ Khoá An toàn" });
    expect(bar.getAttribute("aria-valuenow")).toBe("2");
    expect(bar.getAttribute("aria-valuemax")).toBe("5");
    expect(bar.getAttribute("aria-valuetext")).toBe("2 trên 5 bài");
    const lo = Array.from(container.querySelectorAll("[data-lo]")).map((e) => e.getAttribute("data-lo"));
    expect(lo).toEqual(["day", "day", "hien-tai", "rong", "rong"]);
  });

  it("xong vượt tổng bị kẹp về tổng; tổng 0 ⇒ không vẽ gì", () => {
    const { container } = render(<TienDoDam tong={3} xong={9} nhan="x" />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("3");
    cleanup();
    const r = render(<TienDoDam tong={0} xong={0} nhan="x" />);
    expect(r.container.innerHTML).toBe("");
    expect(container).toBeTruthy();
  });

  it("quá nhiều bài ⇒ rơi về thanh % thường, vẫn là progressbar", () => {
    const { container } = render(<TienDoDam tong={TOI_DA_LO_DAM + 1} xong={5} nhan="Dài" />);
    expect(container.querySelectorAll("[data-lo]")).toHaveLength(0);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuemax")).toBe("100");
  });
});

describe("[EL-UI-06] TrangThaiDacBiet — mỗi kiểu nói rõ bước tiếp theo", () => {
  const TAT_CA = Object.keys(KHUON_TRANG_THAI) as KieuTrangThai[];

  it.each(TAT_CA)("%s: có đúng một tiêu đề chữ và một câu giải thích", (kieu) => {
    render(<TrangThaiDacBiet kieu={kieu} />);
    const h = screen.getByRole("heading", { level: 2 });
    expect(h.textContent).toBe(KHUON_TRANG_THAI[kieu].tieuDe);
    expect(KHUON_TRANG_THAI[kieu].moTa.length).toBeGreaterThan(20);
  });

  it("lỗi tải là role=alert (đọc ngay); các kiểu khác là status", () => {
    render(<TrangThaiDacBiet kieu="loi-tai" />);
    expect(screen.getByRole("alert")).toBeTruthy();
    cleanup();
    render(<TrangThaiDacBiet kieu="chua-duoc-giao" />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("KHÔNG tự vẽ nút: không truyền hanhDong thì không có liên kết/nút nào (không hứa suông)", () => {
    render(<TrangThaiDacBiet kieu="qua-han" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("hành động do chỗ gọi truyền được vẽ nguyên vẹn; mô tả cụ thể ghi đè mặc định", () => {
    render(
      <TrangThaiDacBiet
        kieu="thieu-quyen"
        moTa="Mục Mức gắn đánh giá cần quyền của phòng Nhân sự."
        hanhDong={<a href="/elearning/dao-tao">Về tổng quan</a>}
      />,
    );
    expect(screen.getByRole("link", { name: "Về tổng quan" }).getAttribute("href")).toBe("/elearning/dao-tao");
    expect(screen.getByText("Mục Mức gắn đánh giá cần quyền của phòng Nhân sự.")).toBeTruthy();
  });
});
