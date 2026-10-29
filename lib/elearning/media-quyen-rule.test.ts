// @vitest-environment node
/**
 * [MQR] Quyền truy cập media MỖI LƯỢT — luật thuần. Mỗi nhánh từ chối có ca riêng + ca đối chứng dương cùng đầu vào chỉ khác đúng
 * một trường (không thì "bị từ chối" đúng cả khi luật hỏng hoàn toàn).
 */
import { describe, it, expect } from "vitest";
import { quyetDinhMedia, type BaiHienHanh } from "@/lib/elearning/media-quyen-rule";

const BAI: BaiHienHanh = {
  mediaRevision: 3,
  videoKey: "elearning/master/l1/moi.mp4",
  videoKey360: "elearning/master/l1/moi-360.mp4",
  captionKey: "elearning/caption/l1/vi.vtt",
  audioKey: "elearning/audio/l1/a.m4a",
};
const VE = { lessonId: "l1", userId: "u1", exp: 9e15, rev: 3 };
const hoi = (o: Partial<Parameters<typeof quyetDinhMedia>[0]> = {}) =>
  quyetDinhMedia({ ve: VE, khoa: BAI.videoKey!, bai: BAI, coGhiDanhHopLe: true, ...o });

describe("[MQR-01] phiên bản của vé", () => {
  it("vé đúng phiên bản hiện tại ⇒ qua", () => expect(hoi()).toEqual({ ok: true }));
  it("🔴 vé phiên bản CŨ ⇒ 409 NOI_DUNG_DA_DOI (không phải 403/404 chung chung: trình phát hiểu 'tải lại trang')", () => {
    expect(hoi({ ve: { ...VE, rev: 2 } })).toMatchObject({ ok: false, status: 409, code: "NOI_DUNG_DA_DOI" });
  });
  it("vé phiên bản MỚI HƠN bài (không thể có thật) cũng bị từ chối — không chỉ 'cũ hơn'", () => {
    expect(hoi({ ve: { ...VE, rev: 4 } })).toMatchObject({ ok: false, code: "NOI_DUNG_DA_DOI" });
  });
  it("vé phát trước khi có phiên bản (không `rev`) = 1: qua khi bài còn ở phiên bản 1, bị từ chối khi bài ở 3", () => {
    const veCu = { lessonId: "l1", userId: "u1", exp: 9e15 };
    expect(hoi({ ve: veCu, bai: { ...BAI, mediaRevision: 1 } })).toEqual({ ok: true });
    expect(hoi({ ve: veCu })).toMatchObject({ ok: false, code: "NOI_DUNG_DA_DOI" });
  });
});

describe("[MQR-02] khoá tệp phải là một trong các tệp HIỆN HÀNH của bài", () => {
  it("bốn loại tệp hiện hành đều qua", () => {
    for (const k of [BAI.videoKey, BAI.videoKey360, BAI.captionKey, BAI.audioKey]) {
      expect(hoi({ khoa: k! }), k!).toEqual({ ok: true });
    }
  });
  it("🔴 tệp CŨ (cùng bài, cùng tiền tố, còn trên R2) ⇒ 404 — cho dù vé hợp lệ", () => {
    expect(hoi({ khoa: "elearning/master/l1/CU.mp4" })).toMatchObject({ ok: false, status: 404, code: "NOT_FOUND" });
  });
  it("bài chuyển sang YouTube (mọi khoá tệp null) ⇒ 404 cho mọi khoá", () => {
    const yt = { ...BAI, videoKey: null, videoKey360: null, captionKey: null, audioKey: null };
    expect(hoi({ bai: yt })).toMatchObject({ ok: false, status: 404 });
  });
  it("khoá rỗng không khớp trường null (null ≠ '')", () => {
    expect(hoi({ khoa: "", bai: { ...BAI, videoKey: null } })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
  it("🔴 lộ tệp cũ qua thông báo: 'tệp cũ' và 'bài không có' cùng một thông báo", () => {
    const a = hoi({ khoa: "elearning/master/l1/CU.mp4" });
    const b = hoi({ bai: null });
    expect(a).toMatchObject({ ok: false });
    expect(b).toMatchObject({ ok: false });
    if (!a.ok && !b.ok) expect(a.message).toBe(b.message);
  });
});

describe("[MQR-03] ghi danh và bài còn hay không", () => {
  it("ghi danh bị thu hồi / không có ⇒ 403 FORBIDDEN", () => {
    expect(hoi({ coGhiDanhHopLe: false })).toMatchObject({ ok: false, status: 403, code: "FORBIDDEN" });
  });
  it("bài không tồn tại ⇒ 404", () => {
    expect(hoi({ bai: null })).toMatchObject({ ok: false, status: 404, code: "NOT_FOUND" });
  });
  it("thứ tự: bài → phiên bản → khoá → ghi danh (người bị thu hồi cầm vé cũ nhận NOI_DUNG_DA_DOI trước, không phải FORBIDDEN)", () => {
    expect(hoi({ coGhiDanhHopLe: false, ve: { ...VE, rev: 1 } })).toMatchObject({ code: "NOI_DUNG_DA_DOI" });
    expect(hoi({ coGhiDanhHopLe: false, khoa: "elearning/master/l1/CU.mp4" })).toMatchObject({ code: "NOT_FOUND" });
    expect(hoi({ coGhiDanhHopLe: false })).toMatchObject({ code: "FORBIDDEN" });
  });
});
