export class ModelClientError extends Error {
    public constructor(
        message: string,
        /** HTTP status, or -1 for non-HTTP failures. */
        public readonly statusCode: number,
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = "ModelClientError";
    }

    public static wrap(error: unknown): ModelClientError {
        if (error instanceof ModelClientError) return error;
        const message = error instanceof Error ? error.message : String(error);
        const status = (error as { status?: unknown } | null)?.status;
        return new ModelClientError(message, typeof status === "number" ? status : -1, { cause: error });
    }

    public isRateLimited(): boolean {
        return this.statusCode === 429;
    }

    public isAuthenticationFailure(): boolean {
        return this.statusCode === 401 || this.statusCode === 403;
    }
}
