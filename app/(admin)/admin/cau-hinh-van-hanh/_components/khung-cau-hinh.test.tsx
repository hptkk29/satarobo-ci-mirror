// @vitest-environment jsdom
/**
 * Trang Cấu hình vận hành — khung tab + ô nhập theo kiểu giá trị.
 *
 * ── CANH GÌ ──────────────────────────────────────────────────────────────────────────────
 * Bản trước là một danh sách dọc 86 ô JSON. Bản này chia tab và đổi ô nhập theo kiểu dữ liệu.
 * Cả hai thay đổi đều có thể "trông đúng" mà sai:
 *
 *  1. Tab chỉ đổi tiêu đề mà nội dung không đổi — nhìn ảnh chụp không phân biệt được.
 *  2. Ô số nhận chuỗi và gửi chuỗi `"5"` xuống máy chủ thay vì số `5`. Zod sẽ từ chối, người
 *     dùng thấy một thông báo lỗi khó hiểu và kết luận trang hỏng.
 *  3. Bảng 51 công tắc thông báo lọt sang tab khác, hoặc biến mất khỏi tab của nó.
 *  4. Chỉ-được-xem nhưng ô vẫn gõ được.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  luuSetting: vi.fn(async (_i: { key: string; value: unknown; reason: string }) => ({
    ok: true as const,
  })),
  luuLoai: vi.fn(async (_i: { tienTo: string[]; reason: string }) => ({ ok: true as const })),
}));
vi.mock("../actions", () => ({
  saveGlobalSettingAction: h.luuSetting,
  luuLoaiDuocDayAction: h.luuLoai,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { catalogEntries } from "@/lib/notifications/catalog";
import { KhungCauHinh, type TabView } from "./khung-cau-hinh";

const DANH_MUC = catalogEntries();

const TABS: TabView[] = [
  {
    id: "thong-bao-day",
    ten: "Thông báo điện thoại",
    moTa: "Thông báo hiện trên màn hình khoá điện thoại của nhân viên.",
    rows: [
      {
        key: "push.webPushEnabled",
        value: false,
        nhan: {
          tab: "thong-bao-day",
          ten: "Bật thông báo trên điện thoại",
          giaiThich: "Tắt thì không ai nhận được gì ngoài chuông trong trang quản trị.",
          canThan: true,
        },
      },
    ],
  },
  {
    id: "cham-cong",
    ten: "Chấm công & ca làm",
    moTa: "Quy định chấm công, đi muộn, nghỉ phép và đăng ký ca.",
    rows: [
      {
        key: "shift.toleranceMinutes",
        value: 5,
        nhan: {
          tab: "cham-cong",
          ten: "Chấm công lệch trong khoảng này vẫn tính đúng giờ",
          giaiThich: "Áp cho cả quét sớm lẫn quét muộn, là dung sai kỹ thuật của đồng hồ.",
          donVi: "phút",
        },
      },
    ],
  },
  {
    id: "cong-ty",
    ten: "Thông tin công ty",
    moTa: "Số điện thoại, email và các khối nội dung hiện trên website.",
    rows: [
      {
        key: "zalo.znsTemplateOtp",
        value: "616128",
        nhan: {
          tab: "cong-ty",
          ten: "Mẫu tin: mã xác thực",
          giaiThich: "Số hiệu mẫu tin đã được Zalo duyệt. Để trống thì không gửi.",
        },
      },
      {
        key: "contact.hotlines",
        value: [{ code: "CS1", label: "Cơ sở 1", phone: "0818823720" }],
        nhan: {
          tab: "cong-ty",
          ten: "Số điện thoại hiện trên website",
          giaiThich: "Khai theo từng cơ sở. Sai một chữ số là khách gọi vào số lạ.",
        },
      },
    ],
  },
];

function dung(
  x: {
    choSua?: boolean;
    choSuaCoSo?: boolean;
    loaiDangBat?: string[];
    tabBanDau?: string;
  } = {},
) {
  return render(
    <KhungCauHinh
      tabs={TABS}
      choSua={x.choSua ?? true}
      choSuaCoSo={x.choSuaCoSo ?? x.choSua ?? true}
      tabThongBao="thong-bao-day"
      danhMucThongBao={DANH_MUC}
      loaiDangBat={x.loaiDangBat ?? ["lead.moi:"]}
      canhBaoKenh={[]}
      tabBanDau={x.tabBanDau}
    />,
  );
}

/**
 * Nhãn ĐẦY ĐỦ của ô dung sai chấm công.
 *
 * Phải khớp cả câu chứ không dùng biểu thức khớp một phần: ô nhập lý do ngay bên cạnh mang
 * nhãn tiếp cận "Lý do thay đổi: <tên>", nên một mẩu chuỗi sẽ khớp CẢ HAI ô và phép tìm ném
 * lỗi "found multiple". Đây là ca đã xảy ra thật khi viết bộ này.
 */
