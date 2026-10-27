import { describe, expect, it } from "vitest";
import { parseExportArgs } from "./export-args";

describe("export CLI arguments", () => {
  it("applies the same refined preset and tuning to empty and SVG bins", () => {
    const flags = ["--preset", "refined", "--magnet-diameter", "6.3", "--magnet-thickness", "2.15",
      "--magnet-skin", ".45", "--magnet-side", "left", "--magnet-release", "off", "--magnet-placement", "all", "--magnet-crush-depth", ".15"];
    const empty = parseExportArgs(flags), svg = parseExportArgs(["--svg", "s.svg", "--object-depth", "12", ...flags]);
    expect(empty.spec).toMatchObject({ lipNotches: true, magnetHoles: true, magnetStyle: "refined", screwHoles: false });
    expect(empty.spec.refinedMagnet).toEqual(svg.svgOptions.refinedMagnet);
    expect(svg.svgOptions).toMatchObject({ baseStyle: "refined-magnets", lipNotches: true });
    expect(parseExportArgs(["--base-style", "solid"]).spec.magnetHoles).toBe(false);
    expect(parseExportArgs(["--base-style", "flat"]).spec.flatBottom).toBe(true);
    expect(() => parseExportArgs(["--project", "p.json", "--preset", "refined"])).toThrow("saved");
    expect(() => parseExportArgs(["--magnet-diameter", "6.3"])).toThrow("requires");
    expect(() => parseExportArgs(["--preset", "refined", "--magnet-side", "up"])).toThrow("Invalid");
  });
  it("exposes conforming access floors and entry bevels", () => {
    const args = parseExportArgs(["--svg", "s.svg", "--object-depth", "12", "--depth-profile", "p.json",
      "--finger-follow-ramp", "--finger-chamfer", "0.5"]);
    expect(args.svgOptions.fingerAccess).toEqual({ depthMode: "nearest-profile", topChamferMm: .5 });
    expect(() => parseExportArgs(["--finger-follow-ramp"])).toThrow("require --svg");
  });
  it("parses multiple outgoing depth transitions in source millimetres", () => {
    const args = parseExportArgs(["--svg", "tool.svg", "--object-depth", "12", "--depth-axis", "y",
      "--depth-station", "0:11", "--depth-station", "40:11:smooth", "--depth-station", "60:4:linear", "--depth-station", "80:3"]);
    expect(args.svgOptions.depthProfile).toEqual({ axis: "y", stations: [
      { atMm: 0, depthMm: 11, transition: "step" }, { atMm: 40, depthMm: 11, transition: "smooth" },
      { atMm: 60, depthMm: 4, transition: "linear" }, { atMm: 80, depthMm: 3, transition: "step" },
    ] });
    expect(parseExportArgs(["--svg", "tool.svg", "--object-depth", "12", "--depth-profile", "profile.json"]).depthProfilePath).toBe("profile.json");
  });
  it.each([
    ["--depth-axis", "z"], ["--depth-axis", "x"], ["--depth-station", "bad"],
    ["--depth-station", "0:4", "--depth-station", "0:6"],
    ["--depth-station", "0:4", "--depth-station", "10:6:bezier"],
    ["--depth-profile", "p.json", "--depth-station", "0:4"],
    ["--depth-profile", "p.json", "--depth-axis", "y"],
  ])("rejects ambiguous or invalid profile syntax %j", (...args) => {
    expect(() => parseExportArgs(["--svg", "tool.svg", "--object-depth", "12", ...args])).toThrow();
  });
  it("preserves the empty-bin defaults and legacy solid/no-lip syntax", () => {
    expect(parseExportArgs([]).spec).toEqual({ gridX: 2, gridY: 3, heightUnits: 6, fill: "none", lip: "standard" });
    expect(parseExportArgs(["4x2x3", "--fill", "solid", "--no-lip"]).spec)
      .toEqual({ gridX: 4, gridY: 2, heightUnits: 3, fill: "solid", lip: "none" });
  });

  it("keeps SVG sizing automatic and distinguishes body depth from total height", () => {
    const args = parseExportArgs(["--svg", "tool.svg", "--object-depth", "9", "--object-height", "15", "--plan"]);
    expect(args.svgOptions).toEqual({ objectDepthMm: 9, objectHeightMm: 15 });
    expect(args.planOnly).toBe(true);
    expect(args.svgPath).toBe("tool.svg");
  });

  it("preserves original last-value-wins options for legacy empty-bin commands", () => {
    const args = parseExportArgs(["1x1x2", "4x2x3", "--fill", "none", "--fill", "solid",
      "--no-lip", "--no-lip", "--out", "first", "--out", "last"]);
    expect(args.spec).toEqual({ gridX: 4, gridY: 2, heightUnits: 3, fill: "solid", lip: "none" });
    expect(args.outDir).toBe("last");
  });

  it("preserves negative custom coordinates and explicit rotation without order dependence", () => {
    const args = parseExportArgs(["--svg", "tool.svg", "--finger-center", "-10,8", "--finger-diameter", "12",
      "--finger-center", "10,-8", "--object-depth", "10", "--rotation", "-45", "--finger-access", "custom"]);
    expect(args.svgOptions.fingerAccess).toEqual({ placement: "custom", diameterMm: 12, centers: [{ x: -10, y: 8 }, { x: 10, y: -8 }] });
    expect(args.svgOptions.rotationDeg).toBe(-45);
  });

  it.each([
    ["--svg", "tool.svg"], ["--object-depth", "10"], ["--svg", "tool.svg", "--object-depth", "NaN"],
    ["--svg", "tool.svg", "--project", "tool.json"], ["--svg", "tool.svg", "--object-depth", "10", "--fill", "none"],
    ["--out"], ["--out", "--json"], ["--json", "--json"],
    ["2x1x4", "3x1x4", "--svg", "tool.svg", "--object-depth", "9"],
    ["--project", "tool.json", "--no-lip"], ["--svg", "tool.svg", "--object-depth", "10", "--finger-center", "1"],
  ])("rejects contradictory or malformed syntax before exporting: %j", (...args) => {
    expect(() => parseExportArgs(args)).toThrow();
  });
});
