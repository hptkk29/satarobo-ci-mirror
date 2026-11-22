"use client";

// Ghi nhận MỘT lần kiểm chứng thủ công (L1 hợp đồng · L3 đầu-cuối · L4 pilot PROD). L2 KHÔNG nhập tay: nó chỉ sinh ra từ thăm dò hai chiều.
// Luật nhập nằm ở `kiemLanChayNhap` (THUẦN, dùng chung với máy chủ — máy chủ kiểm lại, đừng coi chặn ở đây là cổng).
// MOCK_ONLY ghi được nhưng luôn hiển thị là "chỉ giả lập" và KHÔNG BAO GIỜ tính là đạt.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LOAI_THEO_TANG, kiemLanChayNhap, type LanChayNhap, type TrangThaiLanChay } from "@/lib/ai-lead/dich-vu/ket-noi-thuan";
import { ghiLanChayAction } from "../_actions";
import { LOP_O_CHON, LOP_O_NHAP } from "../../_components/lop";

export type AgentChoGhi = { id: string; name: string; environment: "TEST" | "PROD"; pageIds: string[]; lastBuildSha: string | null; lastContractHash: string | null };

const TANG_NHAP = ["L1", "L3", "L4"] as const;
const TRANG_THAI_NHAP: { v: TrangThaiLanChay; nhan: string }[] = [
  { v: "PASS", nhan: "PASS — đạt" },
  { v: "FAIL", nhan: "FAIL — thất bại" },
  { v: "BLOCKED", nhan: "BLOCKED — bị chặn" },
  { v: "NOT_RUN", nhan: "NOT_RUN — chưa chạy" },
  { v: "MOCK_ONLY", nhan: "MOCK_ONLY — chỉ giả lập (không tính)" },
];

