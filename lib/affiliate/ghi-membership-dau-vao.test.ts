// @vitest-environment node
/**
 * [AFM-*] — LUẬT GHI MEMBERSHIP AFFILIATE, phần thuần (không DB). Ngày TUYỆT ĐỐI (luật 19). Mỗi ca chạy được MỘT MÌNH (luật 18).
 *
 *   [AFM-01] thêm: TẠO hay MỞ LẠI · campaign ENDED · đối tác không hoạt động · đã ở trong campaign
 *   [AFM-02] chuyển trạng thái: bảng chuyển · lý do · duyệt vào campaign ENDED / đối tác không hoạt động
 *   [AFM-03] kết thúc: hiệu lực-đến phải SAU hiệu lực-từ (CHECK) — nói bằng tiếng Việt, không để Postgres từ chối
 *   [AFM-04] sửa nhãn / hiệu lực
 */
import { describe, expect, it } from "vitest";
import {
  CHUYEN_MEMBERSHIP,
  kiemChuyenMembership,
  kiemSuaMembership,
  kiemThemMembership,
  suaMembershipSchema,
  themMembershipSchema,
  tinhHieuLucKhiKetThuc,
} from "./ghi-membership-dau-vao";

const NOW = new Date("2026-10-13T03:00:00.000Z");
const TU = new Date("2026-10-01T00:00:00.000Z");

describe("[AFM-01] thêm đối tác vào campaign", () => {
  const camp = { status: "ACTIVE" as const };
  const dt = { status: "ACTIVE" as const };

  it("chưa có dòng ⇒ TẠO; có dòng ENDED ⇒ MỞ LẠI (không tạo trùng)", () => {
    expect(kiemThemMembership({ campaign: camp, doiTac: dt, hienCo: null })).toEqual({ ok: true, viec: "TAO" });
    expect(kiemThemMembership({ campaign: camp, doiTac: dt, hienCo: { status: "ENDED" } })).toEqual({ ok: true, viec: "MO_LAI" });
  });

  it("đã có dòng còn sống (PENDING / ACTIVE / SUSPENDED) ⇒ chặn, nói trạng thái hiện tại", () => {
    for (const status of ["PENDING", "ACTIVE", "SUSPENDED"] as const) {
      const r = kiemThemMembership({ campaign: camp, doiTac: dt, hienCo: { status } });
      expect(r.ok, status).toBe(false);
      if (!r.ok) expect(r.loi).toContain("đã ở trong campaign");
    }
  });

  it("campaign ENDED không nhận thành viên mới; DRAFT / ACTIVE / PAUSED thì nhận", () => {
    expect(kiemThemMembership({ campaign: { status: "ENDED" }, doiTac: dt, hienCo: null }).ok).toBe(false);
    for (const status of ["DRAFT", "ACTIVE", "PAUSED"] as const) expect(kiemThemMembership({ campaign: { status }, doiTac: dt, hienCo: null }).ok, status).toBe(true);
  });

  it("chỉ đối tác ACTIVE thêm được; không có đối tác ⇒ chặn", () => {
    for (const status of ["DRAFT", "PENDING", "SUSPENDED", "ENDED"] as const) {
      expect(kiemThemMembership({ campaign: camp, doiTac: { status }, hienCo: null }).ok, status).toBe(false);
    }
    expect(kiemThemMembership({ campaign: camp, doiTac: null, hienCo: null }).ok).toBe(false);
  });

  it("đầu vào: nhãn rỗng thành null; kết thúc không sau bắt đầu bị chặn; trường lạ bị từ chối", () => {
    const ok = themMembershipSchema.safeParse({ partyId: "p1", groupLabel: "  ", effectiveFrom: null, effectiveTo: null });
    expect(ok.success && ok.data.groupLabel).toBeNull();
    expect(themMembershipSchema.safeParse({ partyId: "p1", groupLabel: null, effectiveFrom: TU, effectiveTo: TU }).success).toBe(false);
    expect(themMembershipSchema.safeParse({ partyId: "", groupLabel: null, effectiveFrom: null, effectiveTo: null }).success).toBe(false);
    expect(themMembershipSchema.safeParse({ partyId: "p1", groupLabel: null, effectiveFrom: null, effectiveTo: null, status: "ACTIVE" }).success).toBe(false);
  });
});

