// Ca [PNA-*] — action quản trị pháp nhân: quyền `centers:edit` kiểm Ở SERVER, đầu vào hỏng không chạm dịch vụ, người thao tác lấy từ phiên.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  assertPermission: vi.fn(async (_k: string) => undefined),
  tao: vi.fn(async (_i: unknown) => ({ id: "pn1" })),
  sua: vi.fn(async (_i: unknown) => undefined),
  trangThai: vi.fn(async (_i: unknown) => undefined),
  xoa: vi.fn(async (_i: unknown) => undefined),
  gan: vi.fn(async (_i: unknown) => undefined),
  revalidatePath: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ assertPermission: h.assertPermission }));
vi.mock("@/lib/org/legal-entity-admin", () => ({
  taoPhapNhan: h.tao,
  suaPhapNhan: h.sua,
  doiTrangThaiPhapNhan: h.trangThai,
  xoaPhapNhan: h.xoa,
  ganPhapNhanChoDonVi: h.gan,
}));

import { OrgRuleError } from "@/lib/org/types";
import { doiTrangThaiPhapNhanAction, ganPhapNhanChoDonViAction, suaPhapNhanAction, taoPhapNhanAction, xoaPhapNhanAction } from "./_actions";

const LY_DO = "Cập nhật theo thông tin xuất hoá đơn chủ dự án cung cấp";
const CAC_ACTION: [string, (i: unknown) => Promise<{ ok: boolean; error?: string }>, unknown][] = [
  ["tạo", taoPhapNhanAction, { taxCode: "0402341056", legalName: "STEM" }],
  ["sửa", suaPhapNhanAction, { id: "pn1", legalName: "STEM 2", lyDo: LY_DO }],
  ["đổi trạng thái", doiTrangThaiPhapNhanAction, { id: "pn1", hanhDong: "NGUNG", lyDo: LY_DO }],
  ["xoá", xoaPhapNhanAction, { id: "pn1", lyDo: LY_DO }],
  ["gắn đơn vị", ganPhapNhanChoDonViAction, { orgUnitId: "u1", legalEntityId: "pn1", lyDo: LY_DO }],
];
const dichVu = () => [h.tao, h.sua, h.trangThai, h.xoa, h.gan];

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u-admin", name: "Quản trị", email: "a@satarobo.vn" } });
  h.assertPermission.mockResolvedValue(undefined);
});

describe("[PNA] quản trị pháp nhân — cổng ở server", () => {
  it.each(CAC_ACTION)("[PNA-01] %s: chưa đăng nhập ⇒ từ chối, KHÔNG chạm dịch vụ", async (_t, act, input) => {
    h.auth.mockResolvedValue(null);
    expect(await act(input)).toEqual({ ok: false, error: "Chưa đăng nhập" });
    for (const f of dichVu()) expect(f).not.toHaveBeenCalled();
  });

  it.each(CAC_ACTION)("[PNA-02] %s: thiếu quyền centers:edit ⇒ từ chối, KHÔNG chạm dịch vụ (kiểm quyền thật, không tin giao diện)", async (_t, act, input) => {
    h.assertPermission.mockRejectedValue(new Error("deny"));
    expect(await act(input)).toEqual({ ok: false, error: "Không có quyền quản trị cây tổ chức" });
    expect(h.assertPermission).toHaveBeenCalledWith("centers:edit");
    for (const f of dichVu()) expect(f).not.toHaveBeenCalled();
  });

  it.each(CAC_ACTION)("[PNA-03] %s: đầu vào hỏng ⇒ từ chối trước khi chạm dịch vụ", async (_t, act) => {
    expect((await act({ bậy: true })).ok).toBe(false);
    for (const f of dichVu()) expect(f).not.toHaveBeenCalled();
  });

  it("[PNA-04] có quyền: người thao tác lấy từ PHIÊN (không từ client), kết quả làm mới cả màn Cấu hình ký hiệu", async () => {
    expect(await taoPhapNhanAction({ taxCode: "0402341056", legalName: "STEM", nguoi: { id: "gia-mao", name: "gia mạo" } })).toEqual({ ok: true, id: "pn1" });
    expect(h.tao).toHaveBeenCalledWith(expect.objectContaining({ nguoi: { id: "u-admin", name: "Quản trị" } }));
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/payments/hoa-don/cau-hinh");
  });

  it("[PNA-05] lỗi nghiệp vụ của dịch vụ (MST trùng…) ⇒ câu tiếng Việt cho người dùng; lỗi lạ ⇒ câu chung, không phơi chi tiết", async () => {
    h.tao.mockRejectedValueOnce(new OrgRuleError("LEGAL_TAXCODE_CONFLICT", 'Mã số thuế "1" đã tồn tại.', "taxCode"));
    expect(await taoPhapNhanAction({ taxCode: "0402341056", legalName: "STEM" })).toEqual({ ok: false, error: 'Mã số thuế "1" đã tồn tại.' });
    h.tao.mockRejectedValueOnce(new Error("connection reset mật khẩu=abc"));
    const r = await taoPhapNhanAction({ taxCode: "0402341056", legalName: "STEM" });
    expect(r).toEqual({ ok: false, error: "Không thêm được pháp nhân, thử lại sau" });
  });

  it("[PNA-06] lý do quá dài / hành động lạ bị schema chặn", async () => {
    expect((await doiTrangThaiPhapNhanAction({ id: "pn1", hanhDong: "PHÁ", lyDo: LY_DO })).ok).toBe(false);
    expect((await xoaPhapNhanAction({ id: "pn1", lyDo: "x".repeat(400) })).ok).toBe(false);
    expect(h.trangThai).not.toHaveBeenCalled();
    expect(h.xoa).not.toHaveBeenCalled();
  });
});
