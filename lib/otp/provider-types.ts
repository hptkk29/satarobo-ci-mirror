// AUTH-SĐT P4 — types dùng chung của OTP provider, tách file riêng để cắt vòng
// import lib/otp/provider ↔ lib/zalo/otp-provider (dependency-cruiser no-circular:
// import type vẫn bị tính là cạnh phụ thuộc).

export type OtpChannelKey = "EMAIL" | "SMS" | "ZALO";

export interface OtpSendInput {
  target: string; // email hoặc SĐT
  code: string; // mã 6 số (plain — chỉ để gửi, KHÔNG lưu plain)
  purpose: "ACTIVATION" | "RESET" | "CHANGE_CONTACT";
  minutesValid: number;
}

export interface OtpSendResult {
  ok: boolean;
  provider: string;
  error?: string;
}

export interface OtpProvider {
  channel: OtpChannelKey;
  name: string;
  send(input: OtpSendInput): Promise<OtpSendResult>;
}
