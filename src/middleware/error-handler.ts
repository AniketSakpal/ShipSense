import type {
  ErrorRequestHandler,
} from "express";

export const errorHandler: ErrorRequestHandler = (
  error,
  _req,
  res,
  _next,
) => {
  console.error("Unhandled request error", {
    message:
      error instanceof Error
        ? error.message
        : "UNKNOWN_ERROR",
  });

  if (res.headersSent) {
    return;
  }

  res.status(503).json({
    error: "SERVICE_TEMPORARILY_UNAVAILABLE",
  });
};