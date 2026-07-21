import type { FastifyInstance } from "fastify";
import { NotificationsService } from "../modules/notifications/notifications.service.js";

const STATUS_MESSAGES: Record<string, string> = {
  ASSIGNED: "A pilot has been assigned to your service.",
  ON_THE_WAY: "Your pilot is on the way.",
  ARRIVED: "Your pilot has arrived.",
  IN_PROGRESS: "Your service is now in progress.",
  COMPLETED: "Your service has been completed.",
  ISSUE_RAISED: "There's an issue with your service — check the app for details.",
  ORDER_COMPLETED: "Your order is complete. Thanks for choosing FleetCaring!",
  CANCELLED: "This service has been cancelled.",
  ORDER_CANCELLED: "Your order has been cancelled.",
};

export async function notifyOrderUpdate(
  app: FastifyInstance,
  orderId: string,
  shipmentId: string | null,
  status: string
): Promise<void> {
  try {
    await app.realtime.publish(`order:${orderId}:updates`, {
      type: "shipment_status",
      orderId,
      shipmentId,
      status,
      at: new Date().toISOString(),
    });
  } catch (err) {
    app.log.warn({ err, orderId }, "Failed to publish realtime order update");
  }

  try {
    const order = await app.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return;

    const message = STATUS_MESSAGES[status];
    if (!message) return;

    const notifications = new NotificationsService(app);
    await notifications.notifyActor("CUSTOMER", order.userId, "FleetCaring update", message, {
      orderId,
      status,
    });
  } catch (err) {
    app.log.warn({ err, orderId }, "Failed to send push notification for order update");
  }
}