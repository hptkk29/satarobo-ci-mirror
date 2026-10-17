// @vitest-environment jsdom
/**
 * Màn Tra cứu — ô tìm + chip danh mục (thiết kế lại 22/09/2026).
 *
 * Bộ này canh đúng những thứ làm nên GIÁ TRỊ của bản thiết kế mới, chứ không canh
 * class CSS:
 *   1. gõ không dấu vẫn ra kết quả có dấu — Sale gõ nhanh, không bỏ dấu;
 *   2. số trên chip là SỐ KẾT QUẢ THẬT của từng danh mục, không phải tổng cố định —
 *      đó là thứ duy nhất cho người dùng biết "có, nhưng nằm ở tab kia";
 *   3. tìm không ra thì trang phải chỉ sang nơi CÓ, thay vì để người ta kết luận
 *      "hệ thống không có mặt hàng này";
 *   4. rỗng-vì-chưa-có-dữ-liệu và rỗng-vì-tìm-không-ra là HAI câu khác nhau.
 *
 * `đ` có test riêng: `normalize("NFD")` KHÔNG tách được nó (nó là một ký tự Unicode
 * riêng, không phải `d` + dấu), nên thiếu dòng thay `đ` là gõ "do choi" không ra
 * "Đồ chơi" — lỗi câm, không ai báo.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { boDau } from "@/lib/ui/bo-dau";
import { TraCuuWorkspace, type KhoiTraCuu } from "./tra-cuu-workspace";

const kho = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => kho.get(k) ?? null,
    setItem: (k: string, v: string) => void kho.set(k, v),
    removeItem: (k: string) => void kho.delete(k),
    clear: () => kho.clear(),
  },
});
beforeEach(() => kho.clear());

function khoi(): KhoiTraCuu[] {
  return [
    {
      ma: "khoa",
      nhan: "Khoá học",
      donVi: "khoá",
      khiRong: "Chưa có khoá nào đang mở bán.",
      cot: [{ ten: "Khoá học", rong: true }, { ten: "Mã" }, { ten: "Giá", phai: true }],
      dong: [
        { key: "k1", tim: boDau("Luyện thi RoboSim LTRS"), o: ["Luyện thi RoboSim", "LTRS", "3.500.000"] },
        { key: "k2", tim: boDau("Lập trình Robot Sata 3 LTR3"), o: ["Lập trình Robot Sata 3", "LTR3", "5.200.000"] },
      ],
    },
    {
      ma: "lop",
      nhan: "Lớp đang mở",
      donVi: "lớp",
      khiRong: "Cơ sở của bạn chưa có lớp nào đang mở.",
      cot: [{ ten: "Lớp" }, { ten: "Còn chỗ", phai: true }],
      dong: [
        {
          key: "l1",
          tim: boDau("S3-01 Lập trình Robot Sata 3 Nguyễn Hữu Thọ"),
          o: ["S3-01", { t: "4/12", pill: "success" }],
        },
        {
          key: "l2",
          tim: boDau("S3-02 Lập trình Robot Sata 3 Hoàng Diệu"),
          mo: true,
          o: ["S3-02", { t: "hết chỗ", pill: "muted" }],
        },
      ],
    },
    {
      ma: "hoc-cu",
      nhan: "Học cụ",
      donVi: "mặt hàng",
      khiRong: "Chưa có học cụ nào đang bán.",
      luuY: "Không hiện tồn kho.",
      cot: [{ ten: "Tên", rong: true }, { ten: "Giá bán", phai: true }],
      dong: [{ key: "h1", tim: boDau("Đồ chơi lắp ghép DC-01"), o: ["Đồ chơi lắp ghép", "180.000"] }],
    },
  ];
}

function oTim() {
  return screen.getByLabelText("Tìm trong danh mục");
}

/** Số in trên chip của một danh mục. */
function soTrenChip(nhan: string): string {
  const chip = screen.getByRole("tab", { name: new RegExp(`^${nhan}`) });
  return chip.textContent?.replace(nhan, "").trim() ?? "";
}

describe("Tra cứu · bỏ dấu", () => {
  it("tách được dấu phụ thường", () => {
    expect(boDau("Luyện thi RoboSim")).toBe("luyen thi robosim");
  });

  it("`đ` KHÔNG tự tách qua NFD — phải có dòng thay riêng", () => {
    expect(boDau("Đồ chơi")).toBe("do choi");
    // Chứng minh chính cái bẫy: chỉ NFD thôi thì `đ` còn nguyên.
    expect("Đồ chơi".normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()).toContain("đ");
  });
});

