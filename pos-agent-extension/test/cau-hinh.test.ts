/**
 * Cấu hình trang Options (hợp đồng §2): agentId · centerCode · merchantCode · agentSecret ·
 * satAroboBaseUrl. Bí mật: đúng 64 hex THƯỜNG sau `trim()`, từ chối chuỗi khác — KHÔNG tự sửa
 * hoa/thường; lưu rồi thì KHÔNG BAO GIỜ trả lại (chỉ báo "đã có").
 */
import { describe, expect, it } from "vitest";
import { docCauHinhDaLuu, gocChoPhepTuManifest, kiemBiMat, kiemCauHinh, xemCongKhai } from "../src/lib/cau-hinh";
import { AGENT_ID, BI_MAT, GOC_PROD, GOC_TEST, MERCHANT, PORTAL } from "./ho-tro/du-lieu";

const GOC = [GOC_PROD];
const HOP_LE = { agentId: AGENT_ID, centerCode: "CS1", merchantCode: MERCHANT, satAroboBaseUrl: GOC_PROD };

describe("Cấu hình extension", () => {
  it("[EXT-CH-01] cấu hình hợp lệ được nhận (trim khoảng trắng, bỏ một '/' cuối địa chỉ)", () => {
    const kq = kiemCauHinh({ ...HOP_LE, agentId: `  ${AGENT_ID} `, satAroboBaseUrl: `${GOC_PROD}/` }, GOC);
    expect(kq).toEqual({ ok: true, cauHinh: HOP_LE });
  });

  it("[EXT-CH-02] từng ô sai ⇒ lỗi đúng ô, không tự sửa merchant thành chữ hoa", () => {
    const kq = kiemCauHinh(
      { agentId: "AGENT_HOA", centerCode: "", merchantCode: "nccph6ke", satAroboBaseUrl: "https://admin.satarobo.vn.evil.example" },
      GOC,
    );
    expect(kq.ok).toBe(false);
    if (kq.ok) return;
    expect(Object.keys(kq.loi).sort()).toEqual(["agentId", "centerCode", "merchantCode", "satAroboBaseUrl"]);
  });

  it("[EXT-CH-03] địa chỉ satarobo phải đúng host gói này được phép (bản PROD không nhận TEST và ngược lại)", () => {
    expect(kiemCauHinh({ ...HOP_LE, satAroboBaseUrl: GOC_TEST }, GOC).ok).toBe(false);
    expect(kiemCauHinh({ ...HOP_LE, satAroboBaseUrl: GOC_TEST }, [GOC_TEST]).ok).toBe(true);
    for (const u of ["http://admin.satarobo.vn", "https://admin.satarobo.vn/api", "https://admin.satarobo.vn?x", ""]) {
      expect(kiemCauHinh({ ...HOP_LE, satAroboBaseUrl: u }, GOC).ok).toBe(false);
    }
  });

  it("[EXT-CH-04] bí mật: 64 hex thường (sau trim) mới nhận; chữ HOA / 63 ký tự / ký tự lạ ⇒ từ chối, không tự sửa", () => {
    expect(kiemBiMat(`  ${BI_MAT}\n`)).toEqual({ ok: true, biMat: BI_MAT });
    expect(kiemBiMat(BI_MAT.toUpperCase()).ok).toBe(false);
    expect(kiemBiMat(BI_MAT.slice(1)).ok).toBe(false);
    expect(kiemBiMat(`${BI_MAT.slice(1)}g`).ok).toBe(false);
    expect(kiemBiMat(123).ok).toBe(false);
    const sai = kiemBiMat("xyz");
    expect(sai.ok).toBe(false);
    if (!sai.ok) expect(sai.loi).not.toContain("xyz"); // câu lỗi KHÔNG lặp lại chuỗi người dán
  });

  it("[EXT-CH-05] xemCongKhai KHÔNG BAO GIỜ chứa bí mật — kể cả khi dữ liệu lưu lỡ lẫn bí mật", () => {
    const xem = xemCongKhai({ ...HOP_LE, agentSecret: BI_MAT, biMat: BI_MAT }, true, GOC);
    const s = JSON.stringify(xem);
    expect(s).not.toContain(BI_MAT);
    expect(s).not.toMatch(/agentSecret|biMat/);
    expect(xem).toEqual({ cauHinh: HOP_LE, coBiMat: true, gocChoPhep: GOC });
    expect(xemCongKhai(undefined, false, GOC)).toEqual({ cauHinh: null, coBiMat: false, gocChoPhep: GOC });
  });

  it("[EXT-CH-06] host được phép đọc từ host_permissions của manifest (bỏ portal, chỉ host satarobo đã biết)", () => {
    expect(gocChoPhepTuManifest([`${PORTAL}/*`, `${GOC_PROD}/*`])).toEqual([GOC_PROD]);
    expect(gocChoPhepTuManifest([`${PORTAL}/*`, `${GOC_TEST}/*`])).toEqual([GOC_TEST]);
    expect(gocChoPhepTuManifest([`${PORTAL}/*`, "https://evil.example/*"])).toEqual([]);
  });

  it("[EXT-CH-07] docCauHinhDaLuu: dữ liệu lưu bị hỏng/thiếu ⇒ null (extension coi như chưa cấu hình, không chạy)", () => {
    expect(docCauHinhDaLuu(HOP_LE, GOC)).toEqual(HOP_LE);
    expect(docCauHinhDaLuu({ ...HOP_LE, merchantCode: "x" }, GOC)).toBeNull();
    expect(docCauHinhDaLuu(null, GOC)).toBeNull();
    expect(docCauHinhDaLuu("rác", GOC)).toBeNull();
  });
});
