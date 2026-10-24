// [CUT-CLI-*] tham số + cổng NHẬP của công cụ cutover (`cutover-cong-cu.ts`, thuần).
import { describe, expect, it } from "vitest";
import { docThamSoCli, kiemApDung, type ThamSoCli } from "./cutover-cong-cu";

const v = (p: Partial<ThamSoCli> = {}): ThamSoCli => ({ tu: null, den: null, coSo: ["CS1"], apply: true, xacNhanDb: "satarobo_test", json: null, guiThongBao: false, chayBong: null, ...p });
const kiem = (p: Partial<Parameters<typeof kiemApDung>[0]> = {}) =>
  kiemApDung({ v: v(), dbHienTai: "satarobo_test", sanSangGhi: "READY", lyDoChan: [], phanCongBat: { CS1: true }, duyetProd: null, ...p });

describe("[CUT-CLI] công cụ cutover", () => {
  it("[CUT-CLI-01] mặc định DRY RUN; tham số lạ ⇒ lỗi; --apply không đi cùng --chay-bong; --gui-thong-bao cần --apply", () => {
    expect(docThamSoCli([])).toEqual({ ok: true, v: { tu: null, den: null, coSo: null, apply: false, xacNhanDb: null, json: null, guiThongBao: false, chayBong: null } });
    expect(docThamSoCli(["--tu=2026-10-19", "--co-so=CS1, CS2", "--chay-bong=2026-11"])).toMatchObject({ ok: true, v: { tu: "2026-10-19", coSo: ["CS1", "CS2"], chayBong: "2026-11" } });
    expect(docThamSoCli(["--apply=yes"]).ok).toBe(false);
    expect(docThamSoCli(["--xoa-het"]).ok).toBe(false);
    expect(docThamSoCli(["--apply", "--chay-bong=2026-11"]).ok).toBe(false);
    expect(docThamSoCli(["--gui-thong-bao"]).ok).toBe(false);
  });

  it("[CUT-CLI-02] --apply qua ĐỦ vế ⇒ cho phép; thiếu --apply ⇒ DRY RUN", () => {
    expect(kiem()).toEqual({ ok: true });
    expect(kiem({ v: v({ apply: false }) })).toMatchObject({ ok: false, lyDo: ["DRY RUN — không có --apply."] });
  });

  it("[CUT-CLI-03] từ chối: DB không khớp · chưa sẵn sàng ghi (RBAC v1) · công tắc phân công tắt ở một cơ sở · phạm vi rỗng · prod thiếu mã duyệt", () => {
    expect(kiem({ dbHienTai: "satarobo_khac" }).ok).toBe(false);
    expect(kiem({ sanSangGhi: "BLOCKED", lyDoChan: ["RBAC_V2_REQUIRED_FOR_PARTTIME"] })).toMatchObject({ ok: false, lyDo: ["Chưa sẵn sàng ghi: RBAC_V2_REQUIRED_FOR_PARTTIME"] });
    expect(kiem({ phanCongBat: { CS1: true, CS2: false } })).toMatchObject({ ok: false, lyDo: ["Công tắc phân công CHƯA bật ở: CS2."] });
    expect(kiem({ phanCongBat: {} }).ok).toBe(false);
    expect(kiem({ v: v({ xacNhanDb: "satarobo" }), dbHienTai: "satarobo" })).toMatchObject({ ok: false, lyDo: ["DB PROD: thiếu PARTTIME_CUTOVER_PROD_DUYET (mã duyệt của chủ dự án)."] });
    expect(kiem({ v: v({ xacNhanDb: "satarobo" }), dbHienTai: "satarobo", duyetProd: "  " }).ok).toBe(false);
  });
});
