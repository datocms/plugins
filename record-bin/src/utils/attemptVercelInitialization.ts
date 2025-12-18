const attemptVercelInitialization = async (
  vercelURL: string,
  environment: string
) => {
  const requestBody = { event_type: "initialization", environment, vercelURL };

  const parsedBody = JSON.stringify(requestBody);

  await fetch(vercelURL, {
    method: "POST",
    body: parsedBody,
    headers: { Accept: "*/*", "Content-Type": "application/json" },
  });
};

export default attemptVercelInitialization;
