export type Protocol = "acp" | "ucp" | "x402" | "mpp" | "unknown";
export type Party = "agent" | "merchant" | "psp";

export interface Exchange {
  id: number;
  ts: string;
  method: string;
  path: string;
  reqHeaders: Record<string, string>;
  reqBody: unknown;
  status: number;
  resHeaders: Record<string, string>;
  resBody: unknown;
  durationMs: number;
}

export interface TapeEvent {
  id: number;
  ts: string;
  protocol: Protocol;
  step: string;
  from: Party;
  to: Party;
  summary: string;
  session?: string;
  amount?: number; // minor units
  currency?: string;
  status?: string;
  /** "consent" = total the agent/user saw and agreed to; "payment" = amount actually charged/authorised */
  role?: "consent" | "payment" | "info";
  exchange: Exchange;
  anomalies: Anomaly[];
}

export interface Anomaly {
  code: string;
  severity: "high" | "medium" | "low";
  message: string;
}

export type Parser = (ex: Exchange) => Omit<TapeEvent, "id" | "ts" | "exchange" | "anomalies"> | null;
