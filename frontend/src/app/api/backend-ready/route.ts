const BACKEND_ORIGIN = (process.env.API_INTERNAL_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const MAX_ATTEMPTS = 20;
const RETRY_DELAY_MS = 1500;

const noStoreHeaders = {
  "Cache-Control": "no-store",
};

function forwardResponse(response: Response) {
  return new Response(response.body, {
    status: response.status,
    headers: {
      ...noStoreHeaders,
      "Content-Type": response.headers.get("Content-Type") || "application/json",
    },
  });
}

export async function GET() {
  let lastNetworkError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(`${BACKEND_ORIGIN}/api/admin/setup/status`, {
        cache: "no-store",
      });

      if (response.status < 500 || attempt === MAX_ATTEMPTS) {
        return forwardResponse(response);
      }
    } catch (error) {
      lastNetworkError = error;
      if (attempt === MAX_ATTEMPTS) {
        console.error("Backend readiness check failed after retries.", lastNetworkError);
        return Response.json(
          { detail: "Backend is unavailable." },
          { status: 503, headers: noStoreHeaders }
        );
      }
    }

    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }

  return Response.json(
    { detail: "Backend is unavailable." },
    { status: 503, headers: noStoreHeaders }
  );
}
