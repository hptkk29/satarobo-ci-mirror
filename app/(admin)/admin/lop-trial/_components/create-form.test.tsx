// @vitest-environment jsdom
/**
 * FORM TẠO LỚP TRẢI NGHIỆM — tên lớp sửa được + cơ sở mặc định theo người dùng.
 *
 * Chủ dự án 18/09/2026: "ở màn tạo lớp trial: được sửa và tự do điều chỉnh tên lớp, và set
 * mặc định cơ sở là cơ sở của sale đó nhưng vẫn có thể chọn cơ sở khác".
 *
 * ── ĐÂY LÀ MỘT LƯỢT ĐẢO CHỐT, NÊN BỘ NÀY CANH CẢ HAI CHIỀU ───────────────────────────────
 * Chốt 28/08 cố ý KHÔNG cho gõ tên: "Cho người gõ tên là mời hai lớp trùng tên và mời lệch
 * khỏi quy ước — mà tên này đi thẳng vào phiếu gửi phụ huynh." Nay mở ra theo yêu cầu mới,
 * nhưng hai lo ngại ấy phải được xử lý chứ không bỏ qua:
 *
 *  · LỆCH QUY ƯỚC → ô ĐIỀN SẴN tên theo quy ước và tự đổi theo cơ sở/khoá **miễn là người
 *    dùng chưa gõ**. Ai không quan tâm thì bấm lưu là ra đúng tên cũ.
 *  · GỬI RÁC LÊN SERVER → khi chưa gõ thì **không gửi** `name`, vì chuỗi xem-trước có dấu
 *    "…" ở chỗ con số; gửi nó lên là lưu nguyên dấu đó vào tên lớp.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

// Kiểu tham số khai TƯỜNG MINH: `vi.fn(async () => …)` suy ra tuple rỗng nên
// `mock.calls[0]![0]` là lỗi biên dịch (TS2493).
const goiTao = vi.fn(async (_input: {
  centerId: string;
  courseId?: string;
  name?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
}) => ({
  ok: true as const,
  id: "tc1",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../_actions", () => ({
  createLopTrialClassAction: (input: unknown) => goiTao(input as never),
}));

import { CreateForm } from "./create-form";

afterEach(() => {
  cleanup();
  goiTao.mockClear();
});

const CO_SO = [
  { id: "cs1", name: "CS1 — 211 Nguyễn Hữu Thọ", code: "CS1" },
  { id: "cs2", name: "CS2 — 114 Hoàng Diệu", code: "CS2" },
];

// 22/09/2026 — lớp nay có NGÀY + KHUNG GIỜ. Dùng ngày TUYỆT ĐỐI (luật 19):
// 22/09/2026 là THỨ 3 ⇒ khung tối 17:30–21:00.
const KHUNG = {
  cn: "08:00-11:30, 14:00-17:30",
  t2: "",
  t3: "17:30-21:00",
  t4: "17:30-21:00",
  t5: "17:30-21:00",
  t6: "17:30-21:00",
  t7: "08:00-11:30, 14:00-17:30",
};
const HOM_NAY = "2026-09-22";

function dung(coSoCuaToi: string | null = null) {
  return render(
    <CreateForm
      centers={CO_SO}
      coSoCuaToi={coSoCuaToi}
      cauHinhKhung={KHUNG}
      homNay={HOM_NAY}
    />,
  );
}

const oTen = () => screen.getByLabelText("Tên lớp") as HTMLInputElement;
const oCoSo = () => screen.getByRole("combobox", { name: /Cơ sở/ }) as HTMLSelectElement;
const nutLuu = () => screen.getByRole("button", { name: /Tạo lớp|Lưu/ });

describe("[LT-T10] CƠ SỞ mặc định là cơ sở của người dùng", () => {
  it("có cơ sở riêng ⇒ chọn sẵn đúng cơ sở đó, KHÔNG phải cơ sở đầu bảng", () => {
    // Bản cũ mặc định `centers[0]`. Với Sale một cơ sở thì trùng nhau nên không ai thấy;
    // với người nhìn được nhiều cơ sở thì đó là cơ sở ĐẦU BẢNG CHỮ CÁI, không phải của họ.
    dung("cs2");
    expect(oCoSo().value).toBe("cs2");
  });

  it("⚠️ cơ sở của người dùng KHÔNG có trong danh sách ⇒ GỬI LÊN cơ sở đầu", async () => {
    // Người Hội sở có `centerId` trỏ tới `Center("hoi-so")` — bản ghi MỒ CÔI mà
    // `getCenterOptions` cố ý không bày.
    //
    // ⚠️ PHẢI KIỂM THỨ GỬI LÊN, KHÔNG KIỂM `select.value`. Bản đầu của ca này đọc
    // `oCoSo().value` và nó XANH GIẢ: khi state là một id không có `<option>` tương ứng,
    // trình duyệt tự hiển thị option ĐẦU TIÊN. Phép đo ấy không phân biệt được "state
    // đúng là cs1" với "state sai nên hiện tạm cs1" — mà cái sai thì đi thẳng lên server
    // và bị từ chối ("Bạn không có quyền tạo lớp tại cơ sở này").
    dung("hoi-so");
    fireEvent.click(nutLuu());
    await vi.waitFor(() => expect(goiTao).toHaveBeenCalled());
    const gui = goiTao.mock.calls[0]![0] as unknown as { centerId?: string };
    expect(gui.centerId).toBe("cs1");
  });

  it("có cơ sở riêng ⇒ GỬI LÊN đúng cơ sở đó", async () => {
    dung("cs2");
    fireEvent.click(nutLuu());
    await vi.waitFor(() => expect(goiTao).toHaveBeenCalled());
    const gui = goiTao.mock.calls[0]![0] as unknown as { centerId?: string };
    expect(gui.centerId).toBe("cs2");
  });

  it("không biết cơ sở của người dùng ⇒ vẫn có mặc định", () => {
    dung(null);
    expect(oCoSo().value).toBe("cs1");
  });

  it("vẫn ĐỔI được sang cơ sở khác", () => {
    dung("cs2");
    fireEvent.change(oCoSo(), { target: { value: "cs1" } });
    expect(oCoSo().value).toBe("cs1");
  });
});

describe("[LT-T11] TÊN LỚP sửa được", () => {
  it("⚠️ ô tên KHÔNG còn bị khoá — đây là chính yêu cầu", () => {
    dung("cs1");
    expect(oTen().readOnly).toBe(false);
    expect(oTen().disabled).toBe(false);
  });

  it("điền sẵn theo quy ước, nên không gõ gì cũng ra tên đúng nếp", () => {
    dung("cs1");
    expect(oTen().value).toContain("CS1");
  });

  it("chưa gõ ⇒ đổi cơ sở thì tên xem-trước ĐỔI THEO", () => {
    dung("cs1");
    expect(oTen().value).toContain("CS1");
    fireEvent.change(oCoSo(), { target: { value: "cs2" } });
    expect(oTen().value).toContain("CS2");
  });

  it("⚠️ ĐÃ gõ ⇒ đổi cơ sở KHÔNG được xoá tên vừa đặt", () => {
    // Nếu tên tự đổi theo cơ sở kể cả khi người dùng đã gõ, thì mỗi lần đổi cơ sở là mất
    // công gõ lại — và người dùng sẽ không hiểu tại sao chữ mình vừa nhập biến mất.
    dung("cs1");
    fireEvent.change(oTen(), { target: { value: "Lớp thử thứ Ba chiều" } });
    fireEvent.change(oCoSo(), { target: { value: "cs2" } });
    expect(oTen().value).toBe("Lớp thử thứ Ba chiều");
  });

  it("có đường QUAY LẠI tên theo quy ước sau khi đã gõ", () => {
    dung("cs1");
    fireEvent.change(oTen(), { target: { value: "Tên tay" } });
    fireEvent.click(screen.getByRole("button", { name: /Dùng lại tên theo quy ước/ }));
    expect(oTen().value).toContain("CS1");
  });

  it("có TRẦN độ dài — tên đi thẳng vào phiếu gửi phụ huynh", () => {
    dung("cs1");
    expect(oTen().maxLength).toBe(120);
  });
});

describe("[LT-T12] ⚠️ gửi gì lên server", () => {
  it("CHƯA gõ ⇒ KHÔNG gửi `name` (để server sinh theo quy ước)", async () => {
    // Chuỗi xem-trước có dấu "…" ở chỗ con số. Gửi nó lên là lưu nguyên dấu đó vào tên
    // lớp — và tên ấy đi vào phiếu gửi phụ huynh.
    dung("cs1");
    fireEvent.click(nutLuu());
    await vi.waitFor(() => expect(goiTao).toHaveBeenCalled());
    const gui = goiTao.mock.calls[0]![0] as unknown as { name?: string };
    expect(gui.name).toBeUndefined();
  });

  it("ĐÃ gõ ⇒ gửi đúng tên đã gõ", async () => {
    dung("cs1");
    fireEvent.change(oTen(), { target: { value: "  Lớp thử T5  " } });
    fireEvent.click(nutLuu());
    await vi.waitFor(() => expect(goiTao).toHaveBeenCalled());
    const gui = goiTao.mock.calls[0]![0] as unknown as { name?: string };
    // Cắt khoảng trắng hai đầu — dán từ Excel hay kèm dấu cách.
    expect(gui.name).toBe("Lớp thử T5");
  });

  it("gõ rồi xoá trắng ⇒ coi như chưa gõ, KHÔNG gửi chuỗi rỗng", async () => {
    dung("cs1");
    fireEvent.change(oTen(), { target: { value: "x" } });
    fireEvent.change(oTen(), { target: { value: "   " } });
    fireEvent.click(nutLuu());
    await vi.waitFor(() => expect(goiTao).toHaveBeenCalled());
    const gui = goiTao.mock.calls[0]![0] as unknown as { name?: string };
    expect(gui.name).toBeUndefined();
  });
});

describe("[LT-T13] ⚠️ nhánh SERVER phải THẬT SỰ dùng tên người dùng gõ", () => {
  // Bộ trên chỉ dựng FORM, nên nó không chứng minh được gì về server. Cấy lỗi "server bỏ
  // qua tên người dùng gõ" vào `lib/trial/service.ts` mà cả bộ vẫn XANH — đúng lớp lỗi
  // RT-1. `createTrialClass` chạm DB nên không test thuần được; canh bằng lưới ghim mã
  // nguồn (luật 11: neo hẹp, và đã cấy lại để thấy đỏ).
  const doc = (p: string) => {
    const duong = path.join(process.cwd(), p);
    expect(fs.existsSync(duong), `${duong} không còn ở chỗ cũ`).toBe(true);
    return fs.readFileSync(duong, "utf8");
  };

  it("phép quét tự kiểm: đọc được ba tệp của đường ghi", () => {
    for (const p of [
      "lib/trial/service.ts",
      "app/(admin)/admin/lop-trial/_actions.ts",
      "app/(admin)/admin/lop-trial/_lib/schemas.ts",
    ]) {
      expect(doc(p).length).toBeGreaterThan(500);
    }
  });

  it("`createTrialClass` ưu tiên tên người dùng, rơi về quy ước khi trống", () => {
    const sv = doc("lib/trial/service.ts");
    expect(sv).toContain("params.name?.trim() ||");
    // 23/09 — lớp có ngày đặt tên theo ngày; lớp cũ giữ quy ước số thứ tự.
    expect(sv).toContain("tenLopTrialTheoNgay(cc, khoa?.slug ?? null, params.startDate.toISOString().slice(0, 10))");
    expect(sv).toContain(": tenLopTrial(cc, khoa?.slug ?? null, seq)),");
  });

  it("action TRUYỀN tên xuống service — không nhận rồi bỏ rơi", () => {
    expect(doc("app/(admin)/admin/lop-trial/_actions.ts")).toContain("name: data.name ?? null");
  });

  it("schema CHẤP NHẬN tên, và có trần 120 ký tự", () => {
    const sc = doc("app/(admin)/admin/lop-trial/_lib/schemas.ts");
    expect(sc).toContain("max(120");
    expect(sc).toMatch(/name: z\.string\(\)/);
  });
});
