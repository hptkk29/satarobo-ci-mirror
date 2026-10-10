// @vitest-environment jsdom
/**
 * KHUNG NHẬP EXCEL — màn PHÂN LOẠI ba nhóm + sửa tay từng dòng.
 *
 * ── BỘ NÀY CANH GÌ ───────────────────────────────────────────────────────────────────────
 * Không canh "có render ra chữ không". Canh bốn lời hứa mà màn này đưa ra, cả bốn đều hứa
 * suông được mà không ném lỗi, không làm đỏ test, console vẫn sạch (luật 12):
 *
 *  1. Con số trên ba nhóm ĐẾM ĐÚNG, và ba nhóm ấy PHỦ HẾT mọi dòng — không dòng nào rơi ra
 *     ngoài cả ba. Một dòng vô hình là một lead mất không ai biết.
 *  2. Nút Nhập đếm đúng số dòng THỰC SỰ được ghi, không phải số dòng đang nhìn thấy.
 *  3. Nút Sửa sửa được thật: dòng lỗi chữa xong phải TỰ CHUYỂN sang nhóm hợp lệ.
 *  4. Dòng trùng nói rõ hệ thống sắp làm gì với bản ghi cũ.
 *
 * ⚠️ Khung này dùng chung cho MƯỜI màn nhập, nên mọi ca ở đây phải đúng cho cả màn KHÔNG có
 * khái niệm trùng — có ca riêng canh việc đó.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ExcelImporter, ImportOutcome } from "./ExcelImporter";

afterEach(cleanup);

const COT = [
  { key: "Tên", label: "Tên", required: true },
  { key: "SĐT", label: "SĐT", required: true },
];

type Dong = Record<string, unknown>;

/**
 * Dựng khung với một tập dòng cho sẵn.
 *
 * `parseRow` coi dòng thiếu SĐT là lỗi — đủ để dựng ba nhóm mà không kéo theo tầng phân tích
 * thật của một màn cụ thể.
 */
function dung(opts: {
  dong: Dong[];
  coTrung?: boolean;
  gopTrung?: boolean;
  xacNhanTrung?: boolean;
  /**
   * Mọi dòng đều trùng với bản ghi ĐANG CÓ trong hệ thống.
   *
   * ⚠️ Khác hẳn trùng-trong-file: dòng ĐẦU TIÊN của một cặp trùng trong file vẫn là dòng hợp
   * lệ, nên trùng-trong-file không bao giờ dựng được ca "Hợp lệ = 0". Đúng ca prod 15/09
   * (file 146 dòng, 145 trùng với CRM) thì phải đi qua đường đối chiếu hệ thống.
   */
  trungHeThong?: boolean;
  /** Đổi dạng hiển thị cho cột SĐT (màn lead truyền `formatPhoneVN`). */
  hienThiSdt?: (v: unknown) => string;
  /** Bật cột "Đè" của nhóm Trùng (màn lead, chốt 16/09/2026). */
  coCotDe?: boolean;
  onImport?: (
    rows: unknown[],
    ctx?: { excelRowOf: number[]; confirmed: Set<number>; ghiDe: Set<number> },
  ) => Promise<{ success: number; errors: [] }>;
}) {
  const onImport =
    opts.onImport ?? (async () => ({ success: 0, errors: [] as [] }));
  return render(
    <ExcelImporter<Dong>
      templateUrl="/mau"
      templateFilename="mau.xlsx"
      columnHints={
        opts.hienThiSdt
          ? COT.map((c) => (c.key === "SĐT" ? { ...c, hienThi: opts.hienThiSdt } : c))
          : COT
      }
      parseRow={(r) => (r["SĐT"] ? (r as Dong) : { error: "Thiếu SĐT" })}
      onImport={onImport}
      duplicateKey={opts.coTrung ? (r) => String(r["SĐT"] ?? "") || null : undefined}
      duplicateLabel="SĐT"
      mergeDuplicates={opts.gopTrung ? { label: "Sẽ cập nhật bản ghi cũ" } : undefined}
      confirmDuplicates={opts.xacNhanTrung ? { label: "Xác nhận gộp" } : undefined}
      overwriteDuplicates={
        opts.coCotDe
          ? {
              label: "Đè",
              moTa: "Tick cột Đè để dòng đó ghi đè thông tin đang lưu.",
              chuKhiBat: "SẼ GHI ĐÈ thông tin đang lưu bằng dữ liệu dòng này.",
            }
          : undefined
      }
      checkExisting={
        opts.trungHeThong
          ? async (_raws, excelNos) =>
              new Map(excelNos.map((n) => [n, `SĐT đã có trong CRM — PH "Bản ghi cũ ${n}"`]))
          : undefined
      }
    />,
  );
}

/**
 * Nạp dòng vào khung.
 *
 * Khung đọc file bằng `xlsx` trong trình duyệt, nên bộ này thay tầng đó: mock `XLSX.read` +
 * `sheet_to_json` để trả đúng mảng dòng mình muốn, rồi bắn sự kiện `change` thật vào ô file.
 * Tức vẫn đi qua ĐÚNG đường mà người dùng đi (luật 9), chỉ thay cái đọc tệp nhị phân.
 */
vi.mock("xlsx", () => ({
  read: () => ({ SheetNames: ["S"], Sheets: { S: {} } }),
  utils: {
    sheet_to_json: () => (globalThis as { __dong?: Dong[] }).__dong ?? [],
  },
}));

async function napFile(dong: Dong[]) {
  (globalThis as { __dong?: Dong[] }).__dong = dong;
  const o = document.querySelector('input[type="file"]') as HTMLInputElement;
  const f = new File([new Uint8Array([1])], "thu.xlsx");
  Object.defineProperty(f, "arrayBuffer", { value: async () => new ArrayBuffer(1) });
  Object.defineProperty(o, "files", { value: [f], configurable: true });
  fireEvent.change(o);
  await screen.findByRole("tab", { name: /Hợp lệ/ });
}

const demNhom = (ten: RegExp) =>
  Number(screen.getByRole("tab", { name: ten }).textContent!.replace(/\D+/g, ""));

const nutNhap = () =>
  screen.getByRole("button", { name: /^Nhập \d+ dòng/ }).textContent!;

describe("[NHAP-T10] ba nhóm đếm đúng và PHỦ HẾT mọi dòng", () => {
  it("chia đúng hợp lệ / trùng / lỗi", async () => {
    dung({ coTrung: true, gopTrung: true, dong: [] });
    await napFile([
      { Tên: "A", "SĐT": "01" },
      { Tên: "B", "SĐT": "02" },
      { Tên: "C", "SĐT": "01" }, // trùng với dòng đầu
      { Tên: "D", "SĐT": "" }, // lỗi
    ]);
    expect(demNhom(/Hợp lệ/)).toBe(2);
    expect(demNhom(/Trùng/)).toBe(1);
    expect(demNhom(/Lỗi/)).toBe(1);
  });

  it("⚠️ tổng ba nhóm = tổng số dòng — không dòng nào rơi ra ngoài", async () => {
    // Một dòng không thuộc nhóm nào là một dòng VÔ HÌNH: người nhập không thấy nó ở đâu để
    // xử lý, và cũng không biết nó có được ghi hay không.
    dung({ coTrung: true, gopTrung: true, dong: [] });
    const ds = [
      { Tên: "A", "SĐT": "01" },
      { Tên: "B", "SĐT": "01" },
      { Tên: "C", "SĐT": "" },
      { Tên: "D", "SĐT": "04" },
      { Tên: "E", "SĐT": "" },
    ];
    await napFile(ds);
    expect(demNhom(/Hợp lệ/) + demNhom(/Trùng/) + demNhom(/Lỗi/)).toBe(ds.length);
  });

  it("màn KHÔNG có khái niệm trùng ⇒ nhóm Trùng rỗng, hai nhóm kia vẫn đủ", async () => {
    // Khung dùng chung cho 10 màn; 9 màn kia không khai `duplicateKey`.
    dung({ dong: [] });
    await napFile([
      { Tên: "A", "SĐT": "01" },
      { Tên: "B", "SĐT": "01" },
      { Tên: "C", "SĐT": "" },
    ]);
    expect(demNhom(/Trùng/)).toBe(0);
    expect(demNhom(/Hợp lệ/)).toBe(2);
    expect(demNhom(/Lỗi/)).toBe(1);
  });
});

