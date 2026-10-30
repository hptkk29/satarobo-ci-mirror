"use client";

// Tab "Agent & khoá": tạo Agent, tạo lại khoá, công tắc khẩn, công tắc hợp đồng. Nút nào bấm được là nút làm thật; nút bị khoá luôn kèm LÝ DO bằng chữ.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AgentView } from "@/lib/ai-lead/dich-vu/cau-hinh";
import { datContractStatusAction, datHoatDongAgentAction, taoAgentAction, taoLaiKhoaAction, voHieuHoaAgentTestTrenProdAction, type CauHinhKhoa } from "../_actions";
import { HopKhoa } from "../../_components/hop-khoa";
import { NhanDon } from "../../_components/nhan-trang-thai";
import { NutLyDo } from "../../_components/nut-ly-do";
import { LOP_O_CHON, LOP_O_NHAP, LOP_THE } from "../../_components/lop";
import { gioVn } from "../../_components/dinh-dang";

const CHU_CONTRACT = { COMPATIBLE: "Tương thích", DEPRECATED: "Sắp loại bỏ", INCOMPATIBLE: "Không tương thích" } as const;
type HopDong = keyof typeof CHU_CONTRACT;

export function AgentVaKhoa({
  agents,
  masterKeyOk,
  congProdMo,
  coQuyenQuanLy,
  testDuocChay,
}: {
  agents: AgentView[];
  masterKeyOk: boolean;
  congProdMo: boolean;
  coQuyenQuanLy: boolean;
  /** FIX-03: máy chủ này có cho Agent TEST không (false = hệ thống PROD). BẮT BUỘC truyền — mặc định ngầm sẽ vẽ ô chọn TEST rồi để máy chủ từ chối. */
  testDuocChay: boolean;
}) {
  const router = useRouter();
  const [ten, datTen] = useState("");
  const [moiTruong, datMoiTruong] = useState<"TEST" | "PROD">(testDuocChay ? "TEST" : "PROD");
  const [loi, datLoi] = useState<string | null>(null);
  const [khoa, datKhoa] = useState<{ cauHinh: CauHinhKhoa; tieuDe: string } | null>(null);
  const [dangTao, batDau] = useTransition();
  const [contractMoi, datContractMoi] = useState<Record<string, HopDong>>({});

  const khongHopLe = agents.filter((a) => !a.moiTruongHopLe);
  // Tách CẤP khỏi KÍCH HOẠT: cổng PROD đóng vẫn TẠO được Agent PROD, nhưng nó ra đời ở trạng thái TẮT.
  const seTatKhiTao = moiTruong === "PROD" && !congProdMo;
  const khongTao = !masterKeyOk;
  const lyDoKhongTao = !masterKeyOk ? "Máy chủ chưa đặt AI_LEAD_AGENT_MASTER_KEY — chưa tạo được khoá. Báo bộ phận kỹ thuật." : null;

  function tao(e: React.FormEvent) {
    e.preventDefault();
    datLoi(null);
    batDau(async () => {
      const r = await taoAgentAction({ name: ten, environment: moiTruong });
      if (!r.ok) {
        datLoi(r.error);
        return;
      }
      datTen("");
      if (r.active === false) toast.warning("Agent được tạo ở trạng thái TẮT vì cổng PROD đang đóng. Chỉ bật được sau khi chính sách đồng ý được duyệt.");
      datKhoa({ cauHinh: r, tieuDe: `Khoá của Agent “${r.name}”` });
      router.refresh();
    });
  }

  return (
    <div className="grid gap-5">
      {!masterKeyOk ? (
        <p role="alert" className="rounded-lg bg-state-danger-soft px-4 py-3 text-sm text-state-danger-ink">
          Máy chủ chưa đặt <code className="font-mono">AI_LEAD_AGENT_MASTER_KEY</code> (≥ 32 ký tự). Chưa tạo / đổi được khoá Agent nào cho tới khi kỹ thuật đặt biến này.
        </p>
      ) : null}

      {coQuyenQuanLy ? (
        <form onSubmit={tao} className={`${LOP_THE} grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end`} aria-label="Tạo Agent mới">
          <div className="grid gap-1.5">
            <label htmlFor="agent-ten" className="text-sm font-medium">
              Tên Agent
            </label>
            <Input id="agent-ten" value={ten} onChange={(e) => datTen(e.target.value)} className={LOP_O_NHAP} maxLength={80} placeholder="VD: AI Messenger — Page Sata Robo" required />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="agent-mt" className="text-sm font-medium">
              Môi trường
            </label>
            <select id="agent-mt" value={moiTruong} onChange={(e) => datMoiTruong(e.target.value as "TEST" | "PROD")} className={LOP_O_CHON}>
              {testDuocChay ? <option value="TEST">TEST</option> : null}
              <option value="PROD">PROD</option>
            </select>
          </div>
          <Button type="submit" className="min-h-11" disabled={khongTao || dangTao || ten.trim().length < 3}>
            {dangTao ? "Đang tạo…" : "Tạo Agent"}
          </Button>
          {lyDoKhongTao ? <p className="text-xs text-muted-foreground sm:col-span-3">{lyDoKhongTao}</p> : null}
          {seTatKhiTao && !lyDoKhongTao ? (
            <p role="note" className="rounded-lg bg-state-warning-soft px-3 py-2 text-xs text-state-warning-ink sm:col-span-3">
              Cổng PROD đang đóng: Agent sẽ được tạo ở trạng thái <b>TẮT</b> — chưa nhận được yêu cầu nào dù có khoá. Bật Agent chỉ được sau khi chính sách đồng ý được duyệt (tab “Chính sách &amp; cổng PROD”).
            </p>
          ) : null}
          {!testDuocChay ? <p className="text-xs text-muted-foreground sm:col-span-3">Đây là hệ thống PROD: không tạo được Agent TEST (Agent TEST chỉ chạy ở môi trường TEST).</p> : null}
          {loi ? (
            <p role="alert" className="text-sm text-state-danger-ink sm:col-span-3">
              {loi}
            </p>
          ) : null}
        </form>
      ) : (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Bạn chỉ có quyền xem. Tạo Agent, tạo lại khoá và công tắc khẩn thuộc Quản trị tối cao (<code className="font-mono">ai-integration:manage</code>).
        </p>
      )}

      {khongHopLe.length > 0 ? (
        <div role="alert" className="grid gap-3 rounded-lg bg-state-danger-soft px-4 py-3 text-sm text-state-danger-ink">
          <p>
            <b>{khongHopLe.length} Agent TEST đang nằm trên hệ thống PROD</b> ({khongHopLe.map((a) => `“${a.name}”`).join(", ")}). Máy chủ chặn mọi yêu cầu của chúng (401 AGENT_DISABLED) và Trung tâm kết nối luôn
            hiện BLOCKED. Agent TEST không đi qua cổng PROD nên không được phép tạo lead thật.
          </p>
          {coQuyenQuanLy && khongHopLe.some((a) => a.active) ? (
            <div>
              <NutLyDo
                nhan="Vô hiệu hoá Agent TEST trên PROD"
                tieuDe="Tắt mọi Agent TEST đang bật trên PROD?"
                moTa="Chỉ TẮT (không xoá): giữ nguyên khoá, Page, hội thoại và nhật ký để điều tra. Mỗi Agent được ghi một dòng nhật ký kèm lý do."
                nhanXacNhan="Vô hiệu hoá"
                thongBaoXong="Đã vô hiệu hoá Agent TEST trên PROD."
                chay={(lyDo) => voHieuHoaAgentTestTrenProdAction({ lyDo })}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {agents.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <p className="text-sm font-semibold">Chưa có Agent nào</p>
          <p className="mt-1 text-sm text-muted-foreground">Tạo Agent đầu tiên (môi trường TEST) rồi gửi khoá cho đội Agent. Khoá chỉ hiện đúng một lần.</p>
        </div>
      ) : (
        <ul className="grid gap-4 2xl:grid-cols-2">
          {agents.map((a) => {
            const hd: HopDong = contractMoi[a.id] ?? a.contractStatus;
            return (
              <li key={a.id} className={LOP_THE}>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="min-w-0 break-words text-base font-semibold">{a.name}</h2>
                  <NhanDon tone={a.environment === "PROD" ? "warning" : "info"}>{a.environment}</NhanDon>
                  <NhanDon tone={a.active ? "info" : "danger"}>{a.active ? "Đang bật" : "ĐÃ TẮT"}</NhanDon>
                  {!a.moiTruongHopLe ? <NhanDon tone="danger">KHÔNG HỢP LỆ TRÊN PROD</NhanDon> : null}
                </div>
                <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">Mã Agent</dt>
                    <dd className="font-mono text-xs [overflow-wrap:anywhere]">{a.id}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Phiên bản khoá</dt>
                    <dd>v{a.secretVersion}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Hợp đồng (công tắc tay)</dt>
                    <dd>{CHU_CONTRACT[a.contractStatus]}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Nhịp sống gần nhất (Agent khai)</dt>
                    <dd>{gioVn(a.lastHeartbeatAt)}</dd>
                  </div>
                </dl>

                {coQuyenQuanLy ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <NutLyDo
                      nhan="Tạo lại khoá"
                      tieuDe={`Tạo lại khoá của “${a.name}”?`}
                      moTa={
                        <>
                          Khoá cũ <b>chết ngay</b>: Agent đang chạy sẽ nhận 401 cho tới khi đội Agent dán khoá mới. Khoá mới chỉ hiện một lần.
                        </>
                      }
                      nhanXacNhan="Tạo lại khoá"
                      disabled={!masterKeyOk}
                      thongBaoXong="Đã tạo khoá mới."
                      chay={async (lyDo) => {
                        const r = await taoLaiKhoaAction({ agentId: a.id, secretVersionDangThay: a.secretVersion, lyDo });
                        if (!r.ok) return r;
                        datKhoa({ cauHinh: r, tieuDe: `Khoá MỚI của Agent “${r.name}”` });
                        return { ok: true };
                      }}
                    />
                    {a.active ? (
                      <NutLyDo
                        nhan="Tắt Agent (công tắc khẩn)"
                        tieuDe={`Tắt Agent “${a.name}”?`}
                        moTa="Mọi yêu cầu của Agent này bị từ chối (401 AGENT_DISABLED) ngay lập tức, kể cả chuyển giao cho nhân viên. Khách đang nhắn sẽ không được AI trả lời."
                        nhanXacNhan="Tắt Agent"
                        thongBaoXong="Đã tắt Agent."
                        chay={(lyDo) => datHoatDongAgentAction({ agentId: a.id, active: false, lyDo })}
                      />
                    ) : !a.moiTruongHopLe ? (
                      <p className="max-w-[22rem] self-center text-xs text-muted-foreground">Không bật lại được: Agent TEST không chạy trên hệ thống PROD.</p>
                    ) : (
                      <NutLyDo
                        nhan="Bật lại Agent"
                        tieuDe={`Bật lại Agent “${a.name}”?`}
                        moTa={a.environment === "PROD" && !congProdMo ? "Cổng PROD đang đóng — máy chủ sẽ từ chối bật Agent PROD." : "Agent nhận lại được yêu cầu ngay."}
                        nhanXacNhan="Bật lại"
                        nguyHiem={false}
                        thongBaoXong="Đã bật lại Agent."
                        chay={(lyDo) => datHoatDongAgentAction({ agentId: a.id, active: true, lyDo })}
                      />
                    )}
                    <NutLyDo
                      nhan="Đặt hợp đồng…"
                      tieuDe={`Đặt trạng thái hợp đồng của “${a.name}”`}
                      moTa={
                        <>
                          <b>Không tương thích</b> làm <code className="font-mono">/lead-intakes</code> của Agent này bị từ chối (400 UNSUPPORTED_CONTRACT); các endpoint khác vẫn dùng được. Hash lạ KHÔNG
                          tự đổi công tắc này.
                        </>
                      }
                      nhanXacNhan="Đặt trạng thái"
                      thongBaoXong="Đã đặt trạng thái hợp đồng."
                      truongThem={
                        <div className="grid gap-1.5">
                          <label htmlFor={`hd-${a.id}`} className="text-sm font-medium">
                            Trạng thái
                          </label>
                          <select
                            id={`hd-${a.id}`}
                            className={LOP_O_CHON}
                            value={hd}
                            onChange={(e) => datContractMoi((m) => ({ ...m, [a.id]: e.target.value as HopDong }))}
                          >
                            <option value="COMPATIBLE">Tương thích</option>
                            <option value="DEPRECATED">Sắp loại bỏ</option>
                            <option value="INCOMPATIBLE">Không tương thích (chặn /lead-intakes)</option>
                          </select>
                        </div>
                      }
                      kiemThem={() => (hd === a.contractStatus ? "Chọn một trạng thái KHÁC trạng thái hiện tại." : null)}
                      chay={(lyDo) => datContractStatusAction({ agentId: a.id, contractStatus: hd, lyDo })}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <HopKhoa
        cauHinh={khoa?.cauHinh ?? null}
        tieuDe={khoa?.tieuDe ?? ""}
        onDong={() => {
          datKhoa(null);
          toast.message("Đã đóng hộp khoá.");
        }}
      />
    </div>
  );
}
