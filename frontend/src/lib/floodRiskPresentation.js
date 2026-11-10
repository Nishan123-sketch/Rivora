// A display-only adapter. It never computes or invents a flood grade.
// Only the verified-stage or sufficiently supported experimental backend result
// may contribute Low / Moderate / High.
const VALID_GRADES = new Set(['Low', 'Moderate', 'High']);

export function floodRiskPresentation({fresh, officialGrade, hybrid, loading = false} = {}) {
  if (!fresh) {
    return {grade: null, label: 'No data', method: null, reason: 'Water-level observation is missing or stale.'};
  }
  if (VALID_GRADES.has(officialGrade)) {
    return {grade: officialGrade, label: officialGrade, method: 'Verified stage', reason: 'Current level assessed using verified station-specific criteria; not an issued warning.'};
  }
  if (hybrid?.source === 'VERIFIED_STATION_STAGE' && VALID_GRADES.has(hybrid.grade)) {
    return {grade: hybrid.grade, label: hybrid.grade, method: 'Verified stage', reason: hybrid.detail || 'Verified station-specific flood stage.'};
  }
  if (hybrid?.source === 'EXPERIMENTAL_WAMIS_KMA' && VALID_GRADES.has(hybrid.grade)) {
    return {grade: hybrid.grade, label: hybrid.grade, method: 'Experimental', reason: 'Heuristic WAMIS/KMA flood-potential grade, not an official warning or a calibrated flood probability.'};
  }
  if (loading) {
    return {grade: null, label: 'Loading', method: null, reason: 'Checking available observations and assessment evidence.'};
  }
  return {grade: null, label: 'No data', method: null, reason: 'Insufficient verified thresholds or model inputs to assign a supported grade.'};
}
