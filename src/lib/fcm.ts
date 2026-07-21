import { initializeApp, cert, getApps, type App } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { env } from "../config/env.js";

export const isFcmConfigured = !!(env.FCM_PROJECT_ID && env.FCM_CLIENT_EMAIL && env.FCM_PRIVATE_KEY);

let app: App | null = null;

if (isFcmConfigured) {
  app =
    getApps()[0] ??
    initializeApp({
      credential: cert({
        projectId: env.FCM_PROJECT_ID,
        clientEmail: env.FCM_CLIENT_EMAIL,
        privateKey: env.FCM_PRIVATE_KEY.replace(/\\n/g, "\n"),
      }),
    });
}

export interface PushNotification {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

export async function sendPushNotification(notification: PushNotification): Promise<void> {
  if (!isFcmConfigured || !app) {
    console.log(`[dev-push] Would send to ${notification.token}: "${notification.title}" — ${notification.body}`);
    return;
  }

  await getMessaging(app).send({
    token: notification.token,
    notification: { title: notification.title, body: notification.body },
    data: notification.data,
  });
}