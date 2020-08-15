import { helloWorld } from "../index";

describe(helloWorld, () => {
  it("works", () => {
    expect(helloWorld()).toBe("hello world");
  });
});
