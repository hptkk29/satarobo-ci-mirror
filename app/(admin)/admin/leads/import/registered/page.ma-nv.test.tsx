// @vitest-environment jsdom
/**
 * [IMP-REG-UI-*] — màn «Import danh sách ĐÃ ĐĂNG KÝ»: phần «Mã NV giới thiệu KHÔNG áp dụng» trên PHẦN TỬ THẬT (jsdom), fetch được giả.
 *
 *   [IMP-REG-UI-01] xem thử: mỗi dòng bị bỏ qua là MỘT mục danh sách (SĐT + lý do), không còn một đoạn nối bằng `; `; vắng ⇒ không có khối (đối chứng)
 *   [IMP-REG-UI-02] ghi thật: khối cảnh báo nằm NGOÀI dòng «Đã ghi» (không còn kẹp trong một span đậm), SĐT + lý do từng dòng; vắng ⇒ không có khối
 *   [IMP-REG-UI-03] hàng nút «Xem thử» / «Xác nhận ghi» cho phép xuống dòng (`flex-wrap`) — ở 375px hai nút không vừa một hàng và kéo trang cuộn ngang (đo bằng ảnh chụp 09/10/2026)
 *   [IMP-REG-UI-03b] nút ghi mang số liệu cho phép xuống dòng chữ (whitespace-normal · max-w-full · h-auto) — nhãn dài tràn khung 375px (ảnh 10/10/2026)
 *   [IMP-REG-UI-04] xem thử: thẻ Phụ huynh / Học viên in số SẼ GHI (trừ dòng bị chặn) + «file có N»; đối chứng dương không bị chặn ⇒ không in «file có»
 *   [IMP-REG-UI-05] xem thử: dòng bị chặn là BẢNG (SĐT · vì sao · chi tiết) — nguồn lạ · ngoài phạm vi · SĐT cơ sở khác
 *   [IMP-REG-UI-06] kết quả: bảng «không tạo» có lý do; lỗi hệ thống nguồn + nguồn TẮT ở khối cảnh báo riêng, ngoài thẻ «Đã ghi»
 *   [IMP-REG-UI-07] nút ghi nêu số lead thiếu quy nguồn khi có; không có thì không nêu
 *   [IMP-REG-UI-08] trang giải thích cột tuỳ chọn «Mã NV giới thiệu»
 *   [IMP-REG-UI-09] không dùng ký tự ✅ / ⚠ thay icon
 *   [IMP-REG-UI-10] nút ghi đếm số THẬT SẼ ĐỔI (tạo mới + gộp có thay đổi), không đếm phụ huynh gộp "không đổi"; tắt khi 0 (và không có hồ sơ HV để bổ sung)
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import ImportRegisteredLeadsPage from "./page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** `n` phụ huynh SẼ TẠO MỚI — số trên nút ghi đếm `seTao` + `seGop` có đổi, không đếm `phuHuynhSeGhi`. */
const TAO = (n: number) => Array.from({ length: n }, (_, i) => ({ sdt: `09070000${String(i).padStart(2, "0")}`, tenPH: "A", soCon: 1 }));
const BASE = {
  mode: "dry-run",
  tongDongDoc: 10,
  boQua: 0,
  hopLe: 10,
  gopTrongFile: 0,
  loi: [],
  phuHuynh: 5,
  hocVien: 5,
  seTao: TAO(5),
  seGop: [],
  salesKhongKhop: [],
  khoaKhongKhop: [],
  coSoKhongKhop: [],
};
const BO_QUA = [
  { sdt: "0907000010", lyDo: "mã không tồn tại" },
  { sdt: "0907000011", lyDo: "nhân sự đã nghỉ" },
  { sdt: "0907000012", lyDo: "SĐT đã có lead" },
];

function gia(data: (mode: string) => Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: { body?: FormData }) => {
      const mode = String(init?.body?.get("mode") ?? "dry-run");
      return { ok: true, status: 200, json: async () => ({ ok: true, data: data(mode) }) };
    }),
  );
}

