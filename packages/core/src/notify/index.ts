import type { AlertRule } from "../rules/index";

// Home Assistant webhook payload. The client lands in Epic 7.
export interface NotificationPayload {
  currency: string;
  imageUrl: string | null;
  inStock: boolean | null;
  pctChange: number | null;
  previousPrice: string | null;
  price: string;
  productId: string;
  rule: AlertRule | "tracker_broken";
  title: string | null;
  url: string;
}
