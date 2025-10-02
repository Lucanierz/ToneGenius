import React from "react";

export default function ResultBadge({
  status,
  message,
}: {
  status: "ok" | "err";
  message: string;
}) {
  return <div className={`result ${status}`}>{message}</div>;
}
