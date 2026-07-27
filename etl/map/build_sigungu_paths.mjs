/**
 * korea-sigungu-raw.json → korea-sigungu-paths.json
 * 시군구 SVG path 사전계산 (d3-geo)
 */
import { createRequire } from "module";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const require = createRequire(path.join(ROOT, "frontend", "package.json"));
const { geoMercator, geoPath, geoCentroid } = require("d3-geo");

const IN = path.join(ROOT, "frontend/public/data/korea-sigungu-raw.json");
const OUT = path.join(ROOT, "frontend/public/data/korea-sigungu-paths.json");

const CODE_TO_PROVINCE = {
  "11": "서울",
  "21": "부산",
  "22": "대구",
  "23": "인천",
  "24": "광주",
  "25": "대전",
  "26": "울산",
  "29": "세종",
  "31": "경기",
  "32": "강원",
  "33": "충북",
  "34": "충남",
  "35": "전북",
  "36": "전남",
  "37": "경북",
  "38": "경남",
  "39": "제주",
};

const WIDTH = 720;
const HEIGHT = 960;
const PAD = 28;

const geo = JSON.parse(readFileSync(IN, "utf-8"));

const projection = geoMercator().fitExtent(
  [
    [PAD, PAD],
    [WIDTH - PAD, HEIGHT - PAD],
  ],
  geo,
);
const pathGen = geoPath(projection);

const regions = [];
for (const f of geo.features) {
  const props = f.properties || {};
  const code = String(props.code || "");
  const name = String(props.name || "");
  const province = CODE_TO_PROVINCE[code.slice(0, 2)] || "";
  const d = pathGen(f);
  if (!d || !province) continue;
  const c = geoCentroid(f);
  const [lx, ly] = projection(c) || [0, 0];
  regions.push({
    code,
    name,
    province,
    d,
    label: [Math.round(lx * 10) / 10, Math.round(ly * 10) / 10],
  });
}

const payload = {
  viewBox: [WIDTH, HEIGHT],
  fit: { x: 0, y: 0, w: WIDTH, h: HEIGHT },
  regions,
};

writeFileSync(OUT, JSON.stringify(payload), "utf-8");
console.log(`saved ${OUT} (${regions.length} regions, ${WIDTH}x${HEIGHT})`);
