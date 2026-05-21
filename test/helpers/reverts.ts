import { expect } from "chai";

/// Assert that an async function (typically a deploy or write call wrapped in an arrow)
/// rejects with an error whose serialized message mentions `errorName`. Useful for
/// constructor reverts where the higher-level `viem.assertions.revertWithCustomError`
/// helper can't attach a contract handle yet.
export async function expectRevertWithMessage(action: () => Promise<unknown>, pattern: string | RegExp): Promise<void> {
  let threw = false;
  try {
    await action();
  } catch (err) {
    threw = true;
    const message = serializeError(err);
    if (typeof pattern === "string") {
      expect(message).to.include(pattern);
    } else {
      expect(message).to.match(pattern);
    }
  }
  expect(threw, "expected promise to reject").to.equal(true);
}

function serializeError(err: unknown): string {
  if (err instanceof Error) {
    const parts: string[] = [err.message];
    let cause: unknown = (err as { cause?: unknown }).cause;
    while (cause !== undefined && cause !== null) {
      if (cause instanceof Error) {
        parts.push(cause.message);
        cause = (cause as { cause?: unknown }).cause;
      } else {
        parts.push(String(cause));
        break;
      }
    }
    return parts.join("\n");
  }
  return String(err);
}
