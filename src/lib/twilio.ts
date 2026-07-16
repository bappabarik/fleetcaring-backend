import twilio from "twilio";
import { env } from "../config/env.js";

const isConfigured = !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_VERIFY_SERVICE_SID);

const client = isConfigured ? twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN) : null;

const DEV_FALLBACK_CODE = "0000";

export async function sendOtp(phoneNumber: string): Promise<void> {
  if (!client) {
    // Dev fallback: no Twilio credentials configured yet, so local dev
    // doesn't require a real Twilio account. Logs instead of sending.
    console.log(
      `[dev-otp] No Twilio credentials configured — OTP for ${phoneNumber} is "${DEV_FALLBACK_CODE}"`
    );
    return;
  }

  await client.verify.v2.services(env.TWILIO_VERIFY_SERVICE_SID).verifications.create({
    to: phoneNumber,
    channel: "sms",
  });
}

export async function checkOtp(phoneNumber: string, code: string): Promise<boolean> {
  if (!client) {
    return code === DEV_FALLBACK_CODE;
  }

  const check = await client.verify.v2
    .services(env.TWILIO_VERIFY_SERVICE_SID)
    .verificationChecks.create({ to: phoneNumber, code });

  return check.status === "approved";
}
