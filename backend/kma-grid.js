// Official KMA DFS Lambert Conformal Conic grid parameters (5 km grid).
// Coordinates are WGS84 degrees. Result is a forecast grid, not an ASOS station code.
function toKmaGrid(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 32 || lat > 40 || lon < 124 || lon > 132) {
    throw new RangeError('Station coordinates outside supported South Korean forecast region');
  }
  const RE = 6371.00877, GRID = 5.0, SLAT1 = 30.0, SLAT2 = 60.0;
  const OLON = 126.0, OLAT = 38.0, XO = 43, YO = 136;
  const rad = Math.PI / 180;
  let sn = Math.tan(Math.PI / 4 + SLAT2 * rad / 2) / Math.tan(Math.PI / 4 + SLAT1 * rad / 2);
  sn = Math.log(Math.cos(SLAT1 * rad) / Math.cos(SLAT2 * rad)) / Math.log(sn);
  let sf = Math.tan(Math.PI / 4 + SLAT1 * rad / 2);
  sf = Math.pow(sf, sn) * Math.cos(SLAT1 * rad) / sn;
  let ro = Math.tan(Math.PI / 4 + OLAT * rad / 2);
  ro = RE / GRID * sf / Math.pow(ro, sn);
  let ra = Math.tan(Math.PI / 4 + lat * rad / 2);
  ra = RE / GRID * sf / Math.pow(ra, sn);
  let theta = lon * rad - OLON * rad;
  if (theta > Math.PI) theta -= 2 * Math.PI;
  if (theta < -Math.PI) theta += 2 * Math.PI;
  theta *= sn;
  return { nx: Math.floor(ra * Math.sin(theta) + XO + 0.5), ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5) };
}
module.exports = { toKmaGrid };
