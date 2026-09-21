import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Отсутствует обязательная переменная окружения: ${name}`);
  }
  return value;
}

export const config = {
  asana: {
    accessToken: required("ASANA_ACCESS_TOKEN"),
    webhookSecret: process.env.ASANA_WEBHOOK_SECRET ?? "",
  },
  anthropic: {
    apiKey: required("ANTHROPIC_API_KEY"),
    model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
  },
  server: {
    port: Number(process.env.PORT ?? 3000),
    publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "",
  },
  reportProjectGid: process.env.REPORT_PROJECT_GID ?? "",
  duplicateScan: {
    cron: process.env.DUPLICATE_SCAN_CRON ?? "0 9 * * 0",
    timezone: process.env.DUPLICATE_SCAN_TZ ?? "Europe/Madrid",
  },
};