describe("Tra cứu · ô tìm", () => {
  it("mở lên là thấy danh mục đầu tiên, đủ dòng", () => {
    render(<TraCuuWorkspace khoi={khoi()} />);
    expect(screen.getByText("Luyện thi RoboSim")).toBeTruthy();
    expect(screen.getByText("Lập trình Robot Sata 3")).toBeTruthy();
  });

  it("gõ KHÔNG DẤU vẫn ra dòng có dấu", () => {
    render(<TraCuuWorkspace khoi={khoi()} />);
    fireEvent.change(oTim(), { target: { value: "luyen thi" } });
    expect(screen.getByText("Luyện thi RoboSim")).toBeTruthy();
    expect(screen.queryByText("Lập trình Robot Sata 3")).toBeNull();
  });

  it("tìm được cả theo MÃ, không chỉ theo tên", () => {
    render(<TraCuuWorkspace khoi={khoi()} />);
    fireEvent.change(oTim(), { target: { value: "ltr3" } });
    expect(screen.getByText("Lập trình Robot Sata 3")).toBeTruthy();
    expect(screen.queryByText("Luyện thi RoboSim")).toBeNull();
  });

  it("nút xoá từ khoá trả lại đủ danh sách", () => {
    render(<TraCuuWorkspace khoi={khoi()} />);
    fireEvent.change(oTim(), { target: { value: "ltr3" } });
    fireEvent.click(screen.getByLabelText("Xoá từ khoá tìm"));
    expect(screen.getByText("Luyện thi RoboSim")).toBeTruthy();
  });
});

describe("Tra cứu · chip mang số kết quả thật", () => {
  it("chưa gõ gì thì chip đếm toàn bộ danh mục", () => {
    render(<TraCuuWorkspace khoi={khoi()} />);
    expect(soTrenChip("Khoá học")).toBe("2");
    expect(soTrenChip("Lớp đang mở")).toBe("2");
    expect(soTrenChip("Học cụ")).toBe("1");
  });

  it("gõ vào thì MỌI chip đếm lại — kể cả danh mục đang không mở", () => {
    render(<TraCuuWorkspace khoi={khoi()} />);
    fireEvent.change(oTim(), { target: { value: "sata 3" } });
    expect(soTrenChip("Khoá học")).toBe("1");
    expect(soTrenChip("Lớp đang mở")).toBe("2");
    expect(soTrenChip("Học cụ")).toBe("0");
  });

  it("bấm chip đổi bảng, giữ nguyên từ khoá đang gõ", () => {
    render(<TraCuuWorkspace khoi={khoi()} />);
    fireEvent.change(oTim(), { target: { value: "sata 3" } });
    fireEvent.click(screen.getByRole("tab", { name: /^Lớp đang mở/ }));
    expect(screen.getByText("S3-01")).toBeTruthy();
    expect(screen.getByText("S3-02")).toBeTruthy();
    expect((oTim() as HTMLInputElement).value).toBe("sata 3");
  });
});

describe("Tra cứu · rỗng nói đúng lý do", () => {
  it("tìm không ra ở tab này thì CHỈ SANG tab có kết quả", () => {
    render(<TraCuuWorkspace khoi={khoi()} />);
    fireEvent.change(oTim(), { target: { value: "do choi" } });
    // Đang ở "Khoá học" — không khớp gì.
    expect(screen.getByText(/Không có khoá nào khớp/)).toBeTruthy();
    const loi = screen.getByRole("button", { name: /^Học cụ \(1\)$/ });
    fireEvent.click(loi);
    expect(screen.getByText("Đồ chơi lắp ghép")).toBeTruthy();
  });

  it("không danh mục nào khớp thì nói thẳng, không chỉ bừa", () => {
    render(<TraCuuWorkspace khoi={khoi()} />);
    fireEvent.change(oTim(), { target: { value: "khong-he-co-thu-nay" } });
    expect(screen.getByText("Không danh mục nào khớp từ khoá này.")).toBeTruthy();
  });

  it("danh mục RỖNG TỪ ĐẦU dùng câu khác hẳn câu 'tìm không ra'", () => {
    // Một danh mục duy nhất, rỗng — không có chỗ nào để tự chuyển sang.
    const ds = [{ ...khoi()[0], dong: [] }];
    render(<TraCuuWorkspace khoi={ds} />);
    expect(screen.getByText("Chưa có khoá nào đang mở bán.")).toBeTruthy();
    expect(screen.queryByText(/khớp/)).toBeNull();
  });
});

describe("Tra cứu · chỉ một danh mục được xem", () => {
  it("một khối thì KHÔNG bày thanh chip — không có gì để chuyển", () => {
    render(<TraCuuWorkspace khoi={[khoi()[0]]} />);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByText("Luyện thi RoboSim")).toBeTruthy();
  });
});

describe("Tra cứu · mở ở danh mục CÓ dữ liệu", () => {
  it("danh mục đầu rỗng thì tự mở danh mục kế có hàng", () => {
    const ds = khoi();
    ds[0].dong = [];
    render(<TraCuuWorkspace khoi={ds} />);
    // Không đổ người dùng vào bảng rỗng khi bảng bên cạnh có hàng.
    expect(screen.getByText("S3-01")).toBeTruthy();
    expect(screen.queryByText("Chưa có khoá nào đang mở bán.")).toBeNull();
  });

  it("mọi danh mục đều rỗng thì vẫn mở cái đầu, nói rõ vì sao rỗng", () => {
    const ds = khoi().map((k) => ({ ...k, dong: [] }));
    render(<TraCuuWorkspace khoi={ds} />);
    expect(screen.getByText("Chưa có khoá nào đang mở bán.")).toBeTruthy();
  });
});
