// @vitest-environment node
/**
 * [DDB-CPC-*] Quản lý cơ sở cấu hình PHẦN CỦA CƠ SỞ MÌNH — đường GHI thật (`luuPhuongCuaCoSo`) trên Postgres thật.
 *   [DDB-CPC-01] đổi đúng phần của mình, công tắc GIỮ NGUYÊN (kể cả khi đang BẬT), có dấu vết `lead.chia-theo-phuong.luu-co-so`
 *   [DDB-CPC-02] giật phường của cơ sở khác ⇒ từ chối và bảng KHÔNG đổi chữ nào (nguyên khối)
 *   [DDB-CPC-03] nhiều người lưu CÙNG LÚC (hai cơ sở, nhiều phường) ⇒ không mất thay đổi của ai (khoá cố vấn)
 *   [DDB-CPC-04] Quản trị (`luuCauHinhPhuong`) vẫn đổi được phường của bất kỳ cơ sở + bật/tắt (đối chứng của 02)
 * Dòng `IntegrationConfig LEAD_PHUONG_CO_SO` là TOÀN CỤC: bộ test chụp lại nguyên trạng trước khi chạy và khôi phục sau cùng.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { coSoCauHinhPhuongCuaToi, layCauHinhPhuongDeSua, layCoSoNhanLead, luuCauHinhPhuong, luuPhuongCuaCoSo } from "../../lib/lead/chia-theo-phuong-ghi";
import { coSoCuaCacPhuong, PROVIDER_PHUONG_CO_SO } from "../../lib/lead/chia-theo-phuong";
import { RUN, assertCiTest } from "./_fx";

const describeDb = RUN ? describe : describe.skip;
const TP = "Tp Đà Nẵng";
const ACTOR = { id: "ddb-cpc-actor", name: "DDB CPC" };
const PHUONG = ["Phường Hải Châu", "Phường An Hải", "Phường Thanh Khê", "Phường Sơn Trà", "Phường Hòa Cường", "Phường Ngũ Hành Sơn"];

let truoc: { isEnabled: boolean; settings: unknown } | null = null;
let cs: { id: string; name: string }[] = [];

const docBang = async () => coSoCuaCacPhuong((await layCauHinhPhuongDeSua()).bang, TP, PHUONG);
const datTrang = (bat: boolean) =>
  db.integrationConfig.upsert({
    where: { provider: PROVIDER_PHUONG_CO_SO },
    create: { provider: PROVIDER_PHUONG_CO_SO, isEnabled: bat, settings: { phienBan: 1, map: {} } },
    update: { isEnabled: bat, settings: { phienBan: 1, map: {} } },
  });

describeDb("[DDB-CPC] Quản lý cơ sở cấu hình phần của cơ sở mình", () => {
  beforeAll(async () => {
    await assertCiTest();
    await db.auditLog.deleteMany({ where: { actorId: ACTOR.id } }); // dấu vết của lượt chạy trước (nếu lượt đó chết giữa chừng)
    truoc = await db.integrationConfig.findUnique({ where: { provider: PROVIDER_PHUONG_CO_SO }, select: { isEnabled: true, settings: true } });
    cs = await layCoSoNhanLead();
    expect(cs.length).toBeGreaterThanOrEqual(2); // cần ÍT NHẤT hai cơ sở nhận lead để có «cơ sở khác»
  });
  afterAll(async () => {
    if (truoc) {
      await db.integrationConfig.update({ where: { provider: PROVIDER_PHUONG_CO_SO }, data: { isEnabled: truoc.isEnabled, settings: truoc.settings as object } });
    } else {
      await db.integrationConfig.deleteMany({ where: { provider: PROVIDER_PHUONG_CO_SO } });
    }
    await db.auditLog.deleteMany({ where: { actorId: ACTOR.id } });
    await db.$disconnect();
  });

  it("[DDB-CPC-01] đổi đúng phần của mình; công tắc giữ nguyên (đang BẬT); có dấu vết", async () => {
    const [a, b] = cs;
    await datTrang(true);
    const r = await luuPhuongCuaCoSo({
      thanhPho: TP,
      dong: [
        { phuong: PHUONG[0]!, coSoId: a!.id },
        { phuong: PHUONG[1]!, coSoId: a!.id },
      ],
      coSoCuaToi: [a!.id],
      actor: ACTOR,
    });
    expect(r).toEqual({ ok: true, bat: true, soPhuongDaDat: 2 });
    const hien = await layCauHinhPhuongDeSua();
    expect(hien.bat).toBe(true); // công tắc KHÔNG bị đụng
    const bang = await docBang();
    expect(bang[PHUONG[0]!]).toBe(a!.id);
    expect(bang[PHUONG[1]!]).toBe(a!.id);
    expect(bang[PHUONG[2]!]).toBeNull();
    // trả một phường về trống
    const r2 = await luuPhuongCuaCoSo({ thanhPho: TP, dong: [{ phuong: PHUONG[1]!, coSoId: null }], coSoCuaToi: [a!.id], actor: ACTOR });
    expect(r2.ok && r2.soPhuongDaDat).toBe(1);
    const vet = await db.auditLog.findMany({ where: { actorId: ACTOR.id, action: "lead.chia-theo-phuong.luu-co-so" } });
    expect(vet.length).toBe(2);
    void b;
  });

  it("[DDB-CPC-02] giật phường của cơ sở khác ⇒ từ chối, bảng KHÔNG đổi (nguyên khối)", async () => {
    const [a, b] = cs;
    await datTrang(false);
    expect((await luuPhuongCuaCoSo({ thanhPho: TP, dong: [{ phuong: PHUONG[2]!, coSoId: b!.id }], coSoCuaToi: [b!.id], actor: ACTOR })).ok).toBe(true);
    const truocBang = await docBang();
    const r = await luuPhuongCuaCoSo({
      thanhPho: TP,
      dong: [
        { phuong: PHUONG[3]!, coSoId: a!.id }, // hợp lệ…
        { phuong: PHUONG[2]!, coSoId: a!.id }, // …nhưng giật phường của cơ sở b
      ],
      coSoCuaToi: [a!.id],
      actor: ACTOR,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/đang thuộc cơ sở khác/);
    expect(await docBang()).toEqual(truocBang); // dòng hợp lệ đi cùng cũng KHÔNG được lưu
    const r3 = await luuPhuongCuaCoSo({ thanhPho: TP, dong: [{ phuong: PHUONG[3]!, coSoId: b!.id }], coSoCuaToi: [a!.id], actor: ACTOR });
    expect(r3.ok).toBe(false); // đặt cho cơ sở không phải của mình
  });

  it("[DDB-CPC-03] nhiều người lưu cùng lúc ⇒ không mất thay đổi của ai", async () => {
    const [a, b] = cs;
    await datTrang(false);
    // 6 lượt song song, mỗi lượt đặt MỘT phường khác nhau (xen kẽ hai cơ sở): đọc-sửa-ghi không khoá sẽ làm các lượt đè nhau.
    const luot = PHUONG.map((p, i) => {
      const co = i % 2 === 0 ? a! : b!;
      return luuPhuongCuaCoSo({ thanhPho: TP, dong: [{ phuong: p, coSoId: co.id }], coSoCuaToi: [co.id], actor: ACTOR });
    });
    const kq = await Promise.all(luot);
    expect(kq.every((x) => x.ok)).toBe(true);
    const bang = await docBang();
    PHUONG.forEach((p, i) => expect(bang[p], p).toBe(i % 2 === 0 ? a!.id : b!.id));
  });

  it("[DDB-CPC-04] Quản trị đổi được phường của bất kỳ cơ sở và bật/tắt (đối chứng)", async () => {
    const [a, b] = cs;
    await datTrang(false);
    await luuPhuongCuaCoSo({ thanhPho: TP, dong: [{ phuong: PHUONG[0]!, coSoId: b!.id }], coSoCuaToi: [b!.id], actor: ACTOR });
    const r = await luuCauHinhPhuong({ bat: true, thanhPho: TP, dong: [{ phuong: PHUONG[0]!, coSoId: a!.id }], actor: ACTOR });
    expect(r).toEqual({ ok: true, bat: true, soPhuongDaDat: 1 });
    expect((await docBang())[PHUONG[0]!]).toBe(a!.id);
    expect((await layCauHinhPhuongDeSua()).bat).toBe(true);
  });

  it("[DDB-CPC-05] «cơ sở của tôi»: chỉ cơ sở nhận lead mà người đó giữ lead_pool:manage tại đó", async () => {
    const [a, b] = cs;
    const actor = (centerScope: "ALL" | string[]) => ({ isSuperAdmin: false, grantsAllow: new Set<string>(), permissions: [{ action: "lead_pool:manage", centerScope }] }) as never;
    expect((await coSoCauHinhPhuongCuaToi(actor([a!.id]))).map((c) => c.id)).toEqual([a!.id]);
    expect((await coSoCauHinhPhuongCuaToi(actor([]))).length).toBe(0);
    expect((await coSoCauHinhPhuongCuaToi(actor("ALL"))).map((c) => c.id).sort()).toEqual(cs.map((c) => c.id).sort());
    void b;
  });
});