describe("[AFM-02] chuyển trạng thái membership", () => {
  const ctx = { campaign: { status: "ACTIVE" as const }, doiTac: { status: "ACTIVE" as const } };

  it("bảng chuyển: PENDING→ACTIVE/ENDED · ACTIVE→SUSPENDED/ENDED · SUSPENDED→ACTIVE/ENDED · ENDED không đi đâu", () => {
    const den = (t: keyof typeof CHUYEN_MEMBERSHIP) => CHUYEN_MEMBERSHIP[t].map((x) => x.den).sort();
    expect(den("PENDING")).toEqual(["ACTIVE", "ENDED"]);
    expect(den("ACTIVE")).toEqual(["ENDED", "SUSPENDED"]);
    expect(den("SUSPENDED")).toEqual(["ACTIVE", "ENDED"]);
    expect(den("ENDED")).toEqual([]);
  });

  it("nhảy cóc bị chặn: PENDING→SUSPENDED, ACTIVE→PENDING, ENDED→ACTIVE", () => {
    for (const [tu, den] of [["PENDING", "SUSPENDED"], ["ACTIVE", "PENDING"], ["ENDED", "ACTIVE"]] as const) {
      expect(kiemChuyenMembership({ ...ctx, tu, den, lyDo: "lý do dài đủ rồi" }).ok, `${tu}→${den}`).toBe(false);
    }
  });

  it("duyệt và cho tham gia lại không đòi lý do; từ chối · tạm ngừng · kết thúc đòi ≥ 10 ký tự", () => {
    expect(kiemChuyenMembership({ ...ctx, tu: "PENDING", den: "ACTIVE", lyDo: null }).ok).toBe(true);
    expect(kiemChuyenMembership({ ...ctx, tu: "SUSPENDED", den: "ACTIVE", lyDo: null }).ok).toBe(true);
    for (const [tu, den] of [["PENDING", "ENDED"], ["ACTIVE", "SUSPENDED"], ["ACTIVE", "ENDED"], ["SUSPENDED", "ENDED"]] as const) {
      const thieu = kiemChuyenMembership({ ...ctx, tu, den, lyDo: "ngắn" });
      expect(thieu.ok, `${tu}→${den}`).toBe(false);
      if (!thieu.ok) expect(thieu.truong).toBe("lyDo");
      expect(kiemChuyenMembership({ ...ctx, tu, den, lyDo: "Đối tác không còn hợp tác" }).ok, `${tu}→${den}`).toBe(true);
    }
  });

  it("vào / quay lại ACTIVE: campaign ENDED chặn, đối tác không hoạt động chặn; RÚT LUI (tạm ngừng / kết thúc) thì luôn được", () => {
    const camEnded = { campaign: { status: "ENDED" as const }, doiTac: { status: "ACTIVE" as const } };
    const dtTat = { campaign: { status: "ACTIVE" as const }, doiTac: { status: "SUSPENDED" as const } };
    expect(kiemChuyenMembership({ ...camEnded, tu: "PENDING", den: "ACTIVE", lyDo: null }).ok).toBe(false);
    expect(kiemChuyenMembership({ ...dtTat, tu: "PENDING", den: "ACTIVE", lyDo: null }).ok).toBe(false);
    expect(kiemChuyenMembership({ ...dtTat, tu: "SUSPENDED", den: "ACTIVE", lyDo: null }).ok).toBe(false);
    expect(kiemChuyenMembership({ ...camEnded, tu: "ACTIVE", den: "ENDED", lyDo: "Campaign đã kết thúc" }).ok).toBe(true);
    expect(kiemChuyenMembership({ ...dtTat, tu: "ACTIVE", den: "SUSPENDED", lyDo: "Đối tác bị tạm ngừng" }).ok).toBe(true);
  });
});

