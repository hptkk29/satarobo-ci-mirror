// @vitest-environment node
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { originCuaRequest } from "@/lib/http/request-origin";

// Mô phỏng đúng cảnh trên VPS: server lắng nghe 0.0.0.0:3000, Caddy chuyển tiếp kèm header.
function reqSauCaddy(headers: Record<string, string>) {
  return new NextRequest("https://0.0.0.0:3000/api/admin/cham-cong/qr-token", { headers });
}

describe("originCuaRequest", () => {
  it("[ORIGIN-01] sau Caddy: lấy host người dùng gõ, KHÔNG phải 0.0.0.0:3000", () => {
    expect(
      originCuaRequest(reqSauCaddy({ host: "admin.satarobo.vn", "x-forwarded-host": "admin.satarobo.vn", "x-forwarded-proto": "https" })),
    ).toBe("https://admin.satarobo.vn");
  });

  it("[ORIGIN-02] chỉ có Host (không X-Forwarded-*) vẫn ra https + host thật", () => {
    expect(originCuaRequest(reqSauCaddy({ host: "giaovien.satarobo.vn" }))).toBe("https://giaovien.satarobo.vn");
  });

  it("[ORIGIN-03] header rác ⇒ rơi về nextUrl.origin, không bịa", () => {
    expect(originCuaRequest(reqSauCaddy({ host: "bad host/../x" }))).toBe("https://0.0.0.0:3000");
  });
});