describe("[NHAP-T11] nút Nhập đếm dòng SẼ GHI, không phải dòng đang nhìn", () => {
  it("trùng có xử lý ⇒ tính vào số sẽ ghi", async () => {
    dung({ coTrung: true, gopTrung: true, dong: [] });
    await napFile([
      { Tên: "A", "SĐT": "01" },
      { Tên: "B", "SĐT": "01" },
      { Tên: "C", "SĐT": "" },
    ]);
    expect(nutNhap()).toContain("2"); // 1 hợp lệ + 1 trùng sẽ cập nhật
  });

  it("⚠️ trùng CHƯA xác nhận ⇒ KHÔNG tính, dù nó nằm ở nhóm Trùng chứ không phải Lỗi", async () => {
    // Đây là chỗ hai câu hỏi tách nhau: "dòng này thuộc nhóm nào" khác "dòng này có được ghi
    // không". Gộp hai câu là lỗi của bản cũ — dòng chờ xác nhận bị xếp vào Lỗi nên người dùng
    // đi sửa file, trong khi việc cần làm chỉ là bấm một nút.
    dung({ coTrung: true, xacNhanTrung: true, dong: [] });
    await napFile([
      { Tên: "A", "SĐT": "01" },
      { Tên: "B", "SĐT": "01" },
    ]);
    expect(demNhom(/Trùng/)).toBe(1);
    expect(demNhom(/Lỗi/)).toBe(0);
    expect(nutNhap()).toContain("1");
  });

  it("bấm xác nhận ⇒ dòng đó được tính vào", async () => {
    dung({ coTrung: true, xacNhanTrung: true, dong: [] });
    await napFile([
      { Tên: "A", "SĐT": "01" },
      { Tên: "B", "SĐT": "01" },
    ]);
    fireEvent.click(screen.getByRole("tab", { name: /Trùng/ }));
    // `getAllBy*[0]`: jsdom dựng cả bảng lẫn thẻ nên mỗi nút có hai bản.
    fireEvent.click(screen.getAllByRole("button", { name: "Xác nhận gộp" })[0]!);
    expect(nutNhap()).toContain("2");
  });

  it("không dòng nào ghi được ⇒ nút Nhập KHOÁ", async () => {
    dung({ dong: [] });
    await napFile([{ Tên: "A", "SĐT": "" }]);
    expect(screen.getByRole("button", { name: /^Nhập 0 dòng/ })).toBeDisabled();
  });
});

describe("[NHAP-T12] ⚠️ SỬA TAY — sửa xong dòng phải TỰ CHUYỂN nhóm", () => {
  it("chữa dòng lỗi ⇒ sang nhóm hợp lệ và được tính vào lượt nhập", async () => {
    // Đây là lý do nút Sửa tồn tại: "đỡ mất công phải sửa excel rồi nhập lại". Nút mở được
    // form mà dòng không chuyển nhóm thì lời hứa đó là hứa suông.
    dung({ dong: [] });
    await napFile([{ Tên: "A", "SĐT": "" }]);
    expect(demNhom(/Lỗi/)).toBe(1);

    fireEvent.click(screen.getByRole("tab", { name: /Lỗi/ }));
    fireEvent.click(screen.getAllByRole("button", { name: /Sửa dòng 2/ })[0]!);

    const o = screen.getAllByLabelText(/SĐT/)[0] as HTMLInputElement;
    fireEvent.change(o, { target: { value: "0909" } });
    fireEvent.click(screen.getAllByRole("button", { name: /Lưu dòng/ })[0]!);

    expect(demNhom(/Lỗi/)).toBe(0);
    expect(demNhom(/Hợp lệ/)).toBe(1);
    expect(nutNhap()).toContain("1");
  });

  it("form sửa mở ra mang ĐÚNG giá trị đang có của dòng đó", async () => {
    // Form trống trơn thì người dùng phải gõ lại cả dòng — tệ hơn mở Excel.
    dung({ dong: [] });
    await napFile([{ Tên: "Nguyễn Văn A", "SĐT": "" }]);
    fireEvent.click(screen.getByRole("tab", { name: /Lỗi/ }));
    fireEvent.click(screen.getAllByRole("button", { name: /Sửa dòng 2/ })[0]!);
    expect((screen.getAllByLabelText(/Tên/)[0] as HTMLInputElement).value).toBe("Nguyễn Văn A");
  });

  it("huỷ sửa ⇒ không đổi gì", async () => {
    dung({ dong: [] });
    await napFile([{ Tên: "A", "SĐT": "" }]);
    fireEvent.click(screen.getByRole("tab", { name: /Lỗi/ }));
    fireEvent.click(screen.getAllByRole("button", { name: /Sửa dòng 2/ })[0]!);
    fireEvent.change(screen.getAllByLabelText(/SĐT/)[0]!, { target: { value: "0909" } });
    fireEvent.click(screen.getAllByRole("button", { name: /Huỷ sửa/ })[0]!);
    expect(demNhom(/Lỗi/)).toBe(1);
  });

  it("⚠️ sửa một dòng KHÔNG đụng dòng khác", async () => {
    // Ba mảng chạy song song (dòng thô · dòng đã phân tích · số dòng Excel); ghi lệch một
    // index là dữ liệu của dòng này nhảy sang dòng kia, và không gì kêu lên cả.
    dung({ dong: [] });
    await napFile([
      { Tên: "A", "SĐT": "" },
      { Tên: "B", "SĐT": "" },
    ]);
    fireEvent.click(screen.getByRole("tab", { name: /Lỗi/ }));
    fireEvent.click(screen.getAllByRole("button", { name: /Sửa dòng 3/ })[0]!);
    fireEvent.change(screen.getAllByLabelText(/SĐT/)[0]!, { target: { value: "0909" } });
    fireEvent.click(screen.getAllByRole("button", { name: /Lưu dòng/ })[0]!);

    expect(demNhom(/Lỗi/)).toBe(1);
    expect(demNhom(/Hợp lệ/)).toBe(1);

    // Nhóm Lỗi còn đúng DÒNG 2, và nó vẫn mang lý do cũ.
    // `getAllBy*`: jsdom không chạy media query nên CẢ HAI hình dạng (bảng + thẻ) cùng dựng;
    // mỗi dòng vì thế xuất hiện hai lần. Đó là điều đúng, không phải nhiễu cần bịt.
    expect(screen.getAllByText("Thiếu SĐT").length).toBeGreaterThan(0);
    const conLai = screen.getAllByRole("button", { name: /Sửa dòng \d+/ });
    expect(conLai.every((b) => b.getAttribute("aria-label")!.includes("dòng 2"))).toBe(true);

    // ⚠️ Đếm nhóm KHÔNG ĐỦ — phép cấy lỗi chứng minh: ghi giá trị mới vào chỉ số `i + 1`
    // thay vì `i` vẫn cho ra đúng 1 lỗi / 1 hợp lệ, vì con số chỉ đọc kết quả phân tích chứ
    // không đọc dữ liệu đang hiển thị. Phải soi GIÁ TRỊ THẬT đang bày ra.
    fireEvent.click(screen.getByRole("tab", { name: /Hợp lệ/ }));
    expect(screen.getAllByText("0909").length).toBeGreaterThan(0);
    expect(screen.getAllByText("B").length).toBeGreaterThan(0);
  });

  it("sửa xong vẫn giữ nguyên cột KHÔNG khai trong columnHints", async () => {
    // File thật hay có cột phụ người nhập tự thêm. Form chỉ sửa cột đã khai; làm mất các cột
    // kia là mất dữ liệu im lặng — server không bao giờ thấy chúng nữa.
    const daNhan: unknown[] = [];
    dung({
      dong: [],
      onImport: async (rows) => {
        daNhan.push(...rows);
        return { success: 0, errors: [] as [] };
      },
    });
    await napFile([{ Tên: "A", "SĐT": "", "Cột lạ": "giữ tôi lại" }]);
    fireEvent.click(screen.getByRole("tab", { name: /Lỗi/ }));
    fireEvent.click(screen.getAllByRole("button", { name: /Sửa dòng 2/ })[0]!);
    fireEvent.change(screen.getAllByLabelText(/SĐT/)[0]!, { target: { value: "0909" } });
    fireEvent.click(screen.getAllByRole("button", { name: /Lưu dòng/ })[0]!);
    fireEvent.click(screen.getByRole("button", { name: /^Nhập 1 dòng/ }));
    await screen.findByText(/Nhập file khác/);
    expect((daNhan[0] as Record<string, unknown>)["Cột lạ"]).toBe("giữ tôi lại");
  });
});

