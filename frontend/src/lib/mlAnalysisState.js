export function analysisState({loading,error,data}){return loading?'loading':error?'error':data?'ready':'empty';}
export function warningPercentage(prediction){const p=prediction?.probability;return prediction?.status==='VALIDATED_WARNING_FORECAST'&&typeof p==='number'&&Number.isFinite(p)&&p>=0&&p<=1?(p*100).toFixed(1)+'%':'Not available';}
export function stageResult(stage){
 if(stage?.level)return {label:stage.level,detail:'Comparison with published station thresholds; not an issued warning.'};
 if(stage?.data_status==='STALE')return {label:'Reading out of date',detail:'A recent water-level observation is required.'};
 if(stage?.water_level==null)return {label:'Awaiting observation',detail:'No usable current water-level observation is available.'};
 if(stage?.measurement_compatibility?.verified===false)return {label:'Comparison not verified',detail:'Water level is recorded, but its measurement reference has not been verified against the published thresholds. No flood-risk grade is assigned.'};
 return {label:'Awaiting observation',detail:'No usable current water-level observation is available.'};
}
export function warningLimitation(model){
 const reason=model?.reason||'';
 if(model?.status==='INDEPENDENT_TEST_ACCEPTANCE_FAILED')return 'Event coverage was expanded, but the model failed the final accuracy checks. Probabilities remain withheld.';
 if(reason==='NO_COMPLETE_WARNING_ARCHIVE_COVERAGE')return 'A complete official warning timeline is still required.';
 if(reason==='NO_COMPLETE_FEATURE_AND_LABEL_WINDOWS')return 'Confirmed warning periods still need matching river and rainfall observations.';
 if(reason==='INSUFFICIENT_CALIBRATION_OR_THRESHOLD_EVENTS')return 'The warning seasons contain events, but a separate calibration or decision block still has too few usable events.';
 if(reason==='INSUFFICIENT_INDEPENDENT_VALIDATION_STORMS')return 'More separate storm periods are needed for model selection, calibration and decision thresholds.';
 if(/POSITIVE_EVENTS|TIME_OR_STORM_GROUPS/.test(reason))return 'More independent warning events are needed in the training, validation and final-test periods.';
 if(reason==='NO_VALIDATED_DECISION_THRESHOLDS'||reason==='NO_GAUGE_HAS_SUFFICIENT_INDEPENDENT_EVENT_EVIDENCE')return 'The model has not met the required validation checks.';
 return 'Warning probability is withheld until its data and validation checks pass.';
}

export function warningScopeLabel(status){return status==='INDEPENDENT_TEST_ACCEPTANCE_FAILED'?'Network-wide warning classifier failed independent evaluation.':'Network-wide warning probability is not enabled.';}
export function networkWarningStationLabel(station,evidence){return !evidence?.probability_enabled?'Network model not validated':station?.warning_forecast_available?'Eligible for validated network model':'Outside validated network scope';}
export function warningCardState(prediction,quality){
 const failed=prediction?.validation_status==='INDEPENDENT_TEST_ACCEPTANCE_FAILED';
 return {headline:failed?'Unavailable — validation failed':prediction?.status==='VALIDATED_WARNING_FORECAST'?warningPercentage(prediction):'Warning probability unavailable',
  explanation:failed?'The shared warning model failed independent accuracy checks. Complete current inputs do not validate it. Water-level forecasts are evaluated separately.':'Warning probability requires both a validated model and complete current observations.',
  inputLabel:quality?.status==='FRESH'?'Ready':quality?.status==='DATA_UNAVAILABLE'?'Unavailable':'Incomplete',
  coverageLabel:quality?.rainfall_coverage?`${quality.rainfall_coverage.available_hours}/${quality.rainfall_coverage.required_hours} observed rainfall hours`:'Rainfall coverage not reported'};
}
export function stageOutlookLabel(outlook){return outlook?.overall_outlook==='NORMAL'?'Below reference levels in available forecasts':String(outlook?.overall_outlook||'Not assessed').replaceAll('_',' ').toLowerCase();}
