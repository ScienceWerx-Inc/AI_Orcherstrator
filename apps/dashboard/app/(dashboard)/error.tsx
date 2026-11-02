"use client";

import { useEffect } from "react";
import { buttonClasses, ErrorBanner, PageHeader } from "@/components/ui";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <>
      <PageHeader title="Something went wrong" />
      <ErrorBanner message={error.message || "Unexpected dashboard error"} />
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={reset} className={buttonClasses.primary}>
          Retry
        </button>
        <a href="/" className={buttonClasses.secondary}>
          Back to overview
        </a>
      </div>
    </>
  );
}