describe("[NHAP-T13] dòng trùng nói rõ hệ thống sắp làm gì", () => {
  it("hiện nhãn của `mergeDuplicates`, không phải một chữ 'trùng' trống rỗng", async () => {
    dung({ coTrung: true, gopTrung: true, dong: [] });
    await napFile([
      { Tên: "A", "SĐT": "01" },
      { Tên: "B", "SĐT": "01" },
    ]);
    fireEvent.click(screen.getByRole("tab", { name: /Trùng/ }));
    expect(screen.getAllByText(/Sẽ cập nhật bản ghi cũ/).length).toBeGreaterThan(0);
  });

  it("nói rõ trùng với DÒNG NÀO trong file", async () => {
    // Không chỉ ra dòng gốc thì người dùng phải tự dò cả file để biết bỏ dòng nào.
    dung({ coTrung: true, gopTrung: true, dong: [] });
    await napFile([
      { Tên: "A", "SĐT": "01" },
      { Tên: "B", "SĐT": "01" },
    ]);
    fireEvent.click(screen.getByRole("tab", { name: /Trùng/ }));
    expect(screen.getAllByText(/dòng 2 trong file/).length).toBeGreaterThan(0);
  });

  it("dòng SẴN SÀNG không có dòng lý do — không có gì để nói thì đừng chiếm chỗ", async () => {
    dung({ coTrung: true, gopTrung: true, dong: [] });
    await napFile([{ Tên: "A", "SĐT": "01" }]);
    // Cả hai hình dạng (bảng + thẻ) đều phải im — bản trước bảng bỏ mà thẻ vẫn in.
    expect(screen.queryAllByText(/Sẵn sàng nhập/)).toEqual([]);
  });
});