async function chonFileVaXemThu() {
  const { container } = render(<ImportRegisteredLeadsPage />);
  const o = container.querySelector("input[type=file]") as HTMLInputElement;
  fireEvent.change(o, { target: { files: [new File(["x"], "dang-ky.xlsx")] } });
  fireEvent.click(screen.getByRole("button", { name: /Xem thử/ }));
  return container;
}

describe("[IMP-REG-UI] màn nhập danh sách đã đăng ký — Mã NV giới thiệu không áp dụng", () => {
  it("[IMP-REG-UI-01] xem thử: mỗi dòng bị bỏ qua là một mục (SĐT + lý do); không có dòng nào ⇒ không có khối", async () => {
    gia(() => ({ ...BASE, maNvGioiThieuBoQua: BO_QUA }));
    await chonFileVaXemThu();
    const khoi = await screen.findByTestId("ma-nv-bo-qua-xem-thu");
    const muc = within(khoi).getAllByRole("listitem");
    expect(muc).toHaveLength(3);
    expect(muc[1]!.textContent).toContain("0907000011");
    expect(muc[1]!.textContent).toContain("nhân sự đã nghỉ");
    expect(khoi.textContent).toContain("3");
    cleanup();

    gia(() => ({ ...BASE, maNvGioiThieuBoQua: [], salesKhongKhop: ["Ai đó"] }));
    await chonFileVaXemThu();
    await screen.findByText(/Sales không khớp user/);
    expect(screen.queryByTestId("ma-nv-bo-qua-xem-thu")).toBeNull();
  });

  it("[IMP-REG-UI-02] ghi thật: khối cảnh báo riêng, ngoài dòng «Đã ghi», liệt kê từng SĐT kèm lý do; vắng ⇒ không có khối", async () => {
    gia((mode) =>
      mode === "confirm"
        ? { ...BASE, mode, daTaoLead: 5, daTaoHocVien: 5, daGopLead: 0, khongDoi: 0, maNvGioiThieuBoQua: BO_QUA }
        : { ...BASE, maNvGioiThieuBoQua: BO_QUA },
    );
    await chonFileVaXemThu();
    await screen.findByTestId("ma-nv-bo-qua-xem-thu");
    fireEvent.click(screen.getByRole("button", { name: /Xác nhận ghi/ }));
    const khoi = await screen.findByTestId("ma-nv-bo-qua-ket-qua");
    const muc = within(khoi).getAllByRole("listitem");
    expect(muc.map((m) => m.textContent)).toEqual(["0907000010 — mã không tồn tại", "0907000011 — nhân sự đã nghỉ", "0907000012 — SĐT đã có lead"]);
    // khối nằm ngoài mọi `<span>` đậm của dòng kết quả (bản cũ nhét danh sách vào `<span class="font-semibold …">`)
    expect(khoi.closest("span.font-semibold")).toBeNull();
    expect(khoi.className).toContain("text-state-warning-ink");
    cleanup();

    gia((mode) => ({ ...BASE, mode, daTaoLead: 5, daTaoHocVien: 5, daGopLead: 0, khongDoi: 0 }));
    await chonFileVaXemThu();
    await waitFor(() => expect((screen.getByRole("button", { name: /Xác nhận ghi/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: /Xác nhận ghi/ }));
    await screen.findByText(/Đã ghi:/);
    expect(screen.queryByTestId("ma-nv-bo-qua-ket-qua")).toBeNull();
  });

  it("[IMP-REG-UI-03] hàng nút cho phép xuống dòng (flex-wrap), cả hai nút vẫn có mặt", () => {
    render(<ImportRegisteredLeadsPage />);
    const hang = screen.getByRole("button", { name: /Xem thử/ }).parentElement!;
    expect(hang.className).toContain("flex-wrap");
    expect(within(hang).getByRole("button", { name: /Xác nhận ghi/ })).toBeTruthy();
  });

  it("[IMP-REG-UI-03b] nút ghi mang số liệu nên cho phép xuống dòng chữ (không whitespace-nowrap) — ở 375px nhãn dài làm nút tràn khỏi thẻ", async () => {
    gia(() => ({ ...BASE, seTao: TAO(12), phuHuynhSeGhi: 12, nguonThieu: 3 }));
    await chonFileVaXemThu();
    const nut = await screen.findByRole("button", { name: /Xác nhận ghi 12 phụ huynh \(3 thiếu quy nguồn\)/ });
    expect(nut.className).toContain("whitespace-normal");
    expect(nut.className).toContain("max-w-full");
    expect(nut.className).toContain("h-auto");
  });

  // ── nguon-dyn-fix-excel (10/10/2026): số xem thử nói THẬT, kết quả sau ghi có cấu trúc ──────────────────────────────

  const CHAN = [
    { sdt: "0907000020", nhan: "Nguồn mới tinh", lyDo: "Nhãn nguồn không có trong danh sách của cơ sở này" },
    { sdt: "0907000021", nhan: "Zalo lạ", lyDo: "Nhãn nguồn không có trong danh sách của cơ sở này" },
  ];
  /** Số đọc được trên thẻ thống kê mang nhãn `nhan` (cả chữ gợi ý nếu có). */
  const theThongKe = (nhan: string) => screen.getByText(nhan).parentElement!.textContent ?? "";

  it("[IMP-REG-UI-04] xem thử: thẻ Phụ huynh / Học viên in số SẼ GHI (trừ dòng bị chặn) và nói file có bao nhiêu", async () => {
    // Cấy: lấy lại `preview.phuHuynh` / `preview.hocVien` làm số chính ⇒ màn in 5 / 7 trong khi chỉ 3 / 4 được tạo.
    gia(() => ({ ...BASE, phuHuynh: 5, hocVien: 7, phuHuynhSeGhi: 3, hocVienSeGhi: 4, nguonBiChan: CHAN }));
    await chonFileVaXemThu();
    await screen.findByText("Phụ huynh sẽ ghi");
    expect(theThongKe("Phụ huynh sẽ ghi")).toContain("3");
    expect(theThongKe("Phụ huynh sẽ ghi")).toMatch(/file có 5/);
    expect(theThongKe("Học viên sẽ ghi")).toContain("4");
    expect(theThongKe("Học viên sẽ ghi")).toMatch(/file có 7/);
    // "Máy tự lo" trừ từ số học viên SẼ GHI (4), không phải số trong file (7).
    expect(theThongKe("Máy tự lo")).toContain("4");
    expect(theThongKe("Máy tự lo")).not.toContain("7");
    cleanup();

    // Đối chứng dương: không dòng nào bị chặn ⇒ hai số bằng nhau, KHÔNG in "file có …" thừa.
    gia(() => ({ ...BASE, phuHuynh: 5, hocVien: 7, phuHuynhSeGhi: 5, hocVienSeGhi: 7 }));
    await chonFileVaXemThu();
    await screen.findByText("Phụ huynh sẽ ghi");
    expect(theThongKe("Phụ huynh sẽ ghi")).not.toMatch(/file có/);
    expect(theThongKe("Học viên sẽ ghi")).not.toMatch(/file có/);
  });

  it("[IMP-REG-UI-05] xem thử: dòng bị chặn là BẢNG (SĐT · vì sao · chi tiết), không phải mảng chữ nối dấu phẩy", async () => {
    gia(() => ({
      ...BASE,
      nguonBiChan: CHAN,
      ngoaiPhamVi: [{ sdt: "0907000030", tenPH: "A", coSo: "x" }],
      trungCoSoKhac: [{ sdt: "0907000031" }],
    }));
    await chonFileVaXemThu();
    const khoi = await screen.findByTestId("khong-tao-xem-thu");
    const hang = within(khoi).getAllByRole("row").slice(1); // bỏ hàng tiêu đề
    expect(hang).toHaveLength(4);
    const chu = hang.map((h) => h.textContent ?? "");
    expect(chu[0]).toContain("0907000020");
    expect(chu[0]).toContain("Nguồn mới tinh");
    expect(chu[0]).toContain("Nhãn nguồn không có trong danh sách");
    expect(chu.some((c) => c.includes("0907000030") && /ngoài phạm vi/i.test(c))).toBe(true);
    expect(chu.some((c) => c.includes("0907000031") && /cơ sở khác/i.test(c))).toBe(true);
    // Không còn đoạn chữ nối các SĐT bằng dấu phẩy.
    expect(khoi.textContent).not.toContain("0907000020, 0907000021");
  });

  it("[IMP-REG-UI-06] kết quả sau ghi: bảng 'không tạo' có LÝ DO; lỗi hệ thống nguồn + nguồn TẮT hiện ở khối cảnh báo riêng, ngoài thẻ 'Đã ghi'", async () => {
    const KQ = {
      ...BASE,
      phuHuynhSeGhi: 3,
      hocVienSeGhi: 3,
      nguonBiChan: CHAN,
      nguonThieu: 2,
      maNvGioiThieuTat: true,
      maNvGioiThieuBoQua: [],
    };
    gia((mode) => (mode === "confirm" ? { ...KQ, mode, daTaoLead: 3, daTaoHocVien: 3, daGopLead: 0, khongDoi: 0 } : KQ));
    await chonFileVaXemThu();
    await screen.findByTestId("khong-tao-xem-thu");
    fireEvent.click(screen.getByRole("button", { name: /Xác nhận ghi/ }));
    const bang = await screen.findByTestId("khong-tao-ket-qua");
    // Kết quả đã có bảng riêng ⇒ bảng/cảnh báo của XEM THỬ không lặp lại trên màn (hai bản cùng danh sách là nhiễu).
    expect(screen.queryByTestId("khong-tao-xem-thu")).toBeNull();
    expect(screen.queryByTestId("canh-bao-xem-thu")).toBeNull();
    const hang = within(bang).getAllByRole("row").slice(1);
    expect(hang).toHaveLength(2);
    expect(hang[1]!.textContent).toContain("0907000021");
    expect(hang[1]!.textContent).toContain("Zalo lạ");
    expect(hang[1]!.textContent).toContain("Nhãn nguồn không có trong danh sách");

    const canhBao = screen.getByTestId("canh-bao-ket-qua");
    expect(canhBao.textContent).toMatch(/2 lead/);
    expect(canhBao.textContent).toMatch(/quy nguồn/);
    expect(canhBao.textContent).toMatch(/Mã NV giới thiệu/);
    expect(canhBao.textContent).toMatch(/TẮT/);

    // Thẻ "Đã ghi" chỉ mang số thành công — không mang chữ lỗi/cảnh báo.
    const daGhi = screen.getByText(/Đã ghi:/).closest('[role="alert"]')!;
    expect(daGhi.textContent).not.toMatch(/KHÔNG/);
    expect(daGhi.contains(bang)).toBe(false);
    expect(daGhi.contains(canhBao)).toBe(false);
  });

  it("[IMP-REG-UI-07] nút ghi nói thật: có lead sẽ thiếu quy nguồn ⇒ nút và dòng bên cạnh nêu số đó; không có ⇒ không nêu", async () => {
    gia(() => ({ ...BASE, seTao: TAO(4), phuHuynhSeGhi: 4, nguonThieu: 3 }));
    await chonFileVaXemThu();
    const nut = await screen.findByRole("button", { name: /Xác nhận ghi/ });
    await waitFor(() => expect((nut as HTMLButtonElement).disabled).toBe(false));
    expect(nut.textContent).toMatch(/4 phụ huynh/);
    expect(nut.textContent).toMatch(/3 thiếu quy nguồn/);
    expect(screen.getByTestId("canh-bao-xem-thu").textContent).toMatch(/3 lead/);
    cleanup();

    gia(() => ({ ...BASE, seTao: TAO(4), phuHuynhSeGhi: 4, nguonThieu: 0 }));
    await chonFileVaXemThu();
    const nut2 = await screen.findByRole("button", { name: /Xác nhận ghi/ });
    await waitFor(() => expect((nut2 as HTMLButtonElement).disabled).toBe(false));
    expect(nut2.textContent).toMatch(/4 phụ huynh/);
    expect(nut2.textContent).not.toMatch(/quy nguồn/);
  });

  it("[IMP-REG-UI-08] trang giải thích cột tuỳ chọn «Mã NV giới thiệu» (trước đây người dùng chỉ biết qua cảnh báo)", () => {
    const { container } = render(<ImportRegisteredLeadsPage />);
    expect(container.textContent).toMatch(/Mã NV giới thiệu/);
    expect(container.textContent).toMatch(/Sales/); // phân biệt với cột người chăm
  });

  it("[IMP-REG-UI-10] nút ghi đếm điều SẼ ĐỔI: 2 tạo mới + 1/3 gộp có thay đổi ⇒ «ghi 3 phụ huynh» (không phải 5); không có gì đổi ⇒ nút TẮT + nói vì sao", async () => {
    // Cấy: đếm bằng `phuHuynhSeGhi` (như trước) ⇒ nút in «ghi 5 phụ huynh» và vẫn bật khi số thật là 0.
    const GOP = (coThayDoi: boolean, i: number) => ({ sdt: `09071000${i}`, tenPH: "B", soConMoi: 0, coThayDoi });
    gia(() => ({ ...BASE, phuHuynh: 5, phuHuynhSeGhi: 5, seTao: TAO(2), seGop: [GOP(true, 0), GOP(false, 1), GOP(false, 2)], seDongBoHocVien: 0 }));
    await chonFileVaXemThu();
    const nut = (await screen.findByRole("button", { name: /Xác nhận ghi 3 phụ huynh/ })) as HTMLButtonElement;
    await waitFor(() => expect(nut.disabled).toBe(false));
    expect(screen.queryByTestId("khong-co-gi-de-ghi")).toBeNull();
    cleanup();

    // Không tạo mới, không gộp nào đổi, không hồ sơ HV để bổ sung ⇒ nút TẮT.
    gia(() => ({ ...BASE, phuHuynhSeGhi: 3, seTao: [], seGop: [GOP(false, 0), GOP(false, 1), GOP(false, 2)], seDongBoHocVien: 0 }));
    await chonFileVaXemThu();
    const tat = (await screen.findByRole("button", { name: /Không có gì để ghi/ })) as HTMLButtonElement;
    expect(tat.disabled).toBe(true);
    await screen.findByTestId("khong-co-gi-de-ghi");
    cleanup();

    // Đối chứng dương: vẫn còn hồ sơ học viên để bổ sung (server ghi cả đường này khi xác nhận) ⇒ nút BẬT, nhãn nói đúng việc.
    gia(() => ({ ...BASE, phuHuynhSeGhi: 3, seTao: [], seGop: [GOP(false, 0)], seDongBoHocVien: 2 }));
    await chonFileVaXemThu();
    const bs = (await screen.findByRole("button", { name: /Xác nhận bổ sung 2 hồ sơ học viên/ })) as HTMLButtonElement;
    await waitFor(() => expect(bs.disabled).toBe(false));
  });

  it("[IMP-REG-UI-09] không dùng ký tự ✅ / ⚠ thay icon ở khối kết quả và cảnh báo", async () => {
    gia((mode) => ({
      ...BASE,
      mode,
      nguonBiChan: CHAN,
      nguonThieu: 1,
      maNvGioiThieuBoQua: BO_QUA,
      daTaoLead: 1,
      daTaoHocVien: 1,
      daGopLead: 0,
      khongDoi: 0,
    }));
    const container = await chonFileVaXemThu();
    await screen.findByTestId("khong-tao-xem-thu");
    expect(container.textContent).not.toMatch(/[✅⚠]/);
    fireEvent.click(screen.getByRole("button", { name: /Xác nhận ghi/ }));
    await screen.findByTestId("khong-tao-ket-qua");
    expect(container.textContent).not.toMatch(/[✅⚠]/);
  });
});
