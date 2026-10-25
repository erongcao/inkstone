/**
 * 检查更新：版本号比较。
 *
 * 「1.10.0 比 1.9.0 新」——字符串比较会**反过来**（"1.9" > "1.10"），
 * 所以这层必须有自己的测试。
 */

import { describe, expect, it } from "vitest";
import { compareVersions } from "@/ipc/update";

describe("版本号比较", () => {
  it("按数字逐段比，不是按字符串比", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
    expect(compareVersions("1.9.0", "1.10.0")).toBe(-1);
    expect(compareVersions("0.2.0", "0.1.9")).toBe(1);
  });

  it("相同版本返回 0", () => {
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
  });

  it("v 前缀不影响比较", () => {
    expect(compareVersions("v0.2.0", "0.1.0")).toBe(1);
    expect(compareVersions("0.2.0", "v0.1.0")).toBe(1);
  });

  it("段数不同：缺的段当 0", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.1", "1.2")).toBe(1);
    expect(compareVersions("1.2", "1.2.1")).toBe(-1);
  });

  it("预发布版比同号的正式版旧", () => {
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBe(-1);
    expect(compareVersions("1.0.0", "1.0.0-beta.1")).toBe(1);
    expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.1")).toBe(1);
  });

  it("非数字段当 0，不会崩", () => {
    expect(compareVersions("1.x.0", "1.0.0")).toBe(0);
    expect(compareVersions("", "0.0.0")).toBe(0);
  });

  it("大小写不敏感的 v 前缀", () => {
    expect(compareVersions("V1.2.0", "1.1.0")).toBe(1);
  });
});