describe("[NHAP-T18] ba lỗi hiển thị thấy trên PROD 15/09/2026", () => {
  // Cả ba đều KHÔNG ném lỗi, KHÔNG làm đỏ test nào, console sạch — chỉ người mở màn ra nhìn
  // mới biết. Đúng lớp lỗi mà luật 12 nói tới, nên chúng cần ca riêng chứ không thể trông vào
  // các ca đếm ở trên.

  /** Hai ô GHIM của một dòng dữ liệu (số dòng bên trái, nút thao tác bên phải). */
  const oGhim = () => {
    const tr = [...document.querySelectorAll("tbody tr")].find((r) =>
      r.querySelector('button[aria-label^="Sửa dòng"]'),
    )!;
    const o = [...tr.children];
    return [o[0]!, o[o.length - 1]!].map((e) => e.className);
  };

  it("⚠️ ô ghim KHÔNG được mang `relative` — nó đè mất `sticky`", async () => {
    // `relative` và `sticky` cùng là thuộc tính `position`; cái nào đứng sau trong CSS sinh
    // ra sẽ thắng. Đã cấy đúng lỗi này ngày 15/09: cột SỬA mất ghim trong khi TIÊU ĐỀ vẫn
    // ghim, nên bảng trông như lệch hàng — và không gì kêu lên cả.
    dung({ dong: [] });
    await napFile([{ Tên: "A", "SĐT": "01" }]);
    for (const cls of oGhim()) {
      expect(cls, `ô ghim không được có \`relative\`: ${cls}`).not.toMatch(/\brelative\b/);
      expect(cls).toMatch(/\bsticky\b/);
    }
  });

  it("⚠️ dòng TRÙNG không tô nền cả loạt", async () => {
    // Tô cả nhóm "Trùng" là nói lại đúng thứ cái tab đã nói, VÀ làm hỏng cột ghim: token
    // `-soft` là rgba 12% còn ô ghim buộc phải đục ⇒ mỗi nút Sửa thành một hộp trắng nổi
    // trên nền kem (ảnh prod 15/09, file 146 dòng / 145 trùng).
    dung({ coTrung: true, gopTrung: true, dong: [] });
    await napFile([
      { Tên: "A", "SĐT": "01" },
      { Tên: "B", "SĐT": "01" },
    ]);
    fireEvent.click(screen.getByRole("tab", { name: /Trùng/ }));
    const tr = [...document.querySelectorAll("tbody tr")].find((r) =>
      r.querySelector('button[aria-label^="Sửa dòng"]'),
    )!;
    expect(tr.className).not.toMatch(/bg-state-/);
  });

  it("dòng SẼ BỊ BỎ vẫn được tô, và ô ghim mang ĐÚNG màu ấy", async () => {
    // Vế ngược của ca trên: bỏ nền hết thì dòng hỏng chìm lẫn vào dòng lành. Và ô ghim phải
    // đắp cùng màu, nếu không nó lại thành dải trắng — đúng lỗi vừa vá.
    dung({ dong: [] });
    await napFile([{ Tên: "A", "SĐT": "" }]);
    fireEvent.click(screen.getByRole("tab", { name: /Lỗi/ }));
    const tr = [...document.querySelectorAll("tbody tr")].find((r) =>
      r.querySelector('button[aria-label^="Sửa dòng"]'),
    )!;
    expect(tr.className).toMatch(/bg-state-danger-soft/);
    for (const cls of oGhim()) {
      expect(cls, `ô ghim phải đắp màu của dòng: ${cls}`).toMatch(
        /before:bg-state-danger-soft/,
      );
    }
  });

  it("⚠️ thẻ bảng phải có nền ĐỤC của riêng nó", async () => {
    // Đo 15/09 (lượt hai): cả chuỗi cha từ bảng lên tới `.admin-scope` đều TRONG SUỐT, nên
    // hàng không tô màu ăn nền xám `lab(96.52)` của khung admin, trong khi ô ghim buộc phải
    // đục nên ra `lab(100)` trắng tinh. Chênh 3,5 điểm sáng — đủ để thành một dải trắng lệch
    // chạy dọc bảng, và đó đúng là thứ chủ dự án chụp được trên prod SAU khi đã vá lượt một.
    //
    // Bản vá lượt một (đắp `::before` cho dòng CÓ tô màu) không chạm tới ca này, vì dòng
    // "trùng" và "hợp lệ" vốn không tô màu nào cả.
    dung({ dong: [] });
    await napFile([{ Tên: "A", "SĐT": "01" }]);
    const vo = document.querySelector("table")!.parentElement!.parentElement!;
    expect(vo.className, `vỏ bảng thiếu nền đục: ${vo.className}`).toMatch(/\bbg-background\b/);
  });

  it("⚠️ thanh hành động phải nằm TRÊN ô ghim của bảng", async () => {
    // Ô ghim và hàng tiêu đề mang `z-10`. Thanh dính đáy để `z-auto` thì mọi ô ghim chồng lên
    // nó đều VẼ ĐÈ LÊN TRÊN — chủ dự án chụp được đúng cảnh đó: danh sách 145 dòng che mất nút
    // "Nhập". Vỏ bảng không tạo ngữ cảnh xếp lớp riêng (chỉ `overflow`), nên `z-10` của ô ghim
    // leo thẳng lên gốc và so trực tiếp với thanh.
    //
    // So QUAN HỆ, không neo vào con số: đổi 10→30 ở ô ghim mà quên thanh thì ca này vẫn đỏ.
    dung({ dong: [] });
    await napFile([{ Tên: "A", "SĐT": "01" }]);

    const lopZ = (cls: string) => {
      const m = /(?:^|\s)z-(\d+)(?:\s|$)/.exec(cls);
      return m ? Number(m[1]) : 0;
    };
    const thanh = [...document.querySelectorAll("div")].find((d) =>
      d.className.includes("sticky bottom-0"),
    )!;
    const oGhim = document.querySelector('tbody td[class*="sticky"]')!;
    const thGhim = document.querySelector('thead th[class*="sticky"]')!;

    expect(thanh, "không tìm thấy thanh hành động dính đáy").toBeTruthy();
    expect(
      lopZ(thanh.className),
      `thanh (z=${lopZ(thanh.className)}) phải cao hơn ô ghim (z=${lopZ(oGhim.className)})`,
    ).toBeGreaterThan(lopZ(oGhim.className));
    expect(lopZ(thanh.className)).toBeGreaterThan(lopZ(thGhim.className));
  });

  it("thẻ ở màn hẹp cũng có nền riêng", async () => {
    // Cùng lý do: thẻ không nền là một mảng xám trên nền xám, mất hẳn hình dạng thẻ.
    dung({ dong: [] });
    await napFile([{ Tên: "A", "SĐT": "01" }]);
    const the = document.querySelector('ul[class*="hidden"] > li > div');
    expect(the?.className ?? "").toMatch(/\bbg-background\b/);
  });

  it("nền hàng TIÊU ĐỀ và nền ô ghim của nó phải cùng một lớp màu", async () => {
    // Đo 15/09: hàng là `bg-muted/60`, ô ghim là `bg-muted` — hai sắc độ khác nhau tạo một
    // vệt sáng chạy dọc qua tiêu đề. Ô ghim không được dùng màu trong suốt, nên hàng nhượng bộ.
    dung({ dong: [] });
    await napFile([{ Tên: "A", "SĐT": "01" }]);
    const hTr = document.querySelector("thead tr")!;
    const hTh = [...hTr.children];
    expect(hTr.className).toMatch(/bg-muted(?!\/)/);
    expect(hTr.className).not.toMatch(/bg-muted\//);
    for (const e of [hTh[0]!, hTh[hTh.length - 1]!]) {
      expect(e.className).toMatch(/bg-muted(?!\/)/);
    }
  });

  it("nhóm Hợp lệ rỗng mà VẪN có dòng sẽ ghi ⇒ nói đúng điều đó", async () => {
    // Ảnh prod: "Hợp lệ 0" + câu "Xử lý nhóm Lỗi và Trùng trước đã", trong khi 145 dòng trùng
    // vẫn sẽ được nhập. Câu đó bảo người dùng đi xử lý thứ không cần xử lý.
    dung({ coTrung: true, gopTrung: true, trungHeThong: true, dong: [] });
    await napFile([
      { Tên: "A", "SĐT": "01" },
      { Tên: "B", "SĐT": "02" },
    ]);
    await screen.findByText(/sẽ được cập nhật/);
    expect(demNhom(/Hợp lệ/)).toBe(0);
    expect(demNhom(/Trùng/)).toBe(2);
    expect(nutNhap()).toContain("2"); // vẫn ghi được
    fireEvent.click(screen.getByRole("tab", { name: /Hợp lệ/ }));
    expect(screen.getByText(/sẽ được cập nhật/)).toBeTruthy();
    expect(screen.queryByText(/Xử lý nhóm Lỗi và Trùng trước đã/)).toBeNull();
  });

  it("không ghi được dòng nào ⇒ MỚI bảo đi xử lý nhóm khác", async () => {
    // Vế ngược: vá quá tay thì câu đúng ở ca trên lại nuốt mất câu đúng ở ca này.
    dung({ dong: [] });
    await napFile([{ Tên: "A", "SĐT": "" }]);
    fireEvent.click(screen.getByRole("tab", { name: /Hợp lệ/ }));
    expect(screen.getByText(/Xử lý nhóm Lỗi và Trùng trước đã/)).toBeTruthy();
  });

  it("⚠️ trùng TRONG FILE nói khác trùng với HỆ THỐNG", async () => {
    // Ảnh prod in ra "Sẽ cập nhật lead đang có — Trùng SĐT với dòng 4 trong file": đúng một
    // nửa, mà nửa sai lại là nửa đáng sợ hơn (nó hứa ghi đè một bản ghi thật).
    dung({ coTrung: true, gopTrung: true, dong: [] });
    await napFile([
      { Tên: "A", "SĐT": "01" },
      { Tên: "B", "SĐT": "01" },
    ]);
    fireEvent.click(screen.getByRole("tab", { name: /Trùng/ }));
    expect(screen.getAllByText(/hai dòng sẽ gộp làm một/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/Sẽ cập nhật bản ghi cũ — Trùng/)).toEqual([]);
  });

  it("không chỉ người dùng tới một CỘT không còn tồn tại", async () => {
    // Bảng không còn cột "Tình trạng" từ khi lý do chuyển xuống dòng riêng. Câu hướng dẫn vẫn
    // bảo "Đọc kỹ cột Tình trạng" — chỉ dẫn trỏ vào thứ không có trên màn hình.
    dung({ coTrung: true, gopTrung: true, dong: [] });
    await napFile([
      { Tên: "A", "SĐT": "01" },
      { Tên: "B", "SĐT": "01" },
    ]);
    fireEvent.click(screen.getByRole("tab", { name: /Trùng/ }));
    expect(screen.queryByText(/cột Tình trạng/)).toBeNull();
    // Và tiêu đề cột đó cũng không được quay lại.
    expect(screen.queryAllByRole("columnheader", { name: /Tình trạng/ })).toEqual([]);
  });
});

describe("[NHAP-T19] cột có thể đổi DẠNG HIỂN THỊ", () => {
  // Sinh ra cho cột SĐT: file có thể ghi `84987654321`, `+84 987 654 321` hay `987654321`
  // (Excel lưu kiểu number nên nuốt mất số 0 đầu). Cả ba là CÙNG một số với hệ thống, nhưng
  // bày nguyên văn thì người nhập không đối chiếu được với danh bạ của họ.
  //
  // ⚠️ Ca này sinh ra vì phép cấy lỗi: gỡ hẳn phép đổi dạng mà KHÔNG ca nào đỏ — tính năng
  // được thêm vào nhưng chưa từng có gì canh.
  const sangSoNoiDia = (v: unknown) => {
    const s = String(v ?? "").replace(/\D/g, "");
    return s.startsWith("84") ? `0${s.slice(2)}` : s;
  };

  it("bày ra dạng đã đổi, KHÔNG phải nguyên văn trong file", async () => {
    dung({ dong: [], hienThiSdt: sangSoNoiDia });
    await napFile([{ Tên: "A", "SĐT": "84987654321" }]);
    expect(screen.getAllByText("0987654321").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("84987654321")).toEqual([]);
  });

  it("giá trị GỐC vẫn đọc lại được — không giấu gì", async () => {
    // Đổi dạng hiển thị mà không cho đường nào xem lại nguyên văn là giấu dữ liệu: người
    // nhập mất cách đối chiếu với file của chính họ.
    // ⚠️ Phải tự dựng lại — `afterEach(cleanup)` đã xoá DOM của ca trước. Bản đầu của ca này
    // đọc DOM còn sót và vì thế không kiểm được gì.
    dung({ dong: [], hienThiSdt: sangSoNoiDia });
    await napFile([{ Tên: "A", "SĐT": "84987654321" }]);
    const o = [...document.querySelectorAll("td")].find((e) =>
      e.getAttribute("title")?.includes("84987654321"),
    );
    expect(o, "phải có ô mang giá trị gốc ở tooltip").toBeTruthy();
  });

  it("cột KHÔNG khai đổi dạng thì giữ nguyên văn", async () => {
    // Chỉ cột SĐT có `hienThi`; cột Tên phải đi qua nguyên vẹn.
    dung({ dong: [], hienThiSdt: sangSoNoiDia });
    await napFile([{ Tên: "84000000000", "SĐT": "0909" }]);
    // Giá trị của cột Tên trông y hệt một SĐT dạng 84 — nếu phép đổi dạng áp nhầm cho mọi
    // cột thì nó thành "0000000000" và ca này đỏ.
    expect(screen.getAllByText("84000000000").length).toBeGreaterThan(0);
  });

  it("màn KHÔNG khai `hienThi` ⇒ bày nguyên văn", async () => {
    dung({ dong: [] });
    await napFile([{ Tên: "A", "SĐT": "84987654321" }]);
    expect(screen.getAllByText("84987654321").length).toBeGreaterThan(0);
  });
});

describe("[NHAP-T14] nhóm rỗng nói VÌ SAO rỗng", () => {
  it("không dòng lỗi ⇒ nói thẳng là file sạch", async () => {
    dung({ dong: [] });
    await napFile([{ Tên: "A", "SĐT": "01" }]);
    fireEvent.click(screen.getByRole("tab", { name: /Lỗi/ }));
    expect(screen.getByText(/Không dòng nào lỗi/)).toBeTruthy();
  });

  it("mỗi nhóm rỗng có câu RIÊNG, không dùng chung một câu 'không có dữ liệu'", async () => {
    dung({ coTrung: true, gopTrung: true, dong: [] });
    await napFile([{ Tên: "A", "SĐT": "01" }]);
    fireEvent.click(screen.getByRole("tab", { name: /Trùng/ }));
    const trung = screen.getByText(/toàn bản ghi mới/).textContent;
    fireEvent.click(screen.getByRole("tab", { name: /Lỗi/ }));
    const loi = screen.getByText(/Không dòng nào lỗi/).textContent;
    expect(trung).not.toBe(loi);
  });
});

describe("[NHAP-T15] bộ lọc đi được bằng bàn phím", () => {
  it("mũi tên phải chuyển sang nhóm kế", async () => {
    // Thiếu phím mũi tên thì Tab nhảy thẳng qua cả cụm và người dùng bàn phím không đổi nhóm
    // được — ba nhóm trở thành một nhóm.
    dung({ dong: [] });
    await napFile([{ Tên: "A", "SĐT": "01" }]);
    const tabHopLe = screen.getByRole("tab", { name: /Hợp lệ/ });
    expect(tabHopLe.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tabHopLe, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /Trùng/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("mũi tên trái từ nhóm đầu vòng về nhóm cuối", async () => {
    dung({ dong: [] });
    await napFile([{ Tên: "A", "SĐT": "01" }]);
    fireEvent.keyDown(screen.getByRole("tab", { name: /Hợp lệ/ }), { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: /Lỗi/ }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("[NHAP-T16] kết quả sau khi ghi tách 'tạo mới' với 'cập nhật'", () => {
  it("đếm riêng hai con số", async () => {
    // Gộp chung là người nhập không biết file của mình vừa tạo bao nhiêu lead mới và ghi đè
    // bao nhiêu lead cũ — mà đó đúng là câu hỏi họ lo nhất ở màn ghi đè.
    dung({
      dong: [],
      onImport: async () => ({ success: 3, updated: 2, errors: [] }) as never,
    });
    await napFile([{ Tên: "A", "SĐT": "01" }]);
    fireEvent.click(screen.getByRole("button", { name: /^Nhập 1 dòng/ }));
    const the = await screen.findByText("Cập nhật");
    expect(within(the.parentElement!).getByText("2")).toBeTruthy();
    expect(within(screen.getByText("Tạo mới").parentElement!).getByText("3")).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// BẢNG KẾT QUẢ — ba ca dưới đây có TRƯỚC đợt thiết kế lại 15/09/2026 và được giữ nguyên ý
// nghĩa. Chúng khoá một sự cố prod thật, không phải một sở thích trình bày.
//
// Ca thật 03/08/2026: nhập 37 lead CS2 → 6 tạo mới, 28 dòng trùng đã có sẵn. Màn cũ báo
// "Thành công: 6 | Lỗi: 28" dù KHÔNG dòng nào hỏng ⇒ người nhập tưởng thất bại và nhập lại,
// nhân đôi dữ liệu. Cách đếm bị khoá lại từ đó.
//
// ⚠️ Phép khẳng định đổi theo mã mới (bảng đếm thay cho câu tổng kết một dòng), nhưng BẤT
// BIẾN thì y nguyên: dòng "ℹ️" là ghi chú, tuyệt đối không được đếm là lỗi.
// ─────────────────────────────────────────────────────────────────────────────────────────

const noop = () => {};

/** Số trên thẻ đếm mang nhãn `nhan`. */
const demThe = (nhan: string) =>
  within(screen.getByText(nhan).parentElement!).getByText(/^\d+$/).textContent;

describe("[NHAP-T17] bảng kết quả: ghi chú KHÔNG phải lỗi", () => {
  it("28 dòng ℹ️ ⇒ thẻ Lỗi vẫn là 0", () => {
    render(
      <ImportOutcome
        result={{
          success: 6,
          errors: Array.from({ length: 28 }, (_, i) => ({
            row: 0,
            error: `ℹ️ SĐT 090500000${i}: con đã có sẵn trong lead — không thêm gì`,
          })),
        }}
        onReset={noop}
      />,
    );
    expect(demThe("Tạo mới")).toBe("6");
    expect(demThe("Lỗi")).toBe("0");
    expect(screen.getByText(/Không dòng nào lỗi/)).toBeTruthy();
    expect(screen.getByText(/Ghi chú \(28\)/)).toBeTruthy();
  });

  it("lỗi thật vẫn hiện đỏ và tách khỏi ghi chú", () => {
    render(
      <ImportOutcome
        result={{
          success: 1,
          errors: [
            { row: 5, error: 'SĐT không hợp lệ: "12345"' },
            { row: 0, error: "ℹ️ Đã thêm 2 con vào lead có sẵn cùng SĐT" },
          ],
        }}
        onReset={noop}
      />,
    );
    expect(screen.getByText(/SĐT không hợp lệ/)).toBeTruthy();
    expect(screen.getByText(/dòng KHÔNG được ghi/)).toBeTruthy();
    expect(screen.getByText(/Ghi chú \(1\)/)).toBeTruthy();
    expect(demThe("Lỗi")).toBe("1");
  });

  it("không lỗi, không ghi chú ⇒ chỉ báo thành công", () => {
    render(<ImportOutcome result={{ success: 3, errors: [] }} onReset={noop} />);
    expect(screen.queryByText(/Ghi chú/)).toBeNull();
    expect(demThe("Tạo mới")).toBe("3");
  });

  it("không có bản ghi nào được cập nhật ⇒ KHÔNG hiện thẻ 'Cập nhật' trống", () => {
    // Màn nhập nào không có khái niệm ghi đè thì đừng bày ra một con số 0 vô nghĩa.
    render(<ImportOutcome result={{ success: 3, errors: [] }} onReset={noop} />);
    expect(screen.queryByText("Cập nhật")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// CẢNH BÁO ≠ LỖI ≠ GHI CHÚ (nguon-dyn-fix-excel, 10/10/2026)
//
// Ba thứ khác hẳn nhau trong một lượt nhập: LỖI (dòng KHÔNG vào được), CẢNH BÁO (dòng ĐÃ vào,
// nhưng có việc người nhập phải xem — vd mã NV giới thiệu sai ⇒ lead không có người giới thiệu ⇒
// hoa hồng không đi đúng người), GHI CHÚ (hệ thống đã tự xử lý, không cần làm gì). Trước đợt này
// cảnh báo đi chung mảng `errors` với tiền tố "⚠️" mà bảng kết quả chỉ biết tiền tố "ℹ️", nên
// nhập 10 dòng mà 3 mã NV sai ra "Tạo mới 10 | Lỗi 3 | 3 dòng KHÔNG được ghi" — trong khi cả 10
// lead đã được tạo (cùng kiểu sự cố 03/08). Cảnh báo nay có KÊNH RIÊNG: `result.warnings`.
// ─────────────────────────────────────────────────────────────────────────────────────────

describe("[NHAP-T20] cảnh báo có kênh riêng — không bị đếm là lỗi", () => {
  const BA_CANH_BAO = [
    { row: 3, error: "Mã NV giới thiệu: mã không tồn tại." },
    { row: 5, error: "Mã NV giới thiệu: nhân sự đã nghỉ." },
    { row: 9, error: "Mã NV giới thiệu: nhiều nhân viên cùng mã." },
  ];

  it("nhập 10 dòng, 3 mã NV sai ⇒ Tạo mới 10 · Lỗi 0 · Cảnh báo 3 · KHÔNG có hộp 'KHÔNG được ghi'", () => {
    render(<ImportOutcome result={{ success: 10, errors: [], warnings: BA_CANH_BAO }} onReset={noop} />);
    expect(demThe("Tạo mới")).toBe("10");
    expect(demThe("Lỗi")).toBe("0");
    expect(demThe("Cảnh báo")).toBe("3");
    expect(screen.queryByText(/KHÔNG được ghi/)).toBeNull();
    expect(screen.getByText(/Không dòng nào lỗi/)).toBeTruthy();
    // Mỗi cảnh báo hiện ra kèm số dòng, và nói thẳng là dòng ĐÃ ghi.
    expect(screen.getByText(/3 cảnh báo/).textContent).toMatch(/đã được ghi/);
    expect(screen.getByText("Mã NV giới thiệu: nhân sự đã nghỉ.")).toBeTruthy();
    expect(screen.getByText("Dòng 5")).toBeTruthy();
  });

  it("cảnh báo KHÔNG nằm trong hộp ghi chú 'không cần làm gì' (nó cần người xem)", () => {
    render(
      <ImportOutcome
        result={{
          success: 2,
          errors: [{ row: 0, error: "ℹ️ Đã thêm 1 con vào lead có sẵn cùng SĐT" }],
          warnings: [BA_CANH_BAO[0]!],
        }}
        onReset={noop}
      />,
    );
    const ghiChu = screen.getByText(/Ghi chú \(1\)/).closest("details")!;
    expect(ghiChu.textContent).not.toMatch(/Mã NV giới thiệu/);
    expect(ghiChu.textContent).toMatch(/Đã thêm 1 con/);
  });

  it("đối chứng: lỗi THẬT vẫn là lỗi dù có cảnh báo cùng lượt; cảnh báo không làm mất hộp đỏ", () => {
    render(
      <ImportOutcome
        result={{
          success: 4,
          errors: [{ row: 7, error: 'SĐT không hợp lệ: "12345"' }],
          warnings: BA_CANH_BAO,
        }}
        onReset={noop}
      />,
    );
    expect(demThe("Lỗi")).toBe("1");
    expect(demThe("Cảnh báo")).toBe("3");
    expect(screen.getByText(/1 dòng KHÔNG được ghi/)).toBeTruthy();
    expect(screen.queryByText(/Không dòng nào lỗi/)).toBeNull();
  });

  it("cảnh báo mức cả file (row 0) không in 'Dòng 0'; không có cảnh báo ⇒ không có thẻ Cảnh báo (màn nhập khác không đổi)", () => {
    render(
      <ImportOutcome
        result={{ success: 1, errors: [], warnings: [{ row: 0, error: "Cột Mã NV giới thiệu không được áp dụng." }] }}
        onReset={noop}
      />,
    );
    expect(screen.queryByText(/Dòng 0/)).toBeNull();
    cleanup();
    render(<ImportOutcome result={{ success: 3, errors: [] }} onReset={noop} />);
    expect(screen.queryByText("Cảnh báo")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// CỘT "ĐÈ" — tuỳ chọn ghi đè cho riêng nhóm Trùng (chốt 16/09/2026)
// ─────────────────────────────────────────────────────────────────────────────────────────

/** Ô tick "Đè" của một dòng cụ thể trong BẢNG (bản thẻ có nhãn chữ nên tìm bằng tên khác). */
const oDe = (soDong: number) =>
  screen.getByRole("checkbox", { name: `Đè dòng ${soDong}` }) as HTMLInputElement;

/**
 * Ô "tick tất cả".
 *
 * ⚠️ CÓ HAI BẢN cùng tên đọc được: một ở hàng tiêu đề bảng (từ `md`), một ở trên danh sách
 * thẻ (dưới `md`). Cùng câu chữ là CỐ Ý — hai bản làm đúng một việc, đặt tên khác nhau mới
 * là nói dối. jsdom không chạy media query nên cả hai cùng dựng; lấy theo thứ tự DOM, đúng
 * nếp `getAllBy*[0]` của bộ này.
 */
const oDeTatCaBang = () =>
  screen.getAllByRole("checkbox", { name: /^Đè tất cả \d+ dòng trùng$/ })[0] as HTMLInputElement;
const oDeTatCaThe = () =>
  screen.getAllByRole("checkbox", { name: /^Đè tất cả \d+ dòng trùng$/ })[1] as HTMLInputElement;
const oDeTatCa = oDeTatCaBang;

const sangTabTrung = () => fireEvent.click(screen.getByRole("tab", { name: /Trùng/ }));

describe("[NHAP-T20] cột Đè chỉ có mặt ở đúng chỗ nó có nghĩa", () => {
  it("⚠️ KHÔNG có cột Đè khi màn không khai `overwriteDuplicates`", async () => {
    // Tệp này dùng chung cho 10 màn nhập. Mặc định phải là KHÔNG CÓ GÌ ĐỔI.
    dung({ dong: [{ Tên: "A", SĐT: "1" }], coTrung: true, gopTrung: true, trungHeThong: true });
    await napFile([{ Tên: "A", SĐT: "1" }]);
    sangTabTrung();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("⚠️ KHÔNG có cột Đè ở tab Hợp lệ — ở đó không có bản ghi cũ nào để đè", async () => {
    // Một ô tick ở tab Hợp lệ là lời hứa suông: bấm vào không có tác dụng gì, và không gì
    // báo cho người bấm biết (luật 12).
    dung({
      dong: [{ Tên: "A", SĐT: "1" }],
      coTrung: true,
      gopTrung: true,
      coCotDe: true,
    });
    await napFile([{ Tên: "A", SĐT: "1" }]);
    // Đang đứng ở tab Hợp lệ (mặc định) — dòng này không trùng gì cả.
    expect(demNhom(/Hợp lệ/)).toBe(1);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("có cột Đè ở tab Trùng, kèm ô tick ở HÀNG TIÊU ĐỀ", async () => {
    dung({
      dong: [],
      coTrung: true,
      gopTrung: true,
      trungHeThong: true,
      coCotDe: true,
    });
    await napFile([
      { Tên: "A", SĐT: "1" },
      { Tên: "B", SĐT: "2" },
    ]);
    sangTabTrung();
    expect(oDeTatCaBang()).toBeTruthy();
    expect(oDe(2)).toBeTruthy();
    expect(oDe(3)).toBeTruthy();
  });

  it("⚠️ màn NHỎ cũng phải có ô tick tất cả", async () => {
    // Đo 16/09 ở 320–640px: bảng không dựng nên ô ở hàng tiêu đề KHÔNG tồn tại. Thiếu bản
    // này là file 145 dòng trùng phải tick tay 145 lần trên điện thoại — đúng việc mà ô
    // "tick tất cả" sinh ra để khỏi phải làm.
    dung({ dong: [], coTrung: true, gopTrung: true, trungHeThong: true, coCotDe: true });
    await napFile([
      { Tên: "A", SĐT: "1" },
      { Tên: "B", SĐT: "2" },
    ]);
    sangTabTrung();
    // Bản cho màn nhỏ phải MANG NHÃN CHỮ — một ô vuông trơ trọi trên điện thoại là câu đố.
    expect(screen.getByText("Đè tất cả 2 dòng trùng")).toBeTruthy();
    expect(oDeTatCaThe()).toBeTruthy();
    // Và nó điều khiển CÙNG một tập với ô ở hàng tiêu đề, không phải một tập riêng.
    fireEvent.click(oDeTatCaThe());
    expect(oDe(2).checked).toBe(true);
    expect(oDe(3).checked).toBe(true);
    expect(oDeTatCaBang().checked).toBe(true);
    // ⚠️ Và CHÍNH NÓ phải sáng lên theo.
    //
    // Bản đầu của ca này dừng ở ba dòng trên: cấy lỗi `checked={false}` (ô màn nhỏ không
    // bao giờ sáng) mà bộ vẫn XANH, vì `onChange` vẫn chạy nên mọi thứ khác đúng hết. Đó
    // đúng là lớp lỗi luật 12 nói tới: ô tick vẫn hoạt động, chỉ là nó NÓI DỐI về trạng
    // thái của mình — người dùng bấm xong thấy ô trống, tưởng chưa ăn, bấm lại lần nữa.
    expect(oDeTatCaThe().checked).toBe(true);
    expect(oDeTatCaThe().indeterminate).toBe(false);
    // Bỏ một dòng ⇒ cả hai ô cùng chuyển sang LỬNG.
    fireEvent.click(oDe(2));
    expect(oDeTatCaThe().checked).toBe(false);
    expect(oDeTatCaThe().indeterminate).toBe(true);
  });

  it("⚠️ dòng LỖI không có ô tick — dòng đó còn không được ghi", async () => {
    dung({ dong: [], coTrung: true, gopTrung: true, trungHeThong: true, coCotDe: true });
    await napFile([{ Tên: "A", SĐT: "1" }, { Tên: "B" }]);
    fireEvent.click(screen.getByRole("tab", { name: /Lỗi/ }));
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

describe("[NHAP-T21] ô tick ở hàng tiêu đề bật cho CẢ NHÓM", () => {
  const bonDong = [
    { Tên: "A", SĐT: "1" },
    { Tên: "B", SĐT: "2" },
    { Tên: "C", SĐT: "3" },
    { Tên: "D", SĐT: "4" },
  ];

  it("bấm một lần ⇒ mọi dòng trùng đều được tick", async () => {
    dung({ dong: [], coTrung: true, gopTrung: true, trungHeThong: true, coCotDe: true });
    await napFile(bonDong);
    sangTabTrung();
    fireEvent.click(oDeTatCa());
    for (const d of [2, 3, 4, 5]) expect(oDe(d).checked).toBe(true);
  });

  it("bấm lần nữa ⇒ bỏ tick hết", async () => {
    dung({ dong: [], coTrung: true, gopTrung: true, trungHeThong: true, coCotDe: true });
    await napFile(bonDong);
    sangTabTrung();
    fireEvent.click(oDeTatCa());
    fireEvent.click(oDeTatCa());
    for (const d of [2, 3, 4, 5]) expect(oDe(d).checked).toBe(false);
  });

  it("⚠️ tick VÀI dòng ⇒ ô tiêu đề ở trạng thái LỬNG, không phải đã-tick-hết", async () => {
    // Vẽ nó như đã tick hết là nói dối đúng lúc người dùng cần biết mình đã ra lệnh cho
    // bao nhiêu dòng — và lệnh ở đây là ghi đè dữ liệu thật.
    dung({ dong: [], coTrung: true, gopTrung: true, trungHeThong: true, coCotDe: true });
    await napFile(bonDong);
    sangTabTrung();
    fireEvent.click(oDe(2));
    expect(oDeTatCa().checked).toBe(false);
    expect(oDeTatCa().indeterminate).toBe(true);
  });

  it("tick đủ từng dòng ⇒ ô tiêu đề tự sáng, hết lửng", async () => {
    dung({ dong: [], coTrung: true, gopTrung: true, trungHeThong: true, coCotDe: true });
    await napFile(bonDong);
    sangTabTrung();
    for (const d of [2, 3, 4, 5]) fireEvent.click(oDe(d));
    expect(oDeTatCa().checked).toBe(true);
    expect(oDeTatCa().indeterminate).toBe(false);
  });

  it("⚠️ đếm ra CON SỐ THẬT đang bị đè, không để người dùng tự đoán", async () => {
    dung({ dong: [], coTrung: true, gopTrung: true, trungHeThong: true, coCotDe: true });
    await napFile(bonDong);
    sangTabTrung();
    expect(screen.getByText(/Chưa tick dòng nào/)).toBeTruthy();
    fireEvent.click(oDe(2));
    fireEvent.click(oDe(3));
    expect(screen.getByText(/Đang đè 2\/4 dòng trùng/)).toBeTruthy();
  });
});

describe("[NHAP-T22] ⚠️ dòng đã tick phải NÓI ĐÚNG việc sắp xảy ra", () => {
  it("chưa tick ⇒ vẫn là câu gộp mặc định", async () => {
    dung({ dong: [], coTrung: true, gopTrung: true, trungHeThong: true, coCotDe: true });
    await napFile([{ Tên: "A", SĐT: "1" }]);
    sangTabTrung();
    expect(screen.getAllByText(/Sẽ cập nhật bản ghi cũ/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/SẼ GHI ĐÈ/)).toBeNull();
  });

  it("tick rồi ⇒ câu đổi thành cảnh báo ghi đè", async () => {
    // Câu mặc định của màn lead hứa nguyên văn "chỉ điền những ô đang để trống". Để nguyên
    // câu đó cạnh một ô tick đang bật là màn hình nói ngược với việc nó sắp làm.
    dung({ dong: [], coTrung: true, gopTrung: true, trungHeThong: true, coCotDe: true });
    await napFile([{ Tên: "A", SĐT: "1" }]);
    sangTabTrung();
    fireEvent.click(oDe(2));
    expect(screen.getAllByText(/SẼ GHI ĐÈ thông tin đang lưu/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Sẽ cập nhật bản ghi cũ —/)).toBeNull();
  });

  it("bỏ tick ⇒ câu quay lại như cũ", async () => {
    dung({ dong: [], coTrung: true, gopTrung: true, trungHeThong: true, coCotDe: true });
    await napFile([{ Tên: "A", SĐT: "1" }]);
    sangTabTrung();
    fireEvent.click(oDe(2));
    fireEvent.click(oDe(2));
    expect(screen.queryByText(/SẼ GHI ĐÈ/)).toBeNull();
    expect(screen.getAllByText(/Sẽ cập nhật bản ghi cũ/).length).toBeGreaterThan(0);
  });
});

describe("[NHAP-T23] ⚠️ lệnh ghi đè phải ĐI TỚI NƠI, đúng dòng", () => {
  it("gửi kèm `ctx.ghiDe` đúng những dòng đã tick", async () => {
    // Đây là ca then chốt: tick ở màn hình mà không tới được `onImport` thì mọi ca giao
    // diện phía trên chỉ chứng minh một ô vuông biết đổi màu.
    let batDuoc: Set<number> | null = null;
    dung({
      dong: [],
      coTrung: true,
      gopTrung: true,
      trungHeThong: true,
      coCotDe: true,
      onImport: async (_rows, ctx) => {
        batDuoc = ctx?.ghiDe ?? null;
        return { success: 0, errors: [] as [] };
      },
    });
    await napFile([
      { Tên: "A", SĐT: "1" },
      { Tên: "B", SĐT: "2" },
      { Tên: "C", SĐT: "3" },
    ]);
    sangTabTrung();
    fireEvent.click(oDe(2));
    fireEvent.click(oDe(4));
    fireEvent.click(screen.getByRole("button", { name: /^Nhập \d+ dòng/ }));
    await screen.findByText(/Nhập xong|Đang nhập/);
    expect(batDuoc).not.toBeNull();
    expect([...(batDuoc as unknown as Set<number>)].sort()).toEqual([2, 4]);
  });

  it("⚠️ không tick gì ⇒ gửi tập RỖNG, không phải `undefined`", async () => {
    // Trang gọi đọc `ctx.ghiDe.has(...)`. Gửi `undefined` là ném lỗi giữa lượt nhập.
    let batDuoc: Set<number> | null = null;
    dung({
      dong: [],
      coTrung: true,
      gopTrung: true,
      trungHeThong: true,
      coCotDe: true,
      onImport: async (_rows, ctx) => {
        batDuoc = ctx?.ghiDe ?? null;
        return { success: 0, errors: [] as [] };
      },
    });
    await napFile([{ Tên: "A", SĐT: "1" }]);
    fireEvent.click(screen.getByRole("button", { name: /^Nhập \d+ dòng/ }));
    await screen.findByText(/Nhập xong|Đang nhập/);
    expect(batDuoc).toBeInstanceOf(Set);
    expect((batDuoc as unknown as Set<number>).size).toBe(0);
  });

  it("⚠️ SỬA một dòng thì BỎ luôn tick của nó", async () => {
    // Người dùng sửa SĐT chính là để dòng trỏ sang chỗ khác. Giữ lại cái tick là đè lên
    // đúng một bản ghi không liên quan — hỏng theo kiểu không khôi phục được.
    dung({ dong: [], coTrung: true, gopTrung: true, trungHeThong: true, coCotDe: true });
    await napFile([
      { Tên: "A", SĐT: "1" },
      { Tên: "B", SĐT: "2" },
    ]);
    sangTabTrung();
    fireEvent.click(oDe(2));
    fireEvent.click(oDe(3));
    expect(oDe(2).checked).toBe(true);
    fireEvent.click(screen.getAllByRole("button", { name: /Sửa dòng 2/ })[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: /Lưu dòng/ })[0]!);
    // ⚠️ PHẢI `findBy` (chờ) chứ không `queryBy` (hỏi ngay).
    //
    // Lưu xong, `luuDongDaSua` xoá dấu trùng của dòng đó NGAY rồi mới hỏi lại server —
    // nên có một nhịp dòng 2 rời khỏi nhóm Trùng và ô tick biến mất. Bản đầu của ca này
    // viết `queryBy` + `if (con)`: cấy lại lỗi (giữ nguyên tick khi sửa) mà nó vẫn XANH,
    // vì `con` là null nên không có khẳng định nào chạy. Đúng nghĩa xanh giả — một ca
    // trông như đang canh mà thực ra không chạm tới thứ nó nói.
    const con = (await screen.findByRole("checkbox", {
      name: "Đè dòng 2",
    })) as HTMLInputElement;
    expect(con.checked).toBe(false);
    // Và dòng KHÔNG bị sửa thì tick của nó phải còn nguyên — nếu không thì "bỏ tick" chỉ
    // là một cách nói khác của "xoá sạch mọi tick", và người dùng mất cả 144 dòng kia.
    expect(oDe(3).checked).toBe(true);
  });
});

describe("[NHAP-T24] ⚠️ lượt nhập HỎNG phải nói RÕ vì sao, ngay tại chỗ", () => {
  // Ảnh chụp prod 16/09/2026: hộp thoại in đúng một câu "Nhập thất bại: Nhập thất bại"
  // rồi biến mất khi bấm OK. Ba cái sai cùng lúc: chữ không chọn được nên không gửi được
  // cho ai, hộp thoại chặn cả trang, và đóng xong là mất luôn.

  it("hiện lý do ngay trên màn, KHÔNG dùng hộp thoại", async () => {
    const goiAlert = vi.fn();
    const alertCu = globalThis.alert;
    globalThis.alert = goiAlert as unknown as typeof globalThis.alert;
    try {
      dung({
        dong: [],
        onImport: async () => {
          throw new Error("Lỗi ghi: Transaction already closed");
        },
      });
      await napFile([{ "Tên": "A", "SĐT": "1" }]);
      fireEvent.click(screen.getByRole("button", { name: /^Nhập \d+ dòng/ }));
      const bao = await screen.findByRole("alert");
      expect(bao.textContent).toContain("Lỗi ghi: Transaction already closed");
      // ⚠️ `alert()` chặn cả trang và nuốt chữ — không được dùng cho lỗi này nữa.
      expect(goiAlert).not.toHaveBeenCalled();
    } finally {
      globalThis.alert = alertCu;
    }
  });

  it("⚠️ danh sách dòng KHÔNG bị mất — sửa rồi bấm lại, không phải chọn file lại", async () => {
    const alertCu = globalThis.alert;
    globalThis.alert = (() => {}) as unknown as typeof globalThis.alert;
    try {
      dung({
        dong: [],
        onImport: async () => {
          throw new Error("hopng");
        },
      });
      await napFile([
        { "Tên": "A", "SĐT": "1" },
        { "Tên": "B", "SĐT": "2" },
      ]);
      fireEvent.click(screen.getByRole("button", { name: /^Nhập \d+ dòng/ }));
      await screen.findByRole("alert");
      expect(demNhom(/Hợp lệ/)).toBe(2);
      expect(nutNhap()).toContain("Nhập 2 dòng");
    } finally {
      globalThis.alert = alertCu;
    }
  });

  it("⚠️ lượt thứ hai hỏng KHÁC lý do ⇒ hiện lý do MỚI", async () => {
    // Ca đầu tiên viết ở đây là "lượt hai THÀNH CÔNG thì lỗi cũ biến mất" — cấy lại lỗi
    // (bỏ `setLoiNhap(null)`) mà nó vẫn XANH. Đúng: thành công thì màn kết quả thay cả
    // khung, panel lỗi không được dựng nữa dù state còn hay không. Tức ca đó canh một thứ
    // KHÔNG QUAN SÁT ĐƯỢC — xanh vĩnh viễn, trông y hệt một ca đang làm việc.
    //
    // Thứ quan sát được, và thực sự nguy hiểm: lượt hai hỏng vì lý do khác mà màn hình
    // vẫn in lý do cũ ⇒ người dùng đi sửa nhầm chỗ.
    let lan = 0;
    dung({
      dong: [],
      onImport: async () => {
        lan += 1;
        throw new Error(lan === 1 ? "Lý do CŨ 12345" : "Lý do MỚI 67890");
      },
    });
    await napFile([{ "Tên": "A", "SĐT": "1" }]);
    fireEvent.click(screen.getByRole("button", { name: /^Nhập \d+ dòng/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("Lý do CŨ 12345");
    fireEvent.click(screen.getByRole("button", { name: /^Nhập \d+ dòng/ }));
    await screen.findByText(/Lý do MỚI 67890/);
    expect(screen.queryByText(/Lý do CŨ 12345/)).toBeNull();
  });
});
