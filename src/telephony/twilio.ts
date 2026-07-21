import twilio from "twilio";

export function twilioClient() {
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

/**
 * Place an outbound call whose audio is bridged to our media
 * websocket. PUBLIC_HOST must be the public https host (e.g. an
 * ngrok/cloudflared tunnel in dev).
 */
export async function placeCall(to: string, taskId: string): Promise<{ callSid: string }> {
  const host = process.env.PUBLIC_HOST!;
  const call = await twilioClient().calls.create({
    to,
    from: process.env.TWILIO_FROM_NUMBER!,
    url: `https://${host}/twiml?taskId=${encodeURIComponent(taskId)}`,
    statusCallback: `https://${host}/call-status?taskId=${encodeURIComponent(taskId)}`,
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    machineDetection: "Enable",
    timeout: 40
  });
  return { callSid: call.sid };
}

export function twimlForStream(taskId: string): string {
  const host = process.env.PUBLIC_HOST!;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${host}/media">
      <Parameter name="taskId" value="${taskId}"/>
    </Stream>
  </Connect>
</Response>`;
}
