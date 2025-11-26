import pino from "pino";
import pinoHttp from "pino-http";

export const logger = pino({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  transport: process.env.NODE_ENV === "production"
    ? undefined
    : {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:standard" },
      },
});

export const httpLogger = pinoHttp({
  logger,
  autoLogging: {
    ignorePaths: ["/health"], // 👈 log ikke Render health checks
    // evt. også "/favicon.ico" hvis den larmer
  },
});
