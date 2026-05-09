export interface AnkiRequest {
  action: string;
  params?: Record<string, unknown>;
  version?: number;
}

export interface AnkiResponse<TResult> {
  error: string | null;
  result: TResult;
}

export class AnkiConnectClient {
  constructor(
    private readonly endpoint = "http://127.0.0.1:8765",
    private readonly version = 6,
  ) {}

  async invoke<TResult>(request: AnkiRequest): Promise<TResult> {
    const response = await fetch(this.endpoint, {
      body: JSON.stringify({
        action: request.action,
        params: request.params ?? {},
        version: request.version ?? this.version,
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    const payload = (await response.json()) as AnkiResponse<TResult>;
    if (payload.error) {
      throw new Error(payload.error);
    }

    return payload.result;
  }
}
