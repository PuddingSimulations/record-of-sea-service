/* Colour ramps shared by the steak textures and the result cross-section. */
'use strict';
var U = Sim.util, clamp = U.clamp, smoothstep = U.smoothstep, lerp = U.lerp;

function makeLUT(stops, lo, hi, n) {
  var lut = new Uint8ClampedArray(n * 3), si = 0;
  for (var i = 0; i < n; i++) {
    var x = lo + (hi - lo) * i / (n - 1);
    while (si < stops.length - 2 && x > stops[si + 1][0]) si++;
    var a = stops[si], b = stops[si + 1], t = clamp((x - a[0]) / (b[0] - a[0]), 0, 1);
    for (var k = 0; k < 3; k++) lut[i * 3 + k] = a[1][k] + (b[1][k] - a[1][k]) * t;
  }
  return lut;
}
// internal meat colour by temperature reached (deg C)
var MEAT = makeLUT([[20, [92, 20, 34]], [40, [122, 24, 38]], [48, [158, 33, 47]], [52, [183, 45, 58]], [56, [199, 70, 78]], [60, [209, 100, 100]], [64, [211, 128, 118]], [68, [200, 150, 132]], [72, [183, 152, 128]], [78, [160, 134, 110]], [90, [128, 106, 84]], [100, [106, 86, 66]]], 20, 100, 256);
// crust colour by browning level
var CRUST = makeLUT([[0, [210, 168, 118]], [0.25, [194, 146, 92]], [0.5, [156, 96, 42]], [0.85, [112, 60, 22]], [1.2, [80, 40, 15]], [1.8, [48, 22, 8]], [2.6, [22, 11, 6]], [3.2, [14, 8, 5]]], 0, 3.2, 256);
function meatRGB(T, o) { var i = clamp(Math.round((T - 20) / 80 * 255), 0, 255) * 3; o[0] = MEAT[i]; o[1] = MEAT[i + 1]; o[2] = MEAT[i + 2]; }
function crustRGB(b, o) { var i = clamp(Math.round(b / 3.2 * 255), 0, 255) * 3; o[0] = CRUST[i]; o[1] = CRUST[i + 1]; o[2] = CRUST[i + 2]; }

module.exports = { meatRGB: meatRGB, crustRGB: crustRGB };
