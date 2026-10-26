export type JSONValue = string | number | boolean | null | { [key: string]: JSONValue } | JSONValue[];
export type MaybeAsync<T> = T | Promise<T>;