describe("[AFM-03] kết thúc: hiệu lực-đến phải SAU hiệu lực-từ", () => {
  it("dòng đã bắt đầu từ trước ⇒ chốt hiệu lực-đến ở `now`", () => {
    expect(tinhHieuLucKhiKetThuc({ effectiveFrom: TU, effectiveTo: null, now: NOW })).toEqual({ ok: true, effectiveTo: NOW });
  });

  it("đã có hạn trong QUÁ KHỨ thì giữ hạn đó (không kéo dài); hạn còn ở tương lai thì rút về `now`", () => {
    const qua = new Date("2026-10-10T00:00:00.000Z");
    expect(tinhHieuLucKhiKetThuc({ effectiveFrom: TU, effectiveTo: qua, now: NOW })).toEqual({ ok: true, effectiveTo: qua });
    expect(tinhHieuLucKhiKetThuc({ effectiveFrom: TU, effectiveTo: new Date("2027-01-01T00:00:00.000Z"), now: NOW })).toEqual({ ok: true, effectiveTo: NOW });
  });

  it("hiệu lực CHƯA bắt đầu ⇒ chặn bằng câu tiếng Việt nêu ngày bắt đầu (CHECK `effectiveTo > effectiveFrom` sẽ nổ nếu để lọt)", () => {
    const r = tinhHieuLucKhiKetThuc({ effectiveFrom: new Date("2026-11-01T00:00:00.000Z"), effectiveTo: null, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.loi).toContain("01/11/2026");
      expect(r.loi).not.toMatch(/check|constraint/i);
    }
  });

  it("hiệu lực bắt đầu ĐÚNG lúc `now` ⇒ cũng chặn (bằng nhau vi phạm CHECK); lệch 1 mili-giây thì qua", () => {
    expect(tinhHieuLucKhiKetThuc({ effectiveFrom: NOW, effectiveTo: null, now: NOW }).ok).toBe(false);
    expect(tinhHieuLucKhiKetThuc({ effectiveFrom: new Date(NOW.getTime() - 1), effectiveTo: null, now: NOW }).ok).toBe(true);
  });
});

describe("[AFM-04] sửa nhãn / hiệu lực", () => {
  const hienTai = { groupLabel: "Nhóm A", effectiveFrom: TU, effectiveTo: null };
  const sua = (status: Parameters<typeof kiemSuaMembership>[0]["status"], patch: object, lyDo: string | null = null) =>
    kiemSuaMembership({ status, hienTai, patch: suaMembershipSchema.parse(patch), lyDo });

  it("ENDED không sửa", () => {
    expect(sua("ENDED", { groupLabel: "B" }).ok).toBe(false);
  });

  it("đổi nhãn nhóm không cần lý do ở mọi trạng thái còn sống; gửi lại đúng giá trị cũ không tính là đổi", () => {
    for (const s of ["PENDING", "ACTIVE", "SUSPENDED"] as const) expect(sua(s, { groupLabel: "Nhóm B" })).toEqual({ ok: true, truongDoi: ["groupLabel"], canLyDo: false });
    expect(sua("ACTIVE", { groupLabel: "Nhóm A", effectiveFrom: TU })).toEqual({ ok: true, truongDoi: [], canLyDo: false });
  });

  it("ngày bắt đầu chỉ đổi khi còn PENDING", () => {
    const moi = new Date("2026-09-01T00:00:00.000Z");
    expect(sua("PENDING", { effectiveFrom: moi }).ok).toBe(true);
    const r = sua("ACTIVE", { effectiveFrom: moi }, "lý do dài đủ rồi nhé");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.truong).toBe("effectiveFrom");
  });

  it("đổi hạn trên dòng đang tham gia đòi lý do ≥ 10 ký tự; trên dòng chờ duyệt thì không", () => {
    const han = new Date("2027-01-01T00:00:00.000Z");
    const thieu = sua("ACTIVE", { effectiveTo: han });
    expect(thieu.ok).toBe(false);
    if (!thieu.ok) expect(thieu.truong).toBe("lyDo");
    expect(sua("ACTIVE", { effectiveTo: han }, "Gia hạn theo hợp đồng mới").ok).toBe(true);
    expect(sua("PENDING", { effectiveTo: han }).ok).toBe(true);
  });

  it("hạn không sau ngày bắt đầu ⇒ chặn", () => {
    const r = sua("PENDING", { effectiveTo: TU });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.truong).toBe("effectiveTo");
  });
});
