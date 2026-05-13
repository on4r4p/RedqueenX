import { describe, expect, it } from "vitest";
import { looksLikeXApiCreditsDepleted, xApiErrorCode } from "../src/xApiErrors";

describe("X API error helpers", () => {
  it("detects X CreditsDepleted responses from HTTP 402 errors", () => {
    expect(looksLikeXApiCreditsDepleted(new Error("Request failed with code 402 CreditsDepleted"))).toBe(true);
    expect(looksLikeXApiCreditsDepleted({ statusCode: 402, data: { title: "CreditsDepleted" } })).toBe(true);
  });

  it("does not treat regular X API failures as depleted credits", () => {
    expect(looksLikeXApiCreditsDepleted(new Error("Request failed with code 429"))).toBe(false);
    expect(looksLikeXApiCreditsDepleted(new Error("Internal server error"))).toBe(false);
  });

  it("extracts numeric X API error codes from common error shapes", () => {
    expect(xApiErrorCode(new Error("Request failed with code 402"))).toBe("402");
    expect(xApiErrorCode({ status: 429 })).toBe("429");
  });
});
