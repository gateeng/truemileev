// TrueMile EV web: unit conversion and labels. Pure, DOM-free. Port of Units.kt.
//
// Every stored value is canonical imperial (mi, mph, °F, mi/kWh, MPGe, $/mi). Convert only at the
// display or CSV cell, so a unit toggle can never leave a number in the old unit.

export const BUILD = "2026-09-30.1";

/** Units.KM_PER_MI (the display factor; Efficiency's 1.60934 is only for the kWh/100km cloud key). */
export const MI_TO_KM = 1.609344;
/** Efficiency.MPGE_FACTOR: 1 kWh = 33.705 MPGe. */
export const MPGE_FACTOR = 33.705;
/** Units.L_PER_100KM_NUMERATOR: Le/100km = 235.214583 / MPGe. */
export const LE100_FACTOR = 235.214583;

export const UNIT_SYSTEMS = ["imperial", "metric"];

export const isMetric = (units) => units === "metric";

export const dist  = (mi, units)  => isMetric(units) ? mi * MI_TO_KM : mi;
export const speed = (mph, units) => isMetric(units) ? mph * MI_TO_KM : mph;
export const eff   = (miPerKwh, units) => isMetric(units) ? miPerKwh * MI_TO_KM : miPerKwh;
export const temp  = (f, units)   => isMetric(units) ? (f - 32) * 5 / 9 : f;
/** $/mi to $/km: a mile costs the same, a kilometre is shorter. */
export const perDist = (dollarsPerMi, units) => isMetric(units) ? dollarsPerMi / MI_TO_KM : dollarsPerMi;
/** Units.economy: imperial returns MPGe; metric Le/100km, and a 0 / negative MPGe stays 0. */
export const economy = (mpge, units) => !isMetric(units) ? mpge : (mpge > 0 ? LE100_FACTOR / mpge : 0);
/** Pounds to kilograms (towing weight). */
export const weight = (lbs, units) => isMetric(units) ? lbs * 0.45359237 : lbs;
/** kPa in one psi (the door-jamb label's own conversion). */
export const KPA_PER_PSI = 6.894757;
/** Tire pressure: psi stays psi (imperial); kPa in metric. */
export const pressure = (psi, units) => isMetric(units) ? psi * KPA_PER_PSI : psi;
/** kPa back to psi (a label that carries only one of the two). */
export const psiFromKpa = (kpa) => kpa / KPA_PER_PSI;
/** Feet (elevation) or metres. */
export const elevationFromFt = (ft, units) => isMetric(units) ? ft / 3.28084 : ft;

/** Units.*Label (and the Report's "mi/h" speed tile). */
export function labels(units) {
  const m = isMetric(units);
  return {
    dist: m ? "km" : "mi",
    speed: m ? "km/h" : "mph",
    speedTile: m ? "km/h" : "mi/h",
    eff: m ? "km/kWh" : "mi/kWh",
    econ: m ? "Le/100km" : "MPGe",
    temp: m ? "°C" : "°F",
    perDist: m ? "$/km" : "$/mi",
    weight: m ? "kg" : "lb",
    elevation: m ? "m" : "ft",
    pressure: m ? "kPa" : "psi",
  };
}
