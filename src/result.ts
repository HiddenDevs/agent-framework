export class Result<T, E = Error> {
    private constructor(
        private readonly outcome: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E },
    ) {}

    public static ok<T, E = Error>(value: T): Result<T, E> {
        return new Result<T, E>({ ok: true, value });
    }

    public static err<T = never, E = Error>(error: E): Result<T, E> {
        return new Result<T, E>({ ok: false, error });
    }

    public get isOk(): boolean {
        return this.outcome.ok;
    }

    /** Throws when the result is an error. */
    public get value(): T {
        if (!this.outcome.ok) {
            throw new Error("Cannot read the value of an error result.");
        }
        return this.outcome.value;
    }

    /** Throws when the result is ok. */
    public get error(): E {
        if (this.outcome.ok) {
            throw new Error("Cannot read the error of an ok result.");
        }
        return this.outcome.error;
    }
}