const O_DUNG_SAI = "Chấm công lệch trong khoảng này vẫn tính đúng giờ";

const moTab = (ten: string) => fireEvent.click(screen.getByRole("tab", { name: ten }));

beforeEach(() => {
  h.luuSetting.mockClear().mockResolvedValue({ ok: true });
  h.luuLoai.mockClear().mockResolvedValue({ ok: true });
  // ⚠️ DỌN ĐƯỜNG DẪN — khung nay đọc `?tab=` lúc mount, nên một ca để lại query bẩn là
  // mọi ca sau mở nhầm tab. Đo thật: chạy riêng thì xanh, chạy cả bộ thì 5 ca đỏ — đúng
  // chữ ký của lớp lỗi "ca này mượn trạng thái ca trước" (luật 18,
  // docs/luat-doc-so-va-ket-luan.md). Dọn ở MỘT chỗ, không bắt từng ca tự nhớ.
  window.history.replaceState(null, "", "/");
});

describe("[CFG-T10] tab thật sự đổi NỘI DUNG, không chỉ đổi tiêu đề", () => {
  it("mở tab nào chỉ thấy tham số của tab đó", () => {
    dung();
    // Mặc định là tab đầu.
    expect(screen.getByText("Bật thông báo trên điện thoại")).toBeTruthy();
    expect(screen.queryByText(/Chấm công lệch trong khoảng này/)).toBeNull();

    moTab("Chấm công & ca làm");
    expect(screen.getByText(/Chấm công lệch trong khoảng này/)).toBeTruthy();
    expect(screen.queryByText("Bật thông báo trên điện thoại")).toBeNull();
  });

  it("mô tả tab đổi theo tab đang mở", () => {
    dung();
    expect(screen.getByText(/màn hình khoá điện thoại/)).toBeTruthy();
    moTab("Thông tin công ty");
    expect(
      screen.getByText("Số điện thoại, email và các khối nội dung hiện trên website."),
    ).toBeTruthy();
  });

  it("tab đang mở được đánh dấu cho trình đọc màn hình", () => {
    dung();
    expect(screen.getByRole("tab", { name: "Thông báo điện thoại" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    moTab("Chấm công & ca làm");
    expect(screen.getByRole("tab", { name: "Chấm công & ca làm" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByRole("tab", { name: "Thông báo điện thoại" }).getAttribute("aria-selected")).toBe(
      "false",
    );
  });
});

describe("[CFG-T11] bảng 51 công tắc thông báo chỉ nằm ở tab của nó", () => {
  it("tab thông báo có bảng chọn loại", () => {
    dung();
    // Bảng loại thông báo dùng nhãn "Đẩy Web Push cho: …"; công tắc bật/tắt chung thì không.
    expect(screen.getAllByRole("switch", { name: /Đẩy Web Push cho:/ }).length).toBe(
      DANH_MUC.length,
    );
  });

  it("tab khác KHÔNG có bảng đó", () => {
    // Lọt sang tab khác là người đi chỉnh chấm công bỗng thấy 51 công tắc thông báo.
    dung();
    moTab("Chấm công & ca làm");
    expect(screen.queryAllByRole("switch", { name: /Đẩy Web Push cho:/ })).toHaveLength(0);
  });
});

describe("[CFG-T12] ô nhập đúng kiểu, và gửi xuống đúng KIỂU DỮ LIỆU", () => {
  it("bật/tắt ra công tắc, và lưu gửi true/false chứ không phải chuỗi", () => {
    dung();
    fireEvent.click(screen.getByRole("switch", { name: "Bật thông báo trên điện thoại" }));
    fireEvent.change(screen.getByLabelText(/Lý do thay đổi: Bật thông báo/), {
      target: { value: "BGĐ duyệt mở kênh" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Lưu" })[0]!);
    expect(h.luuSetting).toHaveBeenCalledWith({
      key: "push.webPushEnabled",
      value: true,
      reason: "BGĐ duyệt mở kênh",
    });
  });

  it("⚠️ ô số gửi SỐ, không gửi chuỗi", () => {
    // Gửi "7" thay vì 7 thì Zod từ chối và người dùng nhận một thông báo lỗi khó hiểu — họ sẽ
    // kết luận trang hỏng chứ không đoán được là do kiểu dữ liệu.
    dung();
    moTab("Chấm công & ca làm");
    fireEvent.change(screen.getByLabelText(O_DUNG_SAI), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText(/Lý do thay đổi: Chấm công lệch/), {
      target: { value: "nới dung sai" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    const g = h.luuSetting.mock.calls[0]![0];
    expect(g.value).toBe(7);
    expect(typeof g.value).toBe("number");
  });

  it("ô số nhập chữ ⇒ KHÔNG gọi máy chủ", () => {
    dung();
    moTab("Chấm công & ca làm");
    fireEvent.change(screen.getByLabelText(O_DUNG_SAI), { target: { value: "năm phút" } });
    fireEvent.change(screen.getByLabelText(/Lý do thay đổi: Chấm công lệch/), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(h.luuSetting).not.toHaveBeenCalled();
  });

  it("⚠️ ô chữ gửi CHUỖI — không tự biến '616128' thành số", () => {
    // Mã mẫu tin là chuỗi. Biến nó thành số là mọi tin Zalo loại đó hỏng, và bản cũ bắt người
    // dùng tự gõ dấu nháy kép trong ô JSON để tránh đúng chuyện này.
    dung();
    moTab("Thông tin công ty");
    fireEvent.change(screen.getByLabelText("Mẫu tin: mã xác thực"), {
      target: { value: "616999" },
    });
    fireEvent.change(screen.getByLabelText(/Lý do thay đổi: Mẫu tin/), {
      target: { value: "đổi mẫu" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Lưu" })[0]!);
    const g = h.luuSetting.mock.calls[0]![0];
    expect(g.value).toBe("616999");
    expect(typeof g.value).toBe("string");
  });

  it("giá trị dạng danh sách vẫn dùng ô nhiều dòng và gửi lại đúng cấu trúc", () => {
    dung();
    moTab("Thông tin công ty");
    const o = screen.getByLabelText("Số điện thoại hiện trên website");
    expect(o.tagName).toBe("TEXTAREA");
    fireEvent.change(o, {
      target: { value: '[{"code":"CS1","label":"Cơ sở 1","phone":"0900000000"}]' },
    });
    fireEvent.change(screen.getByLabelText(/Lý do thay đổi: Số điện thoại/), {
      target: { value: "đổi hotline" },
    });
    // Chỉ dòng vừa đổi mới có nút Lưu — nên đây là nút DUY NHẤT trên màn, không phải nút thứ hai.
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(h.luuSetting.mock.calls[0]![0].value).toEqual([
      { code: "CS1", label: "Cơ sở 1", phone: "0900000000" },
    ]);
  });

  it("nội dung danh sách sai cú pháp ⇒ KHÔNG gọi máy chủ", () => {
    dung();
    moTab("Thông tin công ty");
    fireEvent.change(screen.getByLabelText("Số điện thoại hiện trên website"), {
      target: { value: "[{code: CS1" },
    });
    fireEvent.change(screen.getByLabelText(/Lý do thay đổi: Số điện thoại/), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(h.luuSetting).not.toHaveBeenCalled();
  });

  it("đơn vị hiện cạnh ô số — '5' trần thì người dùng phải đoán là 5 gì", () => {
    dung();
    moTab("Chấm công & ca làm");
    expect(screen.getByText("phút")).toBeTruthy();
  });

  it("chưa đổi gì ⇒ CHƯA có khung lưu nào", () => {
    // Đổi hợp đồng có chủ đích 13/09: trước đây mỗi dòng mang sẵn một ô "Lý do thay đổi" và
    // một nút Lưu mờ. Với 86 dòng, đó là 86 hộp chữ không ai điền và 86 lời hứa suông. Nay
    // khung lưu chỉ hiện ở dòng THẬT SỰ vừa đổi.
    dung();
    moTab("Chấm công & ca làm");
    expect(screen.queryByRole("button", { name: "Lưu" })).toBeNull();
    expect(screen.queryByLabelText(/Lý do thay đổi/)).toBeNull();
  });

  it("đổi một ô ⇒ khung lưu hiện ra ĐÚNG ở dòng đó", () => {
    // Cặp đôi với ca trên. Không có ca này thì một bản vá "ẩn luôn khung lưu" vẫn xanh, và
    // người dùng đổi xong không có cách nào lưu.
    dung();
    moTab("Chấm công & ca làm");
    fireEvent.change(screen.getByLabelText(O_DUNG_SAI), { target: { value: "7" } });
    expect(screen.getByRole("button", { name: "Lưu" })).toBeTruthy();
    expect(screen.getByLabelText(/Lý do thay đổi: Chấm công lệch/)).toBeTruthy();
  });

  it("thiếu lý do ⇒ KHÔNG gọi máy chủ", () => {
    dung();
    fireEvent.click(screen.getByRole("switch", { name: "Bật thông báo trên điện thoại" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Lưu" })[0]!);
    expect(h.luuSetting).not.toHaveBeenCalled();
  });
});

describe("[CFG-T13] chữ hiện ra là chữ của người vận hành", () => {
  it("tên khoá kỹ thuật KHÔNG hiện sẵn — nằm trong mục gấp lại", () => {
    // Người dùng trang này không biết `shift.toleranceMinutes` nghĩa là gì. Nhưng khi có sự
    // cố thì đó là thứ duy nhất tra được, nên phải còn, chỉ là gấp lại.
    dung();
    moTab("Chấm công & ca làm");
    const chiTiet = screen.getByText("Chi tiết kỹ thuật").closest("details")!;
    expect(chiTiet.hasAttribute("open")).toBe(false);
    expect(within(chiTiet).getByText("shift.toleranceMinutes")).toBeTruthy();
  });

  it("câu giải thích hiện ngay dưới tên, không phải chờ di chuột", () => {
    dung();
    expect(screen.getByText(/không ai nhận được gì ngoài chuông/)).toBeTruthy();
  });
});

describe("[CFG-T14] chỉ-được-xem thì KHOÁ ô nhập, không chỉ giấu nút", () => {
  it("mọi ô và công tắc đều khoá, không có nút Lưu", () => {
    dung({ choSua: false });
    moTab("Chấm công & ca làm");
    expect(screen.getByLabelText(O_DUNG_SAI).hasAttribute("disabled")).toBe(true);
    expect(screen.queryAllByRole("button", { name: "Lưu" })).toHaveLength(0);
  });
});

describe("[CFG-K05] tab sống sót khi rời trang rồi quay lui", () => {
  // Chủ dự án 14/09/2026: "khi ở tab hoa hồng ở cấu hình vận hành xong chuyển sang màn
  // leads xong bấm quay lui thì bị chuyển về tab thông báo đẩy của cấu hình vận hành".
  //
  // Nguyên nhân: tab chỉ sống trong `useState`. State mất khi rời trang, nên lần quay lại
  // là một lượt mount mới và luôn rơi về tab đầu. Vá bằng cách để tab nằm trong ĐƯỜNG DẪN.
  //
  // ⚠️ Ba ca dưới đây kiểm ba mắt xích KHÁC NHAU của cùng một đường. Bỏ ca nào thì mắt
  // xích đó hỏng vẫn xanh: đọc được `?tab=` mà không ghi lại thì Back vô dụng; ghi mà
  // không đọc thì URL đúng còn màn sai.

  it("mở đúng tab ghi trên đường dẫn, không phải tab đầu", () => {
    dung({ tabBanDau: TABS[1]!.id });
    // Mô tả tab là thứ chỉ có ở tab đang mở — dùng nó làm bằng chứng.
    expect(screen.getByText(TABS[1]!.moTa)).toBeInTheDocument();
  });

  it("`?tab=` lạ rơi về tab đầu chứ KHÔNG ra trang trắng", () => {
    // Đường dẫn cũ, hoặc người gõ tay. Fail-soft: phải ra một trang dùng được.
    dung({ tabBanDau: "khong-ton-tai" });
    expect(screen.getByText(TABS[0]!.moTa)).toBeInTheDocument();
  });

  it("QUAY LUI: mount lại với props CŨ nhưng đường dẫn đã có ?tab= ⇒ theo đường dẫn", () => {
    // ⚠️ ĐÂY LÀ CA CỦA CHÍNH CON BUG, và nó khác hẳn ca "mở đúng tab ghi trên đường dẫn".
    //
    // Tái hiện đúng thao tác chủ dự án mô tả (bấm LINK sidebar, không gõ địa chỉ): Next
    // dựng lại trang từ BỘ ĐỆM CLIENT, nên component mount lại nhưng mang props của lần
    // render máy chủ CŨ — `tabBanDau` là `undefined` vì lúc ấy đường dẫn chưa có `?tab=`.
    // Máy chủ không chạy lại lần nào. Kết quả đo được: URL `?tab=hoa-hong` mà màn hiện
    // "Thông báo đẩy" — màn nói dối so với đường dẫn.
    //
    // Nên ca này CỐ Ý bỏ trống `tabBanDau` và chỉ đặt đường dẫn.
    window.history.replaceState(null, "", `?tab=${TABS[2]!.id}`);
    dung({});
    expect(screen.getByText(TABS[2]!.moTa)).toBeInTheDocument();
  });

  it("bấm tab thì GHI vào đường dẫn — nếu không, Back chẳng có gì để khôi phục", () => {
    dung({});
    fireEvent.click(screen.getByRole("tab", { name: TABS[1]!.ten }));
    expect(new URL(window.location.href).searchParams.get("tab")).toBe(TABS[1]!.id);
    // ĐÈ mục lịch sử, không THÊM: bấm qua 5 tab rồi Back phải ra khỏi trang, không phải
    // lùi từng tab một.
  });
});

describe("[CFG-T20] `khoiThem` THÊM khối, `noiDungRieng` THAY bảng — hai prop trông giống nhau", () => {
  /**
   * ⚠️ BẪY CÓ THẬT, và đây là cổng canh nó.
   *
   * Hai prop cùng kiểu `Record<string, ReactNode>`, cùng tra theo `tabId`, đặt cạnh nhau
   * trong cùng một lời gọi — nhưng `noiDungRieng` đứng ở vế `??` nên nó THAY bảng ô cấu
   * hình. Dùng nhầm nó cho một tab đang có tham số là xoá trắng mọi dòng cấu hình của tab
   * đó khỏi màn hình: không lỗi, không cảnh báo, console sạch, và chỉ người vận hành đi tìm
   * tham số của mình mới biết (luật 12).
   *
   * Tab "Lớp & giáo viên" là ca thật: 5 ô cấu hình PHẢI giữ nguyên, cộng bảng chọn giáo
   * viên luôn hiện khi xếp buổi học thử.
   */
  const KHOI = <p>KHỐI PHỤ CỦA TAB</p>;

  it("khối thêm hiện CÙNG bảng ô cấu hình, không nuốt nó", () => {
    render(
      <KhungCauHinh
        tabs={TABS}
        choSua
        choSuaCoSo
        tabThongBao="thong-bao-day"
        danhMucThongBao={DANH_MUC}
        loaiDangBat={[]}
        canhBaoKenh={[]}
        khoiThem={{ "cham-cong": KHOI }}
        tabBanDau="cham-cong"
      />,
    );
    expect(screen.getByText(/Chấm công lệch trong khoảng này/)).toBeTruthy();
    expect(screen.getByText("KHỐI PHỤ CỦA TAB")).toBeTruthy();
  });

  it("khối thêm chỉ nằm ở tab của nó", () => {
    render(
      <KhungCauHinh
        tabs={TABS}
        choSua
        choSuaCoSo
        tabThongBao="thong-bao-day"
        danhMucThongBao={DANH_MUC}
        loaiDangBat={[]}
        canhBaoKenh={[]}
        khoiThem={{ "cham-cong": KHOI }}
        tabBanDau="cong-ty"
      />,
    );
    expect(screen.queryByText("KHỐI PHỤ CỦA TAB")).toBeNull();
  });

  it("⚠️ đối chứng: `noiDungRieng` cùng vị trí đó thì NUỐT bảng ô cấu hình", () => {
    // Ca này không canh tính năng — nó khoá SỰ KHÁC BIỆT. Ai gộp hai prop làm một, hoặc đổi
    // `khoiThem` sang vế `??`, sẽ thấy ca trên đỏ; ai đổi ngược lại thì thấy ca này đỏ.
    render(
      <KhungCauHinh
        tabs={TABS}
        choSua
        choSuaCoSo
        tabThongBao="thong-bao-day"
        danhMucThongBao={DANH_MUC}
        loaiDangBat={[]}
        canhBaoKenh={[]}
        noiDungRieng={{ "cham-cong": KHOI }}
        tabBanDau="cham-cong"
      />,
    );
    expect(screen.getByText("KHỐI PHỤ CỦA TAB")).toBeTruthy();
    expect(screen.queryByText(/Chấm công lệch trong khoảng này/)).toBeNull();
  });
});