export function GhiLanChay({ agents, hashHienHanh }: { agents: AgentChoGhi[]; hashHienHanh: string }) {
  const router = useRouter();
  const [mo, datMo] = useState(false);
  const [tang, datTang] = useState<(typeof TANG_NHAP)[number]>("L3");
  const [agentId, datAgentId] = useState(agents[0]?.id ?? "");
  const [status, datStatus] = useState<TrangThaiLanChay>("PASS");
  const [contractHash, datContractHash] = useState("");
  const [buildSha, datBuildSha] = useState("");
  const [correlationId, datCorrelationId] = useState("");
  const [testRunId, datTestRunId] = useState("");
  const [signoffBy, datSignoffBy] = useState("");
  const [lyDo, datLyDo] = useState("");
  const [loi, datLoi] = useState<string | null>(null);
  const [dang, batDau] = useTransition();

  const agent = agents.find((a) => a.id === agentId);
  const laL1 = tang === "L1";
  // Gợi ý (KHÔNG tự điền thay người): để trống thì dùng giá trị agent đang khai; L1 dùng hash hợp đồng hiện hành.
  const hashDung = contractHash.trim() || (laL1 ? hashHienHanh : (agent?.lastContractHash ?? ""));
  const buildDung = buildSha.trim() || (laL1 ? "" : (agent?.lastBuildSha ?? ""));

  const nhap: LanChayNhap | null = useMemo(() => {
    if (!laL1 && !agent) return null;
    return {
      agentId: laL1 ? null : agent!.id,
      level: tang,
      status,
      kind: LOAI_THEO_TANG[tang],
      ...(hashDung ? { contractHash: hashDung } : {}),
      ...(buildDung ? { buildSha: buildDung } : {}),
      ...(correlationId.trim() ? { correlationId: correlationId.trim() } : {}),
      bangChung: {
        environment: agent?.environment ?? "TEST",
        pageIds: laL1 ? [] : (agent?.pageIds ?? []),
        ...(testRunId.trim() ? { testRunId: testRunId.trim() } : {}),
        ...(signoffBy.trim() ? { signoffBy: signoffBy.trim() } : {}),
      },
      lyDo,
    };
  }, [laL1, agent, tang, status, hashDung, buildDung, correlationId, testRunId, signoffBy, lyDo]);

  const loiNhap = nhap ? kiemLanChayNhap(nhap) : "Chọn Agent.";

  function gui() {
    if (!nhap || loiNhap) return;
    datLoi(null);
    batDau(async () => {
      const r = await ghiLanChayAction({
        agentId: nhap.agentId,
        level: nhap.level,
        status: nhap.status,
        contractHash: nhap.contractHash,
        buildSha: nhap.buildSha,
        correlationId: nhap.correlationId,
        bangChung: nhap.bangChung,
        lyDo: nhap.lyDo,
      });
      if (!r.ok) {
        datLoi(r.error);
        return;
      }
      toast.success(status === "MOCK_ONLY" ? "Đã ghi lần chạy giả lập (không tính là đạt)." : "Đã ghi nhận lần kiểm chứng.");
      datMo(false);
      datLyDo("");
      router.refresh();
    });
  }

  return (
    <>
      <Button type="button" variant="outline" className="min-h-11" onClick={() => datMo(true)}>
        Ghi nhận lần kiểm chứng…
      </Button>
      <Dialog open={mo} onOpenChange={(m) => (dang ? undefined : datMo(m))}>
        <DialogContent showCloseButton={false} className="admin-scope max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Ghi nhận lần kiểm chứng</DialogTitle>
            <DialogDescription render={<div />}>
              L2 không nhập tay — nó chỉ sinh ra từ thăm dò hai chiều đã được Agent xác nhận. Mọi lần ghi vào nhật ký kèm lý do.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <label htmlFor="glc-tang" className="text-sm font-medium">
                Tầng
              </label>
              <select id="glc-tang" className={LOP_O_CHON} value={tang} onChange={(e) => datTang(e.target.value as typeof tang)}>
                {TANG_NHAP.map((t) => (
                  <option key={t} value={t}>
                    {t} — {({ L1: "Hợp đồng", L3: "Đầu-cuối", L4: "Thử thật PROD" } as const)[t]}
                  </option>
                ))}
              </select>
            </div>
            {!laL1 ? (
              <div className="grid gap-1.5">
                <label htmlFor="glc-agent" className="text-sm font-medium">
                  Agent
                </label>
                <select id="glc-agent" className={LOP_O_CHON} value={agentId} onChange={(e) => datAgentId(e.target.value)}>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.environment})
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <label htmlFor="glc-kq" className="text-sm font-medium">
                Kết quả
              </label>
              <select id="glc-kq" className={LOP_O_CHON} value={status} onChange={(e) => datStatus(e.target.value as TrangThaiLanChay)}>
                {TRANG_THAI_NHAP.map((t) => (
                  <option key={t.v} value={t.v}>
                    {t.nhan}
                  </option>
                ))}
              </select>
              {status === "MOCK_ONLY" ? <p className="text-xs text-muted-foreground">Sẽ hiển thị là “chỉ giả lập” và KHÔNG được tính là đạt ở bất kỳ tầng nào.</p> : null}
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="glc-hash" className="text-sm font-medium">
                contractHash (64 hex)
              </label>
              <Input id="glc-hash" className={`${LOP_O_NHAP} font-mono text-xs`} value={contractHash} onChange={(e) => datContractHash(e.target.value)} placeholder={hashDung || "bỏ trống = dùng giá trị hiện hành"} />
            </div>
            {!laL1 ? (
              <>
                <div className="grid gap-1.5">
                  <label htmlFor="glc-build" className="text-sm font-medium">
                    buildSha
                  </label>
                  <Input id="glc-build" className={`${LOP_O_NHAP} font-mono text-xs`} value={buildSha} onChange={(e) => datBuildSha(e.target.value)} placeholder={buildDung || "bản build đã chạy"} />
                </div>
                <div className="grid gap-1.5">
                  <label htmlFor="glc-corr" className="text-sm font-medium">
                    correlationId (UUID, bắt buộc khi PASS)
                  </label>
                  <Input id="glc-corr" className={`${LOP_O_NHAP} font-mono text-xs`} value={correlationId} onChange={(e) => datCorrelationId(e.target.value)} placeholder="11111111-2222-3333-4444-555555555555" />
                </div>
              </>
            ) : null}
            <div className="grid gap-1.5">
              <label htmlFor="glc-run" className="text-sm font-medium">
                testRunId (tuỳ chọn)
              </label>
              <Input id="glc-run" className={LOP_O_NHAP} value={testRunId} onChange={(e) => datTestRunId(e.target.value)} />
            </div>
            {tang === "L4" ? (
              <div className="grid gap-1.5">
                <label htmlFor="glc-ky" className="text-sm font-medium">
                  Người ký của chủ dự án (bắt buộc khi PASS)
                </label>
                <Input id="glc-ky" className={LOP_O_NHAP} value={signoffBy} onChange={(e) => datSignoffBy(e.target.value)} />
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <label htmlFor="glc-lydo" className="text-sm font-medium">
                Lý do / ghi chú (bắt buộc, ≥ 10 ký tự)
              </label>
              <Textarea id="glc-lydo" rows={2} maxLength={500} value={lyDo} onChange={(e) => datLyDo(e.target.value)} />
            </div>
          </div>
          {loiNhap ? <p className="text-xs text-muted-foreground">{loiNhap}</p> : null}
          {loi ? (
            <p role="alert" className="rounded-md bg-state-danger-soft px-3 py-2 text-sm text-state-danger-ink">
              {loi}
            </p>
          ) : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={() => datMo(false)} disabled={dang}>
              Huỷ
            </Button>
            <Button type="button" className="min-h-11" disabled={!!loiNhap || dang} onClick={gui}>
              {dang ? "Đang ghi…" : "Ghi nhận"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
